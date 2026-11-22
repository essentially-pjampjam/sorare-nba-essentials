import { COMPETITION_ENTRY_LIMITS, LINEUP_FORMAT_TARGETS } from "../shared/constants";
import { estimateSealingPoints } from "./sealingPoints";
import {
  MIN_VIABLE_CASH_PCT,
  buildContestThresholds,
  evaluateContestEv,
  lineupStdDev,
  probabilityAtLeast,
} from "./entryEvMath";
import type {
  BargainListing,
  NbaPosition,
  CardRarity,
  CurrentLineupEntry,
  GalleryCard,
  InjuryReportEntry,
  InjuryStatus,
  LeaderboardBenchmark,
  LineupAgeFilter,
  LineupFormat,
  ProjectionSource,
  TeamSlateSchedule,
} from "../shared/types";

/**
 * Returns the Pro / Arena maximum total ★ star cap for capped formats, or null if uncapped / L10-capped.
 *
 * Live-verified 2026-11-19 (docs/SORARE_FACTS.md): Arena Rooms use the same caps as Pro,
 * Champion 16★ and Contender 11★. The legacy ids `arena_champion_15` / `arena_contender_12`
 * are kept as stable identifiers for the Arena Room formats; their caps are 16★ / 11★.
 */
export function getFormatStarCap(format: LineupFormat): number | null {
  switch (format) {
    case "champion_16":
    case "arena_champion_15":
      return 16;
    case "arena_contender_12":
    case "contender_11":
      return 11;
    default:
      return null;
  }
}

export function matchesAgeFilter(
  age: number | null | undefined,
  ageFilter: LineupAgeFilter = "all",
): boolean {
  if (ageFilter === "all") return true;
  if (typeof age !== "number" || !Number.isFinite(age)) return false;
  if (ageFilter === "u23") return age <= 23;
  if (ageFilter === "veterans") return age >= 30;
  return true;
}

export interface EvaluatedLineupCard {
  card: GalleryCard;
  baseProjection: number;
  injuryAdjustedBase: number;
  effectiveScore: number;
  injury: InjuryReportEntry | null;
  injuryStatus: InjuryStatus;
  gamesInSlate: number;
  /** Skewed (log-normal) score distribution for this slate; all 0 when the player can't score. */
  p10Floor: number;
  p50Median: number;
  p90Ceiling: number;
  /** Coefficient of variation used for the distribution. */
  cv: number;
  /** Points over a freely available replacement-level card (REPLACEMENT_LEVEL_PTS). */
  vorp: number;
  /** Points over what the card's star cost typically scores (value per star). */
  starSurplus: number;
  riskTags: string[];
  upsideTags: string[];
  /** Multipliers applied on top of the base projection. */
  boostSummary: {
    powerMultiplier: number;
    slateMultiplier: number;
    vegasMultiplier: number;
    restMultiplier: number;
  };
  allSources: {
    sorareProjected: number | null;
    l10: number | null;
    l5: number | null;
    custom: number | null;
    blended: number;
  };
}

export interface LineupSlotPick {
  slotLabel: "MVP" | "G" | "F" | "C" | "FLEX";
  evaluated: EvaluatedLineupCard;
  isCaptainOrMvp: boolean;
  slotScore: number;
}

export interface SuggestedLineup {
  rank: number;
  format: LineupFormat;
  slots: LineupSlotPick[];
  totalScore: number;
  totalStars: number;
  capUsed: number;
  capLimit: number | null;
  inSeasonCount: number;
  hasInjuryRisk: boolean;
  /** Correlation-aware lineup score spread (see computeLineupVariance). */
  stdDev?: number;
  variance?: number;
  /** Estimated win probabilities (%) against target thresholds */
  odds: {
    essenceTarget: number;
    essencePct: number;
    tier1Target: number;
    tier1Pct: number;
    podiumTarget: number;
    podiumPct: number;
    paidLabel?: string;
    tierLabel?: string;
    estRank?: number;
    totalEntries?: number;
    topPercentilePct?: number;
    fieldPaidPct?: number;
    benchmarkFixture?: string;
  };
}

export type LineupBuildStrategy = "proj" | "floor" | "ceiling";

/** Sorare NBA competition rule: at most 4 players from the same NBA team in a 5-card lineup. */
export const DEFAULT_MAX_PER_TEAM = 4;

function exceedsMaxPerTeam(
  cards: Array<{ teamSlug: string | null }>,
  maxPerTeam: number,
): boolean {
  if (maxPerTeam <= 0) return false;
  const counts = new Map<string, number>();
  for (const c of cards) {
    if (!c.teamSlug) continue;
    const next = (counts.get(c.teamSlug) ?? 0) + 1;
    if (next > maxPerTeam) return true;
    counts.set(c.teamSlug, next);
  }
  return false;
}

export interface AutoBuildOptions {
  /**
   * Ranking weight per team slug (default 1). Used by Set Solo "today first" to rank players who
   * play later below today's players; slot scores carry the weight, so callers divide it back out.
   */
  scoreWeightByTeam?: Record<string, number>;
  /** Optimization objective: expected mean ("proj"), safe p10 floor ("floor"), or high p90 ceiling ("ceiling"). */
  strategy?: LineupBuildStrategy;
  /** Max players allowed from a single NBA team (default 4; null or 0 disables). */
  maxPerTeam?: number | null;
  format: LineupFormat;
  rarityFilter: CardRarity | "ALL";
  projectionSource: ProjectionSource;
  customProjectionsRaw: string;
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  excludeOut: boolean;
  excludeQuestionable: boolean;
  inSeasonOnly: boolean;
  minInSeasonCards: number;
  disjointAcrossLineups: boolean;
  ageFilter?: LineupAgeFilter;
  excludeSubmittedCards?: boolean;
  excludedCardSlugs?: string[];
  maxLineups: number;
  captainBonusPct?: number;
  benchmarks?: LeaderboardBenchmark[];
  benchmarkSeasonScope?: "in_season" | "classic" | "arena";
  /** Per-team slate schedule (games, B2B) for edit-focus notes. */
  scheduleByTeam?: Record<string, TeamSlateSchedule>;
  /** Live Instant Buy / auction listings for buy-target notes. */
  marketListings?: BargainListing[];
  targets?: {
    essenceTarget: number;
    tier1Target: number;
    podiumTarget: number;
  };
}

export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Maps L10 average score to Sorare NBA Star cost (1.0 - 5.0 in 0.5 increments).
 */
export function computeStarCost(l10: number | null): number {
  const val = l10 ?? 0;
  if (val >= 50) return 5.0;
  if (val >= 44) return 4.5;
  if (val >= 38) return 4.0;
  if (val >= 32) return 3.5;
  if (val >= 26) return 3.0;
  if (val >= 21) return 2.5;
  if (val >= 16) return 2.0;
  if (val >= 11) return 1.5;
  return 1.0;
}

export interface StarTierShiftInfo {
  currentStars: number;
  projectedStars: number;
  direction: "value_lock" | "cap_drop" | "stable";
  label: string | null;
}

/**
 * Predicts upcoming ★ star-tier shifts by comparing current L10 star tier against recent L5 momentum.
 */
/**
 * True when the player hasn't played an NBA game this season (ESPN season stats). His L10 / L5 can
 * be last season's, so he is never projected, suggested or tagged as in form.
 */
export function isInactiveThisSeason(card: Pick<GalleryCard, "seasonGamesPlayed">): boolean {
  return card.seasonGamesPlayed === 0;
}

/**
 * Marks each card with its games played this season. Only applied when the season stats look
 * complete (200+ players), so an ESPN outage or the first days of a season never bench everyone.
 */
export function annotateSeasonActivity<T extends GalleryCard>(
  cards: T[],
  gamesByName: Record<string, { gamesPlayed: number }>,
): T[] {
  if (Object.keys(gamesByName).length < 200) return cards;
  return cards.map((c) => ({ ...c, seasonGamesPlayed: gamesByName[normalizePlayerName(c.playerName)]?.gamesPlayed ?? 0 }));
}

export function evaluateStarTierShift(
  l10: number | null,
  l5: number | null,
): StarTierShiftInfo {
  const currentStars = computeStarCost(l10);
  if (l10 === null || l5 === null) {
    return {
      currentStars,
      projectedStars: currentStars,
      direction: "stable",
      label: null,
    };
  }
  const blendedNextL10 = l10 * 0.65 + l5 * 0.35;
  const l5Stars = computeStarCost(l5);
  const nextStars = computeStarCost(blendedNextL10);

  if (l5Stars > currentStars) {
    return {
      currentStars,
      projectedStars: l5Stars,
      direction: "value_lock",
      label: `${currentStars}★→${l5Stars}★ Form`,
    };
  }
  if (nextStars < currentStars || l5Stars < currentStars) {
    const target = Math.min(nextStars, l5Stars);
    return {
      currentStars,
      projectedStars: target,
      direction: "cap_drop",
      label: `${currentStars}★→${target}★ Drop`,
    };
  }
  return {
    currentStars,
    projectedStars: currentStars,
    direction: "stable",
    label: null,
  };
}

export function parseCustomProjections(rawText: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!rawText.trim()) return map;

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[\t,;]+/).map((s) => s.trim());
    if (parts.length < 2) continue;
    const score = Number(parts[parts.length - 1]);
    const name = parts.slice(0, -1).join(" ");
    if (name && Number.isFinite(score) && score >= 0) {
      map.set(normalizePlayerName(name), score);
    }
  }
  return map;
}

function injuryFactor(status: InjuryStatus): number {
  switch (status) {
    case "OUT":
      return 0;
    case "DOUBTFUL":
      return 0.25;
    case "QUESTIONABLE":
    case "DAY_TO_DAY":
      return 0.8;
    case "ACTIVE":
    default:
      return 1;
  }
}

function slatePeakMultiplier(gamesInSlate: number): number {
  if (gamesInSlate <= 0) return 0.25;
  if (gamesInSlate === 1) return 1.0;
  if (gamesInSlate === 2) return 1.12;
  if (gamesInSlate === 3) return 1.19;
  return 1.24;
}

/** League-average implied team total (2025-26 NBA scoring environment, ~114-115 ppg). */
export const LEAGUE_AVG_TEAM_TOTAL = 114.5;
/** Fantasy points move ~half as much as team points (usage share stays flat). */
const ITT_ELASTICITY = 0.5;
/** Back-to-back: rest/minutes risk on the second night. */
const B2B_MULTIPLIER = 0.96;
/** Heavy favourite / underdog: starters can sit the 4th quarter. */
const BLOWOUT_MULTIPLIER = 0.97;
export const BLOWOUT_SPREAD = 10;
/** Score of a freely available bench card (about a 1-1.5 star L10). */
export const REPLACEMENT_LEVEL_PTS = 12;
const BASE_PLAYER_CV = 0.35;
const Z90 = 1.2816;

interface SlateContext {
  vegasMultiplier: number;
  restMultiplier: number;
  backToBack: boolean;
  blowout: boolean;
  impliedTeamTotal: number | null;
}

function slateContextAdjustments(sched: TeamSlateSchedule | undefined): SlateContext {
  if (!sched) {
    return { vegasMultiplier: 1, restMultiplier: 1, backToBack: false, blowout: false, impliedTeamTotal: null };
  }
  const itt =
    typeof sched.impliedTeamTotal === "number" && Number.isFinite(sched.impliedTeamTotal)
      ? sched.impliedTeamTotal
      : null;
  const vegasRaw =
    itt !== null ? 1 + ((itt - LEAGUE_AVG_TEAM_TOTAL) / LEAGUE_AVG_TEAM_TOTAL) * ITT_ELASTICITY : 1;
  const vegasMultiplier = Math.min(1.1, Math.max(0.9, vegasRaw));
  const blowout =
    sched.blowoutRisk === true ||
    (typeof sched.spread === "number" && Math.abs(sched.spread) >= BLOWOUT_SPREAD);
  const backToBack = sched.hasBackToBack === true;
  const restMultiplier = (backToBack ? B2B_MULTIPLIER : 1) * (blowout ? BLOWOUT_MULTIPLIER : 1);
  return { vegasMultiplier, restMultiplier, backToBack, blowout, impliedTeamTotal: itt };
}

/** Typical L10 for a card at this star cost (mid-point of the extension's star tiers). */
export function expectedScoreForStars(starCost: number): number {
  const table: Array<[number, number]> = [
    [1.0, 8],
    [1.5, 13.5],
    [2.0, 18.5],
    [2.5, 23.5],
    [3.0, 29],
    [3.5, 35],
    [4.0, 41],
    [4.5, 47],
    [5.0, 52],
  ];
  let best = table[0];
  for (const row of table) if (Math.abs(row[0] - starCost) < Math.abs(best[0] - starCost)) best = row;
  return best[1];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildCardAnalytics(args: {
  card: GalleryCard;
  effectiveScore: number;
  injuryStatus: InjuryStatus;
  gamesInSlate: number;
  noGame: boolean;
  context: SlateContext;
  l5: number | null;
  l10: number | null;
}): Pick<
  EvaluatedLineupCard,
  "p10Floor" | "p50Median" | "p90Ceiling" | "cv" | "vorp" | "starSurplus" | "riskTags" | "upsideTags"
> {
  const { card, effectiveScore, injuryStatus, gamesInSlate, noGame, context, l5, l10 } = args;
  const riskTags: string[] = [];
  const upsideTags: string[] = [];
  if (noGame) riskTags.push("0G: no game this slate");
  if (injuryStatus === "OUT") riskTags.push("OUT (injury)");
  else if (injuryStatus !== "ACTIVE") {
    riskTags.push(`${injuryStatus.replace(/_/g, "-").toLowerCase()} (injury)`);
  }
  if (context.backToBack) riskTags.push("B2B: back-to-back rest risk");
  if (context.blowout) riskTags.push("Blowout risk (big spread)");
  if (context.impliedTeamTotal !== null && context.impliedTeamTotal < LEAGUE_AVG_TEAM_TOTAL - 6) {
    riskTags.push(`Low implied team total (${context.impliedTeamTotal.toFixed(1)})`);
  }
  if (gamesInSlate >= 2) upsideTags.push(`${gamesInSlate}G slate`);
  if (context.impliedTeamTotal !== null && context.impliedTeamTotal > LEAGUE_AVG_TEAM_TOTAL + 6) {
    upsideTags.push(`High implied team total (${context.impliedTeamTotal.toFixed(1)})`);
  }
  if (l5 !== null && l10 !== null && l10 > 0 && l5 >= l10 * 1.15) upsideTags.push("Hot form (L5 > L10)");

  // Bench / low-minute players and uncertain situations swing more.
  let cv = BASE_PLAYER_CV;
  if ((l10 ?? 0) < 15) cv += 0.1;
  if (injuryStatus === "DAY_TO_DAY" || injuryStatus === "QUESTIONABLE") cv += 0.1;
  if (context.backToBack) cv += 0.05;
  if (context.blowout) cv += 0.05;
  cv = Math.round(cv * 100) / 100;

  let p10Floor = 0;
  let p50Median = 0;
  let p90Ceiling = 0;
  if (effectiveScore > 0) {
    // Log-normal with mean = effectiveScore: right-skewed like real box-score outcomes.
    const sigma = Math.sqrt(Math.log(1 + cv * cv));
    const median = effectiveScore / Math.sqrt(1 + cv * cv);
    p10Floor = round1(median * Math.exp(-Z90 * sigma));
    p50Median = round1(median);
    p90Ceiling = round1(median * Math.exp(Z90 * sigma));
  }
  return {
    p10Floor,
    p50Median,
    p90Ceiling,
    cv,
    vorp: round1(effectiveScore - REPLACEMENT_LEVEL_PTS),
    starSurplus: round1(effectiveScore - expectedScoreForStars(card.starCost)),
    riskTags,
    upsideTags,
  };
}


/** Same-team score correlation (NBA teammates compete for fixed shots, usage, and rebounds). */
const TEAMMATE_RHO = -0.05;
/** Opponents in the same game: high-pace / OT shootouts lift both sides slightly. */
const SAME_GAME_RHO = 0.06;

function playsAgainst(
  a: TeamSlateSchedule | undefined,
  b: TeamSlateSchedule | undefined,
): boolean {
  if (!a || !b || !a.abbr || !b.abbr) return false;
  const tokens = (m: string) => m.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/);
  return (
    a.matchups.some((m) => tokens(m).includes(b.abbr.toUpperCase())) ||
    b.matchups.some((m) => tokens(m).includes(a.abbr.toUpperCase()))
  );
}

/**
 * Lineup score variance with per-player spread from each card's cv (floor 4 pts) plus
 * pairwise correlation for teammates and for opponents in the same game.
 */
export function computeLineupVariance(
  slots: Array<{ slotScore: number; evaluated: EvaluatedLineupCard }>,
  scheduleByTeam?: Record<string, TeamSlateSchedule>,
): number {
  const sigmas = slots.map((s) => Math.max(4, s.slotScore * (s.evaluated.cv || 0.35)));
  let variance = 0;
  for (let i = 0; i < slots.length; i += 1) {
    variance += sigmas[i] * sigmas[i];
    for (let j = i + 1; j < slots.length; j += 1) {
      const ta = slots[i].evaluated.card.teamSlug;
      const tb = slots[j].evaluated.card.teamSlug;
      let rho = 0;
      if (ta && tb && ta === tb) rho = TEAMMATE_RHO;
      else if (ta && tb && playsAgainst(scheduleByTeam?.[ta], scheduleByTeam?.[tb])) rho = SAME_GAME_RHO;
      variance += 2 * rho * sigmas[i] * sigmas[j];
    }
  }
  return variance;
}

export function evaluateCardForLineup(
  card: GalleryCard,
  projectionSource: ProjectionSource,
  customMap: Map<string, number>,
  injuriesByName: Record<string, InjuryReportEntry>,
  gamesPerTeam: Record<string, number>,
  scheduleByTeam?: Record<string, TeamSlateSchedule>,
): EvaluatedLineupCard {
  const normName = normalizePlayerName(card.playerName);
  const injury = injuriesByName[normName] ?? null;
  const injuryStatus: InjuryStatus = injury?.status ?? "ACTIVE";
  const hasSchedule = Object.keys(gamesPerTeam).length > 0;
  // With a known schedule, a player without a team (free agent) has no game.
  const gamesInSlate = hasSchedule ? (card.teamSlug ? (gamesPerTeam[card.teamSlug] ?? 0) : 0) : 1;

  const sorareProj =
    card.sorareClassicProjected && card.sorareClassicProjected > 0
      ? card.sorareClassicProjected
      : card.sorareDailyProjected && card.sorareDailyProjected > 0
        ? card.sorareDailyProjected
        : null;
  const l10 = card.l10 ?? null;
  const l5 = card.l5 ?? null;
  const custom = customMap.get(normName) ?? null;

  const peakMult = hasSchedule ? slatePeakMultiplier(gamesInSlate) : 1;
  const avgAdjL10 = l10 !== null ? l10 * peakMult : null;
  const avgAdjL5 = l5 !== null ? l5 * peakMult : null;

  // Smart consensus blends Sorare projected + schedule-adjusted L5 + baseline L10
  const projWeight = sorareProj !== null ? 0.45 : 0;
  const l5Weight = avgAdjL5 !== null ? 0.30 : 0;
  const l10Weight = avgAdjL10 !== null ? 0.25 : 0;
  const totalW = projWeight + l5Weight + l10Weight;
  const blended =
    totalW > 0
      ? ((sorareProj ?? 0) * projWeight +
          (avgAdjL5 ?? 0) * l5Weight +
          (avgAdjL10 ?? 0) * l10Weight) /
        totalW
      : 0;

  let baseProjection = blended;
  switch (projectionSource) {
    case "sorare_projected":
      baseProjection = sorareProj ?? avgAdjL10 ?? avgAdjL5 ?? 0;
      break;
    case "sorare_l10":
      baseProjection = avgAdjL10 ?? sorareProj ?? avgAdjL5 ?? 0;
      break;
    case "sorare_l5":
      baseProjection = avgAdjL5 ?? sorareProj ?? avgAdjL10 ?? 0;
      break;
    case "custom_csv":
      baseProjection =
        custom !== null ? custom * peakMult : blended;
      break;
    case "blended_smart":
    default:
      baseProjection = blended;
      break;
  }

  const mult =
    projectionSource === "blended_smart" || projectionSource === "custom_csv"
      ? injuryFactor(injuryStatus)
      : injuryStatus === "OUT"
        ? 0
        : 1;

  // A player whose team has no game in the slate cannot score.
  const noGame = hasSchedule && gamesInSlate === 0;
  const sched = card.teamSlug ? scheduleByTeam?.[card.teamSlug] : undefined;
  const context = slateContextAdjustments(sched);
  // No game this slate, or no NBA game at all this season (L10 is last season's): cannot score.
  const injuryAdjustedBase = noGame || isInactiveThisSeason(card) ? 0 : baseProjection * mult;
  const effectiveScore =
    injuryAdjustedBase * card.powerMultiplier * context.vegasMultiplier * context.restMultiplier;
  const analytics = buildCardAnalytics({
    card,
    effectiveScore,
    injuryStatus,
    gamesInSlate,
    noGame,
    context,
    l5,
    l10,
  });

  return {
    card,
    baseProjection,
    injuryAdjustedBase,
    effectiveScore,
    injury,
    injuryStatus,
    gamesInSlate,
    ...analytics,
    boostSummary: {
      powerMultiplier: card.powerMultiplier,
      slateMultiplier: hasSchedule ? slatePeakMultiplier(gamesInSlate) : 1,
      vegasMultiplier: context.vegasMultiplier,
      restMultiplier: context.restMultiplier,
    },
    allSources: {
      sorareProjected: sorareProj,
      l10,
      l5,
      custom,
      blended,
    },
  };
}

/** Standard normal CDF approximation (Abramowitz & Stegun) */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.39894228 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

function estimateWinProbability(
  meanScore: number,
  stdDev: number,
  targetScore: number,
): number {
  if (stdDev <= 0) return meanScore >= targetScore ? 100 : 0;
  const z = (meanScore - targetScore) / stdDev;
  return Math.max(0, Math.min(99.9, (1 - normalCdf(-z)) * 100));
}

export function findBenchmarkForFormat(
  benchmarks: LeaderboardBenchmark[] | undefined,
  format: LineupFormat,
  preferredScope?: "in_season" | "classic" | "arena",
  ageFilter: LineupAgeFilter = "all",
): LeaderboardBenchmark | null {
  if (!benchmarks || benchmarks.length === 0) return null;
  const matchingFormat = benchmarks.filter((b) => b.format === format);
  if (matchingFormat.length === 0) return null;

  if (
    format === "arena_contender_12" ||
    format === "arena_champion_15" ||
    format === "uncapped"
  ) {
    const exactAge = matchingFormat.find(
      (b) => (b.ageScope ?? "all") === ageFilter,
    );
    if (exactAge) return exactAge;
    return matchingFormat.find((b) => (b.ageScope ?? "all") === "all") ?? matchingFormat[0];
  }

  if (preferredScope) {
    const scoped = matchingFormat.find((b) => b.seasonScope === preferredScope);
    if (scoped) return scoped;
  }
  return (
    matchingFormat.find((b) => b.seasonScope === "in_season") ??
    matchingFormat[0]
  );
}

function estimateBenchmarkStanding(
  projectedScore: number,
  bm: LeaderboardBenchmark,
): { estRank: number; totalEntries: number; topPercentilePct: number } | null {
  const sampleN = bm.podSize ?? bm.totalEntries;
  if (sampleN < 2 || bm.paidCutoffScore === null) return null;
  const paidScore = bm.paidCutoffScore;
  const paidRank = bm.podSize
    ? Math.max(1, Math.round(sampleN * 0.5))
    : Math.max(1, Math.min(sampleN, bm.paidPlaces));
  const top5Score = bm.top5Score ?? bm.top20Score ?? paidScore * 1.18;
  const top5Rank = Math.max(1, Math.round(sampleN * (bm.top5Score ? 0.05 : 0.2)));
  const top1Score = bm.top1Score ?? Math.max(top5Score * 1.12, paidScore * 1.35);
  const floorScore = Math.max(20, paidScore * 0.45);

  const anchors: Array<{ score: number; rank: number }> = [
    { score: top1Score, rank: 1 },
    { score: top5Score, rank: top5Rank },
    { score: paidScore, rank: paidRank },
    { score: floorScore, rank: sampleN },
  ].sort((a, b) => b.score - a.score);

  let estSampleRank = sampleN;
  if (projectedScore >= anchors[0].score) {
    estSampleRank = 1;
  } else if (projectedScore <= anchors[anchors.length - 1].score) {
    estSampleRank = sampleN;
  } else {
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const hi = anchors[i];
      const lo = anchors[i + 1];
      if (projectedScore <= hi.score && projectedScore >= lo.score) {
        const span = Math.max(0.1, hi.score - lo.score);
        const ratio = (hi.score - projectedScore) / span;
        estSampleRank = Math.round(hi.rank + ratio * (lo.rank - hi.rank));
        break;
      }
    }
  }

  const boundedSampleRank = Math.max(1, Math.min(sampleN, estSampleRank));
  const topPercentilePct = Math.max(
    1,
    Math.min(99, Math.round((boundedSampleRank / sampleN) * 100)),
  );
  return {
    estRank: boundedSampleRank,
    totalEntries: sampleN,
    topPercentilePct,
  };
}

function assignSlotLabels(
  picks: EvaluatedLineupCard[],
  format: LineupFormat,
  captainBonusPct: number,
): { slots: LineupSlotPick[]; totalScore: number; totalStars: number; capUsed: number } {
  const sorted = [...picks].sort((a, b) => b.effectiveScore - a.effectiveScore);
  const mvpOrCaptainIdx = 0;

  let totalScore = 0;
  let totalStars = 0;
  let capUsed = 0;

  const slots: LineupSlotPick[] = sorted.map((ev, idx) => {
    const isCaptainOrMvp =
      (format === "daily_120_mvp" || captainBonusPct > 0) &&
      idx === mvpOrCaptainIdx;
    const boost = isCaptainOrMvp ? 1 + captainBonusPct / 100 : 1;
    const slotScore = ev.effectiveScore * boost;
    totalScore += slotScore;
    totalStars += ev.card.starCost;

    if (format === "daily_120_mvp") {
      if (!isCaptainOrMvp) capUsed += ev.card.l10 ?? 0;
    } else if (getFormatStarCap(format) !== null) {
      capUsed += ev.card.starCost;
    } else {
      capUsed += ev.card.l10 ?? 0;
    }

    let slotLabel: LineupSlotPick["slotLabel"] = "FLEX";
    if (isCaptainOrMvp) {
      slotLabel = "MVP";
    } else if (ev.card.positions.includes("basketball_guard")) {
      slotLabel = "G";
    } else if (ev.card.positions.includes("basketball_forward")) {
      slotLabel = "F";
    } else if (ev.card.positions.includes("basketball_center")) {
      slotLabel = "C";
    }

    return {
      slotLabel,
      evaluated: ev,
      isCaptainOrMvp,
      slotScore,
    };
  });

  return {
    slots,
    totalScore: Math.round(totalScore * 10) / 10,
    totalStars: Math.round(totalStars * 10) / 10,
    capUsed: Math.round(capUsed * 10) / 10,
  };
}

/**
 * Fast branch-and-bound auto-builder generating top N distinct 5-card lineups
 * under Pro (16★/11★), Arena (15★/12★/Uncapped), or Set Squad (120+MVP) formats.
 */
export function generateTopLineups(
  cards: GalleryCard[],
  options: AutoBuildOptions,
): {
  lineups: SuggestedLineup[];
  evaluatedPool: EvaluatedLineupCard[];
} {
  const customMap = parseCustomProjections(options.customProjectionsRaw);
  const captainBonusPct = options.captainBonusPct ?? 0;
  const fallbackTargets = options.targets ?? LINEUP_FORMAT_TARGETS[options.format];
  const preferredScope =
    options.benchmarkSeasonScope ??
    (options.inSeasonOnly || options.minInSeasonCards >= 4
      ? "in_season"
      : "classic");
  const benchmark = findBenchmarkForFormat(
    options.benchmarks,
    options.format,
    preferredScope,
    options.ageFilter ?? "all",
  );
  const targets =
    !options.targets && benchmark && benchmark.paidCutoffScore !== null
      ? {
          essenceTarget: Math.round(benchmark.paidCutoffScore),
          tier1Target: Math.round(
            benchmark.top5Score ??
              benchmark.top20Score ??
              benchmark.paidCutoffScore * 1.18,
          ),
          podiumTarget: Math.round(
            benchmark.podiumScore ??
              benchmark.top1Score ??
              benchmark.paidCutoffScore * 1.35,
          ),
        }
      : fallbackTargets;
  const starCap = getFormatStarCap(options.format);
  const capLimit =
    starCap !== null ? starCap : options.format === "daily_120_mvp" ? 120 : null;

  const excludedSet = new Set(options.excludedCardSlugs ?? []);
  const evaluatedPool = cards
    .filter((card) => {
      // Sealed (Vault) cards cannot be played on Sorare.
      if (card.sealed) return false;
      if (options.rarityFilter !== "ALL" && card.rarity !== options.rarityFilter) {
        return false;
      }
      if (options.inSeasonOnly && !card.inSeasonEligible) {
        return false;
      }
      if (!matchesAgeFilter(card.playerAge, options.ageFilter)) {
        return false;
      }
      if (options.excludeSubmittedCards && card.openedLineupIds && card.openedLineupIds.length > 0) {
        return false;
      }
      if (excludedSet.has(card.slug)) {
        return false;
      }
      return true;
    })
    .map((card) =>
      evaluateCardForLineup(
        card,
        options.projectionSource,
        customMap,
        options.injuriesByName,
        options.gamesPerTeam,
        options.scheduleByTeam,
      ),
    )
    .map((ev) => {
      const w = ev.card.teamSlug ? options.scoreWeightByTeam?.[ev.card.teamSlug] : undefined;
      return w !== undefined && w !== 1 ? { ...ev, effectiveScore: ev.effectiveScore * w } : ev;
    })
    .filter((ev) => {
      // No game in the slate = 0 points: never draft it.
      if (ev.gamesInSlate === 0 && ev.effectiveScore <= 0) return false;
      if (options.excludeOut && ev.injuryStatus === "OUT") return false;
      if (
        options.excludeQuestionable &&
        (ev.injuryStatus === "QUESTIONABLE" ||
          ev.injuryStatus === "DAY_TO_DAY" ||
          ev.injuryStatus === "DOUBTFUL")
      ) {
        return false;
      }
      return ev.effectiveScore > 0;
    })
    .sort((a, b) => b.effectiveScore - a.effectiveScore);

  const strategy: LineupBuildStrategy = options.strategy ?? "proj";
  const maxPerTeam =
    options.maxPerTeam === undefined ? DEFAULT_MAX_PER_TEAM : (options.maxPerTeam ?? 0);
  const cardSigma = (ev: EvaluatedLineupCard): number =>
    Math.max(4, ev.effectiveScore * (ev.cv || 0.35));
  // Exact per-card linear upper bound for 5-card floor (sqrt(0.80 / 5) === 0.4)
  const cardFloorContrib = (ev: EvaluatedLineupCard): number =>
    ev.effectiveScore - 0.4 * Z90 * cardSigma(ev);
  // Per-card heuristic ranking for ceiling (sqrt(1.24 / 5) ≈ 0.498)
  const cardCeilRank = (ev: EvaluatedLineupCard): number =>
    ev.effectiveScore + 0.5 * Z90 * cardSigma(ev);

  const maxToFind = Math.max(1, Math.min(10, options.maxLineups));
  const targetPoolSize = Math.max(40, maxToFind * 5 + 16);

  // Deduplicate by player when not stacking identical players, and keep low-star/L10
  // enablers even if ranked outside the top raw-score slice so capped formats stay optimal.
  let basePool = evaluatedPool;
  if (!options.disjointAcrossLineups) {
    const seenPlayers = new Set<string>();
    basePool = evaluatedPool.filter((ev) => {
      if (seenPlayers.has(ev.card.playerSlug)) return false;
      seenPlayers.add(ev.card.playerSlug);
      return true;
    });
  }

  // Order candidate pool by the active strategy so DFS finds strong solutions first and
  // keeps strategy-relevant players inside targetPoolSize.
  const strategyPool =
    strategy === "floor"
      ? [...basePool].sort((a, b) => cardFloorContrib(b) - cardFloorContrib(a) || b.effectiveScore - a.effectiveScore)
      : strategy === "ceiling"
        ? [...basePool].sort((a, b) => cardCeilRank(b) - cardCeilRank(a) || b.effectiveScore - a.effectiveScore)
        : basePool;

  const head = strategyPool.slice(0, targetPoolSize);
  const headSlugs = new Set(head.map((ev) => ev.card.slug));
  const budgetEnablers = strategyPool
    .filter((ev) => !headSlugs.has(ev.card.slug) && ev.card.starCost <= 2.0)
    .slice(0, 8);
  const pool = [...head, ...budgetEnablers];

  const buildSuffixExtremesSum = (vals: number[], takeLargest: boolean): Float64Array => {
    const len = vals.length;
    const out = new Float64Array((len + 1) * 6);
    const best: number[] = [];
    for (let i = len - 1; i >= 0; i -= 1) {
      const v = vals[i];
      let pos = best.length;
      for (let j = 0; j < best.length; j += 1) {
        if (takeLargest ? v > best[j] : v < best[j]) {
          pos = j;
          break;
        }
      }
      best.splice(pos, 0, v);
      if (best.length > 5) best.pop();
      const base = i * 6;
      let acc = 0;
      for (let k = 1; k <= best.length; k += 1) {
        acc += best[k - 1];
        out[base + k] = acc;
      }
    }
    return out;
  };

  const lineups: SuggestedLineup[] = [];
  const usedCardSlugsGlobal = new Set<string>();

  for (let pass = 0; pass < maxToFind; pass += 1) {
    const available = options.disjointAcrossLineups
      ? pool.filter((ev) => !usedCardSlugsGlobal.has(ev.card.slug))
      : pool;

    if (available.length < 5) break;

    // Multi-entry with an In-Season quota: don't let one lineup burn In-Season cards the
    // later lineups need, so the slate fits as many legal entries as the pool allows.
    let inSeasonCapThisPass = 5;
    if (options.disjointAcrossLineups && options.minInSeasonCards > 0) {
      const remainingInSeason = available.filter((ev) => ev.card.inSeasonEligible).length;
      const feasibleLineups = Math.min(
        maxToFind - pass,
        Math.floor(remainingInSeason / options.minInSeasonCards),
        Math.floor(available.length / 5),
      );
      if (feasibleLineups > 1) {
        inSeasonCapThisPass = Math.max(
          options.minInSeasonCards,
          remainingInSeason - options.minInSeasonCards * (feasibleLineups - 1),
        );
      }
    }

    let bestObjective = Number.NEGATIVE_INFINITY;
    let bestCombo: EvaluatedLineupCard[] | null = null;
    const seenLineupSignatures = new Set(
      lineups.map((l) =>
        l.slots
          .map((s) => s.evaluated.card.slug)
          .sort()
          .join("|"),
      ),
    );

    const n = available.length;
    const effVals = available.map((ev) => ev.effectiveScore);
    const sigmaVals = available.map((ev) => cardSigma(ev));
    const sigmaSqVals = sigmaVals.map((s) => s * s);
    const floorContribVals = available.map((ev) => cardFloorContrib(ev));

    const topEffSum = buildSuffixExtremesSum(effVals, true);
    const topSigmaSqSum = buildSuffixExtremesSum(sigmaSqVals, true);
    const bottomSigmaSqSum = buildSuffixExtremesSum(sigmaSqVals, false);
    const topFloorContribSum = buildSuffixExtremesSum(floorContribVals, true);

    const chosen: EvaluatedLineupCard[] = [];
    const chosenPlayers = new Set<string>();
    const teamCounts = new Map<string, number>();

    const dfs = (
      startIdx: number,
      starSum: number,
      nonMvpL10Sum: number,
      inSeasonSum: number,
      currentScoreSum: number,
      currentSigmaSqSum: number,
      currentFloorContribSum: number,
      chosenMaxEff: number,
      chosenMaxSigma: number,
    ) => {
      const remainingNeed = 5 - chosen.length;
      if (remainingNeed === 0) {
        if (inSeasonSum < options.minInSeasonCards) return;

        // Validate cap rules
        if (starCap !== null && starSum > starCap) return;
        if (options.format === "daily_120_mvp") {
          if (strategy === "proj" && nonMvpL10Sum > 120) return;
          if (strategy !== "proj") {
            let maxIdx = 0;
            for (let k = 1; k < chosen.length; k += 1) {
              if (chosen[k].effectiveScore > chosen[maxIdx].effectiveScore) maxIdx = k;
            }
            let l10Sum = 0;
            for (let k = 0; k < chosen.length; k += 1) {
              if (k !== maxIdx) l10Sum += chosen[k].card.l10 ?? 0;
            }
            if (l10Sum > 120) return;
          }
        }

        if (strategy === "proj") {
          const approxTotal =
            Math.round(
              (currentScoreSum + chosenMaxEff * (captainBonusPct / 100)) * 10,
            ) / 10;
          if (approxTotal <= bestObjective) return;
        }

        const sig = chosen
          .map((c) => c.card.slug)
          .sort()
          .join("|");
        if (seenLineupSignatures.has(sig)) return;

        const built = assignSlotLabels(chosen, options.format, captainBonusPct);
        let objective = built.totalScore;
        if (strategy === "floor") {
          const sd = Math.sqrt(computeLineupVariance(built.slots, options.scheduleByTeam));
          objective = built.totalScore - Z90 * sd;
        } else if (strategy === "ceiling") {
          const sd = Math.sqrt(computeLineupVariance(built.slots, options.scheduleByTeam));
          objective = built.totalScore + Z90 * sd;
        }
        if (objective > bestObjective) {
          bestObjective = objective;
          bestCombo = [...chosen];
        }
        return;
      }

      if (startIdx + remainingNeed > n) return;
      // Mathematically sound, tight upper-bound pruning per strategy
      const suffixBase = startIdx * 6;
      const maxEffPotential = Math.max(chosenMaxEff, topEffSum[suffixBase + 1]);
      const capBonusUpper = maxEffPotential * (captainBonusPct / 100);
      const maxTotalScore =
        currentScoreSum + topEffSum[suffixBase + remainingNeed] + capBonusUpper + 0.05;

      if (strategy === "proj") {
        if (maxTotalScore <= bestObjective) return;
      } else if (strategy === "floor") {
        const linearFloorUpper =
          currentFloorContribSum +
          topFloorContribSum[suffixBase + remainingNeed] +
          capBonusUpper +
          0.05;
        const minVar =
          0.8 * (currentSigmaSqSum + bottomSigmaSqSum[suffixBase + remainingNeed]);
        const directFloorUpper = maxTotalScore - Z90 * Math.sqrt(minVar);
        if (Math.min(linearFloorUpper, directFloorUpper) <= bestObjective) return;
      } else {
        // strategy === "ceiling": variance <= 1.24 * sum(sigma_i^2) under SAME_GAME_RHO = 0.06
        let capSigmaSqExtra = 0;
        if (capBonusUpper > 0) {
          const maxSigmaPotential = Math.max(
            chosenMaxSigma,
            Math.sqrt(topSigmaSqSum[suffixBase + 1]),
          );
          capSigmaSqExtra =
            2 * maxSigmaPotential * capBonusUpper + capBonusUpper * capBonusUpper;
        }
        const maxVar =
          1.24 * (currentSigmaSqSum + topSigmaSqSum[suffixBase + remainingNeed] + capSigmaSqExtra);
        const optimisticCeil = maxTotalScore + Z90 * Math.sqrt(maxVar);
        if (optimisticCeil <= bestObjective) return;
      }

      for (let i = startIdx; i <= n - remainingNeed; i += 1) {
        const candidate = available[i];
        if (chosenPlayers.has(candidate.card.playerSlug)) continue;

        const teamSlug = candidate.card.teamSlug;
        if (maxPerTeam > 0 && teamSlug) {
          if ((teamCounts.get(teamSlug) ?? 0) >= maxPerTeam) continue;
        }

        const nextStarSum = starSum + candidate.card.starCost;
        if (starCap !== null && nextStarSum > starCap) {
          continue;
        }

        const nextNonMvpL10 =
          chosen.length === 0
            ? nonMvpL10Sum
            : nonMvpL10Sum + (candidate.card.l10 ?? 0);
        if (strategy === "proj" && options.format === "daily_120_mvp" && nextNonMvpL10 > 120) {
          continue;
        }

        const nextInSeason = inSeasonSum + (candidate.card.inSeasonEligible ? 1 : 0);
        if (nextInSeason + (remainingNeed - 1) < options.minInSeasonCards) {
          continue;
        }
        if (nextInSeason > inSeasonCapThisPass) continue;

        chosen.push(candidate);
        chosenPlayers.add(candidate.card.playerSlug);
        if (teamSlug) teamCounts.set(teamSlug, (teamCounts.get(teamSlug) ?? 0) + 1);
        dfs(
          i + 1,
          nextStarSum,
          nextNonMvpL10,
          nextInSeason,
          currentScoreSum + effVals[i],
          currentSigmaSqSum + sigmaSqVals[i],
          currentFloorContribSum + floorContribVals[i],
          Math.max(chosenMaxEff, effVals[i]),
          Math.max(chosenMaxSigma, sigmaVals[i]),
        );
        chosen.pop();
        chosenPlayers.delete(candidate.card.playerSlug);
        if (teamSlug) teamCounts.set(teamSlug, (teamCounts.get(teamSlug) ?? 1) - 1);
      }
    };

    dfs(0, 0, 0, 0, 0, 0, 0, 0, 0);

    if (!bestCombo) break;
    const pickedCombo = bestCombo as EvaluatedLineupCard[];

    const assigned = assignSlotLabels(
      pickedCombo,
      options.format,
      captainBonusPct,
    );

    // Correlation-aware spread: teammates and same-game opponents move together.
    const variance = computeLineupVariance(assigned.slots, options.scheduleByTeam);
    const stdDev = Math.sqrt(variance);

    const hasInjuryRisk = assigned.slots.some(
      (s) => s.evaluated.injuryStatus !== "ACTIVE",
    );

    const standing = benchmark
      ? estimateBenchmarkStanding(assigned.totalScore, benchmark)
      : null;

    const lineup: SuggestedLineup = {
      rank: pass + 1,
      format: options.format,
      slots: assigned.slots,
      totalScore: assigned.totalScore,
      totalStars: assigned.totalStars,
      capUsed: assigned.capUsed,
      capLimit,
      inSeasonCount: assigned.slots.filter(
        (s) => s.evaluated.card.inSeasonEligible,
      ).length,
      hasInjuryRisk,
      stdDev: Math.round(stdDev * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      odds: {
        essenceTarget: targets.essenceTarget,
        essencePct: Math.round(
          estimateWinProbability(
            assigned.totalScore,
            stdDev,
            targets.essenceTarget,
          ),
        ),
        tier1Target: targets.tier1Target,
        tier1Pct: Math.round(
          estimateWinProbability(
            assigned.totalScore,
            stdDev,
            targets.tier1Target,
          ),
        ),
        podiumTarget: targets.podiumTarget,
        podiumPct: Math.round(
          estimateWinProbability(
            assigned.totalScore,
            stdDev,
            targets.podiumTarget,
          ),
        ),
        paidLabel: benchmark
          ? benchmark.podSize
            ? `Pod Cash`
            : `Cash (${benchmark.rewardWinRatePct}%)`
          : undefined,
        tierLabel: benchmark
          ? benchmark.top5Score
            ? "Top 5%"
            : benchmark.podSize
              ? "Pod Top 2"
              : "Top 20%"
          : undefined,
        estRank: standing?.estRank,
        totalEntries: standing?.totalEntries,
        topPercentilePct: standing?.topPercentilePct,
        fieldPaidPct: benchmark?.rewardWinRatePct,
        benchmarkFixture: benchmark?.fixtureName,
      },
    };

    lineups.push(lineup);
    for (const s of assigned.slots) {
      usedCardSlugsGlobal.add(s.evaluated.card.slug);
    }
  }

  return { lineups, evaluatedPool };
}

export type ContestScope = "in_season" | "classic" | "arena";

export interface FormatRecommendationCandidate {
  format: LineupFormat;
  seasonScope: ContestScope;
  /** Short display label, e.g. "In-Season Contender 11★". */
  label: string;
  topScore: number | null;
  /** Probability (%) of clearing the field's reward cutoff (cash or Essence; XP-only ranks excluded). */
  cashProb: number;
  /** Probability (%) of finishing inside the real cash (USD) ranks; null when unknown. */
  moneyProb?: number | null;
  /** Ranks paid in cash and the best prize, live from Sorare. */
  cashPlaces?: number;
  topCashLabel?: string | null;
  rewardTiers?: LeaderboardBenchmark["rewardTiers"];
  /** Probability (%) of clearing the top-20% line. */
  top20Prob: number;
  /** Probability (%) of clearing the podium line. */
  podiumProb: number;
  /** Payout-curve weighted EV (see entryEvMath.ts); higher is better. */
  expectedValueScore: number;
  /** cashProb >= MIN_VIABLE_CASH_PCT and a legal 5-card lineup exists. */
  viable: boolean;
  /** Legacy aliases kept for existing UI. */
  essencePct: number;
  tier1Pct: number;
  podiumPct: number;
  compositeScore: number;
  fieldPaidPct?: number;
  paidCutoffScore?: number | null;
  estRank?: number;
  totalEntries?: number;
}

export interface FormatRecommendation {
  recommendedFormat: LineupFormat;
  reason: string;
  eliteCardCount: number;
  activePoolCount: number;
  recommendedScope?: ContestScope;
  fieldPaidPct?: number;
  paidCutoffScore?: number | null;
  totalEntries?: number;
  inSeasonVsClassicTip?: string | null;
  cashProb: number;
  top20Prob: number;
  podiumProb: number;
  expectedValueScore: number;
  viable: boolean;
  /** Ranked best-first: viable contests by EV, then the rest. */
  candidates: FormatRecommendationCandidate[];
}

/** Live Sorare NBA contests evaluated side by side (Daily Pickup 120+MVP was retired in Sorare 26). */
const RECOMMENDATION_CONTESTS: Array<{
  format: LineupFormat;
  scope: ContestScope;
  label: string;
  minInSeasonCards: number;
}> = [
  { format: "contender_11", scope: "in_season", label: "In-Season Contender 11★", minInSeasonCards: 4 },
  { format: "champion_16", scope: "in_season", label: "In-Season Champion 16★", minInSeasonCards: 4 },
  { format: "contender_11", scope: "classic", label: "Classic Contender 11★", minInSeasonCards: 0 },
  { format: "champion_16", scope: "classic", label: "Classic Champion 16★", minInSeasonCards: 0 },
  { format: "arena_contender_12", scope: "arena", label: "Arena Room Contender 11★", minInSeasonCards: 0 },
  { format: "arena_champion_15", scope: "arena", label: "Arena Room Champion 16★", minInSeasonCards: 0 },
];

/**
 * Recommends the Sorare NBA contest with the best field-calibrated expected value for the
 * user's card pool, using live closed-GW leaderboard benchmarks. Contests whose cash odds
 * are below MIN_VIABLE_CASH_PCT are never recommended over a viable one.
 */
export function recommendBestFormat(
  cards: GalleryCard[],
  options: Omit<AutoBuildOptions, "format" | "maxLineups">,
): FormatRecommendation {
  let eliteCardCount = 0;
  let activePoolCount = 0;

  const candidates: FormatRecommendationCandidate[] = RECOMMENDATION_CONTESTS.map((contest) => {
    const res = generateTopLineups(cards, {
      ...options,
      format: contest.format,
      maxLineups: 1,
      inSeasonOnly: contest.scope === "in_season" ? options.inSeasonOnly : false,
      minInSeasonCards: contest.minInSeasonCards,
      benchmarkSeasonScope: contest.scope,
    });
    if (contest.format === "contender_11" && contest.scope === "classic") {
      activePoolCount = res.evaluatedPool.length;
      eliteCardCount = res.evaluatedPool.filter((ev) => ev.card.starCost >= 4).length;
    }
    const top = res.lineups[0] ?? null;
    const bm = findBenchmarkForFormat(
      options.benchmarks,
      contest.format,
      contest.scope,
      options.ageFilter ?? "all",
    );
    const targets = LINEUP_FORMAT_TARGETS[contest.format];
    const thresholds = buildContestThresholds({
      paidCutoffScore: bm?.paidCutoffScore,
      top20Score: bm?.top20Score,
      podiumScore: bm?.podiumScore,
      top1Score: bm?.top1Score,
      fallbackCash: targets.essenceTarget,
      fallbackTop20: targets.tier1Target,
      fallbackPodium: targets.podiumTarget,
    });
    const sd = top
      ? lineupStdDev(
          top.slots.map((s) => ({
            projectedScore: s.slotScore,
            teamSlug: s.evaluated.card.teamSlug,
          })),
        )
      : 0;
    const ev = evaluateContestEv(top ? top.totalScore : null, sd, thresholds);
    const viable = ev.viable && top !== null && top.slots.length === 5;
    const cashCut = bm?.cashCutoffScore;
    const moneyProb =
      top && typeof cashCut === "number" && Number.isFinite(cashCut) && cashCut > 0
        ? Math.round(Math.min(ev.cashProb, probabilityAtLeast(top.totalScore, sd, cashCut)) * 10) / 10
        : null;
    return {
      format: contest.format,
      seasonScope: contest.scope,
      label: contest.label,
      topScore: top?.totalScore ?? null,
      cashProb: ev.cashProb,
      top20Prob: ev.top20Prob,
      podiumProb: ev.podiumProb,
      moneyProb,
      cashPlaces: bm?.cashPlaces,
      topCashLabel: bm?.topCashLabel ?? null,
      rewardTiers: bm?.rewardTiers,
      expectedValueScore: ev.expectedValueScore,
      viable,
      essencePct: ev.cashProb,
      tier1Pct: ev.top20Prob,
      podiumPct: ev.podiumProb,
      compositeScore: ev.expectedValueScore,
      fieldPaidPct: bm?.rewardWinRatePct ?? top?.odds.fieldPaidPct,
      paidCutoffScore: thresholds.cashScore,
      estRank: top?.odds.estRank,
      totalEntries: bm?.podSize ?? bm?.totalEntries ?? top?.odds.totalEntries,
    };
  });

  const ranked = [...candidates].sort((a, b) => {
    if (a.viable !== b.viable) return a.viable ? -1 : 1;
    if (b.expectedValueScore !== a.expectedValueScore) {
      return b.expectedValueScore - a.expectedValueScore;
    }
    // Tie-break toward the lower cap (cheaper cards, softer field).
    return (getFormatStarCap(a.format) ?? 99) - (getFormatStarCap(b.format) ?? 99);
  });
  const best = ranked[0];

  let inSeasonVsClassicTip: string | null = null;
  const inSeasonContender = candidates.find(
    (c) => c.format === "contender_11" && c.seasonScope === "in_season",
  );
  const classicContender = candidates.find(
    (c) => c.format === "contender_11" && c.seasonScope === "classic",
  );
  if (
    inSeasonContender &&
    classicContender &&
    inSeasonContender.viable &&
    inSeasonContender.cashProb > classicContender.cashProb + 10
  ) {
    inSeasonVsClassicTip = `Field Tip: In-Season Contender pays ${inSeasonContender.fieldPaidPct ?? "?"}% of the field (cut ~${Math.round(inSeasonContender.paidCutoffScore ?? 0)}) vs Classic ${classicContender.fieldPaidPct ?? "?"}% (cut ~${Math.round(classicContender.paidCutoffScore ?? 0)}): ${inSeasonContender.cashProb}% vs ${classicContender.cashProb}% reward odds for your best lineup.`;
  }

  const alternatives = ranked
    .slice(1, 3)
    .map((c) => `${c.label} ${c.cashProb}% reward`)
    .join(" • ");
  const reason = best.viable
    ? `${best.label} projects ${best.topScore?.toFixed(1) ?? "--"} pts: ${best.cashProb}% odds of a reward (Essence or cash, cut ~${Math.round(best.paidCutoffScore ?? 0)})${
        best.moneyProb !== null && best.moneyProb !== undefined
          ? `, ${best.moneyProb}% odds of cash (top ${best.cashPlaces ?? "?"}${best.topCashLabel ? `, up to ${best.topCashLabel}` : ""})`
          : ""
      }, ${best.podiumProb}% podium. Next: ${alternatives}.`
    : `No contest gives at least ${MIN_VIABLE_CASH_PCT}% reward odds with your current cards. Closest: ${best.label} (${best.cashProb}% reward, ${best.topScore?.toFixed(1) ?? "--"} pts).`;

  return {
    recommendedFormat: best.format,
    reason,
    eliteCardCount,
    activePoolCount,
    recommendedScope: best.seasonScope,
    fieldPaidPct: best.fieldPaidPct,
    paidCutoffScore: best.paidCutoffScore,
    totalEntries: best.totalEntries,
    inSeasonVsClassicTip,
    cashProb: best.cashProb,
    top20Prob: best.top20Prob,
    podiumProb: best.podiumProb,
    expectedValueScore: best.expectedValueScore,
    viable: best.viable,
    candidates: ranked,
  };
}

export interface LineupSwapSuggestion {
  outPlayer: string;
  inPlayer: string;
  deltaPts: number;
  /** "upgrade" gains points within the cap; "cap_fix" gives up points to get under the star cap. */
  kind: "upgrade" | "cap_fix";
  /** Plain-language explanation shown in the swap's info tooltip. */
  reason: string;
  /** The incoming player already sits in another synced lineup this Game Week. */
  usedInOtherLineup: boolean;
}

function formatPts(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function formatStars(n: number): string {
  return `${Math.round(n * 10) / 10}★`;
}

/**
 * Turns raw "current vs optimal" card differences into explained suggestions.
 * Downgrades are only kept when the lineup is over the star cap (by this extension's
 * star ratings), and are labelled as cap fixes; otherwise only real upgrades remain.
 */
export function explainLineupSwaps(
  pairs: Array<{ out: EvaluatedLineupCard; in: EvaluatedLineupCard }>,
  context: {
    currentStars: number;
    starCap: number | null;
    usedElsewhere: Set<string>;
  },
): LineupSwapSuggestion[] {
  const overCap =
    context.starCap !== null && context.currentStars > context.starCap + 1e-9;
  const result: LineupSwapSuggestion[] = [];
  let runningStars = context.currentStars;
  for (const pair of pairs) {
    const delta = Math.round((pair.in.effectiveScore - pair.out.effectiveScore) * 10) / 10;
    const starChange = pair.in.card.starCost - pair.out.card.starCost;
    const usedInOtherLineup = context.usedElsewhere.has(
      normalizePlayerNameKey(pair.in.card.playerName),
    );
    const usedNote = usedInOtherLineup
      ? ` Note: ${pair.in.card.playerName} is already in another of your lineups this Game Week.`
      : "";
    const projection = `${pair.in.card.playerName} projects ${formatPts(pair.in.effectiveScore)} pts (${formatStars(pair.in.card.starCost)}) vs ${pair.out.card.playerName} ${formatPts(pair.out.effectiveScore)} pts (${formatStars(pair.out.card.starCost)}).`;
    if (delta > 0) {
      runningStars += starChange;
      const capNote =
        context.starCap !== null
          ? ` Lineup stays at ${formatStars(runningStars)} of the ${context.starCap}★ cap.`
          : "";
      result.push({
        outPlayer: pair.out.card.playerName,
        inPlayer: pair.in.card.playerName,
        deltaPts: delta,
        kind: "upgrade",
        reason: `Upgrade: ${projection}${capNote}${usedNote}`,
        usedInOtherLineup,
      });
    } else if (overCap && starChange < 0) {
      runningStars += starChange;
      result.push({
        outPlayer: pair.out.card.playerName,
        inPlayer: pair.in.card.playerName,
        deltaPts: delta,
        kind: "cap_fix",
        reason: `Cap fix: by this extension's star ratings your lineup is ${formatStars(context.currentStars)}, over the ${context.starCap}★ cap. This swap frees ${formatStars(-starChange)} for ${formatPts(-delta)} fewer projected pts. ${projection} If Sorare accepted your lineup, its live star ratings differ from ours and you can ignore this.${usedNote}`,
        usedInOtherLineup,
      });
    }
  }
  return result;
}

function normalizePlayerNameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface CurrentLineupComparison {
  entry: CurrentLineupEntry;
  inferredFormat: LineupFormat;
  currentProjected: number;
  currentStars: number;
  optimalProjected: number | null;
  potentialGain: number;
  /** Star cap of the inferred format (null = uncapped). */
  starCap?: number | null;
  /** Current lineup exceeds the cap by this extension's star ratings. */
  currentOverCap?: boolean;
  swaps: LineupSwapSuggestion[];
  betterCaptainName: string | null;
  resolvedCardSlugs?: string[];
  paidCutoffScore?: number | null;
  estRank?: number;
  estTotalEntries?: number;
  rewardWinRatePct?: number;
  /** Cards of the synced lineup matched to the gallery (0-5). */
  resolvedCardCount?: number;
  expectedCardCount?: number;
  /** Why fewer than 5 cards resolved; undefined when all 5 matched. */
  unresolvedReason?: string;
  editFocusPoints?: EditFocusPoint[];
  overlaySummary?: LineupOverlaySummary;
}

const SUFFIX_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv"]);

function matchCardByNameHint(
  hint: string,
  evalList: EvaluatedLineupCard[],
  usedSlugs: Set<string>,
): EvaluatedLineupCard | undefined {
  const normHint = normalizePlayerName(hint);
  if (!normHint) return undefined;

  const exact = evalList.find(
    (ev) => !usedSlugs.has(ev.card.slug) && normalizePlayerName(ev.card.playerName) === normHint,
  );
  if (exact) return exact;

  const hintParts = normHint.split(" ").filter(Boolean);
  if (hintParts.length < 2) return undefined;
  const firstToken = hintParts[0];
  const hintCoreSurname =
    SUFFIX_TOKENS.has(hintParts[hintParts.length - 1]) && hintParts.length >= 3
      ? hintParts[hintParts.length - 2]
      : hintParts[hintParts.length - 1];

  return evalList.find((ev) => {
    if (usedSlugs.has(ev.card.slug)) return false;
    const cardNorm = normalizePlayerName(ev.card.playerName);
    const cardParts = cardNorm.split(" ").filter(Boolean);
    if (cardParts.length < 2) return false;
    const firstMatches =
      firstToken.length === 1
        ? cardParts[0].startsWith(firstToken)
        : cardParts[0] === firstToken || cardParts[0].startsWith(firstToken);
    if (!firstMatches) return false;
    return cardParts.some((p) => p === hintCoreSurname);
  });
}

export function inferFormatFromLeaderboard(label: string): LineupFormat {
  const lower = label.toLowerCase();
  if (lower.includes("arena") && lower.includes("uncapped")) return "uncapped";
  if (
    lower.includes("arena") &&
    (lower.includes("contender") || lower.includes("arena_75") || lower.includes("u23"))
  ) {
    return "arena_contender_12";
  }
  if (
    lower.includes("arena") &&
    (lower.includes("champion") || lower.includes("arena_140") || lower.includes("veteran"))
  ) {
    return "arena_champion_15";
  }
  if (lower.includes("contender")) return "contender_11";
  if (lower.includes("daily") || lower.includes("pickup") || lower.includes("120")) {
    return "daily_120_mvp";
  }
  if (lower.includes("uncapped") || lower.includes("no cap")) return "uncapped";
  return "champion_16";
}

/**
 * Compares the user's open/submitted Sorare NBA lineups against the optimizer's best
 * legal 5-card combination for the same format to surface concrete swap upgrades.
 */
export function compareCurrentVsOptimalLineups(
  currentLineups: CurrentLineupEntry[],
  cards: GalleryCard[],
  options: Omit<AutoBuildOptions, "format" | "maxLineups">,
): CurrentLineupComparison[] {
  if (currentLineups.length === 0 || cards.length === 0) return [];
  const customMap = parseCustomProjections(options.customProjectionsRaw);
  const captainBonusPct = options.captainBonusPct ?? 0;

  const evalBySlug = new Map<string, EvaluatedLineupCard>();
  const evalList: EvaluatedLineupCard[] = [];
  for (const c of cards) {
    const ev = evaluateCardForLineup(
      c,
      options.projectionSource,
      customMap,
      options.injuriesByName,
      options.gamesPerTeam,
      options.scheduleByTeam,
    );
    evalBySlug.set(c.slug, ev);
    evalList.push(ev);
  }

  const ownedPlayerSlugs = new Set(cards.map((c) => c.playerSlug));

  return currentLineups.map((entry) => {
    const inferredFormat = inferFormatFromLeaderboard(
      `${entry.leaderboardName} ${entry.leaderboardSlug} ${entry.name}`,
    );
    const currentEvaluated: EvaluatedLineupCard[] = [];
    const matchedSlugs = new Set<string>();
    for (const s of entry.cardSlugs) {
      const hit = evalBySlug.get(s);
      if (hit && !matchedSlugs.has(hit.card.slug)) {
        matchedSlugs.add(hit.card.slug);
        currentEvaluated.push(hit);
      }
    }
    for (const nameHint of entry.playerNames ?? []) {
      if (currentEvaluated.length >= 5) break;
      const hit = matchCardByNameHint(nameHint, evalList, matchedSlugs);
      if (hit) {
        matchedSlugs.add(hit.card.slug);
        currentEvaluated.push(hit);
      }
    }

    const lowerLb = `${entry.leaderboardName} ${entry.leaderboardSlug}`.toLowerCase();
    const entryScope: "in_season" | "classic" | "arena" = lowerLb.includes("arena")
      ? "arena"
      : lowerLb.includes("classic")
        ? "classic"
        : lowerLb.includes("in-season") || lowerLb.includes("in_season")
          ? "in_season"
          : options.minInSeasonCards >= 4
            ? "in_season"
            : "classic";
    const entryBm = findBenchmarkForFormat(
      options.benchmarks,
      inferredFormat,
      entryScope,
      lowerLb.includes("u23") ? "u23" : lowerLb.includes("veteran") ? "veterans" : "all",
    );

    let currentProjected = 0;
    let currentStars = 0;
    let bestCurrentNonCap: EvaluatedLineupCard | null = null;
    let currentCaptainEv: EvaluatedLineupCard | null = null;

    for (const ev of currentEvaluated) {
      const isCap = entry.captainCardSlug === ev.card.slug;
      const mult = isCap ? 1 + captainBonusPct / 100 : 1;
      currentProjected += ev.effectiveScore * mult;
      currentStars += ev.card.starCost;
      if (isCap) {
        currentCaptainEv = ev;
      } else if (
        !bestCurrentNonCap ||
        ev.effectiveScore > bestCurrentNonCap.effectiveScore
      ) {
        bestCurrentNonCap = ev;
      }
    }

    const betterCaptainName =
      (inferredFormat === "daily_120_mvp" || captainBonusPct > 0) &&
      currentCaptainEv &&
      bestCurrentNonCap &&
      bestCurrentNonCap.effectiveScore > currentCaptainEv.effectiveScore + 1.5
        ? bestCurrentNonCap.card.playerName
        : null;

    const optimal = generateTopLineups(cards, {
      ...options,
      format: inferredFormat,
      maxLineups: 1,
    }).lineups[0];

    const unresolvedReason = buildUnresolvedReason(entry, currentEvaluated.length);
    const roundedForOverlay = Math.round(currentProjected * 10) / 10;
    const overlaySummary = buildLineupOverlay(currentEvaluated, roundedForOverlay, options.scheduleByTeam);
    const syncFields = {
      resolvedCardCount: currentEvaluated.length,
      expectedCardCount: LINEUP_SIZE,
      unresolvedReason,
      overlaySummary,
    };
    const focusFor = (swaps: LineupSwapSuggestion[]): EditFocusPoint[] =>
      buildEditFocusPoints({
        evaluated: currentEvaluated,
        swaps,
        unresolvedReason,
        currentStars,
        starCap: getFormatStarCap(inferredFormat),
        scheduleByTeam: options.scheduleByTeam,
        marketListings: options.marketListings,
        ownedPlayerSlugs,
        projectionSource: options.projectionSource,
        customProjectionsRaw: options.customProjectionsRaw,
        injuriesByName: options.injuriesByName,
        gamesPerTeam: options.gamesPerTeam,
        minInSeasonCards: entryScope === "in_season" ? Math.max(4, options.minInSeasonCards) : 0,
        maxPerTeam: options.maxPerTeam,
        excludeOut: options.excludeOut,
        excludeQuestionable: options.excludeQuestionable,
      });

    const roundedCurrent = Math.round(currentProjected * 10) / 10;
    const standing = entryBm
      ? estimateBenchmarkStanding(roundedCurrent, entryBm)
      : null;

    if (!optimal) {
      return {
        entry,
        inferredFormat,
        currentProjected: roundedCurrent,
        currentStars: Math.round(currentStars * 10) / 10,
        optimalProjected: null,
        potentialGain: 0,
        swaps: [],
        betterCaptainName,
        resolvedCardSlugs: Array.from(matchedSlugs),
        paidCutoffScore: entryBm?.paidCutoffScore ?? null,
        estRank: standing?.estRank,
        estTotalEntries: standing?.totalEntries,
        rewardWinRatePct: entryBm?.rewardWinRatePct,
        ...syncFields,
        editFocusPoints: focusFor([]),
      };
    }

    const currentSlugSet = matchedSlugs;
    const optSlugSet = new Set(optimal.slots.map((s) => s.evaluated.card.slug));

    const toRemove = currentEvaluated
      .filter((ev) => !optSlugSet.has(ev.card.slug))
      .sort((a, b) => a.effectiveScore - b.effectiveScore);
    const toAdd = optimal.slots
      .map((s) => s.evaluated)
      .filter((ev) => !currentSlugSet.has(ev.card.slug))
      .sort((a, b) => b.effectiveScore - a.effectiveScore);

    const pairCount = Math.min(toRemove.length, toAdd.length);
    const pairs: Array<{ out: EvaluatedLineupCard; in: EvaluatedLineupCard }> = [];
    for (let i = 0; i < pairCount; i += 1) {
      pairs.push({ out: toRemove[i], in: toAdd[i] });
    }
    const usedElsewhere = new Set<string>();
    for (const other of currentLineups) {
      if (other === entry) continue;
      for (const n of other.playerNames ?? []) usedElsewhere.add(normalizePlayerNameKey(n));
    }
    const starCap = getFormatStarCap(inferredFormat);
    const swaps = explainLineupSwaps(pairs, {
      currentStars,
      starCap,
      usedElsewhere,
    });

    return {
      entry,
      inferredFormat,
      currentProjected: roundedCurrent,
      currentStars: Math.round(currentStars * 10) / 10,
      optimalProjected: optimal.totalScore,
      potentialGain:
        Math.round(Math.max(0, optimal.totalScore - currentProjected) * 10) / 10,
      swaps,
      starCap,
      currentOverCap: starCap !== null && currentStars > starCap + 1e-9,
      betterCaptainName,
      resolvedCardSlugs: Array.from(matchedSlugs),
      paidCutoffScore: entryBm?.paidCutoffScore ?? null,
      estRank: standing?.estRank,
      estTotalEntries: standing?.totalEntries,
      rewardWinRatePct: entryBm?.rewardWinRatePct,
      ...syncFields,
      editFocusPoints: focusFor(swaps),
    };
  });
}

export interface BudgetLineupSlotMeta {
  costCents: number;
  isOwned: boolean;
  isPrimaryOffer: boolean;
  saleType: "owned" | "instant_buy" | "auction";
  marketUrl: string;
}

export interface BudgetLineupPick extends SuggestedLineup {
  totalCostCents: number;
  remainingBudgetCents: number;
  marketBuysCount: number;
  slotCostBySlug: Record<string, BudgetLineupSlotMeta>;
}

export interface BudgetBuildOptions {
  format: LineupFormat;
  rarityFilter: CardRarity | "ALL";
  projectionSource: ProjectionSource;
  customProjectionsRaw: string;
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  scheduleByTeam?: Record<string, TeamSlateSchedule>;
  maxPerTeam?: number | null;
  budgetCents: number;
  includeOwned: boolean;
  inSeasonOnly: boolean;
  minInSeasonCards?: number;
  captainBonusPct?: number;
}

/**
 * Builds up to 2 optimal hybrid lineups (owned cards at €0 + live market deals within budget)
 * respecting both competition star/L10 caps and cash budget.
 */
export function buildBudgetLineups(
  ownedCards: GalleryCard[],
  marketListings: BargainListing[],
  options: BudgetBuildOptions,
): BudgetLineupPick[] {
  const customMap = parseCustomProjections(options.customProjectionsRaw);
  const captainBonusPct = options.captainBonusPct ?? 0;
  const targets = LINEUP_FORMAT_TARGETS[options.format];
  const minInSeason = options.minInSeasonCards ?? (options.inSeasonOnly ? 5 : 0);

  const slotCostBySlug: Record<string, BudgetLineupSlotMeta> = {};
  const candidateCards: GalleryCard[] = [];
  const seenPlayerCost = new Map<string, number>();

  if (options.includeOwned) {
    for (const c of ownedCards) {
      if (options.rarityFilter !== "ALL" && c.rarity !== options.rarityFilter) {
        continue;
      }
      if (minInSeason >= 5 && !c.inSeasonEligible) continue;
      if (c.sealed) continue;
      if (seenPlayerCost.has(c.playerSlug)) continue;
      seenPlayerCost.set(c.playerSlug, 0);
      slotCostBySlug[c.slug] = {
        costCents: 0,
        isOwned: true,
        isPrimaryOffer: Boolean(c.isFirstOwner),
        saleType: "owned",
        marketUrl: `https://sorare.com/nba/cards/${c.slug}`,
      };
      candidateCards.push(c);
    }
  }

  const affordableMarket = [...marketListings]
    .filter((m) => {
      if (m.priceCents === null || m.priceCents > options.budgetCents) {
        return false;
      }
      if (options.rarityFilter !== "ALL" && m.rarity !== options.rarityFilter) {
        return false;
      }
      if (minInSeason >= 5 && !m.inSeasonEligible) return false;
      return true;
    })
    .sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));

  for (const m of affordableMarket) {
    if (m.priceCents === null) continue;
    const prevCost = seenPlayerCost.get(m.playerSlug);
    if (prevCost !== undefined && prevCost <= m.priceCents) continue;
    seenPlayerCost.set(m.playerSlug, m.priceCents);

    const syntheticCard: GalleryCard = {
      slug: m.cardSlug,
      rarity: m.rarity,
      seasonYear: m.seasonYear,
      inSeasonEligible: m.inSeasonEligible,
      grade: 1,
      powerMultiplier: m.inSeasonEligible ? 1.05 : 1.0,
      pictureUrl: m.pictureUrl ?? null,
      isFirstOwner: Boolean(m.isFirstOwnerEligible || m.isPrimaryOffer),
      teamName: m.teamName,
      teamSlug: m.teamSlug ?? null,
      playerSlug: m.playerSlug,
      playerName: m.playerName,
      positions: m.positions,
      l10: m.l10,
      l5: m.l5,
      sorareClassicProjected: m.projected,
      sorareDailyProjected: null,
      starCost: m.starCost,
    };

    slotCostBySlug[m.cardSlug] = {
      costCents: m.priceCents,
      isOwned: false,
      isPrimaryOffer: Boolean(m.isPrimaryOffer),
      saleType: m.saleType,
      marketUrl: m.marketUrl,
    };
    candidateCards.push(syntheticCard);
  }

  const evaluated = candidateCards
    .map((card) =>
      evaluateCardForLineup(
        card,
        options.projectionSource,
        customMap,
        options.injuriesByName,
        options.gamesPerTeam,
        options.scheduleByTeam,
      ),
    )
    .filter((ev) => ev.injuryStatus !== "OUT" && ev.effectiveScore > 0)
    .sort((a, b) => b.effectiveScore - a.effectiveScore);

  const head = evaluated.slice(0, 32);
  const headSlugs = new Set(head.map((e) => e.card.slug));
  const cheapEnablers = evaluated
    .filter(
      (e) =>
        !headSlugs.has(e.card.slug) &&
        ((minInSeason > 0 && e.card.inSeasonEligible) ||
          e.card.starCost <= 2 ||
          (slotCostBySlug[e.card.slug]?.costCents ?? 999999) <= 250),
    )
    .slice(0, 12);
  const pool = [...head, ...cheapEnablers];

  const starCap = getFormatStarCap(options.format);
  const capLimit =
    starCap !== null ? starCap : options.format === "daily_120_mvp" ? 120 : null;
  const maxPerTeam =
    options.maxPerTeam === undefined ? DEFAULT_MAX_PER_TEAM : (options.maxPerTeam ?? 0);

  const picks: BudgetLineupPick[] = [];
  const usedSignatures = new Set<string>();

  for (let pass = 0; pass < 2; pass += 1) {
    if (pool.length < 5) break;
    let bestScore = -1;
    let bestCombo: EvaluatedLineupCard[] | null = null;
    const chosen: EvaluatedLineupCard[] = [];
    const usedPlayers = new Set<string>();
    const teamCounts = new Map<string, number>();

    const dfs = (
      startIdx: number,
      starSum: number,
      nonMvpL10: number,
      costSum: number,
      inSeasonSum: number,
      rawScoreSum: number,
    ) => {
      if (chosen.length === 5) {
        if (inSeasonSum < minInSeason) return;
        const sig = chosen
          .map((c) => c.card.slug)
          .sort()
          .join("|");
        if (usedSignatures.has(sig)) return;
        const maxEff = Math.max(...chosen.map((c) => c.effectiveScore));
        const total = rawScoreSum + maxEff * (captainBonusPct / 100);
        if (total > bestScore) {
          bestScore = total;
          bestCombo = [...chosen];
        }
        return;
      }

      const rem = 5 - chosen.length;
      if (pool.length - startIdx < rem) return;
      if (inSeasonSum + rem < minInSeason) return;

      let optimistic = rawScoreSum;
      let taken = 0;
      let optMax = 0;
      for (const item of chosen) {
        if (item.effectiveScore > optMax) optMax = item.effectiveScore;
      }
      for (let k = startIdx; k < pool.length && taken < rem; k += 1) {
        const item = pool[k];
        if (usedPlayers.has(item.card.playerSlug)) continue;
        optimistic += item.effectiveScore;
        if (item.effectiveScore > optMax) optMax = item.effectiveScore;
        taken += 1;
      }
      if (taken < rem) return;
      if (optimistic + optMax * (captainBonusPct / 100) <= bestScore) return;

      for (let i = startIdx; i <= pool.length - rem; i += 1) {
        const cand = pool[i];
        if (usedPlayers.has(cand.card.playerSlug)) continue;

        const teamSlug = cand.card.teamSlug;
        if (maxPerTeam > 0 && teamSlug && (teamCounts.get(teamSlug) ?? 0) >= maxPerTeam) {
          continue;
        }

        const candCost = slotCostBySlug[cand.card.slug]?.costCents ?? 0;
        if (costSum + candCost > options.budgetCents) continue;

        const nextStar = starSum + cand.card.starCost;
        if (starCap !== null && nextStar > starCap) {
          continue;
        }

        const nextL10 =
          options.format === "daily_120_mvp" && chosen.length > 0
            ? nonMvpL10 + (cand.card.l10 ?? 0)
            : nonMvpL10;
        if (options.format === "daily_120_mvp" && nextL10 > 120) continue;

        chosen.push(cand);
        usedPlayers.add(cand.card.playerSlug);
        if (teamSlug) teamCounts.set(teamSlug, (teamCounts.get(teamSlug) ?? 0) + 1);
        dfs(
          i + 1,
          nextStar,
          nextL10,
          costSum + candCost,
          inSeasonSum + (cand.card.inSeasonEligible ? 1 : 0),
          rawScoreSum + cand.effectiveScore,
        );
        chosen.pop();
        usedPlayers.delete(cand.card.playerSlug);
        if (teamSlug) teamCounts.set(teamSlug, (teamCounts.get(teamSlug) ?? 1) - 1);
      }
    };

    dfs(0, 0, 0, 0, 0, 0);
    if (!bestCombo) break;
    const picked = bestCombo as EvaluatedLineupCard[];
    const sig = picked
      .map((c) => c.card.slug)
      .sort()
      .join("|");
    usedSignatures.add(sig);

    const assigned = assignSlotLabels(picked, options.format, captainBonusPct);
    let totalCostCents = 0;
    let marketBuysCount = 0;
    const pickedMeta: Record<string, BudgetLineupSlotMeta> = {};

    for (const s of assigned.slots) {
      const meta = slotCostBySlug[s.evaluated.card.slug];
      if (meta) {
        pickedMeta[s.evaluated.card.slug] = meta;
        totalCostCents += meta.costCents;
        if (!meta.isOwned) marketBuysCount += 1;
      }
    }

    const variance = computeLineupVariance(assigned.slots, options.scheduleByTeam);
    const stdDev = Math.sqrt(variance);

    picks.push({
      rank: pass + 1,
      format: options.format,
      slots: assigned.slots,
      totalScore: assigned.totalScore,
      totalStars: assigned.totalStars,
      capUsed: assigned.capUsed,
      capLimit,
      inSeasonCount: assigned.slots.filter(
        (s) => s.evaluated.card.inSeasonEligible,
      ).length,
      hasInjuryRisk: assigned.slots.some(
        (s) => s.evaluated.injuryStatus !== "ACTIVE",
      ),
      stdDev: Math.round(stdDev * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      odds: {
        essenceTarget: targets.essenceTarget,
        essencePct: Math.round(
          estimateWinProbability(
            assigned.totalScore,
            stdDev,
            targets.essenceTarget,
          ),
        ),
        tier1Target: targets.tier1Target,
        tier1Pct: Math.round(
          estimateWinProbability(
            assigned.totalScore,
            stdDev,
            targets.tier1Target,
          ),
        ),
        podiumTarget: targets.podiumTarget,
        podiumPct: Math.round(
          estimateWinProbability(
            assigned.totalScore,
            stdDev,
            targets.podiumTarget,
          ),
        ),
      },
      totalCostCents,
      remainingBudgetCents: Math.max(0, options.budgetCents - totalCostCents),
      marketBuysCount,
      slotCostBySlug: pickedMeta,
    });
  }

  return picks;
}

export interface VaultVsSellAdvice {
  action: "SEAL_VAULT" | "SELL_CASH" | "HOLD_DEPTH";
  vaultPoints: number;
  label: string;
  reason: string;
}

/** Cards below this L10 are bench depth; at or above it they still help Classic lineups. */
export const VAULT_BENCH_L10 = 18;

/** Minimum Instant Buy floor (cents) by rarity where selling beats sealing a bench card. */
export const VAULT_SELL_FLOOR_CENTS_BY_RARITY: Record<CardRarity, number> = {
  common: 250,
  limited: 250,
  rare: 1500,
  super_rare: 6000,
  unique: 25000,
};

export interface VaultAdviceContext {
  /** Card sits in an open / synced lineup (sealing would cancel it). */
  locked?: boolean;
  /** A better copy of the same player in the same scarcity is kept playable. */
  duplicate?: boolean;
}

/**
 * Seal vs sell vs keep for one card. Seals only spare duplicates and bench-level cards;
 * lineup players (in a lineup, In-Season, or L10 >= VAULT_BENCH_L10) are kept.
 */
export function evaluateVaultVsSellRoi(
  card: GalleryCard,
  context: VaultAdviceContext = {},
): VaultVsSellAdvice {
  // Sealing Points tier estimate (1/2/5/20/50/200); Sorare shows the exact value before sealing.
  const vaultPoints = estimateSealingPoints(card).sealingPoints;

  if (card.sealed) {
    return {
      action: "HOLD_DEPTH",
      vaultPoints,
      label: "🔒 Sealed",
      reason: "Already sealed in your Vault: not sellable or playable until unsealed (max 1 unseal per scarcity / 14 days).",
    };
  }

  const locked = context.locked === true || (card.openedLineupIds?.length ?? 0) > 0;
  if (locked || card.inSeasonEligible) {
    return {
      action: "HOLD_DEPTH",
      vaultPoints,
      label: "Active Roster",
      reason: locked
        ? "In one of your open lineups: keep it (sealing would cancel that lineup)."
        : "In-Season card eligible for In-Season competitions.",
    };
  }

  const l10 = card.l10 ?? 0;
  const askCents = card.lowestAskCents ?? 0;
  const sellFloorThresholdCents = VAULT_SELL_FLOOR_CENTS_BY_RARITY[card.rarity] ?? 250;
  if (askCents >= sellFloorThresholdCents && l10 < 28 && !context.duplicate) {
    return {
      action: "SELL_CASH",
      vaultPoints,
      label: "💶 Sell > Seal",
      reason: `Floor ${(askCents / 100).toFixed(2)} is worth more than +${vaultPoints} VP in the Vault.`,
    };
  }

  if (context.duplicate || l10 < VAULT_BENCH_L10) {
    return {
      action: "SEAL_VAULT",
      vaultPoints,
      label: `🔒 Seal (+${vaultPoints} VP)`,
      reason: context.duplicate
        ? "Spare copy: a better copy of this player stays playable."
        : `Bench-level card (L10 ${l10.toFixed(1)}): more useful as Vault points.`,
    };
  }

  return {
    action: "HOLD_DEPTH",
    vaultPoints,
    label: `+${vaultPoints} VP`,
    reason: `Lineup-useful (L10 ${l10.toFixed(1)}): keep for Classic lineups.`,
  };
}

export interface PortfolioSlateResult {
  lineups: SuggestedLineup[];
  totalProjectedPts: number;
  combinedEssenceScore: number;
  atLeastOneEssencePct: number;
  cardsUsedCount: number;
}

function permuteFormats(formats: LineupFormat[]): LineupFormat[][] {
  if (formats.length <= 1) return [formats];
  const out: LineupFormat[][] = [];
  for (let i = 0; i < formats.length; i += 1) {
    const rest = formats.filter((_, idx) => idx !== i);
    for (const sub of permuteFormats(rest)) {
      out.push([formats[i], ...sub]);
    }
  }
  return out;
}

/**
 * Jointly optimizes across multiple Sorare NBA competitions with zero overlapping cards
 * to maximize total combined Essence winning odds across the Gameweek slate.
 */
export function optimizeMultiCompetitionPortfolio(
  cards: GalleryCard[],
  options: Omit<
    AutoBuildOptions,
    "format" | "maxLineups" | "disjointAcrossLineups"
  >,
  formats: LineupFormat[] = [
    "champion_16",
    "contender_11",
    "arena_contender_12",
  ],
): PortfolioSlateResult {
  const uniqueFormats = formats.slice(0, 4);
  const orders = permuteFormats(uniqueFormats);

  let bestCombinedScore = -1;
  let bestMap = new Map<LineupFormat, SuggestedLineup>();

  for (const order of orders) {
    let remaining = [...cards];
    const chosenMap = new Map<LineupFormat, SuggestedLineup>();
    let combinedScore = 0;

    for (const fmt of order) {
      const built = generateTopLineups(remaining, {
        ...options,
        format: fmt,
        maxLineups: 1,
        disjointAcrossLineups: true,
      }).lineups[0];

      if (!built) continue;
      chosenMap.set(fmt, built);
      combinedScore += built.odds.essencePct * 1.5 + built.totalScore * 0.2;

      // Sorare (user-confirmed 2026-11-19): a card can't sit in two lineups of the same GW,
      // but a different card of the same player can go in another lineup.
      const usedCards = new Set(built.slots.map((s) => s.evaluated.card.slug));
      remaining = remaining.filter((c) => !usedCards.has(c.slug));
    }

    if (
      chosenMap.size > bestMap.size ||
      (chosenMap.size === bestMap.size && combinedScore > bestCombinedScore)
    ) {
      bestCombinedScore = combinedScore;
      bestMap = chosenMap;
    }
  }

  const orderedLineups = uniqueFormats
    .map((fmt) => bestMap.get(fmt))
    .filter((l): l is SuggestedLineup => Boolean(l))
    .map((l, idx) => ({ ...l, rank: idx + 1 }));

  const totalProjectedPts =
    Math.round(orderedLineups.reduce((s, l) => s + l.totalScore, 0) * 10) / 10;
  const missAllProb = orderedLineups.reduce(
    (prod, l) => prod * (1 - Math.max(0, Math.min(99, l.odds.essencePct)) / 100),
    1,
  );
  const atLeastOneEssencePct =
    orderedLineups.length > 0 ? Math.round((1 - missAllProb) * 100) : 0;

  return {
    lineups: orderedLineups,
    totalProjectedPts,
    combinedEssenceScore: Math.round(bestCombinedScore * 10) / 10,
    atLeastOneEssencePct,
    cardsUsedCount: orderedLineups.reduce((s, l) => s + l.slots.length, 0),
  };
}

export type LineupSeasonRule = "4_in_1_classic" | "5_in_season" | "any_season";
export type BuyAdvisorRankMode = "best_value" | "max_upgrade" | "quest_synergy";

export interface LineupBuyRecommendation {
  listing: BargainListing;
  slotTarget: "classic_slot" | "in_season_slot";
  replacesCardSlug: string;
  replacesPlayerName: string;
  replacesSlotLabel: LineupSlotPick["slotLabel"];
  replacesIsInSeason: boolean;
  projectedCandidateScore: number;
  deltaLineupPts: number;
  ptsGainPerEuro: number;
  newLineupScore: number;
  newTotalStars: number;
  advancesCollection: boolean;
  questSynergyLabels: string[];
  synergyScore: number;
}

export interface DualLineupBuyRecommendations {
  classicSlotBuys: LineupBuyRecommendation[];
  inSeasonSlotBuys: LineupBuyRecommendation[];
  topOverallBuys: LineupBuyRecommendation[];
}

export interface RecommendLineupBuysOptions {
  format: LineupFormat;
  rarityFilter: CardRarity | "ALL";
  seasonRule: LineupSeasonRule;
  rankMode: BuyAdvisorRankMode;
  maxPriceCents?: number | null;
  projectionSource: ProjectionSource;
  customProjectionsRaw: string;
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  scheduleByTeam?: Record<string, TeamSlateSchedule>;
  maxPerTeam?: number | null;
  excludeOut?: boolean;
  excludeQuestionable?: boolean;
  captainBonusPct?: number;
}

/**
 * Recommends targeted market buys for both the 1 allowed Out-of-Season (Classic) slot
 * and In-Season slots on a given base lineup, ranked by value (+Pts/EUR), max upgrade, or quest synergy.
 */
export function recommendLineupMarketBuys(
  baseLineup: SuggestedLineup,
  ownedPlayerSlugs: Set<string>,
  collectionNeedSlugs: Set<string>,
  marketListings: BargainListing[],
  options: RecommendLineupBuysOptions,
): DualLineupBuyRecommendations {
  const customMap = parseCustomProjections(options.customProjectionsRaw);
  const captainBonusPct = options.captainBonusPct ?? 0;
  const minInSeason =
    options.seasonRule === "5_in_season"
      ? 5
      : options.seasonRule === "4_in_1_classic"
        ? 4
        : 0;
  const lineupPlayerSlugs = new Set(
    baseLineup.slots.map((s) => s.evaluated.card.playerSlug),
  );

  const rawRecs: LineupBuyRecommendation[] = [];

  for (const m of marketListings) {
    if (m.priceCents === null || m.priceCents <= 0) continue;
    if (
      options.maxPriceCents !== undefined &&
      options.maxPriceCents !== null &&
      m.priceCents > options.maxPriceCents
    ) {
      continue;
    }
    if (options.rarityFilter !== "ALL" && m.rarity !== options.rarityFilter) {
      continue;
    }
    if (options.seasonRule === "5_in_season" && !m.inSeasonEligible) {
      continue;
    }
    if (lineupPlayerSlugs.has(m.playerSlug) || ownedPlayerSlugs.has(m.playerSlug)) {
      continue;
    }

    const syntheticCard: GalleryCard = {
      slug: m.cardSlug,
      rarity: m.rarity,
      seasonYear: m.seasonYear,
      inSeasonEligible: m.inSeasonEligible,
      grade: 1,
      powerMultiplier: m.inSeasonEligible ? 1.05 : 1.0,
      pictureUrl: m.pictureUrl ?? null,
      isFirstOwner: Boolean(m.isFirstOwnerEligible || m.isPrimaryOffer),
      teamName: m.teamName,
      teamSlug: m.teamSlug ?? null,
      playerSlug: m.playerSlug,
      playerName: m.playerName,
      positions: m.positions,
      l10: m.l10,
      l5: m.l5,
      sorareClassicProjected: m.projected,
      sorareDailyProjected: null,
      starCost: m.starCost,
    };

    const candEv = evaluateCardForLineup(
      syntheticCard,
      options.projectionSource,
      customMap,
      options.injuriesByName,
      options.gamesPerTeam,
      options.scheduleByTeam,
    );
    if (options.excludeOut !== false && candEv.injuryStatus === "OUT") continue;
    if (
      options.excludeQuestionable &&
      (candEv.injuryStatus === "QUESTIONABLE" ||
        candEv.injuryStatus === "DAY_TO_DAY" ||
        candEv.injuryStatus === "DOUBTFUL")
    ) {
      continue;
    }
    if (candEv.effectiveScore <= 0) continue;

    const maxPerTeam =
      options.maxPerTeam === undefined ? DEFAULT_MAX_PER_TEAM : (options.maxPerTeam ?? 0);
    let bestSlotRec: Omit<
      LineupBuyRecommendation,
      "ptsGainPerEuro" | "advancesCollection" | "questSynergyLabels" | "synergyScore"
    > | null = null;

    for (let idx = 0; idx < baseLineup.slots.length; idx += 1) {
      const targetSlot = baseLineup.slots[idx];
      const nextEvaluated = baseLineup.slots.map((s, i) =>
        i === idx ? candEv : s.evaluated,
      );

      if (exceedsMaxPerTeam(nextEvaluated.map((ev) => ev.card), maxPerTeam)) continue;

      const inSeasonCount = nextEvaluated.filter(
        (ev) => ev.card.inSeasonEligible,
      ).length;
      if (inSeasonCount < minInSeason) continue;

      const starCap = getFormatStarCap(options.format);
      const starSum = nextEvaluated.reduce(
        (sum, ev) => sum + ev.card.starCost,
        0,
      );
      if (starCap !== null && starSum > starCap) continue;

      const built = assignSlotLabels(
        nextEvaluated,
        options.format,
        captainBonusPct,
      );
      if (options.format === "daily_120_mvp" && built.capUsed > 120) continue;

      const deltaLineupPts =
        Math.round((built.totalScore - baseLineup.totalScore) * 10) / 10;
      if (deltaLineupPts < 0.5) continue;

      if (!bestSlotRec || deltaLineupPts > bestSlotRec.deltaLineupPts) {
        bestSlotRec = {
          listing: m,
          slotTarget: m.inSeasonEligible ? "in_season_slot" : "classic_slot",
          replacesCardSlug: targetSlot.evaluated.card.slug,
          replacesPlayerName: targetSlot.evaluated.card.playerName,
          replacesSlotLabel: targetSlot.slotLabel,
          replacesIsInSeason: targetSlot.evaluated.card.inSeasonEligible,
          projectedCandidateScore:
            Math.round(candEv.effectiveScore * 10) / 10,
          deltaLineupPts,
          newLineupScore: built.totalScore,
          newTotalStars: built.totalStars,
        };
      }
    }

    if (!bestSlotRec) continue;
    const priceEuros = Math.max(0.25, m.priceCents / 100);
    const ptsGainPerEuro =
      Math.round((bestSlotRec.deltaLineupPts / priceEuros) * 10) / 10;
    const advancesCollection = collectionNeedSlugs.has(m.playerSlug);
    const questSynergyLabels = m.questLabels ?? [];
    const synergyScore =
      Math.round(
        (bestSlotRec.deltaLineupPts +
          (advancesCollection ? 8 : 0) +
          questSynergyLabels.length * 4 +
          (m.isFirstOwnerEligible ? 3 : 0)) *
          10,
      ) / 10;

    rawRecs.push({
      ...bestSlotRec,
      ptsGainPerEuro,
      advancesCollection,
      questSynergyLabels,
      synergyScore,
    });
  }

  const compareRecs = (a: LineupBuyRecommendation, b: LineupBuyRecommendation) => {
    if (options.rankMode === "max_upgrade") {
      if (b.deltaLineupPts !== a.deltaLineupPts) {
        return b.deltaLineupPts - a.deltaLineupPts;
      }
      return b.ptsGainPerEuro - a.ptsGainPerEuro;
    }
    if (options.rankMode === "quest_synergy") {
      if (b.synergyScore !== a.synergyScore) {
        return b.synergyScore - a.synergyScore;
      }
      return b.ptsGainPerEuro - a.ptsGainPerEuro;
    }
    if (b.ptsGainPerEuro !== a.ptsGainPerEuro) {
      return b.ptsGainPerEuro - a.ptsGainPerEuro;
    }
    return b.deltaLineupPts - a.deltaLineupPts;
  };

  const sorted = [...rawRecs].sort(compareRecs);
  return {
    classicSlotBuys: sorted
      .filter((r) => r.slotTarget === "classic_slot")
      .slice(0, 6),
    inSeasonSlotBuys: sorted
      .filter((r) => r.slotTarget === "in_season_slot")
      .slice(0, 6),
    topOverallBuys: sorted.slice(0, 8),
  };
}

export interface TwoCardComboSwapRecommendation {
  outPlayers: [string, string];
  outSlotLabels: [LineupSlotPick["slotLabel"], LineupSlotPick["slotLabel"]];
  inCards: [
    {
      playerName: string;
      starCost: number;
      isOwned: boolean;
      priceCents: number;
      marketUrl: string;
      inSeasonEligible: boolean;
      seasonYear: number;
    },
    {
      playerName: string;
      starCost: number;
      isOwned: boolean;
      priceCents: number;
      marketUrl: string;
      inSeasonEligible: boolean;
      seasonYear: number;
    },
  ];
  totalCostCents: number;
  deltaLineupPts: number;
  ptsGainPerEuro: number;
  newLineupScore: number;
  newTotalStars: number;
}

/**
 * Finds 2-for-2 cap-reallocation combos (e.g., downgrading a medium card to a cheap low-★
 * enabler to unlock a high-ceiling superstar buy) when 1-for-1 swaps are star-capped.
 */
export function recommendTwoCardComboSwaps(
  baseLineup: SuggestedLineup,
  ownedCards: GalleryCard[],
  marketListings: BargainListing[],
  options: RecommendLineupBuysOptions,
): TwoCardComboSwapRecommendation[] {
  if (baseLineup.slots.length !== 5 || marketListings.length === 0) return [];

  const customMap = parseCustomProjections(options.customProjectionsRaw);
  const captainBonusPct = options.captainBonusPct ?? 0;
  const minInSeason =
    options.seasonRule === "5_in_season"
      ? 5
      : options.seasonRule === "4_in_1_classic"
        ? 4
        : 0;

  const baseCardSlugs = new Set(baseLineup.slots.map((s) => s.evaluated.card.slug));
  const basePlayerSlugs = new Set(
    baseLineup.slots.map((s) => s.evaluated.card.playerSlug),
  );

  interface PoolCandidate {
    ev: EvaluatedLineupCard;
    isOwned: boolean;
    priceCents: number;
    marketUrl: string;
  }

  const byPlayerSlug = new Map<string, PoolCandidate>();

  for (const c of ownedCards) {
    if (baseCardSlugs.has(c.slug) || basePlayerSlugs.has(c.playerSlug)) continue;
    if (c.sealed) continue;
    if (options.rarityFilter !== "ALL" && c.rarity !== options.rarityFilter) continue;
    if (options.seasonRule === "5_in_season" && !c.inSeasonEligible) continue;
    const ev = evaluateCardForLineup(
      c,
      options.projectionSource,
      customMap,
      options.injuriesByName,
      options.gamesPerTeam,
      options.scheduleByTeam,
    );
    if (options.excludeOut !== false && ev.injuryStatus === "OUT") continue;
    if (
      options.excludeQuestionable &&
      (ev.injuryStatus === "QUESTIONABLE" ||
        ev.injuryStatus === "DAY_TO_DAY" ||
        ev.injuryStatus === "DOUBTFUL")
    ) {
      continue;
    }
    if (ev.effectiveScore <= 0) continue;
    if (!byPlayerSlug.has(c.playerSlug)) {
      byPlayerSlug.set(c.playerSlug, {
        ev,
        isOwned: true,
        priceCents: 0,
        marketUrl: `https://sorare.com/nba/cards/${c.slug}`,
      });
    }
  }

  for (const m of marketListings) {
    if (m.priceCents === null || m.priceCents <= 0) continue;
    if (
      options.maxPriceCents !== undefined &&
      options.maxPriceCents !== null &&
      m.priceCents > options.maxPriceCents
    ) {
      continue;
    }
    if (options.rarityFilter !== "ALL" && m.rarity !== options.rarityFilter) continue;
    if (options.seasonRule === "5_in_season" && !m.inSeasonEligible) continue;
    if (basePlayerSlugs.has(m.playerSlug)) continue;
    const prev = byPlayerSlug.get(m.playerSlug);
    if (prev && (prev.isOwned || prev.priceCents <= m.priceCents)) continue;

    const synthetic: GalleryCard = {
      slug: m.cardSlug,
      rarity: m.rarity,
      seasonYear: m.seasonYear,
      inSeasonEligible: m.inSeasonEligible,
      grade: 1,
      powerMultiplier: m.inSeasonEligible ? 1.05 : 1.0,
      pictureUrl: m.pictureUrl ?? null,
      isFirstOwner: Boolean(m.isFirstOwnerEligible || m.isPrimaryOffer),
      teamName: m.teamName,
      teamSlug: m.teamSlug ?? null,
      playerSlug: m.playerSlug,
      playerName: m.playerName,
      positions: m.positions,
      l10: m.l10,
      l5: m.l5,
      sorareClassicProjected: m.projected,
      sorareDailyProjected: null,
      starCost: m.starCost,
    };
    const ev = evaluateCardForLineup(
      synthetic,
      options.projectionSource,
      customMap,
      options.injuriesByName,
      options.gamesPerTeam,
      options.scheduleByTeam,
    );
    if (options.excludeOut !== false && ev.injuryStatus === "OUT") continue;
    if (
      options.excludeQuestionable &&
      (ev.injuryStatus === "QUESTIONABLE" ||
        ev.injuryStatus === "DAY_TO_DAY" ||
        ev.injuryStatus === "DOUBTFUL")
    ) {
      continue;
    }
    if (ev.effectiveScore <= 0) continue;
    byPlayerSlug.set(m.playerSlug, {
      ev,
      isOwned: false,
      priceCents: m.priceCents,
      marketUrl: m.marketUrl,
    });
  }

  const allCands = [...byPlayerSlug.values()].sort(
    (a, b) => b.ev.effectiveScore - a.ev.effectiveScore,
  );
  const topStars = allCands.slice(0, 12);
  const topSet = new Set(topStars.map((c) => c.ev.card.slug));
  const enablers = allCands
    .filter((c) => !topSet.has(c.ev.card.slug) && c.ev.card.starCost <= 2.0)
    .slice(0, 10);
  const pool = [...topStars, ...enablers];
  if (pool.length < 2) return [];

  const maxPerTeam =
    options.maxPerTeam === undefined ? DEFAULT_MAX_PER_TEAM : (options.maxPerTeam ?? 0);
  const results: TwoCardComboSwapRecommendation[] = [];

  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 5; j += 1) {
      const outA = baseLineup.slots[i];
      const outB = baseLineup.slots[j];
      const kept3 = baseLineup.slots
        .filter((_, idx) => idx !== i && idx !== j)
        .map((s) => s.evaluated);

      for (let a = 0; a < pool.length - 1; a += 1) {
        const candA = pool[a];
        for (let b = a + 1; b < pool.length; b += 1) {
          const candB = pool[b];
          if (candA.ev.card.playerSlug === candB.ev.card.playerSlug) continue;
          if (candA.isOwned && candB.isOwned) continue;

          const totalCostCents = candA.priceCents + candB.priceCents;
          if (
            options.maxPriceCents !== undefined &&
            options.maxPriceCents !== null &&
            totalCostCents > options.maxPriceCents
          ) {
            continue;
          }

          const combo5 = [...kept3, candA.ev, candB.ev];
          if (exceedsMaxPerTeam(combo5.map((ev) => ev.card), maxPerTeam)) continue;
          const inSeasonCount = combo5.filter(
            (ev) => ev.card.inSeasonEligible,
          ).length;
          if (inSeasonCount < minInSeason) continue;

          const starCap = getFormatStarCap(options.format);
          const starSum = combo5.reduce((s, ev) => s + ev.card.starCost, 0);
          if (starCap !== null && starSum > starCap) continue;

          const built = assignSlotLabels(
            combo5,
            options.format,
            captainBonusPct,
          );
          if (options.format === "daily_120_mvp" && built.capUsed > 120) {
            continue;
          }

          const deltaLineupPts =
            Math.round((built.totalScore - baseLineup.totalScore) * 10) / 10;
          if (deltaLineupPts < 2.0) continue;

          const ptsGainPerEuro =
            Math.round(
              (deltaLineupPts / Math.max(0.25, totalCostCents / 100)) * 10,
            ) / 10;

          results.push({
            outPlayers: [
              outA.evaluated.card.playerName,
              outB.evaluated.card.playerName,
            ],
            outSlotLabels: [outA.slotLabel, outB.slotLabel],
            inCards: [
              {
                playerName: candA.ev.card.playerName,
                starCost: candA.ev.card.starCost,
                isOwned: candA.isOwned,
                priceCents: candA.priceCents,
                marketUrl: candA.marketUrl,
                inSeasonEligible: candA.ev.card.inSeasonEligible,
                seasonYear: candA.ev.card.seasonYear,
              },
              {
                playerName: candB.ev.card.playerName,
                starCost: candB.ev.card.starCost,
                isOwned: candB.isOwned,
                priceCents: candB.priceCents,
                marketUrl: candB.marketUrl,
                inSeasonEligible: candB.ev.card.inSeasonEligible,
                seasonYear: candB.ev.card.seasonYear,
              },
            ],
            totalCostCents,
            deltaLineupPts,
            ptsGainPerEuro,
            newLineupScore: built.totalScore,
            newTotalStars: built.totalStars,
          });
        }
      }
    }
  }

  results.sort((a, b) =>
    options.rankMode === "best_value"
      ? b.ptsGainPerEuro - a.ptsGainPerEuro ||
        b.deltaLineupPts - a.deltaLineupPts
      : b.deltaLineupPts - a.deltaLineupPts ||
        b.ptsGainPerEuro - a.ptsGainPerEuro,
  );

  const uniqueCombos: TwoCardComboSwapRecommendation[] = [];
  const seenPairs = new Set<string>();
  for (const r of results) {
    const sig = [r.inCards[0].playerName, r.inCards[1].playerName]
      .sort()
      .join("|");
    if (seenPairs.has(sig)) continue;
    seenPairs.add(sig);
    uniqueCombos.push(r);
    if (uniqueCombos.length >= 3) break;
  }

  return uniqueCombos;
}

const LEADERBOARD_RARITY_KEYS: Array<[string, CardRarity]> = [
  ["super_rare", "super_rare"],
  ["limited", "limited"],
  ["unique", "unique"],
  ["common", "common"],
  ["rare", "rare"],
];

function rarityFromLeaderboardSlug(slug: string): CardRarity | null {
  const s = slug.toLowerCase();
  for (const [key, rarity] of LEADERBOARD_RARITY_KEYS) {
    if (s.includes(`_${key}_`) || s.endsWith(`_${key}`)) return rarity;
  }
  return null;
}

/**
 * Card slugs committed to the manager's synced (DOM or API) lineups this Game Week.
 * DOM-synced lineups often carry player names only, so names are matched to owned cards,
 * preferring the rarity of the lineup's competition (from Sorare's leaderboard slug) and
 * never assigning one card to two lineups.
 */
export function resolveSyncedLineupCardSlugs(
  currentLineups: CurrentLineupEntry[],
  cards: GalleryCard[],
): string[] {
  const owned = new Set(cards.map((c) => c.slug));
  const locked = new Set<string>();
  for (const entry of currentLineups) {
    for (const slug of entry.cardSlugs) {
      if (owned.has(slug)) locked.add(slug);
    }
  }
  for (const entry of currentLineups) {
    const rarity = rarityFromLeaderboardSlug(entry.leaderboardSlug);
    const alreadyBySlug = new Set(
      entry.cardSlugs
        .filter((s) => owned.has(s))
        .map((s) => normalizePlayerNameKey(cards.find((c) => c.slug === s)?.playerName ?? "")),
    );
    for (const name of entry.playerNames ?? []) {
      const key = normalizePlayerNameKey(name);
      if (!key || alreadyBySlug.has(key)) continue;
      const matches = cards
        .filter((c) => normalizePlayerNameKey(c.playerName) === key && !locked.has(c.slug))
        .sort((a, b) => {
          const ra = rarity && a.rarity === rarity ? 0 : 1;
          const rb = rarity && b.rarity === rarity ? 0 : 1;
          if (ra !== rb) return ra - rb;
          return (b.seasonYear ?? 0) - (a.seasonYear ?? 0);
        });
      if (matches[0]) locked.add(matches[0].slug);
    }
  }
  return Array.from(locked);
}

// ---------------------------------------------------------------------------
// Focus strength grading (Feature #9)
// ---------------------------------------------------------------------------

export type FocusGrade = "A+" | "A" | "B+" | "B" | "C" | "D" | "F";
export type FocusPositionKey = "G" | "F" | "C";

export interface FocusPositionNote {
  position: FocusPositionKey;
  label: "Guard" | "Forward" | "Center";
  bestOwnedPlayer: string | null;
  bestOwnedScore: number;
  reason: string;
}

export interface FocusBargainTarget {
  playerName: string;
  cardSlug: string;
  position: FocusPositionKey;
  projected: number;
  starCost: number;
  priceCents: number | null;
  ptsPerEuro: number | null;
  marketUrl: string;
}

export interface FocusReplacement {
  outPlayer: string | null;
  inPlayer: string;
  cardSlug: string;
  position: FocusPositionKey;
  gainPts: number;
  starCost: number;
  priceCents: number | null;
  reason: string;
  marketUrl: string;
}

export interface FocusStrengthAnalysis {
  format: LineupFormat;
  grade: FocusGrade;
  /** Tailwind-friendly tone name for the grade badge. */
  colorTone: "emerald" | "green" | "lime" | "amber" | "orange" | "rose" | "red";
  /** Best owned lineup score divided by the field's reward cutoff. */
  scoreRatioToCut: number;
  bestOwnedScore: number;
  cutScore: number;
  missingPositions: FocusPositionNote[];
  weakPositions: FocusPositionNote[];
  bargainTargetsByPosition: Record<FocusPositionKey, FocusBargainTarget[]>;
  topReplacements: FocusReplacement[];
  /** Best legal lineup from owned + all listed cards, ignoring price ("budget is no issue"). */
  uncappedDreamLineup: {
    totalScore: number;
    totalStars: number;
    totalCostCents: number;
    slots: Array<{ playerName: string; cardSlug: string; owned: boolean; projected: number }>;
  } | null;
  summary: string;
}

const FOCUS_POSITIONS: Array<{ key: FocusPositionKey; label: FocusPositionNote["label"]; nba: NbaPosition }> = [
  { key: "G", label: "Guard", nba: "basketball_guard" },
  { key: "F", label: "Forward", nba: "basketball_forward" },
  { key: "C", label: "Center", nba: "basketball_center" },
];

const GRADE_STEPS: Array<{ min: number; grade: FocusGrade; tone: FocusStrengthAnalysis["colorTone"] }> = [
  { min: 1.25, grade: "A+", tone: "emerald" },
  { min: 1.15, grade: "A", tone: "green" },
  { min: 1.05, grade: "B+", tone: "lime" },
  { min: 0.95, grade: "B", tone: "amber" },
  { min: 0.85, grade: "C", tone: "orange" },
  { min: 0.7, grade: "D", tone: "rose" },
  { min: -Infinity, grade: "F", tone: "red" },
];

function gradeForRatio(ratio: number): { grade: FocusGrade; tone: FocusStrengthAnalysis["colorTone"] } {
  const step = GRADE_STEPS.find((s) => ratio >= s.min) ?? GRADE_STEPS[GRADE_STEPS.length - 1];
  return { grade: step.grade, tone: step.tone };
}

function scopeForFormat(
  format: LineupFormat,
  options: { benchmarkSeasonScope?: ContestScope; minInSeasonCards: number; inSeasonOnly: boolean },
): ContestScope {
  if (format === "arena_champion_15" || format === "arena_contender_12" || format === "uncapped") {
    return "arena";
  }
  return (
    options.benchmarkSeasonScope ??
    (options.inSeasonOnly || options.minInSeasonCards >= 4 ? "in_season" : "classic")
  );
}

/**
 * Rates how strong the manager's cards are for one lineup focus (format) against the
 * field's reward cutoff, and lists what would make it stronger. Stays short when the
 * focus is already strong (grade A / A+: no weak spots, at most 3 replacements).
 */
export function analyzeFocusStrength(
  cards: GalleryCard[],
  options: Omit<AutoBuildOptions, "format" | "maxLineups"> & { format?: LineupFormat },
  marketListings: BargainListing[] = [],
  currentLineups: CurrentLineupEntry[] = [],
): FocusStrengthAnalysis {
  const format = options.format ?? "contender_11";
  const starCap = getFormatStarCap(format);
  const lockedSlugs = options.excludeSubmittedCards
    ? resolveSyncedLineupCardSlugs(currentLineups, cards)
    : [];
  const buildOptions: AutoBuildOptions = {
    ...options,
    format,
    maxLineups: 1,
    excludedCardSlugs: [...(options.excludedCardSlugs ?? []), ...lockedSlugs],
  };
  const built = generateTopLineups(cards, buildOptions);
  const best = built.lineups[0] ?? null;
  const pool = built.evaluatedPool;

  // Without an explicit scope, grade against the best contest this lineup can enter:
  // In-Season (softer field) when it holds >= 4 In-Season cards, otherwise Classic.
  const scope: ContestScope = options.benchmarkSeasonScope
    ? options.benchmarkSeasonScope
    : scopeForFormat(format, options) === "arena"
      ? "arena"
      : best && best.inSeasonCount >= 4
        ? "in_season"
        : "classic";

  const bm = findBenchmarkForFormat(options.benchmarks, format, scope, options.ageFilter ?? "all");
  const cutCandidate = bm?.paidCutoffScore;
  const cutScore =
    typeof cutCandidate === "number" && Number.isFinite(cutCandidate) && cutCandidate > 0
      ? cutCandidate
      : LINEUP_FORMAT_TARGETS[format].essenceTarget;
  const bestOwnedScore = best?.totalScore ?? 0;
  const scoreRatioToCut = Math.round((bestOwnedScore / cutScore) * 1000) / 1000;
  const { grade, tone } = gradeForRatio(scoreRatioToCut);
  const strong = grade === "A+" || grade === "A";

  // Positions: missing = no eligible card; weak = best card far below a cut-level slot.
  const slotTarget = cutScore / 5;
  const missingPositions: FocusPositionNote[] = [];
  const weakPositions: FocusPositionNote[] = [];
  for (const pos of FOCUS_POSITIONS) {
    const atPos = pool
      .filter((ev) => ev.card.positions.includes(pos.nba))
      .sort((a, b) => b.effectiveScore - a.effectiveScore);
    const top = atPos[0] ?? null;
    if (!top) {
      missingPositions.push({
        position: pos.key,
        label: pos.label,
        bestOwnedPlayer: null,
        bestOwnedScore: 0,
        reason: `No eligible ${pos.label} card for ${format}.`,
      });
    } else if (!strong && top.effectiveScore < slotTarget * 0.5) {
      weakPositions.push({
        position: pos.key,
        label: pos.label,
        bestOwnedPlayer: top.card.playerName,
        bestOwnedScore: Math.round(top.effectiveScore * 10) / 10,
        reason: `Best ${pos.label} (${top.card.playerName}) projects ${top.effectiveScore.toFixed(1)} pts vs ~${slotTarget.toFixed(0)} needed per slot to reach the cut.`,
      });
    }
  }

  // Market targets the manager does not already own, filtered to the focus rules.
  const ownedPlayers = new Set(cards.map((c) => c.playerSlug));
  const eligibleListings = marketListings.filter(
    (l) =>
      !ownedPlayers.has(l.playerSlug) &&
      (options.rarityFilter === "ALL" || l.rarity === options.rarityFilter) &&
      (!options.inSeasonOnly || l.inSeasonEligible) &&
      (starCap === null || l.starCost <= starCap),
  );
  const listingProjection = (l: BargainListing) => l.projected ?? l.l5 ?? l.l10;
  const bargainTargetsByPosition: Record<FocusPositionKey, FocusBargainTarget[]> = { G: [], F: [], C: [] };
  for (const pos of FOCUS_POSITIONS) {
    bargainTargetsByPosition[pos.key] = eligibleListings
      .filter((l) => l.positions.includes(pos.nba))
      .map((l) => {
        const projected = listingProjection(l);
        const euros = l.priceCents !== null && l.priceCents > 0 ? l.priceCents / 100 : null;
        return {
          playerName: l.playerName,
          cardSlug: l.cardSlug,
          position: pos.key,
          projected: Math.round(projected * 10) / 10,
          starCost: l.starCost,
          priceCents: l.priceCents,
          ptsPerEuro: euros ? Math.round((projected / euros) * 10) / 10 : null,
          marketUrl: l.marketUrl,
        };
      })
      .sort((a, b) => (b.ptsPerEuro ?? 0) - (a.ptsPerEuro ?? 0) || b.projected - a.projected)
      .slice(0, 3);
  }

  // Replacements: market cards that beat a current slot (or fill a missing position) within the cap.
  const replacements: FocusReplacement[] = [];
  if (best) {
    for (const slot of best.slots) {
      const slotPositions = slot.evaluated.card.positions;
      for (const l of eligibleListings) {
        if (!l.positions.some((p) => slotPositions.includes(p))) continue;
        const newStars = best.totalStars - slot.evaluated.card.starCost + l.starCost;
        if (starCap !== null && newStars > starCap + 1e-9) continue;
        const gain = listingProjection(l) - slot.slotScore;
        if (gain <= 0.5) continue;
        const pos = FOCUS_POSITIONS.find((p) => l.positions.includes(p.nba))?.key ?? "F";
        replacements.push({
          outPlayer: slot.evaluated.card.playerName,
          inPlayer: l.playerName,
          cardSlug: l.cardSlug,
          position: pos,
          gainPts: Math.round(gain * 10) / 10,
          starCost: l.starCost,
          priceCents: l.priceCents,
          reason: `${l.playerName} projects ${listingProjection(l).toFixed(1)} vs ${slot.evaluated.card.playerName} ${slot.slotScore.toFixed(1)} (+${gain.toFixed(1)}), lineup ${newStars}${starCap !== null ? `/${starCap}` : ""}★.`,
          marketUrl: l.marketUrl,
        });
      }
    }
  }
  for (const missing of missingPositions) {
    for (const t of bargainTargetsByPosition[missing.position]) {
      replacements.push({
        outPlayer: null,
        inPlayer: t.playerName,
        cardSlug: t.cardSlug,
        position: missing.position,
        gainPts: t.projected,
        starCost: t.starCost,
        priceCents: t.priceCents,
        reason: `Fills your missing ${missing.label} slot (${t.projected.toFixed(1)} pts projected).`,
        marketUrl: t.marketUrl,
      });
    }
  }
  const seenIn = new Set<string>();
  const topReplacements = replacements
    .sort((a, b) => b.gainPts - a.gainPts)
    .filter((r) => {
      if (seenIn.has(r.cardSlug)) return false;
      seenIn.add(r.cardSlug);
      return true;
    })
    .slice(0, strong ? 3 : 5);

  // Dream lineup: owned + every listing at any price, still within the star cap.
  const ageFilter = options.ageFilter ?? "all";
  const dreamCards = cards.filter((c) => matchesAgeFilter(c.playerAge, ageFilter));
  const dreamListings =
    ageFilter === "all"
      ? marketListings
      : marketListings.filter((l) =>
          matchesAgeFilter((l as BargainListing & { playerAge?: number | null }).playerAge, ageFilter),
        );
  const dream = buildBudgetLineups(dreamCards, dreamListings, {
    format,
    rarityFilter: options.rarityFilter,
    projectionSource: options.projectionSource,
    customProjectionsRaw: options.customProjectionsRaw,
    injuriesByName: options.injuriesByName,
    gamesPerTeam: options.gamesPerTeam,
    scheduleByTeam: options.scheduleByTeam,
    maxPerTeam: options.maxPerTeam,
    budgetCents: Number.MAX_SAFE_INTEGER,
    includeOwned: true,
    inSeasonOnly: options.inSeasonOnly,
    minInSeasonCards: options.minInSeasonCards,
  })[0];
  const uncappedDreamLineup = dream
    ? {
        totalScore: dream.totalScore,
        totalStars: dream.totalStars,
        totalCostCents: dream.totalCostCents,
        slots: dream.slots.map((s) => ({
          playerName: s.evaluated.card.playerName,
          cardSlug: s.evaluated.card.slug,
          owned: dream.slotCostBySlug[s.evaluated.card.slug]?.isOwned ?? false,
          projected: Math.round(s.slotScore * 10) / 10,
        })),
      }
    : null;

  const summary = best
    ? `${grade}: best lineup ${bestOwnedScore.toFixed(1)} pts vs ~${Math.round(cutScore)} cut (${Math.round(scoreRatioToCut * 100)}%).`
    : `${grade}: no legal 5-card lineup for ${format} yet.`;

  return {
    format,
    grade,
    colorTone: tone,
    scoreRatioToCut,
    bestOwnedScore,
    cutScore,
    missingPositions,
    weakPositions,
    bargainTargetsByPosition,
    topReplacements,
    uncappedDreamLineup,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Synced-lineup edit focus & overlay (Feature #6)
// ---------------------------------------------------------------------------

export type EditFocusKind = "swap" | "buy" | "injury" | "schedule" | "boost" | "note";

export interface EditFocusPoint {
  kind: EditFocusKind;
  playerName: string | null;
  text: string;
}

export interface LineupOverlaySummary {
  /** Average power bonus (%) across the resolved cards. */
  totalBoostPct: number;
  /** 10th-percentile lineup score (normal model, see entryEvMath.ts). */
  p10Floor: number;
  /** 90th-percentile lineup score. */
  p90Ceiling: number;
  riskFlags: string[];
  upsideFlags: string[];
}

const P10_Z = 1.2816;
export const LINEUP_SIZE = 5;

function describeInjury(status: InjuryStatus): string {
  switch (status) {
    case "OUT":
      return "OUT";
    case "DOUBTFUL":
      return "Doubtful";
    case "QUESTIONABLE":
      return "Questionable";
    case "DAY_TO_DAY":
      return "GTD (day-to-day)";
    default:
      return "Active";
  }
}

export function buildUnresolvedReason(
  entry: CurrentLineupEntry,
  resolvedCount: number,
): string | undefined {
  if (resolvedCount >= LINEUP_SIZE) return undefined;
  const listed = new Set(entry.cardSlugs).size;
  const named = (entry.playerNames ?? []).length;
  if (listed === 0 && named === 0) {
    return "Synced lineup has no cards (empty or not yet filled on Sorare).";
  }
  const duplicates = entry.cardSlugs.length - listed;
  const missing = LINEUP_SIZE - resolvedCount;
  const dupNote = duplicates > 0 ? ` ${duplicates} duplicate card id(s) were ignored.` : "";
  return `${missing} of ${LINEUP_SIZE} cards not found in your gallery (sold, not owned, or name mismatch); showing ${resolvedCount}/${LINEUP_SIZE}.${dupNote}`;
}

export function buildLineupOverlay(
  evaluated: EvaluatedLineupCard[],
  projected: number,
  scheduleByTeam: Record<string, TeamSlateSchedule> | undefined,
): LineupOverlaySummary {
  const boosts = evaluated.map((ev) => ((ev.card.powerMultiplier ?? 1) - 1) * 100);
  const totalBoostPct =
    boosts.length > 0 ? Math.round((boosts.reduce((a, b) => a + b, 0) / boosts.length) * 10) / 10 : 0;
  const sd = lineupStdDev(
    evaluated.map((ev) => ({ projectedScore: ev.effectiveScore, teamSlug: ev.card.teamSlug })),
  );
  const riskFlags: string[] = [];
  const upsideFlags: string[] = [];
  for (const ev of evaluated) {
    const name = ev.card.playerName;
    const sched = scheduleByTeam?.[ev.card.teamSlug ?? ""];
    if (ev.injuryStatus !== "ACTIVE") {
      riskFlags.push(`${name}: ${describeInjury(ev.injuryStatus)}`);
    }
    if (isInactiveThisSeason(ev.card)) {
      riskFlags.push(`${name}: no NBA games this season`);
      continue;
    }
    if (ev.gamesInSlate === 0) riskFlags.push(`${name}: 0G (no game this slate)`);
    if (sched?.hasBackToBack) riskFlags.push(`${name}: B2B (rest risk)`);
    if (ev.gamesInSlate >= 2) upsideFlags.push(`${name}: ${ev.gamesInSlate}G slate`);
    const { l5, l10 } = ev.allSources;
    if (l5 !== null && l10 !== null && l10 > 0 && l5 >= l10 * 1.15) {
      upsideFlags.push(`${name}: hot form (L5 ${l5.toFixed(1)} vs L10 ${l10.toFixed(1)})`);
    }
  }
  return {
    totalBoostPct,
    p10Floor: Math.round(Math.max(0, projected - P10_Z * sd) * 10) / 10,
    p90Ceiling: Math.round((projected + P10_Z * sd) * 10) / 10,
    riskFlags,
    upsideFlags,
  };
}

export function buildEditFocusPoints(args: {
  evaluated: EvaluatedLineupCard[];
  swaps: LineupSwapSuggestion[];
  unresolvedReason: string | undefined;
  currentStars: number;
  starCap: number | null;
  scheduleByTeam: Record<string, TeamSlateSchedule> | undefined;
  marketListings: BargainListing[] | undefined;
  ownedPlayerSlugs: Set<string>;
  projectionSource?: ProjectionSource;
  customProjectionsRaw?: string;
  injuriesByName?: Record<string, InjuryReportEntry>;
  gamesPerTeam?: Record<string, number>;
  minInSeasonCards?: number;
  maxPerTeam?: number | null;
  excludeOut?: boolean;
  excludeQuestionable?: boolean;
}): EditFocusPoint[] {
  const points: EditFocusPoint[] = [];
  if (args.unresolvedReason) {
    points.push({ kind: "note", playerName: null, text: args.unresolvedReason });
  }
  for (const s of args.swaps) {
    points.push({
      kind: "swap",
      playerName: s.outPlayer,
      text: `Swap ${s.outPlayer} → ${s.inPlayer} (${s.deltaPts >= 0 ? "+" : ""}${s.deltaPts.toFixed(1)} pts): ${s.reason}`,
    });
  }
  for (const ev of args.evaluated) {
    const name = ev.card.playerName;
    if (ev.injuryStatus !== "ACTIVE") {
      const comment = ev.injury?.comment ? ` ${ev.injury.comment}` : "";
      points.push({
        kind: "injury",
        playerName: name,
        text:
          ev.injuryStatus === "OUT"
            ? `${name} is OUT: replace before lock.${comment}`
            : `${name} is ${describeInjury(ev.injuryStatus)}: check status before lock.${comment}`,
      });
    }
    if (ev.gamesInSlate === 0) {
      points.push({ kind: "schedule", playerName: name, text: `${name} has no game (0G) this slate: replace.` });
    }
    const sched = args.scheduleByTeam?.[ev.card.teamSlug ?? ""];
    if (sched?.hasBackToBack) {
      points.push({
        kind: "schedule",
        playerName: name,
        text: `${name}: ${sched.abbr} on a B2B (${ev.gamesInSlate}G); watch rest notes.`,
      });
    } else if (ev.gamesInSlate >= 2) {
      points.push({ kind: "schedule", playerName: name, text: `${name}: ${ev.gamesInSlate}G slate boost.` });
    }
    if ((ev.card.powerMultiplier ?? 1) > 1.0001) {
      points.push({
        kind: "boost",
        playerName: name,
        text: `${name}: +${(((ev.card.powerMultiplier ?? 1) - 1) * 100).toFixed(0)}% card power bonus.`,
      });
    }
  }
  // One buy idea: the best Instant Buy listing that beats the weakest card under all lineup rules.
  const weakest = [...args.evaluated].sort((a, b) => a.effectiveScore - b.effectiveScore)[0];
  if (weakest && args.marketListings && args.marketListings.length > 0) {
    const customMap = parseCustomProjections(args.customProjectionsRaw ?? "");
    const projectionSource = args.projectionSource ?? "blended_smart";
    const injuriesByName = args.injuriesByName ?? {};
    const gamesPerTeam = args.gamesPerTeam ?? {};
    const minInSeason = args.minInSeasonCards ?? 0;
    const maxPerTeam =
      args.maxPerTeam === undefined ? DEFAULT_MAX_PER_TEAM : (args.maxPerTeam ?? 0);
    const keptCards = args.evaluated.filter((e) => e.card.slug !== weakest.card.slug);

    const pick = args.marketListings
      .filter((l) => {
        if (l.saleType !== "instant_buy") return false;
        if (args.ownedPlayerSlugs.has(l.playerSlug)) return false;
        if (keptCards.some((k) => k.card.playerSlug === l.playerSlug)) return false;
        if (
          args.starCap !== null &&
          args.currentStars - weakest.card.starCost + l.starCost > args.starCap + 1e-9
        ) {
          return false;
        }
        return true;
      })
      .map((l) => {
        const synthetic: GalleryCard = {
          slug: l.cardSlug,
          rarity: l.rarity,
          seasonYear: l.seasonYear,
          inSeasonEligible: l.inSeasonEligible,
          grade: 1,
          powerMultiplier: l.inSeasonEligible ? 1.05 : 1.0,
          pictureUrl: l.pictureUrl ?? null,
          isFirstOwner: Boolean(l.isFirstOwnerEligible || l.isPrimaryOffer),
          teamName: l.teamName,
          teamSlug: l.teamSlug ?? null,
          playerSlug: l.playerSlug,
          playerName: l.playerName,
          positions: l.positions,
          l10: l.l10,
          l5: l.l5,
          sorareClassicProjected: l.projected,
          sorareDailyProjected: null,
          starCost: l.starCost,
        };
        const ev = evaluateCardForLineup(
          synthetic,
          projectionSource,
          customMap,
          injuriesByName,
          gamesPerTeam,
          args.scheduleByTeam,
        );
        return { l, ev, gain: ev.effectiveScore - weakest.effectiveScore };
      })
      .filter(({ ev, gain }) => {
        if (args.excludeOut !== false && ev.injuryStatus === "OUT") return false;
        if (
          args.excludeQuestionable &&
          (ev.injuryStatus === "QUESTIONABLE" ||
            ev.injuryStatus === "DAY_TO_DAY" ||
            ev.injuryStatus === "DOUBTFUL")
        ) {
          return false;
        }
        if (ev.gamesInSlate === 0 || ev.effectiveScore <= 0) return false;
        const nextCards = [...keptCards.map((k) => k.card), ev.card];
        if (exceedsMaxPerTeam(nextCards, maxPerTeam)) return false;
        if (minInSeason > 0) {
          const inSeasonCount = nextCards.filter((c) => c.inSeasonEligible).length;
          if (inSeasonCount < minInSeason) return false;
        }
        return gain > 0.5;
      })
      .sort((a, b) => b.gain - a.gain)[0];
    if (pick) {
      const sym = pick.l.currency === "USD" ? "$" : "€";
      const price =
        pick.l.priceCents !== null ? ` for ${sym}${(pick.l.priceCents / 100).toFixed(2)}` : "";
      points.push({
        kind: "buy",
        playerName: pick.l.playerName,
        text: `Buy target: ${pick.l.playerName}${price} (Instant Buy) to replace ${weakest.card.playerName} (+${pick.gain.toFixed(1)} pts, ${pick.l.starCost}★).`,
      });
    }
  }
  if (points.length === 0) {
    points.push({ kind: "note", playerName: null, text: "No edits needed: this lineup is at or near your best." });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Competition entry limits (Feature #5)
// ---------------------------------------------------------------------------

export interface CompetitionEntryLimitQuery {
  format: LineupFormat;
  rarity: CardRarity;
  seasonScope: "in_season" | "classic" | "arena";
}

/**
 * Max lineups the manager can enter in one competition, from COMPETITION_ENTRY_LIMITS:
 * Arena Rooms and In-Season 5, Classic by rarity (Limited 3 live-verified), Daily 1.
 * M3 replaces these constants with Sorare's live per-leaderboard caps.
 */
export function getCompetitionEntryLimit(query: CompetitionEntryLimitQuery): number {
  if (query.format === "daily_120_mvp") return 1;
  if (query.seasonScope === "arena") return COMPETITION_ENTRY_LIMITS.arenaCashMaxEntries;
  if (query.seasonScope === "in_season") return COMPETITION_ENTRY_LIMITS.proInSeasonMaxEntries;
  const byRarity: Partial<Record<CardRarity, number>> = COMPETITION_ENTRY_LIMITS.proClassicMaxEntriesByRarity;
  return byRarity[query.rarity] ?? 1;
}

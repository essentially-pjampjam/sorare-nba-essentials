import React from "react";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type {
  CardRarity,
  CraftClueFilter,
  CraftPoolPlayer,
  Currency,
  CurrentLineupEntry,
  GalleryCard,
  GalleryResult,
  InjuryReportEntry,
  LeaderboardBenchmark,
  LineupFormat,
  NbaPosition,
  ProjectionSource,
  Rarity,
  So5FixtureSummary,
  TeamSlateSchedule,
} from "../../src/shared/types";
import { ARENA_GW10_SUBMITTED_LINEUPS } from "./fixtures/arenaLineupsFixture.ts";
import {
  ESPN_INJURIES_FIXTURE,
  ESPN_SCOREBOARD_FIXTURE,
  GW8_LEADERBOARD_BENCHMARKS,
  PJAMPJAM_GAMES_PER_TEAM,
  PJAMPJAM_INJURIES_BY_NAME,
  PJAMPJAM_SCHEDULE_BY_TEAM,
} from "./fixtures/espnAndLeaderboardFixtures.ts";
import {
  PJAMPJAM_COMMON_CARDS,
  PJAMPJAM_GALLERY_CARDS,
  buildPjampjamGalleryResult,
} from "./fixtures/gallery42Fixture.ts";
import {
  type ChromeMockHandle,
  createDefaultFetchHandler,
  installChromeAndFetchMock,
} from "./helpers/chromeMock.ts";
import {
  closeContractLoader,
  loadContractModule,
  readRepoText,
  requireContractModule,
  requireExport,
} from "./helpers/contractLoader.ts";
import { renderUiComponentToHtml } from "./helpers/uiRenderHarness.ts";

const LINEUP_MATH_MODULE = "src/calculators/lineupOptimizerMath.ts";
const VAULT_SEALING_MODULE = "src/calculators/vaultSealingMath.ts";
const CRAFT_MATH_MODULE = "src/calculators/craftAdvisorMath.ts";
const EXTERNAL_DATA_MODULE = "src/background/externalDataClient.ts";
const SORARE_CLIENT_MODULE = "src/background/sorareClient.ts";
const RATE_LIMIT_MODULE = "src/background/rateLimitQueue.ts";
const GALLERY_TAB_MODULE = "src/sidepanel/tabs/GalleryTab.tsx";

type GalleryCardWithM2 = GalleryCard & {
  sealed?: boolean;
  sealedAt?: string | null;
};

type ScheduleWithVegas = TeamSlateSchedule & {
  impliedTeamTotal?: number | null;
  overUnder?: number | null;
  spread?: number | null;
  blowoutRisk?: boolean;
};

interface EvaluatedCardAnalytics {
  card: GalleryCardWithM2;
  baseProjection: number;
  injuryAdjustedBase: number;
  effectiveScore: number;
  p10Floor?: number;
  p50Median?: number;
  p90Ceiling?: number;
  cv?: number;
  vorp?: number;
  starSurplus?: number;
  riskTags?: string[];
  upsideTags?: string[];
  boostSummary?: unknown;
}

interface SealCandidateEvaluationContract {
  cardSlug: string;
  playerName: string;
  tier: string;
  sealingPoints: number;
  isDuplicate: boolean;
  isLockedOrListed: boolean;
  score: number;
  reason: string;
  warnings: string[];
}

interface GeneratedLineupWithSpread {
  rank: number;
  format: LineupFormat;
  slots: Array<{
    slotLabel: string;
    evaluated: EvaluatedCardAnalytics;
    slotScore: number;
  }>;
  totalScore: number;
  totalStars: number;
  stdDev?: number;
  variance?: number;
  overlaySummary?: {
    p10Floor?: number;
    p90Ceiling?: number;
  };
  odds: {
    essencePct: number;
    tier1Pct: number;
    podiumPct: number;
    stdDev?: number;
    estRank?: number;
    totalEntries?: number;
  };
}

interface CraftPoolEvaluationContract {
  pricedCount: number;
  pricedSupplyCoveragePct: number;
  expectedValueCents: number | null;
  tier0ChancePct: number;
  tier0DeltaPct: number;
  candidates: Array<{
    player: CraftPoolPlayer;
    oddsMultiplier: number;
  }>;
}

interface ExtendedBuildOptions {
  format?: LineupFormat;
  rarityFilter: CardRarity | "ALL";
  projectionSource: ProjectionSource;
  customProjectionsRaw: string;
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  scheduleByTeam?: Record<string, ScheduleWithVegas>;
  excludeOut: boolean;
  excludeQuestionable: boolean;
  inSeasonOnly: boolean;
  minInSeasonCards: number;
  disjointAcrossLineups: boolean;
  excludeSubmittedCards?: boolean;
  excludedCardSlugs?: string[];
  maxLineups?: number;
  benchmarks?: LeaderboardBenchmark[];
}

type EvaluateCardFn = (
  card: GalleryCardWithM2,
  projectionSource: ProjectionSource,
  customMap: Map<string, number>,
  injuriesByName: Record<string, InjuryReportEntry>,
  gamesPerTeam: Record<string, number>,
  scheduleByTeam?: Record<string, ScheduleWithVegas>,
) => EvaluatedCardAnalytics;

type GenerateLineupsFn = (
  cards: GalleryCardWithM2[],
  options: ExtendedBuildOptions & { format: LineupFormat; maxLineups: number },
) => {
  lineups: GeneratedLineupWithSpread[];
  evaluatedPool: EvaluatedCardAnalytics[];
};

type RecommendFormatFn = (
  cards: GalleryCardWithM2[],
  options: Omit<ExtendedBuildOptions, "format" | "maxLineups">,
) => {
  recommendedFormat: LineupFormat;
  viable?: boolean;
  cashProb?: number;
  expectedValueScore?: number;
  candidates: Array<{
    format: LineupFormat;
    viable?: boolean;
    cashProb?: number;
    expectedValueScore?: number;
    essencePct: number;
  }>;
};

type OptimizePortfolioFn = (
  cards: GalleryCardWithM2[],
  options: Omit<ExtendedBuildOptions, "format" | "maxLineups" | "disjointAcrossLineups">,
  formats?: LineupFormat[],
) => {
  lineups: GeneratedLineupWithSpread[];
  cardsUsedCount: number;
};

type CompareLineupsFn = (
  currentLineups: CurrentLineupEntry[],
  cards: GalleryCardWithM2[],
  options: Omit<ExtendedBuildOptions, "format" | "maxLineups">,
) => Array<{
  swaps: Array<{ outPlayer: string; inPlayer: string; deltaPts: number }>;
}>;

type EvaluateVaultFn = (card: GalleryCardWithM2) => {
  action: "SEAL_VAULT" | "SELL_CASH" | "HOLD_DEPTH" | string;
  vaultPoints: number;
  label: string;
  reason: string;
};

let activeMockHandle: ChromeMockHandle | null = null;

afterEach(() => {
  if (activeMockHandle) {
    activeMockHandle.restore();
    activeMockHandle = null;
  }
});

afterAll(async () => {
  await closeContractLoader();
});

function cloneCards(cards: GalleryCardWithM2[]): GalleryCardWithM2[] {
  return cards.map((card) => ({
    ...card,
    positions: [...card.positions],
    openedLineupIds: card.openedLineupIds ? [...card.openedLineupIds] : undefined,
    powerBreakdown: card.powerBreakdown ? { ...card.powerBreakdown } : undefined,
  }));
}

function cloneSchedule(
  schedule: Record<string, ScheduleWithVegas>,
): Record<string, ScheduleWithVegas> {
  const out: Record<string, ScheduleWithVegas> = {};
  for (const [k, v] of Object.entries(schedule)) {
    out[k] = {
      ...v,
      matchups: [...v.matchups],
      dvpByPos: v.dvpByPos ? { ...v.dvpByPos } : undefined,
    };
  }
  return out;
}

function cloneInjuries(
  injuries: Record<string, InjuryReportEntry>,
): Record<string, InjuryReportEntry> {
  const out: Record<string, InjuryReportEntry> = {};
  for (const [k, v] of Object.entries(injuries)) {
    out[k] = { ...v };
  }
  return out;
}

function cloneBenchmarks(
  benchmarks: LeaderboardBenchmark[],
): LeaderboardBenchmark[] {
  return benchmarks.map((b) => ({ ...b }));
}

function makeBaseOptions(
  overrides: Partial<ExtendedBuildOptions> = {},
): ExtendedBuildOptions {
  return {
    rarityFilter: "limited",
    projectionSource: "blended_smart",
    customProjectionsRaw: "",
    injuriesByName: cloneInjuries(PJAMPJAM_INJURIES_BY_NAME),
    gamesPerTeam: { ...PJAMPJAM_GAMES_PER_TEAM },
    scheduleByTeam: cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM),
    benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
    excludeOut: true,
    excludeQuestionable: false,
    inSeasonOnly: false,
    minInSeasonCards: 0,
    disjointAcrossLineups: true,
    ...overrides,
  };
}

function makeSyntheticCard(overrides: {
  slug: string;
  playerSlug: string;
  playerName: string;
  teamSlug: string;
  teamName: string;
  positions: NbaPosition[];
  starCost?: number;
  l10?: number;
  l5?: number;
  proj?: number;
  rarity?: CardRarity;
  inSeasonEligible?: boolean;
  seasonYear?: number;
  powerMultiplier?: number;
  isFirstOwner?: boolean;
  lowestAskCents?: number | null;
  openedLineupIds?: string[];
  sealed?: boolean;
  sealedAt?: string | null;
}): GalleryCardWithM2 {
  const inSeason = overrides.inSeasonEligible ?? true;
  return {
    slug: overrides.slug,
    rarity: overrides.rarity ?? "limited",
    seasonYear: overrides.seasonYear ?? (inSeason ? 2026 : 2025),
    inSeasonEligible: inSeason,
    grade: 1,
    powerMultiplier: overrides.powerMultiplier ?? 1.0,
    pictureUrl: null,
    isFirstOwner: overrides.isFirstOwner ?? false,
    playerAge: 25,
    cardEditionName: inSeason ? "2026-27 Limited" : "2025 Limited",
    acquisitionType: "market",
    lowestAskCents: overrides.lowestAskCents ?? null,
    lowestAskCardSlug: null,
    auctionBidCents: null,
    openedLineupIds: overrides.openedLineupIds ?? [],
    teamName: overrides.teamName,
    teamSlug: overrides.teamSlug,
    playerSlug: overrides.playerSlug,
    playerName: overrides.playerName,
    positions: overrides.positions,
    l10: overrides.l10 ?? 22,
    l5: overrides.l5 ?? 22,
    sorareClassicProjected: overrides.proj ?? 22,
    sorareDailyProjected: overrides.proj ?? 22,
    starCost: overrides.starCost ?? 2.0,
    sealed: overrides.sealed,
    sealedAt: overrides.sealedAt,
  };
}

function assertDistributionFields(
  ev: EvaluatedCardAnalytics,
  label: string,
): asserts ev is EvaluatedCardAnalytics & {
  p10Floor: number;
  p50Median: number;
  p90Ceiling: number;
  cv: number;
  vorp: number;
  starSurplus: number;
  riskTags: string[];
  upsideTags: string[];
} {
  if (
    typeof ev.p10Floor !== "number" ||
    typeof ev.p50Median !== "number" ||
    typeof ev.p90Ceiling !== "number" ||
    typeof ev.cv !== "number" ||
    typeof ev.vorp !== "number" ||
    typeof ev.starSurplus !== "number" ||
    !Array.isArray(ev.riskTags) ||
    !Array.isArray(ev.upsideTags)
  ) {
    throw new Error(
      `PROJECT.md #10: missing projection distribution fields on ${label} (expected p10Floor, p50Median, p90Ceiling, cv, vorp, starSurplus, riskTags, upsideTags)`,
    );
  }
}

function resolveLineupSpread(
  mod: Record<string, unknown>,
  lineup: GeneratedLineupWithSpread,
  scheduleByTeam: Record<string, ScheduleWithVegas>,
): number {
  if (typeof lineup.stdDev === "number" && Number.isFinite(lineup.stdDev)) {
    return lineup.stdDev;
  }
  if (typeof lineup.variance === "number" && Number.isFinite(lineup.variance)) {
    return Math.sqrt(Math.max(0, lineup.variance));
  }
  if (
    typeof lineup.odds?.stdDev === "number" &&
    Number.isFinite(lineup.odds.stdDev)
  ) {
    return lineup.odds.stdDev;
  }
  for (const exportName of [
    "computeLineupVariance",
    "computeLineupCorrelationVariance",
  ] as const) {
    const fn = mod[exportName];
    if (typeof fn === "function") {
      const val = (
        fn as (
          slots: GeneratedLineupWithSpread["slots"],
          schedule?: Record<string, ScheduleWithVegas>,
        ) => number | { stdDev?: number; variance?: number }
      )(lineup.slots, scheduleByTeam);
      if (typeof val === "number" && Number.isFinite(val)) {
        return Math.sqrt(Math.max(0, val));
      }
      if (val && typeof val.stdDev === "number") return val.stdDev;
      if (val && typeof val.variance === "number") {
        return Math.sqrt(Math.max(0, val.variance));
      }
    }
  }
  throw new Error(
    "PROJECT.md #10: missing correlation-aware lineup variance (expected lineup.stdDev, lineup.variance, lineup.odds.stdDev, or computeLineupVariance export)",
  );
}

const SEAL_CANDIDATE_EXPORTS = [
  "evaluateSealCandidates",
  "rankSealCandidates",
  "evaluateGallerySealCandidates",
  "evaluateVaultSealCandidates",
] as const;

async function resolveSealCandidates(
  cards: GalleryCardWithM2[],
  options?: { currentLineups?: CurrentLineupEntry[] },
): Promise<SealCandidateEvaluationContract[]> {
  const lineupMod = await loadContractModule<Record<string, unknown>>(
    LINEUP_MATH_MODULE,
  );
  const modulesToCheck: Record<string, unknown>[] = [];
  if (lineupMod.available && lineupMod.mod) {
    modulesToCheck.push(lineupMod.mod);
  }
  const vaultMod = await loadContractModule<Record<string, unknown>>(
    VAULT_SEALING_MODULE,
  );
  if (vaultMod.available && vaultMod.mod) {
    modulesToCheck.push(vaultMod.mod);
  }

  for (const mod of modulesToCheck) {
    for (const exportName of SEAL_CANDIDATE_EXPORTS) {
      const fn = mod[exportName];
      if (typeof fn === "function") {
        return (
          fn as (
            inputCards: GalleryCardWithM2[],
            opts?: { currentLineups?: CurrentLineupEntry[] },
          ) => SealCandidateEvaluationContract[]
        )(cards, options);
      }
    }
  }

  throw new Error(
    `PROJECT.md #11: missing SealCandidateEvaluation producer in ${LINEUP_MATH_MODULE} or ${VAULT_SEALING_MODULE}. Expected one of: ${SEAL_CANDIDATE_EXPORTS.join(", ")}.`,
  );
}

// ============================================================================
// FEATURE 10: Research-Backed Projection, Variance, Correlation & Vegas/B2B (12)
// ============================================================================
describe("Feature 10: Research-Backed Projection, Variance, Correlation & Vegas/B2B Models", () => {
  describe("Tier 1: Core Functional Requirements", () => {
    it("F10-T1-1: skewed distribution p10Floor <= p50Median <= p90Ceiling, positive skewness & cv > 0", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const evaluateCard = requireExport<EvaluateCardFn>(
        mod,
        "evaluateCardForLineup",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const schedule = cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM);
      const targets = [
        "wendell-carter-jr-2026-limited-1",
        "brook-lopez-2025-limited-1",
        "jordan-miller-2025-limited-1",
      ];

      for (const slug of targets) {
        const card = cards.find((c) => c.slug === slug)!;
        const ev = evaluateCard(
          card,
          "blended_smart",
          new Map(),
          {},
          PJAMPJAM_GAMES_PER_TEAM,
          schedule,
        );
        assertDistributionFields(ev, slug);
        expect(Number.isFinite(ev.p10Floor)).toBe(true);
        expect(Number.isFinite(ev.p50Median)).toBe(true);
        expect(Number.isFinite(ev.p90Ceiling)).toBe(true);
        expect(Number.isFinite(ev.cv)).toBe(true);
        expect(ev.p10Floor).toBeGreaterThanOrEqual(0);
        expect(ev.p10Floor).toBeLessThanOrEqual(ev.p50Median);
        expect(ev.p50Median).toBeLessThanOrEqual(ev.p90Ceiling);
        expect(ev.cv).toBeGreaterThan(0);

        if (slug !== "jordan-miller-2025-limited-1") {
          const rightTail = ev.p90Ceiling - ev.p50Median;
          const leftTail = ev.p50Median - ev.p10Floor;
          expect(rightTail).toBeGreaterThan(leftTail);
        }
      }
    });

    it("F10-T1-2: best-of-k order statistics scaling across 1G..4G with diminishing marginal returns", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const evaluateCard = requireExport<EvaluateCardFn>(
        mod,
        "evaluateCardForLineup",
        LINEUP_MATH_MODULE,
      );
      const wendell = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "wendell-carter-jr-2026-limited-1",
      )!;
      const schedule = cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM);

      const evals = [1, 2, 3, 4].map((k) => {
        const ev = evaluateCard(
          wendell,
          "blended_smart",
          new Map(),
          {},
          { "orlando-magic": k },
          schedule,
        );
        assertDistributionFields(ev, `wendell-${k}G`);
        return ev;
      });

      expect(evals[0].effectiveScore).toBeLessThan(evals[1].effectiveScore);
      expect(evals[1].effectiveScore).toBeLessThan(evals[2].effectiveScore);
      expect(evals[2].effectiveScore).toBeLessThan(evals[3].effectiveScore);

      expect(evals[0].p90Ceiling).toBeLessThan(evals[1].p90Ceiling);
      expect(evals[1].p90Ceiling).toBeLessThan(evals[2].p90Ceiling);
      expect(evals[2].p90Ceiling).toBeLessThan(evals[3].p90Ceiling);

      const gain1to2 = evals[1].effectiveScore - evals[0].effectiveScore;
      const gain3to4 = evals[3].effectiveScore - evals[2].effectiveScore;
      expect(gain1to2).toBeGreaterThan(gain3to4);
    });

    it("F10-T1-3: teammate & same-game correlation variance differs from uncorrelated 5-game lineup", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const generate = requireExport<GenerateLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );

      const makeScheduleEntry = (
        teamSlug: string,
        abbr: string,
        matchup: string,
        overUnder: number,
        spread: number,
      ): ScheduleWithVegas => ({
        teamSlug,
        teamName: teamSlug,
        abbr,
        games: 1,
        matchups: [matchup],
        hasBackToBack: false,
        difficultyTag: "NEUTRAL",
        overUnder,
        spread,
        impliedTeamTotal: (overUnder - spread) / 2,
        blowoutRisk: false,
      });

      const schedule: Record<string, ScheduleWithVegas> = {
        "cleveland-cavaliers": makeScheduleEntry("cleveland-cavaliers", "CLE", "vs MEM", 230, -3.5),
        "denver-nuggets": makeScheduleEntry("denver-nuggets", "DEN", "vs PHX", 230, -3.5),
        "los-angeles-clippers": makeScheduleEntry("los-angeles-clippers", "LAC", "vs CHA", 230, -3.5),
        "philadelphia-76ers": makeScheduleEntry("philadelphia-76ers", "PHI", "vs ATL", 230, -3.5),
        "toronto-raptors": makeScheduleEntry("toronto-raptors", "TOR", "vs WAS", 230, -3.5),
        "orlando-magic": makeScheduleEntry("orlando-magic", "ORL", "vs IND", 234.5, -2.5),
        "indiana-pacers": makeScheduleEntry("indiana-pacers", "IND", "@ORL", 234.5, 2.5),
      };

      const gamesPerTeam: Record<string, number> = {
        "cleveland-cavaliers": 1,
        "denver-nuggets": 1,
        "los-angeles-clippers": 1,
        "philadelphia-76ers": 1,
        "toronto-raptors": 1,
        "orlando-magic": 1,
        "indiana-pacers": 1,
      };

      const posList: NbaPosition[] = [
        "basketball_guard",
        "basketball_guard",
        "basketball_forward",
        "basketball_forward",
        "basketball_center",
      ];

      const poolUncorrelated = [
        "cleveland-cavaliers",
        "denver-nuggets",
        "los-angeles-clippers",
        "philadelphia-76ers",
        "toronto-raptors",
      ].map((teamSlug, idx) =>
        makeSyntheticCard({
          slug: `uncorr-${idx}`,
          playerSlug: `uncorr-p-${idx}`,
          playerName: `Uncorr Player ${idx}`,
          teamSlug,
          teamName: teamSlug,
          positions: [posList[idx]],
        }),
      );

      const poolSameGame = [
        "orlando-magic",
        "orlando-magic",
        "orlando-magic",
        "indiana-pacers",
        "indiana-pacers",
      ].map((teamSlug, idx) =>
        makeSyntheticCard({
          slug: `shootout-${idx}`,
          playerSlug: `shootout-p-${idx}`,
          playerName: `Shootout Player ${idx}`,
          teamSlug,
          teamName: teamSlug,
          positions: [posList[idx]],
        }),
      );

      const poolTeammate = [
        "orlando-magic",
        "orlando-magic",
        "orlando-magic",
        "denver-nuggets",
        "los-angeles-clippers",
      ].map((teamSlug, idx) =>
        makeSyntheticCard({
          slug: `teammate-${idx}`,
          playerSlug: `teammate-p-${idx}`,
          playerName: `Teammate Player ${idx}`,
          teamSlug,
          teamName: teamSlug,
          positions: [posList[idx]],
        }),
      );

      const opts = makeBaseOptions({
        gamesPerTeam,
        scheduleByTeam: schedule,
      });

      const resA = generate(poolUncorrelated, {
        ...opts,
        format: "contender_11",
        maxLineups: 1,
      });
      const resB = generate(poolSameGame, {
        ...opts,
        format: "contender_11",
        maxLineups: 1,
      });
      const resC = generate(poolTeammate, {
        ...opts,
        format: "contender_11",
        maxLineups: 1,
      });

      expect(resA.lineups).toHaveLength(1);
      expect(resB.lineups).toHaveLength(1);
      expect(resC.lineups).toHaveLength(1);

      const stdA = resolveLineupSpread(mod, resA.lineups[0], schedule);
      const stdB = resolveLineupSpread(mod, resB.lineups[0], schedule);
      const stdC = resolveLineupSpread(mod, resC.lineups[0], schedule);

      expect(stdA).toBeGreaterThan(0);
      expect(stdB).toBeGreaterThan(0);
      expect(stdC).toBeGreaterThan(0);
      expect(Math.abs(stdB - stdA)).toBeGreaterThan(0.1);
      expect(Math.abs(stdC - stdA)).toBeGreaterThan(0.1);
      expect(stdB).toBeGreaterThan(stdA);
    });

    it("F10-T1-4: real ESPN odds[0] (overUnder, spread) -> impliedTeamTotal, blowoutRisk, hasBackToBack & removes fake DvP hash", async () => {
      const fetchHandler = async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("/scoreboard")) {
          return new Response(JSON.stringify(ESPN_SCOREBOARD_FIXTURE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/injuries")) {
          return new Response(JSON.stringify(ESPN_INJURIES_FIXTURE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return createDefaultFetchHandler()(input);
      };

      activeMockHandle = installChromeAndFetchMock({
        fetchHandler,
        initialStorage: {},
      });

      const extMod = await requireContractModule<Record<string, unknown>>(
        EXTERNAL_DATA_MODULE,
      );
      const fetchCtx = requireExport<
        () => Promise<{
          injuriesByName: Record<string, InjuryReportEntry>;
          gamesPerTeam: Record<string, number>;
          scheduleByTeam: Record<string, ScheduleWithVegas>;
        }>
      >(extMod, "fetchExternalNbaContext", EXTERNAL_DATA_MODULE);

      const ctx = await fetchCtx();
      const cle = ctx.scheduleByTeam["cleveland-cavaliers"];
      const mem = ctx.scheduleByTeam["memphis-grizzlies"];
      const orl = ctx.scheduleByTeam["orlando-magic"];
      const ind = ctx.scheduleByTeam["indiana-pacers"];

      expect(cle).toBeDefined();
      expect(cle.overUnder).toBeCloseTo(238.5, 1);
      expect(Math.abs(cle.spread ?? 0)).toBeCloseTo(4.5, 1);
      expect(cle.impliedTeamTotal ?? 0).toBeCloseTo(121.5, 0.5);
      expect(cle.blowoutRisk).toBe(false);
      expect(cle.hasBackToBack).toBe(false);

      expect(mem).toBeDefined();
      expect(mem.impliedTeamTotal ?? 0).toBeCloseTo(117.0, 0.5);

      expect(orl).toBeDefined();
      expect(ind).toBeDefined();
      expect(orl.hasBackToBack).toBe(true);
      expect(ind.hasBackToBack).toBe(true);
      expect(orl.blowoutRisk).toBe(true);

      const srcText = readRepoText(EXTERNAL_DATA_MODULE);
      expect(srcText).not.toContain("positionalSeedOffset");
      expect(srcText).not.toMatch(/charCodeAt\(.*\)\s*%\s*97/);
    });

    it("F10-T1-5: computes vorp, starSurplus, and Vegas ITT / B2B projection adjustments", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const evaluateCard = requireExport<EvaluateCardFn>(
        mod,
        "evaluateCardForLineup",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const schedule = cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM);

      const wendell = evaluateCard(
        cards.find((c) => c.slug === "wendell-carter-jr-2026-limited-1")!,
        "blended_smart",
        new Map(),
        {},
        PJAMPJAM_GAMES_PER_TEAM,
        schedule,
      );
      const jordan = evaluateCard(
        cards.find((c) => c.slug === "jordan-miller-2025-limited-1")!,
        "blended_smart",
        new Map(),
        {},
        PJAMPJAM_GAMES_PER_TEAM,
        schedule,
      );
      const morez = evaluateCard(
        cards.find((c) => c.slug === "morez-johnson-jr-2026-limited-1")!,
        "blended_smart",
        new Map(),
        {},
        PJAMPJAM_GAMES_PER_TEAM,
        schedule,
      );
      const quenton = evaluateCard(
        cards.find((c) => c.slug === "quenton-jackson-2025-limited-1")!,
        "blended_smart",
        new Map(),
        {},
        PJAMPJAM_GAMES_PER_TEAM,
        schedule,
      );

      assertDistributionFields(wendell, "wendell");
      assertDistributionFields(jordan, "jordan");
      assertDistributionFields(morez, "morez");
      assertDistributionFields(quenton, "quenton");

      expect(wendell.vorp).toBeGreaterThan(0);
      expect(wendell.vorp).toBeGreaterThan(jordan.vorp);
      expect(morez.starSurplus).toBeGreaterThan(quenton.starSurplus);

      const baseCard = makeSyntheticCard({
        slug: "vegas-ctrl-1",
        playerSlug: "vegas-ctrl-p",
        playerName: "Vegas Control",
        teamSlug: "cleveland-cavaliers",
        teamName: "Cleveland Cavaliers",
        positions: ["basketball_guard"],
        l10: 25,
        l5: 25,
        proj: 25,
      });

      const restedHighItt: Record<string, ScheduleWithVegas> = {
        "cleveland-cavaliers": {
          teamSlug: "cleveland-cavaliers",
          teamName: "Cleveland Cavaliers",
          abbr: "CLE",
          games: 1,
          matchups: ["vs WAS"],
          hasBackToBack: false,
          difficultyTag: "EASY",
          overUnder: 242,
          spread: -6,
          impliedTeamTotal: 124,
          blowoutRisk: false,
        },
      };
      const b2bLowItt: Record<string, ScheduleWithVegas> = {
        "cleveland-cavaliers": {
          teamSlug: "cleveland-cavaliers",
          teamName: "Cleveland Cavaliers",
          abbr: "CLE",
          games: 1,
          matchups: ["@ORL"],
          hasBackToBack: true,
          difficultyTag: "TOUGH",
          overUnder: 214,
          spread: 4,
          impliedTeamTotal: 105,
          blowoutRisk: false,
        },
      };

      const evRested = evaluateCard(
        baseCard,
        "blended_smart",
        new Map(),
        {},
        { "cleveland-cavaliers": 1 },
        restedHighItt,
      );
      const evB2b = evaluateCard(
        baseCard,
        "blended_smart",
        new Map(),
        {},
        { "cleveland-cavaliers": 1 },
        b2bLowItt,
      );
      assertDistributionFields(evRested, "evRested");
      assertDistributionFields(evB2b, "evB2b");

      expect(evRested.effectiveScore).toBeGreaterThan(evB2b.effectiveScore);
      expect(evRested.p50Median).toBeGreaterThan(evB2b.p50Median);
      expect(evB2b.riskTags.join(" ").toLowerCase()).toMatch(/b2b|back-to-back|low/);
    });

    it("F10-T1-6: Craft Advisor weighted EV (evaluateCraftPool) with 100% priced supply", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        CRAFT_MATH_MODULE,
      );
      const evaluateCraftPool = requireExport<
        (
          players: CraftPoolPlayer[],
          clues: CraftClueFilter,
        ) => CraftPoolEvaluationContract
      >(mod, "evaluateCraftPool", CRAFT_MATH_MODULE);
      const DEFAULT_CRAFT_CLUES = requireExport<CraftClueFilter>(
        mod,
        "DEFAULT_CRAFT_CLUES",
        CRAFT_MATH_MODULE,
      );

      const players: CraftPoolPlayer[] = [
        {
          playerSlug: "victor-wembanyama",
          playerName: "Victor Wembanyama",
          age: 22,
          positions: ["basketball_center"],
          teamName: "San Antonio Spurs",
          teamSlug: "san-antonio-spurs",
          conference: "WEST",
          averageL10: 55,
          qualityTier: "TIER_0",
          availableSupply: 100,
          floorCents: 18500,
          floorCardSlug: "wemby-1",
          marketUrl: "https://sorare.com/nba/market/wemby",
        },
        {
          playerSlug: "nikola-jokic",
          playerName: "Nikola Jokic",
          age: 31,
          positions: ["basketball_center"],
          teamName: "Denver Nuggets",
          teamSlug: "denver-nuggets",
          conference: "WEST",
          averageL10: 54,
          qualityTier: "TIER_0",
          availableSupply: 100,
          floorCents: 12000,
          floorCardSlug: "jokic-1",
          marketUrl: "https://sorare.com/nba/market/jokic",
        },
        {
          playerSlug: "bench-guard",
          playerName: "Bench Guard",
          age: 24,
          positions: ["basketball_guard"],
          teamName: "Detroit Pistons",
          teamSlug: "detroit-pistons",
          conference: "EAST",
          averageL10: 10,
          qualityTier: "TIER_4",
          availableSupply: 800,
          floorCents: 50,
          floorCardSlug: "bench-1",
          marketUrl: "https://sorare.com/nba/market/bench",
        },
      ];

      const res = evaluateCraftPool(players, {
        ...DEFAULT_CRAFT_CLUES,
        positions: ["basketball_center"],
      });

      expect(res.pricedSupplyCoveragePct).toBe(100);
      expect(res.pricedCount).toBe(2);
      expect(res.expectedValueCents).toBe(15250);
      expect(res.tier0ChancePct).toBe(100);
      expect(res.tier0DeltaPct).toBe(80);
      expect(res.candidates[0]?.oddsMultiplier).toBe(5);
    });
  });

  describe("Tier 2: BVA & Edge Cases", () => {
    it("F10-T2-1: 0G slate boundary (detroit-pistons / marcus-sasser) scores 0 across all quantiles and is never drafted", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const evaluateCard = requireExport<EvaluateCardFn>(
        mod,
        "evaluateCardForLineup",
        LINEUP_MATH_MODULE,
      );
      const generate = requireExport<GenerateLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const sasser = cards.find(
        (c) => c.slug === "marcus-sasser-2026-limited-1",
      )!;
      const schedule = cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM);

      const ev = evaluateCard(
        sasser,
        "blended_smart",
        new Map(),
        {},
        PJAMPJAM_GAMES_PER_TEAM,
        schedule,
      );
      assertDistributionFields(ev, "marcus-sasser-0G");
      expect(ev.effectiveScore).toBe(0);
      expect(ev.p10Floor).toBe(0);
      expect(ev.p50Median).toBe(0);
      expect(ev.p90Ceiling).toBe(0);
      expect(ev.riskTags.join(" ").toLowerCase()).toMatch(/0g|no game|inactive/);

      for (const format of [
        "contender_11",
        "champion_16",
        "arena_contender_12",
      ] as const) {
        const res = generate(cards, {
          ...makeBaseOptions(),
          format,
          maxLineups: 3,
        });
        for (const ln of res.lineups) {
          expect(
            ln.slots.some(
              (s) => s.evaluated.card.slug === "marcus-sasser-2026-limited-1",
            ),
          ).toBe(false);
        }
      }
    });

    it("F10-T2-2: missing / empty ESPN odds (odds: [] & omitted odds) degrades safely without NaN", async () => {
      const fetchHandler = async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("/scoreboard")) {
          return new Response(JSON.stringify(ESPN_SCOREBOARD_FIXTURE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/injuries")) {
          return new Response(JSON.stringify(ESPN_INJURIES_FIXTURE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return createDefaultFetchHandler()(input);
      };

      activeMockHandle = installChromeAndFetchMock({
        fetchHandler,
        initialStorage: {},
      });

      const extMod = await requireContractModule<Record<string, unknown>>(
        EXTERNAL_DATA_MODULE,
      );
      const fetchCtx = requireExport<
        () => Promise<{
          scheduleByTeam: Record<string, ScheduleWithVegas>;
        }>
      >(extMod, "fetchExternalNbaContext", EXTERNAL_DATA_MODULE);

      const ctx = await fetchCtx();
      for (const slug of [
        "dallas-mavericks",
        "sacramento-kings",
        "toronto-raptors",
        "washington-wizards",
      ]) {
        const team = ctx.scheduleByTeam[slug];
        expect(team).toBeDefined();
        expect(team.games).toBe(1);
        expect(team.blowoutRisk).toBe(false);
        expect(
          team.impliedTeamTotal === null || team.impliedTeamTotal === undefined,
        ).toBe(true);
        expect(team.overUnder === null || team.overUnder === undefined).toBe(
          true,
        );
        expect(team.spread === null || team.spread === undefined).toBe(true);
      }
    });

    it("F10-T2-3: extreme spread / heavy blowout boundary (spread -16.5 vs -2.5)", async () => {
      const customScoreboard = {
        events: [
          {
            date: "2026-11-21T00:00:00Z",
            competitions: [
              {
                date: "2026-11-21T00:00:00Z",
                status: { type: { state: "pre", shortDetail: "7:00 PM EST" } },
                competitors: [
                  {
                    homeAway: "home",
                    team: { displayName: "Cleveland Cavaliers", abbreviation: "CLE" },
                    records: [{ summary: "14-2" }],
                  },
                  {
                    homeAway: "away",
                    team: { displayName: "Detroit Pistons", abbreviation: "DET" },
                    records: [{ summary: "3-13" }],
                  },
                ],
                odds: [
                  {
                    overUnder: 220.0,
                    spread: -16.5,
                    homeTeamOdds: { favorite: true },
                    awayTeamOdds: { favorite: false },
                  },
                ],
              },
            ],
          },
          {
            date: "2026-11-21T01:00:00Z",
            competitions: [
              {
                date: "2026-11-21T01:00:00Z",
                status: { type: { state: "pre", shortDetail: "8:00 PM EST" } },
                competitors: [
                  {
                    homeAway: "home",
                    team: { displayName: "Denver Nuggets", abbreviation: "DEN" },
                    records: [{ summary: "10-6" }],
                  },
                  {
                    homeAway: "away",
                    team: { displayName: "Phoenix Suns", abbreviation: "PHX" },
                    records: [{ summary: "10-6" }],
                  },
                ],
                odds: [
                  {
                    overUnder: 220.0,
                    spread: -2.5,
                    homeTeamOdds: { favorite: true },
                    awayTeamOdds: { favorite: false },
                  },
                ],
              },
            ],
          },
        ],
      };

      const fetchHandler = async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("/scoreboard")) {
          return new Response(JSON.stringify(customScoreboard), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/injuries")) {
          return new Response(JSON.stringify({ injuries: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return createDefaultFetchHandler()(input);
      };

      activeMockHandle = installChromeAndFetchMock({
        fetchHandler,
        initialStorage: {},
      });

      const extMod = await requireContractModule<Record<string, unknown>>(
        EXTERNAL_DATA_MODULE,
      );
      const fetchCtx = requireExport<
        () => Promise<{
          scheduleByTeam: Record<string, ScheduleWithVegas>;
        }>
      >(extMod, "fetchExternalNbaContext", EXTERNAL_DATA_MODULE);
      const ctx = await fetchCtx();

      expect(ctx.scheduleByTeam["cleveland-cavaliers"].blowoutRisk).toBe(true);
      expect(
        ctx.scheduleByTeam["cleveland-cavaliers"].impliedTeamTotal ?? 0,
      ).toBeCloseTo(118.25, 0.5);
      expect(
        ctx.scheduleByTeam["detroit-pistons"].impliedTeamTotal ?? 0,
      ).toBeCloseTo(101.75, 0.5);
      expect(ctx.scheduleByTeam["denver-nuggets"].blowoutRisk).toBe(false);

      const lineupMod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const evaluateCard = requireExport<EvaluateCardFn>(
        lineupMod,
        "evaluateCardForLineup",
        LINEUP_MATH_MODULE,
      );
      const sampleCard = makeSyntheticCard({
        slug: "blowout-test-1",
        playerSlug: "blowout-test-p",
        playerName: "Blowout Test",
        teamSlug: "cleveland-cavaliers",
        teamName: "Cleveland Cavaliers",
        positions: ["basketball_guard"],
        l10: 28,
        l5: 28,
        proj: 28,
      });

      const blowoutEv = evaluateCard(
        sampleCard,
        "blended_smart",
        new Map(),
        {},
        { "cleveland-cavaliers": 1 },
        {
          "cleveland-cavaliers": {
            teamSlug: "cleveland-cavaliers",
            teamName: "Cleveland Cavaliers",
            abbr: "CLE",
            games: 1,
            matchups: ["vs DET"],
            hasBackToBack: false,
            difficultyTag: "EASY",
            impliedTeamTotal: 118,
            overUnder: 220,
            spread: -16.5,
            blowoutRisk: true,
          },
        },
      );
      const closeEv = evaluateCard(
        sampleCard,
        "blended_smart",
        new Map(),
        {},
        { "cleveland-cavaliers": 1 },
        {
          "cleveland-cavaliers": {
            teamSlug: "cleveland-cavaliers",
            teamName: "Cleveland Cavaliers",
            abbr: "CLE",
            games: 1,
            matchups: ["vs PHX"],
            hasBackToBack: false,
            difficultyTag: "NEUTRAL",
            impliedTeamTotal: 118,
            overUnder: 233.5,
            spread: -2.5,
            blowoutRisk: false,
          },
        },
      );
      assertDistributionFields(blowoutEv, "blowoutEv");
      assertDistributionFields(closeEv, "closeEv");
      expect(blowoutEv.riskTags.join(" ").toLowerCase()).toMatch(/blowout/);
      expect(
        blowoutEv.effectiveScore < closeEv.effectiveScore ||
          blowoutEv.p10Floor < closeEv.p10Floor,
      ).toBe(true);
    });

    it("F10-T2-4: zero-projection & OUT player distribution boundary", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const evaluateCard = requireExport<EvaluateCardFn>(
        mod,
        "evaluateCardForLineup",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const cormac = cards.find(
        (c) => c.slug === "cormac-ryan-2026-limited-1",
      )!;
      const wade = cards.find(
        (c) => c.slug === "dean-wade-2025-limited-1",
      )!;

      const outInjuries = cloneInjuries(PJAMPJAM_INJURIES_BY_NAME);
      outInjuries["dean wade"] = {
        ...outInjuries["dean wade"],
        status: "OUT",
        rawStatus: "Out",
      };

      const wadeEv = evaluateCard(
        wade,
        "blended_smart",
        new Map(),
        outInjuries,
        PJAMPJAM_GAMES_PER_TEAM,
        cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM),
      );
      assertDistributionFields(wadeEv, "dean-wade-OUT");
      expect(wadeEv.effectiveScore).toBe(0);
      expect(wadeEv.p10Floor).toBe(0);
      expect(wadeEv.p50Median).toBe(0);
      expect(wadeEv.p90Ceiling).toBe(0);
      expect(Number.isFinite(wadeEv.cv)).toBe(true);
      expect(Number.isFinite(wadeEv.vorp)).toBe(true);

      const cormacEv = evaluateCard(
        cormac,
        "sorare_projected",
        new Map(),
        {},
        PJAMPJAM_GAMES_PER_TEAM,
        cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM),
      );
      assertDistributionFields(cormacEv, "cormac-zero-proj");
      expect(cormacEv.p10Floor).toBeGreaterThanOrEqual(0);
      expect(cormacEv.p10Floor).toBeLessThanOrEqual(cormacEv.p50Median);
      expect(cormacEv.p50Median).toBeLessThanOrEqual(cormacEv.p90Ceiling);
      expect(Number.isFinite(cormacEv.cv)).toBe(true);
    });

    it("F10-T2-5: Craft missing-price selection bias fix (1%-coverage skewed pool & 100% unpriced pool)", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        CRAFT_MATH_MODULE,
      );
      const evaluateCraftPool = requireExport<
        (
          players: CraftPoolPlayer[],
          clues: CraftClueFilter,
        ) => CraftPoolEvaluationContract
      >(mod, "evaluateCraftPool", CRAFT_MATH_MODULE);
      const DEFAULT_CRAFT_CLUES = requireExport<CraftClueFilter>(
        mod,
        "DEFAULT_CRAFT_CLUES",
        CRAFT_MATH_MODULE,
      );

      const poolA: CraftPoolPlayer[] = [
        {
          playerSlug: "wemby-t0",
          playerName: "Victor Wembanyama",
          age: 22,
          positions: ["basketball_center"],
          teamName: "San Antonio Spurs",
          teamSlug: "san-antonio-spurs",
          conference: "WEST",
          averageL10: 55,
          qualityTier: "TIER_0",
          availableSupply: 10,
          floorCents: 18500,
          floorCardSlug: "wemby-1",
          marketUrl: "https://sorare.com/nba/market/wemby",
        },
        {
          playerSlug: "unpriced-t4",
          playerName: "Unpriced Role 1",
          age: 26,
          positions: ["basketball_forward"],
          teamName: "Detroit Pistons",
          teamSlug: "detroit-pistons",
          conference: "EAST",
          averageL10: 12,
          qualityTier: "TIER_4",
          availableSupply: 490,
          floorCents: null,
          floorCardSlug: null,
          marketUrl: "https://sorare.com/nba/market/r1",
        },
        {
          playerSlug: "unpriced-t5",
          playerName: "Unpriced Role 2",
          age: 25,
          positions: ["basketball_guard"],
          teamName: "Washington Wizards",
          teamSlug: "washington-wizards",
          conference: "EAST",
          averageL10: 8,
          qualityTier: "TIER_5",
          availableSupply: 500,
          floorCents: null,
          floorCardSlug: null,
          marketUrl: "https://sorare.com/nba/market/r2",
        },
      ];

      const resA = evaluateCraftPool(poolA, DEFAULT_CRAFT_CLUES);
      expect(resA.pricedCount).toBe(1);
      expect(resA.pricedSupplyCoveragePct).toBeLessThan(5);
      // Must NOT blindly report unadjusted T0 floor (18500) as whole-pool EV
      expect(resA.expectedValueCents).not.toBe(18500);
      if (resA.expectedValueCents !== null) {
        expect(resA.expectedValueCents).toBeLessThan(18500);
      }

      const poolB = poolA.map((p) => ({
        ...p,
        floorCents: null,
        floorCardSlug: null,
      }));
      const resB = evaluateCraftPool(poolB, DEFAULT_CRAFT_CLUES);
      expect(resB.pricedCount).toBe(0);
      expect(resB.pricedSupplyCoveragePct).toBe(0);
      expect(resB.expectedValueCents).toBeNull();
    });

    it("F10-T2-6: negative / zero EV & unreachable benchmark cutoff boundary stays bounded without NaN", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const generate = requireExport<GenerateLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );

      const bottom5 = cloneCards(PJAMPJAM_GALLERY_CARDS)
        .filter((c) => c.slug !== "marcus-sasser-2026-limited-1")
        .sort((a, b) => (a.l10 ?? 0) - (b.l10 ?? 0))
        .slice(0, 5);

      const opts = makeBaseOptions({
        benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
      });
      const gen = generate(bottom5, {
        ...opts,
        format: "champion_16",
        maxLineups: 1,
      });

      if (gen.lineups.length > 0) {
        const ln = gen.lineups[0];
        expect(ln.odds.essencePct).toBeGreaterThanOrEqual(0);
        expect(ln.odds.essencePct).toBeLessThanOrEqual(5);
        expect(ln.odds.tier1Pct).toBeGreaterThanOrEqual(0);
        expect(ln.odds.podiumPct).toBeGreaterThanOrEqual(0);
        if (ln.odds.estRank !== undefined && ln.odds.totalEntries !== undefined) {
          expect(ln.odds.estRank).toBeGreaterThanOrEqual(1);
          expect(ln.odds.estRank).toBeLessThanOrEqual(ln.odds.totalEntries);
        }
      }

      const rec = recommend(bottom5, opts);
      const champ = rec.candidates.find((c) => c.format === "champion_16");
      expect(champ).toBeDefined();
      expect(champ!.viable).toBe(false);
      expect(Number.isFinite(champ!.expectedValueScore ?? 0)).toBe(true);
    });
  });
});

// ============================================================================
// FEATURE 11: Card Sealing & Vault (12)
// ============================================================================
describe("Feature 11: Card Sealing & Vault (Card.sealed, Candidates, Cooldown Warnings)", () => {
  describe("Tier 1: Core Functional Requirements", () => {
    it("F11-T1-1: sorareClient.ts GraphQL GalleryAndFixtures requests sealed/sealedAt & maps onto GalleryCard", async () => {
      const capturedQueries: string[] = [];

      const fetchHandler = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes("api.sorare.com/graphql") && typeof init?.body === "string") {
          const body = JSON.parse(init.body) as { query?: string };
          const query = body.query ?? "";
          if (query.includes("GalleryAndFixtures")) {
            capturedQueries.push(query);
            const isCommonQuery = query.includes("rarities: [common]");
            const nodes = isCommonQuery
              ? []
              : [
                  {
                    slug: "wendell-carter-jr-2026-limited-1",
                    rarityTyped: "limited",
                    seasonYear: 2026,
                    inSeasonEligible: true,
                    grade: 1,
                    power: "1.08",
                    pictureUrl: null,
                    cardEditionName: "2026-27 Limited",
                    sealed: false,
                    sealedAt: null,
                    ownershipHistory: [{ transferType: "market" }],
                    anyTeam: { name: "Orlando Magic", slug: "orlando-magic" },
                    anyPlayer: {
                      slug: "wendell-carter-jr-19990416",
                      displayName: "Wendell Carter Jr.",
                      age: 27,
                      anyPositions: ["basketball_forward", "basketball_center"],
                      l10: 28,
                      l5: 37,
                      nextClassicFixtureProjectedScore: 30.2,
                      nextDailyFixtureProjectedScore: 30.2,
                    },
                    openedSo5Lineups: [],
                  },
                  {
                    slug: "malik-monk-2024-limited-2",
                    rarityTyped: "limited",
                    seasonYear: 2024,
                    inSeasonEligible: false,
                    grade: 1,
                    power: "1.0",
                    pictureUrl: null,
                    cardEditionName: "2024 Limited",
                    sealed: true,
                    sealedAt: "2026-11-10T12:00:00Z",
                    ownershipHistory: [{ transferType: "market" }],
                    anyTeam: { name: "Sacramento Kings", slug: "sacramento-kings" },
                    anyPlayer: {
                      slug: "malik-monk-19980204",
                      displayName: "Malik Monk",
                      age: 28,
                      anyPositions: ["basketball_guard"],
                      l10: 15,
                      l5: 18,
                      nextClassicFixtureProjectedScore: 16,
                      nextDailyFixtureProjectedScore: 16,
                    },
                    openedSo5Lineups: [],
                  },
                ];
            return new Response(
              JSON.stringify({
                data: {
                  user: {
                    cards: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes,
                    },
                  },
                  so5: {
                    featuredSo5Fixtures: [
                      {
                        slug: "nba-21-23-nov-2026",
                        displayName: "Game Week 10",
                        cutOffDate: "2026-11-21T00:00:00Z",
                        endDate: "2026-11-23T04:24:11Z",
                        aasmState: "opened",
                      },
                    ],
                  },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
        }
        return createDefaultFetchHandler()(input, init);
      };

      activeMockHandle = installChromeAndFetchMock({
        fetchHandler,
        initialStorage: {},
      });

      const queueMod = await requireContractModule<Record<string, unknown>>(
        RATE_LIMIT_MODULE,
      );
      const RateLimitQueueCtor = requireExport<
        new (opts: { maxPerMinute: number; minSpacingMs?: number }) => unknown
      >(queueMod, "RateLimitQueue", RATE_LIMIT_MODULE);
      const sorareMod = await requireContractModule<Record<string, unknown>>(
        SORARE_CLIENT_MODULE,
      );
      const SorareClientCtor = requireExport<
        new (queue: unknown) => {
          fetchUserGalleryAndFixtures: (
            username: string,
          ) => Promise<{
            cards: GalleryCardWithM2[];
            commonCards: GalleryCardWithM2[];
            fixtures: So5FixtureSummary[];
          }>;
        }
      >(sorareMod, "SorareClient", SORARE_CLIENT_MODULE);

      const client = new SorareClientCtor(
        new RateLimitQueueCtor({ maxPerMinute: 120, minSpacingMs: 0 }),
      );
      const result = await client.fetchUserGalleryAndFixtures("pjampjam");

      const proQuery = capturedQueries.find((q) => !q.includes("rarities: [common]"));
      expect(proQuery).toBeDefined();
      expect(proQuery!).toMatch(/\bsealed\b/);

      const wendell = result.cards.find(
        (c) => c.slug === "wendell-carter-jr-2026-limited-1",
      );
      const monkSealed = result.cards.find(
        (c) => c.slug === "malik-monk-2024-limited-2",
      );
      expect(wendell?.sealed).toBe(false);
      expect(wendell?.sealedAt ?? null).toBeNull();
      expect(monkSealed?.sealed).toBe(true);
      expect(monkSealed?.sealedAt).toBe("2026-11-10T12:00:00Z");
    });

    it("F11-T1-2: sealed cards (sealed: true) excluded from playable lineup pools, optimizer & portfolio", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const generate = requireExport<GenerateLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const optimizePortfolio = requireExport<OptimizePortfolioFn>(
        mod,
        "optimizeMultiCompetitionPortfolio",
        LINEUP_MATH_MODULE,
      );

      const syntheticSealedStar = makeSyntheticCard({
        slug: "sealed-superstar-55",
        playerSlug: "sealed-superstar-p",
        playerName: "Sealed Superstar",
        teamSlug: "cleveland-cavaliers",
        teamName: "Cleveland Cavaliers",
        positions: ["basketball_center"],
        starCost: 2.0,
        l10: 52.0,
        l5: 55.0,
        proj: 55.0,
        sealed: true,
        sealedAt: "2026-11-01T00:00:00Z",
      });

      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) =>
        c.slug === "wendell-carter-jr-2026-limited-1"
          ? { ...c, sealed: true, sealedAt: "2026-11-01T00:00:00Z" }
          : c,
      );
      cards.push(syntheticSealedStar);

      const opts = makeBaseOptions();
      const gen = generate(cards, {
        ...opts,
        format: "arena_contender_12",
        maxLineups: 3,
      });

      const sealedSet = new Set([
        "wendell-carter-jr-2026-limited-1",
        "sealed-superstar-55",
      ]);
      for (const ev of gen.evaluatedPool) {
        expect(sealedSet.has(ev.card.slug)).toBe(false);
      }
      for (const ln of gen.lineups) {
        expect(ln.slots).toHaveLength(5);
        for (const s of ln.slots) {
          expect(sealedSet.has(s.evaluated.card.slug)).toBe(false);
        }
      }

      const rec = recommend(cards, opts);
      expect(rec.recommendedFormat).toBeTruthy();

      const port = optimizePortfolio(cards, opts, [
        "contender_11",
        "arena_contender_12",
      ]);
      for (const ln of port.lineups) {
        for (const s of ln.slots) {
          expect(sealedSet.has(s.evaluated.card.slug)).toBe(false);
        }
      }
    });

    it("F11-T1-3: SealCandidateEvaluation ranks duplicate & low-value unlocked cards ahead of starters & locked cards", async () => {
      const lockedSet = new Set(
        ARENA_GW10_SUBMITTED_LINEUPS.flatMap((ln) => ln.cardSlugs),
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) => ({
        ...c,
        openedLineupIds: lockedSet.has(c.slug) ? ["gw10-locked"] : [],
      }));

      const evals = await resolveSealCandidates(cards, {
        currentLineups: ARENA_GW10_SUBMITTED_LINEUPS,
      });
      expect(evals.length).toBeGreaterThan(0);

      const monkDup = evals.find((e) => e.cardSlug === "malik-monk-2024-limited-2");
      const okoroDup = evals.find((e) => e.cardSlug === "isaac-okoro-2024-limited-2");
      const wendell = evals.find(
        (e) => e.cardSlug === "wendell-carter-jr-2026-limited-1",
      );
      const gordon = evals.find(
        (e) => e.cardSlug === "aaron-gordon-2026-limited-1",
      );

      expect(monkDup).toBeDefined();
      expect(okoroDup).toBeDefined();
      expect(monkDup!.isDuplicate).toBe(true);
      expect(okoroDup!.isDuplicate).toBe(true);
      expect(monkDup!.sealingPoints).toBeGreaterThan(0);
      expect(monkDup!.tier.length).toBeGreaterThan(0);
      expect(monkDup!.reason.length).toBeGreaterThan(0);

      if (wendell) {
        expect(monkDup!.score).toBeGreaterThan(wendell.score);
        expect(evals.indexOf(monkDup!)).toBeLessThan(evals.indexOf(wendell));
      }
      if (gordon) {
        expect(okoroDup!.score).toBeGreaterThan(gordon.score);
        expect(evals.indexOf(okoroDup!)).toBeLessThan(evals.indexOf(gordon));
      }
    });

    it("F11-T1-4: SealCandidateEvaluation carries explicit auto-delist, auto-cancel-lineups & 1 unseal / 14 days cooldown warnings", async () => {
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) => {
        if (c.slug === "malik-monk-2024-limited-2") {
          return { ...c, lowestAskCents: 195 };
        }
        if (c.slug === "aaron-gordon-2026-limited-1") {
          return { ...c, openedLineupIds: ["arena-gw10-classic-contender-2"] };
        }
        return c;
      });

      const evals = await resolveSealCandidates(cards, {
        currentLineups: ARENA_GW10_SUBMITTED_LINEUPS,
      });
      const combinedWarnings = evals.flatMap((e) => e.warnings).join(" | ");

      expect(combinedWarnings).toMatch(/delist/i);
      expect(combinedWarnings).toMatch(
        /cancel.*lineup|lineup.*cancel|remove.*lineup/i,
      );
      expect(combinedWarnings).toMatch(
        /1\s*(card|unseal).*14\s*day|14[-\s]*day.*cooldown|1\s*unseal\s*\/\s*14/i,
      );
    });

    it("F11-T1-5: sealing points scale by scarcity (limited < rare < super_rare < unique) & 1st-owner multiplier", async () => {
      const rarities: Rarity[] = ["limited", "rare", "super_rare", "unique"];
      const scarcityCards = rarities.map((rarity) =>
        makeSyntheticCard({
          slug: `scarcity-${rarity}`,
          playerSlug: `scarcity-p-${rarity}`,
          playerName: `Scarcity ${rarity}`,
          teamSlug: "cleveland-cavaliers",
          teamName: "Cleveland Cavaliers",
          positions: ["basketball_guard"],
          rarity,
          inSeasonEligible: false,
          seasonYear: 2025,
          l10: 20,
          proj: 20,
          isFirstOwner: false,
        }),
      );
      const firstOwnerLimited = makeSyntheticCard({
        slug: "scarcity-limited-fo",
        playerSlug: "scarcity-p-fo",
        playerName: "Scarcity FO",
        teamSlug: "cleveland-cavaliers",
        teamName: "Cleveland Cavaliers",
        positions: ["basketball_guard"],
        rarity: "limited",
        inSeasonEligible: false,
        seasonYear: 2025,
        l10: 20,
        proj: 20,
        isFirstOwner: true,
      });

      const evals = await resolveSealCandidates([
        ...scarcityCards,
        firstOwnerLimited,
      ]);

      const vp = (slug: string) =>
        evals.find((e) => e.cardSlug === slug)!.sealingPoints;
      expect(vp("scarcity-limited")).toBeLessThan(vp("scarcity-rare"));
      expect(vp("scarcity-rare")).toBeLessThan(vp("scarcity-super_rare"));
      expect(vp("scarcity-super_rare")).toBeLessThan(vp("scarcity-unique"));
      expect(vp("scarcity-limited-fo")).toBeGreaterThanOrEqual(
        vp("scarcity-limited"),
      );
    });

    it("F11-T1-6: GalleryTab SSR renders Vault guide, sealed status & 14-day/delist/cancel warnings", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        GALLERY_TAB_MODULE,
      );
      const GalleryTab = requireExport<
        React.ComponentType<{
          gallery: GalleryResult | null;
          rarity: Rarity;
          currency: Currency;
          hasUsername: boolean;
          isLoading: boolean;
          isPricingGallery: boolean;
          onRefreshGallery: () => void;
          onPriceGallery: () => void;
        }>
      >(mod, "GalleryTab", GALLERY_TAB_MODULE);

      const clonedWithSealed: GalleryCardWithM2[] = cloneCards(
        PJAMPJAM_GALLERY_CARDS,
      ).map((c) =>
        c.slug === "malik-monk-2024-limited-2"
          ? { ...c, sealed: true, sealedAt: "2026-11-10T12:00:00Z" }
          : c,
      );

      const gallery = buildPjampjamGalleryResult({
        cards: clonedWithSealed,
        commonCards: PJAMPJAM_COMMON_CARDS.map((c) => ({ ...c })),
      });

      const html = renderUiComponentToHtml(
        React.createElement(GalleryTab, {
          gallery,
          rarity: "limited",
          currency: "USD",
          hasUsername: true,
          isLoading: false,
          isPricingGallery: false,
          onRefreshGallery: () => {},
          onPriceGallery: () => {},
        }),
      );

      expect(html.length).toBeGreaterThan(200);
      expect(html).toMatch(/vault|seal/i);
      expect(html).toMatch(/14[\s-]*day/i);
      expect(html).toMatch(/delist/i);
      expect(html).toMatch(/cancel|lineup/i);
      expect(html).toMatch(/sealed/i);
    });
  });

  describe("Tier 2: BVA & Edge Cases", () => {
    it("F11-T2-1: all 42 cards sealed (sealed: true across entire gallery)", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const generate = requireExport<GenerateLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const optimizePortfolio = requireExport<OptimizePortfolioFn>(
        mod,
        "optimizeMultiCompetitionPortfolio",
        LINEUP_MATH_MODULE,
      );

      const allSealed = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) => ({
        ...c,
        sealed: true,
        sealedAt: "2026-11-15T00:00:00Z",
      }));
      const opts = makeBaseOptions();

      const gen = generate(allSealed, {
        ...opts,
        format: "contender_11",
        maxLineups: 2,
      });
      expect(gen.lineups).toEqual([]);
      expect(gen.evaluatedPool).toEqual([]);

      const port = optimizePortfolio(allSealed, opts, [
        "contender_11",
        "arena_contender_12",
      ]);
      expect(port.lineups).toEqual([]);
      expect(port.cardsUsedCount).toBe(0);

      const sealCandidates = await resolveSealCandidates(allSealed);
      expect(sealCandidates).toHaveLength(0);
    });

    it("F11-T2-2: all cards locked in open lineups or listed on market", async () => {
      const baseSubset = cloneCards(PJAMPJAM_GALLERY_CARDS.slice(0, 6)).map(
        (c, idx) => ({
          ...c,
          inSeasonEligible: false,
          seasonYear: 2025,
          openedLineupIds: idx < 3 ? ["ln-1"] : [],
          lowestAskCents: idx >= 3 ? 350 : null,
        }),
      );
      const unlockedDupControl = makeSyntheticCard({
        slug: "control-dup-unlocked",
        playerSlug: baseSubset[0].playerSlug,
        playerName: baseSubset[0].playerName,
        teamSlug: baseSubset[0].teamSlug ?? "orlando-magic",
        teamName: baseSubset[0].teamName ?? "Orlando Magic",
        positions: [...baseSubset[0].positions],
        inSeasonEligible: false,
        seasonYear: 2025,
        l10: 14,
        proj: 14,
        lowestAskCents: null,
        openedLineupIds: [],
      });

      const evals = await resolveSealCandidates([
        ...baseSubset,
        unlockedDupControl,
      ]);

      const controlEval = evals.find(
        (e) => e.cardSlug === "control-dup-unlocked",
      );
      expect(controlEval).toBeDefined();

      for (const c of baseSubset) {
        const ev = evals.find((e) => e.cardSlug === c.slug);
        expect(ev).toBeDefined();
        expect(ev!.isLockedOrListed).toBe(true);
        expect(ev!.warnings.join(" ").toLowerCase()).toMatch(
          /delist|cancel|lineup/,
        );
        expect(ev!.score).toBeLessThan(controlEval!.score);
      }
    });

    it("F11-T2-3: duplicate scarcity boundary (same player in limited vs sole copy in rare)", async () => {
      const monk2026 = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "malik-monk-2026-limited-1",
      )!;
      const monk2024 = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "malik-monk-2024-limited-2",
      )!;
      const monkRare = makeSyntheticCard({
        slug: "malik-monk-2023-rare-1",
        playerSlug: monk2026.playerSlug,
        playerName: "Malik Monk",
        teamSlug: "sacramento-kings",
        teamName: "Sacramento Kings",
        positions: ["basketball_guard"],
        rarity: "rare",
        inSeasonEligible: false,
        seasonYear: 2023,
        l10: 15,
        proj: 15,
      });

      const evals = await resolveSealCandidates([monk2026, monk2024, monkRare]);
      const limDup = evals.find((e) => e.cardSlug === "malik-monk-2024-limited-2");
      const limInSeason = evals.find(
        (e) => e.cardSlug === "malik-monk-2026-limited-1",
      );
      const rareSole = evals.find((e) => e.cardSlug === "malik-monk-2023-rare-1");

      expect(limDup).toBeDefined();
      expect(limInSeason).toBeDefined();
      expect(rareSole).toBeDefined();
      expect(limDup!.isDuplicate).toBe(true);
      expect(limDup!.score).toBeGreaterThan(limInSeason!.score);
      expect(rareSole!.isDuplicate).toBe(false);
      expect(
        evals.flatMap((e) => e.warnings).join(" ").toLowerCase(),
      ).toMatch(/scarcity|14\s*day/);
    });

    it("F11-T2-4: already-sealed card with sealedAt excluded from compareCurrentVsOptimalLineups swaps & new seal candidates", async () => {
      const mod = await requireContractModule<Record<string, unknown>>(
        LINEUP_MATH_MODULE,
      );
      const compare = requireExport<CompareLineupsFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const evalVault = requireExport<EvaluateVaultFn>(
        mod,
        "evaluateVaultVsSellRoi",
        LINEUP_MATH_MODULE,
      );

      const sealedMonk: GalleryCardWithM2 = {
        ...cloneCards(PJAMPJAM_GALLERY_CARDS).find(
          (c) => c.slug === "malik-monk-2024-limited-2",
        )!,
        l10: 45,
        l5: 48,
        sorareClassicProjected: 48,
        sorareDailyProjected: 48,
        starCost: 1.5,
        sealed: true,
        sealedAt: "2026-11-05T08:30:00Z",
      };
      const unlockedOkoro = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "isaac-okoro-2024-limited-2",
      )!;
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) =>
        c.slug === "malik-monk-2024-limited-2" ? sealedMonk : c,
      );

      const comps = compare(
        [ARENA_GW10_SUBMITTED_LINEUPS[0]],
        cards,
        makeBaseOptions(),
      );
      expect(comps).toHaveLength(1);
      // Sealed card must NEVER be suggested as a playable swap-in
      const swapIns = comps[0].swaps.map((s) => s.inPlayer);
      expect(swapIns).not.toContain("Malik Monk");

      const sealCandidates = await resolveSealCandidates([
        sealedMonk,
        unlockedOkoro,
      ]);
      expect(
        sealCandidates.some((e) => e.cardSlug === "malik-monk-2024-limited-2"),
      ).toBe(false);
      expect(
        sealCandidates.some((e) => e.cardSlug === "isaac-okoro-2024-limited-2"),
      ).toBe(true);

      const roiAdvice = evalVault(sealedMonk);
      expect(roiAdvice.action).not.toBe("SELL_CASH");
      expect(roiAdvice.action).not.toBe("SEAL_VAULT");
    });

    it("F11-T2-5: empty gallery ([]) & sparse card boundary (l10: null, lowestAskCents: null, sealed: undefined)", async () => {
      const emptyRes = await resolveSealCandidates([]);
      expect(emptyRes).toEqual([]);

      const jordan = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "jordan-miller-2025-limited-1",
      )!;
      const sparseCard: GalleryCardWithM2 = {
        ...jordan,
        l10: null,
        l5: null,
        lowestAskCents: null,
        sealed: undefined,
        openedLineupIds: undefined,
      };

      const sparseRes = await resolveSealCandidates([sparseCard]);
      expect(sparseRes).toHaveLength(1);
      const ev = sparseRes[0];
      expect(Number.isFinite(ev.score)).toBe(true);
      expect(Number.isFinite(ev.sealingPoints)).toBe(true);
      expect(ev.sealingPoints).toBeGreaterThanOrEqual(0);
      expect(ev.isLockedOrListed).toBe(false);
      expect(ev.warnings.length).toBeGreaterThan(0);
    });

    it("F11-T2-6: Common rarity cards excluded from Pro Vault sealing candidates", async () => {
      const commonCards = cloneCards(PJAMPJAM_COMMON_CARDS);
      const res = await resolveSealCandidates(commonCards);
      expect(res).toEqual([]);
    });
  });
});

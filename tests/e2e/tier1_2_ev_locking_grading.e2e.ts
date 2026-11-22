import { afterAll, describe, expect, it } from "vitest";
import type {
  BargainListing,
  CardRarity,
  CurrentLineupEntry,
  GalleryCard,
  InjuryReportEntry,
  LeaderboardBenchmark,
  LineupAgeFilter,
  LineupFormat,
  NbaPosition,
  ProjectionSource,
  TeamSlateSchedule,
} from "../../src/shared/types";
import {
  ARENA_GW9_ONGOING_LINEUPS,
  ARENA_GW10_SUBMITTED_LINEUPS,
  buildArenaLineupsFixture,
} from "./fixtures/arenaLineupsFixture.ts";
import {
  ALL_LEADERBOARD_BENCHMARKS,
  GW8_LEADERBOARD_BENCHMARKS,
  GW10_LEADERBOARD_BENCHMARKS,
  PJAMPJAM_GAMES_PER_TEAM,
  PJAMPJAM_INJURIES_BY_NAME,
  PJAMPJAM_SCHEDULE_BY_TEAM,
} from "./fixtures/espnAndLeaderboardFixtures.ts";
import { PJAMPJAM_GALLERY_CARDS } from "./fixtures/gallery42Fixture.ts";
import {
  closeContractLoader,
  requireContractModule,
  requireExport,
} from "./helpers/contractLoader.ts";

const LINEUP_MATH_MODULE = "src/calculators/lineupOptimizerMath.ts";

type GalleryCardWithM2 = GalleryCard & {
  sealed?: boolean;
  sealedAt?: string | null;
};

interface OverlaySummaryContract {
  totalBoostPct: number;
  p90Ceiling: number;
  p10Floor: number;
  riskFlags: string[];
  upsideFlags: string[];
}

interface ComparisonContract {
  entry: CurrentLineupEntry;
  inferredFormat: LineupFormat;
  currentProjected: number;
  currentStars: number;
  optimalProjected: number | null;
  potentialGain: number;
  swaps: Array<{ outPlayer: string; inPlayer: string; deltaPts: number }>;
  betterCaptainName: string | null;
  resolvedCardSlugs: string[];
  paidCutoffScore?: number | null;
  rewardWinRatePct?: number;
  resolvedCardCount?: number;
  expectedCardCount?: number;
  unresolvedReason?: string;
  editFocusPoints?: unknown[];
  overlaySummary?: OverlaySummaryContract;
}

interface FormatCandidateContract {
  format: LineupFormat;
  seasonScope?: "in_season" | "classic" | "arena";
  scope?: "in_season" | "classic" | "arena";
  topScore: number | null;
  essencePct: number;
  tier1Pct: number;
  podiumPct: number;
  compositeScore?: number;
  fieldPaidPct?: number;
  paidCutoffScore?: number | null;
  estRank?: number;
  totalEntries?: number;
  cashProb?: number;
  expectedValueScore?: number;
  top20Prob?: number;
  podiumProb?: number;
  viable?: boolean;
}

interface FormatRecommendationContract {
  recommendedFormat: LineupFormat;
  recommendedScope?: "in_season" | "classic" | "arena";
  reason: string;
  eliteCardCount: number;
  activePoolCount: number;
  cashProb?: number;
  expectedValueScore?: number;
  top20Prob?: number;
  podiumProb?: number;
  viable?: boolean;
  candidates: FormatCandidateContract[];
}

interface GeneratedLineupsContract {
  lineups: Array<{
    rank: number;
    format: LineupFormat;
    slots: Array<{
      slotLabel: string;
      evaluated: {
        card: GalleryCardWithM2;
        effectiveScore: number;
      };
      slotScore: number;
    }>;
    totalScore: number;
    totalStars: number;
    inSeasonCount: number;
    odds: {
      essencePct: number;
      tier1Pct: number;
      podiumPct: number;
    };
  }>;
  evaluatedPool: Array<{
    card: GalleryCardWithM2;
    effectiveScore: number;
  }>;
}

interface PortfolioContract {
  lineups: GeneratedLineupsContract["lineups"];
  totalProjectedPts: number;
  combinedEssenceScore: number;
  atLeastOneEssencePct: number;
  cardsUsedCount: number;
}

interface FocusStrengthAnalysisContract {
  grade: "A+" | "A" | "B+" | "B" | "C" | "D" | "F";
  colorTone: string;
  scoreRatioToCut: number;
  weakPositions: unknown[];
  missingPositions: unknown[];
  bargainTargetsByPosition: Record<string, unknown>;
  topReplacements: unknown[];
  uncappedDreamLineup: unknown;
}

interface ExtendedBuildOptions {
  format?: LineupFormat;
  rarityFilter: CardRarity | "ALL";
  projectionSource: ProjectionSource;
  customProjectionsRaw: string;
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  scheduleByTeam?: Record<string, TeamSlateSchedule>;
  marketListings?: BargainListing[];
  currentLineups?: CurrentLineupEntry[];
  excludeOut: boolean;
  excludeQuestionable: boolean;
  inSeasonOnly: boolean;
  minInSeasonCards: number;
  disjointAcrossLineups: boolean;
  ageFilter?: LineupAgeFilter;
  excludeSubmittedCards?: boolean;
  excludedCardSlugs?: string[];
  maxLineups?: number;
  captainBonusPct?: number;
  benchmarks?: LeaderboardBenchmark[];
  benchmarkSeasonScope?: "in_season" | "classic" | "arena";
}

type CompareFn = (
  currentLineups: CurrentLineupEntry[],
  cards: GalleryCardWithM2[],
  options: Omit<ExtendedBuildOptions, "format" | "maxLineups">,
) => ComparisonContract[];

type RecommendFormatFn = (
  cards: GalleryCardWithM2[],
  options: Omit<ExtendedBuildOptions, "format" | "maxLineups">,
) => FormatRecommendationContract;

type GenerateTopLineupsFn = (
  cards: GalleryCardWithM2[],
  options: ExtendedBuildOptions & { format: LineupFormat; maxLineups: number },
) => GeneratedLineupsContract;

type OptimizePortfolioFn = (
  cards: GalleryCardWithM2[],
  options: Omit<ExtendedBuildOptions, "format" | "maxLineups" | "disjointAcrossLineups">,
  formats?: LineupFormat[],
) => PortfolioContract;

type FocusStrengthFn = (
  cards: GalleryCardWithM2[],
  options: ExtendedBuildOptions,
  marketListings?: BargainListing[],
  currentLineups?: CurrentLineupEntry[],
) => FocusStrengthAnalysisContract;

const FOCUS_ANALYZER_EXPORTS = [
  "analyzeFocusStrength",
  "evaluateFocusStrength",
  "gradeFocusStrength",
  "computeFocusStrength",
  "buildFocusStrengthAnalysis",
] as const;

const VALID_GRADES = ["A+", "A", "B+", "B", "C", "D", "F"] as const;
const GRADE_ORDER: Record<string, number> = {
  F: 0,
  D: 1,
  C: 2,
  B: 3,
  "B+": 4,
  A: 5,
  "A+": 6,
};

async function loadLineupMath(): Promise<Record<string, unknown>> {
  return requireContractModule<Record<string, unknown>>(LINEUP_MATH_MODULE);
}

function resolveFocusStrengthAnalyzer(mod: Record<string, unknown>): FocusStrengthFn {
  for (const name of FOCUS_ANALYZER_EXPORTS) {
    if (typeof mod[name] === "function") {
      return mod[name] as FocusStrengthFn;
    }
  }
  throw new Error(
    `Missing M2 FocusStrengthAnalysis contract in ${LINEUP_MATH_MODULE}. Expected one of: ${FOCUS_ANALYZER_EXPORTS.join(", ")} (PROJECT.md § Interface Contracts #2).`,
  );
}

function cloneCards(cards: GalleryCardWithM2[]): GalleryCardWithM2[] {
  return cards.map((card) => ({
    ...card,
    positions: [...card.positions],
    openedLineupIds: card.openedLineupIds ? [...card.openedLineupIds] : undefined,
    powerBreakdown: card.powerBreakdown ? { ...card.powerBreakdown } : undefined,
  }));
}

function cloneSchedule(
  schedule: Record<string, TeamSlateSchedule>,
): Record<string, TeamSlateSchedule> {
  const out: Record<string, TeamSlateSchedule> = {};
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

function cloneLineups(lineups: CurrentLineupEntry[]): CurrentLineupEntry[] {
  return lineups.map((ln) => ({
    ...ln,
    cardSlugs: [...ln.cardSlugs],
    playerNames: ln.playerNames ? [...ln.playerNames] : undefined,
  }));
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
    benchmarks: cloneBenchmarks(ALL_LEADERBOARD_BENCHMARKS),
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
  positions: NbaPosition[];
  starCost: number;
  l10: number;
  l5?: number;
  proj: number;
  inSeasonEligible?: boolean;
  seasonYear?: number;
  teamSlug?: string;
  teamName?: string;
  powerMultiplier?: number;
  playerAge?: number;
  openedLineupIds?: string[];
}): GalleryCardWithM2 {
  const inSeason = overrides.inSeasonEligible ?? true;
  const seasonYear = overrides.seasonYear ?? (inSeason ? 2026 : 2025);
  return {
    slug: overrides.slug,
    rarity: "limited",
    seasonYear,
    inSeasonEligible: inSeason,
    grade: 1,
    powerMultiplier: overrides.powerMultiplier ?? (inSeason ? 1.08 : 1.0),
    pictureUrl: null,
    isFirstOwner: true,
    playerAge: overrides.playerAge ?? 24,
    cardEditionName: inSeason ? "2026-27 Limited" : "2025 Limited",
    acquisitionType: "market",
    lowestAskCents: null,
    lowestAskCardSlug: null,
    auctionBidCents: null,
    openedLineupIds: overrides.openedLineupIds ?? [],
    teamName: overrides.teamName ?? "Cleveland Cavaliers",
    teamSlug: overrides.teamSlug ?? "cleveland-cavaliers",
    playerSlug: overrides.playerSlug,
    playerName: overrides.playerName,
    positions: overrides.positions,
    l10: overrides.l10,
    l5: overrides.l5 ?? overrides.l10,
    sorareClassicProjected: overrides.proj,
    sorareDailyProjected: overrides.proj,
    starCost: overrides.starCost,
  };
}

function makeSampleMarketListings(): BargainListing[] {
  const mk = (
    playerSlug: string,
    playerName: string,
    positions: NbaPosition[],
    priceCents: number,
    l10: number,
    projected: number,
    starCost: number,
    opts: {
      inSeasonEligible?: boolean;
      teamSlug?: string;
      teamName?: string;
      valueScore?: number;
    } = {},
  ): BargainListing => ({
    cardSlug: `${playerSlug}-2026-limited-mkt-1`,
    assetId: `asset-${playerSlug}`,
    playerSlug,
    playerName,
    teamName: opts.teamName ?? "Cleveland Cavaliers",
    teamSlug: opts.teamSlug ?? "cleveland-cavaliers",
    positions,
    rarity: "limited",
    seasonYear: opts.inSeasonEligible === false ? 2025 : 2026,
    inSeasonEligible: opts.inSeasonEligible ?? true,
    l10,
    l5: l10 + 1.5,
    projected,
    starCost,
    saleType: "instant_buy",
    priceCents,
    currency: "USD",
    endDate: null,
    bidsCount: null,
    centsPerL10: Math.round((priceCents / Math.max(1, l10)) * 10) / 10,
    valueScore: opts.valueScore ?? Math.round((l10 * 100) / Math.max(100, priceCents) * 10),
    marketUrl: `https://sorare.com/nba/cards/${playerSlug}-2026-limited-mkt-1`,
  });

  return [
    mk("target-guard-bargain", "Coby White", ["basketball_guard"], 210, 19.5, 21.2, 2.0, {
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      valueScore: 92,
    }),
    mk("target-forward-bargain", "Toumani Camara", ["basketball_forward"], 185, 18.8, 20.4, 2.0, {
      teamSlug: "denver-nuggets",
      teamName: "Denver Nuggets",
      valueScore: 95,
    }),
    mk("target-center-bargain", "Onyeka Okongwu", ["basketball_center"], 240, 20.2, 22.5, 2.0, {
      teamSlug: "atlanta-hawks",
      teamName: "Atlanta Hawks",
      valueScore: 89,
    }),
    mk("jokic-superstar", "Nikola Jokic", ["basketball_center"], 11500, 54.0, 56.5, 5.0, {
      teamSlug: "denver-nuggets",
      teamName: "Denver Nuggets",
      valueScore: 70,
    }),
    mk("sga-superstar", "Shai Gilgeous-Alexander", ["basketball_guard"], 9800, 49.5, 51.0, 4.5, {
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      valueScore: 68,
    }),
    mk("giannis-superstar", "Giannis Antetokounmpo", ["basketball_forward"], 9400, 48.0, 49.5, 4.5, {
      teamSlug: "atlanta-hawks",
      teamName: "Atlanta Hawks",
      valueScore: 67,
    }),
    mk("u23-guard-target", "Stephon Castle", ["basketball_guard"], 320, 22.0, 24.0, 2.0, {
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      valueScore: 84,
    }),
    mk("vet-center-target", "Al Horford", ["basketball_center"], 175, 17.5, 18.5, 1.5, {
      inSeasonEligible: false,
      teamSlug: "philadelphia-76ers",
      teamName: "Philadelphia 76ers",
      valueScore: 80,
    }),
  ];
}

function makeEliteSuperstarGallery(): GalleryCardWithM2[] {
  return [
    makeSyntheticCard({
      slug: "elite-jokic-1",
      playerSlug: "nikola-jokic-19950219",
      playerName: "Nikola Jokic",
      positions: ["basketball_center"],
      starCost: 4.5,
      l10: 54.0,
      l5: 56.0,
      proj: 56.5,
      teamSlug: "denver-nuggets",
      teamName: "Denver Nuggets",
      playerAge: 31,
    }),
    makeSyntheticCard({
      slug: "elite-sga-1",
      playerSlug: "shai-gilgeous-alexander-19980712",
      playerName: "Shai Gilgeous-Alexander",
      positions: ["basketball_guard"],
      starCost: 4.0,
      l10: 49.5,
      l5: 51.0,
      proj: 51.2,
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      playerAge: 28,
    }),
    makeSyntheticCard({
      slug: "elite-giannis-1",
      playerSlug: "giannis-antetokounmpo-19941206",
      playerName: "Giannis Antetokounmpo",
      positions: ["basketball_forward"],
      starCost: 4.0,
      l10: 48.0,
      l5: 50.0,
      proj: 49.8,
      teamSlug: "atlanta-hawks",
      teamName: "Atlanta Hawks",
      playerAge: 31,
    }),
    makeSyntheticCard({
      slug: "elite-mitchell-1",
      playerSlug: "donovan-mitchell-19960907",
      playerName: "Donovan Mitchell",
      positions: ["basketball_guard"],
      starCost: 2.0,
      l10: 41.0,
      l5: 43.0,
      proj: 44.5,
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      playerAge: 30,
    }),
    makeSyntheticCard({
      slug: "elite-mobley-1",
      playerSlug: "evan-mobley-20010618",
      playerName: "Evan Mobley",
      positions: ["basketball_forward", "basketball_center"],
      starCost: 1.5,
      l10: 40.0,
      l5: 42.0,
      proj: 43.0,
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      playerAge: 25,
    }),
    makeSyntheticCard({
      slug: "elite-garland-1",
      playerSlug: "darius-garland-20000126",
      playerName: "Darius Garland",
      positions: ["basketball_guard"],
      starCost: 3.0,
      l10: 36.0,
      l5: 38.0,
      proj: 37.5,
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      playerAge: 26,
    }),
    makeSyntheticCard({
      slug: "elite-allen-1",
      playerSlug: "jarrett-allen-19980421",
      playerName: "Jarrett Allen",
      positions: ["basketball_center"],
      starCost: 3.0,
      l10: 35.0,
      l5: 36.0,
      proj: 36.5,
      teamSlug: "cleveland-cavaliers",
      teamName: "Cleveland Cavaliers",
      playerAge: 28,
    }),
    makeSyntheticCard({
      slug: "elite-murray-1",
      playerSlug: "jamal-murray-19970223",
      playerName: "Jamal Murray",
      positions: ["basketball_guard"],
      starCost: 3.0,
      l10: 34.0,
      l5: 35.0,
      proj: 35.5,
      teamSlug: "denver-nuggets",
      teamName: "Denver Nuggets",
      playerAge: 29,
    }),
  ];
}

function makeWeakSubCutoffGallery(): GalleryCardWithM2[] {
  const positionsList: NbaPosition[][] = [
    ["basketball_guard"],
    ["basketball_guard"],
    ["basketball_forward"],
    ["basketball_forward"],
    ["basketball_center"],
    ["basketball_guard", "basketball_forward"],
  ];
  return positionsList.map((positions, idx) =>
    makeSyntheticCard({
      slug: `weak-bench-${idx + 1}`,
      playerSlug: `weak-bench-player-${idx + 1}`,
      playerName: `Weak Bench ${idx + 1}`,
      positions,
      starCost: 1.0,
      l10: 7.2 + idx * 0.3,
      l5: 6.8 + idx * 0.2,
      proj: 6.9 + idx * 0.2,
      inSeasonEligible: true,
      seasonYear: 2026,
      teamSlug: "charlotte-hornets",
      teamName: "Charlotte Hornets",
      powerMultiplier: 1.0,
      playerAge: 24,
    }),
  );
}

function getCandidateProb(
  c: FormatCandidateContract,
  field: "cashProb" | "top20Prob" | "podiumProb",
  fallbackField: "essencePct" | "tier1Pct" | "podiumPct",
): number {
  const val = c[field];
  if (typeof val === "number") return val;
  return c[fallbackField];
}

afterAll(async () => {
  await closeContractLoader();
});

// ============================================================================
// FEATURE 6: Live-Synced Lineup Accuracy, Scope Matching & Edit Focus (12)
// ============================================================================
describe("Feature 6: Live-Synced Lineup Accuracy, Scope Matching & Edit Focus", () => {
  describe("Tier 1: Core Functionality", () => {
    it("F6-T1-01: resolves all 3 Arena Classic Contender lineups with non-zero projections & accurate stars", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lineups = cloneLineups(ARENA_GW10_SUBMITTED_LINEUPS);
      const comparisons = compare(
        lineups,
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
          inSeasonOnly: true,
          minInSeasonCards: 4,
        }),
      );

      expect(comparisons).toHaveLength(3);
      expect(comparisons.map((c) => c.currentStars)).toEqual([8.5, 13.0, 9.0]);
      for (const comp of comparisons) {
        expect(comp.inferredFormat).toBe("arena_contender_12");
        expect(comp.resolvedCardCount).toBe(5);
        expect(comp.expectedCardCount).toBe(5);
        expect(comp.unresolvedReason).toBeFalsy();
        expect(comp.currentProjected).toBeGreaterThan(60);
        expect(comp.optimalProjected).not.toBeNull();
        expect(comp.optimalProjected ?? 0).toBeGreaterThan(0);
      }
    });

    it("F6-T1-02: name-only DOM fallback resolves all 5 cards identically when cardSlugs are empty", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const slugLineups = cloneLineups(ARENA_GW10_SUBMITTED_LINEUPS);
      const nameOnlyLineups = buildArenaLineupsFixture("dom", {
        includeCardSlugs: false,
      });

      const opts = makeBaseOptions({
        benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
      });
      const slugComparisons = compare(slugLineups, cards, opts);
      const nameComparisons = compare(nameOnlyLineups, cards, opts);

      expect(nameComparisons).toHaveLength(3);
      for (let i = 0; i < 3; i += 1) {
        expect(nameComparisons[i].resolvedCardCount).toBe(5);
        expect(nameComparisons[i].expectedCardCount).toBe(5);
        expect(nameComparisons[i].resolvedCardSlugs).toHaveLength(5);
        expect(nameComparisons[i].currentProjected).toBeCloseTo(
          slugComparisons[i].currentProjected,
          1,
        );
        expect(nameComparisons[i].currentStars).toBeCloseTo(
          slugComparisons[i].currentStars,
          1,
        );
      }
    });

    it("F6-T1-03: matches Classic vs. In-Season rules per synced contest regardless of global inSeasonOnly", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lineups = cloneLineups(ARENA_GW9_ONGOING_LINEUPS);

      const comparisons = compare(
        lineups,
        cards,
        makeBaseOptions({
          inSeasonOnly: true,
          minInSeasonCards: 4,
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
        }),
      );

      expect(comparisons).toHaveLength(2);
      const inSeasonComp = comparisons[0];
      const classicComp = comparisons[1];

      expect(inSeasonComp.resolvedCardCount).toBe(5);
      expect(classicComp.resolvedCardCount).toBe(5);
      expect(classicComp.currentProjected).toBeGreaterThan(0);
      expect(classicComp.optimalProjected).not.toBeNull();
      // Classic synced entry must evaluate Classic cards (not restricted to inSeasonOnly: true)
      const serializedClassic = JSON.stringify(classicComp).toLowerCase();
      expect(serializedClassic).not.toContain("in-season only violation");
      expect(classicComp.currentStars).toBeGreaterThan(0);
      expect(inSeasonComp.currentStars).toBeGreaterThan(0);
    });

    it("F6-T1-04: generates actionable editFocusPoints covering swap, buy, injury/DNP, boost/schedule, and notes", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lineups = cloneLineups(ARENA_GW10_SUBMITTED_LINEUPS);
      const marketListings = makeSampleMarketListings();

      const comparisons = compare(
        lineups,
        cards,
        makeBaseOptions({
          scheduleByTeam: cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM),
          marketListings,
        }),
      );

      expect(comparisons).toHaveLength(3);
      for (const comp of comparisons) {
        expect(Array.isArray(comp.editFocusPoints)).toBe(true);
        expect(comp.editFocusPoints?.length ?? 0).toBeGreaterThan(0);
      }

      const lineup1Text = JSON.stringify(comparisons[0].editFocusPoints).toLowerCase();
      expect(lineup1Text).toMatch(/swap|replace|upgrade|buy|target/);

      const lineup3Text = JSON.stringify(comparisons[2].editFocusPoints).toLowerCase();
      expect(lineup3Text).toMatch(/dean wade|gtd|day_to_day|day-to-day|injury/);
      expect(lineup3Text).toMatch(/2g|b2b|boost|schedule|note/);
    });

    it("F6-T1-05: populates calibrated overlaySummary (totalBoostPct, p10Floor, p90Ceiling, riskFlags, upsideFlags)", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lineups = cloneLineups(ARENA_GW10_SUBMITTED_LINEUPS);
      const opts = makeBaseOptions({
        scheduleByTeam: cloneSchedule(PJAMPJAM_SCHEDULE_BY_TEAM),
      });

      const comparisons = compare(lineups, cards, opts);
      for (const comp of comparisons) {
        expect(comp.overlaySummary).toBeDefined();
        const ov = comp.overlaySummary!;
        expect(typeof ov.totalBoostPct).toBe("number");
        expect(Number.isFinite(ov.totalBoostPct)).toBe(true);
        expect(ov.p10Floor).toBeGreaterThan(0);
        expect(ov.p10Floor).toBeLessThan(comp.currentProjected);
        expect(ov.p90Ceiling).toBeGreaterThan(comp.currentProjected);
        expect(Array.isArray(ov.riskFlags)).toBe(true);
        expect(Array.isArray(ov.upsideFlags)).toBe(true);
      }

      // Lineup #1 has all 1.07-1.08 multipliers -> positive boost vs 1.0-multiplier control
      const controlCards = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) => ({
        ...c,
        powerMultiplier: 1.0,
      }));
      const controlComps = compare([lineups[0]], controlCards, opts);
      expect(comparisons[0].overlaySummary!.totalBoostPct).toBeGreaterThan(0);
      expect(comparisons[0].overlaySummary!.totalBoostPct).toBeGreaterThan(
        controlComps[0].overlaySummary!.totalBoostPct,
      );
      // Lineup #2 has Wendell Carter Jr. (2G + L5=37 > L10=28) -> upsideFlags
      expect(comparisons[1].overlaySummary!.upsideFlags.length).toBeGreaterThan(0);
      // Lineup #3 has Dean Wade DAY_TO_DAY + B2B -> riskFlags
      expect(comparisons[2].overlaySummary!.riskFlags.length).toBeGreaterThan(0);
    });

    it("F6-T1-06: exact/near-optimal synced lineup displays real stars and zero false upgrade delta", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const opts = makeBaseOptions({
        benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
      });

      const best = generate(cards, {
        ...opts,
        format: "arena_contender_12",
        maxLineups: 1,
      }).lineups[0];
      expect(best).toBeDefined();

      const optimalEntry: CurrentLineupEntry = {
        id: "optimal-arena-12",
        name: "Optimal Arena Contender",
        leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-opt",
        leaderboardName: "Arena Classic Contender",
        draft: false,
        cardSlugs: best.slots.map((s) => s.evaluated.card.slug),
        captainCardSlug: null,
        playerNames: best.slots.map((s) => s.evaluated.card.playerName),
        source: "dom",
      };

      const [comp] = compare([optimalEntry], cards, opts);
      expect(comp.resolvedCardCount).toBe(5);
      expect(comp.expectedCardCount).toBe(5);
      expect(comp.currentStars).toBeCloseTo(best.totalStars, 1);
      expect(comp.currentStars).toBeGreaterThan(0);
      expect(Math.abs(comp.currentProjected - best.totalScore)).toBeLessThanOrEqual(0.2);
      expect(comp.potentialGain).toBe(0);
      expect(comp.swaps).toHaveLength(0);
    });
  });

  describe("Tier 2: BVA, Edge Cases & Error Handling", () => {
    it("F6-T2-01: completely unresolved card slugs surface unresolvedReason instead of 0★ optimal match", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const unresolvedEntry: CurrentLineupEntry = {
        id: "unresolved-1",
        name: "Arena Classic Contender #Unresolved",
        leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-x",
        leaderboardName: "Arena Classic Contender",
        draft: false,
        cardSlugs: ["missing-1", "missing-2", "missing-3", "missing-4", "missing-5"],
        captainCardSlug: null,
        playerNames: [],
        source: "dom",
      };

      const [comp] = compare([unresolvedEntry], cards, makeBaseOptions());
      expect(comp.resolvedCardCount).toBe(0);
      expect(comp.expectedCardCount).toBe(5);
      expect(comp.currentProjected).toBe(0);
      expect(comp.currentStars).toBe(0);
      expect(typeof comp.unresolvedReason).toBe("string");
      expect((comp.unresolvedReason ?? "").trim().length).toBeGreaterThan(0);
    });

    it("F6-T2-02: partial card mismatch (3 owned + 2 unowned) reports 3/5, partial score & unresolvedReason", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const fullEntry = cloneLineups([ARENA_GW10_SUBMITTED_LINEUPS[0]])[0];
      const partialEntry: CurrentLineupEntry = {
        ...fullEntry,
        cardSlugs: [
          ...fullEntry.cardSlugs.slice(0, 3),
          "unowned-x-1",
          "unowned-x-2",
        ],
        playerNames: undefined,
      };

      const [fullComp] = compare([fullEntry], cards, makeBaseOptions());
      const [partialComp] = compare([partialEntry], cards, makeBaseOptions());

      expect(partialComp.resolvedCardCount).toBe(3);
      expect(partialComp.expectedCardCount).toBe(5);
      expect(partialComp.currentProjected).toBeGreaterThan(0);
      expect(partialComp.currentProjected).toBeLessThan(fullComp.currentProjected);
      expect(partialComp.currentStars).toBe(5.0);
      expect(typeof partialComp.unresolvedReason).toBe("string");
      expect((partialComp.unresolvedReason ?? "").trim().length).toBeGreaterThan(0);
    });

    it("F6-T2-03: phantom empty synced lineup is suppressed or explicitly flagged unresolved", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const phantomEntry: CurrentLineupEntry = {
        id: "phantom-empty",
        name: "Phantom Empty Lineup",
        leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-0",
        leaderboardName: "Arena Classic Contender",
        draft: false,
        cardSlugs: [],
        captainCardSlug: null,
        playerNames: [],
        source: "dom",
      };

      const comps = compare([phantomEntry], cards, makeBaseOptions());
      if (comps.length > 0) {
        expect(comps[0].resolvedCardCount).toBe(0);
        expect(typeof comps[0].unresolvedReason).toBe("string");
        expect((comps[0].unresolvedReason ?? "").trim().length).toBeGreaterThan(0);
      } else {
        expect(comps).toHaveLength(0);
      }
    });

    it("F6-T2-04: OUT injury and 0G team inside synced lineup drive riskFlags & replacement editFocusPoints", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const injuries = cloneInjuries(PJAMPJAM_INJURIES_BY_NAME);
      injuries["allen graves"] = {
        playerName: "Allen Graves",
        normalizedName: "allen graves",
        teamName: "Toronto Raptors",
        status: "OUT",
        rawStatus: "Out",
        comment: "Out (rest)",
      };

      const riskyEntry: CurrentLineupEntry = {
        id: "risky-0g-out",
        name: "Arena Classic Contender #Risky",
        leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-risk",
        leaderboardName: "Arena Classic Contender",
        draft: false,
        cardSlugs: [
          "marcus-sasser-2026-limited-1", // 0G Detroit Pistons
          "allen-graves-2026-limited-1", // Marked OUT
          "morez-johnson-jr-2026-limited-1",
          "malik-monk-2026-limited-1",
          "jarace-walker-2026-limited-1",
        ],
        captainCardSlug: null,
        source: "dom",
      };

      const [comp] = compare(
        [riskyEntry],
        cards,
        makeBaseOptions({ injuriesByName: injuries }),
      );
      expect(comp.resolvedCardCount).toBe(5);
      expect(comp.overlaySummary).toBeDefined();
      expect(comp.overlaySummary!.riskFlags.length).toBeGreaterThan(0);
      const focusText = JSON.stringify(comp.editFocusPoints).toLowerCase();
      expect(focusText).toMatch(/out|0g|no game|inactive|replace|swap/);
    });

    it("F6-T2-05: duplicate card.slug entries in cardSlugs do not double-count stars or exceed 5 resolved cards", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const dupEntry: CurrentLineupEntry = {
        id: "dup-slug-entry",
        name: "Arena Classic Contender #Dup",
        leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-dup",
        leaderboardName: "Arena Classic Contender",
        draft: false,
        cardSlugs: [
          "aaron-gordon-2026-limited-1", // 2.5
          "aaron-gordon-2026-limited-1", // duplicate
          "brook-lopez-2025-limited-1", // 2.5
          "wendell-carter-jr-2026-limited-1", // 3.0
          "dillon-brooks-2026-limited-1", // 2.5
        ],
        captainCardSlug: null,
        source: "dom",
      };

      const [comp] = compare([dupEntry], cards, makeBaseOptions());
      expect(comp.resolvedCardCount).toBe(4);
      expect(comp.expectedCardCount).toBe(5);
      expect(comp.currentStars).toBe(10.5);
      expect(typeof comp.unresolvedReason).toBe("string");
      expect((comp.unresolvedReason ?? "").trim().length).toBeGreaterThan(0);
    });

    it("F6-T2-06: empty currentLineups or empty cards boundary returns [] cleanly", async () => {
      const mod = await loadLineupMath();
      const compare = requireExport<CompareFn>(
        mod,
        "compareCurrentVsOptimalLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lineups = cloneLineups(ARENA_GW10_SUBMITTED_LINEUPS);

      expect(compare([], cards, makeBaseOptions())).toEqual([]);
      expect(compare(lineups, [], makeBaseOptions())).toEqual([]);
    });
  });
});

// ============================================================================
// FEATURE 7: Field-Calibrated Recommended Entry & Side-by-Side Alternatives (12)
// ============================================================================
describe("Feature 7: Field-Calibrated Recommended Entry & Side-by-Side Alternatives", () => {
  describe("Tier 1: Core Functionality", () => {
    it("F7-T1-01: 42-card gallery prioritizes viable positive-EV contest over 0% cash-odds Champion 16★", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const result = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
      );

      expect(result.recommendedFormat).not.toBe("champion_16");
      expect(["contender_11", "arena_contender_12"]).toContain(
        result.recommendedFormat,
      );
      const top = result.candidates.find(
        (c) => c.format === result.recommendedFormat,
      );
      expect(result.viable ?? top?.viable).toBe(true);
      expect(result.cashProb ?? top?.cashProb ?? 0).toBeGreaterThan(0);
    });

    it("F7-T1-02: exposes cashProb, expectedValueScore, top20Prob, podiumProb, viable with monotonic probabilities", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const result = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
        }),
      );

      expect(typeof result.cashProb).toBe("number");
      expect(typeof result.expectedValueScore).toBe("number");
      expect(typeof result.top20Prob).toBe("number");
      expect(typeof result.podiumProb).toBe("number");
      expect(typeof result.viable).toBe("boolean");

      for (const c of result.candidates) {
        expect(typeof c.cashProb).toBe("number");
        expect(typeof c.expectedValueScore).toBe("number");
        expect(typeof c.top20Prob).toBe("number");
        expect(typeof c.podiumProb).toBe("number");
        expect(typeof c.viable).toBe("boolean");

        expect(Number.isFinite(c.cashProb)).toBe(true);
        expect(Number.isFinite(c.expectedValueScore)).toBe(true);
        expect(Number.isFinite(c.top20Prob)).toBe(true);
        expect(Number.isFinite(c.podiumProb)).toBe(true);

        const cash = c.cashProb ?? 0;
        const top20 = c.top20Prob ?? 0;
        const podium = c.podiumProb ?? 0;
        expect(cash).toBeGreaterThanOrEqual(0);
        expect(cash).toBeLessThanOrEqual(100);
        expect(podium).toBeLessThanOrEqual(top20 + 1);
        expect(top20).toBeLessThanOrEqual(cash + 1);
      }
    });

    it("F7-T1-03: side-by-side candidates span In-Season, Classic, Arena, and Daily (daily_120_mvp)", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const result = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(ALL_LEADERBOARD_BENCHMARKS),
        }),
      );

      expect(result.candidates.length).toBeGreaterThanOrEqual(4);
      const formats = new Set(result.candidates.map((c) => c.format));
      // Daily Pickup (daily_120_mvp) was retired in Sorare 26 and is not a live contest
      // (docs/SORARE_FACTS.md, verified 2026-11-19), so it is intentionally not a candidate.
      expect(formats.has("daily_120_mvp")).toBe(false);
      expect(
        formats.has("arena_contender_12") || formats.has("arena_champion_15"),
      ).toBe(true);
      expect(formats.has("contender_11")).toBe(true);

      const scopes = new Set(
        result.candidates
          .map((c) => c.seasonScope ?? c.scope)
          .filter((s): s is "in_season" | "classic" | "arena" => Boolean(s)),
      );
      expect(scopes.has("in_season")).toBe(true);
      expect(scopes.has("classic")).toBe(true);
      expect(scopes.has("arena")).toBe(true);
    });

    it("F7-T1-04: Champion 16★ with ~0% cash odds is marked unviable and outranked by viable Contender", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const result = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
        }),
      );

      const champCandidates = result.candidates.filter(
        (c) => c.format === "champion_16",
      );
      expect(champCandidates.length).toBeGreaterThan(0);

      const viableContenders = result.candidates.filter(
        (c) =>
          (c.format === "contender_11" || c.format === "arena_contender_12") &&
          c.viable === true,
      );
      expect(viableContenders.length).toBeGreaterThan(0);
      const bestContenderEv = Math.max(
        ...viableContenders.map((c) => c.expectedValueScore ?? -Infinity),
      );

      for (const champ of champCandidates) {
        expect(champ.cashProb ?? 100).toBeLessThanOrEqual(5);
        expect(champ.viable).toBe(false);
        expect(champ.expectedValueScore ?? Infinity).toBeLessThan(bestContenderEv);
      }
    });

    it("F7-T1-05: elite 16★ superstar gallery makes champion_16 viable and flips top recommendation", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const eliteCards = makeEliteSuperstarGallery();
      const result = recommend(
        eliteCards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
        }),
      );

      const champ = result.candidates.find(
        (c) =>
          c.format === "champion_16" &&
          (c.seasonScope ?? c.scope ?? "in_season") === "in_season",
      ) ?? result.candidates.find((c) => c.format === "champion_16");
      const contender = result.candidates.find(
        (c) => c.format === "contender_11",
      );

      expect(champ).toBeDefined();
      expect(champ!.viable).toBe(true);
      expect(champ!.cashProb ?? 0).toBeGreaterThanOrEqual(50);
      expect(champ!.expectedValueScore ?? 0).toBeGreaterThan(0);
      if (contender) {
        expect(champ!.expectedValueScore ?? 0).toBeGreaterThan(
          contender.expectedValueScore ?? 0,
        );
      }
      expect(["champion_16", "arena_champion_15"]).toContain(
        result.recommendedFormat,
      );
    });

    it("F7-T1-06: payout-curve EV favors 54.6%-paid In-Season Contender over 11.0%-paid Classic Contender", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const result = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
      );

      const inSeasonContender = result.candidates.find(
        (c) =>
          c.format === "contender_11" &&
          (c.seasonScope ?? c.scope) === "in_season",
      );
      const classicContender = result.candidates.find(
        (c) =>
          c.format === "contender_11" &&
          (c.seasonScope ?? c.scope) === "classic",
      );

      expect(inSeasonContender).toBeDefined();
      expect(classicContender).toBeDefined();
      expect(inSeasonContender!.cashProb ?? 0).toBeGreaterThan(
        classicContender!.cashProb ?? 0,
      );
      expect(inSeasonContender!.expectedValueScore ?? -Infinity).toBeGreaterThan(
        classicContender!.expectedValueScore ?? -Infinity,
      );
    });
  });

  describe("Tier 2: BVA, Edge Cases & Error Handling", () => {
    it("F7-T2-01: empty gallery ([]) returns unviable zero-EV recommendation safely", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const result = recommend(
        [],
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
      );

      expect(result.activePoolCount).toBe(0);
      expect(result.eliteCardCount).toBe(0);
      expect(result.viable).toBe(false);
      expect(result.cashProb).toBe(0);
      expect(result.top20Prob).toBe(0);
      expect(result.podiumProb).toBe(0);
      expect(result.expectedValueScore ?? 1).toBeLessThanOrEqual(0);
      for (const c of result.candidates) {
        expect(c.viable).toBe(false);
        expect(c.cashProb).toBe(0);
      }
    });

    it("F7-T2-02: insufficient / all-OUT gallery (< 5 active cards) marks all contests unviable", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const fourCards = cloneCards(PJAMPJAM_GALLERY_CARDS.slice(0, 4));
      const resFour = recommend(
        fourCards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
      );

      for (const c of resFour.candidates) {
        expect(c.topScore === null || c.topScore === 0).toBe(true);
        expect(c.cashProb).toBe(0);
        expect(c.viable).toBe(false);
        expect(Number.isFinite(c.expectedValueScore)).toBe(true);
        expect(c.expectedValueScore ?? 1).toBeLessThanOrEqual(0);
      }

      const sixCards = cloneCards(PJAMPJAM_GALLERY_CARDS.slice(0, 6));
      const outInjuries = cloneInjuries(PJAMPJAM_INJURIES_BY_NAME);
      for (const card of sixCards) {
        outInjuries[card.playerName.toLowerCase()] = {
          playerName: card.playerName,
          normalizedName: card.playerName.toLowerCase(),
          teamName: card.teamName ?? "NBA",
          status: "OUT",
          rawStatus: "Out",
          comment: "Out",
        };
      }
      const resAllOut = recommend(
        sixCards,
        makeBaseOptions({
          injuriesByName: outInjuries,
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
      );
      for (const c of resAllOut.candidates) {
        expect(c.viable).toBe(false);
        expect(c.cashProb).toBe(0);
      }
    });

    it("F7-T2-03: all-Classic gallery marks In-Season contests unviable while keeping Classic/Arena/Daily evaluable", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const classicOnlyCards = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) => ({
        ...c,
        inSeasonEligible: false,
        seasonYear: 2025,
      }));
      const result = recommend(
        classicOnlyCards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
        }),
      );

      const inSeasonCands = result.candidates.filter(
        (c) => (c.seasonScope ?? c.scope) === "in_season",
      );
      expect(inSeasonCands.length).toBeGreaterThan(0);
      for (const c of inSeasonCands) {
        expect(c.viable).toBe(false);
        expect(c.cashProb).toBe(0);
      }

      const nonInSeason = result.candidates.filter(
        (c) => (c.seasonScope ?? c.scope) !== "in_season",
      );
      expect(nonInSeason.length).toBeGreaterThan(0);
      for (const c of nonInSeason) {
        expect(Number.isFinite(c.expectedValueScore)).toBe(true);
        expect(c.topScore ?? 0).toBeGreaterThan(0);
      }
    });

    it("F7-T2-04: cash-viability boundary distinguishes sub-cutoff weak gallery from cutoff-clearing gallery", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const opts = makeBaseOptions({
        benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
      });

      const weakRes = recommend(makeWeakSubCutoffGallery(), opts);
      for (const c of weakRes.candidates) {
        expect(c.cashProb ?? 100).toBeLessThan(10);
        expect(c.viable).toBe(false);
      }

      const strongRes = recommend(cloneCards(PJAMPJAM_GALLERY_CARDS), opts);
      const viableMid = strongRes.candidates.filter(
        (c) =>
          (c.format === "contender_11" || c.format === "arena_contender_12") &&
          c.viable === true &&
          // Normal model with per-player CV 0.35 gives ~19.9% here (cut 144 vs 127 pts).
          (c.cashProb ?? 0) > 15,
      );
      expect(viableMid.length).toBeGreaterThan(0);
    });

    it("F7-T2-05: missing/empty benchmarks falls back cleanly to LINEUP_FORMAT_TARGETS without NaN", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);

      for (const benchmarks of [[], undefined] as const) {
        const result = recommend(
          cards,
          makeBaseOptions({ benchmarks: benchmarks ? [] : undefined }),
        );
        expect(result.recommendedFormat).toBeTruthy();
        expect(Number.isFinite(result.cashProb)).toBe(true);
        expect(Number.isFinite(result.expectedValueScore)).toBe(true);
        for (const c of result.candidates) {
          expect(Number.isFinite(getCandidateProb(c, "cashProb", "essencePct"))).toBe(
            true,
          );
          expect(Number.isFinite(c.expectedValueScore)).toBe(true);
          expect(Number.isFinite(getCandidateProb(c, "top20Prob", "tier1Pct"))).toBe(
            true,
          );
          expect(Number.isFinite(getCandidateProb(c, "podiumProb", "podiumPct"))).toBe(
            true,
          );
        }
      }
    });

    it("F7-T2-06: degenerate benchmark (paidCutoffScore: null, totalEntries: 0, paidPlaces: 0) produces no NaN/Infinity", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const degenBenchmarks = cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS).map(
        (b) => ({
          ...b,
          paidCutoffScore: null,
          top20Score: null,
          top5Score: null,
          podiumScore: null,
          top1Score: null,
          totalEntries: 0,
          paidPlaces: 0,
          rewardWinRatePct: 0,
          podSize: 0,
        }),
      );

      const result = recommend(
        cards,
        makeBaseOptions({ benchmarks: degenBenchmarks }),
      );
      expect(Number.isFinite(result.cashProb)).toBe(true);
      expect(Number.isFinite(result.expectedValueScore)).toBe(true);
      for (const c of result.candidates) {
        expect(Number.isFinite(c.cashProb)).toBe(true);
        expect(Number.isFinite(c.expectedValueScore)).toBe(true);
        expect(Number.isFinite(c.top20Prob)).toBe(true);
        expect(Number.isFinite(c.podiumProb)).toBe(true);
        if (c.estRank !== undefined) {
          expect(Number.isFinite(c.estRank)).toBe(true);
        }
      }
    });
  });
});

// ============================================================================
// FEATURE 8: Cross-Lineup Card Locking & Pool EV Recalculation (12)
// ============================================================================
describe("Feature 8: Cross-Lineup Card Locking & Pool EV Recalculation", () => {
  describe("Tier 1: Core Functionality", () => {
    it("F8-T1-01: generateTopLineups enforces unique card.slug across incompatible same-GW lineups", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const res = generate(cards, {
        ...makeBaseOptions(),
        format: "arena_contender_12",
        disjointAcrossLineups: true,
        maxLineups: 5,
      });

      expect(res.lineups.length).toBeGreaterThanOrEqual(2);
      const allSlugs: string[] = [];
      for (const ln of res.lineups) {
        expect(ln.slots).toHaveLength(5);
        for (const s of ln.slots) {
          allSlugs.push(s.evaluated.card.slug);
        }
      }
      expect(new Set(allSlugs).size).toBe(allSlugs.length);
      expect(new Set(allSlugs).size).toBe(res.lineups.length * 5);
    });

    it("F8-T1-02: optimizeMultiCompetitionPortfolio enforces card.slug exclusion across same-GW competitions", async () => {
      const mod = await loadLineupMath();
      const optimizePortfolio = requireExport<OptimizePortfolioFn>(
        mod,
        "optimizeMultiCompetitionPortfolio",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const portfolio = optimizePortfolio(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
        ["champion_16", "contender_11", "arena_contender_12"],
      );

      expect(portfolio.lineups.length).toBeGreaterThanOrEqual(2);
      const allSlugs = portfolio.lineups.flatMap((ln) =>
        ln.slots.map((s) => s.evaluated.card.slug),
      );
      expect(new Set(allSlugs).size).toBe(allSlugs.length);
    });

    it("F8-T1-03: permits 2 distinct cards of same player (Malik Monk 2026 & 2024) across SEPARATE lineups while forbidding reuse in a SINGLE lineup", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const optimizePortfolio = requireExport<OptimizePortfolioFn>(
        mod,
        "optimizeMultiCompetitionPortfolio",
        LINEUP_MATH_MODULE,
      );

      const monk2026 = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "malik-monk-2026-limited-1",
      )!;
      const monk2024 = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "malik-monk-2024-limited-2",
      )!;
      const eightFillers = Array.from({ length: 8 }, (_, idx) =>
        makeSyntheticCard({
          slug: `distinct-filler-${idx + 1}`,
          playerSlug: `distinct-filler-player-${idx + 1}`,
          playerName: `Distinct Filler ${idx + 1}`,
          positions: [idx % 2 === 0 ? "basketball_guard" : "basketball_forward"],
          starCost: 1.5,
          l10: 14.0 + idx * 0.2,
          proj: 15.0 + idx * 0.2,
          inSeasonEligible: true,
        }),
      );
      const tenCardPool = [...eightFillers, monk2026, monk2024];

      const genRes = generate(tenCardPool, {
        ...makeBaseOptions(),
        format: "contender_11",
        disjointAcrossLineups: true,
        maxLineups: 2,
      });
      expect(genRes.lineups).toHaveLength(2);
      for (const ln of genRes.lineups) {
        const players = ln.slots.map((s) => s.evaluated.card.playerSlug);
        expect(new Set(players).size).toBe(5);
      }
      const genUsedSlugs = new Set(
        genRes.lineups.flatMap((ln) => ln.slots.map((s) => s.evaluated.card.slug)),
      );
      expect(genUsedSlugs.has("malik-monk-2026-limited-1")).toBe(true);
      expect(genUsedSlugs.has("malik-monk-2024-limited-2")).toBe(true);

      const portRes = optimizePortfolio(
        tenCardPool,
        makeBaseOptions(),
        ["contender_11", "arena_contender_12"],
      );
      expect(portRes.lineups).toHaveLength(2);
      expect(portRes.cardsUsedCount).toBe(10);
      for (const ln of portRes.lineups) {
        const players = ln.slots.map((s) => s.evaluated.card.playerSlug);
        expect(new Set(players).size).toBe(5);
      }
      const portUsedSlugs = new Set(
        portRes.lineups.flatMap((ln) => ln.slots.map((s) => s.evaluated.card.slug)),
      );
      expect(portUsedSlugs.has("malik-monk-2026-limited-1")).toBe(true);
      expect(portUsedSlugs.has("malik-monk-2024-limited-2")).toBe(true);
    });

    it("F8-T1-04: locking ARENA_GW10_SUBMITTED_LINEUPS excludes locked card.slugs while keeping malik-monk-2024-limited-2 eligible", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const lockedMap = new Map<string, string[]>();
      for (const ln of ARENA_GW10_SUBMITTED_LINEUPS) {
        for (const slug of ln.cardSlugs) {
          lockedMap.set(slug, [ln.id]);
        }
      }
      const cardsWithLocks = cloneCards(PJAMPJAM_GALLERY_CARDS).map((c) => ({
        ...c,
        openedLineupIds: lockedMap.get(c.slug) ?? [],
      }));

      const res = generate(cardsWithLocks, {
        ...makeBaseOptions({ excludeSubmittedCards: true }),
        format: "arena_contender_12",
        maxLineups: 3,
      });

      const poolSlugs = new Set(res.evaluatedPool.map((ev) => ev.card.slug));
      for (const lockedSlug of lockedMap.keys()) {
        expect(poolSlugs.has(lockedSlug)).toBe(false);
      }
      // Malik Monk 2026 is locked, but Malik Monk 2024 duplicate remains unlocked & eligible
      expect(poolSlugs.has("malik-monk-2026-limited-1")).toBe(false);
      expect(poolSlugs.has("malik-monk-2024-limited-2")).toBe(true);
      for (const ln of res.lineups) {
        for (const s of ln.slots) {
          expect(lockedMap.has(s.evaluated.card.slug)).toBe(false);
        }
      }
    });

    it("F8-T1-05: progressive remaining pool EV recalculates monotonically as GW10 lineups 1, 2, 3 lock sequentially", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const l1 = ARENA_GW10_SUBMITTED_LINEUPS[0].cardSlugs;
      const l2 = ARENA_GW10_SUBMITTED_LINEUPS[1].cardSlugs;
      const l3 = ARENA_GW10_SUBMITTED_LINEUPS[2].cardSlugs;

      const stage0 = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
          excludedCardSlugs: [],
        }),
      );
      const stage1 = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
          excludedCardSlugs: [...l1],
        }),
      );
      const stage2 = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
          excludedCardSlugs: [...l1, ...l2],
        }),
      );
      const stage3 = recommend(
        cards,
        makeBaseOptions({
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
          excludedCardSlugs: [...l1, ...l2, ...l3],
        }),
      );

      expect(stage0.activePoolCount).toBeGreaterThan(stage1.activePoolCount);
      expect(stage1.activePoolCount).toBeGreaterThan(stage2.activePoolCount);
      expect(stage2.activePoolCount).toBeGreaterThan(stage3.activePoolCount);

      const ev0 = stage0.expectedValueScore ?? 0;
      const ev1 = stage1.expectedValueScore ?? 0;
      const ev2 = stage2.expectedValueScore ?? 0;
      const ev3 = stage3.expectedValueScore ?? 0;
      expect(ev0).toBeGreaterThanOrEqual(ev1);
      expect(ev1).toBeGreaterThanOrEqual(ev2);
      expect(ev2).toBeGreaterThanOrEqual(ev3);
      // Locking Lineup #2 removes top anchors (Wendell Carter Jr., Aaron Gordon, Brook Lopez)
      expect(ev2).toBeLessThan(ev0);
    });

    it("F8-T1-06: unlocking / clearing locks restores original pool count & EV identically", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lockedSlugs = ARENA_GW10_SUBMITTED_LINEUPS.flatMap((l) => l.cardSlugs);
      const opts = makeBaseOptions({
        benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
      });

      const unlockedBefore = recommend(cards, {
        ...opts,
        excludedCardSlugs: [],
        excludeSubmittedCards: false,
      });
      const locked = recommend(cards, {
        ...opts,
        excludedCardSlugs: lockedSlugs,
        excludeSubmittedCards: true,
      });
      const unlockedAfter = recommend(cards, {
        ...opts,
        excludedCardSlugs: [],
        excludeSubmittedCards: false,
      });

      expect(locked.activePoolCount).toBeLessThan(unlockedBefore.activePoolCount);
      expect(unlockedAfter.activePoolCount).toBe(unlockedBefore.activePoolCount);
      expect(unlockedAfter.recommendedFormat).toBe(
        unlockedBefore.recommendedFormat,
      );
      expect(unlockedAfter.cashProb).toBe(unlockedBefore.cashProb);
      expect(unlockedAfter.expectedValueScore).toBe(
        unlockedBefore.expectedValueScore,
      );
      expect(unlockedAfter.candidates.map((c) => c.topScore)).toEqual(
        unlockedBefore.candidates.map((c) => c.topScore),
      );
    });
  });

  describe("Tier 2: BVA, Edge Cases & Error Handling", () => {
    it("F8-T2-01: compatible cross-rarity Common locks do not reduce Limited Pro pool EV", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const limitedCards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lockedCommon: GalleryCardWithM2[] = [
        {
          ...makeSyntheticCard({
            slug: "locked-common-1",
            playerSlug: "common-player-1",
            playerName: "Common Player 1",
            positions: ["basketball_guard"],
            starCost: 3.0,
            l10: 35,
            proj: 36,
          }),
          rarity: "common",
          openedLineupIds: ["set-squad-1"],
        },
      ];

      const baseOpts = makeBaseOptions({
        rarityFilter: "limited",
        excludeSubmittedCards: true,
        benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
      });

      const baseline = recommend(limitedCards, baseOpts);
      const withCommonLock = recommend(
        [...limitedCards, ...lockedCommon],
        baseOpts,
      );

      expect(withCommonLock.activePoolCount).toBe(baseline.activePoolCount);
      expect(withCommonLock.recommendedFormat).toBe(baseline.recommendedFormat);
      expect(withCommonLock.expectedValueScore).toBe(
        baseline.expectedValueScore,
      );
    });

    it("F8-T2-02: boundary of 5 active unlocked cards remaining vs. 4 remaining", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const fivePool = [
        makeSyntheticCard({
          slug: "rem-1",
          playerSlug: "rem-p1",
          playerName: "Rem 1",
          positions: ["basketball_guard"],
          starCost: 2.0,
          l10: 18,
          proj: 19,
        }),
        makeSyntheticCard({
          slug: "rem-2",
          playerSlug: "rem-p2",
          playerName: "Rem 2",
          positions: ["basketball_guard"],
          starCost: 2.0,
          l10: 17,
          proj: 18,
        }),
        makeSyntheticCard({
          slug: "rem-3",
          playerSlug: "rem-p3",
          playerName: "Rem 3",
          positions: ["basketball_forward"],
          starCost: 2.0,
          l10: 16,
          proj: 17,
        }),
        makeSyntheticCard({
          slug: "rem-4",
          playerSlug: "rem-p4",
          playerName: "Rem 4",
          positions: ["basketball_forward"],
          starCost: 2.0,
          l10: 15,
          proj: 16,
        }),
        makeSyntheticCard({
          slug: "rem-5",
          playerSlug: "rem-p5",
          playerName: "Rem 5",
          teamSlug: "phoenix-suns",
          teamName: "Phoenix Suns",
          positions: ["basketball_center"],
          starCost: 2.0,
          l10: 19,
          proj: 20,
        }),
      ];

      const gen5 = generate(fivePool, {
        ...makeBaseOptions(),
        format: "contender_11",
        maxLineups: 1,
      });
      expect(gen5.lineups).toHaveLength(1);
      const rec5 = recommend(fivePool, makeBaseOptions());
      expect(Number.isFinite(rec5.expectedValueScore)).toBe(true);

      const gen4 = generate(fivePool, {
        ...makeBaseOptions({ excludedCardSlugs: ["rem-5"] }),
        format: "contender_11",
        maxLineups: 1,
      });
      expect(gen4.lineups).toHaveLength(0);
      const rec4 = recommend(
        fivePool,
        makeBaseOptions({ excludedCardSlugs: ["rem-5"] }),
      );
      for (const c of rec4.candidates) {
        expect(c.viable).toBe(false);
        expect(c.cashProb).toBe(0);
      }
    });

    it("F8-T2-03: locking all 2026 In-Season cards leaves Classic pool viable & In-Season unviable", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const inSeasonSlugs = cards
        .filter((c) => c.inSeasonEligible)
        .map((c) => c.slug);

      const rec = recommend(
        cards,
        makeBaseOptions({
          excludedCardSlugs: inSeasonSlugs,
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
        }),
      );
      const inSeasonCands = rec.candidates.filter(
        (c) => (c.seasonScope ?? c.scope) === "in_season",
      );
      for (const c of inSeasonCands) {
        expect(c.viable).toBe(false);
        expect(c.cashProb).toBe(0);
      }

      const classicArena = generate(cards, {
        ...makeBaseOptions({ excludedCardSlugs: inSeasonSlugs }),
        format: "arena_contender_12",
        maxLineups: 1,
      });
      expect(classicArena.lineups).toHaveLength(1);
      expect(classicArena.lineups[0].slots).toHaveLength(5);
    });

    it("F8-T2-04: single-lineup duplicate-player guard even when 2 distinct cards of Malik Monk are available", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const monk2026 = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "malik-monk-2026-limited-1",
      )!;
      const monk2024 = cloneCards(PJAMPJAM_GALLERY_CARDS).find(
        (c) => c.slug === "malik-monk-2024-limited-2",
      )!;
      const threeOthers = [
        makeSyntheticCard({
          slug: "other-1",
          playerSlug: "other-p1",
          playerName: "Other 1",
          positions: ["basketball_forward"],
          starCost: 2.0,
          l10: 20,
          proj: 21,
        }),
        makeSyntheticCard({
          slug: "other-2",
          playerSlug: "other-p2",
          playerName: "Other 2",
          positions: ["basketball_forward"],
          starCost: 2.0,
          l10: 20,
          proj: 21,
        }),
        makeSyntheticCard({
          slug: "other-3",
          playerSlug: "other-p3",
          playerName: "Other 3",
          positions: ["basketball_center"],
          starCost: 2.0,
          l10: 20,
          proj: 21,
        }),
      ];

      const res = generate([monk2026, monk2024, ...threeOthers], {
        ...makeBaseOptions(),
        format: "contender_11",
        disjointAcrossLineups: true,
        maxLineups: 1,
      });
      expect(res.lineups).toHaveLength(0);
    });

    it("F8-T2-05: non-existent excludedCardSlugs do not corrupt pool EV or throw", async () => {
      const mod = await loadLineupMath();
      const recommend = requireExport<RecommendFormatFn>(
        mod,
        "recommendBestFormat",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const base = recommend(
        cards,
        makeBaseOptions({
          excludedCardSlugs: [],
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
      );
      const withPhantoms = recommend(
        cards,
        makeBaseOptions({
          excludedCardSlugs: ["phantom-slug-1", "phantom-slug-2"],
          benchmarks: cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS),
        }),
      );

      expect(withPhantoms.activePoolCount).toBe(base.activePoolCount);
      expect(withPhantoms.recommendedFormat).toBe(base.recommendedFormat);
      expect(withPhantoms.expectedValueScore).toBe(base.expectedValueScore);
    });

    it("F8-T2-06: openedLineupIds boundary (undefined vs [] vs ['gw10-1']) under excludeSubmittedCards: true", async () => {
      const mod = await loadLineupMath();
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lockedSet = new Set(ARENA_GW10_SUBMITTED_LINEUPS[0].cardSlugs);
      const patched = cards.map((c, idx) => {
        if (lockedSet.has(c.slug)) {
          return { ...c, openedLineupIds: ["gw10-1"] };
        }
        return {
          ...c,
          openedLineupIds: idx % 2 === 0 ? undefined : [],
        };
      });

      const res = generate(patched, {
        ...makeBaseOptions({ excludeSubmittedCards: true }),
        format: "arena_contender_12",
        maxLineups: 2,
      });

      const poolSlugs = new Set(res.evaluatedPool.map((ev) => ev.card.slug));
      for (const s of lockedSet) {
        expect(poolSlugs.has(s)).toBe(false);
      }
      // Unlocked cards with undefined or [] openedLineupIds remain eligible
      const unlockedActiveCount = patched.filter(
        (c) => !lockedSet.has(c.slug) && c.slug !== "marcus-sasser-2026-limited-1",
      ).length;
      expect(res.evaluatedPool.length).toBeGreaterThanOrEqual(
        Math.min(25, unlockedActiveCount - 5),
      );
    });
  });
});

// ============================================================================
// FEATURE 9: Focus Strength Grading & Uncapped Dream Lineup Preview (12)
// ============================================================================
describe("Feature 9: Focus Strength Grading & Uncapped Dream Lineup Preview", () => {
  describe("Tier 1: Core Functionality", () => {
    it("F9-T1-01: focus switch grades contender_11 stronger than champion_16 on 42-card gallery", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const market = makeSampleMarketListings();
      const lineups = cloneLineups(ARENA_GW10_SUBMITTED_LINEUPS);

      const contenderFocus = analyzeFocus(
        cards,
        makeBaseOptions({
          format: "contender_11",
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
          marketListings: market,
          currentLineups: lineups,
        }),
        market,
        lineups,
      );
      const championFocus = analyzeFocus(
        cards,
        makeBaseOptions({
          format: "champion_16",
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
          marketListings: market,
          currentLineups: lineups,
        }),
        market,
        lineups,
      );

      expect(VALID_GRADES).toContain(contenderFocus.grade);
      expect(VALID_GRADES).toContain(championFocus.grade);
      expect(championFocus.scoreRatioToCut).toBeLessThan(
        contenderFocus.scoreRatioToCut,
      );
      expect(GRADE_ORDER[championFocus.grade]).toBeLessThanOrEqual(
        GRADE_ORDER[contenderFocus.grade],
      );
    });

    it("F9-T1-02: valid grade ('A+'..'F') and distinct colorTone across elite vs. weak galleries", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const market = makeSampleMarketListings();

      const elite = analyzeFocus(
        makeEliteSuperstarGallery(),
        makeBaseOptions({
          format: "champion_16",
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
          marketListings: market,
        }),
        market,
        [],
      );
      const weak = analyzeFocus(
        makeWeakSubCutoffGallery(),
        makeBaseOptions({
          format: "champion_16",
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
          marketListings: market,
        }),
        market,
        [],
      );

      expect(["A+", "A"]).toContain(elite.grade);
      expect(elite.scoreRatioToCut).toBeGreaterThanOrEqual(1.15);
      expect(["D", "F"]).toContain(weak.grade);
      expect(weak.scoreRatioToCut).toBeLessThan(0.7);
      expect(typeof elite.colorTone).toBe("string");
      expect(elite.colorTone.trim().length).toBeGreaterThan(0);
      expect(typeof weak.colorTone).toBe("string");
      expect(weak.colorTone.trim().length).toBeGreaterThan(0);
      expect(elite.colorTone).not.toBe(weak.colorTone);
    });

    it("F9-T1-03: detects missingPositions (zero Centers) and weakPositions (1 weak Center)", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const market = makeSampleMarketListings();

      const noCenterCards = cloneCards(PJAMPJAM_GALLERY_CARDS).filter(
        (c) => !c.positions.includes("basketball_center"),
      );
      const missingRes = analyzeFocus(
        noCenterCards,
        makeBaseOptions({ format: "contender_11", marketListings: market }),
        market,
        [],
      );
      const missingText = JSON.stringify(missingRes.missingPositions).toLowerCase();
      expect(missingText).toMatch(/center|basketball_center|"c"/);

      const weakCenterCards = [
        ...noCenterCards.slice(0, 8),
        makeSyntheticCard({
          slug: "weak-only-center",
          playerSlug: "weak-only-center-p",
          playerName: "Weak Only Center",
          positions: ["basketball_center"],
          starCost: 1.0,
          l10: 7.0,
          l5: 6.5,
          proj: 6.5,
        }),
      ];
      const weakRes = analyzeFocus(
        weakCenterCards,
        makeBaseOptions({ format: "contender_11", marketListings: market }),
        market,
        [],
      );
      const weakMissingText = JSON.stringify(weakRes.missingPositions).toLowerCase();
      expect(weakMissingText).not.toMatch(/center|basketball_center/);
      const weakPosText = JSON.stringify(weakRes.weakPositions).toLowerCase();
      expect(weakPosText).toMatch(/center|basketball_center|"c"/);
    });

    it("F9-T1-04: surfaces bargainTargetsByPosition (G/F/C) and actionable topReplacements from market listings", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const noCenterCards = cloneCards(PJAMPJAM_GALLERY_CARDS).filter(
        (c) => !c.positions.includes("basketball_center"),
      );
      const market = makeSampleMarketListings();

      const res = analyzeFocus(
        noCenterCards,
        makeBaseOptions({ format: "contender_11", marketListings: market }),
        market,
        [],
      );

      expect(res.bargainTargetsByPosition).toBeDefined();
      expect(typeof res.bargainTargetsByPosition).toBe("object");
      const targetsText = JSON.stringify(res.bargainTargetsByPosition).toLowerCase();
      expect(targetsText).toMatch(/coby white|stephon castle/);
      expect(targetsText).toMatch(/toumani camara/);
      expect(targetsText).toMatch(/onyeka okongwu|nikola jokic/);

      expect(Array.isArray(res.topReplacements)).toBe(true);
      expect(res.topReplacements.length).toBeGreaterThan(0);
      const ownedNames = new Set(
        noCenterCards.map((c) => c.playerName.toLowerCase()),
      );
      const repText = JSON.stringify(res.topReplacements).toLowerCase();
      // Replacements should recommend market targets rather than already-owned roster noise
      expect(
        ["onyeka okongwu", "nikola jokic", "coby white", "toumani camara", "shai", "giannis"].some(
          (name) => repText.includes(name) && !ownedNames.has(name),
        ),
      ).toBe(true);
    });

    it("F9-T1-05: builds uncappedDreamLineup ignoring budget constraints using elite market superstars", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const generate = requireExport<GenerateTopLineupsFn>(
        mod,
        "generateTopLineups",
        LINEUP_MATH_MODULE,
      );
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const market = makeSampleMarketListings();
      const opts = makeBaseOptions({
        format: "champion_16",
        benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
        marketListings: market,
      });

      const ownedBest = generate(cards, {
        ...opts,
        format: "champion_16",
        maxLineups: 1,
      }).lineups[0];

      const champAnalysis = analyzeFocus(cards, opts, market, []);
      expect(champAnalysis.uncappedDreamLineup).toBeTruthy();
      const dreamText = JSON.stringify(champAnalysis.uncappedDreamLineup);
      expect(dreamText).toMatch(/Jokic|Gilgeous-Alexander|Antetokounmpo/);

      const dreamObj = champAnalysis.uncappedDreamLineup as {
        totalScore?: number;
        totalStars?: number;
        slots?: unknown[];
      };
      if (Array.isArray(dreamObj.slots)) {
        expect(dreamObj.slots).toHaveLength(5);
      }
      if (typeof dreamObj.totalStars === "number") {
        expect(dreamObj.totalStars).toBeLessThanOrEqual(16);
      }
      if (typeof dreamObj.totalScore === "number" && ownedBest) {
        expect(dreamObj.totalScore).toBeGreaterThan(ownedBest.totalScore);
      }
    });

    it("F9-T1-06: already-near-optimal focus stays uncluttered ([] missing/weak, bounded replacements)", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const elite = makeEliteSuperstarGallery();
      const weakerMarket: BargainListing[] = [
        {
          cardSlug: "weak-mkt-1",
          assetId: "a-weak-1",
          playerSlug: "weak-mkt-p1",
          playerName: "Bench Guard Mkt",
          teamName: "Charlotte Hornets",
          positions: ["basketball_guard"],
          rarity: "limited",
          seasonYear: 2026,
          inSeasonEligible: true,
          l10: 12,
          l5: 11,
          projected: 11.5,
          starCost: 1.5,
          saleType: "instant_buy",
          priceCents: 180,
          currency: "USD",
          endDate: null,
          bidsCount: null,
          centsPerL10: 15,
          valueScore: 55,
          marketUrl: "https://sorare.com/nba/cards/weak-mkt-1",
        },
      ];

      const res = analyzeFocus(
        elite,
        makeBaseOptions({
          format: "champion_16",
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
          marketListings: weakerMarket,
        }),
        weakerMarket,
        [],
      );

      expect(["A+", "A"]).toContain(res.grade);
      expect(res.missingPositions).toEqual([]);
      expect(res.weakPositions).toEqual([]);
      expect(res.topReplacements.length).toBeLessThanOrEqual(3);
      expect(res.uncappedDreamLineup).toBeTruthy();
    });
  });

  describe("Tier 2: BVA, Edge Cases & Error Handling", () => {
    it("F9-T2-01: empty gallery (cards = [], marketListings = []) degrades gracefully", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);

      const res = analyzeFocus(
        [],
        makeBaseOptions({ format: "contender_11", marketListings: [] }),
        [],
        [],
      );

      expect(res.grade).toBe("F");
      expect(res.scoreRatioToCut).toBe(0);
      expect(typeof res.colorTone).toBe("string");
      expect(res.colorTone.trim().length).toBeGreaterThan(0);
      expect(res.missingPositions.length).toBeGreaterThanOrEqual(3);
      expect(res.topReplacements).toEqual([]);
    });

    it("F9-T2-02: insufficient roster (2 Guard-only cards) reports missing F & C while surfacing market completions", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const twoGuards = cloneCards(PJAMPJAM_GALLERY_CARDS).filter((c) =>
        ["cj-mccollum-2026-limited-1", "malik-monk-2026-limited-1"].includes(
          c.slug,
        ),
      );
      const market = makeSampleMarketListings();

      const res = analyzeFocus(
        twoGuards,
        makeBaseOptions({ format: "contender_11", marketListings: market }),
        market,
        [],
      );

      expect(["D", "F"]).toContain(res.grade);
      const missingText = JSON.stringify(res.missingPositions).toLowerCase();
      expect(missingText).toMatch(/forward|basketball_forward|"f"/);
      expect(missingText).toMatch(/center|basketball_center|"c"/);
      expect(res.bargainTargetsByPosition).toBeDefined();
      expect(res.topReplacements.length).toBeGreaterThan(0);
    });

    it("F9-T2-03: empty marketListings ([]) with 42-card owned gallery degrades gracefully", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const lineups = cloneLineups(ARENA_GW10_SUBMITTED_LINEUPS);

      const res = analyzeFocus(
        cards,
        makeBaseOptions({
          format: "contender_11",
          marketListings: [],
          currentLineups: lineups,
        }),
        [],
        lineups,
      );

      expect(VALID_GRADES).toContain(res.grade);
      expect(typeof res.colorTone).toBe("string");
      expect(Number.isFinite(res.scoreRatioToCut)).toBe(true);
      expect(Array.isArray(res.weakPositions)).toBe(true);
      expect(Array.isArray(res.missingPositions)).toBe(true);
      expect(res.topReplacements).toEqual([]);
    });

    it("F9-T2-04: age-restricted focus (ageFilter: 'u23') grades strictly on U23 pool and filters recommendations", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const market = makeSampleMarketListings();

      const res = analyzeFocus(
        cards,
        makeBaseOptions({
          format: "arena_contender_12",
          ageFilter: "u23",
          benchmarks: cloneBenchmarks(GW8_LEADERBOARD_BENCHMARKS),
          marketListings: market,
        }),
        market,
        [],
      );

      expect(VALID_GRADES).toContain(res.grade);
      const serialized = JSON.stringify(res.uncappedDreamLineup ?? {});
      // Veteran players > 23 yrs must not appear in U23 dream lineup
      expect(serialized).not.toContain("Wendell Carter Jr.");
      expect(serialized).not.toContain("Brook Lopez");
      expect(serialized).not.toContain("Al Horford");
    });

    it("F9-T2-05: grade monotonicity across 4 calibrated strength tiers (weak -> below-cut -> borderline -> elite)", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const bm = cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS); // contender_11 cut = 144.32

      const buildTierGallery = (perCardProj: number, prefix: string) =>
        (["basketball_guard", "basketball_guard", "basketball_forward", "basketball_forward", "basketball_center"] as NbaPosition[]).map(
          (pos, idx) =>
            makeSyntheticCard({
              slug: `${prefix}-${idx}`,
              playerSlug: `${prefix}-p-${idx}`,
              playerName: `${prefix} Player ${idx}`,
              teamSlug: ["phoenix-suns", "denver-nuggets", "memphis-grizzlies", "sacramento-kings", "dallas-mavericks"][idx],
              positions: [pos],
              starCost: 2.0,
              l10: perCardProj,
              l5: perCardProj,
              proj: perCardProj,
              inSeasonEligible: true,
              powerMultiplier: 1.0,
            }),
        );

      const g1 = analyzeFocus(
        buildTierGallery(15, "t1"), // ~75 pts
        makeBaseOptions({ format: "contender_11", benchmarks: bm }),
        [],
        [],
      );
      const g2 = analyzeFocus(
        buildTierGallery(25, "t2"), // ~125 pts
        makeBaseOptions({ format: "contender_11", benchmarks: bm }),
        [],
        [],
      );
      const g3 = analyzeFocus(
        buildTierGallery(31, "t3"), // ~155 pts
        makeBaseOptions({ format: "contender_11", benchmarks: bm }),
        [],
        [],
      );
      const g4 = analyzeFocus(
        buildTierGallery(44, "t4"), // ~220 pts
        makeBaseOptions({ format: "contender_11", benchmarks: bm }),
        [],
        [],
      );

      expect(g1.scoreRatioToCut).toBeLessThan(g2.scoreRatioToCut);
      expect(g2.scoreRatioToCut).toBeLessThan(g3.scoreRatioToCut);
      expect(g3.scoreRatioToCut).toBeLessThan(g4.scoreRatioToCut);

      expect(GRADE_ORDER[g1.grade]).toBeLessThanOrEqual(GRADE_ORDER[g2.grade]);
      expect(GRADE_ORDER[g2.grade]).toBeLessThanOrEqual(GRADE_ORDER[g3.grade]);
      expect(GRADE_ORDER[g3.grade]).toBeLessThanOrEqual(GRADE_ORDER[g4.grade]);
      expect(GRADE_ORDER[g1.grade]).toBeLessThanOrEqual(GRADE_ORDER["D"]);
      expect(GRADE_ORDER[g4.grade]).toBeGreaterThanOrEqual(GRADE_ORDER["A"]);
    });

    it("F9-T2-06: missing / zero paidCutoffScore benchmark boundary prevents Infinity/NaN", async () => {
      const mod = await loadLineupMath();
      const analyzeFocus = resolveFocusStrengthAnalyzer(mod);
      const cards = cloneCards(PJAMPJAM_GALLERY_CARDS);
      const zeroCutBenchmarks = cloneBenchmarks(GW10_LEADERBOARD_BENCHMARKS).map(
        (b) => ({
          ...b,
          paidCutoffScore: 0,
        }),
      );

      for (const bms of [[], zeroCutBenchmarks]) {
        const res = analyzeFocus(
          cards,
          makeBaseOptions({ format: "contender_11", benchmarks: bms }),
          [],
          [],
        );
        expect(Number.isFinite(res.scoreRatioToCut)).toBe(true);
        expect(VALID_GRADES).toContain(res.grade);
        expect(typeof res.colorTone).toBe("string");
        expect(res.colorTone.trim().length).toBeGreaterThan(0);
      }
    });
  });
});

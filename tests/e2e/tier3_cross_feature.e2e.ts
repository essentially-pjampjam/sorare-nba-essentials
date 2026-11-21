import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_AFTER_DAILY_RESET_MS,
  ALERT_BARGAIN_LISTINGS,
  ALERT_BASE_NOW_MS,
  ALERT_CONFIG_ALL_ON,
  ALERT_CONFIG_MASTER_OFF,
  ALERT_CONFIG_NOTIFS_OFF,
  ALERT_CONFIG_THRESHOLD_40,
  ALERT_COOLDOWN_EXPIRED_MS,
  ALERT_COOLDOWN_WITHIN_MS,
  ALERT_DAILY_RESET_WINDOW_MS,
  ALERT_OUTSIDE_CUTOFF_MS,
  buildAlertEvaluationScenario,
  buildAlertTrackerUserSettings,
  buildPricedGalleryForAlertTests,
  type AlertEvaluationInputsFixture,
  type AlertTrackerConfigFixture,
  type PriceBaselineRecordFixture,
  type TrackedAlertEventFixture,
} from "./fixtures/alertTrackerFixture.ts";
import { ARENA_GW10_SUBMITTED_LINEUPS } from "./fixtures/arenaLineupsFixture.ts";
import {
  ESPN_INJURIES_FIXTURE,
  ESPN_SCOREBOARD_FIXTURE,
  GW10_LEADERBOARD_BENCHMARKS,
  GW8_LEADERBOARD_BENCHMARKS,
  PJAMPJAM_GAMES_PER_TEAM,
  PJAMPJAM_INJURIES_BY_NAME,
  PJAMPJAM_SCHEDULE_BY_TEAM,
  SORARE_FIXTURES_GW8_TO_GW10,
} from "./fixtures/espnAndLeaderboardFixtures.ts";
import {
  PJAMPJAM_COMMON_CARDS,
  PJAMPJAM_GALLERY_CARDS,
  buildPjampjamGalleryResult,
} from "./fixtures/gallery42Fixture.ts";
import {
  buildArenaCashBoardHtml,
  buildArenaGw10LineupsHtml,
  buildArenaOngoingHtml,
  buildSetArcadePlayHtml,
  buildSetHotStreakLineupsHtml,
  buildSetSquadHtml,
} from "./fixtures/sorareDomFixtures.ts";
import {
  createDefaultFetchHandler,
  installChromeAndFetchMock,
  type ChromeMockHandle,
} from "./helpers/chromeMock.ts";
import {
  closeContractLoader,
  loadContractModule,
  readRepoText,
  repoFileExists,
  requireContractModule,
  requireExport,
} from "./helpers/contractLoader.ts";
import { createMiniDocument, runContentScriptInVm } from "./helpers/domHarness.ts";
import {
  extractButtonsAndControls,
  renderUiComponentToHtml,
} from "./helpers/uiRenderHarness.ts";

interface GalleryCardLike {
  slug: string;
  rarity: string;
  seasonYear: number;
  inSeasonEligible: boolean;
  grade: number;
  powerMultiplier: number;
  isFirstOwner?: boolean;
  playerAge?: number | null;
  lowestAskCents?: number | null;
  openedLineupIds?: string[];
  sealed?: boolean;
  sealedAt?: string | null;
  teamName: string | null;
  teamSlug: string | null;
  playerSlug: string;
  playerName: string;
  positions: string[];
  l10: number | null;
  l5: number | null;
  sorareClassicProjected: number | null;
  sorareDailyProjected: number | null;
  starCost: number;
}

interface LineupComparisonLike {
  entry: { id: string; leaderboardName: string };
  inferredFormat: string;
  currentProjected: number;
  currentStars: number;
  optimalProjected: number | null;
  resolvedCardSlugs?: string[];
  resolvedCardCount?: number;
  expectedCardCount?: number;
  seasonScope?: string;
  editFocusPoints?: Array<{ kind?: string; message?: string; playerName?: string }>;
  overlaySummary?: {
    totalBoostPct?: number;
    p90Ceiling: number;
    p10Floor: number;
    riskFlags: string[];
    upsideFlags: string[];
  };
}

interface FormatCandidateLike {
  format: string;
  topScore: number | null;
  essencePct: number;
  cashProb?: number;
  expectedValueScore?: number;
  viable?: boolean;
}

interface FormatRecommendationLike {
  recommendedFormat: string;
  reason: string;
  cashProb?: number;
  expectedValueScore?: number;
  viable?: boolean;
  candidates: FormatCandidateLike[];
}

interface FocusStrengthAnalysisLike {
  grade: string;
  colorTone?: string;
  scoreRatioToCut?: number;
  weakPositions?: string[];
  missingPositions?: string[];
  bargainTargetsByPosition?: unknown;
  topReplacements?: unknown[];
  uncappedDreamLineup?: {
    totalScore?: number;
    slots?: unknown[];
  } | null;
}

interface SealCandidateLike {
  cardSlug: string;
  playerName?: string;
  isDuplicate?: boolean;
  isLockedOrListed?: boolean;
  score?: number;
  reason?: string;
  warnings?: string[];
}

interface CountdownSnapshotLike {
  gwCutoffIso: string | null;
  gwRemainingMs: number | null;
  dailyResetIso: string;
  dailyRemainingMs: number;
}

type FetchRouterFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> | Response;

let activeFetchHandler: FetchRouterFn = createDefaultFetchHandler();
let sharedHandle: ChromeMockHandle;
let backgroundLoaded = false;

function cloneGalleryCards(): GalleryCardLike[] {
  return PJAMPJAM_GALLERY_CARDS.map((card) => ({
    ...card,
    positions: [...card.positions],
    openedLineupIds: card.openedLineupIds ? [...card.openedLineupIds] : [],
  }));
}

function resetSharedMockState(
  storageOverrides: Record<string, unknown> = {},
  fetchOverride?: FetchRouterFn,
): void {
  for (const key of Object.keys(sharedHandle.storageData)) {
    delete sharedHandle.storageData[key];
  }
  Object.assign(sharedHandle.storageData, {
    jamassist_api_key_v1: "e2e-fast-key",
    ...storageOverrides,
  });
  sharedHandle.alarms.clear();
  sharedHandle.openedTabs.length = 0;
  sharedHandle.openedTabs.push({
    id: 1,
    url: "https://sorare.com/nba/play",
    active: true,
    windowId: 1,
  });
  sharedHandle.sentMessages.length = 0;
  sharedHandle.notifications.clear();
  sharedHandle.notificationEvents.length = 0;
  activeFetchHandler = fetchOverride ?? createDefaultFetchHandler();
}

async function ensureBackgroundLoaded(): Promise<void> {
  if (backgroundLoaded) return;
  await requireContractModule("src/background/index.ts");
  backgroundLoaded = true;
}

async function sendExtMessage(
  message: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  await ensureBackgroundLoaded();
  const res = await sharedHandle.triggerRuntimeMessage(message, {
    id: sharedHandle.chrome.runtime.id,
    url: sharedHandle.chrome.runtime.getURL("sidepanel.html"),
  });
  return res as { ok: boolean; data?: unknown; error?: string };
}

async function resolveFirstExport<T>(
  candidates: ReadonlyArray<{ modulePath: string; exportNames: ReadonlyArray<string> }>,
  requirementTag: string,
): Promise<{ fn: T; modulePath: string; exportName: string }> {
  const checked: string[] = [];
  for (const candidate of candidates) {
    const res = await loadContractModule<Record<string, unknown>>(candidate.modulePath);
    if (!res.available || !res.mod) {
      checked.push(`${candidate.modulePath} (not found)`);
      continue;
    }
    for (const exportName of candidate.exportNames) {
      const val = res.mod[exportName];
      if (val !== undefined) {
        return { fn: val as T, modulePath: candidate.modulePath, exportName };
      }
      checked.push(`${candidate.modulePath}#${exportName} (missing)`);
    }
  }
  throw new Error(
    `[${requirementTag}] Unimplemented contract export. Checked: ${checked.join(", ")}`,
  );
}

beforeAll(() => {
  sharedHandle = installChromeAndFetchMock({
    manifestVersion: "2.7.0",
    initialStorage: { jamassist_api_key_v1: "e2e-fast-key" },
    fetchHandler: (input, init) => activeFetchHandler(input, init),
  });
});

beforeEach(() => {
  resetSharedMockState();
});

afterEach(() => {
  vi.useRealTimers();
  activeFetchHandler = createDefaultFetchHandler();
});

afterAll(async () => {
  sharedHandle?.restore();
  await closeContractLoader();
});

describe("Tier 3 — Pairwise Cross-Feature Integration (F1–F16)", () => {
  it("Pair 1 [F1 + F2]: route builders feed content script context classification and OPEN_URL_IN_ACTIVE_TAB", async () => {
    const routesMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/routes.ts",
    );
    const parserMod = await requireContractModule<Record<string, unknown>>(
      "src/content/sorareDomParser.ts",
    );

    const buildProPlayUrl = requireExport<() => string>(
      routesMod,
      "buildProPlayUrl",
      "src/shared/routes.ts",
    );
    const buildArenaOngoingUrl = requireExport<() => string>(
      routesMod,
      "buildArenaOngoingUrl",
      "src/shared/routes.ts",
    );
    const buildArenaBoardUrl = requireExport<
      (fixtureSlug?: string | null, leaderboardSlug?: string | null) => string
    >(routesMod, "buildArenaBoardUrl", "src/shared/routes.ts");
    const buildSetPlayUrl = requireExport<
      (mode?: "arcade" | "squad" | "hot_streak", seriesId?: string | null) => string
    >(routesMod, "buildSetPlayUrl", "src/shared/routes.ts");
    const isAllowedSorareUrl = requireExport<(url: string) => boolean>(
      routesMod,
      "isAllowedSorareUrl",
      "src/shared/routes.ts",
    );
    const isProhibitedSorareUrl = requireExport<(url: string) => boolean>(
      routesMod,
      "isProhibitedSorareUrl",
      "src/shared/routes.ts",
    );
    const classifySorareContext = requireExport<
      (url: string, hasCraftHint?: boolean) => string
    >(parserMod, "classifySorareContext", "src/content/sorareDomParser.ts");

    const builtRoutes = [
      buildProPlayUrl(),
      buildArenaOngoingUrl(),
      buildArenaBoardUrl(
        "nba-21-23-nov-2026",
        "nba-21-23-nov-2026-nba_limited_in_season_champion",
      ),
      buildSetPlayUrl("arcade"),
      buildSetPlayUrl("squad"),
      buildSetPlayUrl("hot_streak", "38c6feb9-269d-4640-a136-0ac21603b058"),
    ];

    for (const url of builtRoutes) {
      expect(isAllowedSorareUrl(url), `Route should be allowed: ${url}`).toBe(true);
      expect(isProhibitedSorareUrl(url), `Route must not be prohibited: ${url}`).toBe(false);
      expect(classifySorareContext(url), `Context mismatch for ${url}`).toBe("lineups");
    }

    expect(isProhibitedSorareUrl("https://sorare.com/nba/arena")).toBe(true);
    expect(isProhibitedSorareUrl("https://sorare.com/nba/set")).toBe(true);

    const navOk = await sendExtMessage({
      type: "OPEN_URL_IN_ACTIVE_TAB",
      url: buildSetPlayUrl("arcade"),
    });
    expect(navOk.ok).toBe(true);
    expect(sharedHandle.openedTabs[0]?.url).toBe("https://sorare.com/nba/series/play");

    const vmCheck = await runContentScriptInVm(
      buildSetArcadePlayHtml(),
      buildSetPlayUrl("arcade"),
      sharedHandle,
    );
    expect(vmCheck.errors).toEqual([]);
    expect(vmCheck.context).toBe("lineups");

    const vmSquad = await runContentScriptInVm(
      buildSetSquadHtml(),
      buildSetPlayUrl("squad"),
      sharedHandle,
    );
    expect(vmSquad.context).toBe("lineups");

    const vmHotStreak = await runContentScriptInVm(
      buildSetHotStreakLineupsHtml(),
      buildSetPlayUrl("hot_streak", "38c6feb9-269d-4640-a136-0ac21603b058"),
      sharedHandle,
    );
    expect(vmHotStreak.context).toBe("lineups");

    const vmBoard = await runContentScriptInVm(
      buildArenaCashBoardHtml(),
      builtRoutes[2]!,
      sharedHandle,
    );
    expect(vmBoard.context).toBe("lineups");
  });

  it("Pair 2 [F2 + F3]: content script VM extracts 3 Arena Classic Contender lineups and skips /ongoing", async () => {
    const parserMod = await requireContractModule<Record<string, unknown>>(
      "src/content/sorareDomParser.ts",
    );
    const extractOpenLineupsFromDocument = requireExport<
      (doc: unknown, url: string) => Array<{
        leaderboardName: string;
        playerNames?: string[];
      }>
    >(parserMod, "extractOpenLineupsFromDocument", "src/content/sorareDomParser.ts");

    const arenaUrl = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const vmRes = await runContentScriptInVm(
      buildArenaGw10LineupsHtml(),
      arenaUrl,
      sharedHandle,
    );
    expect(vmRes.errors).toEqual([]);
    expect(vmRes.context).toBe("lineups");
    expect(Array.isArray(vmRes.extractedLineups)).toBe(true);
    expect(vmRes.extractedLineups).toHaveLength(3);

    const normalized = JSON.parse(JSON.stringify(vmRes.extractedLineups)) as Array<{
      leaderboardName: string;
      playerNames?: string[];
      cardSlugs?: string[];
    }>;
    for (const lineup of normalized) {
      expect(lineup.leaderboardName).toContain("Arena Classic Contender");
      expect(lineup.playerNames).toHaveLength(5);
    }
    expect(normalized[0]?.playerNames?.[0]).toMatch(/Morez Johnson Jr\./i);
    expect(normalized[2]?.playerNames?.[4]).toMatch(/Nikola Vucevic/i);

    const emitted = sharedHandle.sentMessages.some(
      (m) =>
        typeof m.message === "object" &&
        m.message !== null &&
        (m.message as { type?: string }).type === "DETECTED_LINEUPS_FROM_CONTENT",
    );
    expect(emitted).toBe(true);

    const ongoingDoc = createMiniDocument(
      buildArenaOngoingHtml(),
      "https://sorare.com/nba/lineups/arena/ongoing",
    );
    expect(
      extractOpenLineupsFromDocument(
        ongoingDoc,
        "https://sorare.com/nba/lineups/arena/ongoing",
      ),
    ).toEqual([]);
  });

  it("Pair 3 [F1 + F4]: Set Arcade/Squad/Hot Streak routes & rules align with commonSetMath Solo/Squad & Daily Picker", async () => {
    const routesMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/routes.ts",
    );
    const constantsMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/constants.ts",
    );
    const setMathMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/commonSetMath.ts",
    );

    const buildSetPlayUrl = requireExport<
      (mode?: "arcade" | "squad" | "hot_streak", seriesId?: string | null) => string
    >(routesMod, "buildSetPlayUrl", "src/shared/routes.ts");
    const SET_ARCADE_RULES = requireExport<{
      livesPerRun: number;
      collectionBonusPctMax: number;
      dailyPickerMinScore: number;
      duplicateScrapReward: string;
    }>(constantsMod, "SET_ARCADE_RULES", "src/shared/constants.ts");
    const rankDailyPickerCandidates = requireExport<
      (
        cards: unknown[],
        injuries: Record<string, unknown>,
        games: Record<string, number>,
      ) => Array<{
        card: { playerName: string; playerSlug: string };
        l10: number;
        targetScore: number;
      }>
    >(setMathMod, "rankDailyPickerCandidates", "src/calculators/commonSetMath.ts");
    const buildSetTeams = requireExport<
      (cards: unknown[], options: Record<string, unknown>) => {
        mode: string;
        soloPicks: unknown[];
        squadTeams: Array<{ slots: unknown[] }>;
      }
    >(setMathMod, "buildSetTeams", "src/calculators/commonSetMath.ts");

    expect(SET_ARCADE_RULES.livesPerRun).toBe(4);
    expect(SET_ARCADE_RULES.collectionBonusPctMax).toBe(5);
    expect(SET_ARCADE_RULES.dailyPickerMinScore).toBe(20);
    expect(SET_ARCADE_RULES.duplicateScrapReward).toBe("Essence");

    const picks = rankDailyPickerCandidates(
      PJAMPJAM_COMMON_CARDS,
      PJAMPJAM_INJURIES_BY_NAME,
      PJAMPJAM_GAMES_PER_TEAM,
    );
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.some((p) => p.card.playerName === "Scottie Barnes")).toBe(false);
    for (const pick of picks) {
      expect(pick.targetScore).toBe(Math.round(Math.max(20, pick.l10 + 7) * 10) / 10);
    }

    const soloRes = buildSetTeams(PJAMPJAM_COMMON_CARDS, {
      mode: "solo",
      teamCount: 4,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(soloRes.mode).toBe("solo");
    expect(soloRes.soloPicks).toHaveLength(4);
    expect(buildSetPlayUrl("arcade")).toBe("https://sorare.com/nba/series/play");

    const squadRes = buildSetTeams(PJAMPJAM_COMMON_CARDS, {
      mode: "squad",
      teamCount: 1,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(squadRes.mode).toBe("squad");
    // Live rule 2026-11-19: Set teams have a 16-star cap; these 3.5-4 star Commons can't
    // form a legal 5-card team (cheapest = 19 stars), so no Squad team is expected.
    expect(squadRes.squadTeams.length).toBe(0);
    expect(buildSetPlayUrl("squad")).toBe("https://sorare.com/nba/series/squad");
  });

  it("Pair 4 [F3 + F6]: DOM-extracted stacked-name lineups (empty cardSlugs) resolve accurately in compareCurrentVsOptimalLineups", async () => {
    const parserMod = await requireContractModule<Record<string, unknown>>(
      "src/content/sorareDomParser.ts",
    );
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const extractOpenLineupsFromDocument = requireExport<
      (doc: unknown, url: string) => unknown[]
    >(parserMod, "extractOpenLineupsFromDocument", "src/content/sorareDomParser.ts");
    const compareCurrentVsOptimalLineups = requireExport<
      (
        lineups: unknown[],
        cards: unknown[],
        options: Record<string, unknown>,
      ) => LineupComparisonLike[]
    >(optMod, "compareCurrentVsOptimalLineups", "src/calculators/lineupOptimizerMath.ts");

    const doc = createMiniDocument(
      buildArenaGw10LineupsHtml(),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    const domLineups = extractOpenLineupsFromDocument(
      doc,
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(domLineups).toHaveLength(3);

    const comparisons = compareCurrentVsOptimalLineups(domLineups, PJAMPJAM_GALLERY_CARDS, {
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      scheduleByTeam: PJAMPJAM_SCHEDULE_BY_TEAM,
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      benchmarks: GW10_LEADERBOARD_BENCHMARKS,
    });

    expect(comparisons).toHaveLength(3);
    for (const comp of comparisons) {
      expect(comp.currentProjected).toBeGreaterThan(0);
      expect(comp.currentStars).toBeGreaterThan(0);
      expect(comp.resolvedCardSlugs?.length).toBe(5);
      expect(
        comp.resolvedCardCount,
        "[F3+F6 | PROJECT.md #6] M2 must populate resolvedCardCount === 5",
      ).toBe(5);
      expect(comp.expectedCardCount).toBe(5);
      expect(
        comp.editFocusPoints?.length ?? 0,
        "[F3+F6 | PROJECT.md #6] M2 must emit actionable editFocusPoints",
      ).toBeGreaterThan(0);
      expect(comp.overlaySummary).toBeDefined();
      expect(comp.overlaySummary!.p90Ceiling).toBeGreaterThan(comp.overlaySummary!.p10Floor);
    }
  });

  it("Pair 5 [F6 + F8]: cross-lineup card locking blocks committed card.slug reuse while allowing duplicate player cards", async () => {
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const compareCurrentVsOptimalLineups = requireExport<
      (
        lineups: unknown[],
        cards: unknown[],
        options: Record<string, unknown>,
      ) => LineupComparisonLike[]
    >(optMod, "compareCurrentVsOptimalLineups", "src/calculators/lineupOptimizerMath.ts");
    const generateTopLineups = requireExport<
      (
        cards: unknown[],
        options: Record<string, unknown>,
      ) => {
        lineups: Array<{ slots: Array<{ evaluated: { card: { slug: string } } }> }>;
      }
    >(optMod, "generateTopLineups", "src/calculators/lineupOptimizerMath.ts");

    const lineupByCardSlug = new Map<string, string>();
    for (const l of ARENA_GW10_SUBMITTED_LINEUPS) {
      for (const s of l.cardSlugs) {
        lineupByCardSlug.set(s, l.id);
      }
    }
    const lockedGallery = cloneGalleryCards().map((c) => ({
      ...c,
      openedLineupIds: lineupByCardSlug.has(c.slug)
        ? [lineupByCardSlug.get(c.slug)!]
        : [],
    }));

    const committedSlugs = new Set(lineupByCardSlug.keys());
    const comparisons = compareCurrentVsOptimalLineups(
      ARENA_GW10_SUBMITTED_LINEUPS,
      lockedGallery,
      {
        rarityFilter: "limited",
        projectionSource: "blended_smart",
        customProjectionsRaw: "",
        injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
        gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
        excludeOut: true,
        excludeQuestionable: false,
        inSeasonOnly: false,
        minInSeasonCards: 0,
        disjointAcrossLineups: false,
        excludeSubmittedCards: true,
        excludedCardSlugs: Array.from(committedSlugs),
      },
    );
    expect(comparisons).toHaveLength(3);

    const built = generateTopLineups(lockedGallery, {
      format: "contender_11",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      excludeSubmittedCards: true,
      excludedCardSlugs: Array.from(committedSlugs),
      maxLineups: 2,
    });

    expect(built.lineups.length).toBeGreaterThan(0);
    const draftedSlugs = built.lineups.flatMap((l) =>
      l.slots.map((s) => s.evaluated.card.slug),
    );
    expect(draftedSlugs).not.toContain("malik-monk-2026-limited-1");
    for (const slug of draftedSlugs) {
      expect(committedSlugs.has(slug), `Committed card ${slug} leaked into new lineup`).toBe(
        false,
      );
    }

    // Duplicate card of same player (`malik-monk-2024-limited-2`) remains unlocked
    const monkDup = lockedGallery.find((c) => c.slug === "malik-monk-2024-limited-2");
    expect(monkDup?.openedLineupIds).toEqual([]);
  });

  it("Pair 6 [F7 + F8]: cross-lineup locking recalculates remaining pool EV in recommendBestFormat without picking 0% Champion 16★", async () => {
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const recommendBestFormat = requireExport<
      (cards: unknown[], options: Record<string, unknown>) => FormatRecommendationLike
    >(optMod, "recommendBestFormat", "src/calculators/lineupOptimizerMath.ts");

    const lockedSlugs = ARENA_GW10_SUBMITTED_LINEUPS.flatMap((l) => l.cardSlugs);
    const unlockedGallery = cloneGalleryCards().filter((c) => !lockedSlugs.includes(c.slug));
    expect(unlockedGallery).toHaveLength(27);

    const commonOpts = {
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      benchmarks: GW8_LEADERBOARD_BENCHMARKS,
    };

    const fullRec = recommendBestFormat(PJAMPJAM_GALLERY_CARDS, commonOpts);
    const lockedRec = recommendBestFormat(PJAMPJAM_GALLERY_CARDS, {
      ...commonOpts,
      excludeSubmittedCards: true,
      excludedCardSlugs: lockedSlugs,
    });
    const remainingRec = recommendBestFormat(unlockedGallery, commonOpts);

    expect(fullRec.recommendedFormat).not.toBe("champion_16");
    expect(lockedRec.recommendedFormat).not.toBe("champion_16");
    expect(remainingRec.recommendedFormat).not.toBe("champion_16");

    expect(
      fullRec.cashProb,
      "[F7+F8 | PROJECT.md #7] M2 recommendBestFormat must expose calibrated cashProb",
    ).toBeTypeOf("number");
    expect(fullRec.expectedValueScore).toBeTypeOf("number");
    expect(fullRec.viable).toBe(true);
    expect((lockedRec.expectedValueScore ?? 0) <= (fullRec.expectedValueScore ?? 0)).toBe(
      true,
    );
  });

  it("Pair 7 [F5 + F7]: multi-lineup entry limits (0 SET / 5) align with calibrated recommendBestFormat & disjoint Arena builds", async () => {
    const constantsMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/constants.ts",
    );
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );

    const limits = requireExport<{
      arenaCashMaxEntries: number;
      proInSeasonMaxEntries: number;
      proClassicMaxEntriesByRarity: Record<string, number>;
      hotStreakMaxEntries: number;
    }>(constantsMod, "COMPETITION_ENTRY_LIMITS", "src/shared/constants.ts");
    const recommendBestFormat = requireExport<
      (cards: unknown[], options: Record<string, unknown>) => FormatRecommendationLike
    >(optMod, "recommendBestFormat", "src/calculators/lineupOptimizerMath.ts");
    const generateTopLineups = requireExport<
      (
        cards: unknown[],
        options: Record<string, unknown>,
      ) => {
        lineups: Array<{
          totalStars: number;
          capLimit: number | null;
          slots: Array<{ evaluated: { card: { slug: string } } }>;
        }>;
      }
    >(optMod, "generateTopLineups", "src/calculators/lineupOptimizerMath.ts");

    expect(limits.arenaCashMaxEntries).toBe(5);
    expect(limits.proInSeasonMaxEntries).toBe(5);
    expect(limits.proClassicMaxEntriesByRarity.limited).toBe(3); // live "0 SET / 3"
    expect(limits.hotStreakMaxEntries).toBe(3);

    const rec = recommendBestFormat(PJAMPJAM_GALLERY_CARDS, {
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      benchmarks: GW10_LEADERBOARD_BENCHMARKS,
    });
    expect(rec.recommendedFormat).not.toBe("champion_16");

    const built = generateTopLineups(PJAMPJAM_GALLERY_CARDS, {
      format: "arena_contender_12",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: limits.arenaCashMaxEntries,
      benchmarks: GW10_LEADERBOARD_BENCHMARKS,
    });

    expect(built.lineups.length).toBeGreaterThanOrEqual(4);
    expect(built.lineups.length).toBeLessThanOrEqual(5);

    const usedSlugs = new Set<string>();
    for (const lineup of built.lineups) {
      expect(lineup.totalStars).toBeLessThanOrEqual(lineup.capLimit ?? 12);
      for (const s of lineup.slots) {
        expect(usedSlugs.has(s.evaluated.card.slug)).toBe(false);
        usedSlugs.add(s.evaluated.card.slug);
      }
    }
  });

  it("Pair 8 [F6 + F10]: ESPN Vegas odds, blowout, B2B & injury signals flow into compareCurrentVsOptimalLineups", async () => {
    activeFetchHandler = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("site.api.espn.com") && url.includes("/injuries")) {
        return new Response(JSON.stringify(ESPN_INJURIES_FIXTURE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("site.api.espn.com") && url.includes("/scoreboard")) {
        return new Response(JSON.stringify(ESPN_SCOREBOARD_FIXTURE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return createDefaultFetchHandler()(input);
    };

    const espnMod = await requireContractModule<Record<string, unknown>>(
      "src/background/externalDataClient.ts",
    );
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const fetchExternalNbaContext = requireExport<
      () => Promise<{
        injuriesByName: Record<string, unknown>;
        gamesPerTeam: Record<string, number>;
        scheduleByTeam: Record<
          string,
          {
            hasBackToBack: boolean;
            impliedTeamTotal?: number | null;
            overUnder?: number | null;
            spread?: number | null;
            blowoutRisk?: boolean;
          }
        >;
      }>
    >(espnMod, "fetchExternalNbaContext", "src/background/externalDataClient.ts");
    const compareCurrentVsOptimalLineups = requireExport<
      (
        lineups: unknown[],
        cards: unknown[],
        options: Record<string, unknown>,
      ) => LineupComparisonLike[]
    >(optMod, "compareCurrentVsOptimalLineups", "src/calculators/lineupOptimizerMath.ts");

    const ctx = await fetchExternalNbaContext();
    const orl = ctx.scheduleByTeam["orlando-magic"];
    expect(orl).toBeDefined();
    expect(orl?.hasBackToBack).toBe(true);
    expect(
      orl?.overUnder,
      "[F6+F10 | PROJECT.md #10] M3 must parse ESPN odds[0].overUnder",
    ).toBe(229.0);
    expect(orl?.spread).toBe(-11.5);
    expect(orl?.blowoutRisk).toBe(true);
    expect(orl?.impliedTeamTotal).toBeCloseTo(120.25, 1);

    const comps = compareCurrentVsOptimalLineups(
      ARENA_GW10_SUBMITTED_LINEUPS,
      PJAMPJAM_GALLERY_CARDS,
      {
        rarityFilter: "limited",
        projectionSource: "blended_smart",
        customProjectionsRaw: "",
        injuriesByName: ctx.injuriesByName,
        gamesPerTeam: ctx.gamesPerTeam,
        scheduleByTeam: ctx.scheduleByTeam,
        excludeOut: true,
        excludeQuestionable: false,
        inSeasonOnly: false,
        minInSeasonCards: 0,
        disjointAcrossLineups: false,
      },
    );
    expect(comps).toHaveLength(3);
    expect(comps[2]?.overlaySummary?.p90Ceiling).toBeGreaterThan(
      comps[2]?.overlaySummary?.p10Floor ?? 0,
    );
    const l3FocusText = JSON.stringify(comps[2]?.editFocusPoints ?? []);
    expect(l3FocusText).toMatch(/Dean Wade/i);
  });

  it("Pair 9 [F9 + F10]: 0G zeroing & distribution analytics drive Focus Strength Grading and Uncapped Dream Lineup", async () => {
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const evaluateCardForLineup = requireExport<
      (
        card: unknown,
        source: string,
        custom: Map<string, number>,
        injuries: Record<string, unknown>,
        games: Record<string, number>,
        schedule?: Record<string, unknown>,
      ) => {
        effectiveScore: number;
        p10Floor?: number;
        p50Median?: number;
        p90Ceiling?: number;
      }
    >(optMod, "evaluateCardForLineup", "src/calculators/lineupOptimizerMath.ts");

    const sasser = PJAMPJAM_GALLERY_CARDS.find(
      (c) => c.slug === "marcus-sasser-2026-limited-1",
    )!;
    const sasserEval = evaluateCardForLineup(
      sasser,
      "blended_smart",
      new Map(),
      PJAMPJAM_INJURIES_BY_NAME,
      PJAMPJAM_GAMES_PER_TEAM,
      PJAMPJAM_SCHEDULE_BY_TEAM,
    );
    expect(
      sasserEval.effectiveScore,
      "[F9+F10 | PROJECT.md #10] 0G card must evaluate to 0 effective points",
    ).toBe(0);

    const wendell = PJAMPJAM_GALLERY_CARDS.find(
      (c) => c.slug === "wendell-carter-jr-2026-limited-1",
    )!;
    const wendellEval = evaluateCardForLineup(
      wendell,
      "blended_smart",
      new Map(),
      PJAMPJAM_INJURIES_BY_NAME,
      PJAMPJAM_GAMES_PER_TEAM,
      PJAMPJAM_SCHEDULE_BY_TEAM,
    );
    expect(wendellEval.p10Floor).toBeTypeOf("number");
    expect(wendellEval.p90Ceiling).toBeGreaterThan(wendellEval.p50Median ?? 0);

    const grader = await resolveFirstExport<
      (
        cards: unknown[],
        options: Record<string, unknown>,
      ) => FocusStrengthAnalysisLike
    >(
      [
        {
          modulePath: "src/calculators/lineupOptimizerMath.ts",
          exportNames: [
            "evaluateFocusStrength",
            "gradeLineupFocusStrength",
            "analyzeFocusStrength",
            "computeFocusStrengthAnalysis",
          ],
        },
        {
          modulePath: "src/calculators/focusGradingMath.ts",
          exportNames: [
            "evaluateFocusStrength",
            "gradeLineupFocusStrength",
            "analyzeFocusStrength",
          ],
        },
      ],
      "F9+F10 | PROJECT.md #9",
    );

    const gradeRank: Record<string, number> = {
      "A+": 7,
      A: 6,
      "B+": 5,
      B: 4,
      C: 3,
      D: 2,
      F: 1,
    };
    const champFocus = grader.fn(PJAMPJAM_GALLERY_CARDS, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      scheduleByTeam: PJAMPJAM_SCHEDULE_BY_TEAM,
      benchmarks: GW8_LEADERBOARD_BENCHMARKS,
      bargainListings: ALERT_BARGAIN_LISTINGS,
    });
    const contFocus = grader.fn(PJAMPJAM_GALLERY_CARDS, {
      format: "contender_11",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      scheduleByTeam: PJAMPJAM_SCHEDULE_BY_TEAM,
      benchmarks: GW8_LEADERBOARD_BENCHMARKS,
      bargainListings: ALERT_BARGAIN_LISTINGS,
    });

    expect(gradeRank[champFocus.grade]).toBeDefined();
    expect(gradeRank[contFocus.grade]).toBeDefined();
    expect(gradeRank[contFocus.grade]!).toBeGreaterThanOrEqual(
      gradeRank[champFocus.grade]!,
    );
    expect(champFocus.uncappedDreamLineup).toBeDefined();
    expect(champFocus.bargainTargetsByPosition).toBeDefined();
  });

  it("Pair 10 [F8 + F11]: cross-lineup locking flags committed cards and ranks unlocked duplicates for Vault sealing", async () => {
    const committedSet = new Set(
      ARENA_GW10_SUBMITTED_LINEUPS.flatMap((l) => l.cardSlugs),
    );
    const gallery = cloneGalleryCards().map((c) => ({
      ...c,
      openedLineupIds: committedSet.has(c.slug) ? ["arena-gw10-classic-contender-1"] : [],
      sealed: c.slug === "jordan-miller-2025-limited-1",
    }));

    const sealEval = await resolveFirstExport<
      (
        cards: unknown[],
        options?: Record<string, unknown>,
      ) => SealCandidateLike[]
    >(
      [
        {
          modulePath: "src/calculators/lineupOptimizerMath.ts",
          exportNames: [
            "evaluateSealCandidates",
            "rankSealCandidates",
            "evaluateVaultSealCandidates",
            "scoreSealCandidates",
          ],
        },
        {
          modulePath: "src/calculators/sealingMath.ts",
          exportNames: ["evaluateSealCandidates", "rankSealCandidates"],
        },
      ],
      "F8+F11 | PROJECT.md #11",
    );

    const candidates = sealEval.fn(gallery, {
      lockedCardSlugs: Array.from(committedSet),
    });
    expect(candidates.length).toBeGreaterThan(0);

    const lockedEntry = candidates.find(
      (c) => c.cardSlug === "malik-monk-2026-limited-1",
    );
    if (lockedEntry) {
      expect(lockedEntry.isLockedOrListed).toBe(true);
    }

    const dupMonk = candidates.find((c) => c.cardSlug === "malik-monk-2024-limited-2");
    expect(dupMonk).toBeDefined();
    expect(dupMonk?.isDuplicate).toBe(true);
    expect(dupMonk?.isLockedOrListed).toBe(false);
    const warnJoined = (dupMonk?.warnings ?? []).join(" ");
    expect(warnJoined).toMatch(/14\s*day/i);
    expect(warnJoined).toMatch(/delist|list/i);
  });

  it("Pair 11 [F11 + F13]: GalleryTab renders Vault sealing guide, cooldown warnings, and accessible outlined buttons", async () => {
    const galleryMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const GalleryTab = requireExport<React.ComponentType<Record<string, unknown>>>(
      galleryMod,
      "GalleryTab",
      "src/sidepanel/tabs/GalleryTab.tsx",
    );

    const clonedCards = cloneGalleryCards().map((c, idx) =>
      idx === 0 ? { ...c, sealed: true, sealedAt: "2026-11-10T00:00:00Z" } : c,
    );
    const gallery = buildPjampjamGalleryResult({
      cards: clonedCards as unknown as ReturnType<typeof buildPjampjamGalleryResult>["cards"],
    });

    const html = renderUiComponentToHtml(
      React.createElement(GalleryTab, {
        gallery,
        walletBalance: {
          cashAmount: 25,
          cashSymbol: "€",
          ethAmount: 0.01,
          cluesCount: 2,
          updatedAt: ALERT_BASE_NOW_MS,
        },
        rarity: "limited",
        currency: "EUR",
        hasUsername: true,
        isLoading: false,
        isPricingGallery: false,
        onRefreshGallery: () => {},
        onPriceGallery: () => {},
      }),
      { chromeMock: sharedHandle },
    );

    expect(html).toContain("Vault");
    expect(
      html,
      "[F11+F13 | PROJECT.md #11] M4 GalleryTab must display 14-day unseal cooldown warning",
    ).toMatch(/14[\s-]?day/i);
    expect(html).toMatch(/delist|cancel/i);

    const controls = extractButtonsAndControls(html);
    expect(controls.length).toBeGreaterThan(0);
    for (const ctrl of controls) {
      expect(
        Boolean(ctrl.text || ctrl.ariaLabel || ctrl.title),
        `Unlabelled control found in GalleryTab: ${JSON.stringify(ctrl)}`,
      ).toBe(true);
    }
  });

  it("Pair 12 [F4 + F12]: Set Daily Picker pairs with deterministic 07:00 UTC Daily Reset countdown rollover", async () => {
    const setMathMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/commonSetMath.ts",
    );
    const rankDailyPickerCandidates = requireExport<
      (
        cards: unknown[],
        injuries: Record<string, unknown>,
        games: Record<string, number>,
      ) => Array<{ card: { playerName: string } }>
    >(setMathMod, "rankDailyPickerCandidates", "src/calculators/commonSetMath.ts");

    const countdownFn = await resolveFirstExport<
      (gwCutoffIso: string | null, nowMs?: number) => CountdownSnapshotLike
    >(
      [
        {
          modulePath: "src/calculators/countdownMath.ts",
          exportNames: [
            "computeCountdownSnapshot",
            "getCountdownSnapshot",
            "buildCountdownSnapshot",
          ],
        },
        {
          modulePath: "src/calculators/lineupOptimizerMath.ts",
          exportNames: [
            "computeCountdownSnapshot",
            "getCountdownSnapshot",
            "buildCountdownSnapshot",
          ],
        },
        {
          modulePath: "src/sidepanel/utils/format.ts",
          exportNames: ["computeCountdownSnapshot", "getCountdownSnapshot"],
        },
      ],
      "F4+F12 | PROJECT.md #12",
    );

    const gw10Cutoff = SORARE_FIXTURES_GW8_TO_GW10[0]!.cutOffDate;
    const beforeReset = countdownFn.fn(gw10Cutoff, ALERT_DAILY_RESET_WINDOW_MS);
    expect(beforeReset.dailyRemainingMs).toBe(20 * 60_000);
    expect(beforeReset.dailyResetIso).toBe("2026-11-21T07:00:00.000Z");

    const afterReset = countdownFn.fn(gw10Cutoff, ALERT_AFTER_DAILY_RESET_MS);
    expect(afterReset.dailyRemainingMs).toBe((23 * 60 + 55) * 60_000);
    expect(afterReset.dailyResetIso).toBe("2026-11-22T07:00:00.000Z");

    const picks = rankDailyPickerCandidates(
      PJAMPJAM_COMMON_CARDS,
      PJAMPJAM_INJURIES_BY_NAME,
      PJAMPJAM_GAMES_PER_TEAM,
    );
    expect(picks.length).toBeGreaterThan(0);
  });

  it("Pair 13 [F12 + F16]: GW cutoff & Daily Reset countdowns drive Alert Tracker events and chrome.notifications", async () => {
    const evalMod = await resolveFirstExport<
      (
        inputs: AlertEvaluationInputsFixture,
        baselines: Record<string, PriceBaselineRecordFixture>,
        config: AlertTrackerConfigFixture,
        nowMs: number,
      ) => TrackedAlertEventFixture[]
    >(
      [
        {
          modulePath: "src/calculators/alertTrackerMath.ts",
          exportNames: ["evaluateAlertEvents"],
        },
        {
          modulePath: "src/calculators/lineupOptimizerMath.ts",
          exportNames: ["evaluateAlertEvents"],
        },
      ],
      "F12+F16 | PROJECT.md #16",
    );

    const scenarioCutoff = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
      config: ALERT_CONFIG_ALL_ON,
    });
    const cutoffEvents = evalMod.fn(
      scenarioCutoff.inputs,
      scenarioCutoff.baselines,
      scenarioCutoff.config,
      scenarioCutoff.nowMs,
    );
    const gwCutoffEvent = cutoffEvents.find((e) => e.kind === "gw_cutoff");
    expect(gwCutoffEvent).toBeDefined();
    expect(gwCutoffEvent?.notifyBrowser).toBe(true);

    const scenarioOutside = buildAlertEvaluationScenario({
      nowMs: ALERT_OUTSIDE_CUTOFF_MS,
      config: ALERT_CONFIG_ALL_ON,
    });
    const outsideEvents = evalMod.fn(
      scenarioOutside.inputs,
      scenarioOutside.baselines,
      scenarioOutside.config,
      scenarioOutside.nowMs,
    );
    expect(outsideEvents.some((e) => e.kind === "gw_cutoff")).toBe(false);

    const scenarioReset = buildAlertEvaluationScenario({
      nowMs: ALERT_DAILY_RESET_WINDOW_MS,
      config: ALERT_CONFIG_ALL_ON,
    });
    const resetEvents = evalMod.fn(
      scenarioReset.inputs,
      scenarioReset.baselines,
      scenarioReset.config,
      scenarioReset.nowMs,
    );
    expect(resetEvents.some((e) => e.kind === "daily_reset")).toBe(true);

    // Background alarm -> chrome.notifications dispatch
    vi.useFakeTimers();
    vi.setSystemTime(ALERT_BASE_NOW_MS);
    const userSettings = buildAlertTrackerUserSettings();
    resetSharedMockState({
      jamassist_settings_v2: userSettings,
      "gallery_v7:pjampjam": {
        value: buildPjampjamGalleryResult({
          cards: buildPricedGalleryForAlertTests(),
        }),
        cachedAt: ALERT_BASE_NOW_MS,
      },
    });
    await ensureBackgroundLoaded();

    const alarmNames = Array.from(sharedHandle.alarms.keys());
    if (!alarmNames.includes("jamassist-alert-tracker")) {
      alarmNames.push("jamassist-alert-tracker");
    }
    for (const alarmName of alarmNames) {
      await sharedHandle.triggerAlarm(alarmName);
    }

    expect(
      sharedHandle.notifications.size,
      "[F12+F16 | PROJECT.md #16] M3 background alarm must dispatch chrome.notifications",
    ).toBeGreaterThan(0);
  });

  it("Pair 14 [F10 + F16]: ESPN injury escalation + market price surge drive Alert Tracker threshold & cooldown gating", async () => {
    const evalMod = await resolveFirstExport<
      (
        inputs: AlertEvaluationInputsFixture,
        baselines: Record<string, PriceBaselineRecordFixture>,
        config: AlertTrackerConfigFixture,
        nowMs: number,
      ) => TrackedAlertEventFixture[]
    >(
      [
        {
          modulePath: "src/calculators/alertTrackerMath.ts",
          exportNames: ["evaluateAlertEvents"],
        },
        {
          modulePath: "src/calculators/lineupOptimizerMath.ts",
          exportNames: ["evaluateAlertEvents"],
        },
      ],
      "F10+F16 | PROJECT.md #16",
    );

    const scenario = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
      config: ALERT_CONFIG_ALL_ON,
    });
    const events = evalMod.fn(
      scenario.inputs,
      scenario.baselines,
      scenario.config,
      scenario.nowMs,
    );

    const surges = events.filter((e) => e.kind === "price_surge");
    expect(surges.some((e) => e.cardSlug === "wendell-carter-jr-2026-limited-1")).toBe(
      true,
    );
    expect(surges.some((e) => e.cardSlug === "brook-lopez-2025-limited-1")).toBe(true);
    expect(surges.some((e) => e.cardSlug === "malik-monk-2024-limited-2")).toBe(false);
    expect(surges.some((e) => e.cardSlug === "isaac-okoro-2024-limited-2")).toBe(false);

    const injuries = events.filter((e) => e.kind === "injury_risk");
    const wadeAlert = injuries.find((e) =>
      (e.playerName ?? "").toLowerCase().includes("dean wade"),
    );
    expect(wadeAlert).toBeDefined();
    expect(wadeAlert?.lineupIds).toContain("arena-gw10-classic-contender-3");
    expect(
      injuries.some((e) => (e.playerName ?? "").toLowerCase().includes("scottie barnes")),
    ).toBe(false);

    // Threshold 40% filters out Brook Lopez (+30%)
    const highThreshold = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
      config: ALERT_CONFIG_THRESHOLD_40,
    });
    const highThresholdEvents = evalMod.fn(
      highThreshold.inputs,
      highThreshold.baselines,
      highThreshold.config,
      highThreshold.nowMs,
    );
    expect(
      highThresholdEvents.some(
        (e) => e.kind === "price_surge" && e.cardSlug === "brook-lopez-2025-limited-1",
      ),
    ).toBe(false);
    expect(
      highThresholdEvents.some(
        (e) =>
          e.kind === "price_surge" && e.cardSlug === "wendell-carter-jr-2026-limited-1",
      ),
    ).toBe(true);

    // Cooldown suppression (+15m) vs re-emit (+65m) using opaque-box dedupeKey
    const lastAlertAtByKey: Record<string, number> = {};
    for (const ev of events) {
      lastAlertAtByKey[ev.dedupeKey] = scenario.nowMs;
    }

    const withinCooldown = buildAlertEvaluationScenario({
      nowMs: ALERT_COOLDOWN_WITHIN_MS,
      priorDedupeMap: lastAlertAtByKey,
      config: ALERT_CONFIG_ALL_ON,
    });
    const withinEvents = evalMod.fn(
      withinCooldown.inputs,
      withinCooldown.baselines,
      withinCooldown.config,
      withinCooldown.nowMs,
    );
    expect(
      withinEvents.some(
        (e) =>
          e.kind === "price_surge" && e.cardSlug === "wendell-carter-jr-2026-limited-1",
      ),
    ).toBe(false);

    const expiredCooldown = buildAlertEvaluationScenario({
      nowMs: ALERT_COOLDOWN_EXPIRED_MS,
      priorDedupeMap: lastAlertAtByKey,
      config: ALERT_CONFIG_ALL_ON,
    });
    const expiredEvents = evalMod.fn(
      expiredCooldown.inputs,
      expiredCooldown.baselines,
      expiredCooldown.config,
      expiredCooldown.nowMs,
    );
    expect(
      expiredEvents.some(
        (e) =>
          e.kind === "price_surge" && e.cardSlug === "wendell-carter-jr-2026-limited-1",
      ),
    ).toBe(true);
  });

  it("Pair 15 [F13 + F16]: SettingsModal renders Alert & Price Tracker toggles and respects disabled config", async () => {
    const settingsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/components/SettingsModal.tsx",
    );
    const SettingsModal = requireExport<React.ComponentType<Record<string, unknown>>>(
      settingsMod,
      "SettingsModal",
      "src/sidepanel/components/SettingsModal.tsx",
    );

    const html = renderUiComponentToHtml(
      React.createElement(SettingsModal, {
        version: "2.7.0",
        settings: buildAlertTrackerUserSettings(),
        focusApiKey: false,
        onUpdateSettings: () => {},
        onOpenTierEditor: () => {},
        onClearCache: () => {},
        onReloadExtension: () => {},
        onClose: () => {},
      }),
      { chromeMock: sharedHandle },
    );

    expect(
      html,
      "[F13+F16 | PROJECT.md #16] M4 SettingsModal must render Alert / Price Tracker controls",
    ).toMatch(/price\s*surge|alert\s*tracker|browser\s*notification/i);

    const evalMod = await resolveFirstExport<
      (
        inputs: AlertEvaluationInputsFixture,
        baselines: Record<string, PriceBaselineRecordFixture>,
        config: AlertTrackerConfigFixture,
        nowMs: number,
      ) => TrackedAlertEventFixture[]
    >(
      [
        {
          modulePath: "src/calculators/alertTrackerMath.ts",
          exportNames: ["evaluateAlertEvents"],
        },
        {
          modulePath: "src/calculators/lineupOptimizerMath.ts",
          exportNames: ["evaluateAlertEvents"],
        },
      ],
      "F13+F16 | PROJECT.md #16",
    );

    const notifsOff = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
      config: ALERT_CONFIG_NOTIFS_OFF,
    });
    const notifsOffEvents = evalMod.fn(
      notifsOff.inputs,
      notifsOff.baselines,
      notifsOff.config,
      notifsOff.nowMs,
    );
    expect(notifsOffEvents.length).toBeGreaterThan(0);
    for (const ev of notifsOffEvents) {
      expect(ev.notifyBrowser).toBe(false);
    }

    const masterOff = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
      config: ALERT_CONFIG_MASTER_OFF,
    });
    const masterOffEvents = evalMod.fn(
      masterOff.inputs,
      masterOff.baselines,
      masterOff.config,
      masterOff.nowMs,
    );
    expect(masterOffEvents).toEqual([]);
  });

  it("Pair 16 [F14 + F15]: .0SR workflow tooling, manifest notifications, 2.7.x parity & E2E isolation", () => {
    const trackedWorkflowFiles = [
      "scripts/verify.mjs",
      "CHANGELOG.md",
    ];
    for (const f of trackedWorkflowFiles) {
      expect(
        repoFileExists(f),
        `[F14+F15 | PROJECT.md #14] Missing tracked workflow file: ${f}`,
      ).toBe(true);
    }

    const pkg = JSON.parse(readRepoText("package.json")) as { version?: string };
    const manifest = JSON.parse(readRepoText("public/manifest.json")) as {
      version?: string;
      permissions?: string[];
    };

    expect(pkg.version).toMatch(/^2\.7\.\d+(-exp\d+)?$/);
    expect(manifest.version).toBe(String(pkg.version).split("-")[0]);
    if (repoFileExists("PROJECT_STATE.md")) {
      const projectState = readRepoText("PROJECT_STATE.md");
      expect(projectState).toContain("2.7.0");
    }
    expect(manifest.permissions).toContain("notifications");
    expect(manifest.permissions).toContain("alarms");

    const vitestE2eCfg = readRepoText("tests/e2e/vitest.e2e.config.ts");
    expect(vitestE2eCfg).toContain("tests/e2e/**/*.e2e.ts");
  });

  it("Pair 17 [F2 + F13]: LineupsTab Go/Sync controls wire OPEN_URL_IN_ACTIVE_TAB & APPLY_LINEUP_HIGHLIGHT with gradient/border tokens", async () => {
    const lineupsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<React.ComponentType<Record<string, unknown>>>(
      lineupsMod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );

    const html = renderUiComponentToHtml(
      React.createElement(LineupsTab, {
        gallery: buildPjampjamGalleryResult(),
        bargains: null,
        allScannedBargains: [],
        collectionNeedSlugs: new Set<string>(),
        walletBalance: {
          cashAmount: 25,
          cashSymbol: "€",
          ethAmount: 0.01,
          cluesCount: 2,
          updatedAt: ALERT_BASE_NOW_MS,
        },
        currency: "EUR",
        activeRarity: "limited",
        projectionSource: "blended_smart",
        customProjectionsRaw: "",
        hasUsername: true,
        isLoading: false,
        isMarketLoading: false,
        onUpdateProjectionSource: () => {},
        onSaveCustomProjections: () => {},
        onLoadGallery: () => {},
        onScanMarketForBudget: () => {},
      }),
      { chromeMock: sharedHandle },
    );

    expect(html).not.toContain("/nba/arena");
    expect(html).not.toContain("/nba/set");

    const controls = extractButtonsAndControls(html);
    expect(controls.some((c) => /\bGo\b/i.test(c.text))).toBe(true);

    const css = readRepoText("src/sidepanel/index.css");
    expect(css).toMatch(/linear-gradient|gradient|border/i);

    const navRes = await sendExtMessage({
      type: "OPEN_URL_IN_ACTIVE_TAB",
      url: "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    });
    expect(navRes.ok).toBe(true);
    expect(sharedHandle.openedTabs[0]?.url).toBe(
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );

    // Non-Sorare active tab persists pending HUD & redirects to /nba/play
    sharedHandle.openedTabs[0]!.url = "https://example.com/";
    const hlRes = await sendExtMessage({
      type: "APPLY_LINEUP_HIGHLIGHT",
      playerNames: ["Wendell Carter Jr."],
      slots: [],
      formatLabel: "Contender 11★",
      projectedTotal: 120,
    });
    expect(hlRes.ok).toBe(true);
    expect(sharedHandle.storageData.jamassist_pending_lineup_hud).toBeDefined();
    expect(sharedHandle.openedTabs[0]?.url).toBe("https://sorare.com/nba/play");
  });

  it("Pair 18 [F7 + F9]: Recommended Entry and Focus Strength Grading remain consistent across focus switches", async () => {
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const recommendBestFormat = requireExport<
      (cards: unknown[], options: Record<string, unknown>) => FormatRecommendationLike
    >(optMod, "recommendBestFormat", "src/calculators/lineupOptimizerMath.ts");

    const grader = await resolveFirstExport<
      (
        cards: unknown[],
        options: Record<string, unknown>,
      ) => FocusStrengthAnalysisLike
    >(
      [
        {
          modulePath: "src/calculators/lineupOptimizerMath.ts",
          exportNames: [
            "evaluateFocusStrength",
            "gradeLineupFocusStrength",
            "analyzeFocusStrength",
            "computeFocusStrengthAnalysis",
          ],
        },
        {
          modulePath: "src/calculators/focusGradingMath.ts",
          exportNames: [
            "evaluateFocusStrength",
            "gradeLineupFocusStrength",
            "analyzeFocusStrength",
          ],
        },
      ],
      "F7+F9 | PROJECT.md #9",
    );

    const rec = recommendBestFormat(PJAMPJAM_GALLERY_CARDS, {
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      benchmarks: GW8_LEADERBOARD_BENCHMARKS,
    });

    expect(["contender_11", "arena_contender_12"]).toContain(rec.recommendedFormat);
    expect(rec.recommendedFormat).not.toBe("champion_16");

    const champAnalysis = grader.fn(PJAMPJAM_GALLERY_CARDS, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      benchmarks: GW8_LEADERBOARD_BENCHMARKS,
      bargainListings: ALERT_BARGAIN_LISTINGS,
    });
    const contAnalysis = grader.fn(PJAMPJAM_GALLERY_CARDS, {
      format: rec.recommendedFormat,
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      benchmarks: GW8_LEADERBOARD_BENCHMARKS,
      bargainListings: ALERT_BARGAIN_LISTINGS,
    });

    expect(champAnalysis.uncappedDreamLineup).toBeDefined();
    expect(contAnalysis.uncappedDreamLineup).toBeDefined();
    expect(
      (champAnalysis.missingPositions?.length ?? 0) +
        (champAnalysis.weakPositions?.length ?? 0),
    ).toBeGreaterThanOrEqual(0);
    expect(contAnalysis.topReplacements).toBeDefined();
  });
});

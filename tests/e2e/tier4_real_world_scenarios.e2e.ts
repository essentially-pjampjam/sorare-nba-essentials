import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_AFTER_DAILY_RESET_MS,
  ALERT_BARGAIN_LISTINGS,
  ALERT_BASE_NOW_MS,
  ALERT_CONFIG_ALL_ON,
  ALERT_CONFIG_MASTER_OFF,
  ALERT_CONFIG_THRESHOLD_40,
  ALERT_COOLDOWN_EXPIRED_MS,
  ALERT_COOLDOWN_WITHIN_MS,
  ALERT_DAILY_RESET_WINDOW_MS,
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
  ALL_LEADERBOARD_BENCHMARKS,
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
  REPO_ROOT,
  closeContractLoader,
  loadContractModule,
  readRepoText,
  repoFileExists,
  requireContractModule,
  requireExport,
} from "./helpers/contractLoader.ts";
import { runContentScriptInVm } from "./helpers/domHarness.ts";
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
  editFocusPoints?: Array<{ kind?: string; message?: string; playerName?: string }>;
  overlaySummary?: {
    totalBoostPct?: number;
    p90Ceiling: number;
    p10Floor: number;
    riskFlags: string[];
    upsideFlags: string[];
  };
}

interface FormatRecommendationLike {
  recommendedFormat: string;
  reason: string;
  cashProb?: number;
  expectedValueScore?: number;
  viable?: boolean;
  candidates: Array<{
    format: string;
    topScore: number | null;
    essencePct: number;
    cashProb?: number;
    expectedValueScore?: number;
    viable?: boolean;
  }>;
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

function toRawGraphqlCardNode(
  c: GalleryCardLike,
  extra: { sealed?: boolean; sealedAt?: string | null } = {},
): Record<string, unknown> {
  return {
    slug: c.slug,
    rarityTyped: c.rarity,
    seasonYear: c.seasonYear,
    inSeasonEligible: c.inSeasonEligible,
    grade: c.grade,
    power: String(c.powerMultiplier),
    pictureUrl: null,
    ownershipHistory: c.isFirstOwner ? [{ transferType: "MINT" }] : [],
    cardEditionName: c.inSeasonEligible ? "2026-27 Limited" : "2025 Limited",
    sealed: extra.sealed ?? c.sealed ?? false,
    sealedAt: extra.sealedAt ?? c.sealedAt ?? null,
    anyTeam: c.teamName ? { name: c.teamName, slug: c.teamSlug ?? "" } : null,
    anyPlayer: {
      slug: c.playerSlug,
      displayName: c.playerName,
      age: c.playerAge ?? 24,
      anyPositions: c.positions,
      l10: c.l10,
      l5: c.l5,
      nextClassicFixtureProjectedScore: c.sorareClassicProjected,
      nextDailyFixtureProjectedScore: c.sorareDailyProjected,
    },
    openedSo5Lineups: [],
  };
}

function resetMockState(
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

function collectSourceFilesRecursive(relDir: string): string[] {
  const rootAbs = join(REPO_ROOT, relDir);
  const out: string[] = [];
  function walk(dirAbs: string, dirRel: string): void {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      const nextAbs = join(dirAbs, entry.name);
      const nextRel = `${dirRel}/${entry.name}`.replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(nextAbs, nextRel);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        out.push(nextRel);
      }
    }
  }
  walk(rootAbs, relDir.replace(/\\/g, "/"));
  return out;
}

beforeAll(() => {
  sharedHandle = installChromeAndFetchMock({
    manifestVersion: "2.7.0",
    initialStorage: { jamassist_api_key_v1: "e2e-fast-key" },
    fetchHandler: (input, init) => activeFetchHandler(input, init),
  });
});

beforeEach(() => {
  resetMockState();
});

afterEach(() => {
  vi.useRealTimers();
  activeFetchHandler = createDefaultFetchHandler();
});

afterAll(async () => {
  sharedHandle?.restore();
  await closeContractLoader();
});

describe("Tier 4 — Real-World End-to-End Scenarios (1–9)", () => {
  it("Scenario 1: Exact 42-card gallery + 3 Arena Classic Contender lineups (Screenshots 1–12)", async () => {
    const routesMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/routes.ts",
    );
    const buildArenaLineupsUrl = requireExport<(slug?: string | null) => string>(
      routesMod,
      "buildArenaLineupsUrl",
      "src/shared/routes.ts",
    );
    const buildArenaOngoingUrl = requireExport<() => string>(
      routesMod,
      "buildArenaOngoingUrl",
      "src/shared/routes.ts",
    );
    const buildProPlayUrl = requireExport<() => string>(
      routesMod,
      "buildProPlayUrl",
      "src/shared/routes.ts",
    );
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

    const arenaUrl = buildArenaLineupsUrl("nba-21-23-nov-2026");
    expect(arenaUrl).toBe("https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026");
    for (const url of [arenaUrl, buildArenaOngoingUrl(), buildProPlayUrl()]) {
      expect(isAllowedSorareUrl(url)).toBe(true);
      expect(isProhibitedSorareUrl(url)).toBe(false);
    }

    // DOM -> Content Script VM
    const vmRes = await runContentScriptInVm(
      buildArenaGw10LineupsHtml(),
      arenaUrl,
      sharedHandle,
    );
    expect(vmRes.errors).toEqual([]);
    expect(vmRes.context).toBe("lineups");
    expect(vmRes.extractedLineups).toHaveLength(3);
    const normalizedLineups = JSON.parse(JSON.stringify(vmRes.extractedLineups)) as Array<{
      id: string;
      name: string;
      leaderboardSlug: string;
      leaderboardName: string;
      draft: boolean;
      cardSlugs: string[];
      captainCardSlug: string | null;
      playerNames?: string[];
    }>;

    // Background sync with mocked GraphQL + ESPN
    resetMockState({}, async (input, init) => {
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
      if (url.includes("api.sorare.com/graphql") && typeof init?.body === "string") {
        const parsed = JSON.parse(init.body) as { query?: string };
        const q = parsed.query ?? "";
        if (q.includes("GalleryAndFixtures")) {
          const isCommon = q.includes("rarities: [common]");
          const nodes = isCommon
            ? PJAMPJAM_COMMON_CARDS.map((c) => toRawGraphqlCardNode(c))
            : PJAMPJAM_GALLERY_CARDS.map((c) => toRawGraphqlCardNode(c));
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
                  featuredSo5Fixtures: SORARE_FIXTURES_GW8_TO_GW10,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      }
      return createDefaultFetchHandler()(input, init);
    });

    const detectedAck = await sendExtMessage({
      type: "DETECTED_LINEUPS_FROM_CONTENT",
      lineups: normalizedLineups,
    });
    expect(detectedAck.ok).toBe(true);

    const gallerySyncRes = await sendExtMessage({
      type: "FETCH_GALLERY_FOR_LINEUPS",
      username: "pjampjam",
      forceRefresh: true,
    });
    expect(gallerySyncRes.ok).toBe(true);
    const mergedGallery = gallerySyncRes.data as {
      cards: GalleryCardLike[];
      currentLineups: unknown[];
    };
    expect(mergedGallery.cards.length).toBe(42);
    expect(mergedGallery.currentLineups.length).toBeGreaterThanOrEqual(3);

    // Calculators: compareCurrentVsOptimalLineups + recommendBestFormat
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
    const recommendBestFormat = requireExport<
      (cards: unknown[], options: Record<string, unknown>) => FormatRecommendationLike
    >(optMod, "recommendBestFormat", "src/calculators/lineupOptimizerMath.ts");

    const comparisons = compareCurrentVsOptimalLineups(
      ARENA_GW10_SUBMITTED_LINEUPS,
      PJAMPJAM_GALLERY_CARDS,
      {
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
        benchmarks: ALL_LEADERBOARD_BENCHMARKS,
      },
    );
    expect(comparisons).toHaveLength(3);
    for (const comp of comparisons) {
      expect(comp.currentProjected).toBeGreaterThan(0);
      expect(comp.currentStars).toBeGreaterThan(0);
      expect(comp.resolvedCardSlugs).toHaveLength(5);
      expect(
        comp.editFocusPoints?.length ?? 0,
        "[Scenario 1 | R2] M2 must emit editFocusPoints",
      ).toBeGreaterThan(0);
      expect(comp.overlaySummary?.p90Ceiling).toBeGreaterThan(
        comp.overlaySummary?.p10Floor ?? 0,
      );
    }
    expect(JSON.stringify(comparisons[2]?.editFocusPoints ?? [])).toMatch(/Dean Wade/i);

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
      benchmarks: ALL_LEADERBOARD_BENCHMARKS,
    });
    expect(rec.recommendedFormat).not.toBe("champion_16");
    expect(
      rec.cashProb,
      "[Scenario 1 | R3] M2 recommendBestFormat must report cashProb > 0",
    ).toBeGreaterThan(0);
    expect(rec.candidates.length).toBeGreaterThanOrEqual(4);

    // UI SSR
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
    expect(html).toContain("Recommended Entry");
    expect(html).not.toContain("0.0 / Opt");
    expect(html).not.toContain("/nba/arena");
  });

  it("Scenario 2: GW10 0 SET / 5 Arena multi-lineup portfolio & cross-lineup card locking", async () => {
    const routesMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/routes.ts",
    );
    const constantsMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/constants.ts",
    );
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );

    const buildArenaBoardUrl = requireExport<
      (f?: string | null, l?: string | null) => string
    >(routesMod, "buildArenaBoardUrl", "src/shared/routes.ts");
    const limits = requireExport<{
      proInSeasonMaxEntries: number;
      arenaCashMaxEntries: number;
      proClassicMaxEntriesByRarity: Record<string, number>;
      hotStreakMaxEntries: number;
    }>(constantsMod, "COMPETITION_ENTRY_LIMITS", "src/shared/constants.ts");
    const generateTopLineups = requireExport<
      (
        cards: unknown[],
        options: Record<string, unknown>,
      ) => {
        lineups: Array<{
          slots: Array<{ evaluated: { card: { slug: string; playerSlug: string } } }>;
        }>;
      }
    >(optMod, "generateTopLineups", "src/calculators/lineupOptimizerMath.ts");
    const recommendBestFormat = requireExport<
      (cards: unknown[], options: Record<string, unknown>) => FormatRecommendationLike
    >(optMod, "recommendBestFormat", "src/calculators/lineupOptimizerMath.ts");

    const boardUrl = buildArenaBoardUrl(
      "nba-21-23-nov-2026",
      "nba-21-23-nov-2026-nba_limited_in_season_champion",
    );
    expect(boardUrl).toBe(
      "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion",
    );
    const vmBoard = await runContentScriptInVm(
      buildArenaCashBoardHtml(),
      boardUrl,
      sharedHandle,
    );
    expect(vmBoard.context).toBe("lineups");
    expect(vmBoard.errors).toEqual([]);

    expect(limits.proInSeasonMaxEntries).toBe(5);
    expect(limits.arenaCashMaxEntries).toBe(5);
    expect(limits.proClassicMaxEntriesByRarity.limited).toBe(3); // live "0 SET / 3"
    expect(limits.hotStreakMaxEntries).toBe(3);

    const portfolio = generateTopLineups(PJAMPJAM_GALLERY_CARDS, {
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
      maxLineups: 5,
      benchmarks: GW10_LEADERBOARD_BENCHMARKS,
    });
    expect(portfolio.lineups.length).toBeGreaterThanOrEqual(4);
    expect(portfolio.lineups.length).toBeLessThanOrEqual(5);

    const seenSlugs = new Set<string>();
    for (const l of portfolio.lineups) {
      expect(l.slots).toHaveLength(5);
      for (const s of l.slots) {
        expect(seenSlugs.has(s.evaluated.card.slug)).toBe(false);
        seenSlugs.add(s.evaluated.card.slug);
      }
    }

    // Cross-lineup locking of 15 committed GW10 slugs
    const committed = new Set(ARENA_GW10_SUBMITTED_LINEUPS.flatMap((l) => l.cardSlugs));
    const clonedWithLocks = cloneGalleryCards().map((c) => ({
      ...c,
      openedLineupIds: committed.has(c.slug) ? ["arena-gw10-locked"] : [],
    }));

    const postLockBuild = generateTopLineups(clonedWithLocks, {
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
      excludeSubmittedCards: true,
      excludedCardSlugs: Array.from(committed),
      maxLineups: 3,
    });
    for (const l of postLockBuild.lineups) {
      for (const s of l.slots) {
        expect(committed.has(s.evaluated.card.slug)).toBe(false);
      }
    }

    const fullRec = recommendBestFormat(PJAMPJAM_GALLERY_CARDS, {
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
    const lockedRec = recommendBestFormat(clonedWithLocks, {
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
      excludedCardSlugs: Array.from(committed),
      benchmarks: GW8_LEADERBOARD_BENCHMARKS,
    });
    expect(
      lockedRec.expectedValueScore,
      "[Scenario 2 | R3] M2 recommendBestFormat must expose expectedValueScore",
    ).toBeTypeOf("number");
    expect((lockedRec.expectedValueScore ?? 0) <= (fullRec.expectedValueScore ?? 0)).toBe(
      true,
    );
  });

  it("Scenario 3: Set Arcade (4 Lives) / Hot Streak (150 PTS) / Squad (580+ PTS) + Daily Picker + Go", async () => {
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
      duplicateScrapReward: string;
      hotStreakDefaultTargetPts: number;
    }>(constantsMod, "SET_ARCADE_RULES", "src/shared/constants.ts");
    const rankDailyPickerCandidates = requireExport<
      (
        cards: unknown[],
        injuries: Record<string, unknown>,
        games: Record<string, number>,
      ) => Array<{ card: { playerName: string }; l10: number; targetScore: number }>
    >(setMathMod, "rankDailyPickerCandidates", "src/calculators/commonSetMath.ts");
    const buildSetTeams = requireExport<
      (
        cards: unknown[],
        opts: Record<string, unknown>,
      ) => { mode: string; soloPicks: unknown[]; squadTeams: unknown[] }
    >(setMathMod, "buildSetTeams", "src/calculators/commonSetMath.ts");

    const arcadeUrl = buildSetPlayUrl("arcade");
    const squadUrl = buildSetPlayUrl("squad");
    const hotStreakUrl = buildSetPlayUrl(
      "hot_streak",
      "38c6feb9-269d-4640-a136-0ac21603b058",
    );
    expect(arcadeUrl).toBe("https://sorare.com/nba/series/play");
    expect(squadUrl).toBe("https://sorare.com/nba/series/squad");
    expect(hotStreakUrl).toBe(
      "https://sorare.com/nba/series/38c6feb9-269d-4640-a136-0ac21603b058/lineups",
    );

    for (const [html, url] of [
      [buildSetArcadePlayHtml(), arcadeUrl],
      [buildSetSquadHtml(), squadUrl],
      [buildSetHotStreakLineupsHtml(), hotStreakUrl],
    ] as const) {
      const vm = await runContentScriptInVm(html, url, sharedHandle);
      expect(vm.errors).toEqual([]);
      expect(vm.context).toBe("lineups");
    }

    expect(SET_ARCADE_RULES.livesPerRun).toBe(4);
    expect(SET_ARCADE_RULES.collectionBonusPctMax).toBe(5);
    expect(SET_ARCADE_RULES.duplicateScrapReward).toBe("Essence");
    expect(SET_ARCADE_RULES.hotStreakDefaultTargetPts).toBe(150);

    const picks = rankDailyPickerCandidates(
      PJAMPJAM_COMMON_CARDS,
      PJAMPJAM_INJURIES_BY_NAME,
      PJAMPJAM_GAMES_PER_TEAM,
    );
    expect(picks.some((p) => p.card.playerName === "Scottie Barnes")).toBe(false);
    for (const p of picks) {
      expect(p.targetScore).toBe(Math.round(Math.max(20, p.l10 + 7) * 10) / 10);
    }

    const solo = buildSetTeams(PJAMPJAM_COMMON_CARDS, {
      mode: "solo",
      teamCount: 4,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(solo.soloPicks).toHaveLength(4);

    const squad = buildSetTeams(PJAMPJAM_COMMON_CARDS, {
      mode: "squad",
      teamCount: 1,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    // Live rule 2026-11-19: Set teams have a 16-star cap; these 3.5-4 star Commons can't
    // form a legal 5-card team (cheapest = 19 stars), so no Squad team is expected.
    expect(squad.squadTeams.length).toBe(0);

    const lineupsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<React.ComponentType<Record<string, unknown>>>(
      lineupsMod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const uiHtml = renderUiComponentToHtml(
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
    const controls = extractButtonsAndControls(uiHtml);
    expect(controls.some((c) => /\bGo\b/i.test(c.text))).toBe(true);

    const nav = await sendExtMessage({
      type: "OPEN_URL_IN_ACTIVE_TAB",
      url: arcadeUrl,
    });
    expect(nav.ok).toBe(true);
    expect(sharedHandle.openedTabs[0]?.url).toBe(arcadeUrl);

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
      ],
      "Scenario 3 | PROJECT.md #12",
    );
    const snap = countdownFn.fn(
      SORARE_FIXTURES_GW8_TO_GW10[0]!.cutOffDate,
      ALERT_DAILY_RESET_WINDOW_MS,
    );
    expect(snap.dailyRemainingMs).toBe(20 * 60_000);
  });

  it("Scenario 4: Vault sealing candidates (Card.sealed), duplicate scrap & lineup-cancel / 14-day cooldown warnings", async () => {
    const clientCode = readRepoText("src/background/sorareClient.ts");
    expect(
      clientCode,
      "[Scenario 4 | PROJECT.md #11] M3 sorareClient.ts must query Card.sealed",
    ).toMatch(/\bsealed\b/);

    resetMockState({}, async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.sorare.com/graphql") && typeof init?.body === "string") {
        const parsed = JSON.parse(init.body) as { query?: string };
        const q = parsed.query ?? "";
        if (q.includes("GalleryAndFixtures")) {
          const isCommon = q.includes("rarities: [common]");
          const nodes = isCommon
            ? PJAMPJAM_COMMON_CARDS.map((c) => toRawGraphqlCardNode(c))
            : PJAMPJAM_GALLERY_CARDS.map((c) =>
                toRawGraphqlCardNode(
                  c,
                  c.slug === "isaac-okoro-2024-limited-2"
                    ? { sealed: true, sealedAt: "2026-11-10T00:00:00Z" }
                    : {},
                ),
              );
          return new Response(
            JSON.stringify({
              data: {
                user: {
                  cards: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes,
                  },
                },
                so5: { featuredSo5Fixtures: SORARE_FIXTURES_GW8_TO_GW10 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      }
      return createDefaultFetchHandler()(input, init);
    });

    const syncRes = await sendExtMessage({
      type: "FETCH_GALLERY_FOR_LINEUPS",
      username: "pjampjam",
      forceRefresh: true,
    });
    expect(syncRes.ok).toBe(true);
    const hydratedCards = (syncRes.data as { cards: GalleryCardLike[] }).cards;
    const hydratedOkoro = hydratedCards.find(
      (c) => c.slug === "isaac-okoro-2024-limited-2",
    );
    expect(hydratedOkoro?.sealed).toBe(true);

    // Pure sealing exclusion + ranking
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const generateTopLineups = requireExport<
      (
        cards: unknown[],
        options: Record<string, unknown>,
      ) => {
        lineups: Array<{ slots: Array<{ evaluated: { card: { slug: string } } }> }>;
      }
    >(optMod, "generateTopLineups", "src/calculators/lineupOptimizerMath.ts");

    const lockedSlugs = new Set(ARENA_GW10_SUBMITTED_LINEUPS.flatMap((l) => l.cardSlugs));
    const cloned = cloneGalleryCards().map((c) => ({
      ...c,
      sealed: c.slug === "isaac-okoro-2024-limited-2",
      sealedAt: c.slug === "isaac-okoro-2024-limited-2" ? "2026-11-10T00:00:00Z" : null,
      openedLineupIds: lockedSlugs.has(c.slug) ? ["arena-gw10-classic-contender-1"] : [],
    }));

    const lineupsRes = generateTopLineups(cloned, {
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
      disjointAcrossLineups: false,
      maxLineups: 3,
    });
    for (const l of lineupsRes.lineups) {
      for (const s of l.slots) {
        expect(s.evaluated.card.slug).not.toBe("isaac-okoro-2024-limited-2");
      }
    }

    const sealFn = await resolveFirstExport<
      (cards: unknown[], options?: Record<string, unknown>) => SealCandidateLike[]
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
      "Scenario 4 | PROJECT.md #11",
    );
    const ranked = sealFn.fn(cloned, { lockedCardSlugs: Array.from(lockedSlugs) });
    expect(ranked.length).toBeGreaterThan(0);
    const monkDup = ranked.find((r) => r.cardSlug === "malik-monk-2024-limited-2");
    expect(monkDup?.isDuplicate).toBe(true);
    const warningsText = (monkDup?.warnings ?? []).join(" ");
    expect(warningsText).toMatch(/14\s*day/i);
    expect(warningsText).toMatch(/delist/i);
    expect(warningsText).toMatch(/cancel|lineup/i);

    const galleryMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const GalleryTab = requireExport<React.ComponentType<Record<string, unknown>>>(
      galleryMod,
      "GalleryTab",
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const uiHtml = renderUiComponentToHtml(
      React.createElement(GalleryTab, {
        gallery: buildPjampjamGalleryResult({
          cards: cloned as unknown as ReturnType<typeof buildPjampjamGalleryResult>["cards"],
        }),
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
    expect(uiHtml).toMatch(/sealed/i);
    expect(uiHtml).toMatch(/14[\s-]?day/i);
    expect(uiHtml).toMatch(/delist/i);
  });

  it("Scenario 5: Focus switch -> strength grading (A+–F), bargain targets & uncapped dream lineup preview", async () => {
    const grader = await resolveFirstExport<
      (cards: unknown[], options: Record<string, unknown>) => FocusStrengthAnalysisLike
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
      "Scenario 5 | PROJECT.md #9",
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

    const champ = grader.fn(PJAMPJAM_GALLERY_CARDS, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      scheduleByTeam: PJAMPJAM_SCHEDULE_BY_TEAM,
      benchmarks: ALL_LEADERBOARD_BENCHMARKS,
      bargainListings: ALERT_BARGAIN_LISTINGS,
    });
    const cont = grader.fn(PJAMPJAM_GALLERY_CARDS, {
      format: "contender_11",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      scheduleByTeam: PJAMPJAM_SCHEDULE_BY_TEAM,
      benchmarks: ALL_LEADERBOARD_BENCHMARKS,
      bargainListings: ALERT_BARGAIN_LISTINGS,
    });

    expect(gradeRank[champ.grade]).toBeDefined();
    expect(gradeRank[cont.grade]).toBeDefined();
    expect(gradeRank[cont.grade]!).toBeGreaterThanOrEqual(gradeRank[champ.grade]!);
    expect(champ.uncappedDreamLineup).toBeDefined();
    expect(champ.bargainTargetsByPosition).toBeDefined();

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
        bargains: {
          rarity: "limited",
          mode: "instant_value",
          currency: "EUR",
          listings: ALERT_BARGAIN_LISTINGS,
          fetchedAt: ALERT_BASE_NOW_MS,
          fromCache: false,
        },
        allScannedBargains: ALERT_BARGAIN_LISTINGS,
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
    expect(html).toMatch(/Strength|Dream Lineup|Uncapped/i);
  });

  it("Scenario 6: ESPN Vegas odds (overUnder/spread -> ITT & blowout) + B2B + correlation -> Lineup Edit Focus", async () => {
    resetMockState({}, async (input) => {
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
    });

    const espnMod = await requireContractModule<Record<string, unknown>>(
      "src/background/externalDataClient.ts",
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

    const ctx = await fetchExternalNbaContext();
    const cle = ctx.scheduleByTeam["cleveland-cavaliers"];
    const mem = ctx.scheduleByTeam["memphis-grizzlies"];
    const orl = ctx.scheduleByTeam["orlando-magic"];
    const dal = ctx.scheduleByTeam["dallas-mavericks"];
    const tor = ctx.scheduleByTeam["toronto-raptors"];

    expect(
      cle?.impliedTeamTotal,
      "[Scenario 6 | PROJECT.md #10] M3 must compute Vegas impliedTeamTotal",
    ).toBeCloseTo(121.5, 1);
    expect(mem?.impliedTeamTotal).toBeCloseTo(117.0, 1);
    expect(orl?.blowoutRisk).toBe(true);
    expect(orl?.hasBackToBack).toBe(true);
    expect(dal?.impliedTeamTotal == null || Number.isFinite(dal.impliedTeamTotal)).toBe(
      true,
    );
    expect(Number.isNaN(dal?.impliedTeamTotal ?? 0)).toBe(false);
    expect(Number.isNaN(tor?.impliedTeamTotal ?? 0)).toBe(false);
    expect(ctx.scheduleByTeam["detroit-pistons"]).toBeUndefined();

    // Variance & 0G zeroing
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
    expect(
      evaluateCardForLineup(
        sasser,
        "blended_smart",
        new Map(),
        ctx.injuriesByName,
        ctx.gamesPerTeam,
        ctx.scheduleByTeam,
      ).effectiveScore,
    ).toBe(0);

    const wendell = PJAMPJAM_GALLERY_CARDS.find(
      (c) => c.slug === "wendell-carter-jr-2026-limited-1",
    )!;
    const wendellEv = evaluateCardForLineup(
      wendell,
      "blended_smart",
      new Map(),
      ctx.injuriesByName,
      ctx.gamesPerTeam,
      ctx.scheduleByTeam,
    );
    expect(wendellEv.p10Floor).toBeLessThan(wendellEv.p50Median ?? 0);
    expect(wendellEv.p50Median).toBeLessThan(wendellEv.p90Ceiling ?? 0);

    const compareCurrentVsOptimalLineups = requireExport<
      (
        lineups: unknown[],
        cards: unknown[],
        options: Record<string, unknown>,
      ) => LineupComparisonLike[]
    >(optMod, "compareCurrentVsOptimalLineups", "src/calculators/lineupOptimizerMath.ts");
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
    expect(comps[1]?.editFocusPoints?.length ?? 0).toBeGreaterThan(0);
    expect(comps[2]?.editFocusPoints?.length ?? 0).toBeGreaterThan(0);
  });

  it("Scenario 7: Side Panel vs. Pop-Out Dashboard (?view=dashboard) layout, buttons, timers & reminder toggle", async () => {
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
      ],
      "Scenario 7 | PROJECT.md #12",
    );

    const gwCutoff = SORARE_FIXTURES_GW8_TO_GW10[0]!.cutOffDate;
    const before = countdownFn.fn(gwCutoff, ALERT_BASE_NOW_MS);
    expect(before.gwRemainingMs).toBe(25 * 60_000);
    expect(before.dailyResetIso).toBe("2026-11-21T07:00:00.000Z");

    const after = countdownFn.fn(gwCutoff, ALERT_AFTER_DAILY_RESET_MS);
    expect(after.dailyResetIso).toBe("2026-11-22T07:00:00.000Z");

    const appMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );
    const App = requireExport<React.ComponentType<Record<string, unknown>>>(
      appMod,
      "App",
      "src/sidepanel/App.tsx",
    );

    const sidepanelHtml = renderUiComponentToHtml(React.createElement(App, {}), {
      search: "",
      chromeMock: sharedHandle,
    });
    const dashboardHtml = renderUiComponentToHtml(React.createElement(App, {}), {
      search: "?view=dashboard",
      chromeMock: sharedHandle,
    });

    for (const html of [sidepanelHtml, dashboardHtml]) {
      expect(html).toContain("Sorare NBA Essentials");
      expect(html).not.toContain("Sorar...");
      expect(html).toContain("2.7.0");
      expect(html).not.toContain("/nba/arena");
      expect(html).not.toContain("/nba/set");
    }

    expect(sidepanelHtml).toContain("Open full website dashboard");
    expect(dashboardHtml).toContain("jam-dashboard-mode");
    expect(dashboardHtml).not.toContain("Open full website dashboard");

    const controls = extractButtonsAndControls(sidepanelHtml);
    expect(controls.length).toBeGreaterThan(0);

    // Cutoff reminder toggle -> chrome.alarms
    const enableRes = await sendExtMessage({
      type: "SAVE_SETTINGS",
      settings: {
        cutoffReminderEnabled: true,
        cutoffReminderMinutesBefore: 30,
      },
    });
    expect(enableRes.ok).toBe(true);
    const hasCutoffAlarm = Array.from(sharedHandle.alarms.keys()).some((k) =>
      /cutoff|reminder/i.test(k),
    );
    expect(
      hasCutoffAlarm,
      "[Scenario 7 | PROJECT.md #12] M3 SAVE_SETTINGS must register cutoff reminder alarm",
    ).toBe(true);

    const disableRes = await sendExtMessage({
      type: "SAVE_SETTINGS",
      settings: {
        cutoffReminderEnabled: false,
      },
    });
    expect(disableRes.ok).toBe(true);
    const stillHasCutoffAlarm = Array.from(sharedHandle.alarms.keys()).some((k) =>
      /cutoff|reminder/i.test(k),
    );
    expect(stillHasCutoffAlarm).toBe(false);
  });

  it(
    "Scenario 8: Full .0SR release verification (verify.mjs, ship-helper.mjs, ship-update, 2.7.0 parity, invariants)",
    { timeout: 60_000 },
    () => {
      const requiredFiles = [
        "scripts/verify.mjs",
        "scripts/ship-helper.mjs",
        ".agents/skills/ship-update/SKILL.md",
        "ROADMAP.md",
        "INPUT_NEEDED.md",
        "TESTING.md",
        "CHANGELOG.md",
        "PROJECT_STATE.md",
      ];
      for (const f of requiredFiles) {
        expect(
          repoFileExists(f),
          `[Scenario 8 | PROJECT.md #14] Missing required .0SR deliverable: ${f}`,
        ).toBe(true);
      }

      const pkg = JSON.parse(readRepoText("package.json")) as { version?: string };
      const manifest = JSON.parse(readRepoText("public/manifest.json")) as {
        version?: string;
        permissions?: string[];
      };
      const projectState = readRepoText("PROJECT_STATE.md");
      const changelog = readRepoText("CHANGELOG.md");
      const whatsNew = readRepoText("src/sidepanel/components/WhatsNewModal.tsx");

      expect(pkg.version).toBe("2.7.0");
      expect(manifest.version).toBe("2.7.0");
      expect(projectState).toContain("2.7.0");
      expect(changelog).toContain("2.7.0");
      expect(whatsNew).toContain("2.7.0");
      expect(manifest.permissions).toContain("notifications");
      expect(manifest.permissions).toContain("alarms");
      expect(manifest.permissions).toContain("storage");
      expect(manifest.permissions).toContain("sidePanel");

      // Static invariants
      for (const file of collectSourceFilesRecursive("src/calculators")) {
        const code = readRepoText(file);
        expect(code).not.toMatch(/\bchrome\s*\./);
        expect(code).not.toMatch(/\bfetch\s*\(/);
      }
      for (const file of [
        ...collectSourceFilesRecursive("src/content"),
        "src/sidepanel/api.ts",
      ]) {
        const code = readRepoText(file);
        expect(code).not.toMatch(/api\.sorare\.com|site\.api\.espn\.com/);
      }

      const skillDoc = readRepoText(".agents/skills/ship-update/SKILL.md");
      expect(skillDoc).toMatch(/next[\s-]?step|ROADMAP|INPUT_NEEDED|verify/i);

      const verifyRun = spawnSync("node", ["scripts/verify.mjs"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 50_000,
      });
      expect(
        verifyRun.status,
        `scripts/verify.mjs failed: ${verifyRun.stderr || verifyRun.stdout}`,
      ).toBe(0);

      const helperRun = spawnSync("node", ["scripts/ship-helper.mjs", "--help"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(
        helperRun.status,
        `scripts/ship-helper.mjs --help failed: ${helperRun.stderr || helperRun.stdout}`,
      ).toBe(0);
    },
  );

  it("Scenario 9: Multi-Event Alert & Price Surge Tracker -> chrome.alarms & chrome.notifications + click-to-open + UI", async () => {
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
      "Scenario 9 | PROJECT.md #16",
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
    expect(events.some((e) => e.kind === "price_surge" && e.cardSlug === "wendell-carter-jr-2026-limited-1")).toBe(true);
    expect(events.some((e) => e.kind === "price_surge" && e.cardSlug === "brook-lopez-2025-limited-1")).toBe(true);
    expect(events.some((e) => e.kind === "injury_risk" && e.lineupIds?.includes("arena-gw10-classic-contender-3"))).toBe(true);
    expect(events.some((e) => e.kind === "bargain_match" && e.cardSlug === "jalen-smith-2026-limited-1")).toBe(true);
    expect(events.some((e) => e.kind === "gw_cutoff")).toBe(true);
    expect(events.some((e) => e.cardSlug === "isaac-okoro-2024-limited-2")).toBe(false);

    // Cooldown & threshold & master off
    const dedupeMap: Record<string, number> = {};
    for (const ev of events) {
      dedupeMap[ev.dedupeKey] = scenario.nowMs;
    }
    const withinScenario = buildAlertEvaluationScenario({
      nowMs: ALERT_COOLDOWN_WITHIN_MS,
      priorDedupeMap: dedupeMap,
      config: ALERT_CONFIG_ALL_ON,
    });
    const withinEvents = evalMod.fn(
      withinScenario.inputs,
      withinScenario.baselines,
      withinScenario.config,
      withinScenario.nowMs,
    );
    expect(
      withinEvents.some(
        (e) =>
          e.kind === "price_surge" && e.cardSlug === "wendell-carter-jr-2026-limited-1",
      ),
    ).toBe(false);

    const expiredScenario = buildAlertEvaluationScenario({
      nowMs: ALERT_COOLDOWN_EXPIRED_MS,
      priorDedupeMap: dedupeMap,
      config: ALERT_CONFIG_ALL_ON,
    });
    const expiredEvents = evalMod.fn(
      expiredScenario.inputs,
      expiredScenario.baselines,
      expiredScenario.config,
      expiredScenario.nowMs,
    );
    expect(
      expiredEvents.some(
        (e) =>
          e.kind === "price_surge" && e.cardSlug === "wendell-carter-jr-2026-limited-1",
      ),
    ).toBe(true);

    const threshold40 = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
      config: ALERT_CONFIG_THRESHOLD_40,
    });
    expect(
      evalMod
        .fn(
          threshold40.inputs,
          threshold40.baselines,
          threshold40.config,
          threshold40.nowMs,
        )
        .some((e) => e.cardSlug === "brook-lopez-2025-limited-1"),
    ).toBe(false);

    const masterOff = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
      config: ALERT_CONFIG_MASTER_OFF,
    });
    expect(
      evalMod.fn(
        masterOff.inputs,
        masterOff.baselines,
        masterOff.config,
        masterOff.nowMs,
      ),
    ).toEqual([]);

    // Background alarm -> chrome.notifications -> click-to-open
    vi.useFakeTimers();
    vi.setSystemTime(ALERT_BASE_NOW_MS);
    resetMockState({
      jamassist_settings_v2: buildAlertTrackerUserSettings(),
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
    for (const name of alarmNames) {
      await sharedHandle.triggerAlarm(name);
    }

    expect(
      sharedHandle.notifications.size,
      "[Scenario 9 | PROJECT.md #16] M3 alarm handler must create chrome.notifications",
    ).toBeGreaterThan(0);
    const createdNotifId = Array.from(sharedHandle.notifications.keys())[0]!;
    const tabsBeforeClick = sharedHandle.openedTabs.length;
    await sharedHandle.triggerNotificationClick(createdNotifId);
    expect(sharedHandle.openedTabs.length).toBeGreaterThan(tabsBeforeClick);

    // Repeat with browserNotificationsEnabled: false -> zero new notifications
    resetMockState({
      jamassist_settings_v2: buildAlertTrackerUserSettings({
        alertPreferences: {
          priceSurgeEnabled: true,
          priceSurgePctThreshold: 25,
          injuryRiskEnabled: true,
          bargainAlertEnabled: true,
          cutoffAlertEnabled: true,
          dailyResetAlertEnabled: true,
          browserNotificationsEnabled: false,
          cooldownMinutes: 60,
        },
      }),
      "gallery_v7:pjampjam": {
        value: buildPjampjamGalleryResult({
          cards: buildPricedGalleryForAlertTests(),
        }),
        cachedAt: ALERT_BASE_NOW_MS,
      },
    });
    for (const name of alarmNames) {
      await sharedHandle.triggerAlarm(name);
    }
    expect(sharedHandle.notifications.size).toBe(0);

    // UI SSR for SettingsModal & BargainsTab
    const settingsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/components/SettingsModal.tsx",
    );
    const SettingsModal = requireExport<React.ComponentType<Record<string, unknown>>>(
      settingsMod,
      "SettingsModal",
      "src/sidepanel/components/SettingsModal.tsx",
    );
    const settingsHtml = renderUiComponentToHtml(
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
    expect(settingsHtml).toMatch(/price\s*surge|browser\s*notification|alert/i);

    const bargainsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/BargainsTab.tsx",
    );
    const BargainsTab = requireExport<React.ComponentType<Record<string, unknown>>>(
      bargainsMod,
      "BargainsTab",
      "src/sidepanel/tabs/BargainsTab.tsx",
    );
    const bargainsHtml = renderUiComponentToHtml(
      React.createElement(BargainsTab, {
        bargains: {
          rarity: "limited",
          mode: "instant_value",
          currency: "EUR",
          listings: ALERT_BARGAIN_LISTINGS,
          fetchedAt: ALERT_BASE_NOW_MS,
          fromCache: false,
        },
        rarity: "limited",
        currency: "EUR",
        isLoading: false,
        watchlist: [],
        watchlistAlerts: [],
        onScanBargains: () => {},
      }),
      { chromeMock: sharedHandle },
    );
    expect(bargainsHtml).toContain("Jalen Smith");
  });
});

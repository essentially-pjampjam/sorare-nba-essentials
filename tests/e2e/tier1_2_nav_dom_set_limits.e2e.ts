import React from "react";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import type {
  GalleryCard,
  InjuryReportEntry,
  LeaderboardBenchmark,
  ProjectionSource,
  Rarity,
} from "../../src/shared/types";
import {
  buildArenaLineupsFixture,
} from "./fixtures/arenaLineupsFixture.ts";
import {
  PJAMPJAM_INJURIES_BY_NAME,
  PJAMPJAM_GAMES_PER_TEAM,
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
  buildProLineupsEmptyHtml,
  buildSetArcadePlayHtml,
  buildSetHotStreakLineupsHtml,
  buildSetSquadHtml,
} from "./fixtures/sorareDomFixtures.ts";
import {
  installChromeAndFetchMock,
  type ChromeMockHandle,
} from "./helpers/chromeMock.ts";
import {
  closeContractLoader,
  readRepoText,
  requireContractModule,
  requireExport,
} from "./helpers/contractLoader.ts";
import {
  createMiniDocument,
  runContentScriptInVm,
  type MiniDocument,
} from "./helpers/domHarness.ts";
import {
  extractButtonsAndControls,
  renderUiComponentToHtml,
} from "./helpers/uiRenderHarness.ts";

// --- Local Structural Contract Interfaces (no static runtime src/ imports) ---

interface RoutesContract {
  SORARE_ORIGIN: string;
  PROHIBITED_SORARE_NBA_PATHS: readonly string[];
  normalizeSorareSlug: (raw?: string | null) => string | null;
  isProhibitedSorareUrl: (rawUrl: string) => boolean;
  isAllowedSorareUrl: (rawUrl: string) => boolean;
  buildProPlayUrl: () => string;
  buildProLineupsUrl: () => string;
  buildPrevLineupsUrl: () => string;
  buildArenaOngoingUrl: () => string;
  buildArenaLineupsUrl: (fixtureSlug?: string | null) => string;
  buildArenaBoardUrl: (
    fixtureSlug?: string | null,
    leaderboardSlug?: string | null,
  ) => string;
  buildSetPlayUrl: (
    mode?: "arcade" | "squad" | "hot_streak",
    seriesId?: string | null,
  ) => string;
  buildSquadLineupUrl: (boardStepId?: string | null) => string;
  buildCardUrl: (cardSlug: string) => string;
  buildMarketPlayerUrl: (playerSlug: string, rarity?: Rarity) => string;
}

interface CompetitionEntry {
  id: string;
  name: string;
  mode: string;
  url: string;
  rulesSummary: string;
  notes?: string;
}

interface ConstantsContract {
  COMPETITION_ENTRY_LIMITS: {
    proInSeasonMaxEntries: number;
    arenaCashMaxEntries: number;
    proClassicMaxEntriesByRarity: Record<Rarity, number>;
    hotStreakMaxEntries: number;
    squadBestLineupsCounted: number;
    arenaPodSize: number;
  };
  SET_ARCADE_RULES: {
    livesPerRun: number;
    collectionBonusPctMax: number;
    editionBoostPct: {
      standard: number;
      shiny: number;
      holo: number;
    };
    dailyPickerMinScore: number;
    dailyPickerL10Offset: number;
    squadSalaryCap: number;
    squadMvpFree: boolean;
    hotStreakDefaultTargetPts: number;
    duplicateScrapReward: string;
    cardTiers: readonly string[];
  };
  NBA_COMPETITION_DIRECTORY: readonly CompetitionEntry[];
}

interface DomDetectedLineupShape {
  id: string;
  name: string;
  leaderboardSlug: string;
  leaderboardName: string;
  draft: boolean;
  cardSlugs: string[];
  captainCardSlug: string | null;
  playerNames?: string[];
  source: "dom" | "api";
  starCap?: number | null;
  contestKind?: "arena" | "pro" | "unknown";
  seasonScope?: "classic" | "in_season" | "unknown";
  fixtureSlug?: string | null;
  expectedCardCount?: number;
}

interface DomParserContract {
  classifySorareContext: (url: string, hasCollectModal?: boolean) => string;
  isCraftRoute: (href: string) => boolean;
  isProOrArenaLineupUrl: (url: string) => boolean;
  extractOpenLineupsFromDocument: (
    doc: MiniDocument,
    url: string,
  ) => DomDetectedLineupShape[];
  normalizeNameForMatch: (raw: string) => string;
  formatDisplayPlayerName: (raw: string) => string;
}

interface DailyPickerCandidateShape {
  card: GalleryCard;
  l10: number;
  projectedScore: number;
  targetScore: number;
  edgeVsTarget: number;
  hitChancePct: number;
  injuryStatus: string;
  rationale: string;
}

interface SuggestedLineupShape {
  lineupIndex: number;
  slots: Array<{
    slotLabel: string;
    evaluated: {
      card: GalleryCard;
      effectiveScore: number;
    };
  }>;
  projectedTotal: number;
  starSum: number;
  inSeasonCount: number;
  capUsed: number;
  capLimit: number | null;
  isValid: boolean;
}

interface SetAutoBuildResultShape {
  mode: "solo" | "squad";
  soloPicks: Array<{ card: GalleryCard; effectiveScore: number }>;
  squadTeams: SuggestedLineupShape[];
  activePoolCount: number;
}

interface SetMathContract {
  rankDailyPickerCandidates: (
    commonCards: GalleryCard[],
    injuriesByName: Record<string, InjuryReportEntry>,
    gamesPerTeam: Record<string, number>,
    limit?: number,
  ) => DailyPickerCandidateShape[];
  buildSetTeams: (
    commonCards: GalleryCard[],
    options: {
      mode: "solo" | "squad";
      teamCount: number;
      projectionSource: ProjectionSource;
      customProjectionsRaw: string;
      injuriesByName: Record<string, InjuryReportEntry>;
      gamesPerTeam: Record<string, number>;
      excludeOut: boolean;
      disjointAcrossTeams: boolean;
    },
  ) => SetAutoBuildResultShape;
}

interface OptimizerResultShape {
  lineups: SuggestedLineupShape[];
  evaluatedPool: Array<{ card: GalleryCard; effectiveScore: number }>;
  [key: string]: unknown;
}

interface OptimizerContract {
  generateTopLineups: (
    cards: GalleryCard[],
    options: {
      format: string;
      rarityFilter: Rarity | "all";
      projectionSource: ProjectionSource;
      customProjectionsRaw: string;
      injuriesByName: Record<string, InjuryReportEntry>;
      gamesPerTeam: Record<string, number>;
      excludeOut: boolean;
      excludeQuestionable: boolean;
      inSeasonOnly: boolean;
      minInSeasonCards: number;
      disjointAcrossLineups: boolean;
      maxLineups: number;
      captainBonusPct: number;
      excludedCardSlugs?: Set<string>;
      excludeSubmittedCards?: boolean;
      benchmarks?: LeaderboardBenchmark[];
      benchmarkSeasonScope?: string;
    },
  ) => OptimizerResultShape;
  [key: string]: unknown;
}

type LineupsTabComponent = React.ComponentType<Record<string, unknown>>;

function makeLineupsTabProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    gallery: buildPjampjamGalleryResult({
      cards: PJAMPJAM_GALLERY_CARDS.map((c) => ({ ...c })),
      commonCards: PJAMPJAM_COMMON_CARDS.map((c) => ({ ...c })),
      currentLineups: buildArenaLineupsFixture("dom"),
    }),
    bargains: null,
    allScannedBargains: [],
    collectionNeedSlugs: new Set<string>(),
    currency: "EUR",
    activeRarity: "limited" as Rarity,
    projectionSource: "blended_smart" as ProjectionSource,
    customProjectionsRaw: "",
    hasUsername: true,
    isLoading: false,
    isMarketLoading: false,
    onUpdateProjectionSource: () => {},
    onSaveCustomProjections: () => {},
    onLoadGallery: () => {},
    onScanMarketForBudget: () => {},
    ...overrides,
  };
}

function normalizeVmArray<T>(raw: unknown[]): T[] {
  return JSON.parse(JSON.stringify(raw)) as T[];
}

// --- Shared Background Mock Lifecycle (module ESM listener preserved) ---

let bgMock: ChromeMockHandle | null = null;
let bgLoaded = false;

async function ensureBackgroundLoaded(): Promise<ChromeMockHandle> {
  if (!bgMock) {
    bgMock = installChromeAndFetchMock();
  }
  if (!bgLoaded) {
    await requireContractModule("src/background/index.ts");
    bgLoaded = true;
  }
  return bgMock;
}

function resetBackgroundMockState(mock: ChromeMockHandle): void {
  for (const key of Object.keys(mock.storageData)) {
    delete mock.storageData[key];
  }
  mock.openedTabs.splice(0, mock.openedTabs.length, {
    id: 1,
    url: "https://sorare.com/nba/play",
    active: true,
    windowId: 1,
  });
  mock.sentMessages.length = 0;
  mock.notifications.clear();
  mock.notificationEvents.length = 0;
}

afterAll(async () => {
  if (bgMock) {
    bgMock.restore();
    bgMock = null;
  }
  await closeContractLoader();
});

// ============================================================================
// Feature 1: Verified Sorare NBA Route Builders & 404 Fixes (12 tests)
// ============================================================================

describe("Feature 1: Verified Sorare NBA Route Builders & 404 Fixes", () => {
  let routes: RoutesContract;
  let constants: ConstantsContract;

  beforeAll(async () => {
    const routesMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/routes.ts",
    );
    const constantsMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/constants.ts",
    );
    routes = routesMod as unknown as RoutesContract;
    constants = constantsMod as unknown as ConstantsContract;
    requireExport(routesMod, "buildProPlayUrl", "src/shared/routes.ts");
    requireExport(routesMod, "buildArenaLineupsUrl", "src/shared/routes.ts");
    requireExport(routesMod, "buildSetPlayUrl", "src/shared/routes.ts");
    requireExport(
      constantsMod,
      "NBA_COMPETITION_DIRECTORY",
      "src/shared/constants.ts",
    );
  });

  // Tier 1
  it("F1-T1-1: core Pro and Arena ongoing route builders emit exact verified URLs", () => {
    expect(routes.buildProPlayUrl()).toBe("https://sorare.com/nba/play");
    expect(routes.buildProLineupsUrl()).toBe(
      "https://sorare.com/nba/lineups/pro",
    );
    expect(routes.buildPrevLineupsUrl()).toBe(
      "https://sorare.com/nba/lineups/prev",
    );
    expect(routes.buildArenaOngoingUrl()).toBe(
      "https://sorare.com/nba/lineups/arena/ongoing",
    );
  });

  it("F1-T1-2: Arena fixture lineup and cash board builders match verified GW10 screenshot URLs", () => {
    expect(routes.buildArenaLineupsUrl("nba-21-23-nov-2026")).toBe(
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(
      routes.buildArenaBoardUrl(
        "nba-21-23-nov-2026",
        "nba-21-23-nov-2026-nba_limited_in_season_champion",
      ),
    ).toBe(
      "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion",
    );
  });

  it("F1-T1-3: Set Arcade, Squad, Hot Streak, and Squad BoardStep builders emit verified /nba/series routes", () => {
    expect(routes.buildSetPlayUrl("arcade")).toBe(
      "https://sorare.com/nba/series/play",
    );
    expect(routes.buildSetPlayUrl("squad")).toBe(
      "https://sorare.com/nba/series/squad",
    );
    expect(
      routes.buildSetPlayUrl(
        "hot_streak",
        "38c6feb9-269d-4640-a136-0ac21603b058",
      ),
    ).toBe(
      "https://sorare.com/nba/series/38c6feb9-269d-4640-a136-0ac21603b058/lineups",
    );
    expect(routes.buildSquadLineupUrl("BoardStep:abc-123")).toBe(
      "https://sorare.com/nba/series/squad/lineups/BoardStep%3Aabc-123",
    );
  });

  it("F1-T1-4: card/market builders and every NBA_COMPETITION_DIRECTORY URL pass isAllowedSorareUrl and fail isProhibitedSorareUrl", () => {
    expect(routes.buildCardUrl("wendell-carter-jr-2026-limited-1")).toBe(
      "https://sorare.com/nba/cards/wendell-carter-jr-2026-limited-1",
    );
    expect(
      routes.buildMarketPlayerUrl("wendell-carter-jr-19990416", "limited"),
    ).toBe(
      "https://sorare.com/nba/market?player=wendell-carter-jr-19990416&rarity=limited",
    );
    expect(constants.NBA_COMPETITION_DIRECTORY.length).toBeGreaterThanOrEqual(5);
    for (const entry of constants.NBA_COMPETITION_DIRECTORY) {
      expect(
        routes.isAllowedSorareUrl(entry.url),
        `[F1] Directory entry ${entry.id} must be allowed: ${entry.url}`,
      ).toBe(true);
      expect(
        routes.isProhibitedSorareUrl(entry.url),
        `[F1] Directory entry ${entry.id} must not be prohibited: ${entry.url}`,
      ).toBe(false);
    }
  });

  it("F1-T1-5: LineupsTab never calls prohibited /nba/arena or /nba/set 404 routes", () => {
    const lineupsSource = readRepoText("src/sidepanel/tabs/LineupsTab.tsx");
    expect(
      lineupsSource.includes("https://sorare.com/nba/arena"),
      "[F1] LineupsTab.tsx must replace prohibited 404 https://sorare.com/nba/arena with buildArenaLineupsUrl/buildArenaOngoingUrl",
    ).toBe(false);
    expect(
      lineupsSource.includes("https://sorare.com/nba/set"),
      "[F1] LineupsTab.tsx must never reference prohibited https://sorare.com/nba/set",
    ).toBe(false);
  });

  it("F1-T1-6: background OPEN_URL_IN_ACTIVE_TAB opens valid Arena/Set routes and rejects prohibited /nba/arena and /nba/set", async () => {
    const mock = await ensureBackgroundLoaded();
    resetBackgroundMockState(mock);

    const validArena = (await mock.triggerRuntimeMessage({
      type: "OPEN_URL_IN_ACTIVE_TAB",
      url: routes.buildArenaLineupsUrl("nba-21-23-nov-2026"),
    })) as { ok: boolean; error?: string };
    expect(validArena.ok).toBe(true);
    expect(mock.openedTabs[0]?.url).toBe(
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );

    const validSquad = (await mock.triggerRuntimeMessage({
      type: "OPEN_URL_IN_ACTIVE_TAB",
      url: routes.buildSetPlayUrl("squad"),
    })) as { ok: boolean; error?: string };
    expect(validSquad.ok).toBe(true);
    expect(mock.openedTabs[0]?.url).toBe("https://sorare.com/nba/series/squad");

    const blockedArena = (await mock.triggerRuntimeMessage({
      type: "OPEN_URL_IN_ACTIVE_TAB",
      url: "https://sorare.com/nba/arena",
    })) as { ok: boolean; error?: string };
    expect(
      blockedArena.ok,
      "[F1] Background OPEN_URL_IN_ACTIVE_TAB must reject prohibited https://sorare.com/nba/arena 404 URL",
    ).toBe(false);
    expect(
      mock.openedTabs[0]?.url,
      "[F1] Rejected /nba/arena navigation must not mutate active tab URL",
    ).toBe("https://sorare.com/nba/series/squad");

    const blockedSet = (await mock.triggerRuntimeMessage({
      type: "OPEN_URL_IN_ACTIVE_TAB",
      url: "https://sorare.com/nba/set",
    })) as { ok: boolean; error?: string };
    expect(
      blockedSet.ok,
      "[F1] Background OPEN_URL_IN_ACTIVE_TAB must reject prohibited https://sorare.com/nba/set URL",
    ).toBe(false);
  });

  // Tier 2
  it("F1-T2-1: null, undefined, whitespace, and ongoing inputs safely fall back to verified routes", () => {
    expect(routes.buildArenaLineupsUrl(null)).toBe(
      "https://sorare.com/nba/lineups/arena/ongoing",
    );
    expect(routes.buildArenaLineupsUrl("   ")).toBe(
      "https://sorare.com/nba/lineups/arena/ongoing",
    );
    expect(routes.buildArenaLineupsUrl("ongoing")).toBe(
      "https://sorare.com/nba/lineups/arena/ongoing",
    );
    expect(routes.buildArenaBoardUrl("nba-21-23-nov-2026", null)).toBe(
      "https://sorare.com/nba/play",
    );
    expect(routes.buildSetPlayUrl("hot_streak", undefined)).toBe(
      "https://sorare.com/nba/series/play",
    );
    expect(routes.buildSquadLineupUrl("")).toBe(
      "https://sorare.com/nba/series/squad",
    );
  });

  it("F1-T2-2: slug normalizer rejects traversal, delimiters, control chars, and literal null/undefined", () => {
    const invalidSlugs = [
      "../etc",
      "a/b",
      "a\\b",
      "a?b",
      "a#b",
      ".",
      "..",
      "foo\nbar",
      "foo\x00bar",
      "null",
      "undefined",
    ];
    for (const bad of invalidSlugs) {
      expect(routes.normalizeSorareSlug(bad)).toBeNull();
      expect(routes.buildArenaLineupsUrl(bad)).toBe(
        "https://sorare.com/nba/lineups/arena/ongoing",
      );
      expect(routes.buildCardUrl(bad)).toBe("https://sorare.com/nba/market");
    }
  });

  it("F1-T2-3: prohibited URL detector catches percent-encoded, multi-slash, and backslash obfuscations", () => {
    const obfuscated = [
      "https://sorare.com/nba/arena",
      "https://sorare.com/nba/arena/",
      "https://sorare.com/nba/%61rena",
      "https://sorare.com/nba/set",
      "https://sorare.com/nba/set%2fplay",
      "https://sorare.com//nba/arena",
      "https://sorare.com///nba/arena",
      "https://sorare.com/%2f/nba/arena",
      "https://sorare.com/\\nba/arena",
      "https://sorare.com/%5cnba/arena",
    ];
    for (const url of obfuscated) {
      expect(
        routes.isProhibitedSorareUrl(url),
        `Expected prohibited detection for ${url}`,
      ).toBe(true);
      expect(
        routes.isAllowedSorareUrl(url),
        `Expected allowed=false for prohibited ${url}`,
      ).toBe(false);
    }
  });

  it("F1-T2-4: isAllowedSorareUrl rejects non-HTTPS, external hosts, relative paths, and non-strings", () => {
    expect(routes.isAllowedSorareUrl("http://sorare.com/nba/play")).toBe(false);
    expect(routes.isAllowedSorareUrl("https://evil.com/nba/play")).toBe(false);
    expect(routes.isAllowedSorareUrl("https://sorare.com.evil.com/nba/play")).toBe(
      false,
    );
    expect(routes.isAllowedSorareUrl("/nba/play")).toBe(false);
    expect(routes.isAllowedSorareUrl("")).toBe(false);
    expect(
      (routes.isAllowedSorareUrl as unknown as (u: unknown) => boolean)(null),
    ).toBe(false);
  });

  it("F1-T2-5: URI encoding preserves reserved characters safely in market and squad step builders", () => {
    expect(
      routes.buildMarketPlayerUrl("player with space", "super_rare"),
    ).toBe(
      "https://sorare.com/nba/market?player=player%20with%20space&rarity=super_rare",
    );
    expect(routes.buildSquadLineupUrl("BoardStep:xyz 1")).toBe(
      "https://sorare.com/nba/series/squad/lineups/BoardStep%3Axyz%201",
    );
  });

  it("F1-T2-6: LineupsTab SSR empty-sync state renders Open Sorare Arena to Sync & Open Pro Play without /nba/arena links", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<LineupsTabComponent>(
      mod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const html = renderUiComponentToHtml(
      React.createElement(
        LineupsTab,
        makeLineupsTabProps({
          gallery: buildPjampjamGalleryResult({
            currentLineups: [],
            fixtures: SORARE_FIXTURES_GW8_TO_GW10,
          }),
        }),
      ),
    );
    const controls = extractButtonsAndControls(html);
    const labels = controls.map((c) => c.text);
    expect(labels.some((t) => t.includes("Open Sorare Arena to Sync"))).toBe(
      true,
    );
    expect(labels.some((t) => t.includes("Open Pro Play"))).toBe(true);
    expect(html.includes("/nba/arena\"")).toBe(false);

    const src = readRepoText("src/sidepanel/tabs/LineupsTab.tsx");
    expect(
      src.includes("buildArenaLineupsUrl") || src.includes("buildArenaOngoingUrl"),
      "[F1] LineupsTab.tsx must use buildArenaLineupsUrl/buildArenaOngoingUrl for Open Sorare Arena to Sync",
    ).toBe(true);
  });
});

// ============================================================================
// Feature 2: Content Script /nba/series Detection & Highlight Go Support (10 tests)
// ============================================================================

describe("Feature 2: Content Script /nba/series Detection & Highlight Go Support", () => {
  let domParser: DomParserContract;

  beforeAll(async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/content/sorareDomParser.ts",
    );
    domParser = mod as unknown as DomParserContract;
    requireExport(mod, "classifySorareContext", "src/content/sorareDomParser.ts");
  });

  // Tier 1
  it("F2-T1-1: classifySorareContext classifies all /nba/series/* and /nba/play/boards/arena/* routes as lineups", () => {
    const urls = [
      "https://sorare.com/nba/series/play",
      "https://sorare.com/nba/series/squad",
      "https://sorare.com/nba/series/38c6feb9-269d-4640-a136-0ac21603b058/lineups",
      "https://sorare.com/nba/series/squad/lineups/BoardStep%3Aabc",
      "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion",
    ];
    for (const url of urls) {
      expect(domParser.classifySorareContext(url)).toBe("lineups");
    }
  });

  it("F2-T1-2: sorareDetector.ts executes cleanly in VM on Set Arcade, Squad, and Hot Streak pages with context === lineups", async () => {
    const cases: Array<{ html: string; url: string }> = [
      {
        html: buildSetArcadePlayHtml(),
        url: "https://sorare.com/nba/series/play",
      },
      {
        html: buildSetSquadHtml(),
        url: "https://sorare.com/nba/series/squad",
      },
      {
        html: buildSetHotStreakLineupsHtml(),
        url: "https://sorare.com/nba/series/38c6feb9-269d-4640-a136-0ac21603b058/lineups",
      },
    ];
    for (const c of cases) {
      const mock = installChromeAndFetchMock();
      try {
        const res = await runContentScriptInVm(c.html, c.url, mock);
        expect(res.context).toBe("lineups");
        expect(res.errors).toEqual([]);
      } finally {
        mock.restore();
      }
    }
  });

  it("F2-T1-3: SHOW_LINEUP_CHECKLIST runtime message triggers checklist HUD cleanly in VM without errors", async () => {
    const mock = installChromeAndFetchMock();
    try {
      const tileHtml = `<!DOCTYPE html><html><body>
        <main>
          <a href="/nba/cards/wendell-carter-jr-2026-limited-1">
            <span>WENDELL</span><span>CARTER JR.</span>
          </a>
        </main>
      </body></html>`;
      const res = await runContentScriptInVm(
        tileHtml,
        "https://sorare.com/nba/series/play",
        mock,
      );
      expect(res.context).toBe("lineups");
      expect(mock.chrome.runtime.onMessage.hasListeners()).toBe(true);

      await mock.triggerRuntimeMessage({
        type: "SHOW_LINEUP_CHECKLIST",
        playerNames: ["Wendell Carter Jr."],
        slots: [
          {
            slotLabel: "C",
            cardSlug: "wendell-carter-jr-2026-limited-1",
            playerName: "Wendell Carter Jr.",
            rarity: "limited",
            seasonYear: 2026,
            isCaptain: false,
          },
        ],
        formatLabel: "Set Solo",
        projectedTotal: 30.2,
        autoHighlightFirst: false,
      });

      expect(res.errors).toEqual([]);
      const detectorSrc = readRepoText("src/content/sorareDetector.ts");
      expect(detectorSrc.includes("jamassist-lineup-hud")).toBe(true);
      expect(detectorSrc.includes("3px solid #10b981")).toBe(true);
    } finally {
      mock.restore();
    }
  });

  it("F2-T1-4: fresh jamassist_pending_lineup_hud storage payload is consumed and cleared on VM page load", async () => {
    const mock = installChromeAndFetchMock({
      initialStorage: {
        jamassist_pending_lineup_hud: {
          playerNames: ["Jalen Johnson"],
          slots: [
            {
              slotLabel: "F",
              cardSlug: "jalen-johnson-2026-common-1",
              playerName: "Jalen Johnson",
              rarity: "common",
              seasonYear: 2026,
              isCaptain: false,
            },
          ],
          formatLabel: "Daily Picker",
          projectedTotal: 45.2,
          autoHighlightFirst: true,
          createdAt: Date.now(),
        },
      },
    });
    try {
      const tileHtml = `<!DOCTYPE html><html><body>
        <main>
          <a href="/nba/cards/jalen-johnson-2026-common-1">
            <span>JALEN</span><span>JOHNSON</span>
          </a>
        </main>
      </body></html>`;
      const res = await runContentScriptInVm(
        tileHtml,
        "https://sorare.com/nba/series/play",
        mock,
      );
      expect(res.errors).toEqual([]);
      expect(mock.storageData.jamassist_pending_lineup_hud).toBeUndefined();
    } finally {
      mock.restore();
    }
  });

  it("F2-T1-5: background APPLY_LINEUP_HIGHLIGHT supports targetUrl navigation and autoHighlightFirst persistence for Go actions", async () => {
    const mock = await ensureBackgroundLoaded();
    resetBackgroundMockState(mock);
    mock.openedTabs[0] = {
      id: 1,
      url: "https://sorare.com/nba/play",
      active: true,
      windowId: 1,
    };

    const resp = (await mock.triggerRuntimeMessage({
      type: "APPLY_LINEUP_HIGHLIGHT",
      playerNames: ["Jalen Johnson"],
      slots: [
        {
          slotLabel: "F",
          cardSlug: "jalen-johnson-2026-common-1",
          playerName: "Jalen Johnson",
          rarity: "common",
          seasonYear: 2026,
          isCaptain: false,
        },
      ],
      formatLabel: "Set Solo",
      projectedTotal: 45.2,
      targetUrl: "https://sorare.com/nba/series/play",
      autoHighlightFirst: true,
    })) as { ok: boolean; error?: string };

    expect(resp.ok).toBe(true);
    expect(
      mock.openedTabs[0]?.url,
      "[F2] APPLY_LINEUP_HIGHLIGHT with targetUrl must navigate Sorare tab to targetUrl",
    ).toBe("https://sorare.com/nba/series/play");

    const pending = mock.storageData.jamassist_pending_lineup_hud as
      | Record<string, unknown>
      | undefined;
    expect(
      pending,
      "[F2] Navigating via targetUrl must stage jamassist_pending_lineup_hud for the destination page",
    ).toBeDefined();
    expect(
      pending?.autoHighlightFirst,
      "[F2] Pending HUD payload must preserve autoHighlightFirst: true",
    ).toBe(true);

    const apiSrc = readRepoText("src/sidepanel/api.ts");
    expect(
      apiSrc.includes("targetUrl") && apiSrc.includes("autoHighlightFirst"),
      "[F2] src/sidepanel/api.ts applyLineupHighlight must accept/forward targetUrl and autoHighlightFirst",
    ).toBe(true);
  });

  // Tier 2
  it("F2-T2-1: classifySorareContext enforces craft > quests precedence and avoids false craft on boards/lineups", () => {
    expect(
      domParser.classifySorareContext("https://sorare.com/nba/play", true),
    ).toBe("quests");
    expect(
      domParser.classifySorareContext("https://sorare.com/nba/craft", true),
    ).toBe("craft");
    expect(
      domParser.classifySorareContext("https://sorare.com/nba/essence", true),
    ).toBe("craft");
    expect(
      domParser.classifySorareContext(
        "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/board",
      ),
    ).toBe("lineups");
    expect(
      domParser.classifySorareContext(
        "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
      ),
    ).toBe("lineups");
  });

  it("F2-T2-2: classifySorareContext distinguishes collections, market, and general club routes", () => {
    expect(
      domParser.classifySorareContext("https://sorare.com/nba/collections"),
    ).toBe("collections");
    expect(
      domParser.classifySorareContext("https://sorare.com/nba/market"),
    ).toBe("market");
    expect(
      domParser.classifySorareContext(
        "https://sorare.com/nba/cards/wendell-carter-jr-2026-limited-1",
      ),
    ).toBe("market");
    expect(
      domParser.classifySorareContext("https://sorare.com/nba/club/pjampjam"),
    ).toBe("general");
  });

  it("F2-T2-3: sorareDetector.ts ignores stale pending HUD (>120s) and malformed SHOW_LINEUP_CHECKLIST payloads safely", async () => {
    const staleKey = {
      playerNames: ["Brook Lopez"],
      formatLabel: "Old",
      projectedTotal: 20,
      createdAt: Date.now() - 180_000,
    };
    const mock = installChromeAndFetchMock({
      initialStorage: {
        jamassist_pending_lineup_hud: staleKey,
      },
    });
    try {
      const res = await runContentScriptInVm(
        buildSetArcadePlayHtml(),
        "https://sorare.com/nba/series/play",
        mock,
      );
      expect(res.errors).toEqual([]);
      // Stale payload (>120s) is ignored and not removed by checkPendingLineupHud
      expect(mock.storageData.jamassist_pending_lineup_hud).toBeDefined();

      await mock.triggerRuntimeMessage({
        type: "SHOW_LINEUP_CHECKLIST",
        playerNames: [],
        slots: null,
        projectedTotal: Number.NaN,
      });
      await mock.triggerRuntimeMessage({
        type: "SHOW_LINEUP_CHECKLIST",
        playerNames: "not-an-array",
      });
      expect(res.errors).toEqual([]);
    } finally {
      mock.restore();
    }
  });

  it("F2-T2-4: sorareDetector.ts preserves reserved segment guard on /nba/series/play and /nba/series/squad", async () => {
    const urls = [
      {
        html: buildSetArcadePlayHtml(),
        url: "https://sorare.com/nba/series/play",
      },
      {
        html: buildSetSquadHtml(),
        url: "https://sorare.com/nba/series/squad",
      },
    ];
    for (const item of urls) {
      const mock = installChromeAndFetchMock();
      try {
        const res = await runContentScriptInVm(item.html, item.url, mock);
        expect(res.errors).toEqual([]);
        const userMsgs = mock.sentMessages
          .map((m) => m.message as { type?: string; username?: string })
          .filter((m) => m?.type === "DETECTED_USERNAME_FROM_CONTENT");
        for (const msg of userMsgs) {
          expect(msg.username).toBe("pjampjam");
          expect(msg.username).not.toBe("series");
          expect(msg.username).not.toBe("squad");
          expect(msg.username).not.toBe("play");
        }
      } finally {
        mock.restore();
      }
    }
  });

  it("F2-T2-5: background APPLY_LINEUP_HIGHLIGHT rejects disallowed external and prohibited /nba/arena /nba/set targetUrls", async () => {
    const mock = await ensureBackgroundLoaded();
    const badTargets = [
      "https://evil.com/nba/play",
      "https://sorare.com/nba/arena",
      "https://sorare.com/nba/set",
    ];
    for (const badUrl of badTargets) {
      resetBackgroundMockState(mock);
      const resp = (await mock.triggerRuntimeMessage({
        type: "APPLY_LINEUP_HIGHLIGHT",
        playerNames: ["Wendell Carter Jr."],
        formatLabel: "Arena Cont",
        projectedTotal: 150,
        targetUrl: badUrl,
        autoHighlightFirst: true,
      })) as { ok: boolean; error?: string };
      expect(
        resp.ok,
        `[F2] APPLY_LINEUP_HIGHLIGHT must reject disallowed/prohibited targetUrl: ${badUrl}`,
      ).toBe(false);
      expect(mock.openedTabs[0]?.url).toBe("https://sorare.com/nba/play");
    }
  });
});

// ============================================================================
// Feature 3: Reliable DOM Lineup Extraction (12 tests)
// ============================================================================

describe("Feature 3: Reliable DOM Lineup Extraction (Arena & Multi-Lineup)", () => {
  let domParser: DomParserContract;

  beforeAll(async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/content/sorareDomParser.ts",
    );
    domParser = mod as unknown as DomParserContract;
    requireExport(
      mod,
      "extractOpenLineupsFromDocument",
      "src/content/sorareDomParser.ts",
    );
  });

  // Tier 1
  it("F3-T1-1: extracts 3 Arena Classic Contender GW10 lineups with 5 players, 11★ cap, classic scope, and fixtureSlug", () => {
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const doc = createMiniDocument(buildArenaGw10LineupsHtml(), url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);

    expect(extracted).toHaveLength(3);
    for (const entry of extracted) {
      expect(entry.expectedCardCount).toBe(5);
      expect(entry.playerNames).toHaveLength(5);
      expect(entry.contestKind).toBe("arena");
      expect(entry.seasonScope).toBe("classic");
      expect(entry.starCap).toBe(11);
      expect(entry.fixtureSlug).toBe("nba-21-23-nov-2026");
      expect(entry.source).toBe("dom");
    }
  });

  it("F3-T1-2: extracts all 15 exact player names from stacked tokens and excludes ROOKIE/GTD badge noise", () => {
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const doc = createMiniDocument(buildArenaGw10LineupsHtml(), url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);

    expect(extracted[0]?.playerNames).toEqual([
      "Morez Johnson Jr.",
      "DeMar DeRozan",
      "Malik Monk",
      "Christian Anderson Jr.",
      "Taylor Hendricks",
    ]);
    expect(extracted[1]?.playerNames).toEqual([
      "Aaron Gordon",
      "Brook Lopez",
      "Wendell Carter Jr.",
      "Quenton Jackson",
      "Dillon Brooks",
    ]);
    expect(extracted[2]?.playerNames).toEqual([
      "Jarace Walker",
      "Bub Carrington",
      "Allen Graves",
      "Dean Wade",
      "Nikola Vucevic",
    ]);

    const allTokens = extracted.flatMap((l) => l.playerNames ?? []);
    expect(allTokens).not.toContain("ROOKIE");
    expect(allTokens).not.toContain("GTD");
    expect(allTokens).not.toContain("LEVEL UP");
  });

  it("F3-T1-3: runContentScriptInVm emits DETECTED_LINEUPS_FROM_CONTENT with 3 GW10 lineups and zero errors", async () => {
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const mock = installChromeAndFetchMock();
    try {
      const res = await runContentScriptInVm(
        buildArenaGw10LineupsHtml(),
        url,
        mock,
      );
      expect(res.context).toBe("lineups");
      expect(res.errors).toEqual([]);
      const normalized = normalizeVmArray<DomDetectedLineupShape>(
        res.extractedLineups,
      );
      expect(normalized).toHaveLength(3);
      expect(normalized.every((l) => (l.playerNames?.length ?? 0) === 5)).toBe(
        true,
      );
    } finally {
      mock.restore();
    }
  });

  it("F3-T1-4: Pro Lobby HTML with card links and img alt/src extracts cardSlugs, pro kind, in_season scope, and 16★ cap", () => {
    const url = "https://sorare.com/nba/lineups/pro";
    const proHtml = `<!DOCTYPE html><html><body><main>
      <section>
        <h3>In-Season Champion</h3>
        <p>16★ Cap • 5,219 entrants</p>
        <div>
          <a href="/nba/cards/wendell-carter-jr-2026-limited-1"><img alt="Wendell Carter Jr." src="/players/wendell-carter-jr.png" /></a>
          <a href="/nba/cards/aaron-gordon-2026-limited-1"><img alt="Aaron Gordon" src="/players/aaron-gordon.png" /></a>
          <a href="/nba/cards/dillon-brooks-2026-limited-1"><img alt="Dillon Brooks" src="/players/dillon-brooks.png" /></a>
          <a href="/nba/cards/jarace-walker-2026-limited-1"><img alt="Jarace Walker" src="/players/jarace-walker.png" /></a>
          <a href="/nba/cards/bub-carrington-2026-limited-1"><img alt="Bub Carrington" src="/players/bub-carrington.png" /></a>
        </div>
        <button type="button">Edit Lineup</button>
      </section>
    </main></body></html>`;
    const doc = createMiniDocument(proHtml, url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);

    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.contestKind).toBe("pro");
    expect(extracted[0]?.seasonScope).toBe("in_season");
    expect(extracted[0]?.starCap).toBe(16);
    expect(extracted[0]?.cardSlugs).toEqual([
      "wendell-carter-jr-2026-limited-1",
      "aaron-gordon-2026-limited-1",
      "dillon-brooks-2026-limited-1",
      "jarace-walker-2026-limited-1",
      "bub-carrington-2026-limited-1",
    ]);
    expect(extracted[0]?.playerNames).toEqual([
      "Wendell Carter Jr.",
      "Aaron Gordon",
      "Dillon Brooks",
      "Jarace Walker",
      "Bub Carrington",
    ]);
  });

  it("F3-T1-5: empty and non-editable pages emit zero phantom extracted lineups", () => {
    const nonLineupPages: Array<{ html: string; url: string }> = [
      {
        html: buildProLineupsEmptyHtml(),
        url: "https://sorare.com/nba/lineups/pro",
      },
      {
        html: buildArenaOngoingHtml(),
        url: "https://sorare.com/nba/lineups/arena/ongoing",
      },
      {
        html: buildArenaCashBoardHtml(),
        url: "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion",
      },
      {
        html: buildSetArcadePlayHtml(),
        url: "https://sorare.com/nba/series/play",
      },
      {
        html: buildSetSquadHtml(),
        url: "https://sorare.com/nba/series/squad",
      },
      {
        html: buildSetHotStreakLineupsHtml(),
        url: "https://sorare.com/nba/series/38c6feb9-269d-4640-a136-0ac21603b058/lineups",
      },
    ];
    for (const p of nonLineupPages) {
      const doc = createMiniDocument(p.html, p.url);
      expect(domParser.extractOpenLineupsFromDocument(doc, p.url)).toEqual([]);
    }
  });

  it("F3-T1-6: extracted GW10 lineups get distinct ids/labels (#1..#3) and match 15/15 cards in PJAMPJAM_GALLERY_CARDS", () => {
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const doc = createMiniDocument(buildArenaGw10LineupsHtml(), url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);

    const ids = new Set(extracted.map((l) => l.id));
    const names = new Set(extracted.map((l) => l.name));
    expect(ids.size).toBe(3);
    expect(names.size).toBe(3);
    expect(extracted.map((l) => l.name)).toEqual([
      "Arena Classic Contender #1",
      "Arena Classic Contender #2",
      "Arena Classic Contender #3",
    ]);

    const galleryByNorm = new Set(
      PJAMPJAM_GALLERY_CARDS.map((c) =>
        domParser.normalizeNameForMatch(c.playerName),
      ),
    );
    const extractedNames = extracted.flatMap((l) => l.playerNames ?? []);
    expect(extractedNames).toHaveLength(15);
    const matched = extractedNames.filter((n) =>
      galleryByNorm.has(domParser.normalizeNameForMatch(n)),
    );
    expect(matched).toHaveLength(15);
  });

  // Tier 2
  it("F3-T2-1: noise-only Edit Lineup container emits zero phantom 0-card lineups", () => {
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const noiseHtml = `<!DOCTYPE html><html><body><main>
      <section>
        <h3>Arena Classic Contender</h3>
        <div>Level Up</div>
        <div>Empty Slot</div>
        <div>Select Guard</div>
        <div>Add Card</div>
        <button type="button">Edit Lineup</button>
      </section>
    </main></body></html>`;
    const doc = createMiniDocument(noiseHtml, url);
    expect(domParser.extractOpenLineupsFromDocument(doc, url)).toEqual([]);
  });

  it("F3-T2-2: handles apostrophes, hyphens, dotted/2-letter initials, and 3-line suffixes while rejecting matchup text", () => {
    const url = "https://sorare.com/nba/lineups/pro";
    const html = `<!DOCTYPE html><html><body><main>
      <section>
        <h3>Classic Contender</h3>
        <p>11★ Cap • DET vs. LAL • NYK v MIA • NY - BOS</p>
        <div><span>DAY'RON</span><span>SHARPE</span></div>
        <div><span>NICKEIL</span><span>ALEXANDER-WALKER</span></div>
        <div><span>P.J.</span><span>WASHINGTON</span></div>
        <div><span>CJ</span><span>MCCOLLUM</span></div>
        <div><span>MOREZ</span><span>JOHNSON</span><span>JR.</span></div>
        <button type="button">Edit Lineup</button>
      </section>
    </main></body></html>`;
    const doc = createMiniDocument(html, url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.playerNames).toEqual([
      "Day'Ron Sharpe",
      "Nickeil Alexander-Walker",
      "P.J. Washington",
      "CJ McCollum",
      "Morez Johnson Jr.",
    ]);
  });

  it("F3-T2-3: parses multi-row 2+2+1 slot grids, slash star caps (7★ / 11★ -> 11), and multi-line headers cleanly", () => {
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const html = `<!DOCTYPE html><html><body><main>
      <section>
        <header>
          <div>GAMEWEEK 10</div>
          <div>ARENA</div>
          <div>Classic Contender</div>
          <div>7★ / 11★ Cap</div>
          <div>1,868 entrants</div>
          <div>Nov 21-23</div>
          <div>2d 2h</div>
        </header>
        <div class="row-1">
          <div><span>AARON</span><span>GORDON</span></div>
          <div><span>BROOK</span><span>LOPEZ</span></div>
        </div>
        <div class="row-2">
          <div><span>WENDELL</span><span>CARTER JR.</span></div>
          <div><span>QUENTON</span><span>JACKSON</span></div>
        </div>
        <div class="row-3">
          <div><span>DILLON</span><span>BROOKS</span></div>
        </div>
        <button type="button">Edit Lineup</button>
      </section>
    </main></body></html>`;
    const doc = createMiniDocument(html, url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.starCap).toBe(11);
    expect(extracted[0]?.playerNames).toHaveLength(5);
  });

  it("F3-T2-4: partial 2-card lineup with 3 Empty Slot placeholders isolates exactly 2 players", () => {
    const url = "https://sorare.com/nba/lineups/pro";
    const html = `<!DOCTYPE html><html><body><main>
      <section>
        <h3>Classic Champion</h3>
        <p>16★ Cap</p>
        <div><span>KARL-ANTHONY</span><span>TOWNS</span></div>
        <div><span>GG</span><span>JACKSON</span></div>
        <div>Empty Slot</div>
        <div>Empty Slot</div>
        <div>Empty Slot</div>
        <button type="button">Edit Lineup</button>
      </section>
    </main></body></html>`;
    const doc = createMiniDocument(html, url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.playerNames).toEqual([
      "Karl-Anthony Towns",
      "GG Jackson",
    ]);
  });

  it("F3-T2-5: mixed sibling Edit Lineup and View Lineup containers stay isolated without player bleed", () => {
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const html = `<!DOCTYPE html><html><body><main><div class="wrapper">
      <section>
        <h3>Arena Classic Contender</h3>
        <p>11★ Cap</p>
        <div><span>AARON</span><span>GORDON</span></div>
        <div><span>BROOK</span><span>LOPEZ</span></div>
        <div><span>WENDELL</span><span>CARTER JR.</span></div>
        <div><span>QUENTON</span><span>JACKSON</span></div>
        <div><span>DILLON</span><span>BROOKS</span></div>
        <button type="button">Edit Lineup</button>
      </section>
      <section>
        <h3>Arena In-Season Contender</h3>
        <p>12★ Cap</p>
        <div><span>JARACE</span><span>WALKER</span></div>
        <div><span>BUB</span><span>CARRINGTON</span></div>
        <div><span>ALLEN</span><span>GRAVES</span></div>
        <div><span>DEAN</span><span>WADE</span></div>
        <div><span>NIKOLA</span><span>VUCEVIC</span></div>
        <button type="button">View Lineup</button>
      </section>
    </div></main></body></html>`;
    const doc = createMiniDocument(html, url);
    const extracted = domParser.extractOpenLineupsFromDocument(doc, url);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]?.playerNames).toHaveLength(5);
    expect(extracted[1]?.playerNames).toHaveLength(5);
    expect(extracted[0]?.playerNames).not.toContain("Jarace Walker");
    expect(extracted[1]?.playerNames).not.toContain("Aaron Gordon");
  });

  it("F3-T2-6: route gate rejects lineup extraction on prev, ongoing, cash board, and series routes", () => {
    const sampleHtml = buildArenaGw10LineupsHtml();
    const blockedUrls = [
      "https://sorare.com/nba/lineups/prev",
      "https://sorare.com/nba/lineups/arena/ongoing",
      "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/board",
      "https://sorare.com/nba/series/squad",
    ];
    for (const url of blockedUrls) {
      expect(domParser.isProOrArenaLineupUrl(url)).toBe(false);
      const doc = createMiniDocument(sampleHtml, url);
      expect(domParser.extractOpenLineupsFromDocument(doc, url)).toEqual([]);
    }
  });
});

// ============================================================================
// Feature 4: Set Arcade / Solo vs. Squad / Hot Streak Rules & Go Actions (10 tests)
// ============================================================================

describe("Feature 4: Set Arcade / Solo vs. Squad / Hot Streak Rules & Go Actions", () => {
  let constants: ConstantsContract;
  let setMath: SetMathContract;

  beforeAll(async () => {
    const constMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/constants.ts",
    );
    const setMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/commonSetMath.ts",
    );
    constants = constMod as unknown as ConstantsContract;
    setMath = setMod as unknown as SetMathContract;
    requireExport(constMod, "SET_ARCADE_RULES", "src/shared/constants.ts");
    requireExport(
      setMod,
      "rankDailyPickerCandidates",
      "src/calculators/commonSetMath.ts",
    );
    requireExport(setMod, "buildSetTeams", "src/calculators/commonSetMath.ts");
  });

  // Tier 1
  it("F4-T1-1: SET_ARCADE_RULES defines 4 Lives, +5% Collection bonus, editions, Daily Picker, Squad, Hot Streak, and Essence scrap", () => {
    const r = constants.SET_ARCADE_RULES;
    expect(r.livesPerRun).toBe(4);
    expect(r.collectionBonusPctMax).toBe(5);
    expect(r.editionBoostPct).toEqual({ standard: 0, shiny: 5, holo: 10 });
    expect(r.dailyPickerMinScore).toBe(20);
    expect(r.dailyPickerL10Offset).toBe(7);
    expect(r.squadSalaryCap).toBe(120);
    expect(r.squadMvpFree).toBe(true);
    expect(r.hotStreakDefaultTargetPts).toBe(150);
    expect(r.duplicateScrapReward).toBe("Essence");
    expect(r.cardTiers).toEqual([
      "TIER_0",
      "TIER_1",
      "TIER_2",
      "TIER_3",
      "TIER_4",
      "TIER_5",
    ]);
  });

  it("F4-T1-2: rankDailyPickerCandidates excludes OUT Scottie Barnes, computes max(20, L10+7), and sorts by hitChancePct", () => {
    const ranked = setMath.rankDailyPickerCandidates(
      PJAMPJAM_COMMON_CARDS,
      PJAMPJAM_INJURIES_BY_NAME,
      PJAMPJAM_GAMES_PER_TEAM,
      8,
    );
    expect(ranked.length).toBe(5);
    expect(
      ranked.some((c) => c.card.playerName === "Scottie Barnes"),
    ).toBe(false);
    for (let i = 0; i < ranked.length; i += 1) {
      const item = ranked[i];
      expect(item.targetScore).toBe(
        Math.round(Math.max(20, item.l10 + 7) * 10) / 10,
      );
      if (i > 0) {
        expect(ranked[i - 1].hitChancePct).toBeGreaterThanOrEqual(
          item.hitChancePct,
        );
      }
    }
  });

  it("F4-T1-3: buildSetTeams cleanly separates solo vs squad modes", () => {
    const solo = setMath.buildSetTeams(PJAMPJAM_COMMON_CARDS, {
      mode: "solo",
      teamCount: 4,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(solo.mode).toBe("solo");
    expect(solo.soloPicks).toHaveLength(4);
    expect(solo.squadTeams).toEqual([]);

    const squad = setMath.buildSetTeams(PJAMPJAM_COMMON_CARDS, {
      mode: "squad",
      teamCount: 2,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(squad.mode).toBe("squad");
    expect(squad.soloPicks).toEqual([]);
    // Live rule (2026-11-19): 16-star cap. These Commons are 3.5-4 stars each (cheapest 5 = 19),
    // so no legal team exists; the builder must return none rather than break the cap.
    expect(squad.squadTeams).toHaveLength(0);
    const cheapPool = PJAMPJAM_COMMON_CARDS.map((c, idx) => ({ ...c, starCost: 2.5 + (idx % 2) * 0.5 }));
    const cheapSquad = setMath.buildSetTeams(cheapPool, {
      mode: "squad",
      teamCount: 1,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(cheapSquad.squadTeams).toHaveLength(1);
    expect(cheapSquad.squadTeams[0].slots).toHaveLength(5);
    expect(cheapSquad.squadTeams[0].capUsed).toBeLessThanOrEqual(16);
  });

  it("F4-T1-4: LineupsTab Set/Common UI explicitly documents 4 Lives, +5% bonus, card tiers, Essence scrap, Hot Streak, and Solo vs Squad", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<LineupsTabComponent>(
      mod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const setHtml = renderUiComponentToHtml(
      React.createElement(
        LineupsTab,
        makeLineupsTabProps({ initialArenaMode: "set_common" }),
      ),
    );
    const lineupsSrc = readRepoText("src/sidepanel/tabs/LineupsTab.tsx");
    const combined = `${setHtml}\n${lineupsSrc}`;

    expect(
      /4\s*Lives/i.test(combined),
      "[F4] LineupsTab Set Arcade UI must explain 4 Lives",
    ).toBe(true);
    expect(
      /\+?\s*5%/.test(combined) && /Collection/i.test(combined),
      "[F4] LineupsTab Set Arcade UI must explain +5% Collection/Edition boost",
    ).toBe(true);
    expect(
      /tier/i.test(combined) && /scrap|duplicate/i.test(combined) && /Essence/i.test(combined),
      "[F4] LineupsTab Set Arcade UI must explain card tiers and duplicate scrapping for Essence",
    ).toBe(true);
    expect(
      /Solo Mode/i.test(combined) && /Squad Mode/i.test(combined),
      "[F4] LineupsTab must visually distinguish Solo Mode vs. Squad Mode",
    ).toBe(true);
    expect(
      /Hot Streak/i.test(combined) && /150/.test(combined),
      "[F4] LineupsTab Set/Common view must surface Hot Streak 150 PTS target",
    ).toBe(true);
  });

  it("F4-T1-5: LineupsTab renders Go jump/highlight buttons next to Apply (Pro & Set) and Pin (Daily Picker)", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<LineupsTabComponent>(
      mod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const proHtml = renderUiComponentToHtml(
      React.createElement(LineupsTab, makeLineupsTabProps()),
    );
    const proControls = extractButtonsAndControls(proHtml);
    expect(
      proControls.some((c) => /^go$/i.test(c.text)),
      "[F4] LineupsTab Pro view must render a Go jump/highlight button next to Apply",
    ).toBe(true);

    const setHtml = renderUiComponentToHtml(
      React.createElement(
        LineupsTab,
        makeLineupsTabProps({ initialArenaMode: "set_common" }),
      ),
    );
    const setControls = extractButtonsAndControls(setHtml);
    const setGoCount = setControls.filter((c) => /^go$/i.test(c.text)).length;
    expect(
      setGoCount,
      "[F4] LineupsTab Set/Common view must render Go buttons next to Daily Picker Pin and Set Solo/Squad Apply",
    ).toBeGreaterThanOrEqual(2);
  });

  // Tier 2
  it("F4-T2-1: Daily Picker floors depressed L10 at 20.0, excludes OUT/0-proj players, and deduplicates playerSlug", () => {
    const customCommons: GalleryCard[] = [
      {
        ...PJAMPJAM_COMMON_CARDS[0],
        slug: "depressed-l10-1",
        playerSlug: "depressed-player",
        playerName: "Depressed Ten",
        l10: 10,
        l5: 22,
        sorareClassicProjected: 22,
      },
      {
        ...PJAMPJAM_COMMON_CARDS[0],
        slug: "depressed-l10-dup",
        playerSlug: "depressed-player",
        playerName: "Depressed Ten",
        l10: 10,
        l5: 22,
        sorareClassicProjected: 22,
      },
      {
        ...PJAMPJAM_COMMON_CARDS[1],
        slug: "boundary-13",
        playerSlug: "boundary-13-player",
        playerName: "Boundary Thirteen",
        l10: 13,
        l5: 21,
        sorareClassicProjected: 21,
      },
      {
        ...PJAMPJAM_COMMON_CARDS[2],
        slug: "boundary-14",
        playerSlug: "boundary-14-player",
        playerName: "Boundary Fourteen",
        l10: 14,
        l5: 21,
        sorareClassicProjected: 21,
      },
      PJAMPJAM_COMMON_CARDS[5], // Scottie Barnes OUT
    ];

    const ranked = setMath.rankDailyPickerCandidates(
      customCommons,
      PJAMPJAM_INJURIES_BY_NAME,
      PJAMPJAM_GAMES_PER_TEAM,
      10,
    );
    expect(ranked).toHaveLength(3);
    const bySlug = new Map(ranked.map((r) => [r.card.playerSlug, r]));
    expect(bySlug.get("depressed-player")?.targetScore).toBe(20.0);
    expect(bySlug.get("boundary-13-player")?.targetScore).toBe(20.0);
    expect(bySlug.get("boundary-14-player")?.targetScore).toBe(21.0);
    expect(bySlug.has("scottie-barnes-20010801")).toBe(false);
  });

  it("F4-T2-2: buildSetTeams clamps teamCount to [1..8] and filters out non-common cards", () => {
    const mixedPool: GalleryCard[] = [
      ...PJAMPJAM_COMMON_CARDS,
      PJAMPJAM_GALLERY_CARDS[0], // Limited card must be ignored
    ];
    const zeroCount = setMath.buildSetTeams(mixedPool, {
      mode: "solo",
      teamCount: 0,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(zeroCount.soloPicks).toHaveLength(1);
    expect(zeroCount.soloPicks[0].card.rarity).toBe("common");

    const manyCommons: GalleryCard[] = Array.from({ length: 12 }, (_, idx) => ({
      ...PJAMPJAM_COMMON_CARDS[idx % 5],
      slug: `common-extra-${idx}`,
      playerSlug: `common-extra-player-${idx}`,
      playerName: `Common Player ${idx}`,
    }));
    const clampedHigh = setMath.buildSetTeams(manyCommons, {
      mode: "solo",
      teamCount: 99,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(clampedHigh.soloPicks).toHaveLength(8);
  });

  // Live rule 2026-11-19 (docs/SORARE_FACTS.md): Set teams have a 16-star cap; the old
  // "120 Cap + free MVP" Squad rule is retired.
  it("F4-T2-3: Squad mode enforces the live 16-star cap", () => {
    const squadCards: GalleryCard[] = [
      { ...PJAMPJAM_COMMON_CARDS[3], l10: 45, sorareClassicProjected: 48, starCost: 4 },
      { ...PJAMPJAM_COMMON_CARDS[0], l10: 30, sorareClassicProjected: 34, starCost: 3 },
      { ...PJAMPJAM_COMMON_CARDS[1], l10: 30, sorareClassicProjected: 33, starCost: 3 },
      { ...PJAMPJAM_COMMON_CARDS[2], l10: 30, sorareClassicProjected: 32, starCost: 3 },
      { ...PJAMPJAM_COMMON_CARDS[4], l10: 30, sorareClassicProjected: 31, starCost: 3 },
      { ...PJAMPJAM_COMMON_CARDS[5], playerSlug: "extra-p", slug: "extra-common", l10: 50, sorareClassicProjected: 55, starCost: 5 },
    ];
    const res = setMath.buildSetTeams(squadCards, {
      mode: "squad",
      teamCount: 1,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(res.squadTeams).toHaveLength(1);
    const team = res.squadTeams[0];
    expect(team.slots).toHaveLength(5);
    expect(team.capUsed).toBeLessThanOrEqual(16);
  });

  it("F4-T2-4: NBA_COMPETITION_DIRECTORY Set entries align with /nba/series routes and verified rules", () => {
    const byId = new Map(
      constants.NBA_COMPETITION_DIRECTORY.map((c) => [c.id, c]),
    );
    expect(byId.get("set-arcade")?.url).toBe("https://sorare.com/nba/series/play");
    expect(byId.get("set-arcade")?.rulesSummary).toContain("4 Lives");
    expect(byId.get("set-squad")?.url).toBe("https://sorare.com/nba/series/squad");
    expect(byId.get("set-squad")?.rulesSummary).toContain("16★ Cap");
    expect(byId.get("set-hot-streak")?.url).toBe(
      "https://sorare.com/nba/series/play",
    );
    expect(byId.get("set-hot-streak")?.rulesSummary).toContain("4 Teams");
  });

  it("F4-T2-5: Set Go buttons target /nba/series/* routes and never prohibited /nba/set", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<LineupsTabComponent>(
      mod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const setHtml = renderUiComponentToHtml(
      React.createElement(
        LineupsTab,
        makeLineupsTabProps({ initialArenaMode: "set_common" }),
      ),
    );
    const controls = extractButtonsAndControls(setHtml);
    expect(
      controls.some((c) => /^go$/i.test(c.text)),
      "[F4] Set/Common view must include Go controls wired to buildSetPlayUrl (/nba/series/*)",
    ).toBe(true);
    expect(setHtml.includes("/nba/set")).toBe(false);
    const src = readRepoText("src/sidepanel/tabs/LineupsTab.tsx");
    expect(
      src.includes("buildSetPlayUrl"),
      "[F4] LineupsTab.tsx must route Set Go actions via buildSetPlayUrl",
    ).toBe(true);
  });
});

// ============================================================================
// Feature 5: Multi-Lineup Builder Limits & Slot Expansion (0 SET / 5) (11 tests)
// ============================================================================

describe("Feature 5: Multi-Lineup Builder Limits & Slot Expansion (0 SET / 5)", () => {
  let constants: ConstantsContract;
  let optimizer: OptimizerContract;
  let setMath: SetMathContract;

  beforeAll(async () => {
    const constMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/constants.ts",
    );
    const optMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/lineupOptimizerMath.ts",
    );
    const setMod = await requireContractModule<Record<string, unknown>>(
      "src/calculators/commonSetMath.ts",
    );
    constants = constMod as unknown as ConstantsContract;
    optimizer = optMod as unknown as OptimizerContract;
    setMath = setMod as unknown as SetMathContract;
    requireExport(
      constMod,
      "COMPETITION_ENTRY_LIMITS",
      "src/shared/constants.ts",
    );
    requireExport(
      optMod,
      "generateTopLineups",
      "src/calculators/lineupOptimizerMath.ts",
    );
  });

  // Tier 1
  it("F5-T1-1: COMPETITION_ENTRY_LIMITS defines exact Pro, Arena, Classic, Hot Streak, and Squad limits", () => {
    const limits = constants.COMPETITION_ENTRY_LIMITS;
    expect(limits.proInSeasonMaxEntries).toBe(5);
    expect(limits.arenaCashMaxEntries).toBe(5);
    // Live 2026-11-19: Classic Limited = 3 entries ("0 SET / 3"), docs/SORARE_FACTS.md.
    expect(limits.proClassicMaxEntriesByRarity).toEqual({
      limited: 3,
      rare: 4,
      super_rare: 2,
      unique: 2,
    });
    expect(limits.hotStreakMaxEntries).toBe(3);
    expect(limits.squadBestLineupsCounted).toBe(3);
    expect(limits.arenaPodSize).toBe(10);
  });

  it("F5-T1-2: generateTopLineups builds 5 disjoint Arena Contender 12★ lineups (0 SET / 5) with zero duplicate card slugs", () => {
    const res = optimizer.generateTopLineups(PJAMPJAM_GALLERY_CARDS, {
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
      captainBonusPct: 0,
    });

    expect(res.lineups).toHaveLength(5);
    const seenSlugs = new Set<string>();
    for (const lineup of res.lineups) {
      expect(lineup.slots).toHaveLength(5);
      expect(lineup.capUsed).toBeLessThanOrEqual(12);
      for (const s of lineup.slots) {
        expect(seenSlugs.has(s.evaluated.card.slug)).toBe(false);
        seenSlugs.add(s.evaluated.card.slug);
      }
    }
    expect(seenSlugs.size).toBe(25);
  });

  it("F5-T1-3: generateTopLineups builds 4 disjoint Classic Contender 11★ lineups respecting 11★ cap", () => {
    const res = optimizer.generateTopLineups(PJAMPJAM_GALLERY_CARDS, {
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
      maxLineups: 4,
      captainBonusPct: 0,
    });

    expect(res.lineups).toHaveLength(4);
    const seenSlugs = new Set<string>();
    for (const lineup of res.lineups) {
      expect(lineup.slots).toHaveLength(5);
      expect(lineup.capUsed).toBeLessThanOrEqual(11);
      for (const s of lineup.slots) {
        expect(seenSlugs.has(s.evaluated.card.slug)).toBe(false);
        seenSlugs.add(s.evaluated.card.slug);
      }
    }
  });

  it("F5-T1-4: LineupsTab removes hardcoded maxLineups: 3 cap and supports up to 5 Arena/In-Season slots (0 SET / 5)", async () => {
    const lineupsSrc = readRepoText("src/sidepanel/tabs/LineupsTab.tsx");
    expect(
      /maxLineups:\s*3\b/.test(lineupsSrc),
      "[F5] LineupsTab.tsx must not hardcode maxLineups: 3; expand builder slots up to 5 (Arena/In-Season) and 4 (Classic)",
    ).toBe(false);

    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<LineupsTabComponent>(
      mod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const html = renderUiComponentToHtml(
      React.createElement(
        LineupsTab,
        makeLineupsTabProps({
          initialFormat: "arena_contender_12",
        }),
      ),
    );
    expect(
      /Lineup\s*#?4|Lineup\s*#?5|\/\s*5\b|up to 5/i.test(html),
      "[F5] Rendered LineupsTab must expose expanded 5-lineup / slot capacity for Arena/In-Season",
    ).toBe(true);
  });

  it("F5-T1-5: pure entry-limit resolver enforces rarity & scope caps (2 SR/Unique, 4 Limited/Rare Classic, 5 In-Season/Arena)", async () => {
    const candidateNames = [
      "getCompetitionEntryLimit",
      "getFormatEntryLimit",
      "resolveCompetitionEntryLimit",
      "computeEntrySlotCapacity",
      "getMaxLineupEntries",
    ];
    let resolver: ((...args: unknown[]) => unknown) | null = null;
    for (const name of candidateNames) {
      if (typeof optimizer[name] === "function") {
        resolver = optimizer[name] as (...args: unknown[]) => unknown;
        break;
      }
    }
    expect(
      resolver,
      `[F5] lineupOptimizerMath.ts must export a pure competition entry-limit helper (${candidateNames.join(" / ")}) backed by COMPETITION_ENTRY_LIMITS`,
    ).not.toBeNull();
    if (!resolver) return;

    const invoke = (
      format: string,
      rarity: Rarity,
      seasonScope: "in_season" | "classic" | "arena",
    ): number => {
      const raw = resolver!({ format, rarity, seasonScope });
      if (typeof raw === "number") return raw;
      if (raw && typeof raw === "object") {
        const rec = raw as Record<string, unknown>;
        const n = rec.maxEntries ?? rec.maxLineups ?? rec.limit;
        if (typeof n === "number") return n;
      }
      throw new Error(
        `[F5] Unexpected entry-limit resolver return value: ${JSON.stringify(raw)}`,
      );
    };

    expect(invoke("arena_contender_12", "limited", "arena")).toBe(5);
    expect(invoke("champion_16", "limited", "in_season")).toBe(5);
    expect(invoke("contender_11", "limited", "classic")).toBe(3); // live "0 SET / 3"
    expect(invoke("contender_11", "rare", "classic")).toBe(4);
    expect(invoke("contender_11", "super_rare", "classic")).toBe(2);
    expect(invoke("contender_11", "unique", "classic")).toBe(2);
  });

  // Tier 2
  it("F5-T2-1: pool capacity boundary value analysis (4 -> 0, 5 -> 1, 9 -> 1, 10 -> 2 disjoint lineups)", () => {
    const makeCheapCards = (count: number): GalleryCard[] =>
      Array.from({ length: count }, (_, idx) => ({
        ...PJAMPJAM_GALLERY_CARDS[idx],
        slug: `cap-test-${idx}`,
        playerSlug: `cap-player-${idx}`,
        playerName: `Cap Player ${idx}`,
        starCost: 1.5,
        l10: 15 + idx,
        sorareClassicProjected: 18 + idx,
        inSeasonEligible: true,
      }));

    const runCap = (count: number) =>
      optimizer.generateTopLineups(makeCheapCards(count), {
        format: "uncapped",
        rarityFilter: "limited",
        projectionSource: "blended_smart",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
        excludeOut: true,
        excludeQuestionable: false,
        inSeasonOnly: false,
        minInSeasonCards: 0,
        disjointAcrossLineups: true,
        maxLineups: 5,
        captainBonusPct: 0,
      }).lineups.length;

    expect(runCap(4)).toBe(0);
    expect(runCap(5)).toBe(1);
    expect(runCap(9)).toBe(1);
    expect(runCap(10)).toBe(2);
  });

  it("F5-T2-2: generateTopLineups clamps maxLineups <= 0 to 1 and maxLineups > 10 to 10", () => {
    const bigPool: GalleryCard[] = Array.from({ length: 55 }, (_, idx) => ({
      ...PJAMPJAM_GALLERY_CARDS[idx % PJAMPJAM_GALLERY_CARDS.length],
      slug: `clamp-card-${idx}`,
      playerSlug: `clamp-player-${idx}`,
      playerName: `Clamp Player ${idx}`,
      starCost: 1.5,
      sorareClassicProjected: 20 + (idx % 10),
      l10: 18 + (idx % 10),
      inSeasonEligible: true,
    }));

    const low = optimizer.generateTopLineups(bigPool, {
      format: "uncapped",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: 0,
      captainBonusPct: 0,
    });
    expect(low.lineups).toHaveLength(1);

    const high = optimizer.generateTopLineups(bigPool, {
      format: "uncapped",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: 15,
      captainBonusPct: 0,
    });
    expect(high.lineups).toHaveLength(10);
  });

  it("F5-T2-3: In-Season quota boundary stops at 4 lineups when pool has exactly 16 In-Season cards and minInSeasonCards === 4", () => {
    const inSeason16 = Array.from({ length: 16 }, (_, idx) => ({
      ...PJAMPJAM_GALLERY_CARDS[0],
      slug: `ins-${idx}`,
      playerSlug: `ins-player-${idx}`,
      playerName: `InSeason ${idx}`,
      inSeasonEligible: true,
      starCost: 2.0,
      sorareClassicProjected: 25 + idx * 0.1,
    }));
    const classic9 = Array.from({ length: 9 }, (_, idx) => ({
      ...PJAMPJAM_GALLERY_CARDS[2],
      slug: `cls-${idx}`,
      playerSlug: `cls-player-${idx}`,
      playerName: `Classic ${idx}`,
      inSeasonEligible: false,
      seasonYear: 2025,
      starCost: 1.5,
      sorareClassicProjected: 20 + idx * 0.1,
    }));

    const res = optimizer.generateTopLineups([...inSeason16, ...classic9], {
      format: "arena_contender_12",
      rarityFilter: "limited",
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 4,
      disjointAcrossLineups: true,
      maxLineups: 5,
      captainBonusPct: 0,
    });

    expect(res.lineups).toHaveLength(4);
    for (const l of res.lineups) {
      expect(l.inSeasonCount).toBeGreaterThanOrEqual(4);
    }
  });

  it("F5-T2-4: Arena cash board 0 SET / 5 HTML aligns with arenaCashMaxEntries === 5 and emits zero false submitted lineups", async () => {
    const domParser = await requireContractModule<DomParserContract>(
      "src/content/sorareDomParser.ts",
    );
    const url =
      "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion";
    const html = buildArenaCashBoardHtml();
    expect(html).toContain("0 SET / 5");
    expect(constants.COMPETITION_ENTRY_LIMITS.arenaCashMaxEntries).toBe(5);
    const doc = createMiniDocument(html, url);
    expect(domParser.extractOpenLineupsFromDocument(doc, url)).toEqual([]);
  });

  it("F5-T2-5: buildSetTeams handles both full 40+ card Squad capacity (3 Best / 8 Max) and sparse 6-card pool gracefully", () => {
    const sparse = setMath.buildSetTeams(PJAMPJAM_COMMON_CARDS, {
      mode: "squad",
      teamCount: constants.COMPETITION_ENTRY_LIMITS.squadBestLineupsCounted,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
      gamesPerTeam: PJAMPJAM_GAMES_PER_TEAM,
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    // Live 16-star cap: the 3.5-4 star Commons can't form a legal team (see F4-T1-3).
    expect(sparse.squadTeams).toHaveLength(0);

    const largeCommonPool: GalleryCard[] = Array.from(
      { length: 42 },
      (_, idx) => ({
        ...PJAMPJAM_COMMON_CARDS[idx % 5],
        slug: `sq-pool-${idx}`,
        playerSlug: `sq-player-${idx}`,
        playerName: `Squad Player ${idx}`,
        l10: 15 + (idx % 15),
        sorareClassicProjected: 18 + (idx % 15),
        starCost: 1.5 + (idx % 6) * 0.5,
      }),
    );
    const full = setMath.buildSetTeams(largeCommonPool, {
      mode: "squad",
      teamCount: 8,
      projectionSource: "blended_smart",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(full.squadTeams).toHaveLength(8);
  });

  it("F5-T2-6: excluding all 15 cards from the 3 GW10 Arena lineups reduces remaining disjoint capacity cleanly without reuse", () => {
    const submitted = buildArenaLineupsFixture("dom");
    const lockedSlugs = new Set(submitted.flatMap((l) => l.cardSlugs));
    expect(lockedSlugs.size).toBe(15);

    const res = optimizer.generateTopLineups(PJAMPJAM_GALLERY_CARDS, {
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
      excludedCardSlugs: lockedSlugs,
      excludeSubmittedCards: true,
      maxLineups: 5,
      captainBonusPct: 0,
    });

    expect(res.lineups.length).toBeGreaterThanOrEqual(1);
    expect(res.lineups.length).toBeLessThanOrEqual(5);
    for (const lineup of res.lineups) {
      for (const s of lineup.slots) {
        expect(lockedSlugs.has(s.evaluated.card.slug)).toBe(false);
      }
    }
  });
});

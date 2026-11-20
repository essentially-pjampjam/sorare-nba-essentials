import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import React from "react";
import {
  afterAll,
  describe,
  expect,
  it,
} from "vitest";
import type {
  GalleryCard,
  ProjectionSource,
  Rarity,
  So5FixtureSummary,
} from "../../src/shared/types";
import {
  ALERT_AFTER_DAILY_RESET_MS,
  ALERT_BASE_NOW_MS,
  ALERT_CONFIG_ALL_ON,
  ALERT_CONFIG_MASTER_OFF,
  ALERT_CONFIG_NOTIFS_OFF,
  ALERT_CONFIG_PRICE_SURGE_OFF,
  ALERT_CONFIG_THRESHOLD_40,
  ALERT_COOLDOWN_EXPIRED_MS,
  ALERT_COOLDOWN_WITHIN_MS,
  ALERT_DAILY_RESET_WINDOW_MS,
  ALERT_OUTSIDE_CUTOFF_MS,
  ALERT_UNPRICED_VARIANT_OVERRIDES,
  buildAlertEvaluationScenario,
  buildAlertTrackerUserSettings,
  type TrackedAlertEventFixture,
} from "./fixtures/alertTrackerFixture.ts";
import { buildArenaLineupsFixture } from "./fixtures/arenaLineupsFixture.ts";
import {
  PJAMPJAM_INJURIES_BY_NAME,
  SORARE_FIXTURES_GW8_TO_GW10,
} from "./fixtures/espnAndLeaderboardFixtures.ts";
import {
  PJAMPJAM_COMMON_CARDS,
  PJAMPJAM_GALLERY_CARDS,
  buildPjampjamGalleryResult,
} from "./fixtures/gallery42Fixture.ts";
import {
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
  resolveRepoPath,
} from "./helpers/contractLoader.ts";
import {
  extractButtonsAndControls,
  renderUiComponentToHtml,
} from "./helpers/uiRenderHarness.ts";

// --- Local Structural Contract Interfaces (no static runtime src/ imports) ---

interface CountdownSnapshotShape {
  gwCutoffIso: string | null;
  gwRemainingMs: number | null;
  dailyResetIso: string;
  dailyRemainingMs: number;
}

type CountdownFn = (
  fixtures: So5FixtureSummary[],
  nowMs?: number,
) => CountdownSnapshotShape;

type FormatCountdownFn = (ms: number) => string;

type EvaluateAlertsFn = (
  inputs: unknown,
  baselines: unknown,
  config: unknown,
  nowMs: number,
) => TrackedAlertEventFixture[] | { events: TrackedAlertEventFixture[] };

type UiComponent = React.ComponentType<Record<string, unknown>>;

// --- Candidate Module Probing Helpers (opaque-box across M2 file choices) ---

async function probeFirstFunction<T>(
  modulePaths: readonly string[],
  exportNames: readonly string[],
  requirementLabel: string,
): Promise<{ fn: T; modulePath: string; exportName: string }> {
  const diagnostics: string[] = [];
  for (const modPath of modulePaths) {
    const res = await loadContractModule<Record<string, unknown>>(modPath);
    if (!res.available || !res.mod) {
      if (res.error) diagnostics.push(res.error);
      continue;
    }
    for (const exportName of exportNames) {
      const candidate = res.mod[exportName];
      if (typeof candidate === "function") {
        return { fn: candidate as T, modulePath: modPath, exportName };
      }
    }
    diagnostics.push(`${modPath} loaded without [${exportNames.join(", ")}]`);
  }
  throw new Error(
    `${requirementLabel} contract unavailable: ${diagnostics.join("; ")}`,
  );
}

function invokeCountdown(
  fn: CountdownFn,
  fixtures: So5FixtureSummary[],
  nowMs: number,
): CountdownSnapshotShape {
  const direct = fn(fixtures, nowMs);
  if (
    direct &&
    typeof direct === "object" &&
    "dailyResetIso" in direct &&
    "dailyRemainingMs" in direct
  ) {
    return direct;
  }
  const swapped = (fn as unknown as (n: number, f: So5FixtureSummary[]) => CountdownSnapshotShape)(
    nowMs,
    fixtures,
  );
  return swapped;
}

function extractAlertEvents(
  raw: TrackedAlertEventFixture[] | { events: TrackedAlertEventFixture[] },
): TrackedAlertEventFixture[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.events)) {
    return raw.events;
  }
  throw new Error(
    `[F16] Unexpected evaluateAlertEvents return shape: ${JSON.stringify(raw)}`,
  );
}

function walkRepoFiles(relDir: string): string[] {
  const absDir = resolveRepoPath(relDir);
  const results: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  };
  visit(absDir);
  return results;
}

function makeLineupsProps(
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

function makeGalleryProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    gallery: buildPjampjamGalleryResult({
      cards: PJAMPJAM_GALLERY_CARDS.map((c) => ({ ...c })),
    }),
    rarity: "limited" as Rarity,
    currency: "EUR",
    hasUsername: true,
    isLoading: false,
    isPricingGallery: false,
    onRefreshGallery: () => {},
    onPriceGallery: () => {},
    ...overrides,
  };
}

function makeBargainsProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    bargains: null,
    collectionNeedSlugs: new Set<string>(),
    rarity: "limited" as Rarity,
    currency: "EUR",
    isLoading: false,
    watchlist: [],
    watchlistAlerts: [],
    onScanBargains: () => {},
    onUpdateWatchlist: () => {},
    onRunWatchlistCheck: () => {},
    onClearWatchlistAlerts: () => {},
    ...overrides,
  };
}

function makeCollectionsProps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    analyses: [],
    summary: {
      totalEssenceEarnable: 0,
      cheapestNextMilestone: null,
      bestEfficiencyPick: null,
      craftReadyMatches: [],
      remainingEssenceGap: 0,
    },
    cardCounts: { limited: 42, rare: 0, superRare: 0, unique: 0, total: 42 },
    questCards: [],
    bargains: null,
    allScannedBargains: [],
    galleryCards: PJAMPJAM_GALLERY_CARDS.map((c) => ({ ...c })),
    activeEssence: 450,
    craftThreshold: 1000,
    injuriesByName: PJAMPJAM_INJURIES_BY_NAME,
    pricedSlugs: [],
    pricingSlug: null,
    onPriceCollection: () => {},
    onPriceTopCollections: () => {},
    onScanNow: () => {},
    currency: "EUR",
    rarity: "limited" as Rarity,
    craftReadyOnly: false,
    onToggleCraftReadyOnly: () => {},
    inSeasonOnly: false,
    onToggleInSeasonOnly: () => {},
    searchQuery: "",
    onSearchQueryChange: () => {},
    hasScanned: true,
    hasUsername: true,
    isLoading: false,
    ...overrides,
  };
}

// --- Shared Background Mock Lifecycle ---

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

function resetBackgroundState(mock: ChromeMockHandle): void {
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
// Feature 12: Live Daily Reset (07:00 UTC) & GW Cutoff Countdown Timers + Reminders (11 tests)
// ============================================================================

const COUNTDOWN_MODULES = [
  "src/calculators/countdownMath.ts",
  "src/calculators/timerMath.ts",
  "src/calculators/lineupOptimizerMath.ts",
  "src/shared/timers.ts",
];
const COUNTDOWN_EXPORTS = [
  "computeCountdownSnapshot",
  "buildCountdownSnapshot",
  "getCountdownSnapshot",
  "computeTimersSnapshot",
  "calculateCountdownSnapshot",
];
const FORMAT_COUNTDOWN_MODULES = [
  ...COUNTDOWN_MODULES,
  "src/sidepanel/utils/format.ts",
];
const FORMAT_COUNTDOWN_EXPORTS = [
  "formatCountdown",
  "formatCountdownDuration",
  "formatDurationMs",
  "formatRemainingMs",
  "formatTimeLeftMs",
];

describe("Feature 12: Live Daily Reset (07:00 UTC) & GW Cutoff Countdown Timers + Reminders", () => {
  // Tier 1
  it("F12-T1-1: Daily Reset (07:00 UTC) computes exact remaining ms before and after reset boundary", async () => {
    const { fn } = await probeFirstFunction<CountdownFn>(
      COUNTDOWN_MODULES,
      COUNTDOWN_EXPORTS,
      "[F12] CountdownSnapshot",
    );

    const before = invokeCountdown(
      fn,
      SORARE_FIXTURES_GW8_TO_GW10,
      ALERT_DAILY_RESET_WINDOW_MS,
    );
    expect(before.dailyResetIso).toBe("2026-11-21T07:00:00.000Z");
    expect(before.dailyRemainingMs).toBe(20 * 60_000);

    const after = invokeCountdown(
      fn,
      SORARE_FIXTURES_GW8_TO_GW10,
      ALERT_AFTER_DAILY_RESET_MS,
    );
    expect(after.dailyResetIso).toBe("2026-11-22T07:00:00.000Z");
    expect(after.dailyRemainingMs).toBe((23 * 60 + 55) * 60_000);
  });

  it("F12-T1-2: GW Cutoff selects opened GW10 fixture and computes exact remaining ms", async () => {
    const { fn } = await probeFirstFunction<CountdownFn>(
      COUNTDOWN_MODULES,
      COUNTDOWN_EXPORTS,
      "[F12] CountdownSnapshot",
    );

    const snap = invokeCountdown(
      fn,
      SORARE_FIXTURES_GW8_TO_GW10,
      ALERT_BASE_NOW_MS,
    );
    expect(snap.gwCutoffIso).toBeTruthy();
    expect(Date.parse(snap.gwCutoffIso as string)).toBe(
      Date.parse("2026-11-21T00:00:00Z"),
    );
    expect(snap.gwRemainingMs).toBe(25 * 60_000);
  });

  it("F12-T1-3: pure countdown duration formatter formats multi-day, minutes, seconds, and zero ms cleanly", async () => {
    const { fn } = await probeFirstFunction<FormatCountdownFn>(
      FORMAT_COUNTDOWN_MODULES,
      FORMAT_COUNTDOWN_EXPORTS,
      "[F12] Countdown formatter",
    );

    const samples = [
      (2 * 86_400 + 4 * 3_600) * 1000,
      (25 * 60 + 10) * 1000,
      45_000,
      0,
    ];
    for (const ms of samples) {
      const out = fn(ms);
      expect(typeof out).toBe("string");
      expect(out.trim().length).toBeGreaterThan(0);
      expect(out).not.toContain("NaN");
      expect(out.startsWith("-")).toBe(false);
    }
    expect(fn((2 * 86_400 + 4 * 3_600) * 1000)).toMatch(/2d/i);
    expect(fn((25 * 60 + 10) * 1000)).toMatch(/25m/i);
  });

  it("F12-T1-4: SAVE_SETTINGS with cutoffReminderEnabled: true persists setting and schedules reminder/tracker alarm", async () => {
    const mock = await ensureBackgroundLoaded();
    resetBackgroundState(mock);

    const resp = (await mock.triggerRuntimeMessage({
      type: "SAVE_SETTINGS",
      settings: {
        cutoffReminderEnabled: true,
        cutoffReminderMinutesBefore: 30,
      },
    })) as { ok: boolean; data?: Record<string, unknown> };

    expect(resp.ok).toBe(true);
    expect(
      resp.data?.cutoffReminderEnabled,
      "[F12] UserSettings must persist cutoffReminderEnabled: true",
    ).toBe(true);
    expect(
      resp.data?.cutoffReminderMinutesBefore,
      "[F12] UserSettings must persist cutoffReminderMinutesBefore: 30",
    ).toBe(30);
    expect(
      mock.alarms.size,
      "[F12] Background must maintain scheduled alarm(s) when cutoffReminderEnabled is true",
    ).toBeGreaterThanOrEqual(1);
    const hasCutoffOrTrackerAlarm = Array.from(mock.alarms.keys()).some(
      (name) =>
        /cutoff|timer|reminder|alert|watchlist/i.test(name),
    );
    expect(hasCutoffOrTrackerAlarm).toBe(true);
  });

  it("F12-T1-5: toggling cutoffReminderEnabled: false persists disabled state and suppresses cutoff notifications", async () => {
    const mock = await ensureBackgroundLoaded();
    resetBackgroundState(mock);

    await mock.triggerRuntimeMessage({
      type: "SAVE_SETTINGS",
      settings: {
        cutoffReminderEnabled: true,
        cutoffReminderMinutesBefore: 30,
      },
    });

    const offResp = (await mock.triggerRuntimeMessage({
      type: "SAVE_SETTINGS",
      settings: {
        cutoffReminderEnabled: false,
      },
    })) as { ok: boolean; data?: Record<string, unknown> };

    expect(offResp.ok).toBe(true);
    expect(
      offResp.data?.cutoffReminderEnabled,
      "[F12] SAVE_SETTINGS must persist cutoffReminderEnabled: false",
    ).toBe(false);

    for (const alarmName of Array.from(mock.alarms.keys())) {
      await mock.triggerAlarm(alarmName);
    }
    expect(mock.notifications.size).toBe(0);
  });

  it("F12-T1-6: LineupsTab SSR renders both GW Cutoff and Daily Reset (07:00 UTC) timers plus reminder toggle", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<UiComponent>(
      mod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const html = renderUiComponentToHtml(
      React.createElement(LineupsTab, makeLineupsProps()),
    );
    expect(
      /Daily Reset|07:00\s*UTC/i.test(html),
      "[F12] LineupsTab UI must render Daily Reset (07:00 UTC) countdown timer",
    ).toBe(true);
    expect(
      /GW|Game Week|Cutoff/i.test(html),
      "[F12] LineupsTab UI must render GW Cutoff countdown timer",
    ).toBe(true);
    expect(
      /reminder|notify|alert/i.test(html),
      "[F12] LineupsTab UI must surface an optional local reminder toggle",
    ).toBe(true);
  });

  // Tier 2
  it("F12-T2-1: 06:59:59Z vs 07:00:00Z exact UTC rollover never returns negative or zero-stale reset window", async () => {
    const { fn } = await probeFirstFunction<CountdownFn>(
      COUNTDOWN_MODULES,
      COUNTDOWN_EXPORTS,
      "[F12] CountdownSnapshot",
    );

    const oneSecBefore = invokeCountdown(
      fn,
      SORARE_FIXTURES_GW8_TO_GW10,
      Date.parse("2026-11-21T06:59:59Z"),
    );
    expect(oneSecBefore.dailyResetIso).toBe("2026-11-21T07:00:00.000Z");
    expect(oneSecBefore.dailyRemainingMs).toBe(1_000);

    const exactReset = invokeCountdown(
      fn,
      SORARE_FIXTURES_GW8_TO_GW10,
      Date.parse("2026-11-21T07:00:00Z"),
    );
    expect(exactReset.dailyResetIso).toBe("2026-11-22T07:00:00.000Z");
    expect(exactReset.dailyRemainingMs).toBe(86_400_000);
  });

  it("F12-T2-2: month-end and year-end UTC rollovers resolve next day 07:00 UTC cleanly", async () => {
    const { fn } = await probeFirstFunction<CountdownFn>(
      COUNTDOWN_MODULES,
      COUNTDOWN_EXPORTS,
      "[F12] CountdownSnapshot",
    );

    const novEnd = invokeCountdown(
      fn,
      [],
      Date.parse("2026-11-30T23:30:00Z"),
    );
    expect(novEnd.dailyResetIso).toBe("2026-12-01T07:00:00.000Z");
    expect(novEnd.dailyRemainingMs).toBe(7.5 * 3_600_000);

    const decEnd = invokeCountdown(
      fn,
      [],
      Date.parse("2026-12-31T23:30:00Z"),
    );
    expect(decEnd.dailyResetIso).toBe("2027-01-01T07:00:00.000Z");
    expect(decEnd.dailyRemainingMs).toBe(7.5 * 3_600_000);
  });

  it("F12-T2-3: empty or closed-only fixtures return null/0 GW fields while Daily Reset remains valid", async () => {
    const { fn } = await probeFirstFunction<CountdownFn>(
      COUNTDOWN_MODULES,
      COUNTDOWN_EXPORTS,
      "[F12] CountdownSnapshot",
    );

    const closedOnly: So5FixtureSummary[] = [SORARE_FIXTURES_GW8_TO_GW10[2]];
    for (const fixtureList of [[], closedOnly]) {
      const snap = invokeCountdown(fn, fixtureList, ALERT_BASE_NOW_MS);
      expect(snap.gwCutoffIso).toBeNull();
      expect(snap.gwRemainingMs === null || snap.gwRemainingMs === 0).toBe(
        true,
      );
      expect(snap.dailyResetIso).toBe("2026-11-21T07:00:00.000Z");
      expect(snap.dailyRemainingMs).toBeGreaterThan(0);
    }
  });

  it("F12-T2-4: invalid cutOffDate string produces safe null fallback without NaN or exceptions", async () => {
    const { fn } = await probeFirstFunction<CountdownFn>(
      COUNTDOWN_MODULES,
      COUNTDOWN_EXPORTS,
      "[F12] CountdownSnapshot",
    );
    const malformedFixtures: So5FixtureSummary[] = [
      {
        slug: "nba-bad-date",
        displayName: "Bad Date GW",
        cutOffDate: "not-a-valid-iso-date",
        endDate: "2026-11-23T04:00:00Z",
        aasmState: "opened",
      },
    ];
    const snap = invokeCountdown(fn, malformedFixtures, ALERT_BASE_NOW_MS);
    expect(snap.gwCutoffIso).toBeNull();
    expect(snap.gwRemainingMs === null || snap.gwRemainingMs === 0).toBe(true);
    expect(Number.isNaN(snap.dailyRemainingMs)).toBe(false);
  });

  it("F12-T2-5: triggering all registered alarms with cutoffReminderEnabled: false throws zero errors and creates zero notifications", async () => {
    const mock = await ensureBackgroundLoaded();
    resetBackgroundState(mock);
    await mock.triggerRuntimeMessage({
      type: "SAVE_SETTINGS",
      settings: {
        alertsEnabled: false,
        cutoffReminderEnabled: false,
      },
    });
    for (const name of Array.from(mock.alarms.keys())) {
      await expect(mock.triggerAlarm(name)).resolves.toBeUndefined();
    }
    expect(mock.notifications.size).toBe(0);
  });
});

// ============================================================================
// Feature 13: Side Panel & Dashboard UI / Green-to-Blue Outlined Button Polish (11 tests)
// ============================================================================

describe("Feature 13: Side Panel & Dashboard UI / Green-to-Blue Outlined Button Polish", () => {
  // Tier 1
  it("F13-T1-1: App switches cleanly between Side Panel mode and ?view=dashboard mode", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );
    const App = requireExport<UiComponent>(mod, "App", "src/sidepanel/App.tsx");

    const sidePanelHtml = renderUiComponentToHtml(React.createElement(App), {
      search: "",
    });
    expect(sidePanelHtml.includes("jam-dashboard-mode")).toBe(false);
    const spControls = extractButtonsAndControls(sidePanelHtml);
    expect(
      spControls.some((c) => c.ariaLabel === "Open full website dashboard"),
    ).toBe(true);

    const dashboardHtml = renderUiComponentToHtml(React.createElement(App), {
      search: "?view=dashboard",
    });
    expect(dashboardHtml.includes("jam-dashboard-mode")).toBe(true);
    const dashControls = extractButtonsAndControls(dashboardHtml);
    expect(
      dashControls.some((c) => c.ariaLabel === "Open full website dashboard"),
    ).toBe(false);
  });

  it("F13-T1-2: App header renders full Sorare NBA Essentials brand without Sorar... truncation", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );
    const App = requireExport<UiComponent>(mod, "App", "src/sidepanel/App.tsx");
    const html = renderUiComponentToHtml(React.createElement(App), {
      search: "",
    });

    expect(html).toContain("Sorare NBA Essentials");
    expect(html).not.toContain("Sorar...");
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    expect(h1Match?.[1]).toContain("Sorare NBA Essentials");
    // Ensure brand block is not cramped by unwrapping single-row truncation in narrow Side Panel
    const headerRowAllowsWrap =
      /flex-wrap/.test(html) ||
      !/<h1[^>]*truncate[^>]*>Sorare NBA Essentials<\/h1>/i.test(html);
    expect(
      headerRowAllowsWrap,
      "[F13] App header must avoid single-row Sorar... truncation of Sorare NBA Essentials in narrow Side Panel",
    ).toBe(true);
  });

  it("F13-T1-3: primary CTA buttons across App, LineupsTab, GalleryTab, and SettingsModal use green-to-blue gradients with crisp borders/outlines", async () => {
    const appMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );
    const lineupsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const galleryMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const settingsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/components/SettingsModal.tsx",
    );

    const App = requireExport<UiComponent>(
      appMod,
      "App",
      "src/sidepanel/App.tsx",
    );
    const LineupsTab = requireExport<UiComponent>(
      lineupsMod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const GalleryTab = requireExport<UiComponent>(
      galleryMod,
      "GalleryTab",
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const SettingsModal = requireExport<UiComponent>(
      settingsMod,
      "SettingsModal",
      "src/sidepanel/components/SettingsModal.tsx",
    );

    const hasGreenToBlueWithBorder = (cls: string): boolean => {
      const hasGreenBlue =
        (/from-emerald-/.test(cls) && /to-(?:sky|blue)-/.test(cls)) ||
        (/from-(?:sky|blue)-/.test(cls) && /to-emerald-/.test(cls));
      const hasBorderOrOutline = /\bborder(?:-[\w/[\]]+)?\b|\bring(?:-[\w/[\]]+)?\b/.test(
        cls,
      );
      return hasGreenBlue && hasBorderOrOutline;
    };

    const appControls = extractButtonsAndControls(
      renderUiComponentToHtml(React.createElement(App), { search: "" }),
    );
    const refreshBtn = appControls.find((c) => /Refresh/i.test(c.text));
    expect(
      refreshBtn && hasGreenToBlueWithBorder(refreshBtn.className),
      `[F13] App Refresh CTA must use green-to-blue gradient + crisp border/outline (got "${refreshBtn?.className ?? ""}")`,
    ).toBe(true);

    const lineupsControls = extractButtonsAndControls(
      renderUiComponentToHtml(
        React.createElement(LineupsTab, makeLineupsProps()),
      ),
    );
    const scanBtn = lineupsControls.find((c) =>
      /Scan Market Buys/i.test(c.text),
    );
    expect(
      scanBtn && hasGreenToBlueWithBorder(scanBtn.className),
      `[F13] LineupsTab Scan Market Buys CTA must use green-to-blue gradient + crisp border/outline (got "${scanBtn?.className ?? ""}")`,
    ).toBe(true);

    const galleryControls = extractButtonsAndControls(
      renderUiComponentToHtml(
        React.createElement(GalleryTab, makeGalleryProps()),
      ),
    );
    const priceBtn = galleryControls.find((c) =>
      /Price|Refresh/i.test(c.text),
    );
    expect(
      priceBtn && hasGreenToBlueWithBorder(priceBtn.className),
      `[F13] GalleryTab primary CTA must use green-to-blue gradient + crisp border/outline (got "${priceBtn?.className ?? ""}")`,
    ).toBe(true);

    const settingsControls = extractButtonsAndControls(
      renderUiComponentToHtml(
        React.createElement(SettingsModal, {
          version: "2.7.0",
          settings: buildAlertTrackerUserSettings(),
          onUpdateSettings: () => {},
          onOpenTierEditor: () => {},
          onClearCache: () => {},
          onReloadExtension: () => {},
          onClose: () => {},
        }),
      ),
    );
    const saveBtn = settingsControls.find((c) => /Save/i.test(c.text));
    expect(
      saveBtn && hasGreenToBlueWithBorder(saveBtn.className),
      `[F13] SettingsModal Save CTA must use green-to-blue gradient + crisp border/outline (got "${saveBtn?.className ?? ""}")`,
    ).toBe(true);
  });

  it("F13-T1-4: GalleryTab renders all 42 cards with container-query classes and crisp control buttons", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const GalleryTab = requireExport<UiComponent>(
      mod,
      "GalleryTab",
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const html = renderUiComponentToHtml(
      React.createElement(GalleryTab, makeGalleryProps()),
    );
    expect(html).toContain("jam-card-container");
    expect(html).toContain("jam-card-inner");
    for (const card of PJAMPJAM_GALLERY_CARDS) {
      expect(html).toContain(card.playerName);
    }
  });

  it("F13-T1-5: index.css defines responsive dashboard, glass-chrome, container query, and compact density rules", () => {
    const css = readRepoText("src/sidepanel/index.css");
    expect(css).toContain(".jam-dashboard-mode");
    expect(css).toContain(".glass-chrome");
    expect(css).toContain(".jam-card-container");
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain(".jam-card-inner");
    expect(css).toContain('[data-density="compact"]');
  });

  it("F13-T1-6: LineupsTab renders mode switchers, format buttons, Auto-Build, and Scan Market Buys cleanly", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const LineupsTab = requireExport<UiComponent>(
      mod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const html = renderUiComponentToHtml(
      React.createElement(LineupsTab, makeLineupsProps()),
    );
    const controls = extractButtonsAndControls(html);
    const labels = controls.map((c) => c.text);
    expect(labels.some((l) => /Champion/i.test(l))).toBe(true);
    expect(labels.some((l) => /Contender/i.test(l))).toBe(true);
    expect(labels.some((l) => /Auto-Build/i.test(l))).toBe(true);
    expect(labels.some((l) => /Scan Market Buys/i.test(l))).toBe(true);
  });

  // Tier 2
  it("F13-T2-1: accessibility check — every button/link across App and tabs has non-empty text or ariaLabel", async () => {
    const appMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );
    const lineupsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const galleryMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const bargainsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/BargainsTab.tsx",
    );
    const collectionsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/CollectionsTab.tsx",
    );
    const settingsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/components/SettingsModal.tsx",
    );

    const renderedPages = [
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(appMod, "App", "src/sidepanel/App.tsx"),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            lineupsMod,
            "LineupsTab",
            "src/sidepanel/tabs/LineupsTab.tsx",
          ),
          makeLineupsProps(),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            galleryMod,
            "GalleryTab",
            "src/sidepanel/tabs/GalleryTab.tsx",
          ),
          makeGalleryProps(),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            bargainsMod,
            "BargainsTab",
            "src/sidepanel/tabs/BargainsTab.tsx",
          ),
          makeBargainsProps(),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            collectionsMod,
            "CollectionsTab",
            "src/sidepanel/tabs/CollectionsTab.tsx",
          ),
          makeCollectionsProps(),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            settingsMod,
            "SettingsModal",
            "src/sidepanel/components/SettingsModal.tsx",
          ),
          {
            version: "2.7.0",
            settings: buildAlertTrackerUserSettings(),
            onUpdateSettings: () => {},
            onOpenTierEditor: () => {},
            onClearCache: () => {},
            onReloadExtension: () => {},
            onClose: () => {},
          },
        ),
      ),
    ];

    for (const html of renderedPages) {
      const controls = extractButtonsAndControls(html);
      expect(controls.length).toBeGreaterThan(0);
      for (const ctrl of controls) {
        const hasLabel =
          ctrl.text.trim().length > 0 ||
          (ctrl.ariaLabel !== undefined && ctrl.ariaLabel.trim().length > 0);
        expect(
          hasLabel,
          `[F13] Unlabeled control found: <${ctrl.tag} class="${ctrl.className}">`,
        ).toBe(true);
      }
    }
  });

  it("F13-T2-2: empty-state UI rendering for LineupsTab, GalleryTab, and BargainsTab renders valid CTAs without crashing", async () => {
    const lineupsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const galleryMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const bargainsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/BargainsTab.tsx",
    );

    const LineupsTab = requireExport<UiComponent>(
      lineupsMod,
      "LineupsTab",
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const GalleryTab = requireExport<UiComponent>(
      galleryMod,
      "GalleryTab",
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const BargainsTab = requireExport<UiComponent>(
      bargainsMod,
      "BargainsTab",
      "src/sidepanel/tabs/BargainsTab.tsx",
    );

    const noUserLineupsHtml = renderUiComponentToHtml(
      React.createElement(
        LineupsTab,
        makeLineupsProps({ gallery: null, hasUsername: false }),
      ),
    );
    const noUserBtns = extractButtonsAndControls(noUserLineupsHtml);
    expect(noUserBtns.some((b) => b.disabled)).toBe(true);

    const emptyGalleryHtml = renderUiComponentToHtml(
      React.createElement(
        GalleryTab,
        makeGalleryProps({ gallery: null, hasUsername: true }),
      ),
    );
    expect(emptyGalleryHtml.length).toBeGreaterThan(100);

    const emptyBargainsHtml = renderUiComponentToHtml(
      React.createElement(BargainsTab, makeBargainsProps({ bargains: null })),
    );
    expect(emptyBargainsHtml.length).toBeGreaterThan(100);
  });

  it("F13-T2-3: zero gradient primary CTAs lack crisp border/outline classes across App and tabs", async () => {
    const appMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );
    const lineupsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/LineupsTab.tsx",
    );
    const galleryMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const bargainsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/BargainsTab.tsx",
    );

    const pages = [
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(appMod, "App", "src/sidepanel/App.tsx"),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            lineupsMod,
            "LineupsTab",
            "src/sidepanel/tabs/LineupsTab.tsx",
          ),
          makeLineupsProps(),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            galleryMod,
            "GalleryTab",
            "src/sidepanel/tabs/GalleryTab.tsx",
          ),
          makeGalleryProps(),
        ),
      ),
      renderUiComponentToHtml(
        React.createElement(
          requireExport<UiComponent>(
            bargainsMod,
            "BargainsTab",
            "src/sidepanel/tabs/BargainsTab.tsx",
          ),
          makeBargainsProps(),
        ),
      ),
    ];

    const allControls = pages.flatMap((h) => extractButtonsAndControls(h));
    const gradientButtons = allControls.filter((c) =>
      /\bbg-gradient-to-/.test(c.className),
    );
    expect(gradientButtons.length).toBeGreaterThan(0);

    for (const btn of gradientButtons) {
      expect(
        /\bfrom-emerald-|\bfrom-sky-|\bfrom-blue-/.test(btn.className),
        `[F13] Gradient CTA "${btn.text}" should use green-to-blue palette instead of "${btn.className}"`,
      ).toBe(true);
      expect(
        /\bborder(?:-[\w/[\]]+)?\b|\bring(?:-[\w/[\]]+)?\b/.test(
          btn.className,
        ),
        `[F13] Gradient CTA "${btn.text}" must include crisp border/outline class`,
      ).toBe(true);
    }
  });

  it("F13-T2-4: Dashboard mode exposes 5 accessible tabs and responsive multi-column grids", async () => {
    const appMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );
    const galleryMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const App = requireExport<UiComponent>(
      appMod,
      "App",
      "src/sidepanel/App.tsx",
    );
    const GalleryTab = requireExport<UiComponent>(
      galleryMod,
      "GalleryTab",
      "src/sidepanel/tabs/GalleryTab.tsx",
    );

    const appDashHtml = renderUiComponentToHtml(React.createElement(App), {
      search: "?view=dashboard",
    });
    const tabMatches = appDashHtml.match(/role="tab"/g) ?? [];
    expect(tabMatches).toHaveLength(5);
    expect(appDashHtml).toContain("aria-controls=");
    expect(appDashHtml).toContain("aria-selected=");

    const galleryHtml = renderUiComponentToHtml(
      React.createElement(GalleryTab, makeGalleryProps()),
    );
    expect(
      /lg:grid-cols-|xl:grid-cols-|md:grid-cols-/.test(galleryHtml),
    ).toBe(true);
  });

  it("F13-T2-5: GalleryTab handles ultra-long player names, null pictureUrl, and null lowestAskCents without crashing", async () => {
    const mod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const GalleryTab = requireExport<UiComponent>(
      mod,
      "GalleryTab",
      "src/sidepanel/tabs/GalleryTab.tsx",
    );
    const longCard: GalleryCard = {
      ...PJAMPJAM_GALLERY_CARDS[0],
      slug: "ultra-long-player-2026-limited-1",
      playerSlug: "ultra-long-player-name",
      playerName: "Giannis Antetokounmpo-Alexander-Walker III",
      pictureUrl: null,
      lowestAskCents: null,
    };
    const html = renderUiComponentToHtml(
      React.createElement(
        GalleryTab,
        makeGalleryProps({
          gallery: buildPjampjamGalleryResult({ cards: [longCard] }),
        }),
      ),
    );
    expect(html).toContain("Giannis Antetokounmpo-Alexander-Walker III");
    expect(html).toContain("truncate");
    expect(html).toContain("min-w-0");
  });
});

// ============================================================================
// Feature 14: .0SR-Inspired Workflow Tooling, Invariant Checks & v2.7.0 Bump (12 tests)
// ============================================================================

describe("Feature 14: .0SR-Inspired Workflow Tooling, Invariant Checks & v2.7.0 Bump", () => {
  // Tier 1
  it("F14-T1-1: required .0SR-inspired workflow artifacts exist and .mjs scripts pass node --check", () => {
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
    for (const rel of requiredFiles) {
      expect(
        repoFileExists(rel),
        `[F14] Missing required .0SR workflow artifact: ${rel}`,
      ).toBe(true);
    }

    for (const script of ["scripts/verify.mjs", "scripts/ship-helper.mjs"]) {
      const res = spawnSync("node", ["--check", resolveRepoPath(script)], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(
        res.status,
        `[F14] node --check failed for ${script}: ${res.stderr}`,
      ).toBe(0);
    }
  });

  it("F14-T1-2: v2.7.0 version parity across package.json, manifest.json, PROJECT_STATE.md, CHANGELOG.md, ROADMAP.md, and WhatsNewModal.tsx", () => {
    const pkg = JSON.parse(readRepoText("package.json")) as {
      version?: string;
    };
    const manifest = JSON.parse(readRepoText("public/manifest.json")) as {
      version?: string;
    };
    expect(
      pkg.version,
      `[F14] package.json version must be a 2.7.x release (got ${pkg.version})`,
    ).toMatch(/^2\.7\.\d+$/);
    expect(
      manifest.version,
      `[F14] public/manifest.json version must match package.json (got ${manifest.version})`,
    ).toBe(pkg.version);

    const projectState = readRepoText("PROJECT_STATE.md");
    expect(
      /Status:[^\n]*2\.7\.\d/i.test(projectState),
      "[F14] PROJECT_STATE.md status header must reference v2.7.0",
    ).toBe(true);

    const changelog = readRepoText("CHANGELOG.md");
    expect(
      /2\.7\.0/.test(changelog),
      "[F14] CHANGELOG.md must include a 2.7.0 release entry",
    ).toBe(true);

    const roadmap = readRepoText("ROADMAP.md");
    expect(
      /2\.7\.0/.test(roadmap),
      "[F14] ROADMAP.md must include v2.7.0",
    ).toBe(true);

    const whatsNew = readRepoText("src/sidepanel/components/WhatsNewModal.tsx");
    expect(
      /version:\s*"2\.7\.0"/.test(whatsNew),
      '[F14] WhatsNewModal.tsx RELEASE_HIGHLIGHTS must include version: "2.7.0"',
    ).toBe(true);
  });

  it("F14-T1-3: .agents/skills/ship-update/SKILL.md defines .0SR-aligned release workflow", () => {
    const skill = readRepoText(".agents/skills/ship-update/SKILL.md");
    expect(skill).toMatch(/^---[\s\S]*name:\s*ship-update[\s\S]*---/);
    expect(skill).toMatch(/description:/);
    expect(skill).toMatch(/verify\.mjs|npm run check/);
    expect(skill).toMatch(/ship-helper\.mjs/);
    expect(skill).toMatch(/package\.json/);
    expect(skill).toMatch(/manifest\.json/);
    expect(skill).toMatch(/PROJECT_STATE\.md/);
    expect(skill).toMatch(/CHANGELOG\.md/);
    expect(skill).toMatch(/INPUT_NEEDED\.md/);
    expect(skill).toMatch(/TESTING\.md/);
    expect(skill).toMatch(/next|manual/i);
  });

  it("F14-T1-4: INPUT_NEEDED.md, TESTING.md, and CHANGELOG.md follow .0SR structured sections", () => {
    const inputNeeded = readRepoText("INPUT_NEEDED.md");
    expect(inputNeeded).toMatch(/##\s*Decisions/i);
    expect(inputNeeded).toMatch(/##\s*FYI/i);
    expect(inputNeeded).toMatch(/##\s*Answered/i);

    const testingMd = readRepoText("TESTING.md");
    expect(testingMd).toMatch(/\bT\d+\b|\bTC[-_]?\d+\b/);
    expect(testingMd).toMatch(/##\s*Done/i);

    const changelog = readRepoText("CHANGELOG.md");
    expect(changelog).toMatch(/Added:|Changed:|Fixed:/i);
  });

  it("F14-T1-5: verify.mjs & ship-helper.mjs implement required invariant checks and non-destructive inspection", () => {
    const verifySrc = readRepoText("scripts/verify.mjs");
    expect(verifySrc).toContain("package.json");
    expect(verifySrc).toContain("manifest.json");
    expect(verifySrc).toContain("PROJECT_STATE.md");
    expect(verifySrc).toMatch(/api\.sorare\.com/);
    expect(verifySrc).toMatch(/calculators/);
    expect(verifySrc).toMatch(/typecheck|tsc|vitest|build/i);

    const shipSrc = readRepoText("scripts/ship-helper.mjs");
    expect(shipSrc).toMatch(/\bnext\b|status|--dry-run|--help/);
    expect(shipSrc).toContain("CHANGELOG.md");
    expect(shipSrc).toContain("TESTING.md");
    expect(shipSrc).toContain("INPUT_NEEDED.md");
    expect(shipSrc).toContain("PROJECT_STATE.md");
  });

  it("F14-T1-6: AGENTS.md architecture invariants hold across live src/ (network, calculator purity, zero 404 routes)", () => {
    const srcFiles = walkRepoFiles("src").filter(
      (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
    );
    expect(srcFiles.length).toBeGreaterThan(10);

    for (const absPath of srcFiles) {
      const normPath = absPath.replace(/\\/g, "/");
      const text = readFileSync(absPath, "utf8");

      if (normPath.includes("/src/sidepanel/") || normPath.includes("/src/content/")) {
        expect(
          /https:\/\/api\.sorare\.com|api\.sorare\.com\/graphql|site\.api\.espn\.com|\bfetch\s*\(/.test(
            text,
          ),
          `[F14] Network isolation violation in ${normPath}`,
        ).toBe(false);
      }

      if (normPath.includes("/src/calculators/")) {
        expect(
          /\bchrome\.|\bfetch\s*\(|\bwindow\.|\bdocument\./.test(text),
          `[F14] Calculator purity violation in ${normPath}`,
        ).toBe(false);
      }

      expect(
        text.includes("https://sorare.com/nba/arena") ||
          text.includes("https://sorare.com/nba/set"),
        `[F14] Prohibited 404 route literal in ${normPath}`,
      ).toBe(false);
    }
  });

  // Tier 2
  it("F14-T2-1: read-only execution of scripts/ship-helper.mjs produces structured output with zero repo mutations", () => {
    const shipPath = resolveRepoPath("scripts/ship-helper.mjs");
    const shipSrc = readRepoText("scripts/ship-helper.mjs");

    const beforeGit = spawnSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).stdout;
    const beforePkg = readRepoText("package.json");
    const beforeManifest = readRepoText("public/manifest.json");

    const safeArg = /\bnext\b/.test(shipSrc)
      ? "next"
      : shipSrc.includes("--dry-run")
        ? "--dry-run"
        : "--help";

    const run = spawnSync("node", [shipPath, safeArg], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(run.status, `[F14] ship-helper.mjs ${safeArg} failed: ${run.stderr}`).toBe(0);
    expect(run.stdout.trim().length).toBeGreaterThan(0);

    const afterGit = spawnSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).stdout;
    expect(afterGit).toBe(beforeGit);
    expect(readRepoText("package.json")).toBe(beforePkg);
    expect(readRepoText("public/manifest.json")).toBe(beforeManifest);
  });

  it("F14-T2-2: .0SR text-rule hygiene — zero em-dash (U+2014) characters in src/, workflow docs, and skill", () => {
    const targets = [
      ...walkRepoFiles("src"),
      ...[
        "CHANGELOG.md",
        "INPUT_NEEDED.md",
        "TESTING.md",
        "ROADMAP.md",
        "README.md",
        ".agents/skills/ship-update/SKILL.md",
      ]
        .filter((rel) => repoFileExists(rel))
        .map((rel) => resolveRepoPath(rel)),
    ];

    for (const filePath of targets) {
      const content = readFileSync(filePath, "utf8");
      expect(
        content.includes("\u2014"),
        `[F14] Prohibited U+2014 em-dash found in ${filePath}`,
      ).toBe(false);
    }
  });

  it("F14-T2-3: package.json scripts and public/manifest.json MV3 permissions/entry parity", () => {
    const pkg = JSON.parse(readRepoText("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.typecheck).toBeTruthy();
    expect(pkg.scripts?.test).toBeTruthy();
    expect(pkg.scripts?.build).toBeTruthy();
    expect(pkg.scripts?.check).toBeTruthy();
    expect(pkg.scripts?.zip).toBeTruthy();

    const manifest = JSON.parse(readRepoText("public/manifest.json")) as {
      manifest_version?: number;
      side_panel?: { default_path?: string };
      background?: { service_worker?: string };
      permissions?: string[];
      host_permissions?: string[];
    };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.side_panel?.default_path).toBe("sidepanel.html");
    expect(manifest.background?.service_worker).toBe("background.js");
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).toContain("alarms");
    expect(
      manifest.permissions,
      '[F14] public/manifest.json must declare "notifications" for F16',
    ).toContain("notifications");
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.host_permissions).toContain("https://api.sorare.com/*");
    expect(manifest.host_permissions).toContain("https://sorare.com/*");
    expect(manifest.host_permissions).toContain("https://site.api.espn.com/*");
  });

  it("F14-T2-4: AGENTS.md rate-limit, complexity, API-key isolation, and lightweight dependency invariants hold", () => {
    const constantsSrc = readRepoText("src/shared/constants.ts");
    const maxReqMatch = constantsSrc.match(
      /MAX_REQUESTS_PER_MINUTE\s*=\s*(\d+)/,
    );
    expect(maxReqMatch).not.toBeNull();
    expect(Number(maxReqMatch?.[1])).toBeLessThanOrEqual(120);

    const sorareClientSrc = readRepoText("src/background/sorareClient.ts");
    const firstMatches = Array.from(
      sorareClientSrc.matchAll(/cardCollections\([^)]*first:\s*(\d+)/g),
    );
    for (const m of firstMatches) {
      expect(Number(m[1])).toBeLessThanOrEqual(10);
    }

    const detectorSrc = readRepoText("src/content/sorareDetector.ts");
    expect(detectorSrc.includes("api.sorare.com")).toBe(false);
    expect(detectorSrc.includes("jamassist_api_key_v1")).toBe(false);

    const pkg = JSON.parse(readRepoText("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      "lucide-react",
      "react",
      "react-dom",
    ]);
  });

  it("F14-T2-5: scripts/verify.mjs implements fail-closed exit logic and safe fast/help execution without repo mutation", () => {
    const verifyPath = resolveRepoPath("scripts/verify.mjs");
    const verifySrc = readRepoText("scripts/verify.mjs");
    expect(verifySrc).toMatch(/process\.exit\(1\)|process\.exitCode\s*=\s*1/);

    const fastFlag = ["--invariants-only", "--fast", "--no-build", "--help"].find(
      (f) => verifySrc.includes(f),
    );
    if (fastFlag) {
      const beforeGit = spawnSync("git", ["status", "--porcelain"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).stdout;
      const run = spawnSync("node", [verifyPath, fastFlag], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 15_000,
      });
      expect(
        run.status,
        `[F14] verify.mjs ${fastFlag} failed: ${run.stderr}`,
      ).toBe(0);
      expect(run.stdout.trim().length).toBeGreaterThan(0);
      const afterGit = spawnSync("git", ["status", "--porcelain"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).stdout;
      expect(afterGit).toBe(beforeGit);
    }
  });

  it("F14-T2-6: WhatsNewModal renders v2.7.0 highlights cleanly and ship tooling omits AI attribution trailers", async () => {
    const mock = installChromeAndFetchMock({ manifestVersion: "2.7.0" });
    try {
      const mod = await requireContractModule<Record<string, unknown>>(
        "src/sidepanel/components/WhatsNewModal.tsx",
      );
      const WhatsNewModal = requireExport<UiComponent>(
        mod,
        "WhatsNewModal",
        "src/sidepanel/components/WhatsNewModal.tsx",
      );
      const html = renderUiComponentToHtml(
        React.createElement(WhatsNewModal, {
          version: "2.7.0",
          onClose: () => {},
        }),
        { chromeMock: mock.chrome },
      );
      expect(html).toContain("2.7.0");
      expect(
        /v2\.7\.0/i.test(readRepoText("src/sidepanel/components/WhatsNewModal.tsx")) &&
          /version:\s*"2\.7\.0"/.test(
            readRepoText("src/sidepanel/components/WhatsNewModal.tsx"),
          ),
        "[F14] WhatsNewModal must display dedicated 2.7.0 release highlights",
      ).toBe(true);
    } finally {
      mock.restore();
    }

    const skill = readRepoText(".agents/skills/ship-update/SKILL.md");
    const shipSrc = readRepoText("scripts/ship-helper.mjs");
    expect(/Co-Authored-By/i.test(skill)).toBe(false);
    expect(/Co-Authored-By/i.test(shipSrc)).toBe(false);
  });
});

// ============================================================================
// Feature 16: Multi-Event Alert & Price Tracker with Browser Notifications (12 tests)
// ============================================================================

const ALERT_MODULES = [
  "src/calculators/alertTrackerMath.ts",
  "src/calculators/bargainHunterMath.ts",
  "src/calculators/lineupOptimizerMath.ts",
];
const ALERT_EXPORTS = ["evaluateAlertEvents"];

describe("Feature 16: Multi-Event Alert & Price Tracker with Browser Notifications", () => {
  // Tier 1
  it('F16-T1-1: public/manifest.json declares "notifications" alongside alarms, storage, and sidePanel', () => {
    const manifest = JSON.parse(readRepoText("public/manifest.json")) as {
      permissions?: string[];
    };
    expect(
      manifest.permissions,
      '[F16] public/manifest.json must declare "notifications" permission for browser alerts',
    ).toContain("notifications");
    expect(manifest.permissions).toContain("alarms");
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).toContain("sidePanel");
  });

  it("F16-T1-2: evaluateAlertEvents detects price surge events respecting 25% vs 40% thresholds", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );

    const scenario25 = buildAlertEvaluationScenario({
      config: ALERT_CONFIG_ALL_ON,
    });
    const events25 = extractAlertEvents(
      fn(
        scenario25.inputs,
        scenario25.baselines,
        scenario25.config,
        scenario25.nowMs,
      ),
    );
    const surges25 = events25.filter((e) => e.kind === "price_surge");
    const surgeSlugs25 = surges25.map((e) => e.cardSlug);
    expect(surgeSlugs25).toContain("wendell-carter-jr-2026-limited-1");
    expect(surgeSlugs25).toContain("brook-lopez-2025-limited-1");

    const scenario40 = buildAlertEvaluationScenario({
      config: ALERT_CONFIG_THRESHOLD_40,
    });
    const events40 = extractAlertEvents(
      fn(
        scenario40.inputs,
        scenario40.baselines,
        scenario40.config,
        scenario40.nowMs,
      ),
    );
    const surgeSlugs40 = events40
      .filter((e) => e.kind === "price_surge")
      .map((e) => e.cardSlug);
    expect(surgeSlugs40).toContain("wendell-carter-jr-2026-limited-1");
    expect(surgeSlugs40).not.toContain("brook-lopez-2025-limited-1");
  });

  it("F16-T1-3: evaluateAlertEvents emits injury_risk events on status downgrades and links affected open lineups", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );
    const scenario = buildAlertEvaluationScenario();
    const events = extractAlertEvents(
      fn(scenario.inputs, scenario.baselines, scenario.config, scenario.nowMs),
    );

    const injuryEvents = events.filter((e) => e.kind === "injury_risk");
    const names = injuryEvents.map((e) => (e.playerName ?? "").toLowerCase());
    expect(names).toContain("dean wade");
    expect(names).toContain("sam merrill");
    expect(names).not.toContain("scottie barnes");

    const wadeEvent = injuryEvents.find(
      (e) => (e.playerName ?? "").toLowerCase() === "dean wade",
    );
    expect(wadeEvent?.currentStatus).toBe("OUT");
    expect(wadeEvent?.lineupIds).toContain("arena-gw10-classic-contender-3");
  });

  it("F16-T1-4: evaluateAlertEvents emits bargain_match, gw_cutoff, and daily_reset events in active windows", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );

    const gwScenario = buildAlertEvaluationScenario({
      nowMs: ALERT_BASE_NOW_MS,
    });
    const gwEvents = extractAlertEvents(
      fn(
        gwScenario.inputs,
        gwScenario.baselines,
        gwScenario.config,
        gwScenario.nowMs,
      ),
    );
    const bargains = gwEvents.filter((e) => e.kind === "bargain_match");
    expect(bargains.map((e) => e.cardSlug)).toContain(
      "jalen-smith-2026-limited-1",
    );
    expect(bargains.map((e) => e.cardSlug)).not.toContain(
      "max-christie-2026-limited-1",
    );
    expect(gwEvents.some((e) => e.kind === "gw_cutoff")).toBe(true);

    const dailyScenario = buildAlertEvaluationScenario({
      nowMs: ALERT_DAILY_RESET_WINDOW_MS,
    });
    const dailyEvents = extractAlertEvents(
      fn(
        dailyScenario.inputs,
        dailyScenario.baselines,
        dailyScenario.config,
        dailyScenario.nowMs,
      ),
    );
    expect(dailyEvents.some((e) => e.kind === "daily_reset")).toBe(true);
  });

  it("F16-T1-5: background alert tracker dispatches chrome.notifications.create and handles notification click", async () => {
    const mock = await ensureBackgroundLoaded();
    resetBackgroundState(mock);

    const settings = buildAlertTrackerUserSettings();
    await mock.triggerRuntimeMessage({
      type: "SAVE_SETTINGS",
      settings,
    });

    // Seed price baselines / gallery / test notification trigger if supported
    const testMsgCandidates = [
      "RUN_ALERT_CHECK",
      "SEND_TEST_ALERT_NOTIFICATION",
      "TEST_ALERT_NOTIFICATION",
      "RUN_WATCHLIST_CHECK",
    ];
    for (const msgType of testMsgCandidates) {
      await mock.triggerRuntimeMessage({ type: msgType });
      if (mock.notifications.size > 0) break;
    }

    if (mock.notifications.size === 0) {
      for (const alarmName of Array.from(mock.alarms.keys())) {
        await mock.triggerAlarm(alarmName);
      }
    }

    expect(
      mock.notifications.size,
      "[F16] Background alert/test notification handler must call chrome.notifications.create when alerts & browserNotificationsEnabled are enabled",
    ).toBeGreaterThanOrEqual(1);
    expect(
      mock.notificationEvents.some((ev) => ev.type === "create"),
    ).toBe(true);

    const firstId = Array.from(mock.notifications.keys())[0];
    await expect(mock.triggerNotificationClick(firstId)).resolves.toBeUndefined();
  });

  it("F16-T1-6: UI SSR renders alert tracker toggles, threshold control, and alert feed/test notification action", async () => {
    const settingsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/components/SettingsModal.tsx",
    );
    const bargainsMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/tabs/BargainsTab.tsx",
    );
    const appMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/App.tsx",
    );

    const SettingsModal = requireExport<UiComponent>(
      settingsMod,
      "SettingsModal",
      "src/sidepanel/components/SettingsModal.tsx",
    );
    const BargainsTab = requireExport<UiComponent>(
      bargainsMod,
      "BargainsTab",
      "src/sidepanel/tabs/BargainsTab.tsx",
    );
    const App = requireExport<UiComponent>(
      appMod,
      "App",
      "src/sidepanel/App.tsx",
    );

    const mock = installChromeAndFetchMock();
    try {
      const settingsHtml = renderUiComponentToHtml(
        React.createElement(SettingsModal, {
          version: "2.7.0",
          settings: buildAlertTrackerUserSettings(),
          onUpdateSettings: () => {},
          onOpenTierEditor: () => {},
          onClearCache: () => {},
          onReloadExtension: () => {},
          onClose: () => {},
        }),
        { chromeMock: mock.chrome },
      );
      const bargainsHtml = renderUiComponentToHtml(
        React.createElement(BargainsTab, makeBargainsProps()),
        { chromeMock: mock.chrome },
      );
      const appHtml = renderUiComponentToHtml(React.createElement(App), {
        chromeMock: mock.chrome,
      });

      const combined = `${settingsHtml}\n${bargainsHtml}\n${appHtml}`;
      expect(
        /price surge|price tracker|sell opportunity/i.test(combined),
        "[F16] UI must surface Price Surge / Sell Opportunity alert toggle",
      ).toBe(true);
      expect(
        /browser notification|desktop notification|notifications/i.test(
          combined,
        ),
        "[F16] UI must surface browser notification toggle for alerts",
      ).toBe(true);
      expect(
        /injury/i.test(combined) && /cutoff|daily reset/i.test(combined),
        "[F16] UI must surface injury risk & cutoff/reset alert controls",
      ).toBe(true);
    } finally {
      mock.restore();
    }
  });

  // Tier 2
  it("F16-T2-1: BVA filters noise (+5.41%), flat (0%), and 24.9% below threshold while triggering exact 25.0%", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );

    const scenario = buildAlertEvaluationScenario({
      cardPriceOverrides: {
        // Jordan Miller baseline 110 -> 137 (+24.55%, below 25%) and 138 (+25.45%, above 25%)
        // Use Brook Lopez baseline 240: 299 = +24.58%, 300 = exact +25.0%
        "brook-lopez-2025-limited-1": 299,
        "wendell-carter-jr-2026-limited-1": 500, // exact +25.0% over 400
      },
    });
    const events = extractAlertEvents(
      fn(scenario.inputs, scenario.baselines, scenario.config, scenario.nowMs),
    );
    const surgeSlugs = events
      .filter((e) => e.kind === "price_surge")
      .map((e) => e.cardSlug);

    expect(surgeSlugs).toContain("wendell-carter-jr-2026-limited-1"); // exact +25.0%
    expect(surgeSlugs).not.toContain("brook-lopez-2025-limited-1"); // +24.58% < 25%
    expect(surgeSlugs).not.toContain("malik-monk-2024-limited-2"); // +5.41% noise
    expect(surgeSlugs).not.toContain("jordan-miller-2025-limited-1"); // 0% flat
  });

  it("F16-T2-2: zero-baseline, missing-baseline, and null-ask cards emit zero false surges and zero NaN/Infinity", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );
    const scenario = buildAlertEvaluationScenario({
      cardPriceOverrides: ALERT_UNPRICED_VARIANT_OVERRIDES,
    });
    const events = extractAlertEvents(
      fn(scenario.inputs, scenario.baselines, scenario.config, scenario.nowMs),
    );

    const surgeSlugs = events
      .filter((e) => e.kind === "price_surge")
      .map((e) => e.cardSlug);
    expect(surgeSlugs).not.toContain("isaac-okoro-2024-limited-2");
    expect(surgeSlugs).not.toContain("cormac-ryan-2026-limited-1");
    expect(surgeSlugs).not.toContain("jordan-miller-2025-limited-1");

    for (const ev of events) {
      if (typeof ev.pctChange === "number") {
        expect(Number.isFinite(ev.pctChange)).toBe(true);
      }
    }
  });

  it("F16-T2-3: master toggle, per-event toggle, and browserNotificationsEnabled toggle behave deterministically", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );

    const masterOff = buildAlertEvaluationScenario({
      config: ALERT_CONFIG_MASTER_OFF,
    });
    expect(
      extractAlertEvents(
        fn(
          masterOff.inputs,
          masterOff.baselines,
          masterOff.config,
          masterOff.nowMs,
        ),
      ),
    ).toEqual([]);

    const surgeOff = buildAlertEvaluationScenario({
      config: ALERT_CONFIG_PRICE_SURGE_OFF,
    });
    const surgeOffEvents = extractAlertEvents(
      fn(
        surgeOff.inputs,
        surgeOff.baselines,
        surgeOff.config,
        surgeOff.nowMs,
      ),
    );
    expect(surgeOffEvents.some((e) => e.kind === "price_surge")).toBe(false);
    expect(surgeOffEvents.some((e) => e.kind === "injury_risk")).toBe(true);

    const notifsOff = buildAlertEvaluationScenario({
      config: ALERT_CONFIG_NOTIFS_OFF,
    });
    const notifsOffEvents = extractAlertEvents(
      fn(
        notifsOff.inputs,
        notifsOff.baselines,
        notifsOff.config,
        notifsOff.nowMs,
      ),
    );
    expect(notifsOffEvents.length).toBeGreaterThan(0);
    for (const ev of notifsOffEvents) {
      expect(ev.notifyBrowser).toBe(false);
    }
  });

  it("F16-T2-4: opaque-box cooldown deduplication suppresses events at +15m and re-emits at +65m", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );

    const first = buildAlertEvaluationScenario({ nowMs: ALERT_BASE_NOW_MS });
    const firstEvents = extractAlertEvents(
      fn(first.inputs, first.baselines, first.config, first.nowMs),
    );
    const wendellFirst = firstEvents.find(
      (e) =>
        e.kind === "price_surge" &&
        e.cardSlug === "wendell-carter-jr-2026-limited-1",
    );
    expect(wendellFirst?.dedupeKey).toBeTruthy();

    const dedupeMap: Record<string, number> = {
      [wendellFirst!.dedupeKey]: ALERT_BASE_NOW_MS,
    };

    const withinCooldown = buildAlertEvaluationScenario({
      nowMs: ALERT_COOLDOWN_WITHIN_MS,
      priorDedupeMap: dedupeMap,
    });
    const withinEvents = extractAlertEvents(
      fn(
        withinCooldown.inputs,
        withinCooldown.baselines,
        withinCooldown.config,
        withinCooldown.nowMs,
      ),
    );
    expect(
      withinEvents.some(
        (e) =>
          e.kind === "price_surge" &&
          e.cardSlug === "wendell-carter-jr-2026-limited-1",
      ),
    ).toBe(false);

    const afterCooldown = buildAlertEvaluationScenario({
      nowMs: ALERT_COOLDOWN_EXPIRED_MS,
      priorDedupeMap: dedupeMap,
    });
    const afterEvents = extractAlertEvents(
      fn(
        afterCooldown.inputs,
        afterCooldown.baselines,
        afterCooldown.config,
        afterCooldown.nowMs,
      ),
    );
    expect(
      afterEvents.some(
        (e) =>
          e.kind === "price_surge" &&
          e.cardSlug === "wendell-carter-jr-2026-limited-1",
      ),
    ).toBe(true);
  });

  it("F16-T2-5: gw_cutoff does not fire 4h before lock and daily_reset does not fire 5m after 07:00 UTC", async () => {
    const { fn } = await probeFirstFunction<EvaluateAlertsFn>(
      ALERT_MODULES,
      ALERT_EXPORTS,
      "[F16] evaluateAlertEvents",
    );

    const outsideCutoff = buildAlertEvaluationScenario({
      nowMs: ALERT_OUTSIDE_CUTOFF_MS,
    });
    const outsideEvents = extractAlertEvents(
      fn(
        outsideCutoff.inputs,
        outsideCutoff.baselines,
        outsideCutoff.config,
        outsideCutoff.nowMs,
      ),
    );
    expect(outsideEvents.some((e) => e.kind === "gw_cutoff")).toBe(false);

    const afterDaily = buildAlertEvaluationScenario({
      nowMs: ALERT_AFTER_DAILY_RESET_MS,
    });
    const afterDailyEvents = extractAlertEvents(
      fn(
        afterDaily.inputs,
        afterDaily.baselines,
        afterDaily.config,
        afterDaily.nowMs,
      ),
    );
    expect(afterDailyEvents.some((e) => e.kind === "daily_reset")).toBe(false);
  });

  it("F16-T2-6: background creates zero browser notifications when browserNotificationsEnabled or alertsEnabled is false", async () => {
    const mock = await ensureBackgroundLoaded();

    for (const cfg of [ALERT_CONFIG_NOTIFS_OFF, ALERT_CONFIG_MASTER_OFF]) {
      resetBackgroundState(mock);
      await mock.triggerRuntimeMessage({
        type: "SAVE_SETTINGS",
        settings: buildAlertTrackerUserSettings(cfg),
      });
      for (const alarmName of Array.from(mock.alarms.keys())) {
        await mock.triggerAlarm(alarmName);
      }
      await mock.triggerRuntimeMessage({ type: "RUN_WATCHLIST_CHECK" });
      expect(mock.notifications.size).toBe(0);
    }
  });
});

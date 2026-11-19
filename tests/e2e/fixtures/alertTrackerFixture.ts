import type {
  BargainListing,
  Currency,
  GalleryCard,
  InjuryReportEntry,
  InjuryStatus,
  So5FixtureSummary,
  UserSettings,
  WatchlistEntry,
} from "../../../src/shared/types";
import type { CurrentLineupEntry } from "../../../src/shared/types";
import { PJAMPJAM_GALLERY_CARDS } from "./gallery42Fixture.ts";
import { ARENA_GW10_SUBMITTED_LINEUPS } from "./arenaLineupsFixture.ts";
import {
  PJAMPJAM_INJURIES_BY_NAME,
  SORARE_FIXTURES_GW8_TO_GW10,
} from "./espnAndLeaderboardFixtures.ts";

/**
 * Local structural types matching `PROJECT.md § Interface Contracts #2` for Feature #16
 * so this fixture compiles cleanly prior to M2 landing in `src/shared/types.ts`.
 */
export type AlertEventKind =
  | "price_surge"
  | "injury_risk"
  | "bargain_match"
  | "gw_cutoff"
  | "daily_reset";

export interface AlertPreferencesFixture {
  priceSurgeEnabled: boolean;
  priceSurgePctThreshold: number;
  injuryRiskEnabled: boolean;
  bargainAlertEnabled: boolean;
  cutoffAlertEnabled: boolean;
  dailyResetAlertEnabled: boolean;
  browserNotificationsEnabled: boolean;
  cooldownMinutes: number;
}

export interface AlertTrackerConfigFixture {
  alertsEnabled: boolean;
  alertPreferences: AlertPreferencesFixture;
  cutoffReminderEnabled?: boolean;
  cutoffReminderMinutesBefore?: number;
}

export interface PriceBaselineRecordFixture {
  cardSlug: string;
  playerSlug: string;
  playerName: string;
  currency: Currency;
  baselineFloorCents: number;
  recordedAtMs: number;
  updatedAtMs: number;
}

export interface TrackedAlertEventFixture {
  id: string;
  dedupeKey: string;
  kind: AlertEventKind;
  title: string;
  message: string;
  cardSlug?: string;
  playerSlug?: string;
  playerName?: string;
  lineupIds?: string[];
  pctChange?: number;
  baselineCents?: number;
  currentCents?: number;
  previousStatus?: InjuryStatus;
  currentStatus?: InjuryStatus;
  targetUrl?: string;
  createdAtMs: number;
  notifyBrowser: boolean;
}

export interface AlertEvaluationInputsFixture {
  cards: GalleryCard[];
  currentLineups: CurrentLineupEntry[];
  previousInjuriesByName: Record<string, InjuryReportEntry>;
  currentInjuriesByName: Record<string, InjuryReportEntry>;
  bargainListings: BargainListing[];
  watchlist: WatchlistEntry[];
  fixtures: So5FixtureSummary[];
  lastAlertAtByKey: Record<string, number>;
}

export type UserSettingsWithAlertsFixture = UserSettings & {
  alertsEnabled?: boolean;
  cutoffReminderEnabled?: boolean;
  cutoffReminderMinutesBefore?: number;
  alertPreferences?: AlertPreferencesFixture;
};

// --- Deterministic UTC Time Anchors (zero Date.now() / Math.random()) ---

/** 25 minutes before GW10 cutoff (`2026-11-21T00:00:00Z`) */
export const ALERT_BASE_NOW_MS = Date.parse("2026-11-20T23:35:00Z");

/** 4 hours before GW10 cutoff (outside 30m/60m cutoff reminder window) */
export const ALERT_OUTSIDE_CUTOFF_MS = Date.parse("2026-11-20T20:00:00Z");

/** 20 minutes before the `07:00 UTC` daily reset (`2026-11-21T07:00:00Z`) */
export const ALERT_DAILY_RESET_WINDOW_MS = Date.parse("2026-11-21T06:40:00Z");

/** 5 minutes after `07:00 UTC` daily reset (23h55m until next reset) */
export const ALERT_AFTER_DAILY_RESET_MS = Date.parse("2026-11-21T07:05:00Z");

/** 15 minutes after `ALERT_BASE_NOW_MS` (inside 60-minute cooldown window) */
export const ALERT_COOLDOWN_WITHIN_MS = ALERT_BASE_NOW_MS + 15 * 60_000;

/** 65 minutes after `ALERT_BASE_NOW_MS` (outside 60-minute cooldown window) */
export const ALERT_COOLDOWN_EXPIRED_MS = ALERT_BASE_NOW_MS + 65 * 60_000;

const BASELINE_RECORDED_AT_MS = Date.parse("2026-11-19T12:00:00Z");

// --- Deep-Clone Helpers (never mutate shared fixture exports) ---

function cloneCard(card: GalleryCard): GalleryCard {
  return {
    ...card,
    positions: [...card.positions],
    ...(card.openedLineupIds ? { openedLineupIds: [...card.openedLineupIds] } : {}),
    ...(card.powerBreakdown ? { powerBreakdown: { ...card.powerBreakdown } } : {}),
  };
}

function cloneLineup(entry: CurrentLineupEntry): CurrentLineupEntry {
  return {
    ...entry,
    cardSlugs: [...entry.cardSlugs],
    ...(entry.playerNames ? { playerNames: [...entry.playerNames] } : {}),
  };
}

function cloneInjury(entry: InjuryReportEntry): InjuryReportEntry {
  return { ...entry };
}

function cloneInjuriesRecord(
  record: Record<string, InjuryReportEntry>,
): Record<string, InjuryReportEntry> {
  const out: Record<string, InjuryReportEntry> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = cloneInjury(value);
  }
  return out;
}

function cloneFixture(fixture: So5FixtureSummary): So5FixtureSummary {
  return { ...fixture };
}

function cloneBargainListing(listing: BargainListing): BargainListing {
  return {
    ...listing,
    positions: [...listing.positions],
    ...(listing.questLabels ? { questLabels: [...listing.questLabels] } : {}),
  };
}

function cloneWatchlistEntry(entry: WatchlistEntry): WatchlistEntry {
  return { ...entry };
}

function cloneBaselineRecord(
  record: PriceBaselineRecordFixture,
): PriceBaselineRecordFixture {
  return { ...record };
}

function cloneBaselinesMap(
  baselines: Record<string, PriceBaselineRecordFixture>,
): Record<string, PriceBaselineRecordFixture> {
  const out: Record<string, PriceBaselineRecordFixture> = {};
  for (const [slug, rec] of Object.entries(baselines)) {
    out[slug] = cloneBaselineRecord(rec);
  }
  return out;
}

function cloneConfig(
  config: AlertTrackerConfigFixture,
): AlertTrackerConfigFixture {
  return {
    ...config,
    alertPreferences: { ...config.alertPreferences },
  };
}

// --- Toggle & Threshold Config Presets ---

export const DEFAULT_ALERT_PREFERENCES_FIXTURE: AlertPreferencesFixture = {
  priceSurgeEnabled: true,
  priceSurgePctThreshold: 25,
  injuryRiskEnabled: true,
  bargainAlertEnabled: true,
  cutoffAlertEnabled: true,
  dailyResetAlertEnabled: true,
  browserNotificationsEnabled: true,
  cooldownMinutes: 60,
};

export const ALERT_CONFIG_ALL_ON: AlertTrackerConfigFixture = {
  alertsEnabled: true,
  cutoffReminderEnabled: true,
  cutoffReminderMinutesBefore: 30,
  alertPreferences: { ...DEFAULT_ALERT_PREFERENCES_FIXTURE },
};

export const ALERT_CONFIG_THRESHOLD_40: AlertTrackerConfigFixture = {
  alertsEnabled: true,
  cutoffReminderEnabled: true,
  cutoffReminderMinutesBefore: 30,
  alertPreferences: {
    ...DEFAULT_ALERT_PREFERENCES_FIXTURE,
    priceSurgePctThreshold: 40,
  },
};

export const ALERT_CONFIG_MASTER_OFF: AlertTrackerConfigFixture = {
  alertsEnabled: false,
  cutoffReminderEnabled: false,
  cutoffReminderMinutesBefore: 30,
  alertPreferences: { ...DEFAULT_ALERT_PREFERENCES_FIXTURE },
};

export const ALERT_CONFIG_PRICE_SURGE_OFF: AlertTrackerConfigFixture = {
  alertsEnabled: true,
  cutoffReminderEnabled: true,
  cutoffReminderMinutesBefore: 30,
  alertPreferences: {
    ...DEFAULT_ALERT_PREFERENCES_FIXTURE,
    priceSurgeEnabled: false,
  },
};

export const ALERT_CONFIG_NOTIFS_OFF: AlertTrackerConfigFixture = {
  alertsEnabled: true,
  cutoffReminderEnabled: true,
  cutoffReminderMinutesBefore: 30,
  alertPreferences: {
    ...DEFAULT_ALERT_PREFERENCES_FIXTURE,
    browserNotificationsEnabled: false,
  },
};

// --- Price Surge Baselines & Priced Gallery Scenarios ---

/**
 * Price surge baselines covering boundary & edge cases:
 * - `wendell-carter-jr-2026-limited-1`: 400 -> 580 (+45.0%, triggers at 25% & 40%)
 * - `brook-lopez-2025-limited-1`: 240 -> 312 (+30.0%, triggers at 25%, suppressed at 40%)
 * - `malik-monk-2024-limited-2`: 185 -> 195 (+5.41% noise, suppressed)
 * - `isaac-okoro-2024-limited-2`: 0 -> 160 (zero-baseline guard: no Infinity% / NaN)
 * - `jordan-miller-2025-limited-1`: 110 -> 110 flat (or `null` in unpriced variant)
 * - `cormac-ryan-2026-limited-1`: intentionally omitted (missing-baseline guard: seeds without surge)
 */
export const ALERT_PRICE_BASELINES: Record<string, PriceBaselineRecordFixture> = {
  "wendell-carter-jr-2026-limited-1": {
    cardSlug: "wendell-carter-jr-2026-limited-1",
    playerSlug: "wendell-carter-jr-19990416",
    playerName: "Wendell Carter Jr.",
    currency: "EUR",
    baselineFloorCents: 400,
    recordedAtMs: BASELINE_RECORDED_AT_MS,
    updatedAtMs: BASELINE_RECORDED_AT_MS,
  },
  "brook-lopez-2025-limited-1": {
    cardSlug: "brook-lopez-2025-limited-1",
    playerSlug: "brook-lopez-19880401",
    playerName: "Brook Lopez",
    currency: "EUR",
    baselineFloorCents: 240,
    recordedAtMs: BASELINE_RECORDED_AT_MS,
    updatedAtMs: BASELINE_RECORDED_AT_MS,
  },
  "malik-monk-2024-limited-2": {
    cardSlug: "malik-monk-2024-limited-2",
    playerSlug: "malik-monk-19980204",
    playerName: "Malik Monk",
    currency: "EUR",
    baselineFloorCents: 185,
    recordedAtMs: BASELINE_RECORDED_AT_MS,
    updatedAtMs: BASELINE_RECORDED_AT_MS,
  },
  "isaac-okoro-2024-limited-2": {
    cardSlug: "isaac-okoro-2024-limited-2",
    playerSlug: "isaac-okoro-20010126",
    playerName: "Isaac Okoro",
    currency: "EUR",
    baselineFloorCents: 0,
    recordedAtMs: BASELINE_RECORDED_AT_MS,
    updatedAtMs: BASELINE_RECORDED_AT_MS,
  },
  "jordan-miller-2025-limited-1": {
    cardSlug: "jordan-miller-2025-limited-1",
    playerSlug: "jordan-miller-20000123",
    playerName: "Jordan Miller",
    currency: "EUR",
    baselineFloorCents: 110,
    recordedAtMs: BASELINE_RECORDED_AT_MS,
    updatedAtMs: BASELINE_RECORDED_AT_MS,
  },
};

export const ALERT_DEFAULT_CARD_PRICE_OVERRIDES: Record<string, number | null> = {
  "wendell-carter-jr-2026-limited-1": 580,
  "brook-lopez-2025-limited-1": 312,
  "cormac-ryan-2026-limited-1": 220,
};

export const ALERT_UNPRICED_VARIANT_OVERRIDES: Record<string, number | null> = {
  ...ALERT_DEFAULT_CARD_PRICE_OVERRIDES,
  "jordan-miller-2025-limited-1": null,
};

export function buildPricedGalleryForAlertTests(
  overridesBySlug: Record<string, number | null> = {},
): GalleryCard[] {
  const mergedOverrides: Record<string, number | null> = {
    ...ALERT_DEFAULT_CARD_PRICE_OVERRIDES,
    ...overridesBySlug,
  };
  return PJAMPJAM_GALLERY_CARDS.map((card) => {
    const cloned = cloneCard(card);
    if (Object.prototype.hasOwnProperty.call(mergedOverrides, cloned.slug)) {
      cloned.lowestAskCents = mergedOverrides[cloned.slug];
    }
    return cloned;
  });
}

// --- Injury Risk Change Scenarios ---

export const ALERT_PREVIOUS_INJURIES: Record<string, InjuryReportEntry> = (() => {
  const base = cloneInjuriesRecord(PJAMPJAM_INJURIES_BY_NAME);
  base["dean wade"] = {
    playerName: "Dean Wade",
    normalizedName: "dean wade",
    teamName: "Philadelphia 76ers",
    status: "QUESTIONABLE",
    rawStatus: "Questionable",
    comment: "Wade (knee soreness) listed questionable prior to GW10.",
  };
  return base;
})();

export const ALERT_UPDATED_INJURIES: Record<string, InjuryReportEntry> = (() => {
  const updated = cloneInjuriesRecord(PJAMPJAM_INJURIES_BY_NAME);
  updated["dean wade"] = {
    playerName: "Dean Wade",
    normalizedName: "dean wade",
    teamName: "Philadelphia 76ers",
    status: "OUT",
    rawStatus: "Out",
    comment: "Wade (knee soreness) downgraded to OUT prior to GW10 lock.",
  };
  updated["sam merrill"] = {
    playerName: "Sam Merrill",
    normalizedName: "sam merrill",
    teamName: "Cleveland Cavaliers",
    status: "QUESTIONABLE",
    rawStatus: "Questionable",
    comment: "Merrill (ankle) added as Questionable ahead of tip-off.",
  };
  return updated;
})();

// --- Bargain / Sniper Watchlist Scenarios ---

export const ALERT_WATCHLIST_FIXTURE: WatchlistEntry[] = [
  {
    id: "wl-non-playoffs-snipe",
    kind: "quest_non_playoffs",
    label: "Non-Playoffs 1ST <= €3.00",
    rarity: "limited",
    maxPriceCents: 300,
    firstOwnerOnly: true,
    createdAt: Date.parse("2026-11-18T12:00:00Z"),
  },
];

export const ALERT_BARGAIN_LISTINGS: BargainListing[] = [
  {
    cardSlug: "jalen-smith-2026-limited-1",
    assetId: "asset-jalen-smith-2026-limited-1",
    playerSlug: "jalen-smith-20000316",
    playerName: "Jalen Smith",
    teamName: "Chicago Bulls",
    teamSlug: "chicago-bulls",
    pictureUrl: null,
    cardEditionName: "2026-27 Limited",
    isPrimaryOffer: true,
    isFirstOwnerEligible: true,
    questLabels: ["Non-Playoffs"],
    advancesCollection: true,
    positions: ["basketball_forward", "basketball_center"],
    rarity: "limited",
    seasonYear: 2026,
    inSeasonEligible: true,
    l10: 21.5,
    l5: 23.0,
    projected: 22.4,
    starCost: 2.5,
    saleType: "instant_buy",
    priceCents: 245,
    currency: "EUR",
    endDate: null,
    bidsCount: null,
    centsPerL10: 11.4,
    valueScore: 88.0,
    marketUrl: "https://sorare.com/nba/cards/jalen-smith-2026-limited-1",
  },
  {
    cardSlug: "max-christie-2026-limited-1",
    assetId: "asset-max-christie-2026-limited-1",
    playerSlug: "max-christie-20030210",
    playerName: "Max Christie",
    teamName: "Dallas Mavericks",
    teamSlug: "dallas-mavericks",
    pictureUrl: null,
    cardEditionName: "2026-27 Limited",
    isPrimaryOffer: true,
    isFirstOwnerEligible: true,
    questLabels: ["Non-Playoffs"],
    advancesCollection: false,
    positions: ["basketball_guard"],
    rarity: "limited",
    seasonYear: 2026,
    inSeasonEligible: true,
    l10: 14.5,
    l5: 13.8,
    projected: 14.2,
    starCost: 1.5,
    saleType: "instant_buy",
    priceCents: 890,
    currency: "EUR",
    endDate: null,
    bidsCount: null,
    centsPerL10: 61.38,
    valueScore: 22.0,
    marketUrl: "https://sorare.com/nba/cards/max-christie-2026-limited-1",
  },
];

// --- Cooldown Deduplication & Composite Builders ---

export const ALERT_PRIOR_DEDUPE_MAP: Record<string, number> = {
  "price_surge:wendell-carter-jr-2026-limited-1": ALERT_BASE_NOW_MS,
};

export function buildAlertTrackerUserSettings(
  overrides: Partial<UserSettingsWithAlertsFixture> = {},
): UserSettingsWithAlertsFixture {
  const { alertPreferences, watchlist, ...restOverrides } = overrides;
  return {
    username: "pjampjam",
    usernameLockedByUser: true,
    sorareApiKey: "",
    apiKeyPromptDismissed: true,
    theme: "obsidian_gray",
    density: "cozy",
    essenceByRarity: {
      limited: 450,
      rare: 0,
      super_rare: 0,
      unique: 0,
    },
    walletBalance: {
      cashAmount: 25,
      cashSymbol: "€",
      ethAmount: 0.01,
      cluesCount: 2,
      updatedAt: Date.parse("2026-11-20T23:00:00Z"),
    },
    autoShowInPageWizards: true,
    watchlist: (watchlist ?? ALERT_WATCHLIST_FIXTURE).map(cloneWatchlistEntry),
    watchlistAlerts: [],
    currency: "EUR",
    selectedRarity: "limited",
    craftThreshold: 1000,
    inSeasonOnly: false,
    craftReadyOnly: false,
    autoOpenOnCraft: true,
    autoOpenOnSorare: false,
    autoPriceTopN: 3,
    projectionSource: "blended_smart",
    customProjectionsRaw: "",
    milestoneRulesByRarity: {
      limited: [],
      rare: [],
      super_rare: [],
      unique: [],
    },
    alertsEnabled: true,
    cutoffReminderEnabled: true,
    cutoffReminderMinutesBefore: 30,
    alertPreferences: {
      ...DEFAULT_ALERT_PREFERENCES_FIXTURE,
      ...(alertPreferences ?? {}),
    },
    ...restOverrides,
  };
}

export function buildAlertEvaluationScenario(
  options: {
    nowMs?: number;
    includePriorCooldown?: boolean;
    priorDedupeMap?: Record<string, number>;
    cardPriceOverrides?: Record<string, number | null>;
    config?: AlertTrackerConfigFixture;
  } = {},
): {
  inputs: AlertEvaluationInputsFixture;
  baselines: Record<string, PriceBaselineRecordFixture>;
  config: AlertTrackerConfigFixture;
  nowMs: number;
} {
  const nowMs = options.nowMs ?? ALERT_BASE_NOW_MS;
  const lastAlertAtByKey: Record<string, number> = options.priorDedupeMap
    ? { ...options.priorDedupeMap }
    : options.includePriorCooldown
      ? { ...ALERT_PRIOR_DEDUPE_MAP }
      : {};

  return {
    inputs: {
      cards: buildPricedGalleryForAlertTests(options.cardPriceOverrides),
      currentLineups: ARENA_GW10_SUBMITTED_LINEUPS.map(cloneLineup),
      previousInjuriesByName: cloneInjuriesRecord(ALERT_PREVIOUS_INJURIES),
      currentInjuriesByName: cloneInjuriesRecord(ALERT_UPDATED_INJURIES),
      bargainListings: ALERT_BARGAIN_LISTINGS.map(cloneBargainListing),
      watchlist: ALERT_WATCHLIST_FIXTURE.map(cloneWatchlistEntry),
      fixtures: SORARE_FIXTURES_GW8_TO_GW10.map(cloneFixture),
      lastAlertAtByKey,
    },
    baselines: cloneBaselinesMap(ALERT_PRICE_BASELINES),
    config: cloneConfig(options.config ?? ALERT_CONFIG_ALL_ON),
    nowMs,
  };
}

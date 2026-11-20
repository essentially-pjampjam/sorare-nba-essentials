import { buildMarketPriceKey } from "../calculators/collectionEssenceMath";
import { evaluateStarTierShift } from "../calculators/lineupOptimizerMath";
import { selectOpenGameWeek } from "../calculators/countdownMath";
import { selectDailyPickerWindow } from "../calculators/dailySlateMath";
import {
  ALERT_TRACKER_ALARM_NAME,
  CUTOFF_REMINDER_ALARM_NAME,
  getAlertFeed,
  runAlertTracker,
  saveAlertSnapshot,
  sendTestAlertNotification,
  syncAlertTrackerAlarm,
  takeNotificationTarget,
} from "./alertTracker";
import {
  AUTO_PRICE_TOP_N,
  COOLDOWN_429_MS,
  DEFAULT_SETTINGS,
  FAST_MODE_REQUESTS_PER_MINUTE,
  FAST_MODE_SPACING_MS,
  LEGACY_TEAM_PRESET_RULE_IDS,
  MAX_REQUESTS_PER_MINUTE,
  MIN_REQUEST_SPACING_MS,
  NBA_26_DRAFT_TOP_30_SLUGS,
  RESERVED_USER_SLUGS,
  SORARE_NBA_CARD_URL,
} from "../shared/constants";
import { mergeApiAndDomLineups, upsertDomLineups } from "../shared/domLineupMerge";
import {
  buildProPlayUrl,
  isAllowedSorareUrl as isVerifiedSorareNavUrl,
} from "../shared/routes";
import type {
  BackgroundRequest,
  BackgroundResponse,
  BargainListing,
  BargainMode,
  BargainsResult,
  CollectionRaw,
  CraftPoolResult,
  Currency,
  CurrentLineupEntry,
  DailyPickerPool,
  GalleryCard,
  GalleryResult,
  MissingSlot,
  Rarity,
  ScanProgress,
  ScanResult,
  UserSettings,
  WatchlistAlert,
  WatchlistEntry,
} from "../shared/types";
import { clearAllCache, getCached, setCached } from "./cache";
import { fetchDailySlateGames, fetchExternalNbaContext, fetchPlayerSeasonStats } from "./externalDataClient";
import {
  RateLimitedError,
  RateLimitQueue,
  ScanCancelledError,
} from "./rateLimitQueue";
import { SorareClient } from "./sorareClient";
import { getSavedSquadSnapshot, scanSquadFromOpenTab } from "./squadScanner";

const SETTINGS_KEY = "jamassist_settings_v2";
const LEGACY_SETTINGS_KEY = "jamassist_settings_v1";
const API_KEY_STORAGE = "jamassist_api_key_v1";
const CONTENT_FLAGS_KEY = "jamassist_content_flags_v1";
const DETECTED_USER_KEY = "jamassist_detected_username";
const DETECTED_LINEUPS_KEY = "jamassist_detected_lineups_v1";
const PENDING_TAB_KEY = "jamassist_pending_tab";
const PENDING_LINEUP_HUD_KEY = "jamassist_pending_lineup_hud";
const OVERLAY_LOOKUP_KEY = "jamassist_overlay_lookup_v1";
const WATCHLIST_ALARM_NAME = "jamassist-watchlist-sniper";
const COOLDOWN_KEY = "jamassist_cooldown_until";
const SLUG_REGEX = /^[a-z0-9_-]{2,40}$/i;

function isValidUsernameSlug(slug: string): boolean {
  const clean = slug.trim().toLowerCase();
  return Boolean(clean && SLUG_REGEX.test(clean) && !RESERVED_USER_SLUGS.has(clean));
}

const CONTENT_ALLOWED_TYPES = new Set<string>([
  "OPEN_SIDE_PANEL",
  "OPEN_DASHBOARD_TAB",
  "DETECTED_USERNAME_FROM_CONTENT",
  "SORARE_PAGE_CONTEXT",
  "DETECTED_ESSENCE_FROM_CONTENT",
  "DETECTED_WALLET_FROM_CONTENT",
  "DETECTED_LINEUPS_FROM_CONTENT",
]);

function isAllowedSorareUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "sorare.com" || parsed.hostname.endsWith(".sorare.com"))
    );
  } catch {
    return false;
  }
}

/** True when both URLs point at the same origin + path (ignores query, hash, trailing slash). */
function isSameNavTarget(currentUrl: string | undefined, targetUrl: string): boolean {
  if (!currentUrl) return false;
  try {
    const a = new URL(currentUrl);
    const b = new URL(targetUrl);
    const trim = (p: string) => p.replace(/\/+$/, "").toLowerCase();
    return a.origin === b.origin && trim(a.pathname) === trim(b.pathname);
  } catch {
    return false;
  }
}

function isAllowedNavTargetUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  // Sorare targets must be https sorare.com AND never a known-404 route (/nba/arena, /nba/set).
  if (isAllowedSorareUrl(rawUrl)) return isVerifiedSorareNavUrl(rawUrl);
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      parsed.pathname.toLowerCase().startsWith("/essentially-pjampjam/")
    );
  } catch {
    return false;
  }
}

function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  const extOrigin = chrome.runtime.getURL("");
  return Boolean(sender.url && sender.url.startsWith(extOrigin));
}

const activePorts = new Set<chrome.runtime.Port>();
let currentScanAbort: AbortController | null = null;

function broadcastMessage(payload: Record<string, unknown>): void {
  for (const port of activePorts) {
    try {
      port.postMessage(payload);
    } catch {
      activePorts.delete(port);
    }
  }
}

function broadcastProgress(progress: ScanProgress): void {
  broadcastMessage({ type: "SCAN_PROGRESS", progress });
}

function broadcastPartialResult(result: ScanResult): void {
  broadcastMessage({ type: "SCAN_PARTIAL_RESULT", result });
}

const queue = new RateLimitQueue({
  maxPerMinute: MAX_REQUESTS_PER_MINUTE,
  concurrency: 1,
  minSpacingMs: MIN_REQUEST_SPACING_MS,
  maxRetries: 0,
  onWait: (waitMs, reason) => {
    const sec = Math.max(1, Math.ceil(waitMs / 1000));
    broadcastProgress({
      phase: "collections",
      completed: 0,
      total: 1,
      message:
        reason === "cooldown"
          ? `Sorare cooldown (${sec}s) - protecting your session...`
          : `Pacing requests (${sec}s) to stay under Sorare limits...`,
    });
  },
});

const sorareClient = new SorareClient(queue);

function applyNetworkMode(settings: UserSettings): void {
  const key = settings.sorareApiKey?.trim() ?? "";
  sorareClient.setApiKey(key);
  if (key) {
    queue.setLimits(FAST_MODE_REQUESTS_PER_MINUTE, FAST_MODE_SPACING_MS);
  } else {
    queue.setLimits(MAX_REQUESTS_PER_MINUTE, MIN_REQUEST_SPACING_MS);
  }
}

function ensureWatchlistAlarm(): void {
  if (!chrome.alarms) return;
  try {
    chrome.alarms.create(WATCHLIST_ALARM_NAME, { periodInMinutes: 10 });
  } catch {
    // Ignore if alarms unavailable
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureWatchlistAlarm();
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

ensureWatchlistAlarm();

async function runAlertTrackerFromStorage(): Promise<ReturnType<typeof runAlertTracker>> {
  const settings = await loadSettings();
  // The tracker makes no network calls: it reuses the last gallery load (cards, lineups,
  // fixtures, ESPN injuries), so it never adds Sorare API traffic.
  const events = await runAlertTracker(settings);
  if (events.length > 0) {
    broadcastMessage({ type: "ALERT_FEED_UPDATED", events: await getAlertFeed() });
  }
  return events;
}

if (chrome.alarms?.onAlarm) {
  // Returning the promise keeps the MV3 worker alive until the check finishes.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCHLIST_ALARM_NAME) {
      // Market scan can take minutes behind the rate-limited queue: fire and forget.
      void runWatchlistCheck();
      return undefined;
    }
    if (alarm.name === ALERT_TRACKER_ALARM_NAME || alarm.name === CUTOFF_REMINDER_ALARM_NAME) {
      return runAlertTrackerFromStorage().then(() => undefined);
    }
    return undefined;
  });
}

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    return (async () => {
      const target = await takeNotificationTarget(notificationId);
      const url = target && isAllowedNavTargetUrl(target) ? target : buildProPlayUrl();
      await chrome.tabs.create({ url });
      chrome.notifications.clear(notificationId);
    })();
  });
}

void loadSettings().then(syncAlertTrackerAlarm).catch(() => {});

if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "jamassist-sidepanel") return;
  if (!port.sender || !isExtensionPageSender(port.sender)) {
    port.disconnect();
    return;
  }
  activePorts.add(port);
  port.onDisconnect.addListener(() => {
    activePorts.delete(port);
  });
});

function sanitizeMilestoneRulesMap(
  raw: UserSettings["milestoneRulesByRarity"] | undefined,
): UserSettings["milestoneRulesByRarity"] {
  const merged = {
    ...DEFAULT_SETTINGS.milestoneRulesByRarity,
    ...(raw ?? {}),
  };
  for (const r of ["limited", "rare", "super_rare", "unique"] as const) {
    const list = merged[r] ?? [];
    if (
      list.length > 0 &&
      list.every((rule) => LEGACY_TEAM_PRESET_RULE_IDS.has(rule.id))
    ) {
      merged[r] = [];
    }
  }
  return merged;
}

async function loadSettings(): Promise<UserSettings> {
  const raw = await chrome.storage.local.get([
    SETTINGS_KEY,
    LEGACY_SETTINGS_KEY,
    API_KEY_STORAGE,
    COOLDOWN_KEY,
  ]);

  const cooldownUntil = raw[COOLDOWN_KEY] as number | undefined;
  if (typeof cooldownUntil === "number" && cooldownUntil > Date.now()) {
    queue.setCooldown(cooldownUntil);
  }

  let stored = raw[SETTINGS_KEY] as Partial<UserSettings> | undefined;
  if (!stored && raw[LEGACY_SETTINGS_KEY]) {
    const legacy = raw[LEGACY_SETTINGS_KEY] as Partial<UserSettings>;
    stored = {
      username: legacy.username ?? "",
      usernameLockedByUser: legacy.usernameLockedByUser ?? false,
      essenceByRarity: legacy.essenceByRarity,
      currency: legacy.currency ?? "USD",
      selectedRarity: legacy.selectedRarity ?? "limited",
      milestoneRulesByRarity: legacy.milestoneRulesByRarity,
    };
    await chrome.storage.local.set({ [SETTINGS_KEY]: stored });
  }

  // Isolate API key into dedicated storage key never accessed by content scripts
  let isolatedApiKey =
    typeof raw[API_KEY_STORAGE] === "string" ? raw[API_KEY_STORAGE] : "";
  if (stored?.sorareApiKey && typeof stored.sorareApiKey === "string") {
    if (!isolatedApiKey) {
      isolatedApiKey = stored.sorareApiKey;
      await chrome.storage.local.set({ [API_KEY_STORAGE]: isolatedApiKey });
    }
    const { sorareApiKey: _stripped, ...rest } = stored;
    stored = rest;
    await chrome.storage.local.set({ [SETTINGS_KEY]: rest });
  }

  const merged: UserSettings = !stored
    ? { ...DEFAULT_SETTINGS, sorareApiKey: isolatedApiKey }
    : {
        ...DEFAULT_SETTINGS,
        ...stored,
        username:
          typeof stored.username === "string" && isValidUsernameSlug(stored.username)
            ? stored.username.trim().toLowerCase()
            : "",
        sorareApiKey: isolatedApiKey,
        walletBalance: {
          cashAmount: stored.walletBalance?.cashAmount ?? null,
          cashSymbol: stored.walletBalance?.cashSymbol ?? "€",
          ethAmount: stored.walletBalance?.ethAmount ?? null,
          cluesCount: stored.walletBalance?.cluesCount ?? null,
          updatedAt: stored.walletBalance?.updatedAt ?? null,
        },
        autoShowInPageWizards:
          typeof stored.autoShowInPageWizards === "boolean"
            ? stored.autoShowInPageWizards
            : true,
        density: stored.density === "compact" ? "compact" : "cozy",
        watchlist: Array.isArray(stored.watchlist) ? stored.watchlist : [],
        watchlistAlerts: Array.isArray(stored.watchlistAlerts)
          ? stored.watchlistAlerts
          : [],
        essenceByRarity: {
          ...DEFAULT_SETTINGS.essenceByRarity,
          ...(stored.essenceByRarity ?? {}),
        },
        milestoneRulesByRarity: sanitizeMilestoneRulesMap(
          stored.milestoneRulesByRarity,
        ),
      };

  applyNetworkMode(merged);
  return merged;
}

async function saveSettings(
  patch: Partial<UserSettings>,
): Promise<UserSettings> {
  const current = await loadSettings();
  const nextApiKey =
    typeof patch.sorareApiKey === "string"
      ? patch.sorareApiKey.trim()
      : current.sorareApiKey;
  const next: UserSettings = {
    ...current,
    username:
      typeof patch.username === "string"
        ? patch.username.trim().toLowerCase()
        : current.username,
    usernameLockedByUser:
      typeof patch.usernameLockedByUser === "boolean"
        ? patch.usernameLockedByUser
        : current.usernameLockedByUser,
    apiKeyPromptDismissed:
      typeof patch.apiKeyPromptDismissed === "boolean"
        ? patch.apiKeyPromptDismissed
        : current.apiKeyPromptDismissed,
    theme: patch.theme ?? current.theme,
    currency:
      patch.currency === "USD" || patch.currency === "EUR"
        ? patch.currency
        : current.currency,
    selectedRarity:
      patch.selectedRarity ?? current.selectedRarity,
    craftThreshold:
      typeof patch.craftThreshold === "number" && Number.isFinite(patch.craftThreshold)
        ? Math.max(100, patch.craftThreshold)
        : current.craftThreshold,
    inSeasonOnly:
      typeof patch.inSeasonOnly === "boolean"
        ? patch.inSeasonOnly
        : current.inSeasonOnly,
    craftReadyOnly:
      typeof patch.craftReadyOnly === "boolean"
        ? patch.craftReadyOnly
        : current.craftReadyOnly,
    autoOpenOnCraft:
      typeof patch.autoOpenOnCraft === "boolean"
        ? patch.autoOpenOnCraft
        : current.autoOpenOnCraft,
    autoOpenOnSorare:
      typeof patch.autoOpenOnSorare === "boolean"
        ? patch.autoOpenOnSorare
        : current.autoOpenOnSorare,
    autoPriceTopN:
      typeof patch.autoPriceTopN === "number" && Number.isFinite(patch.autoPriceTopN)
        ? Math.max(0, Math.min(10, patch.autoPriceTopN))
        : current.autoPriceTopN,
    projectionSource: patch.projectionSource ?? current.projectionSource,
    customProjectionsRaw:
      typeof patch.customProjectionsRaw === "string"
        ? patch.customProjectionsRaw
        : current.customProjectionsRaw,
    autoShowInPageWizards:
      typeof patch.autoShowInPageWizards === "boolean"
        ? patch.autoShowInPageWizards
        : current.autoShowInPageWizards ?? true,
    density: patch.density ?? current.density ?? "cozy",
    watchlist: Array.isArray(patch.watchlist)
      ? patch.watchlist
      : (current.watchlist ?? []),
    watchlistAlerts: Array.isArray(patch.watchlistAlerts)
      ? patch.watchlistAlerts
      : (current.watchlistAlerts ?? []),
    walletBalance: patch.walletBalance
      ? {
          cashAmount:
            patch.walletBalance.cashAmount ??
            current.walletBalance?.cashAmount ??
            null,
          cashSymbol:
            patch.walletBalance.cashSymbol ??
            current.walletBalance?.cashSymbol ??
            "€",
          ethAmount:
            patch.walletBalance.ethAmount ??
            current.walletBalance?.ethAmount ??
            null,
          cluesCount:
            patch.walletBalance.cluesCount ??
            current.walletBalance?.cluesCount ??
            null,
          updatedAt:
            patch.walletBalance.updatedAt ??
            current.walletBalance?.updatedAt ??
            Date.now(),
        }
      : current.walletBalance,
    sorareApiKey: nextApiKey,
    essenceByRarity: {
      ...current.essenceByRarity,
      ...(patch.essenceByRarity ?? {}),
    },
    milestoneRulesByRarity: {
      ...current.milestoneRulesByRarity,
      ...(patch.milestoneRulesByRarity ?? {}),
    },
    alertsEnabled:
      typeof patch.alertsEnabled === "boolean" ? patch.alertsEnabled : current.alertsEnabled,
    cutoffReminderEnabled:
      typeof patch.cutoffReminderEnabled === "boolean"
        ? patch.cutoffReminderEnabled
        : current.cutoffReminderEnabled,
    cutoffReminderMinutesBefore:
      typeof patch.cutoffReminderMinutesBefore === "number" &&
      Number.isFinite(patch.cutoffReminderMinutesBefore)
        ? Math.max(5, Math.min(240, patch.cutoffReminderMinutesBefore))
        : current.cutoffReminderMinutesBefore,
    alertPreferences: patch.alertPreferences
      ? { ...(current.alertPreferences ?? {}), ...patch.alertPreferences }
      : current.alertPreferences,
  };

  const { sorareApiKey: _omitSecret, ...publicSettings } = next;
  await chrome.storage.local.set({
    [SETTINGS_KEY]: publicSettings,
    [API_KEY_STORAGE]: nextApiKey,
    [CONTENT_FLAGS_KEY]: {
      autoOpenOnCraft: next.autoOpenOnCraft,
      autoOpenOnSorare: next.autoOpenOnSorare,
      autoShowInPageWizards: next.autoShowInPageWizards ?? true,
    },
  });
  applyNetworkMode(next);
  syncAlertTrackerAlarm(next);
  return next;
}

async function assertNoCooldown(): Promise<void> {
  const raw = await chrome.storage.local.get(COOLDOWN_KEY);
  const storedUntil = (raw[COOLDOWN_KEY] as number | undefined) ?? 0;
  const until = Math.max(storedUntil, Date.now() + queue.getCooldownRemainingMs());
  const remaining = until - Date.now();
  if (remaining > 500) {
    const sec = Math.ceil(remaining / 1000);
    throw new Error(
      `Sorare cooldown active (${sec}s remaining) - wait briefly so Sorare doesn't throttle your browser.`,
    );
  }
}

async function recordRateLimitCooldown(retryAfterMs?: number): Promise<void> {
  const until = Date.now() + (retryAfterMs ?? COOLDOWN_429_MS);
  queue.setCooldown(until);
  await chrome.storage.local.set({ [COOLDOWN_KEY]: until });
  cancelActiveScan();
}

function buildScanCacheKey(
  username: string,
  rarity: Rarity,
  currency: Currency,
  inSeasonOnly: boolean,
): string {
  return `scan_v5:${username}:${rarity}:${currency}:${inSeasonOnly ? "inseason" : "all"}`;
}

function pickTopCollectionsToAutoPrice(
  collections: CollectionRaw[],
  limit: number,
): CollectionRaw[] {
  const incomplete = collections.filter((c) => !c.complete);
  return [...incomplete]
    .sort((a, b) => {
      const aStarted = a.fulfilledSlotsCount > 0 ? 0 : 1;
      const bStarted = b.fulfilledSlotsCount > 0 ? 0 : 1;
      if (aStarted !== bStarted) return aStarted - bStarted;
      const aPct = a.slotsCount > 0 ? a.fulfilledSlotsCount / a.slotsCount : 0;
      const bPct = b.slotsCount > 0 ? b.fulfilledSlotsCount / b.slotsCount : 0;
      if (aPct !== bPct) return bPct - aPct;
      return a.slotsCount - b.slotsCount;
    })
    .slice(0, limit);
}

function cancelActiveScan(): void {
  if (currentScanAbort) {
    currentScanAbort.abort();
    currentScanAbort = null;
  }
  queue.clearPending("Superseded or cancelled by user");
}

async function scanUserCollections(
  username: string,
  rarity: Rarity,
  currency: Currency,
  inSeasonOnly: boolean,
  forceRefresh = false,
  cacheOnly = false,
): Promise<ScanResult | null> {
  const cleanUser = username.trim().toLowerCase();
  if (!cleanUser) {
    if (cacheOnly) return null;
    throw new Error("Enter a Sorare username or slug first.");
  }

  const cacheKey = buildScanCacheKey(cleanUser, rarity, currency, inSeasonOnly);
  if (!forceRefresh) {
    const cached = await getCached<ScanResult>(cacheKey);
    if (cached) {
      broadcastProgress({
        phase: "done",
        completed: 1,
        total: 1,
        message: "Loaded from 10-minute cache",
      });
      return { ...cached.value, fromCache: true };
    }
    if (cacheOnly) {
      return null;
    }
  }

  const settings = await loadSettings();
  await assertNoCooldown();

  cancelActiveScan();
  const controller = new AbortController();
  currentScanAbort = controller;
  const signal = controller.signal;

  broadcastProgress({
    phase: "collections",
    completed: 0,
    total: 1,
    message: `${sorareClient.hasApiKey() ? "Fast Mode" : "Safe Mode"}: loading ${inSeasonOnly ? "active-season" : "all-season"} ${rarity.replace("_", " ")} collections...`,
  });

  const missingSlotsByCollection: Record<string, MissingSlot[]> = {};
  let marketPrices: ScanResult["marketPrices"] = {};
  const pricedSlugs = new Set<string>();

  const { collections, cardCounts } = await sorareClient.fetchUserCollections(
    cleanUser,
    rarity,
    inSeasonOnly,
    signal,
    (collectionsSoFar, latestCounts) => {
      broadcastProgress({
        phase: "collections",
        completed: collectionsSoFar.length,
        total: collectionsSoFar.length,
        message: `Loaded ${collectionsSoFar.length} collections...`,
      });
      // Stream partial collection list live to Side Panel after each page!
      broadcastPartialResult({
        username: cleanUser,
        rarity,
        inSeasonOnly,
        cardCounts: latestCounts,
        collections: collectionsSoFar,
        missingSlotsByCollection,
        marketPrices,
        pricedCollectionSlugs: [],
        liveSessionSynced: false,
        fetchedAt: Date.now(),
        fromCache: false,
      });
    },
  );

  const questCards = !signal.aborted
    ? await sorareClient.fetchUserQuestCards(cleanUser, rarity, signal).catch(() => [])
    : [];

  const stage1Result: ScanResult = {
    username: cleanUser,
    rarity,
    inSeasonOnly,
    cardCounts,
    collections,
    missingSlotsByCollection,
    marketPrices,
    pricedCollectionSlugs: [],
    questCards,
    liveSessionSynced: false,
    fetchedAt: Date.now(),
    fromCache: false,
  };
  broadcastPartialResult(stage1Result);

  const topN = Math.max(0, Math.min(5, settings.autoPriceTopN ?? AUTO_PRICE_TOP_N));
  const topTargets =
    topN > 0 ? pickTopCollectionsToAutoPrice(collections, topN) : [];

  if (topTargets.length > 0 && !signal.aborted) {
    const slotsToPrice: MissingSlot[] = [];

    for (let i = 0; i < topTargets.length; i += 1) {
      if (signal.aborted) break;
      const col = topTargets[i];
      broadcastProgress({
        phase: "slots",
        completed: i,
        total: topTargets.length,
        message: `Pricing ${i + 1}/${topTargets.length}: ${col.name}...`,
      });

      const missing = await sorareClient.fetchMissingSlotsForCollection(
        col,
        cleanUser,
        signal,
      );
      missingSlotsByCollection[col.slug] = missing;
      slotsToPrice.push(...missing);
      pricedSlugs.add(col.slug);
    }

    if (slotsToPrice.length > 0 && !signal.aborted) {
      broadcastProgress({
        phase: "market",
        completed: 0,
        total: topTargets.length,
        message: `Fetching live floor prices for ${topTargets.length} collections...`,
      });

      marketPrices = await sorareClient.fetchMarketPricesForMissingSlots(
        slotsToPrice,
        currency,
        signal,
        (done, total) => {
          broadcastProgress({
            phase: "market",
            completed: done,
            total,
            message: `Checking market floors (${done}/${total})...`,
          });
        },
      );
    }
  }

  const finalResult: ScanResult = {
    ...stage1Result,
    missingSlotsByCollection,
    marketPrices,
    pricedCollectionSlugs: Array.from(pricedSlugs),
    fetchedAt: Date.now(),
    fromCache: false,
  };

  if (!signal.aborted) {
    await setCached(cacheKey, finalResult);
    broadcastProgress({
      phase: "done",
      completed: 1,
      total: 1,
      message: "Ready",
    });
  }

  return finalResult;
}

async function priceCollectionsBatch(
  username: string,
  collectionSlugs: string[],
  rarity: Rarity,
  currency: Currency,
  inSeasonOnly: boolean,
): Promise<ScanResult | null> {
  await loadSettings();
  await assertNoCooldown();

  const cleanUser = username.trim().toLowerCase();
  const cacheKey = buildScanCacheKey(cleanUser, rarity, currency, inSeasonOnly);
  const cached = await getCached<ScanResult>(cacheKey);
  if (!cached) return null;

  let current = cached.value;
  const targets = collectionSlugs
    .map((slug) => current.collections.find((c) => c.slug === slug))
    .filter((c): c is CollectionRaw => Boolean(c));

  if (targets.length === 0) return current;

  cancelActiveScan();
  const controller = new AbortController();
  currentScanAbort = controller;
  const signal = controller.signal;

  const newMissingMap = { ...current.missingSlotsByCollection };
  const nextPricedSlugs = new Set(current.pricedCollectionSlugs);
  const newPrices = { ...current.marketPrices };

  const chunkSize = sorareClient.hasApiKey() ? 8 : 5;
  for (let start = 0; start < targets.length; start += chunkSize) {
    if (signal.aborted) break;
    const slice = targets.slice(start, start + chunkSize);
    const chunkSlots: MissingSlot[] = [];

    for (let j = 0; j < slice.length; j += 1) {
      if (signal.aborted) break;
      const col = slice[j];
      const overallIdx = start + j + 1;
      broadcastProgress({
        phase: "slots",
        completed: overallIdx,
        total: targets.length,
        message: `Loading ${col.name} (${overallIdx}/${targets.length})...`,
      });
      const missing = await sorareClient.fetchMissingSlotsForCollection(
        col,
        cleanUser,
        signal,
      );
      newMissingMap[col.slug] = missing;
      chunkSlots.push(...missing);
      nextPricedSlugs.add(col.slug);
    }

    if (chunkSlots.length > 0 && !signal.aborted) {
      broadcastProgress({
        phase: "market",
        completed: Math.min(start + slice.length, targets.length),
        total: targets.length,
        message: `Pricing floors (${Math.min(start + slice.length, targets.length)}/${targets.length} teams)...`,
      });
      const chunkPrices = await sorareClient.fetchMarketPricesForMissingSlots(
        chunkSlots,
        currency,
        signal,
      );
      Object.assign(newPrices, chunkPrices);
    }

    current = {
      ...current,
      missingSlotsByCollection: { ...newMissingMap },
      marketPrices: { ...newPrices },
      pricedCollectionSlugs: Array.from(nextPricedSlugs),
      fromCache: false,
    };
    await setCached(cacheKey, current);
    broadcastPartialResult(current);
  }

  if (!signal.aborted) {
    broadcastProgress({
      phase: "done",
      completed: 1,
      total: 1,
      message: `Priced ${nextPricedSlugs.size} collections`,
    });
  }
  return current;
}

async function fetchCraftPoolResult(
  rarity: Rarity,
  currency: Currency,
  forceRefresh = false,
): Promise<CraftPoolResult> {
  const cacheKey = `craft_pool_v1:${rarity}:${currency}`;
  if (!forceRefresh) {
    const cached = await getCached<CraftPoolResult>(cacheKey);
    if (cached) {
      return { ...cached.value, fromCache: true };
    }
  }

  await loadSettings();
  await assertNoCooldown();

  cancelActiveScan();
  const controller = new AbortController();
  currentScanAbort = controller;

  broadcastProgress({
    phase: "market",
    completed: 0,
    total: 6,
    message: `Loading live ${rarity.replace("_", " ")} NBA crafting pool...`,
  });

  const { computedAt, players } = await sorareClient.fetchCraftPool(
    rarity,
    controller.signal,
    (done, total, tier) => {
      broadcastProgress({
        phase: "market",
        completed: done,
        total,
        message: `Loading craft pool (${tier.replace("_", " ")} • ${done}/${total})...`,
      });
    },
  );

  const result: CraftPoolResult = {
    rarity,
    currency,
    computedAt,
    players,
    pricedSlugs: [],
    fetchedAt: Date.now(),
    fromCache: false,
  };

  if (!controller.signal.aborted) {
    await setCached(cacheKey, result);
    broadcastProgress({
      phase: "done",
      completed: 1,
      total: 1,
      message: "Craft pool ready",
    });
  }

  return result;
}

async function priceCraftCandidates(
  rarity: Rarity,
  currency: Currency,
  playerSlugs: string[],
): Promise<CraftPoolResult | null> {
  await loadSettings();
  await assertNoCooldown();

  const cacheKey = `craft_pool_v1:${rarity}:${currency}`;
  const cached = await getCached<CraftPoolResult>(cacheKey);
  if (!cached) return null;

  const existing = cached.value;
  const targetSet = new Set(playerSlugs);
  const targets = existing.players
    .filter((p) => targetSet.has(p.playerSlug))
    .slice(0, 10);

  if (targets.length === 0) return existing;

  broadcastProgress({
    phase: "market",
    completed: 0,
    total: targets.length,
    message: `Fetching live floor prices for top ${targets.length} craft pulls...`,
  });

  const floors = await sorareClient.priceCraftPlayers(
    targets,
    rarity,
    currency,
  );

  const updatedPlayers = existing.players.map((p) => {
    const hit = floors[p.playerSlug];
    if (!hit) return p;
    return {
      ...p,
      floorCents: hit.floorCents,
      floorCardSlug: hit.floorCardSlug,
      marketUrl: hit.floorCardSlug
        ? `${SORARE_NBA_CARD_URL}/${hit.floorCardSlug}`
        : p.marketUrl,
    };
  });

  const merged: CraftPoolResult = {
    ...existing,
    players: updatedPlayers,
    pricedSlugs: Array.from(
      new Set([...existing.pricedSlugs, ...Object.keys(floors)]),
    ),
    fromCache: false,
  };

  await setCached(cacheKey, merged);
  broadcastProgress({
    phase: "done",
    completed: 1,
    total: 1,
    message: "Craft prices updated",
  });
  return merged;
}

function mergeCurrentLineups(
  apiLineups: CurrentLineupEntry[],
  domLineups: CurrentLineupEntry[],
  openFixtureSlug: string | null = null,
): CurrentLineupEntry[] {
  // Page captures from a Game Week that is no longer open are finished lineups: drop them.
  const current = openFixtureSlug
    ? domLineups.filter((l) => !l.fixtureSlug || l.fixtureSlug === openFixtureSlug)
    : domLineups;
  return mergeApiAndDomLineups(apiLineups, current, "load");
}

async function readStoredDomLineups(): Promise<CurrentLineupEntry[]> {
  try {
    const raw = await chrome.storage.local.get(DETECTED_LINEUPS_KEY);
    const list = raw[DETECTED_LINEUPS_KEY];
    if (!Array.isArray(list)) return [];
    return list as CurrentLineupEntry[];
  } catch {
    return [];
  }
}

async function fetchGalleryForLineups(
  username: string,
  forceRefresh = false,
  cacheOnly = false,
): Promise<GalleryResult | null> {
  const cleanUser = username.trim().toLowerCase();
  if (!cleanUser) {
    if (cacheOnly) return null;
    throw new Error("Enter a Sorare username or slug first.");
  }

  const cacheKey = `gallery_v6:${cleanUser}`;
  if (!forceRefresh) {
    const cached = await getCached<GalleryResult>(cacheKey);
    if (cached) {
      void syncOverlayLookup(cached.value.cards);
      const domLineups = await readStoredDomLineups();
      return {
        ...cached.value,
        currentLineups: mergeCurrentLineups(
          cached.value.currentLineups ?? [],
          domLineups,
        ),
        fromCache: true,
      };
    }
    if (cacheOnly) {
      return null;
    }
  }

  await loadSettings();
  await assertNoCooldown();

  cancelActiveScan();
  const controller = new AbortController();
  currentScanAbort = controller;

  broadcastProgress({
    phase: "collections",
    completed: 0,
    total: 2,
    message: `Loading ${cleanUser}'s NBA gallery (Pro + Common), live cutoffs & ESPN injuries...`,
  });

  const [
    { cards, commonCards, fixtures, currentLineups, leaderboardBenchmarks },
    domLineups,
  ] = await Promise.all([
    sorareClient.fetchUserGalleryAndFixtures(cleanUser, controller.signal),
    readStoredDomLineups(),
  ]);
  // Count ESPN games inside the opened Game Week (cutoff -> end), not a rolling window.
  const openGw = selectOpenGameWeek(fixtures, Date.now());
  const external = await fetchExternalNbaContext(
    openGw ? { startIso: openGw.fixture.cutOffDate, endIso: openGw.fixture.endDate } : null,
  );

  const result: GalleryResult = {
    username: cleanUser,
    cards,
    commonCards,
    fixtures,
    currentLineups: mergeCurrentLineups(currentLineups, domLineups, openGw?.fixture.slug ?? null),
    leaderboardBenchmarks,
    injuriesByName: external.injuriesByName,
    gamesPerTeam: external.gamesPerTeam,
    scheduleByTeam: external.scheduleByTeam,
    fetchedAt: Date.now(),
    fromCache: false,
  };

  if (!controller.signal.aborted) {
    // Fresh API lineups supersede stored page captures (they may predate edits made
    // while the panel was closed); later page syncs start from a clean slate.
    if (currentLineups.some((l) => l.source !== "dom")) {
      await chrome.storage.local.set({ [DETECTED_LINEUPS_KEY]: [] });
    }
    await setCached(cacheKey, result);
    await saveAlertSnapshot({
      cards: result.cards,
      currentLineups: result.currentLineups,
      fixtures: result.fixtures,
      currency: (await loadSettings()).currency,
      injuriesByName: result.injuriesByName,
    });
    await syncOverlayLookup(result.cards);
    broadcastProgress({
      phase: "done",
      completed: 1,
      total: 1,
      message: "Lineup data ready",
    });
  }

  return result;
}

async function syncOverlayLookup(cards: GalleryCard[]): Promise<void> {
  try {
    const ownedPlayerSlugs = [...new Set(cards.map((c) => c.playerSlug))];
    const firstOwnerPlayerSlugs = [
      ...new Set(cards.filter((c) => c.isFirstOwner).map((c) => c.playerSlug)),
    ];
    const hotByPlayerSlug: Record<string, string> = {};
    for (const c of cards) {
      if (hotByPlayerSlug[c.playerSlug]) continue;
      const shift = evaluateStarTierShift(c.l10, c.l5);
      if (shift.direction === "value_lock" && shift.label) {
        hotByPlayerSlug[c.playerSlug] = shift.label;
      } else if (c.l5 !== null && c.l10 !== null && c.l5 - c.l10 >= 3.5) {
        hotByPlayerSlug[c.playerSlug] = `+${(c.l5 - c.l10).toFixed(1)} 🔥`;
      }
    }
    await chrome.storage.local.set({
      [OVERLAY_LOOKUP_KEY]: {
        ownedPlayerSlugs,
        firstOwnerPlayerSlugs,
        hotByPlayerSlug,
        updatedAt: Date.now(),
      },
    });
  } catch {
    // Ignore storage quota issues
  }
}

function doesListingMatchRule(
  listing: BargainListing,
  rule: WatchlistEntry,
): boolean {
  if (listing.priceCents === null || listing.priceCents > rule.maxPriceCents) {
    return false;
  }
  if (rule.firstOwnerOnly && !listing.isFirstOwnerEligible) {
    return false;
  }
  switch (rule.kind) {
    case "player":
      return listing.playerSlug === rule.playerSlug;
    case "quest_draft_26":
      return Boolean(
        listing.isFirstOwnerEligible &&
          (listing.cardEditionName === "rookie" ||
            NBA_26_DRAFT_TOP_30_SLUGS.has(listing.playerSlug)),
      );
    case "quest_non_playoffs":
      return Boolean(
        listing.isFirstOwnerEligible &&
          listing.questLabels?.includes("26' Non-Playoffs"),
      );
    case "quest_conf_finals":
      return Boolean(
        listing.isFirstOwnerEligible &&
          listing.questLabels?.includes("26' Conf Finals"),
      );
    case "any_first_owner":
      return Boolean(listing.isFirstOwnerEligible);
    default:
      return false;
  }
}

async function runWatchlistCheck(forceRefresh = false): Promise<WatchlistAlert[]> {
  try {
    const settings = await loadSettings();
    const rules = settings.watchlist ?? [];
    if (rules.length === 0) {
      if (chrome.action?.setBadgeText) {
        await chrome.action.setBadgeText({ text: "" });
      }
      if ((settings.watchlistAlerts?.length ?? 0) > 0) {
        await saveSettings({ watchlistAlerts: [] });
        broadcastMessage({ type: "WATCHLIST_ALERTS_UPDATED", alerts: [] });
      }
      return [];
    }

    const rarities = [...new Set(rules.map((r) => r.rarity))];
    const allListings: BargainListing[] = [];
    for (const r of rarities) {
      const instant = await fetchBargainsResult(
        r,
        "primary_instant",
        settings.currency,
        forceRefresh,
        false,
      );
      if (instant?.listings) allListings.push(...instant.listings);
      const auctions = await fetchBargainsResult(
        r,
        "ending_auctions",
        settings.currency,
        forceRefresh,
        false,
      );
      if (auctions?.listings) allListings.push(...auctions.listings);
    }

    const byCard = new Map<string, WatchlistAlert>();
    const now = Date.now();
    for (const listing of allListings) {
      for (const rule of rules) {
        if (listing.rarity !== rule.rarity) continue;
        if (!doesListingMatchRule(listing, rule)) continue;
        if (listing.priceCents === null) continue;
        if (byCard.has(listing.cardSlug)) continue;
        byCard.set(listing.cardSlug, {
          id: `${rule.id}:${listing.cardSlug}`,
          ruleId: rule.id,
          ruleLabel: rule.label,
          cardSlug: listing.cardSlug,
          playerSlug: listing.playerSlug,
          playerName: listing.playerName,
          rarity: listing.rarity,
          priceCents: listing.priceCents,
          currency: listing.currency,
          saleType: listing.saleType,
          isPrimaryOffer: Boolean(listing.isPrimaryOffer),
          marketUrl: listing.marketUrl,
          detectedAt: now,
        });
      }
    }

    const alerts = [...byCard.values()]
      .sort((a, b) => a.priceCents - b.priceCents)
      .slice(0, 15);

    await saveSettings({ watchlistAlerts: alerts });
    if (chrome.action?.setBadgeText) {
      await chrome.action.setBadgeText({
        text: alerts.length > 0 ? String(alerts.length) : "",
      });
    }
    if (chrome.action?.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    }
    broadcastMessage({ type: "WATCHLIST_ALERTS_UPDATED", alerts });
    return alerts;
  } catch {
    return [];
  }
}

async function fetchBargainsResult(
  rarity: Rarity,
  mode: BargainMode,
  currency: Currency,
  forceRefresh = false,
  cacheOnly = false,
): Promise<BargainsResult | null> {
  const cacheKey = `bargains_v6:${rarity}:${mode}:${currency}`;
  if (!forceRefresh) {
    const cached = await getCached<BargainsResult>(cacheKey);
    if (cached) {
      return { ...cached.value, fromCache: true };
    }
    if (cacheOnly) {
      return null;
    }
  }

  await loadSettings();
  await assertNoCooldown();

  cancelActiveScan();
  const controller = new AbortController();
  currentScanAbort = controller;

  broadcastProgress({
    phase: "market",
    completed: 0,
    total: 1,
    message: `Scanning NBA ${rarity} marketplace for ${
      mode === "ending_auctions"
        ? "1st-owner & ending auctions"
        : mode === "primary_instant"
          ? "Sorare 1st-owner Instant Buys"
          : "underpriced deals"
    }...`,
  });

  const listings = await sorareClient.fetchNbaBargains(
    rarity,
    mode,
    currency,
    controller.signal,
  );

  const result: BargainsResult = {
    rarity,
    mode,
    currency,
    listings,
    fetchedAt: Date.now(),
    fromCache: false,
  };

  if (!controller.signal.aborted) {
    await setCached(cacheKey, result);
    broadcastProgress({
      phase: "done",
      completed: 1,
      total: 1,
      message: `Found ${listings.length} deals`,
    });
  }

  return result;
}

async function handleMessage(
  msg: BackgroundRequest,
): Promise<BackgroundResponse<unknown>> {
  try {
    switch (msg.type) {
      case "GET_SETTINGS": {
        const settings = await loadSettings();
        return { ok: true, data: settings };
      }
      case "SAVE_SETTINGS": {
        const settings = await saveSettings(msg.settings);
        return { ok: true, data: settings };
      }
      case "GET_DETECTED_USERNAME": {
        const raw = await chrome.storage.local.get(DETECTED_USER_KEY);
        const val = typeof raw[DETECTED_USER_KEY] === "string" ? raw[DETECTED_USER_KEY] : "";
        if (val && !isValidUsernameSlug(val)) {
          await chrome.storage.local.remove(DETECTED_USER_KEY);
          return { ok: true, data: null };
        }
        return { ok: true, data: val || null };
      }
      case "DETECTED_USERNAME_FROM_CONTENT": {
        const slug =
          typeof msg.username === "string"
            ? msg.username.trim().toLowerCase()
            : "";
        if (isValidUsernameSlug(slug)) {
          await chrome.storage.local.set({ [DETECTED_USER_KEY]: slug });
          const current = await loadSettings();
          if (!current.usernameLockedByUser && !current.username) {
            await saveSettings({ username: slug });
          }
          return { ok: true, data: slug };
        }
        return { ok: true, data: "" };
      }
      case "SORARE_PAGE_CONTEXT": {
        if (typeof msg.username === "string") {
          const slug = msg.username.trim().toLowerCase();
          if (isValidUsernameSlug(slug)) {
            await chrome.storage.local.set({ [DETECTED_USER_KEY]: slug });
          }
        }
        if (msg.isCraftPage === true) {
          await chrome.storage.local.set({ [PENDING_TAB_KEY]: "craft" });
          broadcastMessage({ type: "SWITCH_TAB", tab: "craft" });
        }
        return { ok: true, data: true };
      }
      case "DETECTED_WALLET_FROM_CONTENT": {
        const incoming = msg.wallet ?? {};
        const current = await loadSettings();
        const prev = current.walletBalance ?? DEFAULT_SETTINGS.walletBalance!;
        const nextWallet = {
          cashAmount:
            typeof incoming.cashAmount === "number" && Number.isFinite(incoming.cashAmount)
              ? incoming.cashAmount
              : prev.cashAmount,
          cashSymbol:
            typeof incoming.cashSymbol === "string" && incoming.cashSymbol
              ? incoming.cashSymbol
              : prev.cashSymbol,
          ethAmount:
            typeof incoming.ethAmount === "number" && Number.isFinite(incoming.ethAmount)
              ? incoming.ethAmount
              : prev.ethAmount,
          cluesCount:
            typeof incoming.cluesCount === "number" && Number.isFinite(incoming.cluesCount)
              ? incoming.cluesCount
              : prev.cluesCount,
          updatedAt: Date.now(),
        };
        const changed =
          nextWallet.cashAmount !== prev.cashAmount ||
          nextWallet.cashSymbol !== prev.cashSymbol ||
          nextWallet.ethAmount !== prev.ethAmount ||
          nextWallet.cluesCount !== prev.cluesCount;
        if (changed) {
          await saveSettings({ walletBalance: nextWallet });
          broadcastMessage({
            type: "WALLET_UPDATED",
            walletBalance: nextWallet,
          });
        }
        return { ok: true, data: nextWallet };
      }
      case "DETECTED_ESSENCE_FROM_CONTENT": {
        const current = await loadSettings();
        const incoming = msg.balances ?? {};
        const nextBalances = { ...current.essenceByRarity };
        let changed = false;
        for (const key of ["limited", "rare", "super_rare", "unique"] as const) {
          const val = incoming[key];
          if (
            typeof val === "number" &&
            Number.isFinite(val) &&
            val > 0 &&
            val <= 50000
          ) {
            if (nextBalances[key] !== val) {
              nextBalances[key] = val;
              changed = true;
            }
          }
        }
        if (changed) {
          await saveSettings({ essenceByRarity: nextBalances });
          broadcastMessage({
            type: "ESSENCE_UPDATED",
            essenceByRarity: nextBalances,
          });
        }
        return { ok: true, data: nextBalances };
      }
      case "DETECTED_LINEUPS_FROM_CONTENT": {
        const rawList = Array.isArray(msg.lineups) ? msg.lineups : [];
        const sanitized: CurrentLineupEntry[] = rawList
          .slice(0, 12)
          .filter(
            (item): item is CurrentLineupEntry =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof item.id === "string" &&
              typeof item.leaderboardName === "string",
          )
          .map((item) => ({
            id: item.id.slice(0, 80),
            name: String(item.name || item.leaderboardName).slice(0, 60),
            leaderboardSlug: String(item.leaderboardSlug || "").slice(0, 80),
            leaderboardName: String(item.leaderboardName).slice(0, 60),
            draft: Boolean(item.draft),
            cardSlugs: Array.isArray(item.cardSlugs)
              ? item.cardSlugs
                  .filter((s): s is string => typeof s === "string" && s.length > 0)
                  .slice(0, 5)
              : [],
            playerNames: Array.isArray(item.playerNames)
              ? item.playerNames
                  .filter((n): n is string => typeof n === "string" && n.length > 0)
                  .slice(0, 5)
              : [],
            captainCardSlug:
              typeof item.captainCardSlug === "string" ? item.captainCardSlug : null,
            source: "dom",
            contestKind:
              item.contestKind === "arena" || item.contestKind === "pro"
                ? item.contestKind
                : undefined,
            seasonScope:
              item.seasonScope === "in_season" || item.seasonScope === "classic"
                ? item.seasonScope
                : undefined,
            starCap:
              typeof item.starCap === "number" && item.starCap > 0 && item.starCap <= 40
                ? item.starCap
                : null,
            fixtureSlug:
              typeof item.fixtureSlug === "string" ? item.fixtureSlug.slice(0, 80) : null,
            sorareLineupId:
              typeof item.sorareLineupId === "string"
                ? item.sorareLineupId.slice(0, 64)
                : null,
            detectedAt: Date.now(),
          }));

        if (sanitized.length > 0) {
          const merged = upsertDomLineups(
            await readStoredDomLineups(),
            sanitized,
            msg.partial === true,
          );
          await chrome.storage.local.set({ [DETECTED_LINEUPS_KEY]: merged });
          broadcastMessage({
            type: "DETECTED_LINEUPS_UPDATED",
            lineups: merged,
          });
          return { ok: true, data: merged };
        }
        return { ok: true, data: sanitized };
      }
      case "SCAN_COLLECTIONS": {
        const result = await scanUserCollections(
          msg.username,
          msg.rarity,
          msg.currency,
          msg.inSeasonOnly,
          msg.forceRefresh,
          msg.cacheOnly,
        );
        return { ok: true, data: result };
      }
      case "PRICE_COLLECTION": {
        const result = await priceCollectionsBatch(
          msg.username,
          [msg.collectionSlug],
          msg.rarity,
          msg.currency,
          msg.inSeasonOnly,
        );
        return { ok: true, data: result };
      }
      case "PRICE_TOP_COLLECTIONS": {
        const result = await priceCollectionsBatch(
          msg.username,
          Array.isArray(msg.collectionSlugs)
            ? msg.collectionSlugs.slice(0, 60)
            : [],
          msg.rarity,
          msg.currency,
          msg.inSeasonOnly,
        );
        return { ok: true, data: result };
      }
      case "FETCH_CRAFT_POOL": {
        const result = await fetchCraftPoolResult(
          msg.rarity,
          msg.currency,
          msg.forceRefresh,
        );
        return { ok: true, data: result };
      }
      case "PRICE_CRAFT_CANDIDATES": {
        const result = await priceCraftCandidates(
          msg.rarity,
          msg.currency,
          msg.playerSlugs,
        );
        return { ok: true, data: result };
      }
      case "FETCH_GALLERY_FOR_LINEUPS": {
        const result = await fetchGalleryForLineups(
          msg.username,
          msg.forceRefresh,
          msg.cacheOnly,
        );
        return { ok: true, data: result };
      }
      case "FETCH_BARGAINS": {
        const result = await fetchBargainsResult(
          msg.rarity,
          msg.mode,
          msg.currency,
          msg.forceRefresh,
          msg.cacheOnly,
        );
        return { ok: true, data: result };
      }
      case "PRICE_GALLERY_CARDS": {
        const cleanUser = msg.username.trim().toLowerCase();
        if (!cleanUser) {
          throw new Error("Enter a Sorare username or slug first.");
        }
        const gallery =
          (await fetchGalleryForLineups(cleanUser, false, true)) ??
          (await fetchGalleryForLineups(cleanUser, false, false));
        if (!gallery) {
          throw new Error("No gallery data found.");
        }
        await loadSettings();
        await assertNoCooldown();
        cancelActiveScan();
        const controller = new AbortController();
        currentScanAbort = controller;

        broadcastProgress({
          phase: "market",
          completed: 0,
          total: 1,
          message: `Pricing ${cleanUser}'s ${msg.rarity} cards (lowest floor & active auctions)...`,
        });

        const priceMap = await sorareClient.priceGalleryCards(
          gallery.cards,
          msg.rarity,
          msg.currency,
          controller.signal,
        );

        const updatedCards = gallery.cards.map((card) => {
          if (card.rarity !== msg.rarity) return card;
          const exactKey = buildMarketPriceKey(
            card.playerSlug,
            msg.rarity,
            card.seasonYear,
          );
          const anyKey = buildMarketPriceKey(card.playerSlug, msg.rarity, null);
          const mp = priceMap[exactKey] ?? priceMap[anyKey];
          if (!mp) return card;
          return {
            ...card,
            lowestAskCents: mp.instantBuyCents ?? card.lowestAskCents ?? null,
            lowestAskCardSlug:
              mp.instantBuyCardSlug ?? card.lowestAskCardSlug ?? null,
            auctionBidCents: mp.auctionBidCents ?? card.auctionBidCents ?? null,
          };
        });

        const updatedGallery: GalleryResult = {
          ...gallery,
          cards: updatedCards,
          fetchedAt: Date.now(),
          fromCache: false,
        };
        if (!controller.signal.aborted) {
          await setCached(`gallery_v6:${cleanUser}`, updatedGallery);
          broadcastProgress({
            phase: "done",
            completed: 1,
            total: 1,
            message: "Gallery floor asks updated",
          });
        }
        return { ok: true, data: updatedGallery };
      }
      case "APPLY_LINEUP_HIGHLIGHT": {
        const targetUrl = msg.targetUrl?.trim() || undefined;
        if (targetUrl !== undefined && !isVerifiedSorareNavUrl(targetUrl)) {
          return { ok: false, error: "Blocked disallowed highlight target." };
        }
        const autoHighlightFirst = Boolean(msg.autoHighlightFirst);
        await chrome.storage.local.set({
          [PENDING_LINEUP_HUD_KEY]: {
            playerNames: msg.playerNames,
            slots: msg.slots,
            formatLabel: msg.formatLabel,
            projectedTotal: msg.projectedTotal,
            autoHighlightFirst,
            createdAt: Date.now(),
          },
        });
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const activeTab = tabs[0];
        if (activeTab?.id !== undefined) {
          const onSorare = isAllowedSorareUrl(activeTab.url);
          const needsTargetNav =
            targetUrl !== undefined && !isSameNavTarget(activeTab.url, targetUrl);
          if (!onSorare || needsTargetNav) {
            // Leave the pending HUD staged; the destination page's content script picks it up.
            await chrome.tabs.update(activeTab.id, {
              url: targetUrl ?? buildProPlayUrl(),
            });
          } else {
            await chrome.storage.local.remove(PENDING_LINEUP_HUD_KEY);
            void chrome.tabs
              .sendMessage(activeTab.id, {
                type: "SHOW_LINEUP_CHECKLIST",
                playerNames: msg.playerNames,
                slots: msg.slots,
                formatLabel: msg.formatLabel,
                projectedTotal: msg.projectedTotal,
                autoHighlightFirst,
              })
              .catch(() => {});
          }
        }
        return { ok: true, data: true };
      }
      case "OPEN_DASHBOARD_TAB": {
        const dashUrl = chrome.runtime.getURL(
          `sidepanel.html?view=dashboard${msg.targetTab ? `&tab=${encodeURIComponent(msg.targetTab)}` : ""}`,
        );
        await chrome.tabs.create({ url: dashUrl });
        return { ok: true, data: true };
      }
      case "CANCEL_SCAN": {
        cancelActiveScan();
        broadcastProgress({
          phase: "idle",
          completed: 0,
          total: 0,
          message: "Scan cancelled",
        });
        return { ok: true, data: true };
      }
      case "RELOAD_EXTENSION": {
        chrome.runtime.reload();
        return { ok: true, data: true };
      }
      case "OPEN_URL_IN_ACTIVE_TAB": {
        if (!isAllowedNavTargetUrl(msg.url)) {
          return { ok: false, error: "Blocked disallowed navigation target." };
        }
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const activeTab = tabs[0];
        if (activeTab?.id !== undefined) {
          await chrome.tabs.update(activeTab.id, { url: msg.url });
        } else {
          await chrome.tabs.create({ url: msg.url });
        }
        return { ok: true, data: true };
      }
      case "CLEAR_CACHE": {
        await clearAllCache();
        return { ok: true, data: true };
      }
      case "RUN_WATCHLIST_CHECK": {
        const alerts = await runWatchlistCheck(true);
        return { ok: true, data: alerts };
      }
      case "RUN_ALERT_CHECK": {
        const events = await runAlertTrackerFromStorage();
        return { ok: true, data: events };
      }
      case "SEND_TEST_ALERT_NOTIFICATION": {
        const sent = await sendTestAlertNotification(await loadSettings());
        return { ok: true, data: sent };
      }
      case "GET_ALERT_FEED": {
        return { ok: true, data: await getAlertFeed() };
      }
      case "SCAN_SQUAD_ACTIVITY": {
        return { ok: true, data: await scanSquadFromOpenTab() };
      }
      case "GET_SQUAD_SNAPSHOT": {
        return { ok: true, data: await getSavedSquadSnapshot() };
      }
      case "GET_DAILY_PICKER_POOL": {
        // Load settings first: after a service-worker restart the API key is not applied yet.
        await loadSettings();
        const now = Date.now();
        const window = selectDailyPickerWindow(await fetchDailySlateGames(now, Boolean(msg.refresh)), now);
        const roster = await sorareClient
          .fetchTeamRosterCards(window.teamSlugs)
          .catch((err: unknown) => ({
            cards: [] as GalleryCard[],
            teamsLoaded: 0,
            teamsRequested: window.teamSlugs.length,
            error: err instanceof Error ? err.message : String(err),
          }));
        const statsByName = await fetchPlayerSeasonStats().catch(() => ({}));
        const pool: DailyPickerPool = {
          window,
          rosterCards: roster.cards,
          statsByName,
          fetchedAt: now,
          rosterTeamsLoaded: roster.teamsLoaded,
          rosterTeamsRequested: roster.teamsRequested,
          rosterError: roster.error,
        };
        return { ok: true, data: pool };
      }
      case "CLEAR_WATCHLIST_ALERTS": {
        await saveSettings({ watchlistAlerts: [] });
        if (chrome.action?.setBadgeText) {
          await chrome.action.setBadgeText({ text: "" });
        }
        broadcastMessage({ type: "WATCHLIST_ALERTS_UPDATED", alerts: [] });
        return { ok: true, data: true };
      }
      default:
        return { ok: false, error: "Unknown request type" };
    }
  } catch (err) {
    if (err instanceof RateLimitedError && err.status === 429) {
      await recordRateLimitCooldown(err.retryAfterMs);
    }
    if (
      err instanceof ScanCancelledError ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      return { ok: false, error: "Scan cancelled." };
    }
    const message = err instanceof Error ? err.message : String(err);
    broadcastProgress({
      phase: "error",
      completed: 0,
      total: 1,
      message,
    });
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    !message ||
    typeof message !== "object" ||
    typeof (message as { type?: unknown }).type !== "string"
  ) {
    sendResponse({ ok: false, error: "Malformed request." });
    return false;
  }

  const req = message as BackgroundRequest;
  const fromExtension = isExtensionPageSender(sender);
  const fromSorareContent =
    sender.id === chrome.runtime.id &&
    Boolean(sender.tab) &&
    isAllowedSorareUrl(sender.url ?? sender.tab?.url) &&
    CONTENT_ALLOWED_TYPES.has(req.type);

  if (!fromExtension && !fromSorareContent) {
    sendResponse({ ok: false, error: "Unauthorized sender." });
    return false;
  }

  // Open Side Panel synchronously on message receipt before any `await` so Chrome preserves the user gesture token
  if (req.type === "OPEN_SIDE_PANEL") {
    if (req.targetTab) {
      void chrome.storage.local.set({ [PENDING_TAB_KEY]: req.targetTab });
      broadcastMessage({ type: "SWITCH_TAB", tab: req.targetTab });
    }
    if (sender.tab?.id !== undefined) {
      chrome.sidePanel
        .open({ tabId: sender.tab.id })
        .then(() => sendResponse({ ok: true, data: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (sender.tab?.windowId !== undefined) {
      chrome.sidePanel
        .open({ windowId: sender.tab.windowId })
        .then(() => sendResponse({ ok: true, data: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    sendResponse({
      ok: false,
      error: "No active tab found for sidePanel.open",
    });
    return false;
  }

  void handleMessage(req)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  return true;
});

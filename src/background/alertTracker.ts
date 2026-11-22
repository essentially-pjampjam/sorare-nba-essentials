import { evaluateAlertEvents } from "../calculators/alertTrackerMath";
import { mergeApiAndDomLineups } from "../shared/domLineupMerge";
import type {
  AlertPreferences,
  AlertTrackerConfig,
  CurrentLineupEntry,
  GalleryCard,
  InjuryReportEntry,
  PriceBaselineRecord,
  So5FixtureSummary,
  TrackedAlertEvent,
  UserSettings,
} from "../shared/types";
import { getSavedPageLineups, openPageLineupsAsEntries } from "./lineupScanner";

/** Alarm that runs the alert & price tracker (cutoff / daily reset reminders, surges, injuries). */
export const ALERT_TRACKER_ALARM_NAME = "jamassist-alert-tracker";
/** Used instead of the tracker alarm when only the GW cutoff reminder is on. */
export const CUTOFF_REMINDER_ALARM_NAME = "jamassist-cutoff-reminder";
const ALERT_TRACKER_PERIOD_MINUTES = 15;
const STATE_KEY = "jamassist_alert_tracker_state_v1";
const SNAPSHOT_KEY = "jamassist_alert_tracker_snapshot_v1";
const FEED_LIMIT = 50;

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  priceSurgeEnabled: true,
  priceSurgePctThreshold: 25,
  injuryRiskEnabled: true,
  injuryLineupsOnly: false,
  bargainAlertEnabled: true,
  cutoffAlertEnabled: true,
  dailyResetAlertEnabled: true,
  browserNotificationsEnabled: true,
  cooldownMinutes: 60,
};

interface TrackerState {
  baselines: Record<string, PriceBaselineRecord>;
  lastAlertAtByKey: Record<string, number>;
  previousInjuriesByName: Record<string, InjuryReportEntry>;
  feed: TrackedAlertEvent[];
  /** notificationId -> URL opened on click. */
  clickTargets: Record<string, string>;
}

interface TrackerSnapshot {
  cards: GalleryCard[];
  currentLineups: CurrentLineupEntry[];
  fixtures: So5FixtureSummary[];
  currency: "EUR" | "USD";
  /** ESPN injuries from the same gallery load. */
  injuriesByName?: Record<string, InjuryReportEntry>;
  /** Team slug -> games count in the active Game Week slate. */
  gamesPerTeam?: Record<string, number>;
}

function emptyState(): TrackerState {
  return { baselines: {}, lastAlertAtByKey: {}, previousInjuriesByName: {}, feed: [], clickTargets: {} };
}

async function readState(): Promise<TrackerState> {
  const raw = await chrome.storage.local.get(STATE_KEY);
  const s = raw[STATE_KEY] as Partial<TrackerState> | undefined;
  return { ...emptyState(), ...(s ?? {}) };
}

async function writeState(state: TrackerState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

/** Called after every gallery load so the alarm never needs its own Sorare API calls. */
export async function saveAlertSnapshot(snapshot: TrackerSnapshot): Promise<void> {
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
}

interface CachedGalleryLike {
  cards?: GalleryCard[];
  currentLineups?: CurrentLineupEntry[];
  fixtures?: So5FixtureSummary[];
  injuriesByName?: Record<string, InjuryReportEntry>;
  gamesPerTeam?: Record<string, number>;
}

/** Last snapshot, else the last cached gallery for the user (expired TTL is fine here), merged with live page-synced lineups. */
async function readSnapshot(username: string, currency: "EUR" | "USD"): Promise<TrackerSnapshot | null> {
  const galleryKeys = username
    ? [`jamassist_cache:gallery_v7:${username}`, `gallery_v7:${username}`]
    : [];
  const [raw, pageSnap] = await Promise.all([
    chrome.storage.local.get([SNAPSHOT_KEY, ...galleryKeys]),
    getSavedPageLineups(username || undefined),
  ]);
  const pageEntries = openPageLineupsAsEntries(pageSnap);
  const pageFixtures: So5FixtureSummary[] = [];
  if (pageSnap) {
    const seenFixtures = new Set<string>();
    for (const l of pageSnap.lineups) {
      if (l.fixtureState === "opened" && l.cutOffDate) {
        const fSlug = l.fixtureSlug || "page-open-gw";
        if (seenFixtures.has(fSlug)) continue;
        seenFixtures.add(fSlug);
        pageFixtures.push({
          slug: fSlug,
          displayName: l.fixtureName || "Open Game Week",
          aasmState: "opened",
          cutOffDate: l.cutOffDate,
          endDate: l.endDate ?? l.cutOffDate,
        });
      }
    }
  }

  let base: TrackerSnapshot | null = (raw[SNAPSHOT_KEY] as TrackerSnapshot | undefined) ?? null;
  if (!base) {
    for (const key of galleryKeys) {
      const envelope = raw[key] as { value?: CachedGalleryLike } | undefined;
      const g = envelope?.value;
      if (g?.cards) {
        base = {
          cards: g.cards,
          currentLineups: g.currentLineups ?? [],
          fixtures: g.fixtures ?? [],
          currency,
          injuriesByName: g.injuriesByName,
          gamesPerTeam: g.gamesPerTeam,
        };
        break;
      }
    }
  }

  if (base) {
    return {
      ...base,
      currentLineups:
        pageEntries.length > 0
          ? mergeApiAndDomLineups(base.currentLineups, pageEntries, "live")
          : base.currentLineups,
      fixtures: base.fixtures.length > 0 ? base.fixtures : pageFixtures,
    };
  }

  if (pageEntries.length > 0 || pageFixtures.length > 0) {
    return {
      cards: [],
      currentLineups: pageEntries,
      fixtures: pageFixtures,
      currency,
    };
  }

  return null;
}

/** Effective config: the cutoff reminder works even with the full tracker switched off. */
export function buildTrackerConfig(settings: UserSettings): AlertTrackerConfig {
  const prefs = { ...DEFAULT_ALERT_PREFERENCES, ...(settings.alertPreferences ?? {}) };
  const alertsOn = settings.alertsEnabled === true;
  const reminderOn = settings.cutoffReminderEnabled === true;
  if (!alertsOn && !reminderOn) {
    return { alertsEnabled: false, alertPreferences: prefs };
  }
  return {
    alertsEnabled: true,
    cutoffReminderEnabled: reminderOn || (alertsOn && prefs.cutoffAlertEnabled),
    cutoffReminderMinutesBefore: settings.cutoffReminderMinutesBefore ?? 60,
    alertPreferences: alertsOn
      ? prefs
      : {
          ...prefs,
          priceSurgeEnabled: false,
          injuryRiskEnabled: false,
          bargainAlertEnabled: false,
          dailyResetAlertEnabled: false,
          cutoffAlertEnabled: true,
        },
  };
}

/** Creates or clears the tracker alarm to match the settings. */
export function syncAlertTrackerAlarm(settings: UserSettings): void {
  if (!chrome.alarms) return;
  try {
    // One periodic alarm: the full tracker when Alerts are on, else a cutoff-reminder-only alarm.
    const active = !buildTrackerConfig(settings).alertsEnabled
      ? null
      : settings.alertsEnabled === true
        ? ALERT_TRACKER_ALARM_NAME
        : CUTOFF_REMINDER_ALARM_NAME;
    for (const name of [ALERT_TRACKER_ALARM_NAME, CUTOFF_REMINDER_ALARM_NAME]) {
      if (name === active) {
        chrome.alarms.create(name, { periodInMinutes: ALERT_TRACKER_PERIOD_MINUTES });
      } else {
        void chrome.alarms.clear(name);
      }
    }
  } catch {
    // alarms unavailable
  }
}

function notify(id: string, title: string, message: string): void {
  if (!chrome.notifications?.create) return;
  try {
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: 1,
    });
  } catch {
    // notifications unavailable
  }
}

/**
 * One tracker pass: evaluates alerts from the last gallery snapshot plus fresh ESPN injuries,
 * dispatches browser notifications (when enabled) and appends to the in-panel feed.
 */
export async function runAlertTracker(
  settings: UserSettings,
  injuriesOverride: Record<string, InjuryReportEntry> | null = null,
  nowMs: number = Date.now(),
): Promise<TrackedAlertEvent[]> {
  const config = buildTrackerConfig(settings);
  if (!config.alertsEnabled) return [];
  const [state, snapshot] = await Promise.all([
    readState(),
    readSnapshot(settings.username, settings.currency),
  ]);
  const cards = snapshot?.cards ?? [];
  // No network in the alarm: injuries come from the last gallery load (ESPN, refreshed with the panel).
  const currentInjuriesByName = injuriesOverride ?? snapshot?.injuriesByName ?? {};

  // Seed a price baseline the first time a card is seen with a floor.
  for (const c of cards) {
    if (!state.baselines[c.slug] && typeof c.lowestAskCents === "number" && c.lowestAskCents > 0) {
      state.baselines[c.slug] = {
        cardSlug: c.slug,
        playerSlug: c.playerSlug,
        playerName: c.playerName,
        currency: snapshot?.currency ?? "EUR",
        baselineFloorCents: c.lowestAskCents,
        recordedAtMs: nowMs,
        updatedAtMs: nowMs,
      };
    }
  }

  const events = evaluateAlertEvents(
    {
      cards,
      currentLineups: snapshot?.currentLineups ?? [],
      previousInjuriesByName: state.previousInjuriesByName,
      currentInjuriesByName,
      gamesPerTeam: snapshot?.gamesPerTeam,
      bargainListings: [],
      watchlist: [],
      fixtures: snapshot?.fixtures ?? [],
      lastAlertAtByKey: state.lastAlertAtByKey,
    },
    state.baselines,
    config,
    nowMs,
  );

  for (const e of events) {
    state.lastAlertAtByKey[e.dedupeKey] = nowMs;
    if (e.kind === "price_surge" && e.cardSlug && typeof e.currentCents === "number") {
      const b = state.baselines[e.cardSlug];
      if (b) state.baselines[e.cardSlug] = { ...b, baselineFloorCents: e.currentCents, updatedAtMs: nowMs };
    }
    if (e.notifyBrowser) {
      notify(e.id, e.title, e.message);
      if (e.targetUrl) state.clickTargets[e.id] = e.targetUrl;
    }
  }
  if (Object.keys(currentInjuriesByName).length > 0) {
    state.previousInjuriesByName = currentInjuriesByName;
  }
  state.feed = [...events, ...state.feed].slice(0, FEED_LIMIT);
  await writeState(state);
  return events;
}

/** Sends one test notification when alerts and browser notifications are on. */
export async function sendTestAlertNotification(settings: UserSettings): Promise<boolean> {
  const config = buildTrackerConfig(settings);
  if (settings.alertsEnabled !== true || !config.alertPreferences.browserNotificationsEnabled) {
    return false;
  }
  notify(
    `jamassist-test-${Date.now()}`,
    "Sorare NBA Essentials",
    "Test alert: browser notifications are working.",
  );
  return true;
}

export async function getAlertFeed(): Promise<TrackedAlertEvent[]> {
  return (await readState()).feed;
}

/** Returns (and forgets) the URL a clicked notification should open. */
export async function takeNotificationTarget(id: string): Promise<string | null> {
  const state = await readState();
  const url = state.clickTargets[id] ?? null;
  if (url) {
    delete state.clickTargets[id];
    await writeState(state);
  }
  return url;
}

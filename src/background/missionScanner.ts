import type {
  PickerMissionsByMode,
  PickerMissionsSnapshot,
  RawDailyMissionSnapshot,
  RawPickerTaskSnapshot,
} from "../shared/types";

const PICKER_MISSIONS_KEY = "picker_missions_v1";
const CONTENT_FLAGS_KEY = "jamassist_content_flags_v1";

function lastDailyResetMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setUTCHours(7, 0, 0, 0);
  if (d.getTime() > nowMs) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

export interface PageMissionsReadResult {
  mode: "pro" | "set";
  tasks: RawPickerTaskSnapshot[];
  dailyMissions: RawDailyMissionSnapshot[];
  setSoloSubmitted: boolean | null;
}

/**
 * Runs in a sorare.com missions / Play page (MAIN world): reads live daily picker tasks
 * (`DecisivePlayerPickerTask`), non-picker daily missions, and Set Daily Solo status
 * from Sorare's Apollo cache. Private, logged-in data. Must be 100% self-contained.
 */
export function readPickerTasksFromPage(): PageMissionsReadResult | { error: string } {
  type Entity = Record<string, unknown>;
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Entity> } } })
    .__APOLLO_CLIENT__;
  if (!client) return { error: "Sorare page data not ready yet." };
  const ex = client.cache.extract();
  const pageMode: "pro" | "set" = /\/series(\/|$)/.test(location.pathname) ? "set" : "pro";

  const deref = (r: unknown): Entity | null => {
    if (!r || typeof r !== "object") return null;
    const ref = (r as { __ref?: unknown }).__ref;
    if (typeof ref === "string") return ex[ref] ?? null;
    return r as Entity;
  };

  const COMPLETED_STATES = new Set<string>([
    "COMPLETED",
    "CLAIMED",
    "FULFILLED",
    "DONE",
    "SUBMITTED",
    "LOCKED",
    "PLAYED",
    "AWAITING_RESULTS",
    "PENDING_RESULT",
    "PENDING_RESULTS",
    "SCORING",
    "LIVE",
    "IN_PLAY",
    "FINISHED",
    "SETTLED",
    "CLAIMABLE",
    "REWARD_AVAILABLE",
    "WON",
    "LOST",
  ]);

  const isCompletedState = (raw: unknown): boolean => {
    const s = String(raw ?? "").trim().toUpperCase();
    return s.length > 0 && COMPLETED_STATES.has(s);
  };

  const countCollection = (val: unknown): number => {
    if (Array.isArray(val)) return val.filter((x) => x !== null && x !== undefined).length;
    if (val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (Array.isArray(obj.nodes)) return obj.nodes.filter((x) => x !== null && x !== undefined).length;
      if (Array.isArray(obj.edges)) return obj.edges.filter((x) => x !== null && x !== undefined).length;
      if (typeof obj.totalCount === "number" && Number.isFinite(obj.totalCount)) return obj.totalCount;
    }
    return 0;
  };

  const PICKED_ARRAY_KEY_RE =
    /^(?:so5|task|picker|selected|picked|chosen|my|submitted|user|currentuser|lineup)?(?:appearances|picks|cards|anycards|selections|entries|players|answers|predictions|submissions|participations)(?:\(|$)/i;
  const SINGLE_PICK_KEY_RE =
    /^(?:selected|picked|chosen|my|user|submitted)(?:player|card|anycard|appearance|pick|choice|answer|prediction|entry|submission)(?:\(|$)/i;
  const EXCLUDED_ARRAY_KEY_RE =
    /^(?:pickable|available|eligible|recommended|reward|possible|candidate|all|other)/i;

  const inspectLineupPicks = (
    lineup: Entity | null,
  ): { count: number; submitted: boolean; explicitlySubmitted: boolean } => {
    if (!lineup) return { count: 0, submitted: false, explicitlySubmitted: false };
    if (lineup.cancelledAt || lineup.draft === true || lineup.deleted === true) {
      return { count: 0, submitted: false, explicitlySubmitted: false };
    }
    let count = 0;
    for (const [k, v] of Object.entries(lineup)) {
      if (EXCLUDED_ARRAY_KEY_RE.test(k)) continue;
      if (PICKED_ARRAY_KEY_RE.test(k)) {
        count = Math.max(count, countCollection(v));
      } else if (SINGLE_PICK_KEY_RE.test(k) && v && typeof v === "object") {
        count = Math.max(count, 1);
      }
    }
    const explicitlySubmitted =
      Boolean(lineup.submittedAt || lineup.confirmedAt || lineup.completedAt || lineup.locked === true) ||
      isCompletedState(lineup.aasmState);
    const submitted = explicitlySubmitted || count > 0;
    return { count, submitted, explicitlySubmitted };
  };

  // Pre-index reverse-linked task lineups in Apollo cache
  const lineupsByTaskRef = new Map<string, Entity[]>();
  const lineupsByTaskId = new Map<string, Entity[]>();
  for (const [k, entity] of Object.entries(ex)) {
    if (!entity || typeof entity !== "object") continue;
    const tn = String(entity.__typename ?? "");
    if (!/lineup/i.test(tn) && !/lineup/i.test(k)) continue;
    if (entity.cancelledAt || entity.draft === true) continue;
    for (const field of ["task", "pickerTask", "missionTask", "decisivePlayerPickerTask"]) {
      const refObj = entity[field] as { __ref?: string } | undefined;
      if (refObj && typeof refObj.__ref === "string") {
        const list = lineupsByTaskRef.get(refObj.__ref) ?? [];
        list.push(entity);
        lineupsByTaskRef.set(refObj.__ref, list);
      }
    }
    if (typeof entity.taskId === "string" && entity.taskId) {
      const list = lineupsByTaskId.get(entity.taskId) ?? [];
      list.push(entity);
      lineupsByTaskId.set(entity.taskId, list);
    }
  }

  const isProTask = (t: { title: string; description: string; slug: string; mode: string; picks: number }): boolean => {
    const mode = t.mode.trim().toLowerCase();
    if (/^(common|set|arcade|series)$/.test(mode)) return false;
    if (/^(limited|rare|super_rare|unique|pro|classic|in_season)$/.test(mode)) return true;
    const desc = t.description.trim();
    const slug = t.slug.toLowerCase();
    const title = t.title.toLowerCase();
    return (
      /^(classic|in-season):/i.test(desc) ||
      /\b(xp|limited|rare|super\s*rare|unique)\b/i.test(desc) ||
      /\b(classic|pro|limited|rare|playmaker|rebound|double|triple)\b/.test(slug) ||
      /\b(playmaker|rebound|double[- ]double|triple[- ]double)\b/.test(title) ||
      t.picks > 1
    );
  };

  const seenPickers = new Set<string>();
  const tasks: RawPickerTaskSnapshot[] = [];

  for (const [key, t] of Object.entries(ex)) {
    if (!t || typeof t !== "object") continue;
    if (t.__typename !== "DecisivePlayerPickerTask" || t.expired === true) continue;
    const title = String(t.title ?? "");
    if (!title) continue;
    const description = String(t.description ?? "");
    const mode = String(t.mode ?? "");
    const slug = String(t.taskConfigSlug ?? t.slug ?? "");
    const picks = Number(t.maxAppearancesCount ?? t.target ?? 1) || 1;
    const state = String(t.aasmState ?? "");

    const proTask = isProTask({ title, description, slug, mode, picks });
    if (pageMode === "pro" ? !proTask : proTask) continue;

    const dedupeKey = (slug || `${title}::${description}`).toLowerCase();
    if (seenPickers.has(dedupeKey)) continue;
    seenPickers.add(dedupeKey);

    let pickedCount = 0;
    for (const numKey of ["appearancesCount", "pickedCount", "picksCount", "selectedCardsCount", "entriesCount", "progress"]) {
      const n = t[numKey];
      if (typeof n === "number" && Number.isFinite(n) && n > pickedCount) {
        pickedCount = Math.floor(n);
      }
    }

    let lineupSubmitted = false;
    let lineupExplicitlySubmitted = false;
    for (const [k, v] of Object.entries(t)) {
      if (EXCLUDED_ARRAY_KEY_RE.test(k)) continue;
      if (PICKED_ARRAY_KEY_RE.test(k)) {
        pickedCount = Math.max(pickedCount, countCollection(v));
      } else if (SINGLE_PICK_KEY_RE.test(k) && v && typeof v === "object") {
        pickedCount = Math.max(pickedCount, 1);
      } else if (/lineup/i.test(k) && v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (const item of v) {
            const res = inspectLineupPicks(deref(item));
            pickedCount = Math.max(pickedCount, res.count);
            if (res.submitted) lineupSubmitted = true;
            if (res.explicitlySubmitted) lineupExplicitlySubmitted = true;
          }
        } else {
          const res = inspectLineupPicks(deref(v));
          pickedCount = Math.max(pickedCount, res.count);
          if (res.submitted) lineupSubmitted = true;
          if (res.explicitlySubmitted) lineupExplicitlySubmitted = true;
        }
      }
    }

    const revLineups = [
      ...(lineupsByTaskRef.get(key) ?? []),
      ...(typeof t.id === "string" ? (lineupsByTaskId.get(t.id) ?? []) : []),
    ];
    for (const rl of revLineups) {
      const res = inspectLineupPicks(rl);
      pickedCount = Math.max(pickedCount, res.count);
      if (res.submitted) lineupSubmitted = true;
      if (res.explicitlySubmitted) lineupExplicitlySubmitted = true;
    }

    const boolDone =
      t.completed === true ||
      t.isCompleted === true ||
      t.submitted === true ||
      t.isSubmitted === true ||
      t.claimed === true ||
      t.isClaimed === true ||
      t.done === true ||
      t.locked === true ||
      Boolean(
        t.submittedAt ||
          t.completedAt ||
          t.claimedAt ||
          t.fulfilledAt ||
          t.answeredAt ||
          t.pickedAt ||
          t.selectedAt,
      );

    const target = typeof t.target === "number" && Number.isFinite(t.target) ? t.target : null;
    const progress = typeof t.progress === "number" && Number.isFinite(t.progress) ? t.progress : null;

    const submitted =
      boolDone ||
      isCompletedState(state) ||
      pickedCount >= picks ||
      lineupExplicitlySubmitted ||
      (lineupSubmitted && picks <= 1) ||
      (target !== null && target > 0 && progress !== null && progress >= target);

    tasks.push({
      title,
      description,
      mode,
      slug,
      picks,
      state,
      ...(pickedCount > 0 ? { pickedCount } : {}),
      ...(submitted ? { submitted: true } : {}),
    });
  }

  // Extract non-picker daily missions (e.g. Set/Pro daily quests)
  const nowMs = Date.now();
  const seenMissions = new Set<string>();
  const dailyMissions: RawDailyMissionSnapshot[] = [];

  for (const [, t] of Object.entries(ex)) {
    if (!t || typeof t !== "object") continue;
    const tn = String(t.__typename ?? "");
    if (!/(?:Task|Mission|Quest|Objective)$/.test(tn) || tn === "DecisivePlayerPickerTask" || tn === "CommonDailyClaimTask") continue;
    if (t.expired === true) continue;
    const title = String(t.title ?? "").trim();
    if (!title) continue;
    const description = String(t.description ?? "").trim();
    const slug = String(t.taskConfigSlug ?? t.slug ?? "").trim();
    const combined = `${slug} ${title} ${description}`.toLowerCase();

    // Exclude weekly/shop bronze+ counters and season-long collection tracks
    if (/bought.?packs|bronze\+|league.?collect|full.?collection|draft\s*26|non.?playoff|conference\s*final/i.test(combined)) {
      continue;
    }

    const period = String(t.period ?? t.frequency ?? t.cadence ?? t.resetFrequency ?? "").toUpperCase();
    const endDateRaw = typeof t.endDate === "string" ? t.endDate : typeof t.expiresAt === "string" ? t.expiresAt : null;
    const endMs = endDateRaw ? Date.parse(endDateRaw) : NaN;
    const expiresSoon = Number.isFinite(endMs) && endMs > nowMs && endMs - nowMs <= 36 * 3600_000;
    const looksDaily =
      period.includes("DAILY") ||
      expiresSoon ||
      (/\b(daily|today|solo)\b/i.test(combined) && !/\b(weekly|season|monthly)\b/i.test(combined));
    if (!looksDaily) continue;

    // Filter by current page mode
    const looksPro = /\b(limited|rare|super\s*rare|unique|classic|in-season|pro|arena|xp)\b/i.test(combined);
    const looksSet = /\b(common|set|solo|squad|arcade|series|pack|scrap)\b/i.test(combined);
    if (pageMode === "pro" && looksSet && !looksPro) continue;
    if (pageMode === "set" && looksPro && !looksSet) continue;

    const dedupeKey = (slug || title).toLowerCase();
    if (seenMissions.has(dedupeKey)) continue;
    seenMissions.add(dedupeKey);

    const state = String(t.aasmState ?? "");
    const progress = typeof t.progress === "number" && Number.isFinite(t.progress) ? t.progress : null;
    const target = typeof t.target === "number" && Number.isFinite(t.target) ? t.target : null;
    const completed =
      t.completed === true ||
      t.claimed === true ||
      t.done === true ||
      Boolean(t.completedAt || t.claimedAt || t.fulfilledAt) ||
      isCompletedState(state) ||
      (progress !== null && target !== null && target > 0 && progress >= target);

    dailyMissions.push({
      title,
      description,
      slug,
      state,
      progress,
      target,
      completed,
    });
  }

  // Detect active Set Daily Solo lineup when on Set Play pages
  let setSoloSubmitted: boolean | null = null;
  if (pageMode === "set" && /\/series\/play/i.test(location.pathname)) {
    const me = Object.entries(ex).find(([k]) => k.startsWith("CurrentUser"))?.[1];
    const mySlug = typeof me?.slug === "string" ? me.slug : "";
    for (const [key, entity] of Object.entries(ex)) {
      if (!entity || typeof entity !== "object") continue;
      const tn = String(entity.__typename ?? "");
      if (!/^(?:Task|Common|Solo|Arcade)Lineup$/.test(tn) && !key.startsWith("TaskLineup:")) continue;
      if (entity.cancelledAt || entity.draft === true || entity.hidden === true) continue;
      const owner = deref(entity.user);
      if (mySlug && owner && typeof owner.slug === "string" && owner.slug !== mySlug) continue;
      // Exclude Squad lineups (those belong to SquadStep)
      const lb = deref(entity.leaderboard) ?? deref(entity.so5Leaderboard) ?? deref(entity.task);
      const lbText = `${String(lb?.slug ?? "")} ${String(lb?.displayName ?? "")} ${String(lb?.title ?? "")} ${String(entity.name ?? "")}`.toLowerCase();
      if (/squad/.test(lbText)) continue;
      const res = inspectLineupPicks(entity);
      if (res.count >= 5 || (res.submitted && /solo|arcade|daily/.test(lbText))) {
        setSoloSubmitted = true;
        break;
      }
    }
  }

  if (tasks.length === 0 && dailyMissions.length === 0 && setSoloSubmitted === null) {
    return { error: "No daily pickers or missions on this page. Open Sorare's Play missions." };
  }
  return { mode: pageMode, tasks, dailyMissions, setSoloSubmitted };
}

export async function getSavedPickerMissions(): Promise<PickerMissionsByMode> {
  const stored = await chrome.storage.local.get(PICKER_MISSIONS_KEY);
  return (stored[PICKER_MISSIONS_KEY] as PickerMissionsByMode | undefined) ?? {};
}

async function isDailyTrackingEnabled(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(CONTENT_FLAGS_KEY);
    const flags = stored[CONTENT_FLAGS_KEY] as { trackDailyTasks?: boolean } | undefined;
    return flags?.trackDailyTasks !== false;
  } catch {
    return true;
  }
}

export function mergeMissionSnapshots(
  prev: PickerMissionsSnapshot | undefined,
  data: PageMissionsReadResult,
  nowMs = Date.now(),
): PickerMissionsSnapshot {
  const resetMs = lastDailyResetMs(nowMs);
  const prevFresh = Boolean(prev && prev.scannedAt >= resetMs);

  const taskByKey = new Map<string, RawPickerTaskSnapshot>();
  if (prevFresh && prev) {
    for (const t of prev.tasks) {
      const k = (t.slug || `${t.title}::${t.description}`).toLowerCase();
      taskByKey.set(k, t);
    }
  }
  for (const t of data.tasks) {
    const k = (t.slug || `${t.title}::${t.description}`).toLowerCase();
    const existing = taskByKey.get(k);
    if (!existing) {
      taskByKey.set(k, t);
    } else {
      const pickedCount = Math.max(existing.pickedCount ?? 0, t.pickedCount ?? 0);
      const submitted = Boolean(existing.submitted || t.submitted);
      taskByKey.set(k, {
        ...existing,
        ...t,
        ...(pickedCount > 0 ? { pickedCount } : {}),
        ...(submitted ? { submitted: true } : {}),
      });
    }
  }
  const mergedTasks = Array.from(taskByKey.values());

  const missionByKey = new Map<string, RawDailyMissionSnapshot>();
  if (prevFresh && prev?.dailyMissions) {
    for (const m of prev.dailyMissions) {
      const k = (m.slug || m.title).toLowerCase();
      missionByKey.set(k, m);
    }
  }
  for (const m of data.dailyMissions) {
    const k = (m.slug || m.title).toLowerCase();
    const existing = missionByKey.get(k);
    if (!existing) {
      missionByKey.set(k, m);
    } else {
      const progress =
        typeof existing.progress === "number" && typeof m.progress === "number"
          ? Math.max(existing.progress, m.progress)
          : (m.progress ?? existing.progress);
      const target = m.target ?? existing.target;
      const completed = Boolean(existing.completed || m.completed);
      missionByKey.set(k, {
        ...existing,
        ...m,
        progress,
        target,
        completed,
      });
    }
  }
  const mergedMissions = Array.from(missionByKey.values());

  const prevSolo = prevFresh && typeof prev?.setSoloSubmitted === "boolean" ? prev.setSoloSubmitted : null;
  const mergedSolo =
    data.setSoloSubmitted === true || prevSolo === true
      ? true
      : (data.setSoloSubmitted ?? prevSolo);

  return {
    mode: data.mode,
    tasks: mergedTasks,
    ...(mergedMissions.length > 0 ? { dailyMissions: mergedMissions } : {}),
    ...(mergedSolo !== null ? { setSoloSubmitted: mergedSolo } : {}),
    scannedAt: nowMs,
  };
}

async function readTab(tabId: number): Promise<PickerMissionsSnapshot | null> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readPickerTasksFromPage });
  const data = result?.result as PageMissionsReadResult | { error: string } | undefined;
  if (!data || "error" in data) return null;

  const now = Date.now();
  const all = await getSavedPickerMissions();
  const snapshot = mergeMissionSnapshots(all[data.mode], data, now);
  await chrome.storage.local.set({ [PICKER_MISSIONS_KEY]: { ...all, [data.mode]: snapshot } });
  return snapshot;
}

const MISSION_PAGE = /^https:\/\/sorare\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?nba\/(play|series)(\/|$|\?)/i;

/** Reads the pickers & daily missions from any open Sorare missions / Play tab (button in the panel). */
export async function scanPickerMissionsFromOpenTabs(): Promise<PickerMissionsByMode> {
  if (!chrome.scripting) throw new Error("Reload the extension to grant the page-reading permission.");
  const tabs = (
    await chrome.tabs.query({ url: ["https://sorare.com/nba/*", "https://sorare.com/*/nba/*"] })
  ).filter((t) => t.url && MISSION_PAGE.test(t.url));
  if (tabs.length === 0) throw new Error("Open Sorare's Play missions (the Go button) in a tab, then scan again.");
  let found = 0;
  for (const tab of tabs) {
    if (tab.id && (await readTab(tab.id).catch(() => null))) found += 1;
  }
  if (found === 0) throw new Error("No daily pickers found yet: wait for the Sorare page to load, then scan again.");
  return getSavedPickerMissions();
}

/** Silently reads picker tasks & daily missions from all open Sorare NBA Play/Series tabs sequentially (no storage race). */
export async function syncAllMissionTabs(): Promise<void> {
  if (!chrome.scripting || !chrome.tabs?.query) return;
  const tabs = (
    await chrome.tabs.query({ url: ["https://sorare.com/nba/*", "https://sorare.com/*/nba/*"] }).catch(() => [])
  ).filter((t) => t.url && MISSION_PAGE.test(t.url));
  for (const t of tabs) {
    if (t.id) {
      await readTab(t.id).catch(() => null);
    }
  }
}

/** Silently reads picker tasks from a Sorare tab (used on page load and after in-page submissions). */
export async function syncMissionTab(tabId: number): Promise<PickerMissionsSnapshot | null> {
  if (!chrome.scripting?.executeScript) return null;
  return readTab(tabId).catch(() => null);
}

/** Auto-sync: when a Sorare missions/play page finishes loading, read its pickers & daily missions. */
export function watchMissionPages(): void {
  if (!chrome.tabs?.onUpdated || !chrome.scripting) return;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if ((info.status !== "complete" && !info.url) || !tab.url || !MISSION_PAGE.test(tab.url)) return;
    void isDailyTrackingEnabled().then((enabled) => {
      if (!enabled) return;
      let tries = 0;
      const attempt = () => {
        tries += 1;
        readTab(tabId)
          .then((snap) => {
            if (!snap && tries < 4) setTimeout(attempt, 2500);
          })
          .catch(() => {});
      };
      setTimeout(attempt, 1800);
      setTimeout(() => void readTab(tabId).catch(() => null), 6000);
    });
  });
}

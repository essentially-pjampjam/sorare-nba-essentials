import type {
  PickerMissionsByMode,
  RawDailyMissionSnapshot,
  RawPickerTaskSnapshot,
  SetShopStatus,
} from "../shared/types";

export const DAILY_MANUAL_STORAGE_KEY = "jamassist_daily_manual_v1";

export interface DailyManualCompletionState {
  resetMs: number;
  completedIds: Record<string, boolean>;
}

export interface DailyChecklistItem {
  id: string;
  mode: "set" | "pro";
  modeBadge: string;
  title: string;
  sub: string;
  done: boolean;
  autoDone: boolean;
  manualDone: boolean;
  known: boolean;
  url: string;
  tab: "lineups";
  subTab: "daily" | "solo_squad" | "packs" | "overview";
  panelBtnLabel: string;
  panelBtnTitle: string;
}

/** Last 07:00 UTC daily reset timestamp at or before `nowMs`. */
export function lastDailyResetMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setUTCHours(7, 0, 0, 0);
  if (d.getTime() > nowMs) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.getTime();
}

const COMPLETED_TASK_STATES = new Set<string>([
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

/** True when Sorare's task `aasmState` indicates picks/submission/completion for today. */
export function isTaskCompletedState(rawState: string): boolean {
  const normalized = rawState.trim().toUpperCase();
  if (!normalized) return false;
  return COMPLETED_TASK_STATES.has(normalized);
}

/** True when a Daily Picker task has been submitted/completed (even before NBA games settle). */
export function isPickerTaskDone(task: RawPickerTaskSnapshot): boolean {
  if (task.submitted === true) return true;
  if (isTaskCompletedState(task.state)) return true;
  const requiredPicks = Math.max(1, Number(task.picks) || 1);
  if (typeof task.pickedCount === "number" && Number.isFinite(task.pickedCount) && task.pickedCount >= requiredPicks) {
    return true;
  }
  return false;
}

/** True when a non-picker Daily Mission is completed or claimed for today. */
export function isDailyMissionDone(mission: RawDailyMissionSnapshot): boolean {
  if (mission.completed === true) return true;
  if (isTaskCompletedState(mission.state)) return true;
  if (
    typeof mission.progress === "number" &&
    typeof mission.target === "number" &&
    Number.isFinite(mission.progress) &&
    Number.isFinite(mission.target) &&
    mission.target > 0 &&
    mission.progress >= mission.target
  ) {
    return true;
  }
  return false;
}

/** Extracts today's manual completion overrides, automatically dropping stale pre-reset entries. */
export function resolveManualCompletions(
  raw: unknown,
  resetMs: number,
): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as { resetMs?: unknown; completedIds?: unknown };
  if (typeof rec.resetMs !== "number" || rec.resetMs < resetMs) return {};
  if (!rec.completedIds || typeof rec.completedIds !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rec.completedIds as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Returns updated manual completion state for today's reset period. */
export function toggleManualCompletion(
  current: DailyManualCompletionState | null,
  itemId: string,
  done: boolean,
  nowMs = Date.now(),
  fallbackPlaceholderId?: string,
): DailyManualCompletionState {
  const resetMs = lastDailyResetMs(nowMs);
  const existing = resolveManualCompletions(current, resetMs);
  const nextIds: Record<string, boolean> = { ...existing };
  if (done) {
    nextIds[itemId] = true;
  } else if (fallbackPlaceholderId && existing[fallbackPlaceholderId] === true) {
    // Explicitly override an inherited placeholder check-off for this specific real task.
    nextIds[itemId] = false;
  } else {
    delete nextIds[itemId];
  }
  return { resetMs, completedIds: nextIds };
}

function isDailyPackMission(m: RawDailyMissionSnapshot): boolean {
  const text = `${m.slug} ${m.title} ${m.description}`.toLowerCase();
  return /daily\s*(free\s*)?pack|common.*daily.*claim|free\s*pack/.test(text);
}

function isSetSoloMission(m: RawDailyMissionSnapshot): boolean {
  const text = `${m.slug} ${m.title} ${m.description}`.toLowerCase();
  return /daily\s*solo|solo\s*(lineup|team|entry|mode)|play\s*solo/.test(text);
}

function formatPickerSubtitle(task: RawPickerTaskSnapshot, done: boolean, defaultSub: string): string {
  const required = Math.max(1, Number(task.picks) || 1);
  if (done) {
    return `Picked today (${required}/${required})`;
  }
  if (typeof task.pickedCount === "number" && task.pickedCount > 0 && task.pickedCount < required) {
    return `${task.pickedCount}/${required} picked today`;
  }
  return defaultSub;
}

function formatMissionSubtitle(m: RawDailyMissionSnapshot, done: boolean): string {
  if (done) {
    if (typeof m.target === "number" && m.target > 0) {
      return `Completed today (${m.target}/${m.target})`;
    }
    return "Completed today";
  }
  if (typeof m.progress === "number" && typeof m.target === "number" && m.target > 0) {
    const desc = m.description.trim();
    return desc ? `${m.progress}/${m.target} • ${desc}` : `Progress ${m.progress}/${m.target}`;
  }
  return m.description.trim() || "Daily mission";
}

function applyManualOverride(
  item: Omit<DailyChecklistItem, "done" | "manualDone">,
  manualMap: Record<string, boolean>,
  fallbackPlaceholderId?: string,
): DailyChecklistItem {
  const direct = manualMap[item.id];
  const manualDone =
    direct === false
      ? false
      : direct === true || Boolean(fallbackPlaceholderId && manualMap[fallbackPlaceholderId] === true);
  const done = item.autoDone || manualDone;
  const sub = !item.autoDone && manualDone ? "Marked done (manual)" : item.sub;
  return {
    ...item,
    done,
    manualDone,
    sub,
  };
}

/**
 * Builds the unified today's dailies checklist (Set Free Daily Pack in Daily Solo,
 * Set Daily Solo Lineup, Set Daily Pickers & Missions, Pro Daily Pickers & Missions),
 * merging live Apollo sync with today's optional manual mobile check-offs.
 */
export function buildDailyChecklistItems(args: {
  shopStatus: SetShopStatus | null;
  pickerMissions: PickerMissionsByMode;
  manualState?: DailyManualCompletionState | null;
  nowMs?: number;
}): DailyChecklistItem[] {
  const resetMs = lastDailyResetMs(args.nowMs);
  const manualMap = resolveManualCompletions(args.manualState, resetMs);
  const items: DailyChecklistItem[] = [];

  const setSnap = args.pickerMissions.set;
  const setFresh = Boolean(setSnap && setSnap.scannedAt >= resetMs);
  const setDailyMissions = setFresh && Array.isArray(setSnap?.dailyMissions) ? setSnap.dailyMissions : [];

  // 1. Set Free Daily Pack (inside Play -> Daily Solo on Sorare, not Shop/Packs)
  const shopFresh = Boolean(args.shopStatus && args.shopStatus.scannedAt >= resetMs);
  const dailyPackMission = setDailyMissions.find(isDailyPackMission);
  const packClaimed =
    (shopFresh && args.shopStatus?.dailyPackClaimed === true) ||
    Boolean(dailyPackMission && isDailyMissionDone(dailyPackMission));
  const packKnown =
    (shopFresh && args.shopStatus?.dailyPackClaimed !== null) || Boolean(dailyPackMission);

  items.push(
    applyManualOverride(
      {
        id: "set_daily_pack",
        mode: "set",
        modeBadge: "SET",
        title: "Free Daily Pack",
        sub: packClaimed
          ? "Claimed today"
          : packKnown
            ? "Ready to claim in Daily Solo"
            : "Open Daily Solo to check",
        autoDone: packClaimed,
        known: packKnown,
        url: "https://sorare.com/nba/series/play",
        tab: "lineups",
        subTab: "solo_squad",
        panelBtnLabel: "Solo",
        panelBtnTitle: "Open Set Daily Solo in the Side Panel",
      },
      manualMap,
    ),
  );

  // 2. Set Daily Solo Lineup
  const soloMission = setDailyMissions.find(isSetSoloMission);
  const soloSubmitted =
    (setFresh && setSnap?.setSoloSubmitted === true) ||
    Boolean(soloMission && isDailyMissionDone(soloMission));
  const soloKnown =
    (setFresh && typeof setSnap?.setSoloSubmitted === "boolean") || Boolean(soloMission);

  items.push(
    applyManualOverride(
      {
        id: "set_daily_solo",
        mode: "set",
        modeBadge: "SET",
        title: "Set Daily Solo Lineup",
        sub: soloSubmitted
          ? "Lineup set today"
          : soloKnown
            ? "Set your 5-card Daily Solo lineup"
            : "Open Daily Solo to sync or check off",
        autoDone: soloSubmitted,
        known: soloKnown,
        url: "https://sorare.com/nba/series/play",
        tab: "lineups",
        subTab: "solo_squad",
        panelBtnLabel: "Solo",
        panelBtnTitle: "Open Set Daily Solo builder in the Side Panel",
      },
      manualMap,
    ),
  );

  // 3. Set Daily Pickers
  const setPickers = setFresh && Array.isArray(setSnap?.tasks) ? setSnap.tasks : [];
  if (setPickers.length > 0) {
    for (const t of setPickers) {
      const done = isPickerTaskDone(t);
      const id = `set_task_${t.slug || t.title}`;
      items.push(
        applyManualOverride(
          {
            id,
            mode: "set",
            modeBadge: "SET",
            title: t.title || "Set Daily Picker",
            sub: formatPickerSubtitle(
              t,
              done,
              `${t.picks || 1} pick • Beat L10 + 7 & 20+ pts`,
            ),
            autoDone: done,
            known: Boolean(t.state || typeof t.pickedCount === "number" || typeof t.submitted === "boolean"),
            url: "https://sorare.com/nba/series/play?missions=play",
            tab: "lineups",
            subTab: "daily",
            panelBtnLabel: "Picks",
            panelBtnTitle: "Open Set Daily Play suggestions in the Side Panel",
          },
          manualMap,
          "set_daily_picker_default",
        ),
      );
    }
  } else {
    items.push(
      applyManualOverride(
        {
          id: "set_daily_picker_default",
          mode: "set",
          modeBadge: "SET",
          title: "Set Daily Picker",
          sub: "1 Common pick • Beat L10 + 7 & 20+ pts",
          autoDone: false,
          known: false,
          url: "https://sorare.com/nba/series/play?missions=play",
          tab: "lineups",
          subTab: "daily",
          panelBtnLabel: "Picks",
          panelBtnTitle: "Open Set Daily Play suggestions in the Side Panel",
        },
        manualMap,
      ),
    );
  }

  // 4. Other Set Daily Missions (non-picker, deduplicated against Daily Pack & Daily Solo)
  for (const m of setDailyMissions) {
    if (isDailyPackMission(m) || isSetSoloMission(m)) continue;
    const done = isDailyMissionDone(m);
    items.push(
      applyManualOverride(
        {
          id: `set_mission_${m.slug || m.title}`,
          mode: "set",
          modeBadge: "SET",
          title: m.title,
          sub: formatMissionSubtitle(m, done),
          autoDone: done,
          known: true,
          url: "https://sorare.com/nba/series/play?missions=play",
          tab: "lineups",
          subTab: "daily",
          panelBtnLabel: "Daily",
          panelBtnTitle: "Open Set Daily Play in the Side Panel",
        },
        manualMap,
      ),
    );
  }

  // 5. Pro Daily Pickers (Limited+)
  const proSnap = args.pickerMissions.pro;
  const proFresh = Boolean(proSnap && proSnap.scannedAt >= resetMs);
  const proPickers = proFresh && Array.isArray(proSnap?.tasks) ? proSnap.tasks : [];
  if (proPickers.length > 0) {
    for (const t of proPickers) {
      const done = isPickerTaskDone(t);
      items.push(
        applyManualOverride(
          {
            id: `pro_task_${t.slug || t.title}`,
            mode: "pro",
            modeBadge: "PRO",
            title: t.title || "Pro Daily Picker",
            sub: formatPickerSubtitle(t, done, `${t.picks || 3} picks • Limited`),
            autoDone: done,
            known: Boolean(t.state || typeof t.pickedCount === "number" || typeof t.submitted === "boolean"),
            url: "https://sorare.com/nba/play/missions/play/limited",
            tab: "lineups",
            subTab: "overview",
            panelBtnLabel: "Picks",
            panelBtnTitle: "Open Pro Daily Play suggestions in the Side Panel",
          },
          manualMap,
          "pro_daily_picker_default",
        ),
      );
    }
  } else {
    items.push(
      applyManualOverride(
        {
          id: "pro_daily_picker_default",
          mode: "pro",
          modeBadge: "PRO",
          title: "Pro Daily Pickers",
          sub: "Daily Picker & stat missions • 3 picks",
          autoDone: false,
          known: false,
          url: "https://sorare.com/nba/play/missions/play/limited",
          tab: "lineups",
          subTab: "overview",
          panelBtnLabel: "Picks",
          panelBtnTitle: "Open Pro Daily Play suggestions in the Side Panel",
        },
        manualMap,
      ),
    );
  }

  // 6. Pro Daily Missions (non-picker)
  const proDailyMissions = proFresh && Array.isArray(proSnap?.dailyMissions) ? proSnap.dailyMissions : [];
  for (const m of proDailyMissions) {
    const done = isDailyMissionDone(m);
    items.push(
      applyManualOverride(
        {
          id: `pro_mission_${m.slug || m.title}`,
          mode: "pro",
          modeBadge: "PRO",
          title: m.title,
          sub: formatMissionSubtitle(m, done),
          autoDone: done,
          known: true,
          url: "https://sorare.com/nba/play/missions/play/limited",
          tab: "lineups",
          subTab: "overview",
          panelBtnLabel: "Pro",
          panelBtnTitle: "Open Pro Lineups & Daily Play in the Side Panel",
        },
        manualMap,
      ),
    );
  }

  return items;
}

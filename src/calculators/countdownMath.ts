import type { CountdownSnapshot, So5FixtureSummary } from "../shared/types";

/**
 * Daily reset hour (UTC) for Sorare NBA daily content (Daily Picker / daily missions).
 * From the v2.7.0 handoff spec; NOT yet confirmed live (Sorare's Football help says
 * "9 AM CET", which is 08:00 UTC in winter). Tracked in docs/SORARE_FACTS.md.
 */
export const DAILY_RESET_UTC_HOUR = 7;
const DAY_MS = 86_400_000;

/** Next daily reset strictly after `nowMs` (exactly at the reset = the following day). */
export function nextDailyResetMs(nowMs: number, resetHourUtc: number = DAILY_RESET_UTC_HOUR): number {
  const d = new Date(nowMs);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), resetHourUtc);
  return today > nowMs ? today : today + DAY_MS;
}

/** The earliest still-upcoming cutoff of an opened Game Week, or null. */
export function selectOpenGameWeek(
  fixtures: So5FixtureSummary[],
  nowMs: number,
): { fixture: So5FixtureSummary; cutoffMs: number } | null {
  let best: { fixture: So5FixtureSummary; cutoffMs: number } | null = null;
  for (const f of fixtures) {
    if (f.aasmState !== "opened") continue;
    const cutoffMs = Date.parse(f.cutOffDate);
    if (!Number.isFinite(cutoffMs) || cutoffMs <= nowMs) continue;
    if (!best || cutoffMs < best.cutoffMs) best = { fixture: f, cutoffMs };
  }
  return best;
}

/** Live GW cutoff + daily reset countdowns; pure, so the UI can tick it every second. */
export function computeCountdownSnapshot(
  fixtures: So5FixtureSummary[],
  nowMs: number = Date.now(),
): CountdownSnapshot {
  const gw = selectOpenGameWeek(fixtures, nowMs);
  const resetMs = nextDailyResetMs(nowMs);
  return {
    gwCutoffIso: gw ? new Date(gw.cutoffMs).toISOString() : null,
    gwRemainingMs: gw ? gw.cutoffMs - nowMs : null,
    gwFixtureSlug: gw?.fixture.slug ?? null,
    dailyResetIso: new Date(resetMs).toISOString(),
    dailyRemainingMs: resetMs - nowMs,
  };
}

/** "2d 4h", "3h 05m", "25m 10s", "45s", "0s". Never negative or NaN. */
export function formatCountdown(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const days = Math.floor(safe / 86_400);
  const hours = Math.floor((safe % 86_400) / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const seconds = safe % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

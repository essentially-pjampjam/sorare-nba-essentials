import type { DailyPickerWindow, DailySlateGame } from "../shared/types";
import { nextDailyResetMs } from "./countdownMath";

export type { DailyPickerWindow, DailySlateGame };

/**
 * Games the live Daily Picker offers (checked 2026-11-19: `DecisivePlayerPickerTask.pickableGames`
 * = the not-yet-started games before the next 07:00 UTC reset). When every game in today's window
 * has started, the next day's window is returned instead.
 */
export function selectDailyPickerWindow(games: DailySlateGame[], nowMs: number): DailyPickerWindow {
  const build = (startMs: number): DailyPickerWindow => {
    const endMs = nextDailyResetMs(startMs);
    const picked = games
      .filter((g) => {
        const t = Date.parse(g.tipOffIso);
        return g.state === "pre" && Number.isFinite(t) && t >= startMs && t < endMs;
      })
      .sort((a, b) => Date.parse(a.tipOffIso) - Date.parse(b.tipOffIso));
    const teamSlugs = Array.from(new Set(picked.flatMap((g) => [g.homeTeamSlug, g.awayTeamSlug])));
    return {
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      games: picked,
      teamSlugs,
    };
  };
  const today = build(nowMs);
  if (today.games.length > 0) return today;
  const nextStart = nextDailyResetMs(nowMs);
  const lockedGames = games
    .filter((g) => {
      const t = Date.parse(g.tipOffIso);
      return g.state !== "pre" && Number.isFinite(t) && t >= nextStart - 24 * 3_600_000 && t < nextStart;
    })
    .sort((a, b) => Date.parse(a.tipOffIso) - Date.parse(b.tipOffIso));
  const tomorrow = build(nextStart);
  return tomorrow.games.length > 0 ? { ...tomorrow, rolledToNext: true, lockedGames } : { ...today, lockedGames };
}

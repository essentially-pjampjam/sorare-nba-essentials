/** Spread (points) from which a game counts as a blowout risk for starters' minutes. */
export const BLOWOUT_SPREAD_THRESHOLD = 10;

export interface GameOddsInput {
  overUnder?: number | null;
  /** Line as ESPN reports it (usually the home team's, negative = favourite). */
  spread?: number | null;
  homeFavorite?: boolean | null;
  awayFavorite?: boolean | null;
}

export interface TeamGameOdds {
  overUnder: number;
  /** This team's spread: negative = favourite. */
  spread: number;
  impliedTeamTotal: number;
  blowoutRisk: boolean;
}

/**
 * Turns one game's ESPN odds into each side's implied team total:
 * ITT = (overUnder - teamSpread) / 2. Returns null for a side when no line is posted.
 */
export function deriveGameOdds(
  odds: GameOddsInput | null | undefined,
): { home: TeamGameOdds; away: TeamGameOdds } | null {
  if (!odds) return null;
  const ou = odds.overUnder;
  const raw = odds.spread;
  if (typeof ou !== "number" || !Number.isFinite(ou) || ou <= 0) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const mag = Math.abs(raw);
  let homeFavored: boolean;
  if (odds.homeFavorite === true) homeFavored = true;
  else if (odds.awayFavorite === true) homeFavored = false;
  else homeFavored = raw <= 0;
  const homeSpread = homeFavored ? -mag : mag;
  const blowoutRisk = mag >= BLOWOUT_SPREAD_THRESHOLD;
  const side = (spread: number): TeamGameOdds => ({
    overUnder: ou,
    spread,
    impliedTeamTotal: Math.round(((ou - spread) / 2) * 100) / 100,
    blowoutRisk,
  });
  return { home: side(homeSpread), away: side(-homeSpread) };
}

/** True when any two game dates (YYYY-MM-DD) are consecutive days. */
export function hasBackToBackDates(dates: string[]): boolean {
  const sorted = [...new Set(dates)].sort();
  for (let i = 1; i < sorted.length; i += 1) {
    const diff = Date.parse(sorted[i]) - Date.parse(sorted[i - 1]);
    if (diff > 0 && diff <= 86_400_000 * 1.1) return true;
  }
  return false;
}

/** Whether a game tip-off falls inside the Game Week range [start, end]. */
export function isInGameWeekRange(
  tipOffIso: string | null | undefined,
  range: { startIso: string; endIso: string } | null | undefined,
): boolean {
  if (!range) return true;
  const t = Date.parse(tipOffIso ?? "");
  const a = Date.parse(range.startIso);
  const b = Date.parse(range.endIso);
  if (!Number.isFinite(t) || !Number.isFinite(a) || !Number.isFinite(b)) return true;
  return t >= a && t <= b;
}

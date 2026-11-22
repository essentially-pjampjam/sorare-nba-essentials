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

/** Standard normal PDF. */
function stdNormalPdf(z: number): number {
  return 0.3989422804014327 * Math.exp(-0.5 * z * z);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
function stdNormalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = stdNormalPdf(z);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * Exact Clark (1961) first-two-moments reduction of max(X1, X2) for independent
 * normals X1 ~ N(m1, s1^2), X2 ~ N(m2, s2^2).
 */
function maxTwoNormals(
  m1: number,
  s1: number,
  m2: number,
  s2: number,
): { mean: number; sd: number } {
  const theta = Math.sqrt(s1 * s1 + s2 * s2);
  if (theta <= 1e-9) {
    return { mean: Math.max(m1, m2), sd: 0 };
  }
  const alpha = (m1 - m2) / theta;
  const phiA = stdNormalPdf(alpha);
  const PhiA = stdNormalCdf(alpha);
  const PhiNegA = 1 - PhiA;
  const mean = m1 * PhiA + m2 * PhiNegA + theta * phiA;
  const secondMoment =
    (m1 * m1 + s1 * s1) * PhiA +
    (m2 * m2 + s2 * s2) * PhiNegA +
    (m1 + m2) * theta * phiA;
  const variance = Math.max(0, secondMoment - mean * mean);
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * Computes E[max(X_1, ..., X_k)] for independent game scores X_i ~ N(mu_i, (mu_i * cv)^2)
 * using recursive Clark moment matching. Exact for k=1 and k=2, and within <1% for k=3..4.
 * Used for Sorare NBA "best single game of the Game Week" scoring with per-game Vegas/B2B multipliers.
 */
export function computePeakOrderStatistic(gameMeans: number[], cv = 0.35): number {
  const valid = gameMeans.filter((m) => Number.isFinite(m) && m > 0);
  if (valid.length === 0) return 0;
  if (valid.length === 1) return valid[0];
  const safeCv = Math.max(0.05, Math.min(0.8, cv));
  // Sort descending so recursive Clark approximation stays maximally accurate
  const sorted = [...valid].sort((a, b) => b - a);
  let accMean = sorted[0];
  let accSd = sorted[0] * safeCv;
  for (let i = 1; i < sorted.length; i += 1) {
    const nextMean = sorted[i];
    const nextSd = nextMean * safeCv;
    const next = maxTwoNormals(accMean, accSd, nextMean, nextSd);
    accMean = next.mean;
    accSd = next.sd;
  }
  return accMean;
}

export interface PerGamePeakInput {
  impliedTeamTotal?: number | null;
  spread?: number | null;
  blowoutRisk?: boolean;
  isBackToBack?: boolean;
}

/**
 * Computes the effective peak-of-GW multiplier from per-game Vegas ITT, blowout, and B2B contexts
 * relative to a 1.0 baseline single-game score, using exact order statistics across each game.
 */
export function computePerGamePeakMultiplier(
  games: PerGamePeakInput[],
  options: {
    leagueAvgTotal?: number;
    ittElasticity?: number;
    b2bMultiplier?: number;
    blowoutMultiplier?: number;
    blowoutSpread?: number;
    cv?: number;
  } = {},
): number {
  if (games.length === 0) return 0;
  const leagueAvg = options.leagueAvgTotal ?? 114.5;
  const elasticity = options.ittElasticity ?? 0.5;
  const b2bMult = options.b2bMultiplier ?? 0.96;
  const blowoutMult = options.blowoutMultiplier ?? 0.97;
  const blowoutSpread = options.blowoutSpread ?? BLOWOUT_SPREAD_THRESHOLD;
  const cv = options.cv ?? 0.35;

  const perGameMeans = games.map((g) => {
    const itt =
      typeof g.impliedTeamTotal === "number" && Number.isFinite(g.impliedTeamTotal)
        ? g.impliedTeamTotal
        : null;
    const vegasRaw = itt !== null ? 1 + ((itt - leagueAvg) / leagueAvg) * elasticity : 1;
    const vegas = Math.min(1.1, Math.max(0.9, vegasRaw));
    const isBlowout =
      g.blowoutRisk === true ||
      (typeof g.spread === "number" && Math.abs(g.spread) >= blowoutSpread);
    const rest = (g.isBackToBack ? b2bMult : 1) * (isBlowout ? blowoutMult : 1);
    return vegas * rest;
  });

  // Cap at 1.40 so extreme 4G shootouts never distort projections unrealistically
  const rawPeak = computePeakOrderStatistic(perGameMeans, cv);
  return Math.min(1.4, Math.max(0.82, Math.round(rawPeak * 1000) / 1000));
}

import type { LeaderboardRewardTier } from "../shared/types";

/**
 * Pure, field-calibrated contest EV math for Recommended Entry.
 *
 * Model: a lineup's Game Week score ~ Normal(mean, sd). Each player's score has a
 * coefficient of variation (CV) of ~0.35 (NBA fantasy box scores are noisy; best-game-of-week
 * scoring trims the downside a little). Teammates in the same lineup have a slight negative
 * correlation (-0.05) because they compete for a fixed pool of shots, usage, and rebounds.
 *
 * Probabilities of clearing the field's reward cutoff, top-20% line and podium line come
 * from the latest closed Game Week benchmarks. EV weights follow Sorare's top-heavy payout
 * curves (podium pays far more than a min-cash), so EV is not just "cash odds".
 */

export const PLAYER_SCORE_CV = 0.35;
export const SAME_TEAM_CORRELATION = -0.05;
/** Below this cash probability (%) a contest is not worth recommending. */
export const MIN_VIABLE_CASH_PCT = 5;

/** Relative payout-curve value of reaching each band (min-cash = 1). */
export const PAYOUT_CURVE_WEIGHTS = { cash: 1, top20: 1.5, podium: 6 } as const;

export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.39894228 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

export interface LineupSpreadInput {
  projectedScore: number;
  teamSlug?: string | null;
}

/** Lineup standard deviation from per-player CV plus same-team correlation. */
export function lineupStdDev(
  players: LineupSpreadInput[],
  cv: number = PLAYER_SCORE_CV,
  sameTeamRho: number = SAME_TEAM_CORRELATION,
): number {
  const sds = players.map((p) => Math.max(0, p.projectedScore) * cv);
  let variance = 0;
  for (let i = 0; i < players.length; i += 1) {
    variance += sds[i] * sds[i];
    for (let j = i + 1; j < players.length; j += 1) {
      const sameTeam =
        Boolean(players[i].teamSlug) && players[i].teamSlug === players[j].teamSlug;
      if (sameTeam) variance += 2 * sameTeamRho * sds[i] * sds[j];
    }
  }
  return Math.sqrt(Math.max(0, variance));
}

/** P(score >= target) in percent, clamped to [0, 99.9]. */
export function probabilityAtLeast(mean: number, sd: number, target: number): number {
  if (!Number.isFinite(mean) || !Number.isFinite(target)) return 0;
  if (sd <= 0) return mean >= target ? 99.9 : 0;
  const z = (mean - target) / sd;
  const pct = normalCdf(z) * 100;
  return Math.max(0, Math.min(99.9, pct));
}

export interface ContestThresholds {
  cashScore: number;
  top20Score: number;
  podiumScore: number;
}

/** Builds ascending thresholds from benchmark lines, filling gaps with sensible ratios. */
export function buildContestThresholds(input: {
  paidCutoffScore: number | null | undefined;
  top20Score?: number | null;
  podiumScore?: number | null;
  top1Score?: number | null;
  fallbackCash: number;
  fallbackTop20: number;
  fallbackPodium: number;
}): ContestThresholds {
  const valid = (n: number | null | undefined): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;
  const cashScore = valid(input.paidCutoffScore) ? input.paidCutoffScore : input.fallbackCash;
  const top20Raw = valid(input.top20Score)
    ? input.top20Score
    : valid(input.paidCutoffScore)
      ? cashScore * 1.12
      : input.fallbackTop20;
  const podiumRaw = valid(input.podiumScore)
    ? input.podiumScore
    : valid(input.top1Score)
      ? input.top1Score
      : valid(input.paidCutoffScore)
        ? cashScore * 1.35
        : input.fallbackPodium;
  const top20Score = Math.max(cashScore, top20Raw);
  const podiumScore = Math.max(top20Score, podiumRaw);
  return { cashScore, top20Score, podiumScore };
}

export interface ContestEvResult {
  cashProb: number;
  top20Prob: number;
  podiumProb: number;
  expectedValueScore: number;
  viable: boolean;
}

/** Field-calibrated EV of one lineup in one contest. Monotonic: podium <= top20 <= cash. */
export function evaluateContestEv(
  mean: number | null,
  sd: number,
  thresholds: ContestThresholds,
): ContestEvResult {
  if (mean === null || !Number.isFinite(mean) || mean <= 0) {
    return { cashProb: 0, top20Prob: 0, podiumProb: 0, expectedValueScore: 0, viable: false };
  }
  const cashProb = round1(probabilityAtLeast(mean, sd, thresholds.cashScore));
  const top20Prob = round1(Math.min(cashProb, probabilityAtLeast(mean, sd, thresholds.top20Score)));
  const podiumProb = round1(Math.min(top20Prob, probabilityAtLeast(mean, sd, thresholds.podiumScore)));
  const expectedValueScore = round1(
    cashProb * PAYOUT_CURVE_WEIGHTS.cash +
      top20Prob * PAYOUT_CURVE_WEIGHTS.top20 +
      podiumProb * PAYOUT_CURVE_WEIGHTS.podium,
  );
  return {
    cashProb,
    top20Prob,
    podiumProb,
    expectedValueScore,
    viable: cashProb >= MIN_VIABLE_CASH_PCT,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parses numeric USD or Essence from a reward tier, falling back to label parsing
 * when older cached benchmarks lack cashUsd / essenceQty.
 */
function parseTierRewardAmounts(tier: LeaderboardRewardTier): { cashUsd: number; essenceQty: number } {
  if (tier.kind === "cash") {
    if (typeof tier.cashUsd === "number" && Number.isFinite(tier.cashUsd)) {
      return { cashUsd: Math.max(0, tier.cashUsd), essenceQty: 0 };
    }
    const m = tier.label.replace(/,/g, "").match(/\$([0-9]+(?:\.[0-9]+)?)/);
    return { cashUsd: m ? Number(m[1]) || 0 : 0, essenceQty: 0 };
  }
  if (tier.kind === "essence") {
    if (typeof tier.essenceQty === "number" && Number.isFinite(tier.essenceQty)) {
      return { cashUsd: 0, essenceQty: Math.max(0, tier.essenceQty) };
    }
    const m = tier.label.replace(/,/g, "").match(/([0-9]+)/);
    return { cashUsd: 0, essenceQty: m ? Number(m[1]) || 0 : 0 };
  }
  return { cashUsd: 0, essenceQty: 0 };
}

export interface TierRewardEvSlice {
  tier: LeaderboardRewardTier;
  /** Probability (%) of landing strictly inside [fromRank, toRank]. */
  probPct: number;
  /** Expected USD cash contribution from this tier. */
  evCashUsd: number;
  /** Expected Essence contribution from this tier. */
  evEssence: number;
}

export interface TierRewardEvSummary {
  expectedCashUsd: number;
  expectedEssence: number;
  tierSlices: TierRewardEvSlice[];
}

/**
 * Estimates Dollar ($) and Essence EV directly from live Sorare `rewardTiers` and
 * closed-GW benchmark score anchors (`paidCutoffScore`, `podiumScore`, `top1Score`).
 *
 * Maps each rank boundary `r` in `[1..paidPlaces]` onto a score threshold using
 * log-rank interpolation between `top1Score`, `podiumScore` (rank 3), and `paidCutoffScore`
 * (last paid rank), then evaluates `P(score in [loScore, hiScore))` via `normalCdf`.
 */
export function estimateTierRewardEv(input: {
  mean: number | null;
  sd: number;
  paidPlaces: number;
  paidCutoffScore: number;
  podiumScore?: number | null;
  top1Score?: number | null;
  rewardTiers?: LeaderboardRewardTier[] | null;
}): TierRewardEvSummary {
  const tiers = (input.rewardTiers ?? []).filter((t) => t.kind === "cash" || t.kind === "essence");
  if (
    input.mean === null ||
    !Number.isFinite(input.mean) ||
    input.mean <= 0 ||
    tiers.length === 0 ||
    !Number.isFinite(input.paidCutoffScore) ||
    input.paidCutoffScore <= 0
  ) {
    return { expectedCashUsd: 0, expectedEssence: 0, tierSlices: [] };
  }

  const maxPaidRank = Math.max(
    1,
    input.paidPlaces || 0,
    ...tiers.map((t) => t.toRank),
  );
  const cashCut = input.paidCutoffScore;
  const podium =
    typeof input.podiumScore === "number" && Number.isFinite(input.podiumScore) && input.podiumScore > cashCut
      ? input.podiumScore
      : cashCut * 1.35;
  const top1 =
    typeof input.top1Score === "number" && Number.isFinite(input.top1Score) && input.top1Score >= podium
      ? input.top1Score
      : podium * 1.07;

  // Score required to finish at rank <= r (monotonically decreasing in r)
  const scoreForRank = (rank: number): number => {
    if (rank <= 1) return top1;
    if (rank >= maxPaidRank) return cashCut;
    if (rank <= 3) {
      const frac = Math.log(rank) / Math.log(3);
      return top1 - (top1 - podium) * frac;
    }
    const denom = Math.log(Math.max(4, maxPaidRank) / 3);
    const frac = denom > 0 ? Math.log(rank / 3) / denom : 1;
    return podium - (podium - cashCut) * Math.min(1, Math.max(0, frac));
  };

  let expectedCashUsd = 0;
  let expectedEssence = 0;
  const tierSlices: TierRewardEvSlice[] = [];

  for (const tier of tiers) {
    const loScore = scoreForRank(tier.toRank);
    // Upper bound is the score of finishing better than fromRank (fromRank - 1), or +Infinity for rank 1
    const pAtLeastLo = probabilityAtLeast(input.mean, input.sd, loScore) / 100;
    const pBetterThanFrom =
      tier.fromRank <= 1
        ? 0
        : probabilityAtLeast(input.mean, input.sd, scoreForRank(tier.fromRank - 1)) / 100;
    const prob = Math.max(0, Math.min(1, pAtLeastLo - pBetterThanFrom));
    const { cashUsd, essenceQty } = parseTierRewardAmounts(tier);
    const evCash = prob * cashUsd;
    const evEss = prob * essenceQty;
    expectedCashUsd += evCash;
    expectedEssence += evEss;
    tierSlices.push({
      tier,
      probPct: round1(prob * 100),
      evCashUsd: round2(evCash),
      evEssence: round1(evEss),
    });
  }

  return {
    expectedCashUsd: round2(expectedCashUsd),
    expectedEssence: round1(expectedEssence),
    tierSlices,
  };
}

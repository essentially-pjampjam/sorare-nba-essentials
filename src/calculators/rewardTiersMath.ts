import type { LeaderboardRewardTier, RewardTierKind } from "../shared/types";

/** One `So5Leaderboard.rewardsConfig.ranking[]` row as returned by Sorare (`ranks` = places in the tier). */
export interface RawRankReward {
  ranks?: number | null;
  rewardConfigs?: Array<{
    __typename?: string;
    amount?: { usdCents?: number | null; eurCents?: number | null } | number | null;
    quantity?: number | null;
    currency?: string | null;
  }> | null;
}

export interface RewardTierSummary {
  tiers: LeaderboardRewardTier[];
  /** Last rank that pays cash (0 = no cash tiers). */
  cashPlaces: number;
  /** Last rank that pays cash or Essence (XP-only ranks are participation rewards). */
  paidPlaces: number;
  topCashLabel: string | null;
}

const dollars = (cents: number): string => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * Live reward tiers (checked 2026-11-19): `MonetaryRewardConfig` = cash, `CardShardRewardConfig` =
 * Essence, `InGameCurrencyRewardConfig` = XP. Rows without typed configs (no-API-key fallback query)
 * count as paid "Reward" ranks, like before typed tiers existed.
 */
export function summarizeRewardTiers(ranking: RawRankReward[] | null | undefined): RewardTierSummary {
  const tiers: LeaderboardRewardTier[] = [];
  let rank = 0;
  let cashPlaces = 0;
  let paidPlaces = 0;
  let topCash = 0;
  for (const r of ranking ?? []) {
    const n = Math.max(0, Number(r.ranks ?? 0) || 0);
    if (n === 0) continue;
    const cfgs = r.rewardConfigs ?? [];
    const money = cfgs.find((x) => x.__typename === "MonetaryRewardConfig");
    const shard = cfgs.find((x) => x.__typename === "CardShardRewardConfig");
    const xp = cfgs.find((x) => x.__typename === "InGameCurrencyRewardConfig");
    let kind: RewardTierKind = "other";
    let label = "Reward";
    if (money && typeof money.amount === "object" && money.amount) {
      const cents = money.amount.usdCents ?? money.amount.eurCents ?? 0;
      kind = "cash";
      label = dollars(cents);
      topCash = Math.max(topCash, cents);
    } else if (shard) {
      kind = "essence";
      label = `${(shard.quantity ?? 0).toLocaleString("en-US")} Essence`;
    } else if (xp) {
      kind = "xp";
      label = `${typeof xp.amount === "number" ? xp.amount.toLocaleString("en-US") : ""} XP`.trim();
    }
    tiers.push({ fromRank: rank + 1, toRank: rank + n, kind, label });
    rank += n;
    if (kind === "cash") cashPlaces = rank;
    if (kind !== "xp") paidPlaces = rank;
  }
  return { tiers, cashPlaces, paidPlaces, topCashLabel: topCash > 0 ? dollars(topCash) : null };
}

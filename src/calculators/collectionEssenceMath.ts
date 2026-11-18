import { SORARE_NBA_MARKET_URL } from "../shared/constants";
import type {
  CardMarketPrice,
  CollectionAnalysis,
  CollectionRaw,
  EssenceMilestoneRule,
  MissingPlayerOpportunity,
  MissingSlot,
  NextEssenceMilestone,
} from "../shared/types";

export interface AnalyzeCollectionsInput {
  collections: CollectionRaw[];
  missingSlotsByCollection: Record<string, MissingSlot[]>;
  marketPrices: Record<string, CardMarketPrice>;
  milestoneRules: EssenceMilestoneRule[];
  currentEssenceBalance: number;
  craftThreshold: number;
  milestoneSource?: "live_session" | "preset";
}

export interface PortfolioSummary {
  totalEssenceEarnable: number;
  cheapestNextMilestone: CollectionAnalysis | null;
  bestEfficiencyPick: CollectionAnalysis | null;
  craftReadyMatches: CollectionAnalysis[];
  remainingEssenceGap: number;
}

export function buildMarketPriceKey(
  playerSlug: string,
  rarity: string,
  seasonYear: number | null,
): string {
  return `${playerSlug}::${rarity}::${seasonYear ?? "any"}`;
}

export function resolveFallbackMarketUrl(slot: MissingSlot): string {
  if (slot.transferMarketFilters) {
    return `${SORARE_NBA_MARKET_URL}?${slot.transferMarketFilters}`;
  }
  return `${SORARE_NBA_MARKET_URL}?rarity=${encodeURIComponent(slot.rarity)}`;
}

/**
 * Builds an overlap map counting how many incomplete collections need each player.
 */
export function buildPlayerOverlapIndex(
  collections: CollectionRaw[],
  missingSlotsByCollection: Record<string, MissingSlot[]>,
): Map<string, Array<{ slug: string; name: string }>> {
  const overlapMap = new Map<string, Array<{ slug: string; name: string }>>();

  for (const col of collections) {
    if (col.complete) continue;
    const slots = missingSlotsByCollection[col.slug] ?? [];
    const seenPlayersInCollection = new Set<string>();

    for (const slot of slots) {
      if (seenPlayersInCollection.has(slot.playerSlug)) continue;
      seenPlayersInCollection.add(slot.playerSlug);

      const list = overlapMap.get(slot.playerSlug) ?? [];
      list.push({ slug: col.slug, name: col.name });
      overlapMap.set(slot.playerSlug, list);
    }
  }

  return overlapMap;
}

function findApplicableRules(
  collection: CollectionRaw,
  rules: EssenceMilestoneRule[],
): EssenceMilestoneRule[] {
  const valid = rules
    .filter((r) => {
      if (r.kind === "slots") {
        return r.threshold > 0 && r.threshold <= Math.max(1, collection.slotsCount);
      }
      return r.threshold > 0;
    })
    .sort((a, b) => a.threshold - b.threshold);

  return valid;
}

function findMarketPrice(
  slot: MissingSlot,
  marketPrices: Record<string, CardMarketPrice>,
): CardMarketPrice | null {
  const exactKey = buildMarketPriceKey(slot.playerSlug, slot.rarity, slot.seasonYear);
  if (marketPrices[exactKey]) return marketPrices[exactKey];

  const anySeasonKey = buildMarketPriceKey(slot.playerSlug, slot.rarity, null);
  return marketPrices[anySeasonKey] ?? null;
}

function compareOpportunities(
  a: MissingPlayerOpportunity,
  b: MissingPlayerOpportunity,
): number {
  const aInstant = a.instantBuyCents;
  const bInstant = b.instantBuyCents;

  if (aInstant !== null && bInstant !== null) {
    if (aInstant !== bInstant) return aInstant - bInstant;
  } else if (aInstant !== null) {
    return -1;
  } else if (bInstant !== null) {
    return 1;
  }

  // Secondary sort: lowest active auction bid if neither has instant buy (or tied)
  const aAuction = a.auctionBidCents;
  const bAuction = b.auctionBidCents;
  if (aAuction !== null && bAuction !== null && aAuction !== bAuction) {
    return aAuction - bAuction;
  }
  if (aAuction !== null && bAuction === null) return -1;
  if (aAuction === null && bAuction !== null) return 1;

  // Tie-breaker: players advancing more collections come first
  if (a.overlapCount !== b.overlapCount) {
    return b.overlapCount - a.overlapCount;
  }

  return a.slot.playerName.localeCompare(b.slot.playerName);
}

function computeCardSetCosts(
  opportunities: MissingPlayerOpportunity[],
  cardsNeeded: number,
): {
  totalCostCents: number | null;
  auctionAssistedCostCents: number | null;
} {
  const instantBuyEligible = opportunities.filter(
    (op) => op.instantBuyCents !== null,
  );
  const totalCostCents =
    instantBuyEligible.length >= cardsNeeded
      ? instantBuyEligible
          .slice(0, cardsNeeded)
          .reduce((sum, op) => sum + (op.instantBuyCents ?? 0), 0)
      : null;

  const auctionAssistedPrices = opportunities
    .map((op) => {
      if (op.instantBuyCents !== null && op.auctionBidCents !== null) {
        return Math.min(op.instantBuyCents, op.auctionBidCents);
      }
      return op.instantBuyCents ?? op.auctionBidCents;
    })
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);

  const auctionAssistedCostCents =
    auctionAssistedPrices.length >= cardsNeeded
      ? auctionAssistedPrices
          .slice(0, cardsNeeded)
          .reduce((sum, p) => sum + p, 0)
      : null;

  return { totalCostCents, auctionAssistedCostCents };
}

/**
 * Pure calculator producing per-collection Essence milestone evaluations,
 * team Bonus % floor costs, cost/Essence efficiency, and multi-collection Overlap badges.
 */
export function analyzeCollections(input: AnalyzeCollectionsInput): {
  analyses: CollectionAnalysis[];
  summary: PortfolioSummary;
} {
  const {
    collections,
    missingSlotsByCollection,
    marketPrices,
    milestoneRules,
    currentEssenceBalance,
    craftThreshold,
    milestoneSource = "preset",
  } = input;

  const remainingEssenceGap = Math.max(0, craftThreshold - currentEssenceBalance);
  const overlapIndex = buildPlayerOverlapIndex(collections, missingSlotsByCollection);

  const analyses: CollectionAnalysis[] = collections
    .filter((c) => !c.complete)
    .map((collection) => {
      const rawSlots = missingSlotsByCollection[collection.slug] ?? [];

      const opportunities: MissingPlayerOpportunity[] = rawSlots
        .map((slot) => {
          const market = findMarketPrice(slot, marketPrices);
          const overlapping = overlapIndex.get(slot.playerSlug) ?? [
            { slug: collection.slug, name: collection.name },
          ];
          const instantBuyCents = market?.instantBuyCents ?? null;
          const auctionBidCents = market?.auctionBidCents ?? null;
          const targetUrl =
            market?.instantBuyUrl ??
            market?.auctionUrl ??
            resolveFallbackMarketUrl(slot);

          return {
            slot,
            market,
            instantBuyCents,
            auctionBidCents,
            targetUrl,
            overlapCount: overlapping.length,
            overlappingCollections: overlapping,
          };
        })
        .sort(compareOpportunities);

      const instantBuyEligible = opportunities.filter(
        (op) => op.instantBuyCents !== null,
      );
      const cheapestCardCents = instantBuyEligible[0]?.instantBuyCents ?? null;

      // Next live collection bonus threshold
      const sortedBonuses = [...collection.bonusThresholds].sort(
        (a, b) => a.threshold - b.threshold,
      );
      const nextBonus = sortedBonuses.find((bt) => bt.threshold > collection.score) ?? null;
      const nextBonusThreshold = nextBonus
        ? (() => {
            const scoreNeeded = Math.max(
              0,
              Math.ceil(nextBonus.threshold - collection.score),
            );
            const instantBuyCardsNeeded = Math.max(1, Math.ceil(scoreNeeded / 10));
            const firstOwnerCardsNeeded = Math.max(1, Math.ceil(scoreNeeded / 20));
            const bonusCosts = computeCardSetCosts(
              opportunities,
              instantBuyCardsNeeded,
            );
            return {
              threshold: nextBonus.threshold,
              bonus: nextBonus.bonus,
              scoreNeeded,
              instantBuyCardsNeeded,
              firstOwnerCardsNeeded,
              totalCostCents: bonusCosts.totalCostCents,
              auctionAssistedCostCents: bonusCosts.auctionAssistedCostCents,
            };
          })()
        : null;

      const applicableRules = findApplicableRules(collection, milestoneRules);
      const unreachedRules = applicableRules.filter((rule) => {
        const currentVal =
          rule.kind === "slots" ? collection.fulfilledSlotsCount : collection.score;
        return rule.threshold > currentVal;
      });

      const totalEssenceRemaining = unreachedRules.reduce(
        (sum, r) => sum + r.essenceReward,
        0,
      );

      const nextRule = unreachedRules[0] ?? null;
      let nextEssenceMilestone: NextEssenceMilestone | null = null;

      if (nextRule) {
        const currentValue =
          nextRule.kind === "slots" ? collection.fulfilledSlotsCount : collection.score;
        // Conservative estimate for score-based rules: assume >=10 base collection pts per owned card
        const rawNeeded =
          nextRule.kind === "slots"
            ? nextRule.threshold - currentValue
            : Math.ceil((nextRule.threshold - currentValue) / 10);

        const cardsNeeded = Math.max(1, rawNeeded);

        const { totalCostCents, auctionAssistedCostCents } = computeCardSetCosts(
          opportunities,
          cardsNeeded,
        );

        const costPerEssenceCents =
          totalCostCents !== null && nextRule.essenceReward > 0
            ? totalCostCents / nextRule.essenceReward
            : null;

        const isCraftReadyBridge =
          remainingEssenceGap > 0 && nextRule.essenceReward >= remainingEssenceGap;

        nextEssenceMilestone = {
          label: nextRule.label,
          kind: nextRule.kind,
          targetValue: nextRule.threshold,
          currentValue,
          cardsNeeded,
          essenceRewarded: nextRule.essenceReward,
          totalCostCents,
          costPerEssenceCents,
          auctionAssistedCostCents,
          rankedShoppingList: opportunities,
          pricedInstantBuyCount: instantBuyEligible.length,
          missingCount: opportunities.length,
          isCraftReadyBridge,
          source: milestoneSource,
        };
      }

      return {
        collection,
        nextBonusThreshold,
        nextEssenceMilestone,
        totalEssenceRemaining,
        missingSlotsCount: opportunities.length,
        opportunities,
        cheapestCardCents,
        pricedInstantBuyCount: instantBuyEligible.length,
      };
    });

  const pricedAnalyses = analyses.filter(
    (a) => a.nextEssenceMilestone?.totalCostCents !== null && a.nextEssenceMilestone !== null,
  );

  const cheapestNextMilestone =
    [...pricedAnalyses].sort(
      (a, b) =>
        (a.nextEssenceMilestone?.totalCostCents ?? Number.MAX_SAFE_INTEGER) -
        (b.nextEssenceMilestone?.totalCostCents ?? Number.MAX_SAFE_INTEGER),
    )[0] ?? null;

  const bestEfficiencyPick =
    [...pricedAnalyses].sort(
      (a, b) =>
        (a.nextEssenceMilestone?.costPerEssenceCents ?? Number.MAX_SAFE_INTEGER) -
        (b.nextEssenceMilestone?.costPerEssenceCents ?? Number.MAX_SAFE_INTEGER),
    )[0] ?? null;

  const craftReadyMatches = pricedAnalyses
    .filter((a) => a.nextEssenceMilestone?.isCraftReadyBridge)
    .sort(
      (a, b) =>
        (a.nextEssenceMilestone?.totalCostCents ?? Number.MAX_SAFE_INTEGER) -
        (b.nextEssenceMilestone?.totalCostCents ?? Number.MAX_SAFE_INTEGER),
    );

  const totalEssenceEarnable = analyses.reduce(
    (sum, a) => sum + a.totalEssenceRemaining,
    0,
  );

  return {
    analyses,
    summary: {
      totalEssenceEarnable,
      cheapestNextMilestone,
      bestEfficiencyPick,
      craftReadyMatches,
      remainingEssenceGap,
    },
  };
}

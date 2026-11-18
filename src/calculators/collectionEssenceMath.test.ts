import { describe, expect, it } from "vitest";
import {
  analyzeCollections,
  buildMarketPriceKey,
} from "./collectionEssenceMath";
import type {
  CardMarketPrice,
  CollectionRaw,
  EssenceMilestoneRule,
  MissingSlot,
} from "../shared/types";

function makeCollection(overrides: Partial<CollectionRaw> = {}): CollectionRaw {
  return {
    slug: "team-a-limited-2026-27",
    name: "Team A Limited 2026-27",
    rarity: "limited",
    inSeason: true,
    teamName: "Team A",
    teamSlug: "team-a",
    bonusThresholds: [
      { threshold: 100, bonus: 0.02 },
      { threshold: 200, bonus: 0.03 },
    ],
    score: 80,
    complete: false,
    fulfilledSlotsCount: 3,
    slotsCount: 15,
    ownedPlayersCount: 3,
    totalPlayersCount: 15,
    bonus: 0.01,
    ...overrides,
  };
}

function makeSlot(
  collectionSlug: string,
  collectionName: string,
  playerSlug: string,
  playerName: string,
): MissingSlot {
  return {
    slotId: `${collectionSlug}:${playerSlug}`,
    collectionSlug,
    collectionName,
    playerSlug,
    playerName,
    teamName: "Team A",
    teamSlug: "team-a",
    rarity: "limited",
    seasonYear: 2026,
    displayedRequirements: "limited only",
    transferMarketFilters: `player=${encodeURIComponent(playerName)}&rarity=limited&season=2026`,
  };
}

function makePrice(
  playerSlug: string,
  instantBuyCents: number | null,
  auctionBidCents: number | null = null,
): [string, CardMarketPrice] {
  const key = buildMarketPriceKey(playerSlug, "limited", 2026);
  return [
    key,
    {
      key,
      playerSlug,
      rarity: "limited",
      seasonYear: 2026,
      instantBuyCents,
      instantBuyCurrency: instantBuyCents !== null ? "USD" : null,
      instantBuyCardSlug: instantBuyCents !== null ? `${playerSlug}-card` : null,
      instantBuyUrl:
        instantBuyCents !== null
          ? `https://sorare.com/nba/cards/${playerSlug}-card`
          : null,
      auctionBidCents,
      auctionCurrency: auctionBidCents !== null ? "USD" : null,
      auctionCardSlug: auctionBidCents !== null ? `${playerSlug}-auc` : null,
      auctionEndDate: null,
      auctionBidsCount: auctionBidCents !== null ? 1 : null,
      auctionUrl:
        auctionBidCents !== null
          ? `https://sorare.com/nba/cards/${playerSlug}-auc`
          : null,
      excludedBundlesCount: 0,
      fetchedAt: Date.now(),
    },
  ];
}

const RULES: EssenceMilestoneRule[] = [
  { id: "t5", label: "5 Cards", kind: "slots", threshold: 5, essenceReward: 150 },
  { id: "t10", label: "10 Cards", kind: "slots", threshold: 10, essenceReward: 350 },
];

describe("collectionEssenceMath", () => {
  it("computes cheapest N cards cost, cost/Essence, Craft Ready bridge, and Overlap", () => {
    const colA = makeCollection({
      slug: "hornets-limited-2026-27",
      name: "Charlotte Hornets Limited 2026-27",
      fulfilledSlotsCount: 3, // needs 2 cards for t5 (+150E)
      slotsCount: 15,
    });
    const colB = makeCollection({
      slug: "special-limited-2026-27",
      name: "East Rookies Limited 2026-27",
      fulfilledSlotsCount: 6, // needs 4 cards for t10 (+350E)
      slotsCount: 12,
    });

    const missingSlotsByCollection: Record<string, MissingSlot[]> = {
      [colA.slug]: [
        makeSlot(colA.slug, colA.name, "p1", "Player One"),
        makeSlot(colA.slug, colA.name, "p2", "Player Two"),
        makeSlot(colA.slug, colA.name, "p3", "Player Three"),
      ],
      [colB.slug]: [
        makeSlot(colB.slug, colB.name, "p2", "Player Two"), // overlaps colA!
        makeSlot(colB.slug, colB.name, "p4", "Player Four"),
        makeSlot(colB.slug, colB.name, "p5", "Player Five"),
        makeSlot(colB.slug, colB.name, "p6", "Player Six"),
      ],
    };

    const marketPrices = Object.fromEntries([
      makePrice("p1", 500),
      makePrice("p2", 150, 90), // cheaper auction preview
      makePrice("p3", 200),
      makePrice("p4", 100),
      makePrice("p5", 100),
      makePrice("p6", 100),
    ]);

    const { analyses, summary } = analyzeCollections({
      collections: [colA, colB],
      missingSlotsByCollection,
      marketPrices,
      milestoneRules: RULES,
      currentEssenceBalance: 700, // 300 needed to hit 1,000
      craftThreshold: 1000,
    });

    expect(summary.remainingEssenceGap).toBe(300);
    // colA remaining: 150 + 350 = 500; colB remaining: 350 => 850 total
    expect(summary.totalEssenceEarnable).toBe(850);

    const aAnalysis = analyses.find((a) => a.collection.slug === colA.slug)!;
    const bAnalysis = analyses.find((a) => a.collection.slug === colB.slug)!;

    // Collection score bonus card math: 2nd (+10) vs 1st (+20)
    expect(aAnalysis.nextBonusThreshold?.scoreNeeded).toBe(20);
    expect(aAnalysis.nextBonusThreshold?.instantBuyCardsNeeded).toBe(2);
    expect(aAnalysis.nextBonusThreshold?.firstOwnerCardsNeeded).toBe(1);

    // colA needs 2 cards -> cheapest 2 are p2 (150c) + p3 (200c) = 350c
    expect(aAnalysis.nextEssenceMilestone?.cardsNeeded).toBe(2);
    expect(aAnalysis.nextEssenceMilestone?.totalCostCents).toBe(350);
    expect(aAnalysis.nextEssenceMilestone?.auctionAssistedCostCents).toBe(290); // 90c + 200c
    expect(aAnalysis.nextEssenceMilestone?.costPerEssenceCents).toBeCloseTo(350 / 150, 4);
    expect(aAnalysis.nextEssenceMilestone?.isCraftReadyBridge).toBe(false); // 150 < 300

    // Overlap badge on p2 in both collections
    const p2InA = aAnalysis.nextEssenceMilestone?.rankedShoppingList.find(
      (op) => op.slot.playerSlug === "p2",
    );
    expect(p2InA?.overlapCount).toBe(2);
    expect(p2InA?.overlappingCollections).toHaveLength(2);

    // colB needs 4 cards (100+100+100+150 = 450c) for +350E -> bridges 300 gap!
    expect(bAnalysis.nextEssenceMilestone?.totalCostCents).toBe(450);
    expect(bAnalysis.nextEssenceMilestone?.isCraftReadyBridge).toBe(true);
    expect(summary.craftReadyMatches.map((m) => m.collection.slug)).toEqual([
      colB.slug,
    ]);
    expect(summary.bestEfficiencyPick?.collection.slug).toBe(colB.slug);
    expect(summary.cheapestNextMilestone?.collection.slug).toBe(colA.slug);
  });

  it("does not treat unlisted players as $0 and excludes auctions from Instant Buy total", () => {
    const col = makeCollection({
      fulfilledSlotsCount: 3, // needs 2 cards
      slotsCount: 15,
    });
    const missingSlotsByCollection = {
      [col.slug]: [
        makeSlot(col.slug, col.name, "p1", "Only Instant"),
        makeSlot(col.slug, col.name, "p2", "Only Auction"),
      ],
    };
    const marketPrices = Object.fromEntries([
      makePrice("p1", 300),
      makePrice("p2", null, 80), // auction only, no Instant Buy
    ]);

    const { analyses } = analyzeCollections({
      collections: [col],
      missingSlotsByCollection,
      marketPrices,
      milestoneRules: RULES,
      currentEssenceBalance: 0,
      craftThreshold: 1000,
    });

    const m = analyses[0].nextEssenceMilestone!;
    expect(m.totalCostCents).toBeNull();
    expect(m.costPerEssenceCents).toBeNull();
    expect(m.auctionAssistedCostCents).toBe(380); // 300 + 80 preview only
    expect(m.pricedInstantBuyCount).toBe(1);
  });
});

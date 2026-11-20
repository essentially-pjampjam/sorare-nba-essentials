import { describe, expect, it } from "vitest";
import { planSealBudget, rankSealDeals } from "./sealDealsMath";
import type { BargainListing } from "../shared/types";

const listing = (slug: string, priceCents: number | null, sealingPoints: number | null, extra: Partial<BargainListing> = {}): BargainListing =>
  ({
    cardSlug: slug,
    playerSlug: slug,
    playerName: slug,
    saleType: "instant_buy",
    priceCents,
    sealingPoints,
    l10: 10,
    ...extra,
  }) as BargainListing;

describe("sealing deal finder (live data 2026-11-20: 0.49 EUR cards give 1-5 points)", () => {
  it("ranks by Sealing Points per euro and skips auctions / missing data", () => {
    const deals = rankSealDeals(
      [
        listing("holiday", 49, 5),
        listing("joseph", 49, 1),
        listing("sims", 49, 2),
        listing("pricey", 500, 20),
        listing("auction", 10, 5, { saleType: "auction" }),
        listing("no-sp", 49, null),
      ],
      { ownedPlayerSlugs: new Set(["sims"]) },
    );
    expect(deals.map((d) => d.listing.playerSlug)).toEqual(["holiday", "sims", "pricey", "joseph"]);
    expect(deals[0].listing.playerSlug).toBe("holiday");
    expect(deals[0].pointsPerUnit).toBe(10.2);
    expect(deals.find((d) => d.listing.playerSlug === "sims")?.ownedPlayer).toBe(true);
    expect(deals.some((d) => d.listing.playerSlug === "auction" || d.listing.playerSlug === "no-sp")).toBe(false);
  });

  it("fills a budget with the best points per euro", () => {
    const deals = rankSealDeals([listing("a", 49, 5), listing("b", 49, 2), listing("c", 300, 20)]);
    const plan = planSealBudget(deals, 380);
    expect(plan.deals.map((d) => d.listing.playerSlug)).toEqual(["a", "c"]);
    expect(plan.totalPoints).toBe(25);
    expect(plan.totalCents).toBe(349);
  });
});

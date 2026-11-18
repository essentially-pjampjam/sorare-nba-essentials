import { describe, expect, it } from "vitest";
import { filterAndRankBargains, scoreBargainListing } from "./bargainHunterMath";
import type { BargainListing } from "../shared/types";

describe("bargainHunterMath", () => {
  it("scores Instant Buy $/L10 efficiency and rewards In-Season bonus", () => {
    const inSeason = scoreBargainListing(30, 300, true); // 10 cents/L10 + 10 bonus
    const classic = scoreBargainListing(30, 300, false); // 10 cents/L10
    expect(inSeason.centsPerL10).toBe(10);
    expect(inSeason.valueScore).toBeGreaterThan(classic.valueScore);
  });

  it("filters by minL10 and inSeasonOnly and sorts lowest $/L10 first", () => {
    const listings: BargainListing[] = [
      {
        cardSlug: "c1",
        assetId: "a1",
        playerSlug: "p1",
        playerName: "Cheap Scorer",
        teamName: "Orlando Magic",
        positions: ["basketball_guard"],
        rarity: "limited",
        seasonYear: 2026,
        inSeasonEligible: true,
        l10: 25,
        l5: 29,
        projected: 27,
        starCost: 2.5,
        saleType: "instant_buy",
        priceCents: 200,
        currency: "USD",
        endDate: null,
        bidsCount: null,
        centsPerL10: 8,
        valueScore: 94,
        marketUrl: "https://sorare.com/nba/cards/c1",
      },
      {
        cardSlug: "c2",
        assetId: "a2",
        playerSlug: "p2",
        playerName: "Overpriced Classic",
        teamName: "Miami Heat",
        positions: ["basketball_forward"],
        rarity: "limited",
        seasonYear: 2023,
        inSeasonEligible: false,
        l10: 12,
        l5: 10,
        projected: 11,
        starCost: 1.5,
        saleType: "instant_buy",
        priceCents: 600,
        currency: "USD",
        endDate: null,
        bidsCount: null,
        centsPerL10: 50,
        valueScore: 25,
        marketUrl: "https://sorare.com/nba/cards/c2",
      },
    ];

    const filtered = filterAndRankBargains(listings, {
      minL10: 15,
      inSeasonOnly: true,
      searchQuery: "",
      maxPriceCents: null,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].playerName).toBe("Cheap Scorer");
  });

  it("maintains strict transitive sort order across mixed auctions and instant buys", () => {
    const mixed: Parameters<typeof filterAndRankBargains>[0] = [
      {
        cardSlug: "a-soon",
        assetId: "a1",
        playerSlug: "p1",
        playerName: "Auction Soon",
        teamName: "NBA",
        positions: ["basketball_guard"],
        rarity: "limited",
        seasonYear: 2026,
        inSeasonEligible: true,
        l10: 20,
        l5: 26,
        projected: 24,
        starCost: 2,
        saleType: "auction",
        priceCents: 300,
        currency: "USD",
        endDate: "2026-11-18T02:00:00Z",
        bidsCount: 1,
        centsPerL10: 15,
        valueScore: 70,
        marketUrl: "https://sorare.com/nba/cards/a-soon",
      },
      {
        cardSlug: "b-bad-date",
        assetId: "a2",
        playerSlug: "p2",
        playerName: "Instant Deal",
        teamName: "NBA",
        positions: ["basketball_forward"],
        rarity: "limited",
        seasonYear: 2026,
        inSeasonEligible: true,
        l10: 25,
        l5: 29,
        projected: 27,
        starCost: 2.5,
        saleType: "instant_buy",
        priceCents: 250,
        currency: "USD",
        endDate: null,
        bidsCount: null,
        centsPerL10: 10,
        valueScore: 85,
        marketUrl: "https://sorare.com/nba/cards/b-bad-date",
      },
    ];

    const byValue = filterAndRankBargains(mixed, {
      minL10: 0,
      inSeasonOnly: false,
      searchQuery: "",
      maxPriceCents: null,
      prioritizeEndingSoon: false,
    });
    expect(byValue[0].cardSlug).toBe("b-bad-date");

    const byEnding = filterAndRankBargains(mixed, {
      minL10: 0,
      inSeasonOnly: false,
      searchQuery: "",
      maxPriceCents: null,
      sortBy: "ending_soon",
    });
    expect(byEnding[0].cardSlug).toBe("a-soon");

    const byL5 = filterAndRankBargains(mixed, {
      minL10: 0,
      inSeasonOnly: false,
      searchQuery: "",
      maxPriceCents: null,
      sortBy: "l5_desc",
    });
    expect(byL5[0].cardSlug).toBe("b-bad-date");
  });
});

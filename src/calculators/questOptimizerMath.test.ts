import { describe, expect, it } from "vitest";
import { buildTeamOutStarMap, evaluateLeagueQuests } from "./questOptimizerMath";
import { computeStarCost } from "./lineupOptimizerMath";
import type {
  BargainListing,
  CollectionAnalysis,
  GalleryCard,
  InjuryReportEntry,
  QuestCardSummary,
} from "../shared/types";

describe("questOptimizerMath", () => {
  it("computes live first-owner Quest progress using exact Draft 26' Top-30 slugs and supports Primary Instant + Auction candidates", () => {
    const questCards: QuestCardSummary[] = [
      {
        slug: "c1",
        seasonYear: 2026,
        teamSlug: "cleveland-cavaliers",
        playerSlug: "sam-merrill",
        playerName: "Sam Merrill",
        age: 30,
        isFirstOwner: true,
        cardEditionName: "classic",
      },
      {
        slug: "c2",
        seasonYear: 2026,
        teamSlug: "memphis-grizzlies",
        playerSlug: "karim-lopez-20070412",
        playerName: "Karim Lopez",
        age: 19,
        isFirstOwner: true,
        cardEditionName: "rookie",
      },
      {
        slug: "c3",
        seasonYear: 2026,
        teamSlug: "detroit-pistons",
        playerSlug: "ebuka-okorie-20070410",
        playerName: "Ebuka Okorie",
        age: 19,
        isFirstOwner: true,
        cardEditionName: "rookie",
      },
      // Rookie outside Draft 26' Top-30 must count for team quest (Non-Playoffs) but NOT Draft 26'
      {
        slug: "c3b",
        seasonYear: 2026,
        teamSlug: "new-orleans-pelicans",
        playerSlug: "jaron-pierre-20020712",
        playerName: "Jaron Pierre Jr.",
        age: 24,
        isFirstOwner: true,
        cardEditionName: "rookie",
      },
      // Secondary card (isFirstOwner=false) must NOT count toward 1ST-owner quests
      {
        slug: "c4-sec",
        seasonYear: 2026,
        teamSlug: "oklahoma-city-thunder",
        playerSlug: "sec-guy",
        playerName: "Secondary Guy",
        age: 26,
        isFirstOwner: false,
        cardEditionName: "classic",
      },
    ];

    const outOfSeasonAllStars: CollectionAnalysis = {
      collection: {
        slug: "west-nba-all-stars-2023-24",
        name: "West NBA All-Stars 2023-24",
        rarity: "limited",
        inSeason: false,
        teamName: null,
        teamSlug: null,
        bonusThresholds: [],
        score: 0,
        complete: false,
        fulfilledSlotsCount: 0,
        slotsCount: 12,
        ownedPlayersCount: 0,
        totalPlayersCount: 12,
        bonus: 0,
      },
      nextBonusThreshold: null,
      nextEssenceMilestone: null,
      totalEssenceRemaining: 0,
      missingSlotsCount: 12,
    };

    const inSeasonMagic: CollectionAnalysis = {
      collection: {
        slug: "orlando-magic-limited-2026-27",
        name: "Orlando Magic Limited 2026-27",
        rarity: "limited",
        inSeason: true,
        teamName: "Orlando Magic",
        teamSlug: "orlando-magic",
        bonusThresholds: [],
        score: 90,
        complete: false,
        fulfilledSlotsCount: 3,
        slotsCount: 17,
        ownedPlayersCount: 3,
        totalPlayersCount: 17,
        bonus: 0,
      },
      nextBonusThreshold: null,
      nextEssenceMilestone: null,
      totalEssenceRemaining: 0,
      missingSlotsCount: 14,
    };

    const listings: BargainListing[] = [
      {
        cardSlug: "rookie-auc-1",
        assetId: "a1",
        playerSlug: "aday-mara-20050407",
        playerName: "Aday Mara",
        teamName: "Oklahoma City Thunder",
        teamSlug: "oklahoma-city-thunder",
        cardEditionName: "most_wanted",
        isPrimaryOffer: false,
        isFirstOwnerEligible: true,
        positions: ["basketball_center"],
        rarity: "limited",
        seasonYear: 2026,
        inSeasonEligible: true,
        l10: 22,
        l5: 25,
        projected: 24,
        starCost: 2,
        saleType: "auction",
        priceCents: 180,
        currency: "EUR",
        endDate: null,
        bidsCount: 1,
        centsPerL10: 8.2,
        valueScore: 80,
        marketUrl: "https://sorare.com/nba/cards/rookie-auc-1",
      },
      {
        cardSlug: "primary-buy-1",
        assetId: "a2",
        playerSlug: "dailyn-swain-20050715",
        playerName: "Dailyn Swain",
        teamName: "Chicago Bulls",
        teamSlug: "chicago-bulls",
        cardEditionName: "most_wanted",
        isPrimaryOffer: true,
        isFirstOwnerEligible: true,
        positions: ["basketball_forward"],
        rarity: "limited",
        seasonYear: 2026,
        inSeasonEligible: true,
        l10: 14,
        l5: 16,
        projected: 15,
        starCost: 1,
        saleType: "instant_buy",
        priceCents: 279,
        currency: "EUR",
        endDate: null,
        bidsCount: null,
        centsPerL10: 19.9,
        valueScore: 65,
        marketUrl: "https://sorare.com/nba/cards/primary-buy-1",
      },
    ];

    const res = evaluateLeagueQuests(
      questCards,
      [outOfSeasonAllStars, inSeasonMagic],
      "limited",
      listings,
    );
    const conf = res.quests.find((q) => q.id === "conf-finals-26");
    const nonPlay = res.quests.find((q) => q.id === "non-playoffs-26");
    const play = res.quests.find((q) => q.id === "playoffs-26");
    const draft = res.quests.find((q) => q.id === "draft-26");
    const full = res.quests.find((q) => q.id === "full-collection");

    expect(conf?.current).toBe(1);
    expect(nonPlay?.current).toBe(2);
    expect(play?.current).toBe(1);
    expect(draft?.current).toBe(2);
    expect(full?.closestTeamName).toBe("Orlando Magic Limited 2026-27");
    expect(draft?.cheapestBuys.some((b) => b.saleType === "auction" && b.playerName === "Aday Mara")).toBe(true);
    expect(draft?.cheapestBuys.some((b) => b.isPrimaryOffer && b.playerName === "Dailyn Swain")).toBe(true);
    expect(res.quests.some((q) => q.isTopOptimal)).toBe(true);
  });

  it("identifies NBA teams with OUT high-L10 stars for teammate usage boost alerts", () => {
    const cards: GalleryCard[] = [
      {
        slug: "star-card",
        rarity: "limited",
        seasonYear: 2026,
        inSeasonEligible: true,
        grade: 1,
        powerMultiplier: 1.05,
        teamName: "Oklahoma City Thunder",
        teamSlug: "oklahoma-city-thunder",
        playerSlug: "sga",
        playerName: "Shai Gilgeous-Alexander",
        positions: ["basketball_guard"],
        l10: 55,
        l5: 50,
        sorareClassicProjected: 55,
        sorareDailyProjected: null,
        starCost: computeStarCost(55),
      },
    ];
    const injuries: Record<string, InjuryReportEntry> = {
      "shai gilgeous alexander": {
        playerName: "Shai Gilgeous-Alexander",
        normalizedName: "shai gilgeous alexander",
        teamName: "Oklahoma City Thunder",
        status: "OUT",
        rawStatus: "Out",
        comment: "Rest",
      },
    };

    const map = buildTeamOutStarMap(cards, injuries);
    expect(map["oklahoma-city-thunder"]).toContain("OUT");
  });
});

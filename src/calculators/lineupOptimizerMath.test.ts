import { describe, expect, it } from "vitest";
import {
  buildBudgetLineups,
  compareCurrentVsOptimalLineups,
  computeStarCost,
  evaluateStarTierShift,
  evaluateVaultVsSellRoi,
  generateTopLineups,
  getFormatStarCap,
  optimizeMultiCompetitionPortfolio,
  parseCustomProjections,
  recommendBestFormat,
  recommendLineupMarketBuys,
  recommendTwoCardComboSwaps,
  explainLineupSwaps,
  type EvaluatedLineupCard,
  resolveSyncedLineupCardSlugs,
} from "./lineupOptimizerMath";
import type {
  BargainListing,
  CurrentLineupEntry,
  GalleryCard,
  InjuryReportEntry,
  LeaderboardBenchmark,
} from "../shared/types";

function makeCard(
  playerSlug: string,
  playerName: string,
  l10: number,
  proj: number,
  overrides: Partial<GalleryCard> = {},
): GalleryCard {
  return {
    slug: `${playerSlug}-card`,
    rarity: "limited",
    seasonYear: 2026,
    inSeasonEligible: true,
    grade: 1,
    powerMultiplier: 1.06,
    teamName: "Charlotte Hornets",
    teamSlug: "charlotte-hornets",
    playerSlug,
    playerName,
    positions: ["basketball_guard"],
    l10,
    l5: l10 + 2,
    sorareClassicProjected: proj,
    sorareDailyProjected: null,
    starCost: computeStarCost(l10),
    ...overrides,
  };
}

describe("lineupOptimizerMath", () => {
  it("builds valid Champion 16-star lineups, excludes OUT players, and calculates odds", () => {
    const cards: GalleryCard[] = [
      makeCard("p1", "Star One", 50, 52), // 5.0 stars
      makeCard("p2", "Star Two", 44, 46), // 4.5 stars
      makeCard("p3", "Starter Three", 28, 30), // 3.0 stars
      makeCard("p4", "Role Four", 18, 22), // 2.0 stars
      makeCard("p5", "Value Five", 12, 16), // 1.5 stars -> total = 16.0 stars!
      makeCard("p6", "Injured Ace", 52, 55), // OUT via ESPN -> must be excluded
      makeCard("p7", "Bench Six", 14, 15), // 1.5 stars
    ];

    const injuries: Record<string, InjuryReportEntry> = {
      "injured ace": {
        playerName: "Injured Ace",
        normalizedName: "injured ace",
        teamName: "Charlotte Hornets",
        status: "OUT",
        rawStatus: "Out",
        comment: "Out for Tuesday",
      },
    };

    const { lineups } = generateTopLineups(cards, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: injuries,
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: true,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      maxLineups: 2,
    });

    expect(lineups.length).toBeGreaterThanOrEqual(1);
    const best = lineups[0];
    expect(best.totalStars).toBeLessThanOrEqual(16);
    expect(best.slots).toHaveLength(5);
    expect(
      best.slots.some((s) => s.evaluated.card.playerSlug === "p6"),
    ).toBe(false);
    expect(best.odds.essencePct).toBeGreaterThan(0);
    expect(best.odds.essencePct).toBeGreaterThanOrEqual(best.odds.tier1Pct);
  });

  it("supports switching to external custom CSV projections and Daily 120 + MVP format", () => {
    const cards: GalleryCard[] = [
      makeCard("mvp", "Big MVP", 60, 40),
      makeCard("a", "Guard A", 35, 30),
      makeCard("b", "Guard B", 30, 30),
      makeCard("c", "Guard C", 25, 30),
      makeCard("d", "Guard D", 25, 30), // 4 non-MVP sum = 115 <= 120!
      makeCard("e", "Expensive E", 45, 30),
    ];

    const customCsv = "Big MVP, 72\nGuard A, 42";
    const parsed = parseCustomProjections(customCsv);
    expect(parsed.get("big mvp")).toBe(72);

    const { lineups } = generateTopLineups(cards, {
      format: "daily_120_mvp",
      rarityFilter: "ALL",
      projectionSource: "custom_csv",
      customProjectionsRaw: customCsv,
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: 1,
    });

    expect(lineups).toHaveLength(1);
    expect(lineups[0].capUsed).toBeLessThanOrEqual(120);
    expect(lineups[0].slots[0].slotLabel).toBe("MVP");
    expect(lineups[0].slots[0].evaluated.card.playerSlug).toBe("mvp");
  });

  it("prioritizes Contender 11-star when user has few elite 4-star+ cards and suggests upgrades", () => {
    const budgetCards: GalleryCard[] = [
      makeCard("a", "Mid Ace", 28, 30), // 3.0★
      makeCard("b", "Solid Two", 22, 24), // 2.5★
      makeCard("c", "Solid Three", 18, 22), // 2.0★
      makeCard("d", "Role Four", 14, 19), // 1.5★
      makeCard("e", "Value Five", 12, 18), // 1.5★ -> sum 10.5★ <= 11★, proj ~125
      makeCard("f", "Upgrade Bench", 24, 28), // 2.5★
    ];

    const rec = recommendBestFormat(budgetCards, {
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
    });

    expect(rec.recommendedFormat).toBe("contender_11");
    expect(rec.eliteCardCount).toBe(0);

    const contenderCandidate = rec.candidates.find(
      (c) => c.format === "contender_11",
    );
    expect(contenderCandidate?.essencePct).toBeGreaterThan(50);

    const submitted: CurrentLineupEntry[] = [
      {
        id: "ln-1",
        name: "My Daily",
        leaderboardSlug: "nba-daily-120-limited",
        leaderboardName: "Limited Daily Pickup 120",
        draft: false,
        cardSlugs: ["a-card", "b-card", "c-card", "d-card", "e-card"],
        captainCardSlug: "e-card",
      },
      {
        id: "ln-2",
        name: "My Contender",
        leaderboardSlug: "nba-contender-limited",
        leaderboardName: "Limited Contender",
        draft: false,
        cardSlugs: ["a-card", "b-card", "c-card", "d-card", "e-card"],
        captainCardSlug: "e-card",
      },
    ];
    const cmps = compareCurrentVsOptimalLineups(submitted, budgetCards, {
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
    });

    expect(cmps).toHaveLength(2);
    expect(cmps[0].betterCaptainName).toBe("Mid Ace");
    expect(cmps[1].betterCaptainName).toBeNull();
  });

  it("evaluates L10 star tier shifts for value locks and cap drops", () => {
    expect(evaluateStarTierShift(18, 30)).toEqual({
      currentStars: 2.0,
      projectedStars: 3.0,
      direction: "value_lock",
      label: "2★→3★ Form",
    });

    const drop = evaluateStarTierShift(24, 14);
    expect(drop.direction).toBe("cap_drop");
    expect(drop.currentStars).toBe(2.5);
    expect(drop.projectedStars).toBe(1.5);
    expect(drop.label).toBe("2.5★→1.5★ Drop");

    expect(evaluateStarTierShift(18, 19).direction).toBe("stable");
  });

  it("builds hybrid budget lineups from owned cards and affordable market listings under caps", () => {
    const ownedCards: GalleryCard[] = [
      makeCard("owned-g", "Owned Guard", 26, 30, {
        positions: ["basketball_guard"],
      }), // 3.0★
      makeCard("owned-f", "Owned Forward", 22, 26, {
        positions: ["basketball_forward"],
      }), // 2.5★
      makeCard("owned-c", "Owned Center", 18, 22, {
        positions: ["basketball_center"],
      }), // 2.0★
    ];

    const makeDeal = (
      slug: string,
      name: string,
      pos: GalleryCard["positions"],
      l10: number,
      projected: number,
      priceCents: number,
      isPrimaryOffer = false,
    ): BargainListing => ({
      cardSlug: `${slug}-market`,
      assetId: `asset-${slug}`,
      playerSlug: slug,
      playerName: name,
      teamName: "Orlando Magic",
      teamSlug: "orlando-magic",
      isPrimaryOffer,
      isFirstOwnerEligible: isPrimaryOffer,
      positions: pos,
      rarity: "limited",
      seasonYear: 2026,
      inSeasonEligible: true,
      l10,
      l5: l10 + 1,
      projected,
      starCost: computeStarCost(l10),
      saleType: "instant_buy",
      priceCents,
      currency: "EUR",
      endDate: null,
      bidsCount: null,
      centsPerL10: Math.round(priceCents / Math.max(l10, 1)),
      valueScore: projected,
      marketUrl: `https://sorare.com/nba/cards/${slug}-market`,
    });

    const marketListings: BargainListing[] = [
      makeDeal("cheap-f", "Budget Forward", ["basketball_forward"], 16, 21, 350, true), // 2.0★, €3.50
      makeDeal("cheap-g", "Budget Guard", ["basketball_guard"], 12, 17, 250, false), // 1.5★, €2.50 -> sum 11.0★, cost €6.00
      makeDeal("pricey-mvp", "Too Expensive Star", ["basketball_center"], 16, 40, 2500, true), // €25 > €10 budget
    ];

    const picks = buildBudgetLineups(ownedCards, marketListings, {
      format: "contender_11",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      budgetCents: 1000,
      includeOwned: true,
      inSeasonOnly: true,
    });

    expect(picks.length).toBeGreaterThan(0);
    const best = picks[0];
    expect(best.totalStars).toBeLessThanOrEqual(11);
    expect(best.totalCostCents).toBe(600);
    expect(best.remainingBudgetCents).toBe(400);
    expect(best.marketBuysCount).toBe(2);
    expect(best.slots.some((s) => s.evaluated.card.playerSlug === "pricey-mvp")).toBe(false);
    expect(best.slotCostBySlug["owned-g-card"]?.isOwned).toBe(true);
    expect(best.slotCostBySlug["cheap-f-market"]?.isPrimaryOffer).toBe(true);
    expect(best.slotCostBySlug["cheap-g-market"]?.costCents).toBe(250);
  });

  it("advises Seal vs Sell Cash ROI for prior-season cards", () => {
    const cheapVeteran = makeCard("vet-seal", "Veteran Seal", 12, 13, {
      inSeasonEligible: false,
      seasonYear: 2024,
      isFirstOwner: true,
      lowestAskCents: 90,
    });
    expect(evaluateVaultVsSellRoi(cheapVeteran).action).toBe("SEAL_VAULT");

    const liquidRole = makeCard("vet-sell", "Liquid Role", 20, 21, {
      inSeasonEligible: false,
      seasonYear: 2024,
      lowestAskCents: 450,
    });
    expect(evaluateVaultVsSellRoi(liquidRole).action).toBe("SELL_CASH");

    const goodVeteran = makeCard("vet-keep", "Good Veteran", 25, 26, {
      inSeasonEligible: false,
      seasonYear: 2025,
      lowestAskCents: 120,
    });
    expect(evaluateVaultVsSellRoi(goodVeteran).action).toBe("HOLD_DEPTH");
    expect(evaluateVaultVsSellRoi(goodVeteran, { locked: true }).action).toBe("HOLD_DEPTH");
    expect(evaluateVaultVsSellRoi(goodVeteran, { duplicate: true }).action).toBe("SEAL_VAULT");
  });

  it("jointly optimizes disjoint lineups across multiple competitions", () => {
    const deepRoster: GalleryCard[] = [
      makeCard("p1", "Ace One", 42, 46, { positions: ["basketball_guard"] }),
      makeCard("p2", "Ace Two", 38, 42, { positions: ["basketball_forward"] }),
      makeCard("p3", "Ace Three", 30, 35, { positions: ["basketball_center"] }),
      makeCard("p4", "Mid One", 24, 28, { positions: ["basketball_guard"] }),
      makeCard("p5", "Mid Two", 22, 26, { positions: ["basketball_forward"] }),
      makeCard("p6", "Mid Three", 20, 25, { positions: ["basketball_center"] }),
      makeCard("p7", "Val One", 18, 22, { positions: ["basketball_guard"] }),
      makeCard("p8", "Val Two", 16, 20, { positions: ["basketball_forward"] }),
      makeCard("p9", "Val Three", 15, 19, { positions: ["basketball_center"] }),
      makeCard("p10", "Min One", 12, 17, { positions: ["basketball_guard"] }),
    ];

    const portfolio = optimizeMultiCompetitionPortfolio(
      deepRoster,
      {
        rarityFilter: "limited",
        projectionSource: "sorare_projected",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
        excludeOut: true,
        excludeQuestionable: false,
        inSeasonOnly: true,
        minInSeasonCards: 0,
      },
      ["champion_16", "contender_11"],
    );

    expect(portfolio.lineups).toHaveLength(2);
    expect(portfolio.cardsUsedCount).toBe(10);
    const usedSlugs = portfolio.lineups.flatMap((l) =>
      l.slots.map((s) => s.evaluated.card.slug),
    );
    expect(new Set(usedSlugs).size).toBe(10);
    expect(portfolio.atLeastOneEssencePct).toBeGreaterThan(0);
  });

  it("enforces 4 In-Season + 1 Classic in buildBudgetLineups and ranks dual Classic vs In-Season buys", () => {
    const ownedCards: GalleryCard[] = [
      makeCard("in-1", "In Guard One", 22, 26, {
        inSeasonEligible: true,
        positions: ["basketball_guard"],
      }), // 2.5★
      makeCard("in-2", "In Forward One", 20, 24, {
        inSeasonEligible: true,
        positions: ["basketball_forward"],
      }), // 2.0★
      makeCard("in-3", "In Center One", 18, 22, {
        inSeasonEligible: true,
        positions: ["basketball_center"],
      }), // 2.0★
      makeCard("in-4", "In Guard Two", 16, 18, {
        inSeasonEligible: true,
        positions: ["basketball_guard"],
      }), // 2.0★
      makeCard("in-5", "Weak In Five", 11, 13, {
        inSeasonEligible: true,
        positions: ["basketball_forward"],
      }), // 1.5★
    ];

    const classicSteal: BargainListing = {
      cardSlug: "classic-vet-card",
      assetId: "a-classic",
      playerSlug: "classic-vet",
      playerName: "Classic Vet Steal",
      teamName: "Miami Heat",
      teamSlug: "miami-heat",
      positions: ["basketball_forward"],
      rarity: "limited",
      seasonYear: 2024,
      inSeasonEligible: false,
      l10: 18,
      l5: 25,
      projected: 27,
      starCost: 2.0,
      saleType: "instant_buy",
      priceCents: 120,
      currency: "EUR",
      endDate: null,
      bidsCount: null,
      centsPerL10: 7,
      valueScore: 27,
      marketUrl: "https://sorare.com/nba/cards/classic-vet-card",
    };

    const inSeasonUpgrade: BargainListing = {
      cardSlug: "inseason-rookie-card",
      assetId: "a-in",
      playerSlug: "inseason-rookie",
      playerName: "InSeason Rookie Upgrade",
      teamName: "Orlando Magic",
      teamSlug: "orlando-magic",
      isPrimaryOffer: true,
      isFirstOwnerEligible: true,
      questLabels: ["Draft 26'"],
      positions: ["basketball_forward"],
      rarity: "limited",
      seasonYear: 2026,
      inSeasonEligible: true,
      l10: 18,
      l5: 22,
      projected: 29,
      starCost: 2.0,
      saleType: "instant_buy",
      priceCents: 450,
      currency: "EUR",
      endDate: null,
      bidsCount: null,
      centsPerL10: 25,
      valueScore: 29,
      marketUrl: "https://sorare.com/nba/cards/inseason-rookie-card",
    };

    const budgetPicks = buildBudgetLineups(
      ownedCards,
      [classicSteal, inSeasonUpgrade],
      {
        format: "contender_11",
        rarityFilter: "limited",
        projectionSource: "sorare_projected",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
        budgetCents: 200,
        includeOwned: true,
        inSeasonOnly: false,
        minInSeasonCards: 4,
      },
    );

    expect(budgetPicks.length).toBeGreaterThan(0);
    expect(budgetPicks[0].inSeasonCount).toBe(4);
    expect(
      budgetPicks[0].slots.some(
        (s) => s.evaluated.card.playerSlug === "classic-vet",
      ),
    ).toBe(true);

    const baseLineup = generateTopLineups(ownedCards, {
      format: "contender_11",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: true,
      minInSeasonCards: 5,
      disjointAcrossLineups: false,
      maxLineups: 1,
    }).lineups[0];
    expect(baseLineup).toBeDefined();

    const valueRecs = recommendLineupMarketBuys(
      baseLineup,
      new Set(ownedCards.map((c) => c.playerSlug)),
      new Set(["inseason-rookie"]),
      [classicSteal, inSeasonUpgrade],
      {
        format: "contender_11",
        rarityFilter: "limited",
        seasonRule: "4_in_1_classic",
        rankMode: "best_value",
        projectionSource: "sorare_projected",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
      },
    );
    expect(valueRecs.classicSlotBuys).toHaveLength(1);
    expect(valueRecs.inSeasonSlotBuys).toHaveLength(1);
    expect(valueRecs.topOverallBuys[0].listing.playerSlug).toBe("classic-vet");

    const maxRecs = recommendLineupMarketBuys(
      baseLineup,
      new Set(ownedCards.map((c) => c.playerSlug)),
      new Set(["inseason-rookie"]),
      [classicSteal, inSeasonUpgrade],
      {
        format: "contender_11",
        rarityFilter: "limited",
        seasonRule: "4_in_1_classic",
        rankMode: "max_upgrade",
        projectionSource: "sorare_projected",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
      },
    );
    expect(maxRecs.topOverallBuys[0].listing.playerSlug).toBe(
      "inseason-rookie",
    );

    const synergyRecs = recommendLineupMarketBuys(
      baseLineup,
      new Set(ownedCards.map((c) => c.playerSlug)),
      new Set(["inseason-rookie"]),
      [classicSteal, inSeasonUpgrade],
      {
        format: "contender_11",
        rarityFilter: "limited",
        seasonRule: "4_in_1_classic",
        rankMode: "quest_synergy",
        projectionSource: "sorare_projected",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
      },
    );
    expect(synergyRecs.topOverallBuys[0].advancesCollection).toBe(true);
    expect(synergyRecs.topOverallBuys[0].questSynergyLabels).toContain(
      "Draft 26'",
    );
  });

  it("finds 2-card cap-reallocation combo swaps when a star requires downsizing another slot", () => {
    const cappedLineupCards: GalleryCard[] = [
      makeCard("b1", "Guard Cap", 22, 24, {
        inSeasonEligible: true,
        positions: ["basketball_guard"],
      }), // 2.5★
      makeCard("b2", "Forward Cap", 22, 23, {
        inSeasonEligible: true,
        positions: ["basketball_forward"],
      }), // 2.5★
      makeCard("b3", "Center Cap", 21, 22, {
        inSeasonEligible: true,
        positions: ["basketball_center"],
      }), // 2.5★
      makeCard("b4", "Guard Four", 16, 18, {
        inSeasonEligible: true,
        positions: ["basketball_guard"],
      }), // 2.0★
      makeCard("b5", "Forward Five", 12, 14, {
        inSeasonEligible: true,
        positions: ["basketball_forward"],
      }), // 1.5★ -> exact 11.0★ cap
    ];

    const baseLineup = generateTopLineups(cappedLineupCards, {
      format: "contender_11",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: true,
      minInSeasonCards: 5,
      disjointAcrossLineups: false,
      maxLineups: 1,
    }).lineups[0];

    const superstarClassic: BargainListing = {
      cardSlug: "superstar-classic-card",
      assetId: "a-ss",
      playerSlug: "superstar-classic",
      playerName: "Superstar Classic",
      teamName: "Boston Celtics",
      teamSlug: "boston-celtics",
      positions: ["basketball_guard"],
      rarity: "limited",
      seasonYear: 2024,
      inSeasonEligible: false,
      l10: 30,
      l5: 36,
      projected: 44,
      starCost: 3.0,
      saleType: "instant_buy",
      priceCents: 300,
      currency: "EUR",
      endDate: null,
      bidsCount: null,
      centsPerL10: 10,
      valueScore: 44,
      marketUrl: "https://sorare.com/nba/cards/superstar-classic-card",
    };

    const cheapEnablerInSeason: BargainListing = {
      cardSlug: "cheap-enabler-card",
      assetId: "a-ce",
      playerSlug: "cheap-enabler",
      playerName: "Cheap Enabler",
      teamName: "Orlando Magic",
      teamSlug: "orlando-magic",
      positions: ["basketball_forward"],
      rarity: "limited",
      seasonYear: 2026,
      inSeasonEligible: true,
      l10: 10,
      l5: 13,
      projected: 16,
      starCost: 1.0,
      saleType: "instant_buy",
      priceCents: 90,
      currency: "EUR",
      endDate: null,
      bidsCount: null,
      centsPerL10: 9,
      valueScore: 16,
      marketUrl: "https://sorare.com/nba/cards/cheap-enabler-card",
    };

    const combos = recommendTwoCardComboSwaps(
      baseLineup,
      cappedLineupCards,
      [superstarClassic, cheapEnablerInSeason],
      {
        format: "contender_11",
        rarityFilter: "limited",
        seasonRule: "4_in_1_classic",
        rankMode: "max_upgrade",
        projectionSource: "sorare_projected",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
      },
    );

    expect(combos.length).toBeGreaterThan(0);
    expect(combos[0].newTotalStars).toBeLessThanOrEqual(11);
    expect(combos[0].deltaLineupPts).toBeGreaterThan(10);
    expect(combos[0].totalCostCents).toBe(390);
  });

  it("supports live Arena Room caps (Champion 16★ / Contender 11★) and U23 / Veterans age filters", () => {
    expect(getFormatStarCap("champion_16")).toBe(16);
    expect(getFormatStarCap("arena_champion_15")).toBe(16);
    expect(getFormatStarCap("arena_contender_12")).toBe(11);
    expect(getFormatStarCap("contender_11")).toBe(11);
    expect(getFormatStarCap("uncapped")).toBeNull();

    const mixedRoster: GalleryCard[] = [
      makeCard("y1", "Young One", 30, 38, { playerAge: 20 }),
      makeCard("y2", "Young Two", 28, 32, { playerAge: 21 }),
      makeCard("y3", "Young Three", 20, 28, { playerAge: 22 }),
      makeCard("y4", "Young Four", 20, 24, { playerAge: 23 }),
      makeCard("y5", "Young Five", 10, 14, { playerAge: 19 }),
      makeCard("v1", "Vet One", 44, 48, { playerAge: 32 }),
      makeCard("v2", "Vet Two", 34, 36, { playerAge: 31 }),
      makeCard("v3", "Vet Three", 28, 30, { playerAge: 30 }),
      makeCard("v4", "Vet Four", 22, 24, { playerAge: 34 }),
      makeCard("v5", "Vet Five", 14, 18, { playerAge: 33 }),
    ];

    const u23Res = generateTopLineups(mixedRoster, {
      format: "arena_contender_12",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      ageFilter: "u23",
      maxLineups: 1,
    });
    expect(u23Res.lineups).toHaveLength(1);
    expect(u23Res.lineups[0].capLimit).toBe(11);
    expect(u23Res.lineups[0].slots.every((s) => (s.evaluated.card.playerAge ?? 99) <= 23)).toBe(true);

    const vetRes = generateTopLineups(mixedRoster, {
      format: "arena_champion_15",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      ageFilter: "veterans",
      maxLineups: 1,
    });
    expect(vetRes.lineups).toHaveLength(1);
    expect(vetRes.lineups[0].capLimit).toBe(16);
    expect(vetRes.lineups[0].slots.every((s) => (s.evaluated.card.playerAge ?? 0) >= 30)).toBe(true);
  });

  it("calibrates lineup odds, In-Season vs Classic tips, and DOM playerNames lineup matching using closed-GW benchmarks", () => {
    const benchmarks: LeaderboardBenchmark[] = [
      {
        fixtureSlug: "nba-14-16-nov-2026",
        fixtureName: "Game Week 8",
        leaderboardSlug: "nba-14-16-nov-2026-nba_limited_contender",
        displayName: "Limited Contender",
        format: "contender_11",
        seasonScope: "classic",
        rarity: "limited",
        totalEntries: 9098,
        paidPlaces: 1000,
        rewardWinRatePct: 11.0,
        paidCutoffScore: 193.7,
        top20Score: 180.0,
        top5Score: 215.0,
        podiumScore: 245.0,
        top1Score: 256.5,
      },
      {
        fixtureSlug: "nba-14-16-nov-2026",
        fixtureName: "Game Week 8",
        leaderboardSlug: "nba-14-16-nov-2026-nba_limited_in_season_contender",
        displayName: "In-Season Contender",
        format: "contender_11",
        seasonScope: "in_season",
        rarity: "limited",
        totalEntries: 4582,
        paidPlaces: 2500,
        rewardWinRatePct: 54.6,
        paidCutoffScore: 144.3,
        top20Score: 172.6,
        top5Score: 199.9,
        podiumScore: 260.0,
        top1Score: 280.5,
      },
      {
        fixtureSlug: "nba-14-16-nov-2026",
        fixtureName: "Game Week 8",
        leaderboardSlug: "nba-14-16-nov-2026-nba_limited_arena_75-pod1",
        displayName: "Arena Contender",
        format: "arena_contender_12",
        seasonScope: "arena",
        ageScope: "all",
        rarity: "limited",
        totalEntries: 828,
        paidPlaces: 414,
        rewardWinRatePct: 50.0,
        paidCutoffScore: 159.1,
        top20Score: 185.0,
        top5Score: 205.0,
        podiumScore: 211.5,
        top1Score: 211.5,
        podSize: 10,
      },
    ];

    const roster: GalleryCard[] = [
      makeCard("wendell-carter-jr", "Wendell Carter Jr.", 28, 32, { inSeasonEligible: true }),
      makeCard("aaron-gordon", "Aaron Gordon", 23, 27, { inSeasonEligible: true }),
      makeCard("brook-lopez", "Brook Lopez", 19, 26, { inSeasonEligible: true }),
      makeCard("demar-derozan", "DeMar DeRozan", 14, 22, { inSeasonEligible: true }),
      makeCard("malik-monk", "Malik Monk", 12, 19, { inSeasonEligible: true }),
      makeCard("jalen-johnson", "Jalen Johnson", 18, 39, { inSeasonEligible: true }),
    ];

    const classicBuilt = generateTopLineups(roster, {
      format: "contender_11",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      maxLineups: 1,
      benchmarks,
      benchmarkSeasonScope: "classic",
    });

    expect(classicBuilt.lineups[0].odds.essenceTarget).toBe(194);
    expect(classicBuilt.lineups[0].odds.estRank).toBeGreaterThan(1000);
    expect(classicBuilt.lineups[0].odds.totalEntries).toBe(9098);

    const rec = recommendBestFormat(roster, {
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      benchmarks,
      benchmarkSeasonScope: "classic",
    });
    // EV ranking (live caps): In-Season Contender pays 54.6% of the field vs Classic 11%.
    expect(rec.recommendedFormat).toBe("contender_11");
    expect(rec.recommendedScope).toBe("in_season");
    expect(rec.inSeasonVsClassicTip).toContain("54.6%");
    expect(rec.inSeasonVsClassicTip).toContain("11%");

    // DOM-synced Arena lineup with abbreviated player names and empty cardSlugs
    const domEntries: CurrentLineupEntry[] = [
      {
        id: "dom-arena-classic-contender-1",
        name: "Arena Classic Contender #1",
        leaderboardSlug: "arena_classic_contender",
        leaderboardName: "Arena Classic Contender",
        draft: false,
        cardSlugs: [],
        playerNames: [
          "W. CARTER JR.",
          "AARON GORDON",
          "BROOK LOPEZ",
          "D. DEROZAN",
          "MALIK MONK",
        ],
        captainCardSlug: null,
        source: "dom",
      },
    ];

    const cmps = compareCurrentVsOptimalLineups(domEntries, roster, {
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      benchmarks,
    });
    expect(cmps).toHaveLength(1);
    expect(cmps[0].resolvedCardSlugs).toHaveLength(5);
    expect(cmps[0].currentProjected).toBeGreaterThan(100);
    expect(cmps[0].paidCutoffScore).toBe(159.1);
    expect(cmps[0].swaps.some((s) => s.inPlayer === "Jalen Johnson")).toBe(true);
  });
});

describe("explainLineupSwaps", () => {
  const ev = (playerName: string, score: number, stars: number): EvaluatedLineupCard =>
    ({
      card: { slug: playerName.toLowerCase().replace(/\s+/g, "-"), playerName, starCost: stars } as GalleryCard,
      baseProjection: score,
      injuryAdjustedBase: score,
      effectiveScore: score,
      injury: null,
      injuryStatus: "ACTIVE",
      gamesInSlate: 1,
      p10Floor: score * 0.6,
      p50Median: score * 0.94,
      p90Ceiling: score * 1.5,
      cv: 0.35,
      vorp: score - 12,
      starSurplus: 0,
      riskTags: [],
      upsideTags: [],
      boostSummary: { powerMultiplier: 1, slateMultiplier: 1, vegasMultiplier: 1, restMultiplier: 1 },
      allSources: { sorareProjected: score, l10: score, l5: score, custom: null, blended: score },
    }) satisfies EvaluatedLineupCard;

  it("keeps upgrades with a reason and drops downgrades when under the cap", () => {
    const swaps = explainLineupSwaps(
      [
        { out: ev("Morez Johnson Jr.", 17.2, 2), in: ev("DeMar DeRozan", 19.1, 2) },
        { out: ev("Dillon Brooks", 21.7, 2.5), in: ev("Christian Anderson", 14.3, 1) },
      ],
      { currentStars: 10.5, starCap: 11, usedElsewhere: new Set(["demar derozan"]) },
    );
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({
      inPlayer: "DeMar DeRozan",
      deltaPts: 1.9,
      kind: "upgrade",
      usedInOtherLineup: true,
    });
    expect(swaps[0].reason).toContain("projects 19.1 pts");
    expect(swaps[0].reason).toContain("another of your lineups");
  });

  it("labels a downgrade as a cap fix only when the lineup is over the cap", () => {
    const swaps = explainLineupSwaps(
      [{ out: ev("Dillon Brooks", 21.7, 2.5), in: ev("Christian Anderson", 14.3, 1) }],
      { currentStars: 12, starCap: 11, usedElsewhere: new Set() },
    );
    expect(swaps).toHaveLength(1);
    expect(swaps[0].kind).toBe("cap_fix");
    expect(swaps[0].deltaPts).toBe(-7.4);
    expect(swaps[0].reason).toContain("over the 11★ cap");
  });
});

describe("resolveSyncedLineupCardSlugs", () => {
  const cards: GalleryCard[] = [
    makeCard("malik-monk", "Malik Monk", 22, 24, { slug: "monk-2026-limited", rarity: "limited", seasonYear: 2026 }),
    makeCard("malik-monk", "Malik Monk", 22, 24, { slug: "monk-2026-rare", rarity: "rare", seasonYear: 2026 }),
    makeCard("aaron-gordon", "Aaron Gordon", 25, 25, { slug: "gordon-2025-limited", rarity: "limited", seasonYear: 2025 }),
  ];
  const entry = (lb: string, names: string[], slugs: string[] = []): CurrentLineupEntry => ({
    id: lb,
    name: lb,
    leaderboardSlug: lb,
    leaderboardName: lb,
    draft: false,
    cardSlugs: slugs,
    captainCardSlug: null,
    playerNames: names,
    source: "dom",
  });

  it("maps name-only synced lineups to the card of the competition's rarity", () => {
    const locked = resolveSyncedLineupCardSlugs(
      [entry("nba_rare_contender", ["Malik Monk"]), entry("nba_limited_contender", ["Aaron Gordon"])],
      cards,
    );
    expect(locked.sort()).toEqual(["gordon-2025-limited", "monk-2026-rare"]);
  });

  it("never locks the same card twice and ignores unknown names / slugs", () => {
    const locked = resolveSyncedLineupCardSlugs(
      [
        entry("nba_limited_contender", ["Malik Monk", "Nobody Here"], ["not-owned"]),
        entry("nba_limited_champion", ["Malik Monk"]),
      ],
      cards,
    );
    expect(locked.sort()).toEqual(["monk-2026-limited", "monk-2026-rare"]);
  });
});

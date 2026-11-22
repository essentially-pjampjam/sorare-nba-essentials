import { describe, expect, it } from "vitest";
import { evaluateAlertEvents, findPreLockLineupRisks } from "./alertTrackerMath";
import {
  buildBudgetLineups,
  buildEditFocusPoints,
  computeLineupVariance,
  computeStarCost,
  evaluateCardForLineup,
  evaluateVaultVsSellRoi,
  generateTopLineups,
  recommendLineupMarketBuys,
  recommendTwoCardComboSwaps,
} from "./lineupOptimizerMath";
import { applyLineupBonus, calculateSorareNbaScore } from "./nbaScoringMath";
import { planSealBudget, type SealDeal } from "./sealDealsMath";
import type {
  AlertTrackerConfig,
  BargainListing,
  CurrentLineupEntry,
  GalleryCard,
  InjuryReportEntry,
  TeamSlateSchedule,
} from "../shared/types";

function card(
  playerSlug: string,
  teamSlug: string,
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
    powerMultiplier: 1.05,
    teamName: teamSlug,
    teamSlug,
    playerSlug,
    playerName: playerSlug.replace(/-/g, " "),
    positions: ["basketball_guard"],
    l10,
    l5: l10,
    sorareClassicProjected: proj,
    sorareDailyProjected: null,
    starCost: computeStarCost(l10),
    ...overrides,
  };
}

function listing(
  playerSlug: string,
  teamSlug: string,
  l10: number,
  proj: number,
  priceCents: number,
  overrides: Partial<BargainListing> = {},
): BargainListing {
  return {
    cardSlug: `${playerSlug}-mkt`,
    assetId: `${playerSlug}-asset`,
    playerSlug,
    playerName: playerSlug.replace(/-/g, " "),
    teamName: teamSlug,
    teamSlug,
    positions: ["basketball_center"],
    rarity: "limited",
    seasonYear: 2026,
    inSeasonEligible: true,
    isFirstOwnerEligible: true,
    isPrimaryOffer: false,
    saleType: "instant_buy",
    endDate: null,
    bidsCount: null,
    priceCents,
    currency: "EUR",
    l10,
    l5: l10,
    projected: proj,
    starCost: computeStarCost(l10),
    centsPerL10: priceCents / Math.max(1, l10),
    valueScore: 0,
    marketUrl: `https://sorare.com/nba/cards/${playerSlug}-mkt`,
    ...overrides,
  };
}

describe("v2.7.5-exp3: max 4 players per NBA team", () => {
  it("generateTopLineups enforces max 4 per team and returns 0 if only 1 team exists", () => {
    const oneTeamOnly = [
      card("p1", "boston-celtics", 25, 30),
      card("p2", "boston-celtics", 25, 29),
      card("p3", "boston-celtics", 25, 28),
      card("p4", "boston-celtics", 25, 27),
      card("p5", "boston-celtics", 25, 26),
    ];
    const impossible = generateTopLineups(oneTeamOnly, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: 1,
    });
    expect(impossible.lineups).toHaveLength(0);

    const mixed = [...oneTeamOnly, card("p6", "miami-heat", 18, 20)];
    const built = generateTopLineups(mixed, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: 1,
    });
    expect(built.lineups).toHaveLength(1);
    const celticsCount = built.lineups[0].slots.filter(
      (s) => s.evaluated.card.teamSlug === "boston-celtics",
    ).length;
    expect(celticsCount).toBe(4);
    expect(built.lineups[0].slots.some((s) => s.evaluated.card.playerSlug === "p6")).toBe(true);
  });

  it("buildBudgetLineups and market buy advisors enforce max 4 per team", () => {
    const owned = [
      card("bos1", "boston-celtics", 24, 28),
      card("bos2", "boston-celtics", 24, 27),
      card("bos3", "boston-celtics", 24, 26),
      card("bos4", "boston-celtics", 24, 25),
      card("mia1", "miami-heat", 16, 17),
    ];
    const market = [
      // Better scorer than mia1, but would make 5 Celtics (illegal!)
      listing("bos5", "boston-celtics", 24, 35, 300),
      // Slightly lower scorer on Nuggets (legal!)
      listing("den1", "denver-nuggets", 24, 30, 300),
    ];

    const budgetPicks = buildBudgetLineups(owned, market, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      budgetCents: 1000,
      includeOwned: true,
      inSeasonOnly: false,
    });
    expect(budgetPicks.length).toBeGreaterThan(0);
    expect(
      budgetPicks[0].slots.filter((s) => s.evaluated.card.teamSlug === "boston-celtics").length,
    ).toBeLessThanOrEqual(4);
    expect(budgetPicks[0].stdDev).toBeGreaterThan(0);

    const baseLineup = generateTopLineups(owned, {
      format: "champion_16",
      rarityFilter: "limited",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: 1,
    }).lineups[0];

    const buys = recommendLineupMarketBuys(
      baseLineup,
      new Set(owned.map((c) => c.playerSlug)),
      new Set(),
      market,
      {
        format: "champion_16",
        rarityFilter: "limited",
        seasonRule: "any_season",
        rankMode: "max_upgrade",
        projectionSource: "sorare_projected",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam: {},
      },
    );
    // bos5 can replace another Celtic (keeping 4 Celtics), never mia1 (which would make 5 Celtics)
    for (const rec of buys.topOverallBuys) {
      if (rec.listing.teamSlug === "boston-celtics") {
        expect(rec.replacesCardSlug).not.toBe("mia1-card");
      }
    }

    const combos = recommendTwoCardComboSwaps(baseLineup, owned, market, {
      format: "champion_16",
      rarityFilter: "limited",
      seasonRule: "any_season",
      rankMode: "max_upgrade",
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
    });
    for (const combo of combos) {
      const kept = baseLineup.slots
        .map((s) => s.evaluated.card)
        .filter((c) => !combo.outPlayers.includes(c.playerName));
      expect(kept.length).toBe(3);
    }
  });
});

describe("v2.7.5-exp3: direct floor (p10) & ceiling (p90) DFS optimization", () => {
  it("optimizes floor vs ceiling directly in generateTopLineups", () => {
    const anchors = [
      card("a1", "team-1", 26, 30, { starCost: 3 }),
      card("a2", "team-2", 26, 30, { starCost: 3 }),
      card("a3", "team-3", 26, 30, { starCost: 3 }),
      card("a4", "team-4", 26, 30, { starCost: 3 }),
    ];
    // Two 5th-slot options with nearly identical effectiveScore (~24), different variance:
    // steady: healthy, L10=24 -> low cv (0.35)
    // volatile: L10=12 (+0.10 cv) + B2B (+0.05 cv) + blowout (+0.05 cv) -> high cv (0.55)
    const steady = card("steady", "team-5", 24, 23.0, { starCost: 2, powerMultiplier: 1 });
    const volatile = card("volatile", "team-6", 12, 24.5, { starCost: 2, powerMultiplier: 1 });

    const scheduleByTeam: Record<string, TeamSlateSchedule> = {
      "team-6": {
        teamSlug: "team-6",
        teamName: "Team 6",
        abbr: "T6",
        games: 1,
        hasBackToBack: true,
        blowoutRisk: true,
        matchups: ["vs T9"],
        difficultyTag: "NEUTRAL",
      },
    };

    const commonOpts = {
      format: "champion_16" as const,
      rarityFilter: "limited" as const,
      projectionSource: "sorare_projected" as const,
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      scheduleByTeam,
      excludeOut: true,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: true,
      maxLineups: 1,
    };

    const floorRes = generateTopLineups([...anchors, steady, volatile], {
      ...commonOpts,
      strategy: "floor",
    });
    const ceilingRes = generateTopLineups([...anchors, steady, volatile], {
      ...commonOpts,
      strategy: "ceiling",
    });

    expect(floorRes.lineups[0].slots.some((s) => s.evaluated.card.playerSlug === "steady")).toBe(true);
    expect(ceilingRes.lineups[0].slots.some((s) => s.evaluated.card.playerSlug === "volatile")).toBe(true);
  });
});

describe("v2.7.5-exp3: buildEditFocusPoints & scheduleByTeam", () => {
  it("ignores nonexistent NBA position filter, filters OUT/0G, and uses dynamic currency", () => {
    const roster = [
      card("g1", "team-1", 30, 32, { positions: ["basketball_guard"] }),
      card("g2", "team-2", 28, 30, { positions: ["basketball_guard"] }),
      card("g3", "team-3", 26, 28, { positions: ["basketball_guard"] }),
      card("g4", "team-4", 24, 26, { positions: ["basketball_guard"] }),
      card("weak-g", "team-5", 12, 12, { positions: ["basketball_guard"] }),
    ];
    const evaluated = roster.map((c) =>
      evaluateCardForLineup(c, "sorare_projected", new Map(), {}, { "team-1": 1, "team-2": 1, "team-3": 1, "team-4": 1, "team-5": 1 }),
    );
    const market = [
      // 0G player (should be skipped!)
      listing("no-game-star", "team-zero", 24, 40, 200, { currency: "USD" }),
      // OUT player (should be skipped!)
      listing("hurt-star", "team-6", 24, 40, 200, { currency: "USD" }),
      // Healthy Center replacing weakest Guard (should be recommended with $ currency!)
      listing("healthy-center", "team-6", 18, 28, 450, {
        positions: ["basketball_center"],
        currency: "USD",
      }),
    ];
    const injuries: Record<string, InjuryReportEntry> = {
      "hurt star": {
        playerName: "hurt star",
        normalizedName: "hurt star",
        teamName: "team-6",
        status: "OUT",
        rawStatus: "Out",
        comment: "Ankle",
      },
    };
    const pts = buildEditFocusPoints({
      evaluated,
      swaps: [],
      unresolvedReason: undefined,
      currentStars: 13.5,
      starCap: 16,
      scheduleByTeam: undefined,
      marketListings: market,
      ownedPlayerSlugs: new Set(roster.map((c) => c.playerSlug)),
      projectionSource: "sorare_projected",
      injuriesByName: injuries,
      gamesPerTeam: { "team-1": 1, "team-2": 1, "team-3": 1, "team-4": 1, "team-5": 1, "team-6": 1 },
    });

    const buyNote = pts.find((p) => p.kind === "buy");
    expect(buyNote).toBeDefined();
    expect(buyNote?.playerName).toBe("healthy center");
    expect(buyNote?.text).toContain("$4.50");
  });
});

describe("v2.7.5-exp3: exact 0/1 knapsack planSealBudget & rarity-scaled Vault ROI", () => {
  const makeDeal = (slug: string, sp: number, priceCents: number): SealDeal => ({
    listing: listing(slug, "team-1", 10, 10, priceCents, { sealingPoints: sp }),
    sealingPoints: sp,
    priceCents,
    pointsPerUnit: Math.round((sp / (priceCents / 100)) * 100) / 100,
    ownedPlayer: false,
    lowLineupValue: true,
  });

  it("beats greedy by finding optimal 0/1 knapsack combination", () => {
    // Budget 600: Deal A (20 SP @ 400 = 5.0/eur) vs Deal B + C (14+14 = 28 SP @ 600)
    const deals = [makeDeal("a", 20, 400), makeDeal("b", 14, 300), makeDeal("c", 14, 300)];
    const plan = planSealBudget(deals, 600);
    expect(plan.totalPoints).toBe(28);
    expect(plan.totalCents).toBe(600);
    expect(plan.deals.map((d) => d.listing.playerSlug)).toEqual(["b", "c"]);
  });

  it("breaks equal-point ties by choosing lower cost and handles edge budgets", () => {
    const deals = [makeDeal("expensive", 20, 500), makeDeal("cheap", 20, 350)];
    const plan = planSealBudget(deals, 600);
    expect(plan.totalPoints).toBe(20);
    expect(plan.totalCents).toBe(350);
    expect(planSealBudget(deals, 0)).toEqual({ deals: [], totalPoints: 0, totalCents: 0 });
    expect(planSealBudget([], 1000)).toEqual({ deals: [], totalPoints: 0, totalCents: 0 });
  });

  it("scales evaluateVaultVsSellRoi floor threshold by rarity", () => {
    const rareBenchLowFloor = card("r1", "team-1", 12, 12, {
      rarity: "rare",
      inSeasonEligible: false,
      lowestAskCents: 500, // €5 is below Rare's €15 threshold -> SEAL_VAULT
    });
    const rareBenchHighFloor = card("r2", "team-1", 12, 12, {
      rarity: "rare",
      inSeasonEligible: false,
      lowestAskCents: 2000, // €20 is above Rare's €15 threshold -> SELL_CASH
    });
    expect(evaluateVaultVsSellRoi(rareBenchLowFloor).action).toBe("SEAL_VAULT");
    expect(evaluateVaultVsSellRoi(rareBenchHighFloor).action).toBe("SELL_CASH");
  });
});

describe("v2.7.5-exp3: NBA correlation calibration", () => {
  it("applies negative teammate correlation (-0.05) and positive same-game opponent correlation (+0.06)", () => {
    const evA1 = evaluateCardForLineup(card("p1", "bos", 30, 30), "sorare_projected", new Map(), {}, {});
    const evA2 = evaluateCardForLineup(card("p2", "bos", 30, 30), "sorare_projected", new Map(), {}, {});
    const evB1 = evaluateCardForLineup(card("p3", "lal", 30, 30), "sorare_projected", new Map(), {}, {});
    const evC1 = evaluateCardForLineup(card("p4", "den", 30, 30), "sorare_projected", new Map(), {}, {});

    const sched: Record<string, TeamSlateSchedule> = {
      bos: { teamSlug: "bos", teamName: "Boston", abbr: "BOS", games: 1, hasBackToBack: false, matchups: ["vs LAL"], difficultyTag: "NEUTRAL" },
      lal: { teamSlug: "lal", teamName: "Lakers", abbr: "LAL", games: 1, hasBackToBack: false, matchups: ["@ BOS"], difficultyTag: "NEUTRAL" },
      den: { teamSlug: "den", teamName: "Denver", abbr: "DEN", games: 1, hasBackToBack: false, matchups: ["vs MIA"], difficultyTag: "NEUTRAL" },
    };

    const indepVar = computeLineupVariance(
      [{ slotScore: 30, evaluated: evA1 }, { slotScore: 30, evaluated: evC1 }],
      sched,
    );
    const teammateVar = computeLineupVariance(
      [{ slotScore: 30, evaluated: evA1 }, { slotScore: 30, evaluated: evA2 }],
      sched,
    );
    const sameGameOppVar = computeLineupVariance(
      [{ slotScore: 30, evaluated: evA1 }, { slotScore: 30, evaluated: evB1 }],
      sched,
    );

    expect(teammateVar).toBeLessThan(indepVar);
    expect(sameGameOppVar).toBeGreaterThan(indepVar);
  });
});

describe("v2.7.5-exp3: pre-lock lineup health & injuryLineupsOnly alerts", () => {
  const baseConfig: AlertTrackerConfig = {
    alertsEnabled: true,
    cutoffReminderEnabled: true,
    cutoffReminderMinutesBefore: 60,
    alertPreferences: {
      priceSurgeEnabled: false,
      priceSurgePctThreshold: 25,
      injuryRiskEnabled: true,
      injuryLineupsOnly: true,
      bargainAlertEnabled: false,
      cutoffAlertEnabled: true,
      dailyResetAlertEnabled: false,
      browserNotificationsEnabled: true,
      cooldownMinutes: 60,
    },
  };

  it("suppresses bench injury alerts when injuryLineupsOnly is enabled", () => {
    const starter = card("starter-one", "bos", 30, 30, { playerName: "Starter One" });
    const bench = card("bench-two", "lal", 15, 15, { playerName: "Bench Two" });
    const lineup: CurrentLineupEntry = {
      id: "l1",
      name: "Champion",
      leaderboardSlug: "nba_limited_champion",
      leaderboardName: "Limited Champion",
      draft: false,
      captainCardSlug: null,
      cardSlugs: [starter.slug],
      playerNames: ["Starter One"],
    };

    const events = evaluateAlertEvents(
      {
        cards: [starter, bench],
        currentLineups: [lineup],
        previousInjuriesByName: {},
        currentInjuriesByName: {
          "starter one": {
            playerName: "Starter One",
            normalizedName: "starter one",
            teamName: "BOS",
            status: "OUT",
            rawStatus: "Out",
            comment: "Knee",
          },
          "bench two": {
            playerName: "Bench Two",
            normalizedName: "bench two",
            teamName: "LAL",
            status: "OUT",
            rawStatus: "Out",
            comment: "Ankle",
          },
        },
        bargainListings: [],
        watchlist: [],
        fixtures: [],
        lastAlertAtByKey: {},
      },
      {},
      baseConfig,
      Date.UTC(2026, 10, 22, 12, 0, 0),
    );

    expect(events).toHaveLength(1);
    expect(events[0].playerName).toBe("Starter One");
  });

  it("flags OUT, DOUBTFUL, and 0G starters inside the gw_cutoff window", () => {
    const outStarter = card("out-guy", "bos", 30, 30, { playerName: "Out Guy" });
    const byeStarter = card("bye-guy", "mia", 28, 28, { playerName: "Bye Guy" });
    const okStarter = card("ok-guy", "den", 25, 25, { playerName: "Ok Guy" });
    const lineup: CurrentLineupEntry = {
      id: "l-open",
      name: "In-Season Contender",
      leaderboardSlug: "nba_limited_contender",
      leaderboardName: "Limited Contender",
      draft: false,
      captainCardSlug: null,
      cardSlugs: [outStarter.slug, byeStarter.slug, okStarter.slug],
      playerNames: ["Out Guy", "Bye Guy", "Ok Guy"],
    };

    const nowMs = Date.UTC(2026, 10, 22, 23, 30, 0);
    const lockIso = new Date(nowMs + 30 * 60_000).toISOString();

    const health = findPreLockLineupRisks(
      [lineup],
      [outStarter, byeStarter, okStarter],
      {
        "out guy": {
          playerName: "Out Guy",
          normalizedName: "out guy",
          teamName: "BOS",
          status: "OUT",
          rawStatus: "Out",
          comment: "Rest",
        },
      },
      { bos: 2, den: 2 }, // mia missing -> 0G
    );
    expect(health.flagged).toEqual(["Out Guy (OUT)", "Bye Guy (0G)"]);
    expect(health.affectedLineupIds).toEqual(["l-open"]);

    const events = evaluateAlertEvents(
      {
        cards: [outStarter, byeStarter, okStarter],
        currentLineups: [lineup],
        previousInjuriesByName: {
          "out guy": {
            playerName: "Out Guy",
            normalizedName: "out guy",
            teamName: "BOS",
            status: "OUT",
            rawStatus: "Out",
            comment: "Rest",
          },
        },
        currentInjuriesByName: {
          "out guy": {
            playerName: "Out Guy",
            normalizedName: "out guy",
            teamName: "BOS",
            status: "OUT",
            rawStatus: "Out",
            comment: "Rest",
          },
        },
        gamesPerTeam: { bos: 2, den: 2 },
        bargainListings: [],
        watchlist: [],
        fixtures: [
          {
            slug: "gw-12",
            displayName: "GW 12",
            aasmState: "opened",
            cutOffDate: lockIso,
            endDate: new Date(nowMs + 4 * 86400_000).toISOString(),
          },
        ],
        lastAlertAtByKey: {},
      },
      {},
      baseConfig,
      nowMs,
    );

    const cutoffEvent = events.find((e) => e.kind === "gw_cutoff");
    expect(cutoffEvent).toBeDefined();
    expect(cutoffEvent?.title).toContain("2 lineup risks");
    expect(cutoffEvent?.message).toContain("Out Guy (OUT)");
    expect(cutoffEvent?.message).toContain("Bye Guy (0G)");
    expect(cutoffEvent?.lineupIds).toEqual(["l-open"]);

    // Even if a healthy gw_cutoff alert already fired earlier, a new risk still alerts,
    // while an identical risk set stays deduped.
    const lateScratchEvents = evaluateAlertEvents(
      {
        cards: [outStarter, byeStarter, okStarter],
        currentLineups: [lineup],
        previousInjuriesByName: {},
        currentInjuriesByName: {
          "out guy": {
            playerName: "Out Guy",
            normalizedName: "out guy",
            teamName: "BOS",
            status: "OUT",
            rawStatus: "Out",
            comment: "Late scratch",
          },
        },
        gamesPerTeam: { bos: 2, den: 2 },
        bargainListings: [],
        watchlist: [],
        fixtures: [
          {
            slug: "gw-12",
            displayName: "GW 12",
            aasmState: "opened",
            cutOffDate: lockIso,
            endDate: new Date(nowMs + 4 * 86400_000).toISOString(),
          },
        ],
        lastAlertAtByKey: { "gw_cutoff:gw-12": nowMs - 10 * 60_000 },
      },
      {},
      baseConfig,
      nowMs,
    );
    const lateRisk = lateScratchEvents.find((e) => e.kind === "gw_cutoff");
    expect(lateRisk).toBeDefined();
    expect(lateRisk?.dedupeKey).toContain("gw-12:risks:");

    const repeatEvents = evaluateAlertEvents(
      {
        cards: [outStarter, byeStarter, okStarter],
        currentLineups: [lineup],
        previousInjuriesByName: {},
        currentInjuriesByName: {
          "out guy": {
            playerName: "Out Guy",
            normalizedName: "out guy",
            teamName: "BOS",
            status: "OUT",
            rawStatus: "Out",
            comment: "Late scratch",
          },
        },
        gamesPerTeam: { bos: 2, den: 2 },
        bargainListings: [],
        watchlist: [],
        fixtures: [
          {
            slug: "gw-12",
            displayName: "GW 12",
            aasmState: "opened",
            cutOffDate: lockIso,
            endDate: new Date(nowMs + 4 * 86400_000).toISOString(),
          },
        ],
        lastAlertAtByKey: { [lateRisk!.dedupeKey]: nowMs - 5 * 60_000 },
      },
      {},
      baseConfig,
      nowMs,
    );
    expect(repeatEvents.filter((e) => e.kind === "gw_cutoff")).toHaveLength(0);
  });

  it("keeps floor and ceiling DFS fast (< 500ms) on a 60-card gallery", () => {
    const teams = ["bos", "den", "lal", "mia", "dal", "phx", "nyk", "okc", "mil", "gsw"];
    const bigGallery: GalleryCard[] = Array.from({ length: 60 }, (_, i) =>
      card(`g-${i}`, teams[i % teams.length], 15 + (i % 30), 16 + (i % 28), {
        l5: 15 + ((i * 7) % 30),
        starCost: [1, 1.5, 2, 2.5, 3, 3.5, 4][i % 7],
      }),
    );
    const gamesPerTeam = Object.fromEntries(teams.map((t) => [t, 3]));
    for (const strategy of ["floor", "ceiling"] as const) {
      const start = performance.now();
      const res = generateTopLineups(bigGallery, {
        format: "champion_16",
        strategy,
        rarityFilter: "limited",
        projectionSource: "blended_smart",
        customProjectionsRaw: "",
        injuriesByName: {},
        gamesPerTeam,
        excludeOut: true,
        excludeQuestionable: false,
        inSeasonOnly: false,
        minInSeasonCards: 4,
        disjointAcrossLineups: true,
        maxLineups: 5,
        captainBonusPct: 0,
      });
      const elapsedMs = performance.now() - start;
      expect(res.lineups.length).toBe(5);
      expect(elapsedMs).toBeLessThan(500);
    }
  });
});

describe("v2.7.5-exp3: Sorare NBA Scoring Matrix calculator", () => {
  it("computes exact weights plus DD (+1) and cumulative TD (+2)", () => {
    // 20 PTS (20) + 10 REB (12) + 5 AST (7.5) + 2 STL (6) + 1 BLK (3) - 2 TO (-4) + 3 3PM (3) = 47.5 raw + 1 DD = 48.5
    const dd = calculateSorareNbaScore({
      points: 20,
      rebounds: 10,
      assists: 5,
      steals: 2,
      blocks: 1,
      turnovers: 2,
      threePointersMade: 3,
    });
    expect(dd.rawScore).toBe(47.5);
    expect(dd.doubleDoubleBonus).toBe(1);
    expect(dd.tripleDoubleBonus).toBe(0);
    expect(dd.totalScore).toBe(48.5);

    // 10 PTS (10) + 10 REB (12) + 10 AST (15) = 37 raw + 1 DD + 1 TD = 39.0
    const td = calculateSorareNbaScore({
      points: 10,
      rebounds: 10,
      assists: 10,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      threePointersMade: 0,
    });
    expect(td.doubleDigitCategories).toBe(3);
    expect(td.doubleDoubleBonus).toBe(1);
    expect(td.tripleDoubleBonus).toBe(1);
    expect(td.totalScore).toBe(39);

    expect(applyLineupBonus(50, 15)).toBe(57.5);
    // Clamps negative / NaN stats cleanly
    const clean = calculateSorareNbaScore({
      points: -5,
      rebounds: Number.NaN,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: -2,
      threePointersMade: 0,
    });
    expect(clean.totalScore).toBe(0);
  });
});

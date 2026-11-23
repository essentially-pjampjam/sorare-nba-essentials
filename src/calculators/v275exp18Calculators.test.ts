import { describe, expect, it } from "vitest";
import {
  CARD_TAG_VALUES,
  MAX_TAGS_PER_USER,
  countCardTags,
  filterCardsByTag,
  isValidCardTag,
  normalizeCloudWorkerUrl,
  normalizeSavedRosters,
  sanitizeCardTagsMap,
  setCardTagInMap,
} from "./cardTagsMath";
import {
  computePortfolioPnl,
  filterPriceHistoryByRange,
  summarizePortfolioSeries,
  toUtcDateKey,
  upsertPortfolioSnapshot,
} from "./portfolioMath";
import { buildGameWeekRecapData, buildGameWeekRecapFilename } from "./recapShareMath";
import {
  compareVersions,
  isUpdateAvailable,
  parseSemver,
  shouldCheckForUpdate,
} from "./updateCheckerMath";
import { buildWrappedFilename, buildWrappedSummary } from "./wrappedMath";
import type {
  CardOwnershipRecord,
  GalleryCard,
  PlayerPricePoint,
  PortfolioSnapshot,
  ProProgressRecord,
} from "../shared/types";

function makeCard(overrides: Partial<GalleryCard> = {}): GalleryCard {
  return {
    slug: "lebron-james-2026-limited-1",
    playerSlug: "lebron-james",
    playerName: "LeBron James",
    teamName: "Los Angeles Lakers",
    teamSlug: "los-angeles-lakers",
    positions: ["basketball_forward"],
    rarity: "limited",
    seasonYear: 2026,
    inSeasonEligible: true,
    isFirstOwner: true,
    cardEditionName: "standard",
    pictureUrl: null,
    starCost: 4,
    grade: 10,
    l10: 42.5,
    l5: 45.0,
    sorareClassicProjected: 44.0,
    sorareDailyProjected: 44.0,
    powerMultiplier: 1.1,
    lowestAskCents: 2500,
    lowestAskCardSlug: null,
    auctionBidCents: null,
    sealed: false,
    ...overrides,
  };
}

describe("v2.7.5-exp18 updateCheckerMath", () => {
  it("parses and compares stable vs experimental prerelease versions accurately", () => {
    expect(parseSemver("v2.7.5-exp18")).toEqual({
      major: 2,
      minor: 7,
      patch: 5,
      prerelease: "exp18",
      prereleaseNum: 18,
    });
    expect(compareVersions("2.7.5", "2.7.5-exp18")).toBeGreaterThan(0);
    expect(compareVersions("2.7.5-exp19", "2.7.5-exp18")).toBeGreaterThan(0);
    expect(compareVersions("2.8.0", "2.7.5")).toBeGreaterThan(0);
    expect(compareVersions("2.7.4", "2.7.5-exp18")).toBeLessThan(0);
    expect(compareVersions("v2.7.5", "2.7.5")).toBe(0);
  });

  it("respects dismissed versions and handles invalid tags safely", () => {
    expect(isUpdateAvailable("2.7.5-exp18", "v2.7.5")).toBe(true);
    expect(isUpdateAvailable("2.7.5-exp18", "v2.7.5", "2.7.5")).toBe(false);
    expect(isUpdateAvailable("2.7.5-exp18", "v2.7.6", "2.7.5")).toBe(true);
    expect(isUpdateAvailable("2.7.5-exp18", "v2.7.4")).toBe(false);
    expect(isUpdateAvailable("2.7.5-exp18", null)).toBe(false);
    expect(isUpdateAvailable("2.7.5-exp18", "not-a-semver")).toBe(false);
  });

  it("checks daily update interval properly", () => {
    const now = 1_760_000_000_000;
    expect(shouldCheckForUpdate(null, now)).toBe(true);
    expect(shouldCheckForUpdate(now - 23 * 3600_000, now)).toBe(false);
    expect(shouldCheckForUpdate(now - 25 * 3600_000, now)).toBe(true);
  });
});

describe("v2.7.5-exp18 recapShareMath", () => {
  it("builds Game Week recap data from local Pro history and pulse", () => {
    const history: ProProgressRecord[] = [
      {
        lineupId: "l1",
        fixtureSlug: "nba-21-23-nov-2026",
        leaderboardSlug: "nba-21-23-nov-2026-nba_limited_in_season_champion",
        leaderboardName: "Limited Champion",
        rank: 42,
        score: 268.4,
        totalEntries: 2000,
        paidPlaces: 1000,
        cashPlaces: 100,
        updatedAt: 1000,
      },
      {
        lineupId: "l2",
        fixtureSlug: "nba-21-23-nov-2026",
        leaderboardSlug: "nba-21-23-nov-2026-nba_limited_in_season_contender",
        leaderboardName: "Limited Contender",
        rank: 1500,
        score: 180.1,
        totalEntries: 2000,
        paidPlaces: 1000,
        cashPlaces: 100,
        updatedAt: 1000,
      },
    ];
    const recap = buildGameWeekRecapData({
      username: "pjampjam",
      weekSummary: {
        fixtureSlug: "nba-21-23-nov-2026",
        lineups: 2,
        rewarded: 1,
        cash: 1,
        bestTopPct: 2.1,
        totalScore: 448.5,
      },
      historyRecords: history,
      pulse: {
        gameWeeks: 4,
        totalLineups: 8,
        rewardedLineups: 5,
        cashLineups: 2,
        rewardHitRatePct: 63,
        cashHitRatePct: 25,
        bestTopPct: 2.1,
        currentRewardStreak: 3,
      },
    });
    expect(recap).not.toBeNull();
    expect(recap?.totalPoints).toBe(448.5);
    expect(recap?.rewardedCount).toBe(1);
    expect(recap?.cashCount).toBe(1);
    expect(recap?.currentRewardStreak).toBe(3);
    expect(recap?.bestLineup?.leaderboardName).toBe("Limited Champion");
    expect(buildGameWeekRecapFilename("nba-21-23-nov-2026", "@pjampjam")).toBe(
      "sorare-gw-recap-pjampjam-nba-21-23-nov-2026.png",
    );
  });

  it("returns null when neither group nor weekSummary is available", () => {
    expect(buildGameWeekRecapData({ username: "pjampjam" })).toBeNull();
  });
});

describe("v2.7.5-exp18 portfolioMath", () => {
  it("deduplicates daily snapshots by date + rarity + currency and computes range delta", () => {
    const day1 = Date.UTC(2026, 10, 15, 12, 0, 0);
    const day2 = Date.UTC(2026, 10, 20, 12, 0, 0);
    let list: PortfolioSnapshot[] = [];
    list = upsertPortfolioSnapshot(list, {
      date: toUtcDateKey(day1),
      totalFloorCents: 10_000,
      cardCount: 10,
      pricedCardCount: 10,
      rarity: "limited",
      currency: "EUR",
      capturedAtMs: day1,
    });
    // Updating same day replaces instead of duplicating
    list = upsertPortfolioSnapshot(list, {
      date: toUtcDateKey(day1),
      totalFloorCents: 11_000,
      cardCount: 10,
      pricedCardCount: 10,
      rarity: "limited",
      currency: "EUR",
      capturedAtMs: day1 + 3600_000,
    });
    list = upsertPortfolioSnapshot(list, {
      date: toUtcDateKey(day2),
      totalFloorCents: 13_200,
      cardCount: 11,
      pricedCardCount: 11,
      rarity: "limited",
      currency: "EUR",
      capturedAtMs: day2,
    });

    expect(list).toHaveLength(2);
    const series = summarizePortfolioSeries(list, "limited", "EUR", "week", day2 + 1000);
    expect(series.deltaCents).toBe(2200);
    expect(series.deltaPct).toBe(20);
  });

  it("computes Skinledger-style P&L, biggest spend, best auction, best trade, and excludeCurrentSeason", () => {
    const records: CardOwnershipRecord[] = [
      {
        cardSlug: "c1",
        playerSlug: "p1",
        playerName: "Nikola Jokic",
        teamSlug: "denver-nuggets",
        rarity: "limited",
        seasonYear: 2026,
        acquiredAtMs: 1000,
        acquiredPriceCents: 8000,
        acquisitionType: "instant_buy",
        currentFloorCents: 9000,
        currency: "EUR",
      },
      {
        cardSlug: "c2",
        playerSlug: "p2",
        playerName: "Jalen Williams",
        teamSlug: "oklahoma-city-thunder",
        rarity: "limited",
        seasonYear: 2025,
        acquiredAtMs: 1000,
        acquiredPriceCents: 1500,
        acquisitionType: "auction",
        currentFloorCents: 3500,
        currency: "EUR",
      },
      {
        cardSlug: "c3",
        playerSlug: "p3",
        playerName: "Derrick White",
        teamSlug: "boston-celtics",
        rarity: "limited",
        seasonYear: 2025,
        acquiredAtMs: 1000,
        acquiredPriceCents: 1200,
        acquisitionType: "trade",
        currentFloorCents: 2200,
        currency: "EUR",
      },
    ];

    const all = computePortfolioPnl(records, { activeSeasonYear: 2026 });
    expect(all.includedCards).toBe(3);
    expect(all.pairedCards).toBe(3);
    expect(all.totalCostBasisCents).toBe(10700);
    expect(all.totalCurrentValueCents).toBe(14700);
    expect(all.unrealizedPnlCents).toBe(4000);
    expect(all.biggestSpend?.playerName).toBe("Nikola Jokic");
    expect(all.bestAuctionWon?.playerName).toBe("Jalen Williams");
    expect(all.bestTrade?.playerName).toBe("Derrick White");

    const priorOnly = computePortfolioPnl(records, {
      excludeCurrentSeason: true,
      activeSeasonYear: 2026,
    });
    expect(priorOnly.includedCards).toBe(2);
    expect(priorOnly.pairedCards).toBe(2);
    expect(priorOnly.excludedCurrentSeasonCards).toBe(1);
    expect(priorOnly.biggestSpend?.playerName).toBe("Jalen Williams");
  });

  it("does not fabricate fake P&L from unpaired cards missing cost basis or floor price", () => {
    const records: CardOwnershipRecord[] = [
      {
        cardSlug: "unpriced-paid",
        playerSlug: "p1",
        playerName: "Paid Unpriced",
        teamSlug: "boston-celtics",
        rarity: "limited",
        seasonYear: 2025,
        acquiredAtMs: 1000,
        acquiredPriceCents: 10000,
        acquisitionType: "instant_buy",
        currentFloorCents: null,
        currency: "EUR",
      },
      {
        cardSlug: "priced-unknown-cost",
        playerSlug: "p2",
        playerName: "Priced Unknown Cost",
        teamSlug: "boston-celtics",
        rarity: "limited",
        seasonYear: 2025,
        acquiredAtMs: 1000,
        acquiredPriceCents: null,
        acquisitionType: "unknown",
        currentFloorCents: 5000,
        currency: "EUR",
      },
      {
        cardSlug: "paired-card",
        playerSlug: "p3",
        playerName: "Paired Card",
        teamSlug: "boston-celtics",
        rarity: "limited",
        seasonYear: 2025,
        acquiredAtMs: 1000,
        acquiredPriceCents: 2000,
        acquisitionType: "auction",
        currentFloorCents: 3000,
        currency: "EUR",
      },
    ];
    const summary = computePortfolioPnl(records, { activeSeasonYear: 2026 });
    expect(summary.includedCards).toBe(3);
    expect(summary.pairedCards).toBe(1);
    expect(summary.totalCostBasisCents).toBe(12000);
    expect(summary.totalCurrentValueCents).toBe(8000);
    // Only the paired card (+1000 on 2000 cost = +50%) counts toward unrealized P&L
    expect(summary.unrealizedPnlCents).toBe(1000);
    expect(summary.unrealizedPnlPct).toBe(50);

    // When zero cards are paired, P&L is 0 and pct is null
    const unpairedOnly = computePortfolioPnl(records.slice(0, 2), { activeSeasonYear: 2026 });
    expect(unpairedOnly.pairedCards).toBe(0);
    expect(unpairedOnly.unrealizedPnlCents).toBe(0);
    expect(unpairedOnly.unrealizedPnlPct).toBeNull();
  });

  it("filters player price history cleanly across Day / Week / Month ranges", () => {
    const now = Date.UTC(2026, 10, 23, 12, 0, 0);
    const pts: PlayerPricePoint[] = [
      { date: "2026-09-01", timestampMs: now - 80 * 86400_000, priceCents: 1000, currency: "EUR" },
      { date: "2026-11-15", timestampMs: now - 8 * 86400_000, priceCents: 1200, currency: "EUR" },
      { date: "2026-11-22", timestampMs: now - 1 * 86400_000, priceCents: 1500, currency: "EUR" },
      { date: "2026-11-23", timestampMs: now - 2 * 3600_000, priceCents: 1600, currency: "EUR" },
    ];
    expect(filterPriceHistoryByRange(pts, "day", now)).toHaveLength(2);
    expect(filterPriceHistoryByRange(pts, "week", now)).toHaveLength(3);
    expect(filterPriceHistoryByRange(pts, "month", now)).toHaveLength(4);
    expect(filterPriceHistoryByRange([], "month", now)).toEqual([]);
  });
});

describe("v2.7.5-exp18 wrappedMath", () => {
  it("builds multi-slide Wrapped summary with MVP, favorite team, essence, and auction steal", () => {
    const cards = [
      makeCard({ slug: "c1", playerName: "Luka Doncic", l10: 55.2, teamSlug: "los-angeles-lakers" }),
      makeCard({ slug: "c2", playerName: "Austin Reaves", l10: 33.1, teamSlug: "los-angeles-lakers" }),
      makeCard({ slug: "c3", playerName: "Cade Cunningham", l10: 41.0, teamSlug: "detroit-pistons" }),
    ];
    const history: ProProgressRecord[] = [
      {
        lineupId: "1",
        fixtureSlug: "nba-gw1",
        leaderboardSlug: "nba-gw1-nba_limited_champion",
        leaderboardName: "Limited Champion",
        rank: 10,
        score: 295.4,
        totalEntries: 1000,
        paidPlaces: 500,
        cashPlaces: 50,
        updatedAt: 2000,
      },
      {
        lineupId: "2",
        fixtureSlug: "nba-gw2",
        leaderboardSlug: "nba-gw2-nba_limited_champion",
        leaderboardName: "Limited Champion",
        rank: 20,
        score: 260.0,
        totalEntries: 1000,
        paidPlaces: 500,
        cashPlaces: 50,
        updatedAt: 3000,
      },
    ];
    const wrapped = buildWrappedSummary({
      mode: "year_end",
      username: "pjampjam",
      progressHistory: history,
      galleryCards: cards,
      essenceByRarity: { limited: 800, rare: 200, super_rare: 0, unique: 0 },
      commonEssence: 500,
    });

    expect(wrapped.slides).toHaveLength(5);
    expect(wrapped.totalGameWeeks).toBe(2);
    expect(wrapped.bestScore).toBe(295.4);
    expect(wrapped.longestRewardStreak).toBe(2);
    expect(wrapped.mvpCardName).toBe("Luka Doncic");
    expect(wrapped.favoriteTeamName).toBe("Los Angeles Lakers");
    expect(wrapped.favoriteTeamCount).toBe(2);
    expect(wrapped.totalEssence).toBe(1500);
    expect(wrapped.currency).toBe("EUR");
    expect(buildWrappedFilename("playoffs", "pjampjam")).toBe("sorare-wrapped-playoffs-pjampjam.png");

    const usdWrapped = buildWrappedSummary({
      mode: "regular_season",
      username: "pjampjam",
      progressHistory: history,
      galleryCards: cards,
      currency: "USD",
      ownershipRecords: [
        {
          cardSlug: "c1",
          playerSlug: "luka-doncic",
          playerName: "Luka Doncic",
          teamSlug: "los-angeles-lakers",
          rarity: "limited",
          seasonYear: 2026,
          acquiredAtMs: 1000,
          acquiredPriceCents: 1500,
          acquisitionType: "auction",
          currentFloorCents: 2500,
          currency: "USD",
        },
      ],
    });
    expect(usdWrapped.currency).toBe("USD");
    expect(usdWrapped.bestAuctionStealLabel).toContain("+$10.00");
    expect(usdWrapped.slides.find((s) => s.id === "market")?.subtext).toContain("$75.00");
  });
});

describe("v2.7.5-exp18 cardTagsMath", () => {
  it("enforces strict enum tags, slug validation, and 500-tag anti-bloat cap", () => {
    expect(CARD_TAG_VALUES).toEqual(["keep", "sell", "core", "trade"]);
    expect(isValidCardTag("core")).toBe(true);
    expect(isValidCardTag("custom_spam")).toBe(false);

    const raw: Record<string, unknown> = {
      "Valid-Card-1": "keep",
      "valid-card-1": "core",
      "valid-card-2": "trade",
      "bad-tag-card": "delete_me",
      "bad slug with spaces": "keep",
    };
    const clean = sanitizeCardTagsMap(raw);
    expect(clean).toEqual({ "valid-card-1": "core", "valid-card-2": "trade" });
    expect(countCardTags(clean)).toEqual({ keep: 0, sell: 0, core: 1, trade: 1 });

    // 500-tag cap
    const bloated: Record<string, string> = {};
    for (let i = 0; i < MAX_TAGS_PER_USER + 25; i++) {
      bloated[`card-${i}`] = "keep";
    }
    const capped = sanitizeCardTagsMap(bloated);
    expect(Object.keys(capped)).toHaveLength(MAX_TAGS_PER_USER);

    const toggledOff = setCardTagInMap(clean, "valid-card-1", null);
    expect(toggledOff["valid-card-1"]).toBeUndefined();

    const cards = [makeCard({ slug: "valid-card-1" }), makeCard({ slug: "valid-card-2" })];
    expect(filterCardsByTag(cards, clean, "trade")).toHaveLength(1);
  });

  it("normalizes saved rosters and validates HTTPS Cloudflare Worker URLs", () => {
    const rosters = normalizeSavedRosters([
      {
        id: "r1",
        name: "Core 16 Star",
        formatLabel: "Champion 16★",
        cardSlugs: ["c1", "c2", "c3", "c4", "c5", "c6_extra"],
        playerNames: ["A", "B", "C", "D", "E", "F"],
        projectedTotal: 245.67,
        createdAtMs: 1234,
      },
      { invalid: true },
    ]);
    expect(rosters).toHaveLength(1);
    expect(rosters[0].cardSlugs).toHaveLength(5);
    expect(rosters[0].projectedTotal).toBe(245.7);

    expect(normalizeCloudWorkerUrl("https://tags.example.workers.dev/")).toBe(
      "https://tags.example.workers.dev",
    );
    expect(normalizeCloudWorkerUrl("http://evil.com")).toBeNull();
    expect(normalizeCloudWorkerUrl("http://localhost:8787/")).toBe("http://localhost:8787");
  });
});

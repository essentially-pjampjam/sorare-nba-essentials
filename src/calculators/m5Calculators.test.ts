import { describe, expect, it } from "vitest";
import type { DailySlateGame, GalleryCard } from "../shared/types";
import { rankDailyPickerCandidates } from "./commonSetMath";
import { selectDailyPickerWindow } from "./dailySlateMath";
import { summarizeRewardTiers, type RawRankReward } from "./rewardTiersMath";

const game = (tip: string, home: string, away: string, state: DailySlateGame["state"] = "pre"): DailySlateGame => ({
  id: `${tip}:${home}`,
  tipOffIso: tip,
  homeTeamSlug: home,
  awayTeamSlug: away,
  homeAbbr: home.slice(0, 3).toUpperCase(),
  awayAbbr: away.slice(0, 3).toUpperCase(),
  state,
});

const card = (slug: string, team: string, l10: number, daily: number | null): GalleryCard => ({
  slug,
  rarity: "common",
  seasonYear: 2026,
  inSeasonEligible: false,
  grade: 0,
  powerMultiplier: 1,
  teamName: team,
  teamSlug: team,
  playerSlug: slug,
  playerName: slug,
  positions: ["basketball_guard"],
  l10,
  l5: l10,
  sorareClassicProjected: null,
  sorareDailyProjected: daily,
  starCost: 2,
});

describe("Daily Picker window (live: games before the next 07:00 UTC reset)", () => {
  const games = [
    game("2026-11-19T00:00:00Z", "orlando-magic", "philadelphia-76ers", "post"),
    game("2026-11-20T01:00:00Z", "milwaukee-bucks", "portland-trail-blazers"),
    game("2026-11-20T01:00:00Z", "san-antonio-spurs", "la-clippers"),
    game("2026-11-21T00:30:00Z", "atlanta-hawks", "charlotte-hornets"),
  ];

  it("keeps only unstarted games before the next reset", () => {
    const w = selectDailyPickerWindow(games, Date.parse("2026-11-19T12:00:00Z"));
    expect(w.endIso).toBe("2026-11-20T07:00:00.000Z");
    expect(w.games.map((g) => g.homeTeamSlug)).toEqual(["milwaukee-bucks", "san-antonio-spurs"]);
    expect(w.teamSlugs).toContain("portland-trail-blazers");
    expect(w.teamSlugs).not.toContain("atlanta-hawks");
  });

  it("rolls to the next day's window once today's games have tipped off", () => {
    const w = selectDailyPickerWindow(games, Date.parse("2026-11-20T02:00:00Z"));
    expect(w.games.map((g) => g.homeTeamSlug)).toEqual(["atlanta-hawks"]);
    expect(w.endIso).toBe("2026-11-21T07:00:00.000Z");
    expect(w.rolledToNext).toBe(true);
  });

  it("ranks only players of slate teams, including unowned roster players", () => {
    const owned = [card("heat-guard", "miami-heat", 25, 40), card("bucks-guard", "milwaukee-bucks", 20, 30)];
    const roster = [card("spurs-star", "san-antonio-spurs", 30, 45)];
    const picks = rankDailyPickerCandidates(owned, {}, {}, 5, {
      allowedTeamSlugs: ["milwaukee-bucks", "san-antonio-spurs"],
      extraPlayers: roster,
    });
    const names = picks.map((p) => p.card.playerSlug);
    expect(names).not.toContain("heat-guard");
    expect(names).toEqual(expect.arrayContaining(["bucks-guard", "spurs-star"]));
    expect(picks.find((p) => p.card.playerSlug === "spurs-star")?.projectedScore).toBe(45);
  });
});

describe("Live leaderboard reward tiers (GW10 Limited In-Season Champion)", () => {
  const cash = (usd: number, ranks: number): RawRankReward => ({
    ranks,
    rewardConfigs: [{ __typename: "MonetaryRewardConfig", amount: { usdCents: usd * 100 } }],
  });
  const essence = (q: number, ranks: number): RawRankReward => ({
    ranks,
    rewardConfigs: [{ __typename: "CardShardRewardConfig", quantity: q }],
  });
  const xp = (ranks: number): RawRankReward => ({
    ranks,
    rewardConfigs: [{ __typename: "InGameCurrencyRewardConfig", currency: "LIMITED_XP", amount: 100 }],
  });
  const ranking = [
    cash(2000, 1), cash(1000, 1), cash(500, 1), cash(250, 1), cash(125, 1), cash(50, 5), cash(25, 40),
    essence(2000, 50), essence(1000, 150), essence(750, 250), essence(500, 500), essence(250, 500),
    xp(500), xp(1000),
  ];

  it("splits cash, Essence and XP ranks", () => {
    const s = summarizeRewardTiers(ranking);
    expect(s.cashPlaces).toBe(50);
    expect(s.paidPlaces).toBe(1500);
    expect(s.topCashLabel).toBe("$2,000");
    expect(s.tiers[0]).toEqual({ fromRank: 1, toRank: 1, kind: "cash", label: "$2,000" });
    expect(s.tiers.at(-1)).toMatchObject({ fromRank: 2001, toRank: 3000, kind: "xp" });
  });

  it("untyped rows (no-API-key fallback) still count as paid ranks", () => {
    const s = summarizeRewardTiers([{ ranks: 3 }, { ranks: 7 }]);
    expect(s.paidPlaces).toBe(10);
    expect(s.cashPlaces).toBe(0);
    expect(s.topCashLabel).toBeNull();
  });
});

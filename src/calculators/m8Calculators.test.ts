import { describe, expect, it } from "vitest";
import { pickCurrentSquadStep, summarizeSquadActivity } from "./squadActivityMath";
import type { SquadSnapshot } from "../shared/types";

const u = (slug: string) => ({ slug, nickname: slug.toUpperCase() });

const snapshot: SquadSnapshot = {
  squadName: "Lazy Goats",
  membersCount: 4,
  maxMembersCount: 10,
  captainSlug: "cap",
  members: [u("cap"), u("me"), u("ghost"), u("busy")],
  steps: [
    { state: "CLAIMED", target: 450, totalLineups: 3, minimumLineups: 3, totalScore: 539, lineupUsers: [u("cap"), u("me"), u("busy")] },
    { state: "LIVE", target: 650, totalLineups: 2, minimumLineups: 3, totalScore: 411.7, lineupUsers: [u("cap"), u("me")] },
    { state: "LOCKED", target: 730, totalLineups: 0, minimumLineups: 3, totalScore: 0, lineupUsers: [] },
  ],
  scannedAt: 0,
};

describe("squad activity", () => {
  it("picks the LIVE stage", () => {
    expect(pickCurrentSquadStep(snapshot.steps)?.target).toBe(650);
  });

  it("flags members with no team in the live stage, least active first", () => {
    const s = summarizeSquadActivity(snapshot, "me");
    expect(s.missing.map((m) => m.slug)).toEqual(["ghost", "busy"]);
    expect(s.teamsNeededToStart).toBe(1);
    expect(s.pointsToTarget).toBe(238.3);
    expect(s.progressPct).toBe(63);
    expect(s.members.find((m) => m.slug === "me")?.isMe).toBe(true);
    expect(s.members.find((m) => m.slug === "cap")?.isCaptain).toBe(true);
    expect(s.members.find((m) => m.slug === "busy")?.stagesSeen).toBe(2);
    expect(s.counting.map((m) => m.slug)).toEqual(["cap", "me"]);
    expect(s.members[0].liveRank).toBe(1);
  });

  it("counts only the best teams (Sorare lists them best first)", () => {
    const live = { state: "LIVE", target: 650, totalLineups: 4, minimumLineups: 3, totalScore: 558, lineupUsers: [u("cap"), u("busy"), u("me"), u("ghost")] };
    const s = summarizeSquadActivity({ ...snapshot, steps: [live] }, "me");
    expect(s.counting.map((m) => m.slug)).toEqual(["cap", "busy", "me"]);
    expect(s.members.find((m) => m.slug === "ghost")?.counting).toBe(false);
    expect(s.pointsToTarget).toBe(92);
    expect(s.pointsPerCountingTeam).toBe(30.7);
  });

  it("infers members from lineups when the member list was not loaded", () => {
    const s = summarizeSquadActivity({ ...snapshot, members: [] }, null);
    expect(s.membersInferred).toBe(true);
    expect(s.members.map((m) => m.slug).sort()).toEqual(["busy", "cap", "me"]);
  });
});

import { analyzePack, buildPackAdvice, tierStars } from "./packAdvisorMath";
import type { SetPackInfo } from "../shared/types";

describe("pack advisor (live Bronze odds, 2026-11-20)", () => {
  const bronze: SetPackInfo = {
    slug: "divination-nba-bronze-pack",
    title: "Bronze",
    price: 1000,
    currency: "COMMON_ESSENCE",
    category: null,
    endDate: null,
    cardsCount: 4,
    slots: [
      [
        { tier: "ROSTER_PLUS", basisPoints: 450 },
        { tier: "ROSTER", basisPoints: 2550 },
        { tier: "RESERVE_PLUS", basisPoints: 1050 },
        { tier: "RESERVE", basisPoints: 5950 },
      ],
      [
        { tier: "GOAT", basisPoints: 10 },
        { tier: "STAR_PLUS", basisPoints: 40 },
        { tier: "STAR", basisPoints: 150 },
        { tier: "IMPACT_PLUS", basisPoints: 276 },
        { tier: "IMPACT", basisPoints: 1564 },
        { tier: "ROSTER_PLUS", basisPoints: 1194 },
        { tier: "ROSTER", basisPoints: 6766 },
      ],
    ],
  };

  it("maps tiers to stars", () => {
    expect(tierStars("GOAT")).toBe(5);
    expect(tierStars("IMPACT_PLUS")).toBe(3.5);
    expect(tierStars("RESERVE")).toBe(1);
  });

  it("computes 3★+ / 4★+ chances and affordability", () => {
    const a = analyzePack(bronze, 23);
    expect(a.chance3StarPct).toBe(20.4);
    expect(a.chance4StarPct).toBe(2);
    expect(a.affordable).toBe(false);
    expect(a.lastSlotTop[0]).toEqual({ label: "Icon", pct: 0.1 });
  });

  it("puts the free Daily Pack first and shows Bronze+ progress", () => {
    const advice = buildPackAdvice(
      [analyzePack(bronze, 23)],
      { dailyPackClaimed: false, bronzePlusProgress: 6, bronzePlusTarget: 10, scannedAt: 0 },
      23,
      0,
    );
    expect(advice[0].kind).toBe("daily");
    expect(advice.find((x) => x.kind === "bronze_plus")?.text).toContain("4 more packs");
    expect(advice.some((x) => x.kind === "essence")).toBe(true);
  });
});

import { buildSetTeams } from "./commonSetMath";
import type { GalleryCard } from "../shared/types";

describe("set solo timing", () => {
  const mk = (slug: string, team: string, score: number, stars = 3): GalleryCard =>
    ({
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
      l10: score,
      l5: score,
      sorareClassicProjected: score,
      sorareDailyProjected: score,
      starCost: stars,
      starSource: "live",
    }) as GalleryCard;
  // Five today players (30 pts each) and five tomorrow players (34 pts each), all 3 stars.
  const cards = [
    ...["a", "b", "c", "d", "e"].map((s) => mk(`t-${s}`, "today-team", 30)),
    ...["a", "b", "c", "d", "e"].map((s) => mk(`l-${s}`, "later-team", 34)),
  ];
  const base = {
    mode: "solo" as const,
    teamCount: 1,
    projectionSource: "sorare_projected" as const,
    customProjectionsRaw: "",
    injuriesByName: {},
    gamesPerTeam: { "today-team": 1 },
    excludeOut: true,
    disjointAcrossTeams: true,
    todayTeamSlugs: ["today-team"],
    laterTeamSlugs: ["later-team"],
  };

  it("today_only drafts only today's players", () => {
    const r = buildSetTeams(cards, { ...base, soloTiming: "today_only" });
    expect(r.soloTeams[0].lineup.slots.every((s) => s.evaluated.card.teamSlug === "today-team")).toBe(true);
  });

  it("any_day takes the higher projections from tomorrow", () => {
    const r = buildSetTeams(cards, { ...base, soloTiming: "any_day" });
    expect(r.soloTeams[0].lineup.slots.every((s) => s.evaluated.card.teamSlug === "later-team")).toBe(true);
    expect(r.soloTeams[0].todayPlayers).toBe(0);
  });

  it("today_first prefers today's players (34 * 0.8 < 30) and reports real totals", () => {
    const r = buildSetTeams(cards, { ...base, soloTiming: "today_first" });
    const t = r.soloTeams[0];
    expect(t.todayPlayers).toBe(5);
    expect(t.projectedTotal).toBeCloseTo(t.todayProjected, 1);
    expect(t.todayStepOdds[0].target).toBe(150);
  });
});

import { buildDuplicateAdvice } from "./duplicateAdvisorMath";

describe("duplicate sell advisor", () => {
  const card = (slug: string, extra: Partial<GalleryCard> = {}): GalleryCard =>
    ({
      slug,
      rarity: "limited",
      seasonYear: 2026,
      inSeasonEligible: false,
      grade: 0,
      powerMultiplier: 1,
      teamName: "t",
      teamSlug: "t",
      playerSlug: "p",
      playerName: "P",
      positions: [],
      l10: 20,
      l5: 20,
      sorareClassicProjected: 20,
      sorareDailyProjected: 20,
      starCost: 2,
      lowestAskCents: 150,
      ...extra,
    }) as GalleryCard;

  it("keeps the best copy, sealed and Shiny, sells the rest at the floor", () => {
    const groups = buildDuplicateAdvice([
      card("a", { inSeasonEligible: true }),
      card("b"),
      card("c", { sealed: true }),
      card("d", { cardEditionName: "divination_shiny_base" }),
      card("e"),
    ]);
    const g = groups[0];
    expect(g.cards.find((x) => x.card.slug === "a")?.action).toBe("keep");
    expect(g.cards.find((x) => x.card.slug === "c")?.action).toBe("keep");
    expect(g.cards.find((x) => x.card.slug === "d")?.reason).toBe("Shiny edition");
    expect(g.extras).toBe(2);
    expect(g.sellValueCents).toBe(300);
  });

  it("keeps a 2nd copy of lineup players and scraps extra Set copies", () => {
    const groups = buildDuplicateAdvice(
      [card("a", { rarity: "common" }), card("b", { rarity: "common" }), card("c", { rarity: "common" })],
      { lineupPlayerSlugs: new Set(["p"]) },
    );
    expect(groups[0].cards.map((x) => x.action)).toEqual(["keep", "keep", "scrap"]);
  });
});

import { fixtureFromLeaderboard, mergeProProgressHistory, summarizeProHistory, summarizeProProgress } from "./proProgressMath";
import type { CurrentLineupEntry, LeaderboardBenchmark } from "../shared/types";

describe("pro progress tracker", () => {
  const lb = "nba-21-23-nov-2026-nba_limited_in_season_champion";
  const bench = {
    fixtureSlug: "nba-21-23-nov-2026",
    leaderboardSlug: lb,
    displayName: "In-Season Champion",
    totalEntries: 1000,
    paidPlaces: 300,
    cashPlaces: 50,
    paidCutoffScore: 250,
  } as LeaderboardBenchmark;
  const lineup = (id: string, rank: number | null, score: number | null): CurrentLineupEntry => ({
    id,
    name: id,
    leaderboardSlug: lb,
    leaderboardName: "x",
    draft: false,
    cardSlugs: [],
    captainCardSlug: null,
    source: "api",
    rank,
    score,
  });

  it("reads the fixture from a leaderboard slug", () => {
    expect(fixtureFromLeaderboard(lb)).toBe("nba-21-23-nov-2026");
  });

  it("classifies cash / rewards / outside", () => {
    const rows = summarizeProProgress([lineup("a", 20, 300), lineup("b", 200, 260), lineup("c", 450, 220)], [bench]);
    expect(rows.map((r) => r.status)).toEqual(["cash", "rewarded", "outside"]);
    expect(rows[2].ranksToReward).toBe(150);
    expect(rows[2].pointsToRewardCut).toBe(30);
    expect(rows[0].topPct).toBe(2);
  });

  it("keeps history per Game Week", () => {
    const h = mergeProProgressHistory([], [lineup("a", 20, 300), lineup("c", 450, 220)], [bench], 1);
    const weeks = summarizeProHistory(h);
    expect(weeks[0]).toMatchObject({ fixtureSlug: "nba-21-23-nov-2026", lineups: 2, rewarded: 1, cash: 1, bestTopPct: 2 });
  });
});

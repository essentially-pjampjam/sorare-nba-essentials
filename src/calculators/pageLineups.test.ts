import { describe, expect, it } from "vitest";
import { mergePageLineups, openPageLineupsAsEntries } from "../background/lineupScanner";
import type { LeaderboardBenchmark, PageLineup } from "../shared/types";
import { benchmarkFor, leaderboardKind, summarizePageLineups } from "./proProgressMath";

const lineup = (over: Partial<PageLineup>): PageLineup => ({
  id: "So5Lineup:a",
  name: "In Season",
  leaderboardSlug: "nba-21-23-nov-2026-nba_limited_in_season_contender",
  leaderboardName: "Limited Contender",
  fixtureSlug: "nba-21-23-nov-2026",
  fixtureName: "Game Week 10",
  fixtureState: "started",
  cutOffDate: "2026-11-21T00:00:00Z",
  endDate: "2026-11-23T04:24:11Z",
  cardSlugs: ["c1", "c2", "c3", "c4", "c5"],
  playerNames: ["A", "B", "C", "D", "E"],
  rank: 383,
  liveProjectedRank: 2493,
  score: 135.44,
  totalEntries: 4790,
  canEdit: false,
  ...over,
});

const bench = {
  fixtureSlug: "nba-17-20-nov-2026",
  fixtureName: "Game Week 9",
  leaderboardSlug: "nba-17-20-nov-2026-nba_limited_in_season_contender",
  displayName: "Limited Contender",
  totalEntries: 5000,
  paidPlaces: 2750,
  cashPlaces: 100,
  paidCutoffScore: 150,
} as unknown as LeaderboardBenchmark;

describe("page lineups (Current Pro Progress)", () => {
  it("matches last week's benchmark by competition and scales places to the live field", () => {
    expect(leaderboardKind("nba-21-23-nov-2026-nba_limited_in_season_contender")).toBe("nba_limited_in_season_contender");
    const b = benchmarkFor("nba-21-23-nov-2026-nba_limited_in_season_contender", [bench], 4790);
    expect(b.paid).toBe(2635);
    expect(b.cash).toBe(96);
  });

  it("groups live lineups first with rank, top % and reward status", () => {
    const groups = summarizePageLineups(
      [
        lineup({ id: "up", fixtureSlug: "nba-24-26-nov-2026", fixtureName: "Game Week 11", fixtureState: "opened", rank: null }),
        lineup({ id: "l1", rank: 3000 }),
        lineup({ id: "l2" }),
      ],
      [bench],
    );
    expect(groups.map((g) => g.phase)).toEqual(["live", "upcoming"]);
    expect(groups[0].rows.map((r) => r.lineupId)).toEqual(["l2", "l1"]);
    expect(groups[0].rows[0]).toMatchObject({ status: "rewarded", topPct: 8, score: 135.4, liveProjectedRank: 2493 });
    expect(groups[0].rows[1]).toMatchObject({ status: "outside", ranksToReward: 365 });
    expect(groups[1].rows[0]).toMatchObject({ status: "unranked", rank: null });
  });

  it("a fresh read replaces only the Game Weeks it saw and drops finished weeks", () => {
    const now = Date.parse("2026-11-22T12:00:00Z");
    const prev = {
      userSlug: "me",
      scannedAt: 0,
      lineups: [
        lineup({ id: "old-live" }),
        lineup({ id: "up", fixtureSlug: "nba-24-26-nov-2026", fixtureState: "opened", endDate: null }),
        lineup({ id: "gone", fixtureSlug: "nba-17-20-nov-2026", endDate: "2026-11-20T04:00:00Z" }),
      ],
    };
    const next = mergePageLineups(prev, { userSlug: "me", lineups: [lineup({ id: "new-live" })] }, now);
    expect(next.lineups.map((l) => l.id).sort()).toEqual(["new-live", "up"]);
    expect(openPageLineupsAsEntries(next).map((e) => e.sorareLineupId)).toEqual(["up"]);
  });

  it("ignores a saved snapshot of another user", () => {
    const next = mergePageLineups({ userSlug: "other", scannedAt: 0, lineups: [lineup({ id: "x" })] }, { userSlug: "me", lineups: [] }, 0);
    expect(next.lineups).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { GalleryCard, PlayerSeasonStats } from "../shared/types";
import {
  DAILY_MISSIONS,
  buildDailyPickIdeas,
  classifyPickerTaskMode,
  filterPickerTasksForMode,
  parsePickerMission,
  probabilityStatAtLeast,
} from "./dailyPicksMath";
import { generateTopLineups } from "./lineupOptimizerMath";

const makeCard = (
  slug: string,
  name: string,
  teamSlug: string,
  opts: Partial<GalleryCard> = {},
): GalleryCard => ({
  slug,
  rarity: "limited",
  seasonYear: 2026,
  inSeasonEligible: true,
  grade: 0,
  powerMultiplier: 1,
  teamName: teamSlug,
  teamSlug,
  playerSlug: slug,
  playerName: name,
  positions: ["basketball_guard"],
  l10: 25,
  l5: 25,
  sorareClassicProjected: 25,
  sorareDailyProjected: 25,
  starCost: 2,
  starSource: "live",
  ...opts,
});

const makeStats = (overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats => ({
  avgRebounds: 3,
  avgMinutes: 26,
  avgPoints: 10,
  avgAssists: 4.5,
  gamesPlayed: 15,
  ...overrides,
});

describe("v2.7.5-exp7 Playmaker Picker & named tier parsing", () => {
  it("parses Sorare's live Playmaker Picker ('ranked DNP Plus or less' + 4+ assists)", () => {
    const spec = parsePickerMission(
      {
        title: "Playmaker Picker",
        description:
          "Classic: Pick a player ranked DNP Plus or less who records 4+ assists in today's games and win 25 Essence per successful choice. Win a total of 250 Essence if all your picks are successful.",
        mode: "DECISIVE",
        slug: "nba-daily-fantasy-playmaker-picker",
        picks: 3,
      },
      "limited",
    );
    expect(spec.kind).toBe("stat");
    expect(spec.stat).toBe("assists");
    expect(spec.target).toBe(4);
    expect(spec.maxStars).toBe(1.5);
    expect(spec.picks).toBe(3);
    expect(spec.reward).toContain("25 Essence");
    expect(spec.reward).toContain("250 Essence");
  });

  it("maps named Sorare gameplay tiers to maxStars", () => {
    const cases: Array<[string, number]> = [
      ["Pick a player ranked DNP or less who records 3+ assists.", 1],
      ["Pick a player ranked DNP + or less who records 4+ assists.", 1.5],
      ["Pick a player ranked Reserve or less who grabs 5+ rebounds.", 1],
      ["Pick a player ranked Reserve+ or less who grabs 5+ rebounds.", 1.5],
      ["Pick a player ranked Reserve + or less who grabs 5+ rebounds.", 1.5],
      ["Pick a player ranked Roster or less who scores 15+ points.", 2],
      ["Pick a player ranked Roster Plus or less who scores 15+ points.", 2.5],
      ["Pick a player rated Impact or less who records 2+ steals.", 3],
      ["Pick a player rated Impact Plus or less who records 2+ blocks.", 3.5],
      ["Pick a player ranked Star or less who records 6+ assists.", 4],
      ["Pick a player ranked Star Plus or less who records 6+ assists.", 4.5],
      ["Pick a player ranked GOAT or less who scores 25+ points.", 5],
      ["Pick a player ranked Icon or less who scores 25+ points.", 5],
    ];
    for (const [description, expectedStars] of cases) {
      const spec = parsePickerMission(
        { title: "Stat Picker", description, mode: "DECISIVE", slug: "stat-picker", picks: 3 },
        "limited",
      );
      expect(spec.maxStars, description).toBe(expectedStars);
    }
  });

  it("matches 'points.' at end of sentence while ignoring 'points per'", () => {
    const endPeriod = parsePickerMission(
      {
        title: "Scorer Picker",
        description: "Pick a player ranked Roster or less who scores 20+ points.",
        mode: "DECISIVE",
        slug: "nba-scorer-picker",
        picks: 3,
      },
      "limited",
    );
    expect(endPeriod).toMatchObject({ kind: "stat", stat: "points", target: 20, maxStars: 2 });

    const pointsPerOnly = parsePickerMission(
      {
        title: "Mystery Picker",
        description: "Pick a player averaging high points per game today.",
        mode: "DECISIVE",
        slug: "nba-mystery-picker",
        picks: 3,
      },
      "limited",
    );
    expect(pointsPerOnly.kind).toBe("score");
  });

  it("includes playmaker preset and filters by <= 1.5 stars", () => {
    expect(DAILY_MISSIONS.playmaker).toMatchObject({
      kind: "stat",
      stat: "assists",
      target: 4,
      maxStars: 1.5,
    });
    const ideas = buildDailyPickIdeas({
      mission: "playmaker",
      strategy: "best",
      ownership: "all",
      ownedCards: [
        makeCard("backup-pg", "Backup Guard", "boston-celtics", { starCost: 1.5 }),
        makeCard("star-pg", "Star Guard", "boston-celtics", { starCost: 3.5 }),
      ],
      extraPlayers: [],
      injuriesByName: {},
      slateTeamSlugs: ["boston-celtics"],
      statsByName: {
        "backup guard": makeStats({ avgAssists: 5.2 }),
        "star guard": makeStats({ avgAssists: 9.1 }),
      },
      limit: 5,
    });
    expect(ideas.map((i) => i.card.playerSlug)).toEqual(["backup-pg"]);
    expect(ideas[0].targetLabel).toBe("4 ast");
    expect(ideas[0].hitPct).toBeGreaterThan(60);
  });
});

describe("v2.7.5-exp7 Negative Binomial count-stat probability", () => {
  it("handles zero/non-positive/non-finite bounds cleanly", () => {
    expect(probabilityStatAtLeast(0, 4)).toBe(0);
    expect(probabilityStatAtLeast(-1, 4)).toBe(0);
    expect(probabilityStatAtLeast(3, 0)).toBe(99);
    expect(probabilityStatAtLeast(4, Number.NaN)).toBe(0);
  });

  it("is strictly monotonic and accurate for low-mean assist specialists", () => {
    const low = probabilityStatAtLeast(0.5, 4);
    const mid = probabilityStatAtLeast(2.5, 4);
    const atMean = probabilityStatAtLeast(4.0, 4);
    const high = probabilityStatAtLeast(5.5, 4);
    expect(low).toBeLessThanOrEqual(2);
    expect(mid).toBeGreaterThan(low);
    expect(atMean).toBeGreaterThanOrEqual(45);
    expect(atMean).toBeLessThanOrEqual(55);
    expect(high).toBeGreaterThan(65);
    expect(probabilityStatAtLeast(4.0, 6)).toBeLessThan(atMean);
  });
});

describe("v2.7.5-exp7 Manual Lock (Must-Start) in generateTopLineups", () => {
  const pool: GalleryCard[] = [
    makeCard("p1", "Alpha One", "team-a", { starCost: 4, sorareClassicProjected: 48, l10: 45 }),
    makeCard("p2", "Beta Two", "team-b", { starCost: 3.5, sorareClassicProjected: 42, l10: 38 }),
    makeCard("p3", "Gamma Three", "team-c", { starCost: 3, sorareClassicProjected: 36, l10: 32 }),
    makeCard("p4", "Delta Four", "team-d", { starCost: 2.5, sorareClassicProjected: 30, l10: 26 }),
    makeCard("p5", "Epsilon Five", "team-e", { starCost: 2, sorareClassicProjected: 26, l10: 22 }),
    makeCard("p6", "Zeta Six", "team-f", { starCost: 1.5, sorareClassicProjected: 18, l10: 15 }),
    makeCard("p7", "Eta Seven", "team-g", { starCost: 2, sorareClassicProjected: 25, l10: 21 }),
    makeCard("p8", "Theta Eight", "team-h", { starCost: 2, sorareClassicProjected: 24, l10: 20 }),
    makeCard("p9", "Iota Nine", "team-i", { starCost: 2, sorareClassicProjected: 23, l10: 19 }),
    makeCard("p10", "Kappa Ten", "team-j", { starCost: 2, sorareClassicProjected: 22, l10: 18 }),
  ];

  const baseOptions = {
    format: "champion_16" as const,
    rarityFilter: "limited" as const,
    projectionSource: "sorare_projected" as const,
    customProjectionsRaw: "",
    injuriesByName: {},
    gamesPerTeam: Object.fromEntries(pool.map((c) => [c.teamSlug!, 2])),
    excludeOut: true,
    excludeQuestionable: false,
    inSeasonOnly: false,
    minInSeasonCards: 0,
    disjointAcrossLineups: true,
    maxLineups: 2,
  };

  it("forces a locked lower-projection card into lineup #1 while staying under cap", () => {
    const unlocked = generateTopLineups(pool, baseOptions);
    const firstUnlockedSlugs = unlocked.lineups[0].slots.map((s) => s.evaluated.card.slug);
    expect(firstUnlockedSlugs).not.toContain("p6");

    const locked = generateTopLineups(pool, {
      ...baseOptions,
      lockedCardSlugs: ["p6"],
    });
    expect(locked.lineups.length).toBe(2);
    const firstLockedSlugs = locked.lineups[0].slots.map((s) => s.evaluated.card.slug);
    const secondLockedSlugs = locked.lineups[1].slots.map((s) => s.evaluated.card.slug);
    expect(firstLockedSlugs).toContain("p6");
    expect(locked.lineups[0].totalStars).toBeLessThanOrEqual(16);
    expect(secondLockedSlugs).not.toContain("p6");
  });

  it("returns no illegal lineup when locked cards exceed the star cap", () => {
    const res = generateTopLineups(pool, {
      ...baseOptions,
      format: "contender_11",
      lockedCardSlugs: ["p1", "p2", "p3", "p4"], // 4 + 3.5 + 3 + 2.5 = 13 > 11
    });
    expect(res.lineups).toHaveLength(0);
  });

  it("respects 120 non-MVP L10 cap when a card is locked in daily_120_mvp", () => {
    const res = generateTopLineups(pool, {
      ...baseOptions,
      format: "daily_120_mvp",
      lockedCardSlugs: ["p6"],
      maxLineups: 1,
    });
    expect(res.lineups).toHaveLength(1);
    const slots = res.lineups[0].slots;
    expect(slots.map((s) => s.evaluated.card.slug)).toContain("p6");
    const nonMvpL10 = slots
      .filter((s) => !s.isCaptainOrMvp)
      .reduce((sum, s) => sum + (s.evaluated.card.l10 ?? 0), 0);
    expect(nonMvpL10).toBeLessThanOrEqual(120);
  });

  it("rejects impossible lock sets (duplicate player or more than 5 eligible locked cards)", () => {
    const poolWithDup = [
      ...pool,
      makeCard("p1-dup", "Alpha One", "team-a", {
        playerSlug: "p1",
        starCost: 4,
        sorareClassicProjected: 47,
        l10: 44,
      }),
    ];
    const dupRes = generateTopLineups(poolWithDup, {
      ...baseOptions,
      format: "uncapped",
      lockedCardSlugs: ["p1", "p1-dup"],
      maxLineups: 1,
    });
    expect(dupRes.lineups).toHaveLength(0);

    const overFiveRes = generateTopLineups(pool, {
      ...baseOptions,
      format: "uncapped",
      lockedCardSlugs: ["p1", "p2", "p3", "p4", "p5", "p6"],
      maxLineups: 1,
    });
    expect(overFiveRes.lineups).toHaveLength(0);
  });
});

describe("v2.7.5-exp12 Set vs Pro Daily Picker isolation", () => {
  it("separates Set Daily Picker from Pro Classic Daily Picker and Playmaker Picker", () => {
    const mixed = [
      {
        title: "Daily Picker",
        description: "Pick a player who outperforms his L10 by 7 points. The player must also score at least 20 fantasy points.",
        mode: "SCORE",
        slug: "set-daily-picker",
        picks: 1,
      },
      {
        title: "Daily Picker",
        description: "Classic: Pick a player who outperforms his L10 by 7 points and win 100 XP per successful choice. The player must also score at least 20 fantasy points.",
        mode: "SCORE",
        slug: "pro-daily-picker",
        picks: 3,
      },
      {
        title: "Playmaker Picker",
        description: "Classic: Pick a player ranked DNP Plus or less who records 4+ assists in today's games and win 25 Essence per successful choice.",
        mode: "STAT",
        slug: "pro-playmaker-picker",
        picks: 3,
      },
    ];
    expect(classifyPickerTaskMode(mixed[0])).toBe("set");
    expect(classifyPickerTaskMode(mixed[1])).toBe("pro");
    expect(classifyPickerTaskMode(mixed[2])).toBe("pro");

    const setOnly = filterPickerTasksForMode(mixed, "set");
    expect(setOnly).toHaveLength(1);
    expect(setOnly[0].slug).toBe("set-daily-picker");

    const proOnly = filterPickerTasksForMode(mixed, "pro");
    expect(proOnly.map((t) => t.slug)).toEqual(["pro-daily-picker", "pro-playmaker-picker"]);
  });
});

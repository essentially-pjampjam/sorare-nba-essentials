import { describe, expect, it } from "vitest";
import { buildSetTeams, rankDailyPickerCandidates } from "./commonSetMath";
import { computeStarCost } from "./lineupOptimizerMath";
import type { GalleryCard, InjuryReportEntry } from "../shared/types";

function makeCommon(
  playerSlug: string,
  playerName: string,
  l10: number,
  l5: number,
  proj: number,
): GalleryCard {
  return {
    slug: `${playerSlug}-common`,
    rarity: "common",
    seasonYear: 2026,
    inSeasonEligible: true,
    grade: 0,
    powerMultiplier: 1,
    teamName: "Boston Celtics",
    teamSlug: "boston-celtics",
    playerSlug,
    playerName,
    positions: ["basketball_guard"],
    l10,
    l5,
    sorareClassicProjected: proj,
    sorareDailyProjected: null,
    starCost: computeStarCost(l10),
  };
}

describe("commonSetMath", () => {
  it("ranks Daily Picker candidates against max(20, L10 + 7) and skips OUT players", () => {
    const pool = [
      // Target = max(20, 12+7) = 20. Proj = 29 => +9 edge!
      makeCommon("breakout", "Breakout Kid", 12, 28, 30),
      // Target = max(20, 35+7) = 42. Proj = 38 => -4 edge
      makeCommon("steady", "Steady Vet", 35, 36, 39),
      makeCommon("injured", "Injured Star", 10, 20, 32),
    ];

    const injuries: Record<string, InjuryReportEntry> = {
      "injured star": {
        playerName: "Injured Star",
        normalizedName: "injured star",
        teamName: "Boston Celtics",
        status: "OUT",
        rawStatus: "Out",
        comment: "Knee",
      },
    };

    const ranked = rankDailyPickerCandidates(pool, injuries, {});
    expect(ranked[0].card.playerSlug).toBe("breakout");
    expect(ranked[0].targetScore).toBe(20);
    expect(ranked[0].edgeVsTarget).toBeGreaterThan(4);
    expect(ranked.some((c) => c.card.playerSlug === "injured")).toBe(false);
  });

  it("auto-builds configurable N teams (e.g. 4 teams) in Solo and Squad modes", () => {
    const pool: GalleryCard[] = [];
    for (let i = 1; i <= 20; i += 1) {
      pool.push(makeCommon(`p${i}`, `Player ${i}`, 18 + (i % 8), 22, 35 - i));
    }

    const solo4 = buildSetTeams(pool, {
      mode: "solo",
      teamCount: 4,
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(solo4.soloPicks).toHaveLength(4);
    expect(solo4.soloPicks[0].card.playerSlug).toBe("p1");

    const squad4 = buildSetTeams(pool, {
      mode: "squad",
      teamCount: 4,
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(squad4.squadTeams).toHaveLength(4);
    expect(squad4.squadTeams[0].capUsed).toBeLessThanOrEqual(120);
  });

  it("supports building 8 disjoint Set squads from larger pools without 32-card truncation", () => {
    const largePool: GalleryCard[] = [];
    for (let i = 1; i <= 45; i += 1) {
      largePool.push(makeCommon(`lp${i}`, `Large Player ${i}`, 16 + (i % 6), 20, 46 - i * 0.5));
    }

    const squad8 = buildSetTeams(largePool, {
      mode: "squad",
      teamCount: 8,
      projectionSource: "sorare_projected",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludeOut: true,
      disjointAcrossTeams: true,
    });
    expect(squad8.squadTeams).toHaveLength(8);
  });
});

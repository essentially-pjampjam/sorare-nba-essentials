import { describe, expect, it } from "vitest";
import {
  DEFAULT_CRAFT_CLUES,
  evaluateCraftPool,
} from "./craftAdvisorMath";
import type { CraftPoolPlayer } from "../shared/types";

function makePlayer(overrides: Partial<CraftPoolPlayer>): CraftPoolPlayer {
  return {
    playerSlug: "p-default",
    playerName: "Player Default",
    age: 24,
    positions: ["basketball_guard"],
    teamName: "San Antonio Spurs",
    teamSlug: "san-antonio-spurs",
    conference: "WEST",
    averageL10: 35,
    qualityTier: "TIER_2",
    availableSupply: 100,
    floorCents: 500,
    floorCardSlug: "p-default-card",
    marketUrl: "https://sorare.com/nba/cards/p-default-card",
    ...overrides,
  };
}

describe("craftAdvisorMath", () => {
  const pool: CraftPoolPlayer[] = [
    makePlayer({
      playerSlug: "wemby",
      playerName: "Victor Wembanyama",
      age: 22,
      positions: ["basketball_center", "basketball_forward"],
      teamSlug: "san-antonio-spurs",
      conference: "WEST",
      averageL10: 66,
      qualityTier: "TIER_0",
      availableSupply: 100,
      floorCents: 18500,
    }),
    makePlayer({
      playerSlug: "jokic",
      playerName: "Nikola Jokic",
      age: 31,
      positions: ["basketball_center"],
      teamSlug: "denver-nuggets",
      conference: "WEST",
      averageL10: 60,
      qualityTier: "TIER_0",
      availableSupply: 100,
      floorCents: 12000,
    }),
    makePlayer({
      playerSlug: "bench-guard",
      playerName: "Bench Guard",
      age: 26,
      positions: ["basketball_guard"],
      teamSlug: "miami-heat",
      teamName: "Miami Heat",
      conference: "EAST",
      averageL10: 18,
      qualityTier: "TIER_4",
      availableSupply: 800,
      floorCents: 50,
    }),
  ];

  it("computes baseline vs post-clue win probability percentage shifts and EV", () => {
    // Baseline: 200 / 1000 = 20% T0
    const baseline = evaluateCraftPool(pool, DEFAULT_CRAFT_CLUES);
    expect(baseline.tier0ChancePct).toBeCloseTo(20, 4);
    expect(baseline.tier0DeltaPct).toBeCloseTo(0, 4);
    expect(baseline.mostExpensivePlayer?.player.playerSlug).toBe("wemby");

    // Reveal clue: Center position -> eliminates Bench Guard -> T0 jumps from 20% to 100% (+80%!)
    const afterCenter = evaluateCraftPool(pool, {
      ...DEFAULT_CRAFT_CLUES,
      positions: ["basketball_center"],
    });
    expect(afterCenter.filteredCount).toBe(2);
    expect(afterCenter.tier0ChancePct).toBeCloseTo(100, 4);
    expect(afterCenter.tier0DeltaPct).toBeCloseTo(80, 4);
    expect(afterCenter.expectedValueCents).toBe(15250);
    expect(afterCenter.candidates[0].oddsMultiplier).toBeCloseTo(5, 4);
  });

  it("excludes seen players and flags incomplete collection overlaps", () => {
    const res = evaluateCraftPool(
      pool,
      {
        ...DEFAULT_CRAFT_CLUES,
        positions: ["basketball_center"],
        excludedPlayerSlugs: ["wemby"],
      },
      new Set(["jokic"]),
    );

    expect(res.filteredCount).toBe(1);
    expect(res.candidates[0].player.playerSlug).toBe("jokic");
    expect(res.candidates[0].pullChancePct).toBeCloseTo(100, 4);
    expect(res.bestCollectionNeedPlayer?.player.playerSlug).toBe("jokic");
  });
});

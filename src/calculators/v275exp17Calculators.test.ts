import { describe, expect, it } from "vitest";
import type { ProProgressRecord } from "../shared/types";
import {
  buildLineupShareFilename,
  formatSharePlayerName,
  rarityShareAccent,
  resolveShareTeamInfo,
} from "./lineupShareMath";
import { summarizeProSeasonPulse } from "./proProgressMath";

describe("lineupShareMath", () => {
  it("formats player names and initials cleanly including single names and long last names", () => {
    expect(formatSharePlayerName("Nikola Jokic")).toEqual({
      first: "Nikola",
      last: "Jokic",
      initials: "NJ",
    });
    expect(formatSharePlayerName("Shai Gilgeous-Alexander")).toEqual({
      first: "Shai",
      last: "Gilgeous-Ale.",
      initials: "SG",
    });
    expect(formatSharePlayerName("Nene")).toEqual({
      first: "",
      last: "Nene",
      initials: "NE",
    });
    expect(formatSharePlayerName("   ")).toEqual({
      first: "",
      last: "Player",
      initials: "PL",
    });
  });

  it("resolves known NBA teams and falls back cleanly for unknown slugs", () => {
    const bos = resolveShareTeamInfo("boston-celtics");
    expect(bos.abbr).toBe("BOS");
    expect(bos.color).toMatch(/^#/);

    const fallback = resolveShareTeamInfo("unknown-team");
    expect(fallback.abbr).toBe("NBA");
  });

  it("builds safe PNG filenames with optional username", () => {
    expect(buildLineupShareFilename("Champion 16★", "pjampjam")).toBe(
      "sorare-nba-champion-16-pjampjam.png",
    );
    expect(buildLineupShareFilename("Set Solo #1", null)).toBe(
      "sorare-nba-set-solo-1.png",
    );
    expect(buildLineupShareFilename("   ", "")).toBe("sorare-nba-lineup.png");
  });

  it("returns distinct rarity palettes for all scarcities", () => {
    expect(rarityShareAccent("limited").label).toBe("LIMITED");
    expect(rarityShareAccent("rare").label).toBe("RARE");
    expect(rarityShareAccent("super_rare").label).toBe("SUPER RARE");
    expect(rarityShareAccent("unique").label).toBe("UNIQUE");
    expect(rarityShareAccent("common").label).toBe("SET");
  });
});

describe("summarizeProSeasonPulse", () => {
  const mkRec = (overrides: Partial<ProProgressRecord>): ProProgressRecord => ({
    lineupId: "l1",
    fixtureSlug: "nba-gw-1",
    leaderboardSlug: "nba-gw-1-nba_limited_champion",
    leaderboardName: "Limited Champion",
    rank: 100,
    score: 210,
    totalEntries: 2000,
    paidPlaces: 400,
    cashPlaces: 120,
    updatedAt: 1000,
    ...overrides,
  });

  it("returns null for empty history", () => {
    expect(summarizeProSeasonPulse([])).toBeNull();
  });

  it("computes hit rates, best finish, and consecutive rewarded GW streak", () => {
    const history: ProProgressRecord[] = [
      // Most recent GW (t=3000): 1 cash + 1 outside -> rewarded GW
      mkRec({ lineupId: "gw3-a", fixtureSlug: "nba-gw-3", rank: 40, totalEntries: 2000, paidPlaces: 500, cashPlaces: 100, updatedAt: 3000 }),
      mkRec({ lineupId: "gw3-b", fixtureSlug: "nba-gw-3", rank: 900, totalEntries: 2000, paidPlaces: 500, cashPlaces: 100, updatedAt: 3000 }),
      // Previous GW (t=2000): 1 rewarded (non-cash) -> rewarded GW (streak = 2)
      mkRec({ lineupId: "gw2-a", fixtureSlug: "nba-gw-2", rank: 250, totalEntries: 2000, paidPlaces: 500, cashPlaces: 100, updatedAt: 2000 }),
      // Older GW (t=1000): 0 rewarded -> breaks streak
      mkRec({ lineupId: "gw1-a", fixtureSlug: "nba-gw-1", rank: 1200, totalEntries: 2000, paidPlaces: 500, cashPlaces: 100, updatedAt: 1000 }),
    ];

    const pulse = summarizeProSeasonPulse(history);
    expect(pulse).not.toBeNull();
    expect(pulse!.gameWeeks).toBe(3);
    expect(pulse!.totalLineups).toBe(4);
    expect(pulse!.rewardedLineups).toBe(2);
    expect(pulse!.cashLineups).toBe(1);
    expect(pulse!.rewardHitRatePct).toBe(50);
    expect(pulse!.cashHitRatePct).toBe(25);
    expect(pulse!.bestTopPct).toBe(2);
    expect(pulse!.currentRewardStreak).toBe(2);
  });

  it("sets streak to 0 when the most recent GW had no rewarded lineups", () => {
    const history: ProProgressRecord[] = [
      mkRec({ lineupId: "gw2", fixtureSlug: "nba-gw-2", rank: 900, paidPlaces: 500, cashPlaces: 100, updatedAt: 2000 }),
      mkRec({ lineupId: "gw1", fixtureSlug: "nba-gw-1", rank: 50, paidPlaces: 500, cashPlaces: 100, updatedAt: 1000 }),
    ];
    const pulse = summarizeProSeasonPulse(history);
    expect(pulse!.currentRewardStreak).toBe(0);
  });
});

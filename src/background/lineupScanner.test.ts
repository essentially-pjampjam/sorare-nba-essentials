import { describe, expect, it } from "vitest";
import type { PageLineup, PageLineupSnapshot } from "../shared/types";
import { isFullLineupsOverviewUrl, mergePageLineups } from "./lineupScanner";
import { isEncryptedSecret } from "./secretStore";

function makeLineup(overrides: Partial<PageLineup> = {}): PageLineup {
  return {
    id: "lu-1",
    name: "Contender #1",
    leaderboardSlug: "nba-contender",
    leaderboardName: "Contender",
    fixtureSlug: "nba-gw-10",
    fixtureName: "Game Week 10",
    fixtureState: "opened",
    cutOffDate: "2026-11-25T00:00:00Z",
    endDate: "2026-12-01T00:00:00Z",
    cardSlugs: ["card-a", "card-b"],
    playerNames: ["Player A", "Player B"],
    rank: null,
    liveProjectedRank: null,
    score: null,
    totalEntries: 1000,
    canEdit: true,
    ...overrides,
  };
}

describe("lineupScanner mergePageLineups & URL classification", () => {
  it("recognizes full /nba/lineups overview URLs vs partial board URLs", () => {
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/lineups")).toBe(true);
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026")).toBe(true);
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026")).toBe(false);
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/series/play")).toBe(false);
    expect(isFullLineupsOverviewUrl(undefined)).toBe(false);
  });

  it("replaces the whole Game Week on full overview pages so deleted lineups disappear", () => {
    const prev: PageLineupSnapshot = {
      userSlug: "pjampjam",
      scannedAt: 1000,
      lineups: [
        makeLineup({ id: "lu-1", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-2", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-prev-week", fixtureSlug: "nba-gw-11" }),
      ],
    };
    const next = mergePageLineups(
      prev,
      { userSlug: "pjampjam", lineups: [makeLineup({ id: "lu-1", name: "Updated #1", fixtureSlug: "nba-gw-10" })] },
      2000,
      true,
    );
    expect(next.lineups.map((l) => l.id).sort()).toEqual(["lu-1", "lu-prev-week"]);
    expect(next.lineups.find((l) => l.id === "lu-1")?.name).toBe("Updated #1");
  });

  it("upserts by id on partial pages so sibling lineups in the same Game Week are preserved", () => {
    const prev: PageLineupSnapshot = {
      userSlug: "pjampjam",
      scannedAt: 1000,
      lineups: [
        makeLineup({ id: "lu-1", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-2", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-3", fixtureSlug: "nba-gw-10" }),
      ],
    };
    const next = mergePageLineups(
      prev,
      { userSlug: "pjampjam", lineups: [makeLineup({ id: "lu-2", name: "Edited #2", fixtureSlug: "nba-gw-10" })] },
      2000,
      false,
    );
    expect(next.lineups.map((l) => l.id).sort()).toEqual(["lu-1", "lu-2", "lu-3"]);
    expect(next.lineups.find((l) => l.id === "lu-2")?.name).toBe("Edited #2");
  });
});

describe("secretStore isEncryptedSecret", () => {
  it("requires version 1 and both iv and ct strings", () => {
    expect(isEncryptedSecret({ v: 1, iv: "abc", ct: "xyz" })).toBe(true);
    expect(isEncryptedSecret({ v: 1, ct: "xyz" })).toBe(false);
    expect(isEncryptedSecret({ v: 1, iv: 123, ct: "xyz" })).toBe(false);
    expect(isEncryptedSecret({ v: 2, iv: "abc", ct: "xyz" })).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
  });
});

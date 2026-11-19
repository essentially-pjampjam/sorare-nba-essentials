import { describe, expect, it } from "vitest";
import { upsertDomLineups } from "./domLineupMerge";
import type { CurrentLineupEntry } from "./types";

const lineup = (
  players: string[],
  opts: { id?: string | null; lb?: string; fixture?: string } = {},
): CurrentLineupEntry => ({
  id: `dom-${opts.id ?? players.join("-")}`,
  name: "Classic Limited Contender #1",
  leaderboardSlug: opts.lb ?? "nba_limited_contender",
  leaderboardName: "Classic Limited Contender",
  draft: false,
  cardSlugs: [],
  playerNames: players,
  captainCardSlug: null,
  source: "dom",
  fixtureSlug: opts.fixture ?? "nba-21-23-nov-2026",
  sorareLineupId: opts.id ?? null,
});

const before = [
  "Aaron Gordon",
  "Brook Lopez",
  "Wendell Carter Jr.",
  "Quenton Jackson",
  "Dillon Brooks",
];
const after = ["Aaron Gordon", "Brook Lopez", "Wendell Carter Jr.", "Morez Johnson Jr.", "Dillon Brooks"];

describe("upsertDomLineups", () => {
  it("partial board page: replaces the swapped lineup (4/5 shared) and keeps the others", () => {
    const stored = [
      lineup(before, { id: "b" }),
      lineup(["Jarace Walker", "Bub Carrington", "Allen Graves", "Dean Wade", "Nikola Vučević"], {
        id: "c",
        lb: "nba_rare_contender",
      }),
    ];
    // Board pages expose no lineup id, only the competition from the URL.
    const merged = upsertDomLineups(stored, [lineup(after)], true);
    expect(merged).toHaveLength(2);
    expect(merged[0].playerNames).toEqual(after);
    expect(merged[0].sorareLineupId).toBe("b");
    expect(merged[1].sorareLineupId).toBe("c");
  });

  it("partial page: a lineup in another competition is appended, not merged", () => {
    const stored = [lineup(before, { id: "b" })];
    const merged = upsertDomLineups(stored, [lineup(after, { lb: "nba_limited_in_season_contender" })], true);
    expect(merged).toHaveLength(2);
  });

  it("partial page: drops stored lineups from an older Game Week", () => {
    const stored = [lineup(before, { id: "old", fixture: "nba-17-20-nov-2026" })];
    const merged = upsertDomLineups(stored, [lineup(after)], true);
    expect(merged.map((l) => l.playerNames)).toEqual([after]);
  });

  it("full Game Week page is authoritative (cleared lineups disappear)", () => {
    const stored = [lineup(before, { id: "b" }), lineup(["A B"], { id: "gone" })];
    const merged = upsertDomLineups(stored, [lineup(after, { id: "b" })], false);
    expect(merged).toHaveLength(1);
    expect(merged[0].playerNames).toEqual(after);
  });

  it("keeps stored lineups when nothing new was detected", () => {
    const stored = [lineup(before)];
    expect(upsertDomLineups(stored, [], true)).toBe(stored);
  });
});

import { describe, expect, it } from "vitest";
import type { GalleryCard, PlayerSeasonStats } from "../shared/types";
import { buildDailyPickIdeas, probabilityStatAtLeast } from "./dailyPicksMath";

const card = (
  name: string,
  team: string,
  opts: Partial<GalleryCard> = {},
): GalleryCard => ({
  slug: `${name}-limited`,
  rarity: "limited",
  seasonYear: 2026,
  inSeasonEligible: true,
  grade: 0,
  powerMultiplier: 1,
  teamName: team,
  teamSlug: team,
  playerSlug: name,
  playerName: name,
  positions: ["basketball_center"],
  l10: 20,
  l5: 20,
  sorareClassicProjected: null,
  sorareDailyProjected: null,
  starCost: 1.5,
  starSource: "live",
  ...opts,
});

const stats = (reb: number, min = 24, gp = 12): PlayerSeasonStats => ({
  avgRebounds: reb,
  avgMinutes: min,
  avgPoints: 10,
  gamesPlayed: gp,
});

describe("Daily pick ideas (Pro Daily Picker / Rebounds Picker)", () => {
  const base = {
    injuriesByName: {},
    slateTeamSlugs: ["milwaukee-bucks", "san-antonio-spurs"],
    limit: 10,
  };

  it("rebound odds rise with the average", () => {
    expect(probabilityStatAtLeast(8, 5)).toBeGreaterThan(probabilityStatAtLeast(4, 5));
    expect(probabilityStatAtLeast(0, 5)).toBe(0);
  });

  it("Rebounds Picker keeps only slate players rated 1.5 stars or less", () => {
    const owned = [
      card("big-cheap", "milwaukee-bucks"),
      card("big-star", "milwaukee-bucks", { starCost: 3 }),
      card("off-slate", "miami-heat"),
    ];
    const ideas = buildDailyPickIdeas({
      ...base,
      mission: "rebounds",
      strategy: "best",
      ownership: "all",
      ownedCards: owned,
      extraPlayers: [],
      statsByName: { "big cheap": stats(7), "big star": stats(11), "off slate": stats(9) },
    });
    expect(ideas.map((i) => i.card.playerSlug)).toEqual(["big-cheap"]);
    expect(ideas[0].targetLabel).toBe("5 reb");
  });

  it("ownership filter and risk strategy (upside tags only)", () => {
    const owned = [card("steady", "milwaukee-bucks", { l10: 25, l5: 25, sorareDailyProjected: 33 })];
    const roster = [
      { ...card("hot-hand", "san-antonio-spurs", { l10: 15, l5: 26, sorareDailyProjected: 24 }), slug: "roster:hot-hand", rarity: "common" as const },
    ];
    const args = {
      ...base,
      mission: "pro_daily" as const,
      ownedCards: owned,
      extraPlayers: roster,
      statsByName: {},
    };
    const mine = buildDailyPickIdeas({ ...args, strategy: "best", ownership: "owned" });
    expect(mine.map((i) => i.card.playerSlug)).toEqual(["steady"]);
    const notOwned = buildDailyPickIdeas({ ...args, strategy: "best", ownership: "not_owned" });
    expect(notOwned.every((i) => !i.owned)).toBe(true);
    const risk = buildDailyPickIdeas({ ...args, strategy: "risk", ownership: "all" });
    expect(risk.map((i) => i.card.playerSlug)).toEqual(["hot-hand"]);
    expect(risk[0].upsideTags[0]).toMatch(/Hot/);
  });
});

describe("League Collect ladders (live 2026-11-20)", () => {
  it("Non Playoffs at 20 goes to 35 (not 25); Playoffs at 15 goes to 25; Draft at 16 goes to 18", async () => {
    const { resolveNextQuestStep } = await import("./questOptimizerMath");
    expect(resolveNextQuestStep("non-playoffs-26", 20)).toEqual({ target: 35, reward: 1000 });
    expect(resolveNextQuestStep("playoffs-26", 15)).toEqual({ target: 25, reward: 500 });
    expect(resolveNextQuestStep("draft-26", 16)).toEqual({ target: 18, reward: 500 });
    expect(resolveNextQuestStep("conf-finals-26", 2)).toEqual({ target: 10, reward: 500 });
    expect(resolveNextQuestStep("full-collection", 0)).toEqual({ target: 1, reward: 2000 });
  });
});

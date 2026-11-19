import { describe, expect, it } from "vitest";
import type { GalleryCard } from "../shared/types";
import { computePriceChangePct, doesListingMatchWatchRule } from "./alertTrackerMath";
import { computeCountdownSnapshot, formatCountdown, nextDailyResetMs } from "./countdownMath";
import { evaluateCardForLineup, getCompetitionEntryLimit } from "./lineupOptimizerMath";
import { estimateSealingPoints } from "./sealingPoints";
import { evaluateSealCandidates } from "./vaultSealingMath";

function card(overrides: Partial<GalleryCard> & { slug: string }): GalleryCard {
  return {
    rarity: "limited",
    seasonYear: 2025,
    inSeasonEligible: false,
    grade: 1,
    powerMultiplier: 1,
    teamName: "Cleveland Cavaliers",
    teamSlug: "cleveland-cavaliers",
    playerSlug: overrides.slug,
    playerName: overrides.slug,
    positions: ["basketball_guard"],
    l10: 20,
    l5: 20,
    sorareClassicProjected: 20,
    sorareDailyProjected: 20,
    starCost: 2,
    ...overrides,
  };
}

describe("countdownMath", () => {
  it("rolls the daily reset over at exactly 07:00 UTC and across year end", () => {
    expect(new Date(nextDailyResetMs(Date.parse("2026-11-21T06:59:59Z"))).toISOString()).toBe(
      "2026-11-21T07:00:00.000Z",
    );
    expect(new Date(nextDailyResetMs(Date.parse("2026-11-21T07:00:00Z"))).toISOString()).toBe(
      "2026-11-22T07:00:00.000Z",
    );
    expect(new Date(nextDailyResetMs(Date.parse("2026-12-31T23:30:00Z"))).toISOString()).toBe(
      "2027-01-01T07:00:00.000Z",
    );
  });

  it("picks the next opened GW and ignores bad dates", () => {
    const now = Date.parse("2026-11-20T23:35:00Z");
    const snap = computeCountdownSnapshot(
      [
        { slug: "bad", displayName: "", cutOffDate: "nope", endDate: "", aasmState: "opened" },
        { slug: "gw10", displayName: "", cutOffDate: "2026-11-21T00:00:00Z", endDate: "", aasmState: "opened" },
        { slug: "gw9", displayName: "", cutOffDate: "2026-11-17T00:00:00Z", endDate: "", aasmState: "started" },
      ],
      now,
    );
    expect(snap.gwFixtureSlug).toBe("gw10");
    expect(snap.gwRemainingMs).toBe(25 * 60_000);
    expect(formatCountdown(snap.gwRemainingMs ?? 0)).toBe("25m 00s");
    expect(formatCountdown(Number.NaN)).toBe("0s");
    expect(formatCountdown((2 * 86_400 + 4 * 3_600) * 1000)).toBe("2d 4h");
  });
});

describe("alertTrackerMath", () => {
  it("guards zero / missing prices and rounds surge pct", () => {
    expect(computePriceChangePct(400, 500)).toBe(25);
    expect(computePriceChangePct(0, 160)).toBeNull();
    expect(computePriceChangePct(110, null)).toBeNull();
  });

  it("matches quest labels with or without the season prefix", () => {
    const listing = {
      priceCents: 245,
      rarity: "limited",
      isFirstOwnerEligible: true,
      questLabels: ["26' Non-Playoffs"],
      playerSlug: "p",
    } as Parameters<typeof doesListingMatchWatchRule>[0];
    const rule = {
      id: "r",
      kind: "quest_non_playoffs",
      label: "NP",
      rarity: "limited",
      maxPriceCents: 300,
      firstOwnerOnly: true,
      createdAt: 0,
    } as const;
    expect(doesListingMatchWatchRule(listing, rule)).toBe(true);
    expect(doesListingMatchWatchRule({ ...listing, priceCents: 301 }, rule)).toBe(false);
  });
});

describe("sealing", () => {
  it("uses Sorare's 1/2/5/20/50/200 point tiers and skips Common", () => {
    expect(estimateSealingPoints({ rarity: "limited", l10: 10 }).sealingPoints).toBe(1);
    expect(estimateSealingPoints({ rarity: "unique", l10: 40 }).sealingPoints).toBe(200);
    expect(estimateSealingPoints({ rarity: "common", l10: 40 }).sealingPoints).toBe(0);
  });

  it("ranks the spare copy first and never lists sealed cards", () => {
    const keeper = card({ slug: "a-2026", playerSlug: "a", inSeasonEligible: true, l10: 25 });
    const spare = card({ slug: "a-2024", playerSlug: "a", l10: 25 });
    const sealed = card({ slug: "b", playerSlug: "b", sealed: true });
    const res = evaluateSealCandidates([keeper, spare, sealed]);
    expect(res.map((r) => r.cardSlug)).toEqual(["a-2024", "a-2026"]);
    expect(res[0].isDuplicate).toBe(true);
    expect(res[0].warnings.join(" ")).toMatch(/14-day/);
  });
});

describe("card analytics", () => {
  it("is right-skewed, zero for 0G, and penalises B2B / low team totals", () => {
    const c = card({ slug: "x", l10: 25, l5: 25, sorareClassicProjected: 25 });
    const ev = evaluateCardForLineup(c, "blended_smart", new Map(), {}, { "cleveland-cavaliers": 1 });
    expect(ev.p90Ceiling - ev.p50Median).toBeGreaterThan(ev.p50Median - ev.p10Floor);
    const zero = evaluateCardForLineup(c, "blended_smart", new Map(), {}, { "cleveland-cavaliers": 0 });
    expect([zero.effectiveScore, zero.p10Floor, zero.p90Ceiling]).toEqual([0, 0, 0]);
    const sched = {
      teamSlug: "cleveland-cavaliers",
      teamName: "CLE",
      abbr: "CLE",
      games: 1,
      matchups: ["@ORL"],
      hasBackToBack: true,
      difficultyTag: "TOUGH" as const,
      impliedTeamTotal: 105,
    };
    const tired = evaluateCardForLineup(c, "blended_smart", new Map(), {}, { "cleveland-cavaliers": 1 }, {
      "cleveland-cavaliers": sched,
    });
    expect(tired.effectiveScore).toBeLessThan(ev.effectiveScore);
    expect(tired.riskTags.join(" ")).toMatch(/B2B/);
  });
});

describe("entry limits", () => {
  it("uses live Classic Limited 3 and 5 for Arena / In-Season", () => {
    expect(getCompetitionEntryLimit({ format: "contender_11", rarity: "limited", seasonScope: "classic" })).toBe(3);
    expect(getCompetitionEntryLimit({ format: "arena_contender_12", rarity: "limited", seasonScope: "arena" })).toBe(5);
    expect(getCompetitionEntryLimit({ format: "champion_16", rarity: "rare", seasonScope: "in_season" })).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { computeCountdownSnapshot } from "./countdownMath";
import { estimateSealingPoints } from "./sealingPoints";
import { buildTierStarMap, resolveStarRating } from "./starRatings";
import { deriveGameOdds, hasBackToBackDates, isInGameWeekRange } from "./vegasMath";

describe("starRatings", () => {
  it("uses Sorare's gameplay tier and falls back to the L10 estimate", () => {
    expect(resolveStarRating("ROSTER", 30)).toEqual({ stars: 2, source: "live" });
    expect(resolveStarRating("DNP_PLUS", 30)).toEqual({ stars: 1.5, source: "live" });
    expect(resolveStarRating(null, 27).source).toBe("estimated");
    const map = buildTierStarMap([{ gameplayTier: "ROSTER", stars: 2.5 }]);
    expect(resolveStarRating("ROSTER", 0, map).stars).toBe(2.5);
    expect(resolveStarRating("GOAT", 0, map).stars).toBe(5);
  });
});

describe("vegasMath", () => {
  it("derives implied team totals from the home line", () => {
    const g = deriveGameOdds({ overUnder: 238.5, spread: -4.5, homeFavorite: true });
    expect(g?.home.impliedTeamTotal).toBe(121.5);
    expect(g?.away.impliedTeamTotal).toBe(117);
    expect(g?.home.blowoutRisk).toBe(false);
    expect(deriveGameOdds({ overUnder: 220, spread: -16.5 })?.home.blowoutRisk).toBe(true);
    expect(deriveGameOdds({ overUnder: undefined, spread: -3 })).toBeNull();
  });

  it("detects back-to-backs and the Game Week window", () => {
    expect(hasBackToBackDates(["2026-11-21", "2026-11-22"])).toBe(true);
    expect(hasBackToBackDates(["2026-11-21", "2026-11-23"])).toBe(false);
    const w = { startIso: "2026-11-21T00:00:00Z", endIso: "2026-11-23T04:24:11Z" };
    expect(isInGameWeekRange("2026-11-22T01:00:00Z", w)).toBe(true);
    expect(isInGameWeekRange("2026-11-24T01:00:00Z", w)).toBe(false);
  });
});

describe("live sealing points and countdown input", () => {
  it("prefers Card.sealableFor over the estimate", () => {
    expect(estimateSealingPoints({ rarity: "limited", l10: 40, sealingPoints: 2 })).toMatchObject({
      sealingPoints: 2,
      tier: "Tier 2/6 (live)",
    });
  });

  it("accepts a bare cutoff ISO string", () => {
    const snap = computeCountdownSnapshot("2026-11-21T00:00:00Z", Date.parse("2026-11-20T23:35:00Z"));
    expect(snap.gwRemainingMs).toBe(25 * 60_000);
  });
});

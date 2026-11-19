import { describe, expect, it } from "vitest";
import {
  buildContestThresholds,
  evaluateContestEv,
  lineupStdDev,
  probabilityAtLeast,
} from "./entryEvMath";

describe("entryEvMath", () => {
  it("lineup spread grows with same-team correlation", () => {
    const solo = lineupStdDev([
      { projectedScore: 30, teamSlug: "a" },
      { projectedScore: 30, teamSlug: "b" },
    ]);
    const stacked = lineupStdDev([
      { projectedScore: 30, teamSlug: "a" },
      { projectedScore: 30, teamSlug: "a" },
    ]);
    expect(stacked).toBeGreaterThan(solo);
    expect(solo).toBeCloseTo(Math.sqrt(2) * 30 * 0.35, 5);
  });

  it("probabilityAtLeast is 50% at the mean and bounded", () => {
    expect(probabilityAtLeast(100, 20, 100)).toBeCloseTo(50, 0);
    expect(probabilityAtLeast(100, 0, 90)).toBe(99.9);
    expect(probabilityAtLeast(100, 0, 110)).toBe(0);
    expect(probabilityAtLeast(Number.NaN, 10, 10)).toBe(0);
  });

  it("thresholds are ascending and fill missing benchmark lines", () => {
    const t = buildContestThresholds({
      paidCutoffScore: 150,
      top20Score: null,
      podiumScore: 140,
      fallbackCash: 1,
      fallbackTop20: 1,
      fallbackPodium: 1,
    });
    expect(t.cashScore).toBe(150);
    expect(t.top20Score).toBeCloseTo(168, 5);
    expect(t.podiumScore).toBeGreaterThanOrEqual(t.top20Score);
    const fallback = buildContestThresholds({
      paidCutoffScore: null,
      fallbackCash: 105,
      fallbackTop20: 130,
      fallbackPodium: 155,
    });
    expect(fallback).toEqual({ cashScore: 105, top20Score: 130, podiumScore: 155 });
  });

  it("EV is monotonic, weights podium heavily, and gates viability at 5% cash", () => {
    const thresholds = { cashScore: 144, top20Score: 224, podiumScore: 263 };
    const ok = evaluateContestEv(127, 20, thresholds);
    expect(ok.cashProb).toBeGreaterThan(15);
    expect(ok.top20Prob).toBeLessThanOrEqual(ok.cashProb);
    expect(ok.podiumProb).toBeLessThanOrEqual(ok.top20Prob);
    expect(ok.viable).toBe(true);
    const hopeless = evaluateContestEv(127, 20, { cashScore: 205, top20Score: 288, podiumScore: 301 });
    expect(hopeless.cashProb).toBeLessThan(5);
    expect(hopeless.viable).toBe(false);
    expect(evaluateContestEv(null, 10, thresholds)).toMatchObject({ expectedValueScore: 0, viable: false });
  });
});

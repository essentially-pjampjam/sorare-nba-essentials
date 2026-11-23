import { describe, expect, it } from "vitest";
import type { SetPackInfo } from "../shared/types";
import { analyzePack, buildPackAdvice } from "./packAdvisorMath";

function makePack(overrides: Partial<SetPackInfo> = {}): SetPackInfo {
  return {
    slug: "divination-nba-bronze-pack",
    title: "Bronze Pack",
    category: "STANDARD",
    price: 50,
    currency: "COMMON_ESSENCE",
    cardsCount: 4,
    endDate: null,
    slots: [],
    ...overrides,
  };
}

describe("packAdvisorMath", () => {
  it("omits 0% 3-star odds on Live Today advice when slot odds are missing", () => {
    const livePack = makePack({
      slug: "divination-nba-bronze-live-today-2026-11-21",
      title: "Live Today Bronze",
      category: "LIVE_TODAY",
      endDate: new Date(1_700_000_000_000 + 4 * 3_600_000).toISOString(),
      slots: [],
    });
    const advice = buildPackAdvice(
      [analyzePack(livePack, 20)],
      null,
      20,
      1_700_000_000_000,
    );
    const liveTip = advice.find((a) => a.kind === "live_today");
    expect(liveTip).toBeDefined();
    expect(liveTip?.text).not.toContain("0%");
    expect(liveTip?.text).toContain("ends in 4h");
  });

  it("still shows Set Essence affordability advice when pack odds are not loaded", () => {
    const bronze = makePack({ price: 50, slots: [] });
    const advice = buildPackAdvice(
      [analyzePack(bronze, 19)],
      null,
      19,
      1_700_000_000_000,
    );
    const essenceTip = advice.find((a) => a.kind === "essence");
    expect(essenceTip).toBeDefined();
    expect(essenceTip?.text).toContain("19/50");
  });

  it("includes 3-star odds and best-value advice when slot odds are present", () => {
    const bronze = makePack({
      price: 50,
      slots: [[{ tier: "KEY", basisPoints: 2500 }, { tier: "ROSTER", basisPoints: 7500 }]],
    });
    const analysis = analyzePack(bronze, 60);
    expect(analysis.chance3StarPct).toBe(25);
    expect(analysis.affordable).toBe(true);
    const advice = buildPackAdvice([analysis], null, 60, 1_700_000_000_000);
    expect(advice.some((a) => a.kind === "value" && a.text.includes("25%"))).toBe(true);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EssenceTubeBar, generateEssenceParticles } from "./EssenceTubeBar";

describe("EssenceTubeBar", () => {
  it("generates zero particles when essence amount is 0", () => {
    expect(generateEssenceParticles("limited", 0, 0)).toEqual([]);
  });

  it("generates non-uniform randomized bubbles and shine glints for active essence", () => {
    const pts = generateEssenceParticles("rare", 78, 780);
    expect(pts.length).toBeGreaterThanOrEqual(12);
    expect(pts.some((p) => p.kind === "bubble")).toBe(true);
    expect(pts.some((p) => p.kind === "glint")).toBe(true);

    // Ensure horizontal positions are organically scattered (not evenly spaced)
    const diffs = pts
      .map((p) => p.leftPct)
      .sort((a, b) => a - b)
      .slice(1)
      .map((val, idx, arr) => val - (idx === 0 ? pts.map((p) => p.leftPct).sort((a, b) => a - b)[0] : arr[idx - 1]));
    const uniqueDiffs = new Set(diffs.map((d) => Math.round(d * 10)));
    expect(uniqueDiffs.size).toBeGreaterThan(3);
  });

  it("renders accessible glass tube markup with meniscus and rarity attributes", () => {
    const html = renderToStaticMarkup(
      <EssenceTubeBar
        rarity="super_rare"
        pct={64}
        amount={640}
        ready={false}
        ariaLabel="Super Rare Essence progress toward Craft"
      />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="64"');
    expect(html).toContain('data-rarity="super_rare"');
    expect(html).toContain("jam-essence-meniscus");
    expect(html).toContain("jam-essence-glass");
    expect(html).toContain("jam-tube-glint");
    expect(html).not.toContain('data-milestones="true"');
  });

  it("renders optional milestone lines only when showMilestones is enabled", () => {
    const html = renderToStaticMarkup(
      <EssenceTubeBar
        rarity="limited"
        pct={50}
        amount={500}
        ready={false}
        showMilestones
        ariaLabel="Limited Essence progress toward Craft"
      />,
    );
    expect(html).toContain('data-milestones="true"');
  });

  it("marks ready state and omits mid-tube meniscus at 100%", () => {
    const html = renderToStaticMarkup(
      <EssenceTubeBar
        rarity="unique"
        pct={100}
        amount={1250}
        ready={true}
        ariaLabel="Unique Essence progress toward Craft"
      />,
    );
    expect(html).toContain('data-ready="true"');
    expect(html).not.toContain("jam-essence-meniscus");
  });
});

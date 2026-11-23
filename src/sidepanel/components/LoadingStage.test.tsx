import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingStage } from "./LoadingStage";

describe("LoadingStage", () => {
  it("renders indeterminate native <progress> without value when total is 0 or progress is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(LoadingStage, {
        title: "Loading Sorare NBA Essentials",
        subtitle: "Restoring cached workspace...",
        progress: null,
        rarity: "limited",
      }),
    );

    expect(html).toContain("<progress");
    expect(html).toContain('data-rarity="limited"');
    expect(html).not.toMatch(/<progress[^>]*\bvalue=/);
    expect(html).toContain("Preparing live data...");
    expect(html).toContain("Restoring cached workspace...");
    expect(html).not.toContain("Cancel");
  });

  it("renders determinate <progress>, percentage, status message, and Cancel when progress has total > 0", () => {
    const html = renderToStaticMarkup(
      React.createElement(LoadingStage, {
        title: "Scanning Rare Collections",
        progress: {
          phase: "collections",
          completed: 3,
          total: 10,
          message: "Fetching Rare collection floors...",
        },
        rarity: "rare",
        onCancel: () => {},
      }),
    );

    expect(html).toContain('value="3"');
    expect(html).toContain('max="10"');
    expect(html).toContain('data-rarity="rare"');
    expect(html).toContain("Step 3 of 10");
    expect(html).toContain("30%");
    expect(html).toContain("Fetching Rare collection floors...");
    expect(html).toContain("Cancel");
  });

  it("clamps completed values exceeding total to 100%", () => {
    const html = renderToStaticMarkup(
      React.createElement(LoadingStage, {
        title: "Loading Set Lineups",
        progress: {
          phase: "collections",
          completed: 14,
          total: 10,
          message: "Finalizing...",
        },
        rarity: "set",
      }),
    );

    expect(html).toContain('value="10"');
    expect(html).toContain('max="10"');
    expect(html).toContain("100%");
    expect(html).toContain('data-rarity="set"');
  });

  it("renders logo 05 (/logo.png) and accessible live status region for every rarity", () => {
    for (const rarity of ["limited", "rare", "super_rare", "unique", "set"] as const) {
      const html = renderToStaticMarkup(
        React.createElement(LoadingStage, {
          title: `Loading ${rarity}`,
          progress: null,
          rarity,
        }),
      );
      expect(html).toContain('src="/logo.png"');
      expect(html).toContain(`data-rarity="${rarity}"`);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    }
  });
});

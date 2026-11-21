import { describe, expect, it } from "vitest";
import { isSpecialPackSlug } from "../background/shopScanner";

describe("special Set packs", () => {
  it("treats only non-standard titled packs as special", () => {
    expect(isSpecialPackSlug("divination-special-offers-f6153d24-151a-455c-9056-1109c9552bea-emirates-cup-platinum")).toBe(true);
    expect(isSpecialPackSlug("divination-nba-legendary-chase")).toBe(true);
    expect(isSpecialPackSlug("divination-nba-gold-pack")).toBe(false);
    expect(isSpecialPackSlug("divination-nba-bronze-live-today-2026-11-20")).toBe(false);
    expect(isSpecialPackSlug("nba-divination-daily-free-pack")).toBe(false);
    expect(isSpecialPackSlug("divination-nba-all-leagues-bronze")).toBe(false);
    expect(isSpecialPackSlug("bad slug\"")).toBe(false);
  });
});

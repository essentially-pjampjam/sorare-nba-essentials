import { describe, expect, it } from "vitest";
import { parseWalletAmount, parseWalletButtonText } from "./sorareDomParser";

describe("parseWalletAmount", () => {
  it("parses standard US and EU decimal formats", () => {
    expect(parseWalletAmount("12.50")).toBe(12.5);
    expect(parseWalletAmount("12,50")).toBe(12.5);
    expect(parseWalletAmount("0.005")).toBe(0.005);
    expect(parseWalletAmount("0")).toBe(0);
  });

  it("parses thousands separators without misreading them as decimals", () => {
    expect(parseWalletAmount("1,234.56")).toBe(1234.56);
    expect(parseWalletAmount("1.234,56")).toBe(1234.56);
    expect(parseWalletAmount("1 234,56")).toBe(1234.56);
    expect(parseWalletAmount("1\u00a0234.56")).toBe(1234.56);
    expect(parseWalletAmount("1,200")).toBe(1200);
    expect(parseWalletAmount("1,200,000")).toBe(1200000);
  });

  it("rejects non-numeric text", () => {
    expect(parseWalletAmount("")).toBeNull();
    expect(parseWalletAmount("abc")).toBeNull();
    expect(parseWalletAmount("12..50")).toBeNull();
  });
});

describe("parseWalletButtonText", () => {
  it("parses prefix and suffix fiat balances", () => {
    expect(parseWalletButtonText("€1,234.56")).toEqual({
      cashSymbol: "€",
      cashAmount: 1234.56,
    });
    expect(parseWalletButtonText("$1,200")).toEqual({
      cashSymbol: "$",
      cashAmount: 1200,
    });
    expect(parseWalletButtonText("12,50 €")).toEqual({
      cashSymbol: "€",
      cashAmount: 12.5,
    });
    expect(parseWalletButtonText("£ 45.00")).toEqual({
      cashSymbol: "£",
      cashAmount: 45,
    });
  });

  it("parses ETH balances", () => {
    expect(parseWalletButtonText("0.045 ETH")).toEqual({ ethAmount: 0.045 });
    expect(parseWalletButtonText("1,250.5 ETH")).toEqual({ ethAmount: 1250.5 });
  });

  it("returns null for unrelated button text", () => {
    expect(parseWalletButtonText("Market")).toBeNull();
    expect(parseWalletButtonText("785")).toBeNull();
  });
});

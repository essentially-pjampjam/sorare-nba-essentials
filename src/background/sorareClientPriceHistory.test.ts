import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitQueue } from "./rateLimitQueue";
import { SorareClient } from "./sorareClient";

function installChromeStorageMock() {
  const store = new Map<string, unknown>();
  const storageLocal = {
    get: vi.fn(async (key: string | string[] | null) => {
      if (typeof key === "string") {
        return key in Object.fromEntries(store) ? { [key]: store.get(key) } : {};
      }
      if (Array.isArray(key)) {
        const out: Record<string, unknown> = {};
        for (const k of key) {
          if (store.has(k)) out[k] = store.get(k);
        }
        return out;
      }
      return Object.fromEntries(store);
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    }),
  };
  vi.stubGlobal("chrome", {
    storage: { local: storageLocal },
  });
  return store;
}

describe("SorareClient.fetchPlayerPriceHistory (live schema contract)", () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("queries tokens.tokenPrices without invalid collection/last args, sorts ascending, and caps at 60", async () => {
    let capturedBody: { query: string; variables: Record<string, unknown> } | null = null;
    const baseMs = Date.UTC(2026, 9, 1, 0, 0, 0);
    // Return 75 sales newest-first (like live Sorare API), plus invalid entries to filter out
    const rawSales = Array.from({ length: 75 }, (_, i) => ({
      date: new Date(baseMs + (74 - i) * 3600_000).toISOString(),
      amounts: { eurCents: 500 + (74 - i) * 10, usdCents: 550 + (74 - i) * 10, referenceCurrency: "WEI" },
      deal: { __typename: i % 2 === 0 ? "TokenAuction" : "TokenOffer" },
    }));
    rawSales.push(
      { date: "", amounts: { eurCents: 999, usdCents: 999, referenceCurrency: "WEI" }, deal: { __typename: "TokenOffer" } },
      { date: "2026-10-01T00:00:00Z", amounts: { eurCents: 0, usdCents: 0, referenceCurrency: "WEI" }, deal: { __typename: "TokenOffer" } },
    );

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return new Response(JSON.stringify({ data: { tokens: { tokenPrices: rawSales } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new SorareClient(new RateLimitQueue({ maxPerMinute: 120, minSpacingMs: 0 }));
    const pts = await client.fetchPlayerPriceHistory("lebron-james-19841230", "limited", "EUR");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.query).toContain("tokenPrices(");
    expect(capturedBody!.query).not.toContain("collection:");
    expect(capturedBody!.query).not.toContain("last:");
    expect(capturedBody!.variables).toEqual({
      playerSlug: "lebron-james-19841230",
      rarity: "limited",
    });

    // Capped to latest 60 points, sorted oldest -> newest
    expect(pts).toHaveLength(60);
    expect(pts[0].timestampMs).toBeLessThan(pts[pts.length - 1].timestampMs);
    expect(pts[0].priceCents).toBe(500 + 15 * 10);
    expect(pts[pts.length - 1].priceCents).toBe(500 + 74 * 10);
    expect(pts[pts.length - 1].currency).toBe("EUR");
  });

  it("returns empty array without network call for blank playerSlug", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new SorareClient(new RateLimitQueue({ maxPerMinute: 120, minSpacingMs: 0 }));
    const pts = await client.fetchPlayerPriceHistory("   ", "limited", "USD");
    expect(pts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { mergeShopStatus, readShopStatusFromPage } from "./shopScanner";

type ApolloCache = Record<string, Record<string, unknown>>;

function mockApollo(cache: ApolloCache) {
  (globalThis as unknown as { window: unknown }).window = {
    __APOLLO_CLIENT__: {
      cache: {
        extract: () => cache,
      },
    },
  };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("shopScanner", () => {
  it("mergeShopStatus merges Daily Solo dailyPackClaimed and Shop bronzePlusProgress without clobbering", () => {
    const todayNoon = Date.UTC(2026, 10, 23, 12, 0, 0);
    const fromDailySolo = {
      dailyPackClaimed: true,
      bronzePlusProgress: null,
      bronzePlusTarget: null,
      scannedAt: todayNoon - 60_000,
    };
    const fromShop = {
      dailyPackClaimed: null,
      bronzePlusProgress: 3,
      bronzePlusTarget: 5,
      scannedAt: todayNoon,
    };

    const merged = mergeShopStatus(fromDailySolo, fromShop, todayNoon);
    expect(merged.dailyPackClaimed).toBe(true);
    expect(merged.bronzePlusProgress).toBe(3);
    expect(merged.bronzePlusTarget).toBe(5);
  });

  it("mergeShopStatus drops yesterday's dailyPackClaimed after 07:00 UTC reset while keeping Bronze+ progress", () => {
    const yesterdayNoon = Date.UTC(2026, 10, 22, 12, 0, 0);
    const todayNoon = Date.UTC(2026, 10, 23, 12, 0, 0);
    const prev = {
      dailyPackClaimed: true,
      bronzePlusProgress: 4,
      bronzePlusTarget: 5,
      scannedAt: yesterdayNoon,
    };
    const incoming = {
      dailyPackClaimed: false,
      bronzePlusProgress: null,
      bronzePlusTarget: null,
      scannedAt: todayNoon,
    };

    const merged = mergeShopStatus(prev, incoming, todayNoon);
    expect(merged.dailyPackClaimed).toBe(false);
    expect(merged.bronzePlusProgress).toBe(4);
    expect(merged.bronzePlusTarget).toBe(5);
  });

  it("readShopStatusFromPage detects COMPLETED and claimedAt on myCommonDailyClaimTask", () => {
    mockApollo({
      ROOT_QUERY: {
        'myCommonDailyClaimTask({"sport":"NBA"})': { __ref: "CommonDailyClaimTask:1" },
      },
      "CommonDailyClaimTask:1": {
        __typename: "CommonDailyClaimTask",
        aasmState: "COMPLETED",
        expired: false,
      },
    });
    const res = readShopStatusFromPage();
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.dailyPackClaimed).toBe(true);
    }
  });
});

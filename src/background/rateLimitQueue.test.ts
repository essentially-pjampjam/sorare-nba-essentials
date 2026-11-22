import { describe, expect, it, vi } from "vitest";
import {
  RateLimitedError,
  RateLimitQueue,
  ScanCancelledError,
} from "./rateLimitQueue";
import { SorareClient } from "./sorareClient";
import type { CraftPoolPlayer } from "../shared/types";

describe("RateLimitQueue", () => {
  it("deduplicates concurrent in-flight requests sharing a dedupeKey", async () => {
    const queue = new RateLimitQueue({ maxPerMinute: 60, concurrency: 2 });
    const spy = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 15));
      return "ok";
    });

    const [a, b, c] = await Promise.all([
      queue.enqueue(spy, "same-key"),
      queue.enqueue(spy, "same-key"),
      queue.enqueue(spy, "same-key"),
    ]);

    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(c).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries 429 RateLimitedError with backoff and resolves", async () => {
    const sleep = vi.fn(async () => {});
    const queue = new RateLimitQueue({
      maxPerMinute: 60,
      concurrency: 1,
      baseRetryDelayMs: 50,
      maxRetries: 2,
      sleep,
    });

    let calls = 0;
    const res = await queue.enqueue(async () => {
      calls += 1;
      if (calls < 2) {
        throw new RateLimitedError("slow down", 429, 25);
      }
      return 42;
    });

    expect(res).toBe(42);
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it("enforces sliding-window request cap", async () => {
    let clock = 1000;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const queue = new RateLimitQueue({
      maxPerMinute: 2,
      concurrency: 2,
      now: () => clock,
      sleep,
    });

    const results = await Promise.all([
      queue.enqueue(async () => 1),
      queue.enqueue(async () => 2),
      queue.enqueue(async () => 3),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(clock).toBeGreaterThanOrEqual(61_000);
  });

  it("cancels queued work when AbortSignal aborts or clearPending is called without unhandled rejections", async () => {
    const queue = new RateLimitQueue({ maxPerMinute: 10, concurrency: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      queue.enqueue(async () => "never", "abort-dedupe-key", controller.signal),
    ).rejects.toBeInstanceOf(ScanCancelledError);

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const first = queue.enqueue(async () => {
      await firstGate;
      return "done";
    }, "first-key");
    const second = queue.enqueue(async () => "second", "second-key");

    queue.clearPending("Superseded");
    releaseFirst();

    await expect(first).resolves.toBe("done");
    await expect(second).rejects.toBeInstanceOf(ScanCancelledError);
  });

  it("supports dynamically updating concurrency via setLimits for Fast Mode pipelining", async () => {
    const queue = new RateLimitQueue({ maxPerMinute: 45, concurrency: 1, minSpacingMs: 0 });
    queue.setLimits(45, 0, 2);

    let active = 0;
    let maxActive = 0;
    let releaseAll!: () => void;
    const gate = new Promise<void>((r) => {
      releaseAll = r;
    });

    const p1 = queue.enqueue(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return 1;
    });
    const p2 = queue.enqueue(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return 2;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(maxActive).toBe(2);
    releaseAll();
    await expect(Promise.all([p1, p2])).resolves.toEqual([1, 2]);
  });

  it("pipelines SorareClient.priceCraftPlayers with concurrency 2 in Fast Mode and 1 in Safe Mode", async () => {
    const samplePlayers: CraftPoolPlayer[] = [
      {
        playerSlug: "player-a",
        playerName: "Player A",
        teamName: "Team A",
        teamSlug: "team-a",
        conference: "EAST",
        positions: ["basketball_guard"],
        age: 24,
        averageL10: 35,
        qualityTier: "TIER_2",
        availableSupply: 10,
        floorCents: null,
        floorCardSlug: null,
        marketUrl: "https://sorare.com/nba/market",
      },
      {
        playerSlug: "player-b",
        playerName: "Player B",
        teamName: "Team B",
        teamSlug: "team-b",
        conference: "WEST",
        positions: ["basketball_forward"],
        age: 25,
        averageL10: 32,
        qualityTier: "TIER_2",
        availableSupply: 8,
        floorCents: null,
        floorCardSlug: null,
        marketUrl: "https://sorare.com/nba/market",
      },
    ];

    const origFetch = globalThis.fetch;
    try {
      const runMode = async (apiKey: string, concurrency: number): Promise<number> => {
        let active = 0;
        let maxActive = 0;
        globalThis.fetch = vi.fn(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 35));
          active -= 1;
          return new Response(JSON.stringify({ data: { searchCards: { hits: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as unknown as typeof fetch;

        const queue = new RateLimitQueue({ maxPerMinute: 45, concurrency, minSpacingMs: 0 });
        const client = new SorareClient(queue);
        client.setApiKey(apiKey);
        await client.priceCraftPlayers(samplePlayers, "limited", "USD");
        return maxActive;
      };

      expect(await runMode("", 1)).toBe(1);
      expect(await runMode("test-api-key", 2)).toBe(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

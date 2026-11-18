import { describe, expect, it, vi } from "vitest";
import {
  RateLimitedError,
  RateLimitQueue,
  ScanCancelledError,
} from "./rateLimitQueue";

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
});

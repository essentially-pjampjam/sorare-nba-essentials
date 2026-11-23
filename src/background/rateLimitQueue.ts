export interface RateLimitQueueOptions {
  /** Maximum requests allowed within the 60-second sliding window */
  maxPerMinute: number;
  /** Maximum concurrent in-flight requests */
  concurrency?: number;
  /** Minimum delay between request dispatches in ms */
  minSpacingMs?: number;
  /** Base delay in ms for HTTP 429 exponential backoff */
  baseRetryDelayMs?: number;
  /** Maximum retries on 429 (default 0: stop immediately to protect Sorare session) */
  maxRetries?: number;
  /** Optional hook notified when queue pauses for rate limit / cooldown */
  onWait?: (waitMs: number, reason: "cooldown" | "window") => void;
  /** Injectable clock for deterministic tests */
  now?: () => number;
  /** Injectable sleep for deterministic tests */
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimitedError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "RateLimitedError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class ScanCancelledError extends Error {
  constructor(message = "Scan cancelled") {
    super(message);
    this.name = "ScanCancelledError";
  }
}

interface QueueItem<T> {
  key?: string;
  signal?: AbortSignal;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window rate-limited queue with dynamic limits, minimum spacing,
 * global 429 cooldown circuit breaker, AbortSignal cancellation, and deduplication.
 */
export class RateLimitQueue {
  private maxPerMinute: number;
  private concurrency: number;
  private minSpacingMs: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetries: number;
  private readonly onWait?: (waitMs: number, reason: "cooldown" | "window") => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly queue: Array<QueueItem<unknown>> = [];
  private readonly timestamps: number[] = [];
  private readonly inFlightByKey = new Map<string, Promise<unknown>>();
  private activeCount = 0;
  private draining = false;
  private lastDispatchAt = 0;
  private cooldownUntil = 0;

  constructor(options: RateLimitQueueOptions) {
    this.maxPerMinute = Math.max(1, options.maxPerMinute);
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.minSpacingMs = Math.max(0, options.minSpacingMs ?? 0);
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 4000;
    this.maxRetries = options.maxRetries ?? 0;
    this.onWait = options.onWait;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
  }

  setLimits(maxPerMinute: number, minSpacingMs: number, concurrency?: number): void {
    this.maxPerMinute = Math.max(1, maxPerMinute);
    this.minSpacingMs = Math.max(0, minSpacingMs);
    if (typeof concurrency === "number" && Number.isFinite(concurrency)) {
      this.concurrency = Math.max(1, Math.floor(concurrency));
    }
  }

  setCooldown(untilMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, untilMs);
  }

  getCooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }

  enqueue<T>(
    task: () => Promise<T>,
    dedupeKey?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(new ScanCancelledError());
    }

    if (dedupeKey) {
      const existing = this.inFlightByKey.get(dedupeKey);
      if (existing) {
        return existing as Promise<T>;
      }
    }

    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({
        key: dedupeKey,
        signal,
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      void this.drain();
    });

    if (dedupeKey) {
      this.inFlightByKey.set(dedupeKey, promise);
      const cleanup = () => {
        if (this.inFlightByKey.get(dedupeKey) === promise) {
          this.inFlightByKey.delete(dedupeKey);
        }
      };
      // Attach both handlers with .then(cleanup, cleanup) so rejections never spawn an uncaught derived promise
      promise.then(cleanup, cleanup);
    }

    return promise;
  }

  clearPending(reason = "Scan cancelled"): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(new ScanCancelledError(reason));
    }
  }

  getStats(): { pending: number; active: number; windowCount: number } {
    this.pruneWindow();
    return {
      pending: this.queue.length,
      active: this.activeCount,
      windowCount: this.timestamps.length,
    };
  }

  private pruneWindow(): void {
    const cutoff = this.now() - 60_000;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  private getWaitInfo(): { waitMs: number; reason: "cooldown" | "window" | null } {
    const now = this.now();
    if (this.cooldownUntil > now) {
      return { waitMs: this.cooldownUntil - now, reason: "cooldown" };
    }

    let waitMs = 0;
    let reason: "cooldown" | "window" | null = null;

    if (this.minSpacingMs > 0 && this.lastDispatchAt > 0) {
      const elapsed = now - this.lastDispatchAt;
      if (elapsed < this.minSpacingMs) {
        waitMs = this.minSpacingMs - elapsed;
      }
    }

    this.pruneWindow();
    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0];
      const windowWait = oldest + 60_000 - now + 25;
      if (windowWait > waitMs) {
        waitMs = windowWait;
        reason = "window";
      }
    }

    return { waitMs, reason };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0) {
        const next = this.queue[0];
        if (next?.signal?.aborted) {
          this.queue.shift();
          next.reject(new ScanCancelledError());
          continue;
        }

        if (this.activeCount >= this.concurrency) {
          await this.sleep(25);
          continue;
        }

        const { waitMs, reason } = this.getWaitInfo();
        if (waitMs > 0) {
          if (reason && waitMs >= 1000) {
            this.onWait?.(waitMs, reason);
          }
          await this.sleep(Math.min(waitMs, 1000));
          continue;
        }

        const item = this.queue.shift();
        if (!item) continue;
        if (item.signal?.aborted) {
          item.reject(new ScanCancelledError());
          continue;
        }

        const ts = this.now();
        this.timestamps.push(ts);
        this.lastDispatchAt = ts;
        this.activeCount += 1;
        void this.executeWithRetry(item)
          .finally(() => {
            this.activeCount -= 1;
          })
          .catch(() => {});
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) {
        void this.drain();
      }
    }
  }

  private async executeWithRetry<T>(item: QueueItem<T>): Promise<void> {
    let attempt = 0;
    while (true) {
      if (item.signal?.aborted) {
        item.reject(new ScanCancelledError());
        return;
      }
      try {
        const result = await item.task();
        item.resolve(result);
        return;
      } catch (err) {
        const isRateLimit = err instanceof RateLimitedError && err.status === 429;
        if (isRateLimit) {
          const cooldown = err.retryAfterMs ?? 65_000;
          this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + cooldown);
        }
        if (!isRateLimit || attempt >= this.maxRetries) {
          item.reject(err);
          return;
        }
        attempt += 1;
        const backoff =
          err.retryAfterMs ?? this.baseRetryDelayMs * Math.pow(2, attempt - 1);
        await this.sleep(backoff);
      }
    }
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllCache, getCached, pruneExpiredCache, setCached } from "./cache";

function installMockStorage(options?: { maxEntries?: number }) {
  const store = new Map<string, unknown>();
  const maxEntries = options?.maxEntries ?? Infinity;

  const local = {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) {
        return Object.fromEntries(store.entries());
      }
      if (typeof keys === "string") {
        return store.has(keys) ? { [keys]: store.get(keys) } : {};
      }
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (store.has(k)) out[k] = store.get(k);
      }
      return out;
    }),
    set: vi.fn(async (obj: Record<string, unknown>) => {
      const nextCount = new Set([...store.keys(), ...Object.keys(obj)]).size;
      if (nextCount > maxEntries) {
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      for (const [k, v] of Object.entries(obj)) {
        store.set(k, v);
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) store.delete(k);
    }),
  };

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local },
  };

  return { store, local };
}

describe("cache quota recovery and expiration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it("evicts oldest cache entries on quota error while preserving user settings", async () => {
    const { store } = installMockStorage({ maxEntries: 4 });
    // Protected non-cache keys
    store.set("jamassist_settings_v1", { username: "pjampjam" });
    store.set("pro_progress_history_v1", [{ lineupId: "l1" }]);

    await setCached("oldest", { v: 1 }, 60_000);
    vi.advanceTimersByTime(1000);
    await setCached("newer", { v: 2 }, 60_000);
    vi.advanceTimersByTime(1000);

    // Next write hits maxEntries (5 > 4), triggers oldest cache eviction, then succeeds
    await setCached("fresh", { v: 3 }, 60_000);

    expect(store.get("jamassist_settings_v1")).toEqual({ username: "pjampjam" });
    expect(store.get("pro_progress_history_v1")).toEqual([{ lineupId: "l1" }]);
    expect(await getCached("oldest", 60_000)).toBeNull();
    expect((await getCached<{ v: number }>("fresh", 60_000))?.value).toEqual({ v: 3 });
  });

  it("prunes expired entries first before evicting fresh ones", async () => {
    const { store } = installMockStorage({ maxEntries: 3 });
    store.set("jamassist_settings_v1", { username: "pjampjam" });

    await setCached("short_lived", { v: "expired" }, 5_000);
    vi.advanceTimersByTime(1000);
    await setCached("long_lived", { v: "keep" }, 60_000);

    // Expire short_lived
    vi.advanceTimersByTime(6_000);
    await setCached("new_entry", { v: "added" }, 60_000);

    expect(await getCached("short_lived", 5_000)).toBeNull();
    expect((await getCached<{ v: string }>("long_lived", 60_000))?.value).toEqual({ v: "keep" });
    expect((await getCached<{ v: string }>("new_entry", 60_000))?.value).toEqual({ v: "added" });
  });

  it("never throws if storage remains full even after eviction", async () => {
    const { store } = installMockStorage({ maxEntries: 1 });
    store.set("jamassist_settings_v1", { username: "pjampjam" });

    const ts = await setCached("oversized", { big: true }, 60_000);
    expect(typeof ts).toBe("number");
    expect(store.get("jamassist_settings_v1")).toEqual({ username: "pjampjam" });
  });

  it("pruneExpiredCache and clearAllCache only touch cache prefix keys", async () => {
    const { store } = installMockStorage();
    store.set("jamassist_settings_v1", { username: "pjampjam" });
    await setCached("a", 1, 1_000);
    await setCached("b", 2, 60_000);

    vi.advanceTimersByTime(2_000);
    expect(await pruneExpiredCache()).toBe(1);
    expect(store.has("jamassist_cache:b")).toBe(true);

    await clearAllCache();
    expect(store.has("jamassist_cache:b")).toBe(false);
    expect(store.has("jamassist_settings_v1")).toBe(true);
  });
});

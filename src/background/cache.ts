import { CACHE_TTL_MS } from "../shared/constants";

interface CacheEnvelope<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

const CACHE_PREFIX = "jamassist_cache:";

function isEnvelopeFresh(
  envelope: Partial<CacheEnvelope<unknown>> | undefined,
  ttlMs: number,
  now: number,
): envelope is CacheEnvelope<unknown> {
  return Boolean(
    envelope &&
      typeof envelope.expiresAt === "number" &&
      Number.isFinite(envelope.expiresAt) &&
      typeof envelope.storedAt === "number" &&
      Number.isFinite(envelope.storedAt) &&
      now <= envelope.expiresAt &&
      now - envelope.storedAt <= ttlMs,
  );
}

export async function getCached<T>(
  key: string,
  ttlMs: number = CACHE_TTL_MS,
): Promise<{ value: T; storedAt: number } | null> {
  const fullKey = `${CACHE_PREFIX}${key}`;
  const raw = await chrome.storage.local.get(fullKey);
  const envelope = raw[fullKey] as CacheEnvelope<T> | undefined;
  if (!envelope) return null;

  const now = Date.now();
  if (!isEnvelopeFresh(envelope, ttlMs, now)) {
    await chrome.storage.local.remove(fullKey);
    return null;
  }

  return { value: envelope.value, storedAt: envelope.storedAt };
}

let writesSincePrune = 0;

export async function pruneExpiredCache(): Promise<number> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const expiredKeys: string[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(CACHE_PREFIX)) continue;
    const env = v as Partial<CacheEnvelope<unknown>> | undefined;
    if (
      !env ||
      typeof env.expiresAt !== "number" ||
      !Number.isFinite(env.expiresAt) ||
      now > env.expiresAt
    ) {
      expiredKeys.push(k);
    }
  }
  if (expiredKeys.length > 0) {
    await chrome.storage.local.remove(expiredKeys);
  }
  return expiredKeys.length;
}

/**
 * Evicts the oldest cached entries (by storedAt) while never touching user
 * settings, API keys, progress history, or non-cache keys.
 */
async function evictOldestCacheEntries(fraction = 0.5): Promise<number> {
  const all = await chrome.storage.local.get(null);
  const entries: Array<{ key: string; storedAt: number }> = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(CACHE_PREFIX)) continue;
    const env = v as Partial<CacheEnvelope<unknown>> | undefined;
    const storedAt =
      env && typeof env.storedAt === "number" && Number.isFinite(env.storedAt)
        ? env.storedAt
        : 0;
    entries.push({ key: k, storedAt });
  }
  if (entries.length === 0) return 0;
  entries.sort((a, b) => a.storedAt - b.storedAt);
  const count = Math.max(1, Math.ceil(entries.length * Math.min(1, Math.max(0.1, fraction))));
  const keysToRemove = entries.slice(0, count).map((e) => e.key);
  await chrome.storage.local.remove(keysToRemove);
  return keysToRemove.length;
}

export async function setCached<T>(
  key: string,
  value: T,
  ttlMs: number = CACHE_TTL_MS,
): Promise<number> {
  const fullKey = `${CACHE_PREFIX}${key}`;
  const storedAt = Date.now();
  const envelope: CacheEnvelope<T> = {
    value,
    storedAt,
    expiresAt: storedAt + ttlMs,
  };
  try {
    await chrome.storage.local.set({ [fullKey]: envelope });
  } catch {
    // Recover from MV3 chrome.storage.local QUOTA_BYTES exhaustion without crashing the scan.
    try {
      await pruneExpiredCache();
      await chrome.storage.local.set({ [fullKey]: envelope });
    } catch {
      try {
        await evictOldestCacheEntries(0.5);
        await chrome.storage.local.set({ [fullKey]: envelope });
      } catch {
        // Still over quota (e.g. oversized single payload): skip caching gracefully.
        return storedAt;
      }
    }
  }
  writesSincePrune += 1;
  if (writesSincePrune >= 8) {
    writesSincePrune = 0;
    void pruneExpiredCache().catch(() => {});
  }
  return storedAt;
}

export async function clearAllCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}

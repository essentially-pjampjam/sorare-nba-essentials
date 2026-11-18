import { CACHE_TTL_MS } from "../shared/constants";

interface CacheEnvelope<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

const CACHE_PREFIX = "jamassist_cache:";

export async function getCached<T>(
  key: string,
  ttlMs: number = CACHE_TTL_MS,
): Promise<{ value: T; storedAt: number } | null> {
  const fullKey = `${CACHE_PREFIX}${key}`;
  const raw = await chrome.storage.local.get(fullKey);
  const envelope = raw[fullKey] as CacheEnvelope<T> | undefined;
  if (!envelope) return null;

  const now = Date.now();
  if (
    typeof envelope.expiresAt !== "number" ||
    !Number.isFinite(envelope.expiresAt) ||
    typeof envelope.storedAt !== "number" ||
    !Number.isFinite(envelope.storedAt) ||
    now > envelope.expiresAt ||
    now - envelope.storedAt > ttlMs
  ) {
    await chrome.storage.local.remove(fullKey);
    return null;
  }

  return { value: envelope.value, storedAt: envelope.storedAt };
}

let writesSincePrune = 0;

async function pruneExpiredCache(): Promise<void> {
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
  await chrome.storage.local.set({ [fullKey]: envelope });
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

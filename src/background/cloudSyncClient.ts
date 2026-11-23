import {
  normalizeCloudWorkerUrl,
  sanitizeCardTagsMap,
} from "../calculators/cardTagsMath";
import type {
  CardTag,
  CloudAuthChallenge,
  CloudAuthVerifyResult,
  CloudPublicTagsResult,
} from "../shared/types";
import { getCached, setCached } from "./cache";
import { decryptSecret, isEncryptedSecret, sealForStorage } from "./secretStore";

const CLOUD_JWT_STORAGE_KEY = "jamassist_cloud_jwt_v1";

async function loadCloudJwt(): Promise<string | null> {
  try {
    const res = await chrome.storage.local.get(CLOUD_JWT_STORAGE_KEY);
    const raw = res[CLOUD_JWT_STORAGE_KEY];
    if (typeof raw !== "string" || !raw) return null;
    if (isEncryptedSecret(raw)) {
      const dec = await decryptSecret(raw);
      return dec || null;
    }
    return raw;
  } catch {
    return null;
  }
}

async function saveCloudJwt(token: string | null): Promise<void> {
  if (!token) {
    await chrome.storage.local.remove(CLOUD_JWT_STORAGE_KEY);
    return;
  }
  const sealed = await sealForStorage(token);
  await chrome.storage.local.set({ [CLOUD_JWT_STORAGE_KEY]: sealed });
}

export async function clearCloudSession(): Promise<boolean> {
  await saveCloudJwt(null);
  return true;
}

export async function startCloudBioAuth(
  workerUrlRaw: string,
  username: string,
): Promise<CloudAuthChallenge> {
  const baseUrl = normalizeCloudWorkerUrl(workerUrlRaw);
  if (!baseUrl) {
    throw new Error("Enter a valid HTTPS Cloudflare Worker URL first.");
  }
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
  if (!cleanUser) {
    throw new Error("Enter your Sorare username first.");
  }

  const res = await fetch(`${baseUrl}/api/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cleanUser }),
    signal: AbortSignal.timeout(12_000),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    username?: string;
    challengeCode?: string;
    expiresAtIso?: string;
    error?: string;
  };
  if (!res.ok || !payload.challengeCode) {
    throw new Error(payload.error || `Challenge request failed (${res.status}).`);
  }

  return {
    username: payload.username ?? cleanUser,
    challengeCode: payload.challengeCode,
    expiresAtIso: payload.expiresAtIso ?? new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

export async function verifyCloudBioAuth(
  workerUrlRaw: string,
  username: string,
  challengeCode: string,
): Promise<CloudAuthVerifyResult> {
  const baseUrl = normalizeCloudWorkerUrl(workerUrlRaw);
  if (!baseUrl) {
    throw new Error("Enter a valid HTTPS Cloudflare Worker URL first.");
  }
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
  const cleanCode = challengeCode.trim();
  if (!cleanUser || !cleanCode) {
    throw new Error("Username and challenge code are required.");
  }

  const res = await fetch(`${baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cleanUser, challengeCode: cleanCode }),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    token?: string;
    username?: string;
    error?: string;
  };
  if (!res.ok || !payload.token) {
    throw new Error(
      payload.error ||
        `Bio verification failed (${res.status}). Make sure the code is saved in your Sorare bio.`,
    );
  }

  await saveCloudJwt(payload.token);
  return {
    username: payload.username ?? cleanUser,
    verified: true,
  };
}

export async function pushCloudCardTags(
  workerUrlRaw: string,
  tags: Record<string, CardTag>,
): Promise<{ count: number; updatedAtIso: string }> {
  const baseUrl = normalizeCloudWorkerUrl(workerUrlRaw);
  if (!baseUrl) {
    throw new Error("Configure a valid HTTPS Cloudflare Worker URL first.");
  }
  const token = await loadCloudJwt();
  if (!token) {
    throw new Error("Not authenticated. Complete the 1-time Sorare Bio verification first.");
  }
  const sanitized = sanitizeCardTagsMap(tags);

  const res = await fetch(`${baseUrl}/api/tags`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tags: sanitized }),
    signal: AbortSignal.timeout(12_000),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    count?: number;
    updatedAtIso?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(payload.error || `Failed to sync tags (${res.status}).`);
  }
  return {
    count: payload.count ?? Object.keys(sanitized).length,
    updatedAtIso: payload.updatedAtIso ?? new Date().toISOString(),
  };
}

export async function fetchPublicCloudTags(
  workerUrlRaw: string | undefined,
  username: string,
): Promise<CloudPublicTagsResult> {
  const baseUrl = normalizeCloudWorkerUrl(workerUrlRaw);
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
  if (!baseUrl || !cleanUser) {
    return { username: cleanUser, tags: {}, updatedAtIso: null };
  }

  const cacheKey = `cloud_public_tags_v1:${baseUrl}:${cleanUser}`;
  const cached = await getCached<CloudPublicTagsResult>(cacheKey);
  if (cached) return cached.value;

  try {
    const res = await fetch(`${baseUrl}/api/tags/${encodeURIComponent(cleanUser)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { username: cleanUser, tags: {}, updatedAtIso: null };
    }
    const payload = (await res.json()) as {
      username?: string;
      tags?: unknown;
      updatedAtIso?: string | null;
    };
    const result: CloudPublicTagsResult = {
      username: payload.username ?? cleanUser,
      tags: sanitizeCardTagsMap(payload.tags),
      updatedAtIso: payload.updatedAtIso ?? null,
    };
    await setCached(cacheKey, result);
    return result;
  } catch {
    return { username: cleanUser, tags: {}, updatedAtIso: null };
  }
}

import { isUpdateAvailable, shouldCheckForUpdate } from "../calculators/updateCheckerMath";
import { GITHUB_RELEASES_API_URL, GITHUB_RELEASES_PAGE_URL } from "../shared/constants";
import type { UpdateCheckState } from "../shared/types";

const UPDATE_CACHE_KEY = "jamassist_update_check_v1";
export const UPDATE_CHECK_ALARM_NAME = "jamassist-update-check";

interface StoredUpdateCache {
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  checkedAtMs: number;
}

export function getInstalledVersion(): string {
  try {
    const manifest = chrome.runtime.getManifest();
    return manifest.version_name || manifest.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function readCache(): Promise<StoredUpdateCache | null> {
  try {
    const res = await chrome.storage.local.get(UPDATE_CACHE_KEY);
    const val = res[UPDATE_CACHE_KEY] as StoredUpdateCache | undefined;
    return val && typeof val.checkedAtMs === "number" ? val : null;
  } catch {
    return null;
  }
}

async function writeCache(cache: StoredUpdateCache): Promise<void> {
  try {
    await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: cache });
  } catch {
    // Ignore quota errors on non-critical update check cache
  }
}

export function ensureUpdateCheckAlarm(): void {
  if (!chrome.alarms) return;
  try {
    chrome.alarms.create(UPDATE_CHECK_ALARM_NAME, { periodInMinutes: 60 * 24 });
  } catch {
    // Ignore if alarms unavailable
  }
}

export async function checkForExtensionUpdate(
  dismissedVersion?: string | null,
  force = false,
): Promise<UpdateCheckState> {
  const currentVersion = getInstalledVersion();
  const cached = await readCache();
  const nowMs = Date.now();

  if (!force && cached && !shouldCheckForUpdate(cached.checkedAtMs, nowMs)) {
    return {
      currentVersion,
      latestVersion: cached.latestVersion,
      releaseUrl: cached.releaseUrl,
      releaseName: cached.releaseName,
      publishedAt: cached.publishedAt,
      updateAvailable: isUpdateAvailable(currentVersion, cached.latestVersion, dismissedVersion),
      dismissedVersion: dismissedVersion ?? null,
      checkedAtMs: cached.checkedAtMs,
    };
  }

  try {
    const res = await fetch(GITHUB_RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      return {
        currentVersion,
        latestVersion: cached?.latestVersion ?? null,
        releaseUrl: cached?.releaseUrl ?? GITHUB_RELEASES_PAGE_URL,
        releaseName: cached?.releaseName ?? null,
        publishedAt: cached?.publishedAt ?? null,
        updateAvailable: isUpdateAvailable(
          currentVersion,
          cached?.latestVersion ?? null,
          dismissedVersion,
        ),
        dismissedVersion: dismissedVersion ?? null,
        checkedAtMs: cached?.checkedAtMs ?? null,
      };
    }

    const payload = (await res.json()) as {
      tag_name?: string;
      name?: string;
      html_url?: string;
      published_at?: string;
      draft?: boolean;
    };

    const rawTag = payload.draft ? null : (payload.tag_name ?? null);
    const latestVersion = rawTag ? rawTag.trim().replace(/^v/i, "") : null;
    const releaseUrl =
      payload.html_url && payload.html_url.startsWith("https://github.com/")
        ? payload.html_url
        : GITHUB_RELEASES_PAGE_URL;

    const nextCache: StoredUpdateCache = {
      latestVersion,
      releaseUrl,
      releaseName: payload.name ?? rawTag ?? null,
      publishedAt: payload.published_at ?? null,
      checkedAtMs: nowMs,
    };
    await writeCache(nextCache);

    return {
      currentVersion,
      latestVersion,
      releaseUrl,
      releaseName: nextCache.releaseName,
      publishedAt: nextCache.publishedAt,
      updateAvailable: isUpdateAvailable(currentVersion, latestVersion, dismissedVersion),
      dismissedVersion: dismissedVersion ?? null,
      checkedAtMs: nowMs,
    };
  } catch {
    return {
      currentVersion,
      latestVersion: cached?.latestVersion ?? null,
      releaseUrl: cached?.releaseUrl ?? GITHUB_RELEASES_PAGE_URL,
      releaseName: cached?.releaseName ?? null,
      publishedAt: cached?.publishedAt ?? null,
      updateAvailable: isUpdateAvailable(
        currentVersion,
        cached?.latestVersion ?? null,
        dismissedVersion,
      ),
      dismissedVersion: dismissedVersion ?? null,
      checkedAtMs: cached?.checkedAtMs ?? null,
    };
  }
}

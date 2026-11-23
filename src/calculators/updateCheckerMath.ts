export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  prereleaseNum: number | null;
}

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Parses versions like "v2.7.5", "2.7.5-exp18", "2.8.0-rc.1". */
export function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const m = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  const prerelease = m[4] ?? null;
  const numMatch = prerelease ? prerelease.match(/(\d+)$/) : null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease,
    prereleaseNum: numMatch ? Number(numMatch[1]) : null,
  };
}

/**
 * Returns >0 if a > b, <0 if a < b, 0 if equal.
 * Stable release (no prerelease) ranks higher than a prerelease of the same core version
 * (e.g. 2.7.5 > 2.7.5-exp18).
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;

  if (
    pa.prereleaseNum !== null &&
    pb.prereleaseNum !== null &&
    pa.prerelease.replace(/\d+$/, "") === pb.prerelease.replace(/\d+$/, "")
  ) {
    return pa.prereleaseNum - pb.prereleaseNum;
  }
  return pa.prerelease.localeCompare(pb.prerelease);
}

/** Returns true when latestTag is strictly newer than currentVersion and not dismissed. */
export function isUpdateAvailable(
  currentVersion: string,
  latestTag: string | null | undefined,
  dismissedVersion?: string | null,
): boolean {
  if (!latestTag) return false;
  const normLatest = latestTag.trim().replace(/^v/i, "");
  if (!parseSemver(normLatest) || !parseSemver(currentVersion)) return false;
  if (dismissedVersion && compareVersions(normLatest, dismissedVersion) <= 0) {
    return false;
  }
  return compareVersions(normLatest, currentVersion) > 0;
}

/** Returns true if enough time has elapsed since the last GitHub Releases check. */
export function shouldCheckForUpdate(
  lastCheckedAtMs: number | null | undefined,
  nowMs: number,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
): boolean {
  if (!lastCheckedAtMs || !Number.isFinite(lastCheckedAtMs)) return true;
  return nowMs - lastCheckedAtMs >= intervalMs;
}

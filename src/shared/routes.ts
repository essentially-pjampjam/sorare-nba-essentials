/**
 * Pure, zero-dependency Sorare NBA route builders and URL validators.
 * Never emit prohibited 404 paths (/nba/arena or /nba/set).
 */

export const SORARE_ORIGIN = "https://sorare.com";
export const SORARE_NBA_MARKET_URL = "https://sorare.com/nba/market";
export const SORARE_NBA_CARD_URL = "https://sorare.com/nba/cards";

export const PROHIBITED_SORARE_NBA_PATHS = ["/nba/arena", "/nba/set"] as const;

export type SetPlayMode = "arcade" | "squad" | "hot_streak";

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

export function normalizeSorareSlug(raw?: string | null): string | null {
  if (typeof raw !== "string") return null;
  if (CONTROL_CHAR_RE.test(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === ".") return null;
  const lower = trimmed.toLowerCase();
  if (lower === "null" || lower === "undefined") return null;
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    trimmed.includes("..")
  ) {
    return null;
  }
  return trimmed;
}

function decodePathSafely(rawPath: string): string {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath.replace(/%[0-9a-fA-F]{2}/g, (seq) => {
      try {
        return decodeURIComponent(seq);
      } catch {
        return seq;
      }
    });
  }
}

function normalizePathnameForProhibitedCheck(rawPath: string): string {
  const decoded = decodePathSafely(rawPath)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  let resolved = decoded;
  if (decoded.startsWith("/")) {
    try {
      resolved = new URL(decoded, SORARE_ORIGIN).pathname;
    } catch {
      resolved = decoded;
    }
  }
  return resolved.toLowerCase().replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

export function isProhibitedSorareUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const normalizedInput =
    trimmed.startsWith("///") || trimmed.startsWith("/\\")
      ? trimmed.replace(/^[/\\]+/, "/")
      : trimmed;
  try {
    const parsed = new URL(normalizedInput, SORARE_ORIGIN);
    const path = normalizePathnameForProhibitedCheck(parsed.pathname);
    return PROHIBITED_SORARE_NBA_PATHS.some(
      (prohibited) => path === prohibited || path.startsWith(`${prohibited}/`),
    );
  } catch {
    const withoutQuery = normalizedInput.split(/[?#]/)[0] ?? "";
    const strippedAuthority = withoutQuery.replace(
      /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i,
      "",
    );
    const clean = normalizePathnameForProhibitedCheck(strippedAuthority);
    return PROHIBITED_SORARE_NBA_PATHS.some(
      (prohibited) => clean === prohibited || clean.startsWith(`${prohibited}/`),
    );
  }
}

export function isAllowedSorareUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== "sorare.com" && !host.endsWith(".sorare.com")) return false;
    return !isProhibitedSorareUrl(parsed.toString());
  } catch {
    return false;
  }
}

export function buildProPlayUrl(): string {
  return `${SORARE_ORIGIN}/nba/play`;
}

export function buildProLineupsUrl(): string {
  return `${SORARE_ORIGIN}/nba/lineups/pro`;
}

export function buildPrevLineupsUrl(): string {
  return `${SORARE_ORIGIN}/nba/lineups/prev`;
}

export function buildArenaOngoingUrl(): string {
  return `${SORARE_ORIGIN}/nba/lineups/arena/ongoing`;
}

export function buildArenaLineupsUrl(fixtureSlug?: string | null): string {
  const slug = normalizeSorareSlug(fixtureSlug);
  if (slug && slug.toLowerCase() !== "ongoing") {
    return `${SORARE_ORIGIN}/nba/lineups/arena/${encodeURIComponent(slug)}`;
  }
  return buildArenaOngoingUrl();
}

export function buildArenaBoardUrl(
  fixtureSlug?: string | null,
  leaderboardSlug?: string | null,
): string {
  const fix = normalizeSorareSlug(fixtureSlug);
  const lb = normalizeSorareSlug(leaderboardSlug);
  if (fix && lb) {
    return `${SORARE_ORIGIN}/nba/play/boards/arena/cash/${encodeURIComponent(fix)}/${encodeURIComponent(lb)}`;
  }
  return buildProPlayUrl();
}

export function buildSetPlayUrl(
  mode: SetPlayMode = "arcade",
  seriesId?: string | null,
): string {
  if (mode === "squad") {
    return `${SORARE_ORIGIN}/nba/series/squad`;
  }
  if (mode === "hot_streak") {
    const id = normalizeSorareSlug(seriesId);
    return id
      ? `${SORARE_ORIGIN}/nba/series/${encodeURIComponent(id)}/lineups`
      : `${SORARE_ORIGIN}/nba/series/play`;
  }
  return `${SORARE_ORIGIN}/nba/series/play`;
}

export function buildSquadLineupUrl(boardStepId?: string | null): string {
  const id = normalizeSorareSlug(boardStepId);
  if (id) {
    return `${SORARE_ORIGIN}/nba/series/squad/lineups/${encodeURIComponent(id)}`;
  }
  return buildSetPlayUrl("squad");
}

export function buildCardUrl(cardSlug: string): string {
  const slug = normalizeSorareSlug(cardSlug);
  return slug ? `${SORARE_NBA_CARD_URL}/${encodeURIComponent(slug)}` : SORARE_NBA_MARKET_URL;
}

export function buildMarketPlayerUrl(
  playerSlug: string,
  rarity?: string | null,
): string {
  const slug = normalizeSorareSlug(playerSlug);
  if (!slug) return SORARE_NBA_MARKET_URL;
  const normRarity = normalizeSorareSlug(rarity);
  if (normRarity) {
    return `${SORARE_NBA_MARKET_URL}?player=${encodeURIComponent(slug)}&rarity=${encodeURIComponent(normRarity)}`;
  }
  return `${SORARE_NBA_MARKET_URL}?player=${encodeURIComponent(slug)}`;
}

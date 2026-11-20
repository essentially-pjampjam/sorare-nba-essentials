import type { CurrentLineupEntry } from "./types";

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sharedPlayerCount(a: CurrentLineupEntry, b: CurrentLineupEntry): number {
  const namesA = new Set((a.playerNames ?? []).map(normalizeName).filter(Boolean));
  let shared = 0;
  for (const n of b.playerNames ?? []) {
    if (namesA.has(normalizeName(n))) shared += 1;
  }
  const slugsA = new Set(a.cardSlugs);
  const sharedSlugs = b.cardSlugs.filter((s) => slugsA.has(s)).length;
  return Math.max(shared, sharedSlugs);
}

/** Same lineup if Sorare ids match, or same competition + Game Week and >= 3 of 5 players shared. */
function isSameLineup(stored: CurrentLineupEntry, incoming: CurrentLineupEntry): boolean {
  if (stored.sorareLineupId && incoming.sorareLineupId) {
    return stored.sorareLineupId === incoming.sorareLineupId;
  }
  if (stored.leaderboardSlug !== incoming.leaderboardSlug) return false;
  if (stored.fixtureSlug && incoming.fixtureSlug && stored.fixtureSlug !== incoming.fixtureSlug) {
    return false;
  }
  return sharedPlayerCount(stored, incoming) >= 3;
}

/**
 * Merges freshly detected DOM lineups into the stored set.
 *
 * - Full listing pages (the Game Week lineups page) are authoritative: they replace the
 *   stored set, so cleared lineups disappear.
 * - Partial pages (board pages showing one competition) update the matching lineup in
 *   place (e.g. after swapping one player) and keep every other stored lineup of the same
 *   Game Week. Lineups from an older Game Week are dropped.
 */
export function upsertDomLineups(
  stored: CurrentLineupEntry[],
  incoming: CurrentLineupEntry[],
  partial: boolean,
): CurrentLineupEntry[] {
  if (incoming.length === 0) return stored;
  if (!partial) return incoming.slice(0, 12);

  const incomingFixtures = new Set(
    incoming.map((l) => l.fixtureSlug).filter((f): f is string => Boolean(f)),
  );
  const result = stored.filter(
    (l) => incomingFixtures.size === 0 || !l.fixtureSlug || incomingFixtures.has(l.fixtureSlug),
  );
  for (const inc of incoming) {
    const idx = result.findIndex((s) => isSameLineup(s, inc));
    if (idx >= 0) {
      result[idx] = { ...inc, sorareLineupId: inc.sorareLineupId ?? result[idx]?.sorareLineupId ?? null };
    } else {
      result.push(inc);
    }
  }
  return result.slice(0, 12);
}

/** API lineup ids look like "So5Lineup:<uuid>" or "...~so5-lineup~<uuid>"; DOM ids are the uuid. */
function idsMatch(api: CurrentLineupEntry, dom: CurrentLineupEntry): boolean {
  const uuid = dom.sorareLineupId;
  return Boolean(uuid && (api.id === uuid || api.id.endsWith(uuid)));
}

function matchesApiLineup(api: CurrentLineupEntry, dom: CurrentLineupEntry): boolean {
  return idsMatch(api, dom) || sharedPlayerCount(api, dom) >= 3;
}

/**
 * Combines Sorare API lineups with lineups captured from sorare.com pages.
 *
 * - `"load"` (gallery fetch): the API list is the source of truth when it has any lineup,
 *   because stored page captures can be stale (lineups edited while the panel was closed).
 *   Without API lineups (no key / API down) the page captures are used.
 * - `"live"` (a page was just synced): page captures are the freshest view; they replace the
 *   API lineups they match, and unmatched API lineups are kept.
 */
export function mergeApiAndDomLineups(
  apiLineups: CurrentLineupEntry[],
  domLineups: CurrentLineupEntry[],
  mode: "load" | "live",
): CurrentLineupEntry[] {
  const api = apiLineups.filter((l) => l.source !== "dom");
  if (mode === "load") return api.length > 0 ? api : domLineups;
  const keptApi = api.filter((a) => !domLineups.some((d) => matchesApiLineup(a, d)));
  // Page captures have no live rank / score: carry them over from the matching API lineup.
  const dom = domLineups.map((d) => {
    const a = api.find((x) => matchesApiLineup(x, d));
    return a ? { ...d, rank: d.rank ?? a.rank, score: d.score ?? a.score, leaderboardSlug: d.leaderboardSlug || a.leaderboardSlug } : d;
  });
  return [...keptApi, ...dom];
}

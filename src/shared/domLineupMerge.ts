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

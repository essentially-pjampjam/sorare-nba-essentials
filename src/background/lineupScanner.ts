import type { CurrentLineupEntry, PageLineup, PageLineupSnapshot } from "../shared/types";

const PAGE_LINEUPS_KEY = "page_lineups_v1";

type PageReadResult = { userSlug: string; lineups: PageLineup[] } | { error: string };

/**
 * Runs inside a sorare.com tab (MAIN world) and reads the manager's own lineups from the data
 * Sorare already loaded into its Apollo cache. Lineups (live and before cutoff) are private,
 * logged-in data: the public API (even with a key) returns none of them. No network request.
 * Must be self-contained (chrome.scripting serializes it).
 */
function readLineupsFromPage(): PageReadResult {
  type Entity = Record<string, unknown>;
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Entity> } } })
    .__APOLLO_CLIENT__;
  if (!client) return { error: "Sorare page data not ready." };
  const ex = client.cache.extract();
  const deref = (r: unknown): Entity | null => {
    const ref = (r as { __ref?: string } | null | undefined)?.__ref;
    return ref ? (ex[ref] ?? null) : null;
  };
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const me = Object.entries(ex).find(([k]) => k.startsWith("CurrentUser"))?.[1];
  const userSlug = str(me?.slug);
  if (!userSlug) return { error: "Not logged in on this Sorare tab." };

  // Rankings carry rank / score and point at the lineup and its leaderboard.
  const rankingByLineup = new Map<string, Entity>();
  for (const [k, v] of Object.entries(ex)) {
    if (!k.startsWith("So5Ranking:")) continue;
    const ref = (v.so5Lineup as { __ref?: string } | undefined)?.__ref;
    if (ref) rankingByLineup.set(ref, v);
  }

  const lineups: PageLineup[] = [];
  for (const [key, l] of Object.entries(ex)) {
    if (!key.startsWith("So5Lineup:")) continue;
    if (str(deref(l.user)?.slug) !== userSlug) continue;
    if (l.cancelledAt || l.draft === true || l.hidden === true) continue;
    const ranking = rankingByLineup.get(key) ?? null;
    const lb = deref(ranking?.so5Leaderboard) ?? deref(l.so5Leaderboard);
    const fixture = deref(lb?.so5Fixture);
    const apKey = Object.keys(l).find((k) => k.startsWith("so5Appearances"));
    const appearances = (Array.isArray(apKey ? l[apKey] : null) ? (l[apKey as string] as unknown[]) : [])
      .map(deref)
      .filter((a): a is Entity => a !== null);
    const cardSlugs = appearances.map((a) => str(deref(a.anyCard)?.slug)).filter(Boolean);
    const playerNames = appearances.map((a) => str(deref(a.anyPlayer)?.displayName)).filter(Boolean);
    const leaderboardSlug = str(lb?.slug);
    if (!leaderboardSlug && cardSlugs.length === 0) continue;
    lineups.push({
      id: str(l.id) || key,
      name: str(l.name) || str(lb?.displayName) || "Lineup",
      leaderboardSlug,
      leaderboardName: str(lb?.displayName) || str(l.name) || "Sorare Pro",
      fixtureSlug: str(fixture?.slug) || (leaderboardSlug.includes("-nba_") ? leaderboardSlug.split("-nba_")[0] : ""),
      fixtureName: str(fixture?.displayName),
      fixtureState: str(fixture?.aasmState),
      cutOffDate: str(fixture?.cutOffDate) || str(lb?.cutOffDate) || null,
      endDate: str(fixture?.endDate) || null,
      cardSlugs: cardSlugs.slice(0, 5),
      playerNames: playerNames.slice(0, 5),
      rank: num(ranking?.ranking),
      liveProjectedRank: num(ranking?.liveProjectedRanking),
      score: num(ranking?.score),
      totalEntries: num(lb?.so5LineupsCount),
      canEdit: l.canEdit === true || l.updatable === true,
    });
  }
  return { userSlug, lineups };
}

export async function getSavedPageLineups(username?: string): Promise<PageLineupSnapshot | null> {
  const stored = await chrome.storage.local.get(PAGE_LINEUPS_KEY);
  const snap = (stored[PAGE_LINEUPS_KEY] as PageLineupSnapshot | undefined) ?? null;
  if (!snap) return null;
  if (username && snap.userSlug !== username.trim().toLowerCase()) return null;
  return snap;
}

/** Drops lineups of Game Weeks that ended more than a day ago. */
function pruneFinished(lineups: PageLineup[], nowMs: number): PageLineup[] {
  return lineups.filter((l) => {
    if (l.fixtureState === "closed") return false;
    const end = l.endDate ? Date.parse(l.endDate) : NaN;
    return !Number.isFinite(end) || end + 24 * 3600_000 > nowMs;
  });
}

/**
 * Merges a fresh page read into the saved snapshot. A Game Week the tab showed replaces the
 * saved lineups of that Game Week (so deleted lineups disappear); other weeks are kept.
 */
export function mergePageLineups(
  previous: PageLineupSnapshot | null,
  read: { userSlug: string; lineups: PageLineup[] },
  nowMs: number,
): PageLineupSnapshot {
  const base = previous && previous.userSlug === read.userSlug ? previous.lineups : [];
  const freshWeeks = new Set(read.lineups.map((l) => l.fixtureSlug));
  const kept = base.filter((l) => !freshWeeks.has(l.fixtureSlug));
  return { userSlug: read.userSlug, lineups: pruneFinished([...kept, ...read.lineups], nowMs), scannedAt: nowMs };
}

async function readTab(tabId: number): Promise<PageLineupSnapshot | null> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readLineupsFromPage });
  const data = result?.result as PageReadResult | undefined;
  if (!data || "error" in data) return null;
  // An empty read on a non-lineup page says nothing about the manager's lineups.
  if (data.lineups.length === 0) return null;
  const next = mergePageLineups(await getSavedPageLineups(), data, Date.now());
  await chrome.storage.local.set({ [PAGE_LINEUPS_KEY]: next });
  return next;
}

/** Reads lineups from every open sorare.com NBA tab. Returns the saved snapshot (fresh or not). */
export async function syncLineupsFromOpenTabs(username?: string): Promise<PageLineupSnapshot | null> {
  if (chrome.scripting && chrome.tabs?.query) {
    const tabs = await chrome.tabs.query({ url: ["https://sorare.com/nba/*"] }).catch(() => []);
    for (const t of tabs) {
      if (t.id) await readTab(t.id).catch(() => null);
    }
  }
  return getSavedPageLineups(username);
}

/** Re-reads lineups whenever a Sorare NBA page loads or navigates (the Lineups page fills its data late). */
export function watchLineupPages(onUpdate: (snap: PageLineupSnapshot) => void): void {
  if (!chrome.tabs?.onUpdated || !chrome.scripting) return;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.url || !tab.url.startsWith("https://sorare.com/nba")) return;
    if (info.status !== "complete" && !info.url) return;
    for (const delay of [3000, 8000]) {
      setTimeout(() => {
        void readTab(tabId)
          .then((snap) => {
            if (snap) onUpdate(snap);
          })
          .catch(() => undefined);
      }, delay);
    }
  });
}

/** Lineups of the open (before cutoff) Game Week, in the shape the swap / compare tools use. */
export function openPageLineupsAsEntries(snap: PageLineupSnapshot | null): CurrentLineupEntry[] {
  if (!snap) return [];
  return snap.lineups
    .filter((l) => l.fixtureState === "opened")
    .map((l) => ({
      id: `page:${l.id}`,
      name: l.name,
      leaderboardSlug: l.leaderboardSlug,
      leaderboardName: l.leaderboardName,
      draft: false,
      cardSlugs: l.cardSlugs,
      playerNames: l.playerNames,
      captainCardSlug: null,
      source: "page" as const,
      fixtureSlug: l.fixtureSlug,
      sorareLineupId: l.id.replace(/^So5Lineup:/, ""),
      detectedAt: snap.scannedAt,
      rank: l.rank,
      score: l.score,
    }));
}

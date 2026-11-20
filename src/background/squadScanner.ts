import type { SquadSnapshot } from "../shared/types";

const SQUAD_SNAPSHOT_KEY = "squad_snapshot_v1";

/**
 * Runs inside the sorare.com page (MAIN world) and reads the Set Squad data Sorare already loaded
 * into its Apollo cache. No network request: the Squad is private, logged-in data that the public
 * API key cannot read. Must be self-contained (it is serialized by chrome.scripting).
 */
function readSquadFromPage(): SquadSnapshot | { error: string } {
  type Ref = { __ref?: string } | null | undefined;
  type Entity = Record<string, unknown>;
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Entity> } } })
    .__APOLLO_CLIENT__;
  if (!client) return { error: "Sorare page data not ready. Reload the Sorare tab and try again." };
  const ex = client.cache.extract();
  const deref = (r: unknown): Entity | null => {
    const ref = (r as Ref)?.__ref;
    return ref ? (ex[ref] ?? null) : null;
  };
  const user = (r: unknown) => {
    const u = deref(r);
    if (!u) return null;
    const slug = String(u.slug ?? "");
    return slug ? { slug, nickname: String(u.nickname ?? slug) } : null;
  };
  const squadEntry = Object.entries(ex).find(([k]) => k.startsWith("Squad:"));
  if (!squadEntry) return { error: "No Squad found. Open sorare.com/nba/series/squad in this tab first." };
  const squad = squadEntry[1];
  const members = Array.isArray(squad.members)
    ? (squad.members as unknown[]).map(user).filter((u): u is { slug: string; nickname: string } => u !== null)
    : [];
  const steps = Object.entries(ex)
    .filter(([k]) => k.startsWith("SquadStep:"))
    .map(([, s]) => {
      const lineups = Array.isArray(s.squadLeaderboardLineups) ? (s.squadLeaderboardLineups as unknown[]) : [];
      const lineupUsers = lineups
        .map((r) => {
          const lineup = deref(deref(r)?.lineup);
          return lineup ? user(lineup.user) : null;
        })
        .filter((u): u is { slug: string; nickname: string } => u !== null);
      return {
        state: String(s.state ?? ""),
        target: Number(s.target ?? 0) || 0,
        totalLineups: Number(s.totalLineups ?? lineupUsers.length) || 0,
        minimumLineups: Number(s.minimumLineupsToStartStep ?? 3) || 3,
        totalScore: Number(s.totalScore ?? 0) || 0,
        lineupUsers,
      };
    })
    .sort((a, b) => a.target - b.target);
  return {
    squadName: String(squad.name ?? "Squad"),
    membersCount: Number(squad.membersCount ?? members.length) || members.length,
    maxMembersCount: Number(squad.maxMembersCount ?? 10) || 10,
    captainSlug: user(squad.captain)?.slug ?? null,
    members,
    steps,
    scannedAt: Date.now(),
  };
}

export async function getSavedSquadSnapshot(): Promise<SquadSnapshot | null> {
  const stored = await chrome.storage.local.get(SQUAD_SNAPSHOT_KEY);
  return (stored[SQUAD_SNAPSHOT_KEY] as SquadSnapshot | undefined) ?? null;
}

/** Reads the Squad from the user's open sorare.com Squad tab and saves it (keeps known members). */
export async function scanSquadFromOpenTab(): Promise<SquadSnapshot> {
  if (!chrome.scripting) throw new Error("Reload the extension to grant the page-reading permission.");
  const tabs = await chrome.tabs.query({ url: ["https://sorare.com/nba/series/squad*"] });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab?.id) throw new Error("Open sorare.com/nba/series/squad (Set > Squad) in a tab, then Scan again.");
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: readSquadFromPage });
  const data = result?.result as SquadSnapshot | { error: string } | undefined;
  if (!data) throw new Error("Could not read the Squad page.");
  if ("error" in data) throw new Error(data.error);
  const previous = await getSavedSquadSnapshot();
  // The member list loads only on the Members page: keep the last one when this scan lacks it.
  if (data.members.length === 0 && previous?.squadName === data.squadName) data.members = previous.members;
  if (data.steps.length === 0 && previous?.squadName === data.squadName) data.steps = previous.steps;
  await chrome.storage.local.set({ [SQUAD_SNAPSHOT_KEY]: data });
  return data;
}

import type { PickerMissionsSnapshot, PickerMissionsByMode, RawPickerTaskSnapshot } from "../shared/types";

const PICKER_MISSIONS_KEY = "picker_missions_v1";

/**
 * Runs in a sorare.com missions page (MAIN world): reads the live daily picker tasks
 * (`DecisivePlayerPickerTask`) from Sorare's Apollo cache. Private, logged-in data. Self-contained.
 */
function readPickerTasksFromPage(): { mode: "pro" | "set"; tasks: RawPickerTaskSnapshot[] } | { error: string } {
  type Entity = Record<string, unknown>;
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Entity> } } })
    .__APOLLO_CLIENT__;
  if (!client) return { error: "Sorare page data not ready yet." };
  const ex = client.cache.extract();
  const pageMode: "pro" | "set" = /\/series(\/|$)/.test(location.pathname) ? "set" : "pro";
  const isProTask = (t: { title: string; description: string; slug: string; picks: number }): boolean => {
    const desc = t.description.trim();
    const slug = t.slug.toLowerCase();
    const title = t.title.toLowerCase();
    return (
      /^(classic|in-season):/i.test(desc) ||
      /\b(xp|limited|rare|super\s*rare|unique)\b/i.test(desc) ||
      /\b(classic|pro|limited|rare|playmaker|rebound|double|triple)\b/.test(slug) ||
      /\b(playmaker|rebound|double[- ]double|triple[- ]double)\b/.test(title) ||
      t.picks > 1
    );
  };
  const seen = new Set<string>();
  const tasks = Object.entries(ex)
    .filter(([, t]) => t.__typename === "DecisivePlayerPickerTask" && t.expired !== true)
    .map(([, t]) => ({
      title: String(t.title ?? ""),
      description: String(t.description ?? ""),
      mode: String(t.mode ?? ""),
      slug: String(t.taskConfigSlug ?? ""),
      picks: Number(t.maxAppearancesCount ?? 1) || 1,
      state: String(t.aasmState ?? ""),
    }))
    .filter((t) => t.title.length > 0)
    .filter((t) => (pageMode === "pro" ? isProTask(t) : !isProTask(t)))
    .filter((t) => {
      const key = (t.slug || `${t.title}::${t.description}`).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (tasks.length === 0) return { error: "No daily pickers on this page. Open Sorare's Play missions." };
  return { mode: pageMode, tasks };
}

export async function getSavedPickerMissions(): Promise<PickerMissionsByMode> {
  const stored = await chrome.storage.local.get(PICKER_MISSIONS_KEY);
  return (stored[PICKER_MISSIONS_KEY] as PickerMissionsByMode | undefined) ?? {};
}

async function readTab(tabId: number): Promise<PickerMissionsSnapshot | null> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readPickerTasksFromPage });
  const data = result?.result as { mode: "pro" | "set"; tasks: RawPickerTaskSnapshot[] } | { error: string } | undefined;
  if (!data || "error" in data) return null;
  const snapshot: PickerMissionsSnapshot = { mode: data.mode, tasks: data.tasks, scannedAt: Date.now() };
  const all = await getSavedPickerMissions();
  await chrome.storage.local.set({ [PICKER_MISSIONS_KEY]: { ...all, [data.mode]: snapshot } });
  return snapshot;
}

const MISSION_PAGE = /^https:\/\/sorare\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?nba\/(play(\/missions)?|series\/play)/i;

/** Reads the pickers from any open Sorare missions / Play tab (button in the panel). */
export async function scanPickerMissionsFromOpenTabs(): Promise<PickerMissionsByMode> {
  if (!chrome.scripting) throw new Error("Reload the extension to grant the page-reading permission.");
  const tabs = (
    await chrome.tabs.query({ url: ["https://sorare.com/nba/*", "https://sorare.com/*/nba/*"] })
  ).filter((t) => t.url && MISSION_PAGE.test(t.url));
  if (tabs.length === 0) throw new Error("Open Sorare's Play missions (the Go button) in a tab, then scan again.");
  let found = 0;
  for (const tab of tabs) {
    if (tab.id && (await readTab(tab.id).catch(() => null))) found += 1;
  }
  if (found === 0) throw new Error("No daily pickers found yet: wait for the Sorare page to load, then scan again.");
  return getSavedPickerMissions();
}

/** Silently reads picker tasks from a Sorare tab (used on page load and after in-page submissions). */
export async function syncMissionTab(tabId: number): Promise<PickerMissionsSnapshot | null> {
  if (!chrome.scripting?.executeScript) return null;
  return readTab(tabId).catch(() => null);
}

/** Auto-sync: when a Sorare missions page finishes loading, read its pickers (retries while it loads). */
export function watchMissionPages(): void {
  if (!chrome.tabs?.onUpdated || !chrome.scripting) return;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if ((info.status !== "complete" && !info.url) || !tab.url || !/missions|series\/play/.test(tab.url) || !MISSION_PAGE.test(tab.url)) return;
    let tries = 0;
    const attempt = () => {
      tries += 1;
      readTab(tabId)
        .then((snap) => {
          if (!snap && tries < 4) setTimeout(attempt, 2500);
        })
        .catch(() => {});
    };
    setTimeout(attempt, 2000);
    setTimeout(() => void readTab(tabId).catch(() => null), 6500);
  });
}

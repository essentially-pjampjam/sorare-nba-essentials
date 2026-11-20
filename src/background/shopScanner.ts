import type { SetShopStatus } from "../shared/types";

const SHOP_STATUS_KEY = "set_shop_status_v1";

/**
 * Runs in the sorare.com Set Shop page (MAIN world): reads the Daily Pack claim task and the
 * Bronze+ progress task from Sorare's Apollo cache (private, logged-in data). Self-contained.
 */
function readShopStatusFromPage(): SetShopStatus | { error: string } {
  type Entity = Record<string, unknown>;
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Entity> } } })
    .__APOLLO_CLIENT__;
  if (!client) return { error: "Sorare page data not ready. Reload the Sorare Shop tab and try again." };
  const ex = client.cache.extract();
  const deref = (r: unknown): Entity | null => {
    const ref = (r as { __ref?: string } | null)?.__ref;
    return ref ? (ex[ref] ?? null) : null;
  };
  let dailyPackClaimed: boolean | null = null;
  let bronzePlusProgress: number | null = null;
  let bronzePlusTarget: number | null = null;
  for (const [key, entity] of Object.entries(ex)) {
    if (key.startsWith("MarketRoot")) {
      const daily = deref(entity['myCommonDailyClaimTask({"sport":"NBA"})']);
      if (daily) dailyPackClaimed = String(daily.aasmState ?? "") === "CLAIMED";
    }
    if (key.startsWith("CardPackGroup")) {
      const task = deref(entity.boughtPacksCountTask);
      if (task && typeof task.progress === "number" && typeof task.target === "number") {
        bronzePlusProgress = task.progress;
        bronzePlusTarget = task.target;
      }
    }
  }
  if (dailyPackClaimed === null && bronzePlusProgress === null) {
    return { error: "Open the Set Shop (sorare.com/nba/series/market) in a tab, then scan again." };
  }
  return { dailyPackClaimed, bronzePlusProgress, bronzePlusTarget, scannedAt: Date.now() };
}

export async function getSavedShopStatus(): Promise<SetShopStatus | null> {
  const stored = await chrome.storage.local.get(SHOP_STATUS_KEY);
  const status = (stored[SHOP_STATUS_KEY] as SetShopStatus | undefined) ?? null;
  if (!status) return null;
  // Daily Pack status resets at 07:00 UTC: drop it once a reset passed since the scan.
  const lastReset = new Date();
  lastReset.setUTCHours(7, 0, 0, 0);
  if (lastReset.getTime() > Date.now()) lastReset.setUTCDate(lastReset.getUTCDate() - 1);
  return status.scannedAt < lastReset.getTime() ? { ...status, dailyPackClaimed: null } : status;
}

export async function scanShopStatusFromOpenTab(): Promise<SetShopStatus> {
  if (!chrome.scripting) throw new Error("Reload the extension to grant the page-reading permission.");
  const tabs = await chrome.tabs.query({ url: ["https://sorare.com/nba/series/market*"] });
  const tab = tabs.find((t) => t.active) ?? tabs[0];
  if (!tab?.id) throw new Error("Open the Set Shop (sorare.com/nba/series/market) in a tab, then scan again.");
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: readShopStatusFromPage });
  const data = result?.result as SetShopStatus | { error: string } | undefined;
  if (!data) throw new Error("Could not read the Shop page.");
  if ("error" in data) throw new Error(data.error);
  await chrome.storage.local.set({ [SHOP_STATUS_KEY]: data });
  return data;
}

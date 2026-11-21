import type { SetShopStatus } from "../shared/types";

const DISCOVERED_PACKS_KEY = "discovered_packs_v1";

/** A Set shop pack seen on the user's Sorare Shop page (special offers are not in the public list). */
export interface DiscoveredPack {
  slug: string;
  title: string;
  endDate: string | null;
  firstSeen: number;
}

type FoundPack = { slug: string; title: string; endDate: string | null };

/** MAIN world: every titled Set pack in the page's Apollo cache. Self-contained. */
function readPacksFromPage(): FoundPack[] {
  type Entity = Record<string, unknown>;
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Entity> } } })
    .__APOLLO_CLIENT__;
  if (!client) return [];
  const out: FoundPack[] = [];
  for (const [key, v] of Object.entries(client.cache.extract())) {
    if (!key.startsWith("CardPack:")) continue;
    const slug = typeof v.slug === "string" ? v.slug : "";
    const title = typeof v.title === "string" ? v.title : "";
    if (!slug || !title || !slug.startsWith("divination-")) continue;
    out.push({ slug, title, endDate: typeof v.endDate === "string" ? v.endDate : null });
  }
  return out;
}

const STANDARD_PACK_RE = /^divination-nba-(gold|silver|bronze)(-pack|-live-today-\d{4}-\d{2}-\d{2})$/;

/** Standard and Live Today packs come from the public API already; everything else is special. */
export function isSpecialPackSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && !STANDARD_PACK_RE.test(slug) && !/daily-free|all-leagues/.test(slug);
}

/** Saved special packs that have not ended (kept 7 days when they have no end date). */
export async function getDiscoveredPacks(nowMs = Date.now()): Promise<DiscoveredPack[]> {
  const stored = await chrome.storage.local.get(DISCOVERED_PACKS_KEY);
  const list = Array.isArray(stored[DISCOVERED_PACKS_KEY]) ? (stored[DISCOVERED_PACKS_KEY] as DiscoveredPack[]) : [];
  return list.filter((p) => {
    const end = p.endDate ? Date.parse(p.endDate) : NaN;
    return Number.isFinite(end) ? end > nowMs : p.firstSeen + 7 * 24 * 3600_000 > nowMs;
  });
}

async function saveDiscovered(found: FoundPack[]): Promise<void> {
  const special = found.filter((p) => isSpecialPackSlug(p.slug));
  if (special.length === 0) return;
  const now = Date.now();
  const bySlug = new Map((await getDiscoveredPacks(now)).map((p) => [p.slug, p]));
  for (const p of special) {
    const prev = bySlug.get(p.slug);
    bySlug.set(p.slug, { slug: p.slug, title: p.title, endDate: p.endDate, firstSeen: prev?.firstSeen ?? now });
  }
  await chrome.storage.local.set({ [DISCOVERED_PACKS_KEY]: Array.from(bySlug.values()).slice(-20) });
}

async function readPacksTab(tabId: number): Promise<void> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readPacksFromPage });
  if (Array.isArray(result?.result)) await saveDiscovered(result.result as FoundPack[]);
}

/** Reads packs from every open sorare.com NBA tab (before the Pack Advisor loads). */
export async function syncPacksFromOpenTabs(): Promise<void> {
  if (!chrome.scripting || !chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({ url: ["https://sorare.com/nba/*"] }).catch(() => []);
  await Promise.all(tabs.map((t) => (t.id ? readPacksTab(t.id).catch(() => undefined) : undefined)));
}

/** Notices new special packs whenever a Sorare Set page loads. */
export function watchShopPages(): void {
  if (!chrome.tabs?.onUpdated || !chrome.scripting) return;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.url || !tab.url.startsWith("https://sorare.com/nba/series")) return;
    if (info.status !== "complete" && !info.url) return;
    setTimeout(() => void readPacksTab(tabId).catch(() => undefined), 4000);
  });
}

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
  await readPacksTab(tab.id).catch(() => undefined);
  return data;
}

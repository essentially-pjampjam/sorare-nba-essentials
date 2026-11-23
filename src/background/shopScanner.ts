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
    // Reward packs (Squad / mission rewards) have no price: they are not shop offers.
    const price = typeof v.price === "number" ? v.price : 0;
    if (!slug || !title || !/^(?:divination-|[a-z0-9]+-(?:nba|special-offers)-)/.test(slug) || price <= 0) continue;
    out.push({ slug, title, endDate: typeof v.endDate === "string" ? v.endDate : null });
  }
  return out;
}

const STANDARD_PACK_RE = /^[a-z0-9]+-nba-(gold|silver|bronze)(-pack|-live-today-\d{4}-\d{2}-\d{2})$/;

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

const SET_SERIES_PAGE_RE = /^https:\/\/sorare\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?nba\/series(\/|$)/i;

function lastShopDailyResetMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setUTCHours(7, 0, 0, 0);
  if (d.getTime() > nowMs) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}

/**
 * Merges a new SetShopStatus scan with an existing cached status so Daily Solo
 * (`dailyPackClaimed`) and Set Shop (`bronzePlusProgress`) never overwrite each other's fields.
 */
export function mergeShopStatus(
  prev: SetShopStatus | null,
  incoming: SetShopStatus,
  nowMs = Date.now(),
): SetShopStatus {
  if (!prev) return incoming;
  const resetMs = lastShopDailyResetMs(nowMs);
  const prevSameDay = prev.scannedAt >= resetMs;
  const prevDaily = prevSameDay ? prev.dailyPackClaimed : null;
  const dailyPackClaimed =
    incoming.dailyPackClaimed === true || prevDaily === true
      ? true
      : (incoming.dailyPackClaimed ?? prevDaily);
  const bronzePlusProgress = incoming.bronzePlusProgress ?? prev.bronzePlusProgress;
  const bronzePlusTarget = incoming.bronzePlusTarget ?? prev.bronzePlusTarget;
  return {
    dailyPackClaimed,
    bronzePlusProgress,
    bronzePlusTarget,
    scannedAt: incoming.scannedAt,
  };
}

/** Silently reads Daily Pack claim status & Bronze+ progress from a Set tab when available. */
export async function syncShopStatusFromTab(tabId: number): Promise<SetShopStatus | null> {
  if (!chrome.scripting?.executeScript) return null;
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readShopStatusFromPage });
  const data = result?.result as SetShopStatus | { error: string } | undefined;
  if (!data || "error" in data) return null;
  const existing = await getSavedShopStatus().catch(() => null);
  const merged = mergeShopStatus(existing, data, data.scannedAt);
  await chrome.storage.local.set({ [SHOP_STATUS_KEY]: merged });
  return merged;
}

/** Silently reads Daily Pack claim status & Bronze+ progress sequentially from all open Set tabs. */
export async function syncShopStatusFromOpenTabs(): Promise<void> {
  if (!chrome.scripting || !chrome.tabs?.query) return;
  const tabs = await chrome.tabs
    .query({ url: ["https://sorare.com/nba/series/*", "https://sorare.com/*/nba/series/*"] })
    .catch(() => []);
  for (const t of tabs) {
    if (t.id) {
      await syncShopStatusFromTab(t.id).catch(() => null);
    }
  }
}

/** Notices new special packs and Daily Pack claim status whenever a Sorare Set page loads. */
export function watchShopPages(): void {
  if (!chrome.tabs?.onUpdated || !chrome.scripting) return;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.url || !SET_SERIES_PAGE_RE.test(tab.url)) return;
    if (info.status !== "complete" && !info.url) return;
    const checkAndSync = () => {
      void readPacksTab(tabId).catch(() => undefined);
      void chrome.storage.local
        .get("jamassist_content_flags_v1")
        .then((raw) => {
          const flags = raw?.jamassist_content_flags_v1 as { trackDailyTasks?: boolean } | undefined;
          if (flags?.trackDailyTasks === false) return;
          void syncShopStatusFromTab(tabId).catch(() => undefined);
        })
        .catch(() => {
          void syncShopStatusFromTab(tabId).catch(() => undefined);
        });
    };
    setTimeout(checkAndSync, 2200);
    setTimeout(checkAndSync, 4500);
  });
}

const SHOP_STATUS_KEY = "set_shop_status_v1";

/**
 * Runs in the sorare.com Set Daily Solo / Shop page (MAIN world): reads the Daily Pack claim task
 * and the Bronze+ progress task from Sorare's Apollo cache (private, logged-in data). Self-contained.
 */
export function readShopStatusFromPage(): SetShopStatus | { error: string } {
  type Entity = Record<string, unknown>;
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Entity> } } })
    .__APOLLO_CLIENT__;
  if (!client) return { error: "Sorare page data not ready. Reload the Sorare Shop tab and try again." };
  const ex = client.cache.extract();
  const deref = (r: unknown): Entity | null => {
    const ref = (r as { __ref?: string } | null)?.__ref;
    return ref ? (ex[ref] ?? null) : null;
  };
  const isClaimedEntity = (entity: Entity): boolean | null => {
    if (entity.claimed === true || entity.completed === true || Boolean(entity.claimedAt)) return true;
    const state = String(entity.aasmState ?? "").trim().toUpperCase();
    if (!state) return null;
    return state === "CLAIMED" || state === "COMPLETED" || state === "DONE" || state === "FULFILLED";
  };
  let dailyPackClaimed: boolean | null = null;
  let bronzePlusProgress: number | null = null;
  let bronzePlusTarget: number | null = null;
  for (const [key, entity] of Object.entries(ex)) {
    if (key.startsWith("MarketRoot") || key === "ROOT_QUERY") {
      const daily = deref(entity['myCommonDailyClaimTask({"sport":"NBA"})']);
      if (daily) {
        const claimed = isClaimedEntity(daily);
        if (claimed !== null) dailyPackClaimed = claimed;
      }
    }
    if (
      dailyPackClaimed === null &&
      (key.startsWith("CommonDailyClaimTask:") || entity.__typename === "CommonDailyClaimTask") &&
      entity.expired !== true
    ) {
      const claimed = isClaimedEntity(entity);
      if (claimed !== null) dailyPackClaimed = claimed;
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
    return { error: "Open Set Daily Solo (sorare.com/nba/series/play) or Set Shop in a tab, then scan again." };
  }
  return { dailyPackClaimed, bronzePlusProgress, bronzePlusTarget, scannedAt: Date.now() };
}

export async function getSavedShopStatus(): Promise<SetShopStatus | null> {
  const stored = await chrome.storage.local.get(SHOP_STATUS_KEY);
  const status = (stored[SHOP_STATUS_KEY] as SetShopStatus | undefined) ?? null;
  if (!status) return null;
  // Daily Pack status resets at 07:00 UTC: drop it once a reset passed since the scan.
  const lastReset = lastShopDailyResetMs(Date.now());
  return status.scannedAt < lastReset ? { ...status, dailyPackClaimed: null } : status;
}

export async function scanShopStatusFromOpenTab(): Promise<SetShopStatus> {
  if (!chrome.scripting) throw new Error("Reload the extension to grant the page-reading permission.");
  const tabs = await chrome.tabs.query({
    url: ["https://sorare.com/nba/series/*", "https://sorare.com/*/nba/series/*"],
  });
  const tab =
    tabs.find((t) => t.active && t.url && /\/series\/(play|market)/i.test(t.url)) ??
    tabs.find((t) => t.url && /\/series\/play/i.test(t.url)) ??
    tabs.find((t) => t.url && /\/series\/market/i.test(t.url)) ??
    tabs[0];
  if (!tab?.id) throw new Error("Open Set Daily Solo (sorare.com/nba/series/play) or Set Shop in a tab, then scan again.");
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: readShopStatusFromPage });
  const data = result?.result as SetShopStatus | { error: string } | undefined;
  if (!data) throw new Error("Could not read the Shop page.");
  if ("error" in data) throw new Error(data.error);
  const existing = await getSavedShopStatus().catch(() => null);
  const merged = mergeShopStatus(existing, data, data.scannedAt);
  await chrome.storage.local.set({ [SHOP_STATUS_KEY]: merged });
  await readPacksTab(tab.id).catch(() => undefined);
  return merged;
}

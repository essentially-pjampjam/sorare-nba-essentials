import type { GalleryCard } from "../shared/types";

const SEALED_OVERRIDES_KEY = "card_sealed_overrides_v1";

type SealedOverrides = Record<string, { sealed: boolean; at: number }>;

/** Runs in a sorare.com page (MAIN world): card slug -> sealed, for the NBA cards Sorare loaded. Self-contained. */
function readSealedStatesFromPage(): Record<string, boolean> {
  const client = (window as unknown as { __APOLLO_CLIENT__?: { cache: { extract: () => Record<string, Record<string, unknown>> } } })
    .__APOLLO_CLIENT__;
  if (!client) return {};
  const out: Record<string, boolean> = {};
  for (const card of Object.values(client.cache.extract())) {
    if (card && typeof card.slug === "string" && typeof card.sealed === "boolean" && String(card.__typename ?? "").endsWith("Card")) {
      out[card.slug] = card.sealed;
    }
  }
  return out;
}

async function loadOverrides(): Promise<SealedOverrides> {
  const stored = await chrome.storage.local.get(SEALED_OVERRIDES_KEY);
  return (stored[SEALED_OVERRIDES_KEY] as SealedOverrides | undefined) ?? {};
}

async function readTab(tabId: number): Promise<void> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readSealedStatesFromPage });
  const states = (result?.result as Record<string, boolean> | undefined) ?? {};
  const slugs = Object.keys(states);
  if (slugs.length === 0) return;
  const overrides = await loadOverrides();
  const now = Date.now();
  for (const slug of slugs) overrides[slug] = { sealed: states[slug], at: now };
  // Keep the newest 2,000 entries.
  const trimmed = Object.fromEntries(
    Object.entries(overrides)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 2000),
  );
  await chrome.storage.local.set({ [SEALED_OVERRIDES_KEY]: trimmed });
}

/** Reads sealed states from every open sorare.com NBA tab (before serving cached gallery data). */
export async function syncSealedStatesFromOpenTabs(): Promise<void> {
  if (!chrome.scripting || !chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({ url: ["https://sorare.com/nba/*"] }).catch(() => []);
  await Promise.all(tabs.map((t) => (t.id ? readTab(t.id).catch(() => undefined) : undefined)));
}

/** Cards sealed / unsealed on sorare.com after the gallery was fetched get their live state. */
export async function applySealedOverrides(cards: GalleryCard[], fetchedAt: number): Promise<GalleryCard[]> {
  const overrides = await loadOverrides();
  return cards.map((c) => {
    const o = overrides[c.slug];
    return o && o.at > fetchedAt && o.sealed !== Boolean(c.sealed) ? { ...c, sealed: o.sealed } : c;
  });
}

/** Re-reads sealed states whenever a Sorare NBA page loads or navigates. */
export function watchSealedStates(): void {
  if (!chrome.tabs?.onUpdated || !chrome.scripting) return;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.url || !tab.url.startsWith("https://sorare.com/nba")) return;
    if (info.status !== "complete" && !info.url) return;
    setTimeout(() => void readTab(tabId).catch(() => undefined), 3000);
  });
}

import type {
  BackgroundRequest,
  BackgroundResponse,
  BargainMode,
  BargainsResult,
  CraftPoolResult,
  Currency,
  CurrentLineupEntry,
  EssenceBalances,
  GalleryResult,
  Rarity,
  ScanProgress,
  ScanResult,
  UserSettings,
  WalletBalanceInfo,
  WatchlistAlert,
} from "../shared/types";

export async function sendBackground<T>(
  request: BackgroundRequest,
): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as BackgroundResponse<T> | undefined;

  if (!response) {
    throw new Error("Background worker did not respond.");
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data;
}

export function getSettings(): Promise<UserSettings> {
  return sendBackground<UserSettings>({ type: "GET_SETTINGS" });
}

export function saveSettings(
  settings: Partial<UserSettings>,
): Promise<UserSettings> {
  return sendBackground<UserSettings>({ type: "SAVE_SETTINGS", settings });
}

export function getDetectedUsername(): Promise<string | null> {
  return sendBackground<string | null>({ type: "GET_DETECTED_USERNAME" });
}

export function scanCollections(
  username: string,
  rarity: Rarity,
  currency: Currency,
  inSeasonOnly: boolean,
  forceRefresh = false,
  cacheOnly = false,
): Promise<ScanResult | null> {
  return sendBackground<ScanResult | null>({
    type: "SCAN_COLLECTIONS",
    username,
    rarity,
    currency,
    inSeasonOnly,
    forceRefresh,
    cacheOnly,
  });
}

export function priceCollection(
  username: string,
  collectionSlug: string,
  rarity: Rarity,
  currency: Currency,
  inSeasonOnly: boolean,
): Promise<ScanResult | null> {
  return sendBackground<ScanResult | null>({
    type: "PRICE_COLLECTION",
    username,
    collectionSlug,
    rarity,
    currency,
    inSeasonOnly,
  });
}

export function priceTopCollections(
  username: string,
  collectionSlugs: string[],
  rarity: Rarity,
  currency: Currency,
  inSeasonOnly: boolean,
): Promise<ScanResult | null> {
  return sendBackground<ScanResult | null>({
    type: "PRICE_TOP_COLLECTIONS",
    username,
    collectionSlugs,
    rarity,
    currency,
    inSeasonOnly,
  });
}

export function fetchCraftPool(
  rarity: Rarity,
  currency: Currency,
  forceRefresh = false,
): Promise<CraftPoolResult> {
  return sendBackground<CraftPoolResult>({
    type: "FETCH_CRAFT_POOL",
    rarity,
    currency,
    forceRefresh,
  });
}

export function priceCraftCandidates(
  rarity: Rarity,
  currency: Currency,
  playerSlugs: string[],
): Promise<CraftPoolResult | null> {
  return sendBackground<CraftPoolResult | null>({
    type: "PRICE_CRAFT_CANDIDATES",
    rarity,
    currency,
    playerSlugs,
  });
}

export function fetchGalleryForLineups(
  username: string,
  forceRefresh = false,
  cacheOnly = false,
): Promise<GalleryResult | null> {
  return sendBackground<GalleryResult | null>({
    type: "FETCH_GALLERY_FOR_LINEUPS",
    username,
    forceRefresh,
    cacheOnly,
  });
}

export function priceGalleryCards(
  username: string,
  rarity: Rarity,
  currency: Currency,
): Promise<GalleryResult> {
  return sendBackground<GalleryResult>({
    type: "PRICE_GALLERY_CARDS",
    username,
    rarity,
    currency,
  });
}

export function openDashboardTab(
  targetTab?: "collections" | "craft" | "lineups" | "bargains" | "gallery",
): Promise<boolean> {
  return sendBackground<boolean>({
    type: "OPEN_DASHBOARD_TAB",
    targetTab,
  });
}

export function fetchBargains(
  rarity: Rarity,
  mode: BargainMode,
  currency: Currency,
  forceRefresh = false,
  cacheOnly = false,
): Promise<BargainsResult | null> {
  return sendBackground<BargainsResult | null>({
    type: "FETCH_BARGAINS",
    rarity,
    mode,
    currency,
    forceRefresh,
    cacheOnly,
  });
}

export function applyLineupHighlight(
  playerNames: string[],
  formatLabel: string,
  projectedTotal: number,
  slots?: Array<{
    slotLabel: string;
    cardSlug: string;
    playerName: string;
    rarity: import("../shared/types").CardRarity;
    seasonYear: number;
    isCaptain: boolean;
  }>,
): Promise<boolean> {
  return sendBackground<boolean>({
    type: "APPLY_LINEUP_HIGHLIGHT",
    playerNames,
    formatLabel,
    projectedTotal,
    slots,
  });
}

export function cancelScan(): Promise<boolean> {
  return sendBackground<boolean>({ type: "CANCEL_SCAN" });
}

export function reloadExtension(): Promise<boolean> {
  return sendBackground<boolean>({ type: "RELOAD_EXTENSION" });
}

export function openInActiveTab(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const isSorare =
      parsed.hostname === "sorare.com" || parsed.hostname.endsWith(".sorare.com");
    const isProjectGitHub =
      parsed.hostname === "github.com" &&
      parsed.pathname.toLowerCase().startsWith("/essentially-pjampjam/");
    if (parsed.protocol !== "https:" || (!isSorare && !isProjectGitHub)) {
      return Promise.reject(new Error("Blocked disallowed navigation target."));
    }
  } catch {
    return Promise.reject(new Error("Invalid navigation URL."));
  }
  return sendBackground<boolean>({ type: "OPEN_URL_IN_ACTIVE_TAB", url });
}

export function clearCache(): Promise<boolean> {
  return sendBackground<boolean>({ type: "CLEAR_CACHE" });
}

export function runWatchlistCheck(): Promise<WatchlistAlert[]> {
  return sendBackground<WatchlistAlert[]>({ type: "RUN_WATCHLIST_CHECK" });
}

export function clearWatchlistAlerts(): Promise<boolean> {
  return sendBackground<boolean>({ type: "CLEAR_WATCHLIST_ALERTS" });
}

/**
 * Keeps a persistent port to the MV3 background service worker while the Side Panel
 * is open and delivers progressive Stage 1, progress, and tab-switch events.
 */
export function connectProgressPort(
  onProgress: (progress: ScanProgress) => void,
  onPartialResult?: (result: ScanResult) => void,
  onSwitchTab?: (
    tab: "collections" | "craft" | "lineups" | "bargains" | "gallery",
  ) => void,
  onEssenceUpdated?: (balances: EssenceBalances) => void,
  onWalletUpdated?: (wallet: WalletBalanceInfo) => void,
  onWatchlistAlerts?: (alerts: WatchlistAlert[]) => void,
  onLineupsUpdated?: (lineups: CurrentLineupEntry[]) => void,
): () => void {
  let activePort: chrome.runtime.Port | null = null;
  let disposed = false;
  let reconnectTimer: number | null = null;

  const listener = (msg: {
    type?: string;
    progress?: ScanProgress;
    result?: ScanResult;
    tab?: "collections" | "craft" | "lineups" | "bargains" | "gallery";
    essenceByRarity?: EssenceBalances;
    walletBalance?: WalletBalanceInfo;
    alerts?: WatchlistAlert[];
    lineups?: CurrentLineupEntry[];
  }) => {
    if (msg.type === "SCAN_PROGRESS" && msg.progress) {
      onProgress(msg.progress);
    } else if (
      msg.type === "SCAN_PARTIAL_RESULT" &&
      msg.result &&
      onPartialResult
    ) {
      onPartialResult(msg.result);
    } else if (msg.type === "SWITCH_TAB" && msg.tab && onSwitchTab) {
      onSwitchTab(msg.tab);
    } else if (
      msg.type === "ESSENCE_UPDATED" &&
      msg.essenceByRarity &&
      onEssenceUpdated
    ) {
      onEssenceUpdated(msg.essenceByRarity);
    } else if (
      msg.type === "WALLET_UPDATED" &&
      msg.walletBalance &&
      onWalletUpdated
    ) {
      onWalletUpdated(msg.walletBalance);
    } else if (
      msg.type === "WATCHLIST_ALERTS_UPDATED" &&
      Array.isArray(msg.alerts) &&
      onWatchlistAlerts
    ) {
      onWatchlistAlerts(msg.alerts);
    } else if (
      msg.type === "DETECTED_LINEUPS_UPDATED" &&
      Array.isArray(msg.lineups) &&
      onLineupsUpdated
    ) {
      onLineupsUpdated(msg.lineups);
    }
  };

  const connect = () => {
    if (disposed) return;
    try {
      const port = chrome.runtime.connect({ name: "jamassist-sidepanel" });
      activePort = port;
      port.onMessage.addListener(listener);
      port.onDisconnect.addListener(() => {
        port.onMessage.removeListener(listener);
        activePort = null;
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 1000);
        }
      });
    } catch {
      if (!disposed) {
        reconnectTimer = window.setTimeout(connect, 1500);
      }
    }
  };

  connect();
  return () => {
    disposed = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    if (activePort) {
      activePort.onMessage.removeListener(listener);
      activePort.disconnect();
      activePort = null;
    }
  };
}

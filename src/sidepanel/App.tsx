import { mergeApiAndDomLineups } from "../shared/domLineupMerge";
import {
  AlertCircle,
  BookOpen,
  Zap,
  Heart,
  KeyRound,
  Layers,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  TrendingDown,
  Trophy,
  UserCheck,
  Wallet,
  Wand2,
  X,
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeCollections } from "../calculators/collectionEssenceMath";
import { normalizeSavedRosters, setCardTagInMap } from "../calculators/cardTagsMath";
import {
  DEFAULT_SETTINGS,
  RARITIES,
  RARITY_META,
  RESERVED_USER_SLUGS,
} from "../shared/constants";
import type {
  BargainListing,
  BargainMode,
  BargainsResult,
  CardOwnershipRecord,
  CardTag,
  CraftPoolResult,
  Currency,
  EssenceMilestoneRule,
  GalleryResult,
  PortfolioPnlResult,
  ProProgressRecord,
  ProjectionSource,
  Rarity,
  SavedRosterPreset,
  ScanProgress,
  ScanResult,
  UpdateCheckState,
  UserSettings,
} from "../shared/types";
import {
  cancelScan,
  clearCache,
  clearWatchlistAlerts,
  connectProgressPort,
  dismissUpdate,
  fetchBargains,
  fetchCraftPool,
  fetchGalleryForLineups,
  getDetectedUsername,
  getProProgressHistory,
  getSetPackAdvisor,
  getSettings,
  getUpdateStatus,
  openDashboardTab,
  openInActiveTab,
  priceCollection,
  priceCraftCandidates,
  priceGalleryCards,
  priceTopCollections,
  reloadExtension,
  runWatchlistCheck,
  saveSettings,
  scanCollections,
} from "./api";
import { LoadingStage } from "./components/LoadingStage";
import { SupportModal } from "./components/SupportModal";
import { EssenceTubeBar } from "./components/EssenceTubeBar";
import { TierEditorModal } from "./components/TierEditorModal";
import { CollectionsTab } from "./tabs/CollectionsTab";
import { formatRelativeAge } from "./utils/format";

const BargainsTab = lazy(() =>
  import("./tabs/BargainsTab").then((m) => ({ default: m.BargainsTab })),
);
const CraftTab = lazy(() =>
  import("./tabs/CraftTab").then((m) => ({ default: m.CraftTab })),
);
const GalleryTab = lazy(() =>
  import("./tabs/GalleryTab").then((m) => ({ default: m.GalleryTab })),
);
const LineupsTab = lazy(() =>
  import("./tabs/LineupsTab").then((m) => ({ default: m.LineupsTab })),
);

const CommandPaletteModal = lazy(() =>
  import("./components/CommandPaletteModal").then((m) => ({ default: m.CommandPaletteModal })),
);
const GuidesModal = lazy(() =>
  import("./components/GuidesModal").then((m) => ({ default: m.GuidesModal })),
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);
const WhatsNewModal = lazy(() =>
  import("./components/WhatsNewModal").then((m) => ({ default: m.WhatsNewModal })),
);
const WrappedModal = lazy(() =>
  import("./components/WrappedModal").then((m) => ({ default: m.WrappedModal })),
);

type ActiveTab = "collections" | "craft" | "lineups" | "bargains" | "gallery";

function getExtensionVersion(): string {
  try {
    // version_name carries the human build label (e.g. "2.6.7-exp.M1"); Chrome requires numeric `version`.
    const manifest = chrome.runtime.getManifest();
    return manifest.version_name ?? manifest.version;
  } catch {
    return "0.0.0";
  }
}

export function App() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [updateState, setUpdateState] = useState<UpdateCheckState | null>(null);
  const [showWrapped, setShowWrapped] = useState(false);
  const [wrappedHistory, setWrappedHistory] = useState<ProProgressRecord[]>([]);
  const [pnlRecords, setPnlRecords] = useState<CardOwnershipRecord[]>([]);
  const [usernameDraft, setUsernameDraft] = useState<string>("");
  const [detectedUsername, setDetectedUsername] = useState<string | null>(null);
  // Global Set | Pro mode (mirrors Sorare's own Set / Pro switch). Per-device convenience.
  const [playMode, setPlayMode] = useState<"pro" | "set">(() => {
    try {
      return localStorage.getItem("jamassist_play_mode") === "set" ? "set" : "pro";
    } catch {
      return "pro";
    }
  });
  const [activeTab, setActiveTab] = useState<ActiveTab>(() =>
    playMode === "set" ? "lineups" : "collections",
  );
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [craftPool, setCraftPool] = useState<CraftPoolResult | null>(null);
  const [galleryResult, setGalleryResult] = useState<GalleryResult | null>(
    null,
  );
  const [bargainsResult, setBargainsResult] = useState<BargainsResult | null>(
    null,
  );
  const [bargainPoolByKey, setBargainPoolByKey] = useState<
    Record<string, BargainsResult>
  >({});
  const [bargainMode, setBargainMode] = useState<BargainMode>("instant_value");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCollectionsInitialScan, setIsCollectionsInitialScan] =
    useState<boolean>(false);
  const [isCraftLoading, setIsCraftLoading] = useState<boolean>(false);
  const [isGalleryLoading, setIsGalleryLoading] = useState<boolean>(false);
  const [isPricingGallery, setIsPricingGallery] = useState<boolean>(false);
  const [isBargainsLoading, setIsBargainsLoading] = useState<boolean>(false);
  const [isWatchlistChecking, setIsWatchlistChecking] = useState<boolean>(false);
  const [isQuestDealsLoading, setIsQuestDealsLoading] =
    useState<boolean>(false);
  const [hasLoadedQuestDeals, setHasLoadedQuestDeals] =
    useState<boolean>(false);
  const [isCraftPricing, setIsCraftPricing] = useState<boolean>(false);
  const [pricingSlug, setPricingSlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showTierEditor, setShowTierEditor] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showSupport, setShowSupport] = useState<boolean>(false);
  const [showWhatsNew, setShowWhatsNew] = useState<boolean>(false);
  const [showGuides, setShowGuides] = useState<boolean>(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState<boolean>(false);
  const [setPackTarget, setSetPackTarget] = useState<{ label: string; price: number }>({
    label: "Bronze Pack",
    price: 1000,
  });
  const [setSubTabNav, setSetSubTabNav] = useState<{ tab: "daily" | "solo_squad" | "packs" | "overview"; seq: number } | null>(null);
  const selectPlayMode = (next: "pro" | "set") => {
    setPlayMode(next);
    try {
      localStorage.setItem("jamassist_play_mode", next);
    } catch {
      // per-device convenience only
    }
    // Collections, Craft and Deals are Pro-only (Limited and up).
    if (next === "set") setActiveTab((t) => (t === "collections" || t === "craft" || t === "bargains" ? "lineups" : t));
  };
  const navigateTab = (
    tab: ActiveTab,
    mode?: "pro" | "set",
    subTab?: "daily" | "packs" | "overview",
  ) => {
    if (mode === "pro" || mode === "set") {
      setPlayMode(mode);
      try {
        localStorage.setItem("jamassist_play_mode", mode);
      } catch {
        // per-device convenience only
      }
    } else if (tab === "collections" || tab === "craft" || tab === "bargains") {
      setPlayMode("pro");
      try {
        localStorage.setItem("jamassist_play_mode", "pro");
      } catch {
        // per-device convenience only
      }
    }
    if (subTab === "daily" || subTab === "packs" || subTab === "overview") {
      try {
        if (subTab === "overview") {
          localStorage.setItem("jamassist_lineups_pro_subtab", "overview");
        } else {
          localStorage.setItem("jamassist_lineups_set_subtab", subTab);
        }
      } catch {
        // ignore storage failure
      }
      setSetSubTabNav((prev) => ({ tab: subTab, seq: (prev?.seq ?? 0) + 1 }));
    }
    setActiveTab(tab);
  };
  const [initialized, setInitialized] = useState<boolean>(false);
  // The sticky header's height feeds --jam-header-h so the quick-jump bars stick right below it.
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty("--jam-header-h", `${Math.round(el.getBoundingClientRect().height)}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [initialized]);
  const [editingUsername, setEditingUsername] = useState<boolean>(false);
  const [hasUnseenWhatsNew, setHasUnseenWhatsNew] = useState<boolean>(() => {
    try {
      return (
        window.localStorage.getItem("jamassist_last_seen_version") !==
        getExtensionVersion()
      );
    } catch {
      return false;
    }
  });
  const [showCmdPalette, setShowCmdPalette] = useState<boolean>(false);
  const [focusApiKeyInSettings, setFocusApiKeyInSettings] =
    useState<boolean>(false);
  const scanResultRef = useRef<ScanResult | null>(null);
  scanResultRef.current = scanResult;

  const isDashboardMode = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("view") === "dashboard";
    } catch {
      return false;
    }
  }, []);

  const version = useMemo(() => getExtensionVersion(), []);
  // "2.7.4-exp1" -> red badge "v2.7.4·exp1" (kept on one line); stable builds stay amber.
  const isExperimentalBuild = /-exp/i.test(version);
  const versionBadgeLabel = isExperimentalBuild
    ? `v${version.replace(/-exp\.?/i, "·exp")}`
    : `v${version}`;
  const activeRarity = settings.selectedRarity;
  const activeEssence = settings.essenceByRarity[activeRarity] ?? 0;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCmdPalette((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runScan = useCallback(
    async (
      username: string,
      rarity: Rarity,
      currency: Currency,
      inSeasonOnly: boolean,
      forceRefresh = false,
      cacheOnly = false,
    ) => {
      const clean = username.trim().toLowerCase();
      if (!clean) return;
      if (!cacheOnly) {
        const current = scanResultRef.current;
        const hadMatching = Boolean(
          current &&
            current.rarity === rarity &&
            current.inSeasonOnly === inSeasonOnly,
        );
        setProgress(null);
        setIsCollectionsInitialScan(!hadMatching);
        setIsLoading(true);
        setError(null);
      }
      try {
        const res = await scanCollections(
          clean,
          rarity,
          currency,
          inSeasonOnly,
          forceRefresh,
          cacheOnly,
        );
        if (res) {
          setScanResult(res);
        } else if (cacheOnly) {
          setScanResult(null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes("cancelled")) {
          setError(msg);
        }
      } finally {
        if (!cacheOnly) {
          setIsLoading(false);
          setIsCollectionsInitialScan(false);
        }
      }
    },
    [],
  );

  const loadCraftPool = useCallback(
    async (rarity: Rarity, currency: Currency, forceRefresh = false) => {
      setProgress(null);
      setIsCraftLoading(true);
      setError(null);
      try {
        const res = await fetchCraftPool(rarity, currency, forceRefresh);
        setCraftPool(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes("cancelled")) {
          setError(msg);
        }
      } finally {
        setIsCraftLoading(false);
      }
    },
    [],
  );

  const loadGallery = useCallback(
    async (username: string, forceRefresh = false, cacheOnly = false) => {
      const clean = username.trim().toLowerCase();
      if (!clean) return;
      if (!cacheOnly) {
        setProgress(null);
        setIsGalleryLoading(true);
        setError(null);
      }
      try {
        const res = await fetchGalleryForLineups(
          clean,
          forceRefresh,
          cacheOnly,
        );
        if (res) {
          setGalleryResult(res);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes("cancelled")) {
          setError(msg);
        }
      } finally {
        if (!cacheOnly) {
          setIsGalleryLoading(false);
        }
      }
    },
    [],
  );

  const loadBargains = useCallback(
    async (
      rarity: Rarity,
      mode: BargainMode,
      currency: Currency,
      forceRefresh = false,
      cacheOnly = false,
    ) => {
      setBargainMode(mode);
      if (!cacheOnly) {
        setProgress(null);
        setIsBargainsLoading(true);
        setError(null);
      }
      try {
        const res = await fetchBargains(
          rarity,
          mode,
          currency,
          forceRefresh,
          cacheOnly,
        );
        if (res) {
          setBargainsResult(res);
          const poolKey = `${res.rarity}:${res.currency}:${res.mode}`;
          setBargainPoolByKey((prev) => ({ ...prev, [poolKey]: res }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes("cancelled")) {
          setError(msg);
        }
      } finally {
        if (!cacheOnly) {
          setIsBargainsLoading(false);
        }
      }
    },
    [],
  );

  const handleLoadQuestDeals = useCallback(async () => {
    setProgress(null);
    setIsQuestDealsLoading(true);
    setError(null);
    try {
      // Force fresh fetch in sequential calls so RateLimitQueue handles both cleanly under caps
      const primaryRes = await fetchBargains(
        activeRarity,
        "primary_instant",
        settings.currency,
        true,
        false,
      );
      if (primaryRes) {
        setBargainPoolByKey((prev) => ({
          ...prev,
          [`${primaryRes.rarity}:${primaryRes.currency}:${primaryRes.mode}`]:
            primaryRes,
        }));
      }
      const auctionRes = await fetchBargains(
        activeRarity,
        "ending_auctions",
        settings.currency,
        true,
        false,
      );
      if (auctionRes) {
        setBargainPoolByKey((prev) => ({
          ...prev,
          [`${auctionRes.rarity}:${auctionRes.currency}:${auctionRes.mode}`]:
            auctionRes,
        }));
      }

      const instantRes = await fetchBargains(
        activeRarity,
        "instant_value",
        settings.currency,
        true,
        false,
      );
      if (instantRes) {
        setBargainPoolByKey((prev) => ({
          ...prev,
          [`${instantRes.rarity}:${instantRes.currency}:${instantRes.mode}`]:
            instantRes,
        }));
      }

      if (scanResult && scanResult.rarity === activeRarity) {
        const closestInSeasonTeam = [...scanResult.collections]
          .filter((c) => !c.complete && c.inSeason && Boolean(c.teamSlug))
          .sort((a, b) => {
            const ra = a.slotsCount - a.fulfilledSlotsCount;
            const rb = b.slotsCount - b.fulfilledSlotsCount;
            if (ra !== rb) return ra - rb;
            return b.fulfilledSlotsCount - a.fulfilledSlotsCount;
          })[0];
        if (closestInSeasonTeam) {
          const pricedScan = await priceCollection(
            scanResult.username,
            closestInSeasonTeam.slug,
            scanResult.rarity,
            settings.currency,
            scanResult.inSeasonOnly,
          );
          if (pricedScan) {
            setScanResult(pricedScan);
          }
        }
      }
      setHasLoadedQuestDeals(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("cancelled")) {
        setError(msg);
      }
    } finally {
      setIsQuestDealsLoading(false);
    }
  }, [activeRarity, scanResult, settings.currency]);

  const allScannedBargains = useMemo(() => {
    const out: BargainListing[] = [];
    const seen = new Set<string>();
    const prefix = `${activeRarity}:${settings.currency}:`;
    for (const [key, res] of Object.entries(bargainPoolByKey)) {
      if (!key.startsWith(prefix)) continue;
      for (const item of res.listings) {
        const uniq = `${item.cardSlug}:${item.isPrimaryOffer ? "p" : item.saleType}`;
        if (!seen.has(uniq)) {
          seen.add(uniq);
          out.push(item);
        }
      }
    }
    return out;
  }, [activeRarity, bargainPoolByKey, settings.currency]);

  useEffect(() => {
    const disconnect = connectProgressPort(
      (nextProgress) => {
        setProgress(nextProgress);
      },
      (partial) => {
        setScanResult(partial);
      },
      (tab, mode, subTab) => {
        navigateTab(tab, mode, subTab);
      },
      (essenceByRarity, commonEssence) => {
        setSettings((prev) => ({
          ...prev,
          essenceByRarity,
          ...(typeof commonEssence === "number" ? { commonEssence } : {}),
        }));
      },
      (walletBalance) => {
        setSettings((prev) => ({
          ...prev,
          walletBalance,
        }));
      },
      (watchlistAlerts) => {
        setSettings((prev) => ({
          ...prev,
          watchlistAlerts,
        }));
      },
      (domLineups) => {
        setGalleryResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            currentLineups: mergeApiAndDomLineups(prev.currentLineups ?? [], domLineups, "live"),
          };
        });
      },
      (pageLineups) => {
        setGalleryResult((prev) =>
          prev && (!prev.username || prev.username === pageLineups.userSlug) ? { ...prev, pageLineups } : prev,
        );
      },
    );

    void getUpdateStatus()
      .then(setUpdateState)
      .catch(() => {});

    void (async () => {
      try {
        const [loaded, detected, pendingRaw] = await Promise.all([
          getSettings(),
          getDetectedUsername(),
          chrome.storage.local.get(["jamassist_pending_tab", "jamassist_pending_nav"]),
        ]);
        setSettings(loaded);
        const safeDetected =
          detected && !RESERVED_USER_SLUGS.has(detected.toLowerCase())
            ? detected
            : null;
        setDetectedUsername(safeDetected);
        const urlTab = new URLSearchParams(window.location.search).get("tab") as
          | ActiveTab
          | null;
        const pendingTab = pendingRaw?.jamassist_pending_tab as
          | ActiveTab
          | undefined;
        const pendingNav = pendingRaw?.jamassist_pending_nav as
          | {
              tab?: ActiveTab;
              mode?: "pro" | "set";
              subTab?: "daily" | "packs" | "overview";
            }
          | undefined;
        const resolvedTab = urlTab ?? pendingNav?.tab ?? pendingTab;
        if (
          resolvedTab === "craft" ||
          resolvedTab === "collections" ||
          resolvedTab === "lineups" ||
          resolvedTab === "bargains" ||
          resolvedTab === "gallery"
        ) {
          navigateTab(resolvedTab, pendingNav?.mode, pendingNav?.subTab);
          if (pendingTab || pendingNav) {
            void chrome.storage.local.remove(["jamassist_pending_tab", "jamassist_pending_nav"]);
          }
        }
        const initialUser = loaded.username || safeDetected || "";
        setUsernameDraft(initialUser);

        // Cache-only on startup so opening Side Panel never blasts Sorare with automatic API calls.
        // Wait briefly for local cache reads before showing the workspace so the UI never flashes empty.
        const cacheHydrationTasks: Promise<unknown>[] = [
          loadBargains(loaded.selectedRarity, "instant_value", loaded.currency, false, true),
        ];
        if (initialUser) {
          cacheHydrationTasks.push(
            runScan(
              initialUser,
              loaded.selectedRarity,
              loaded.currency,
              loaded.inSeasonOnly,
              false,
              true,
            ),
            loadGallery(initialUser, false, true),
          );
        }
        await Promise.race([
          Promise.allSettled(cacheHydrationTasks),
          new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
        ]);
        setInitialized(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setInitialized(true);
      }
    })();

    return disconnect;
  }, [runScan]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    if (playMode !== "set") return;
    let cancelled = false;
    getSetPackAdvisor()
      .then((advisor) => {
        if (cancelled) return;
        const essencePacks = (advisor?.packs ?? [])
          .filter((p) => p.currency === "COMMON_ESSENCE" && p.price > 0)
          .sort((a, b) => a.price - b.price);
        if (essencePacks.length > 0) {
          const cheapest = essencePacks[0];
          const label = /bronze/i.test(cheapest.title) ? "Bronze Pack" : cheapest.title;
          setSetPackTarget({ label, price: cheapest.price });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [playMode]);

  // Longevity auto-sync: quietly refresh stale live data (>15m old) when returning to the side panel
  useEffect(() => {
    const STALE_MS = 15 * 60_000;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const targetUser = (settings.username || detectedUsername || "").trim();
      if (!targetUser || isGalleryLoading || !galleryResult) return;
      if (Date.now() - galleryResult.fetchedAt >= STALE_MS) {
        void loadGallery(targetUser, false, false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [detectedUsername, galleryResult, isGalleryLoading, settings.username]);

  const updateSettings = useCallback(async (patch: Partial<UserSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...patch,
      essenceByRarity: {
        ...prev.essenceByRarity,
        ...(patch.essenceByRarity ?? {}),
      },
      milestoneRulesByRarity: {
        ...prev.milestoneRulesByRarity,
        ...(patch.milestoneRulesByRarity ?? {}),
      },
    }));
    const saved = await saveSettings(patch);
    setSettings(saved);
    return saved;
  }, []);

  const handleSubmitUsername = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = usernameDraft.trim().toLowerCase();
    if (!clean) {
      setError("Please enter a Sorare username or slug.");
      return;
    }
    await updateSettings({ username: clean, usernameLockedByUser: true });
    await runScan(
      clean,
      activeRarity,
      settings.currency,
      settings.inSeasonOnly,
      false,
      false,
    );
  };

  const handleUseDetected = async () => {
    if (!detectedUsername) return;
    setUsernameDraft(detectedUsername);
    await updateSettings({
      username: detectedUsername,
      usernameLockedByUser: true,
    });
    await runScan(
      detectedUsername,
      activeRarity,
      settings.currency,
      settings.inSeasonOnly,
      false,
      true,
    );
  };

  const handleSelectRarity = async (rarity: Rarity) => {
    setHasLoadedQuestDeals(false);
    await updateSettings({ selectedRarity: rarity });
    const targetUser = (settings.username || usernameDraft).trim();
    if (activeTab === "collections" && targetUser) {
      // Load from cache automatically; click Scan/Refresh if not cached yet
      await runScan(
        targetUser,
        rarity,
        settings.currency,
        settings.inSeasonOnly,
        false,
        true,
      );
    }
  };

  const handleToggleCurrency = async () => {
    setHasLoadedQuestDeals(false);
    const nextCurrency: Currency = settings.currency === "USD" ? "EUR" : "USD";
    await updateSettings({ currency: nextCurrency });
    const targetUser = (settings.username || usernameDraft).trim();
    if (activeTab === "collections" && targetUser) {
      await runScan(
        targetUser,
        activeRarity,
        nextCurrency,
        settings.inSeasonOnly,
        false,
        true,
      );
    } else if (activeTab === "craft" && craftPool) {
      await loadCraftPool(activeRarity, nextCurrency, false);
    } else if (activeTab === "bargains" && bargainsResult) {
      await loadBargains(activeRarity, bargainMode, nextCurrency, false, true);
    }
  };

  const handleToggleInSeasonOnly = async () => {
    const nextScope = !settings.inSeasonOnly;
    await updateSettings({ inSeasonOnly: nextScope });
    const targetUser = (settings.username || usernameDraft).trim();
    if (targetUser) {
      await runScan(
        targetUser,
        activeRarity,
        settings.currency,
        nextScope,
        false,
        false,
      );
    }
  };

  const handlePriceCollection = async (collectionSlug: string) => {
    if (!scanResult || pricingSlug) return;
    setPricingSlug(collectionSlug);
    setError(null);
    try {
      const updated = await priceCollection(
        scanResult.username,
        collectionSlug,
        scanResult.rarity,
        settings.currency,
        scanResult.inSeasonOnly,
      );
      if (updated) {
        setScanResult(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPricingSlug(null);
    }
  };

  const handlePriceTopCollections = async (collectionSlugs: string[]) => {
    if (!scanResult || pricingSlug || collectionSlugs.length === 0) return;
    setPricingSlug("__batch__");
    setError(null);
    try {
      const updated = await priceTopCollections(
        scanResult.username,
        collectionSlugs,
        scanResult.rarity,
        settings.currency,
        scanResult.inSeasonOnly,
      );
      if (updated) {
        setScanResult(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPricingSlug(null);
    }
  };

  const handlePriceCraftCandidates = async (playerSlugs: string[]) => {
    if (isCraftPricing || playerSlugs.length === 0) return;
    setIsCraftPricing(true);
    setError(null);
    try {
      const updated = await priceCraftCandidates(
        activeRarity,
        settings.currency,
        playerSlugs,
      );
      if (updated) {
        setCraftPool(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCraftPricing(false);
    }
  };

  const handleCancelScan = async () => {
    await cancelScan();
    setProgress(null);
    setIsLoading(false);
    setIsCollectionsInitialScan(false);
    setIsCraftLoading(false);
    setIsGalleryLoading(false);
    setIsBargainsLoading(false);
    setIsWatchlistChecking(false);
    setIsQuestDealsLoading(false);
    setPricingSlug(null);
  };

  const handleRefreshActiveTab = () => {
    if (activeTab === "craft") {
      void loadCraftPool(activeRarity, settings.currency, true);
      return;
    }
    if (activeTab === "bargains") {
      void loadBargains(activeRarity, bargainMode, settings.currency, true, false);
      return;
    }
    const targetUser = (settings.username || usernameDraft).trim();
    if (activeTab === "lineups" || activeTab === "gallery") {
      if (targetUser) void loadGallery(targetUser, true, false);
      return;
    }
    if (targetUser) {
      void runScan(
        targetUser,
        activeRarity,
        settings.currency,
        settings.inSeasonOnly,
        true,
        false,
      );
    }
  };

  const handlePriceGallery = useCallback(async () => {
    const targetUser = (settings.username || usernameDraft).trim().toLowerCase();
    if (!targetUser) return;
    setIsPricingGallery(true);
    setError(null);
    try {
      const updated = await priceGalleryCards(
        targetUser,
        activeRarity,
        settings.currency,
      );
      setGalleryResult(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("cancelled")) {
        setError(msg);
      }
    } finally {
      setIsPricingGallery(false);
    }
  }, [activeRarity, settings.currency, settings.username, usernameDraft]);

  const essenceTimerRef = useRef<number | null>(null);
  const commonEssenceTimerRef = useRef<number | null>(null);
  const latestEssenceRef = useRef(settings.essenceByRarity);
  latestEssenceRef.current = settings.essenceByRarity;

  useEffect(() => {
    return () => {
      if (essenceTimerRef.current !== null) window.clearTimeout(essenceTimerRef.current);
      if (commonEssenceTimerRef.current !== null) window.clearTimeout(commonEssenceTimerRef.current);
    };
  }, []);

  const handleEssenceChange = (val: string) => {
    const parsed = Math.max(0, Math.min(50000, Math.floor(Number(val) || 0)));
    const targetRarity = activeRarity;
    setSettings((prev) => {
      const nextMap = {
        ...prev.essenceByRarity,
        [targetRarity]: parsed,
      };
      latestEssenceRef.current = nextMap;
      return {
        ...prev,
        essenceByRarity: nextMap,
      };
    });
    if (essenceTimerRef.current !== null) {
      window.clearTimeout(essenceTimerRef.current);
    }
    essenceTimerRef.current = window.setTimeout(() => {
      essenceTimerRef.current = null;
      void saveSettings({
        essenceByRarity: {
          ...latestEssenceRef.current,
          [targetRarity]: parsed,
        },
      }).catch(() => {});
    }, 250);
  };

  const handleCommonEssenceChange = (val: string) => {
    const trimmed = val.trim();
    const parsed = trimmed === "" ? 0 : Math.max(0, Math.min(50000, Math.floor(Number(trimmed) || 0)));
    setSettings((prev) => ({
      ...prev,
      commonEssence: parsed,
    }));
    if (commonEssenceTimerRef.current !== null) {
      window.clearTimeout(commonEssenceTimerRef.current);
    }
    commonEssenceTimerRef.current = window.setTimeout(() => {
      commonEssenceTimerRef.current = null;
      void saveSettings({ commonEssence: parsed }).catch(() => {});
    }, 250);
  };

  const handleSaveTiers = (rules: EssenceMilestoneRule[]) => {
    void updateSettings({
      milestoneRulesByRarity: {
        ...settings.milestoneRulesByRarity,
        [activeRarity]: rules,
      },
    });
  };

  const collectionNeedSlugs = useMemo(() => {
    const set = new Set<string>();
    if (!scanResult) return set;
    for (const slots of Object.values(scanResult.missingSlotsByCollection)) {
      for (const s of slots) {
        set.add(s.playerSlug);
      }
    }
    return set;
  }, [scanResult]);

  const analysis = useMemo(() => {
    if (!scanResult || scanResult.rarity !== activeRarity) {
      return {
        analyses: [],
        summary: {
          totalEssenceEarnable: 0,
          cheapestNextMilestone: null,
          bestEfficiencyPick: null,
          craftReadyMatches: [],
          remainingEssenceGap: Math.max(
            0,
            settings.craftThreshold - activeEssence,
          ),
        },
      };
    }

    return analyzeCollections({
      collections: scanResult.collections,
      missingSlotsByCollection: scanResult.missingSlotsByCollection,
      marketPrices: scanResult.marketPrices,
      milestoneRules: settings.milestoneRulesByRarity[activeRarity] ?? [],
      currentEssenceBalance: activeEssence,
      craftThreshold: settings.craftThreshold,
      milestoneSource: "preset",
    });
  }, [
    activeEssence,
    activeRarity,
    scanResult,
    settings.craftThreshold,
    settings.milestoneRulesByRarity,
  ]);

  const essencePct = Math.min(
    100,
    Math.round((activeEssence / settings.craftThreshold) * 100),
  );
  const essenceGap = Math.max(0, settings.craftThreshold - activeEssence);
  const craftReadyCount =
    settings.craftThreshold > 0 ? Math.floor(activeEssence / settings.craftThreshold) : 0;
  const commonEssenceVal = typeof settings.commonEssence === "number" ? settings.commonEssence : 0;
  const setEssencePct = Math.min(
    100,
    Math.round((commonEssenceVal / Math.max(1, setPackTarget.price)) * 100),
  );
  const setEssenceGap = Math.max(0, setPackTarget.price - commonEssenceVal);
  const setPackReadyCount =
    setPackTarget.price > 0 ? Math.floor(commonEssenceVal / setPackTarget.price) : 0;
  const isSetBar = playMode === "set";
  const barAmount = isSetBar ? commonEssenceVal : activeEssence;
  const barPct = isSetBar ? setEssencePct : essencePct;
  const barRarity: Rarity | "set" = isSetBar ? "set" : activeRarity;
  const barReady = isSetBar ? setEssenceGap === 0 : essenceGap === 0;
  const anyLoading =
    isLoading ||
    isCraftLoading ||
    isGalleryLoading ||
    isPricingGallery ||
    isBargainsLoading ||
    isWatchlistChecking ||
    isQuestDealsLoading;

  const hasCollectionsData = Boolean(
    scanResult &&
      scanResult.rarity === activeRarity &&
      scanResult.inSeasonOnly === settings.inSeasonOnly,
  );
  const hasCraftData = Boolean(
    craftPool && craftPool.rarity === activeRarity && craftPool.currency === settings.currency,
  );
  const hasLineupsOrGalleryData = Boolean(galleryResult);
  const hasBargainsData = Boolean(
    bargainsResult &&
      bargainsResult.rarity === activeRarity &&
      bargainsResult.currency === settings.currency,
  );

  const isActiveTabInitialLoading =
    !initialized ||
    (activeTab === "collections" &&
      isLoading &&
      (isCollectionsInitialScan || !hasCollectionsData)) ||
    (activeTab === "craft" && isCraftLoading && !hasCraftData) ||
    (activeTab === "lineups" && isGalleryLoading && !hasLineupsOrGalleryData) ||
    (activeTab === "bargains" && isBargainsLoading && !hasBargainsData) ||
    (activeTab === "gallery" && isGalleryLoading && !hasLineupsOrGalleryData);

  const loadingStageMeta = useMemo(() => {
    if (!initialized) {
      return {
        title: "Loading Sorare NBA Essentials",
        subtitle: "Restoring cached workspace & settings...",
      };
    }
    const rarityLabel = RARITY_META[activeRarity].label;
    if (activeTab === "collections") {
      return {
        title: `Scanning ${rarityLabel} Collections`,
        subtitle: "Loading collections, League Quests & market floors...",
      };
    }
    if (activeTab === "craft") {
      return {
        title: `Loading ${rarityLabel} Craft Pool`,
        subtitle: "Fetching craft candidates & clue probabilities...",
      };
    }
    if (activeTab === "bargains") {
      return {
        title: `Scanning ${rarityLabel} Market Deals`,
        subtitle: "Fetching live instant buys & ending auctions...",
      };
    }
    if (activeTab === "gallery") {
      return {
        title: playMode === "set" ? "Loading Set Gallery" : `Loading ${rarityLabel} Gallery`,
        subtitle: "Fetching cards, sealed state & season stats...",
      };
    }
    return {
      title: playMode === "set" ? "Loading Set Lineups" : `Loading ${rarityLabel} Lineups`,
      subtitle: "Fetching cards, NBA schedule, Vegas odds & injuries...",
    };
  }, [activeRarity, activeTab, initialized, playMode]);

  const progressAccentRarity: Rarity | "set" = playMode === "set" ? "set" : activeRarity;

  return (
    <div
      className="jam-canvas min-h-screen text-slate-100"
      data-theme={settings.theme}
      data-density={settings.density ?? "cozy"}
    >
      <div className={isDashboardMode ? "jam-dashboard-mode" : ""}>
      <div ref={stickyHeaderRef} className="jam-sticky-wrap sticky top-0 z-30 px-2.5 pb-1 pt-2">
        <header className="glass-chrome rounded-2xl px-2.5 py-2">
          <h1 className="sr-only">pjampjam&apos;s Sorare NBA Essentials</h1>
          {/* Row 1: username (left), Fast Mode bolt, Refresh, Guides, overflow menu */}
          <div className="flex items-center gap-1.5">
            {isDashboardMode && (
              <span className="jam-logo-badge flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                <img src="/logo.png" alt="pjampjam's Sorare NBA Essentials" className="h-full w-full object-contain" />
              </span>
            )}

            <div className="min-w-0 flex-1">
              {settings.username && !editingUsername ? (
                <button
                  type="button"
                  onClick={() => setEditingUsername(true)}
                  className="glass-pill inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold text-slate-100 hover:border-sky-400/50"
                  title="Change the Sorare manager"
                >
                  <span className="truncate">@{settings.username}</span>
                  <Pencil className="h-2.5 w-2.5 shrink-0 text-slate-400" />
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    void handleSubmitUsername(e);
                    setEditingUsername(false);
                  }}
                  className="flex items-center gap-1"
                >
                  <input
                    type="text"
                    value={usernameDraft}
                    onChange={(e) => setUsernameDraft(e.target.value)}
                    placeholder="Sorare username..."
                    aria-label="Sorare username or slug"
                    autoFocus={editingUsername}
                    className="glass-pill h-7 w-full min-w-0 rounded-lg px-2.5 text-[11px] text-slate-100 placeholder-slate-500 focus:border-sky-400/70 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={anyLoading || !usernameDraft.trim()}
                    className="glass-pill h-7 shrink-0 rounded-lg px-2.5 text-[11px] font-semibold text-slate-100 transition hover:border-sky-400/50 disabled:opacity-50"
                  >
                    Scan
                  </button>
                </form>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                settings.sorareApiKey
                  ? "border-sky-400/45 bg-sky-500/18 text-sky-300 hover:border-sky-300/70 hover:bg-sky-500/28"
                  : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
              title={
                settings.sorareApiKey
                  ? "Fast Mode: your Sorare API key is active (click for Settings)"
                  : "Public mode, no API key: click to add one in Settings for faster, fuller data"
              }
              aria-label={settings.sorareApiKey ? "Fast Mode active, open Settings" : "No API key, open Settings to add one"}
            >
              <Zap className="h-3.5 w-3.5" fill={settings.sorareApiKey ? "currentColor" : "none"} />
            </button>

            <button
              type="button"
              disabled={
                anyLoading ||
                ((activeTab === "collections" || activeTab === "lineups" || activeTab === "gallery") &&
                  !(settings.username || usernameDraft).trim())
              }
              onClick={handleRefreshActiveTab}
              className="jam-btn-primary inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              title="Fetch fresh live data"
            >
              <RefreshCw className={`h-3 w-3 ${anyLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>

            <button
              type="button"
              onClick={() => setShowGuides(true)}
              className="glass-pill flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sky-300 transition hover:border-sky-400/50 hover:text-sky-100"
              title="Guides & Strategy Hub (Scoring Calculator, Caps, Vault, Pre-Lock)"
              aria-label="Open Guides & Strategy Hub"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </button>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowHeaderMenu((v) => !v)}
                className="glass-pill relative flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:border-sky-400/50 hover:text-slate-100"
                title="Search, currency, support, pop-out, settings, What's New"
                aria-label="More options"
                aria-expanded={showHeaderMenu}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                {hasUnseenWhatsNew && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
              {showHeaderMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowHeaderMenu(false)} />
                  <div
                    className="glass-chrome absolute right-0 top-full z-50 mt-1 w-48 rounded-xl p-1 text-[11px] text-slate-200"
                    onClick={() => setShowHeaderMenu(false)}
                  >
                    <button type="button" onClick={() => setShowCmdPalette(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/8">
                      <Search className="h-3.5 w-3.5 text-slate-400" /> Search <span className="ml-auto text-[10px] text-slate-500">Ctrl+K</span>
                    </button>
                    <button type="button" onClick={() => void handleToggleCurrency()} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/8">
                      <Wallet className="h-3.5 w-3.5 text-slate-400" /> Currency <span className="ml-auto font-semibold">{settings.currency}</span>
                    </button>
                    {!isDashboardMode && (
                      <button type="button" onClick={() => void openDashboardTab(activeTab)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/8">
                        <Maximize2 className="h-3.5 w-3.5 text-slate-400" /> Pop out dashboard
                      </button>
                    )}
                    <button type="button" onClick={() => setShowSupport(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/8">
                      <Heart className="h-3.5 w-3.5 text-amber-400" /> Support
                    </button>
                    <button type="button" onClick={() => setShowSettings(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/8">
                      <Settings className="h-3.5 w-3.5 text-slate-400" /> Settings &amp; themes
                    </button>
                    <div className="my-1 border-t border-white/8" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowWhatsNew(true);
                        setHasUnseenWhatsNew(false);
                        try {
                          window.localStorage.setItem("jamassist_last_seen_version", version);
                        } catch {
                          // Ignore
                        }
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/8"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                      <span>What&apos;s New</span>
                      <span
                        className={`ml-auto inline-flex items-center gap-1 rounded px-1 py-px font-mono text-[9.5px] font-medium ${
                          isExperimentalBuild
                            ? "border border-rose-400/50 bg-rose-500/15 text-rose-300"
                            : "bg-white/8 text-amber-300"
                        }`}
                      >
                        {versionBadgeLabel}
                        {hasUnseenWhatsNew && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Auto-detected sorare.com username pill */}
          {detectedUsername &&
            !RESERVED_USER_SLUGS.has(detectedUsername.toLowerCase()) &&
            detectedUsername.toLowerCase() !== (settings.username || "").toLowerCase() && (
              <div className="mt-1.5 flex items-center justify-between rounded-xl border border-sky-400/30 bg-sky-500/12 px-2.5 py-1 text-[11px] text-sky-100">
                <span className="flex items-center gap-1">
                  <UserCheck className="h-3 w-3 text-sky-300" />
                  Detected on sorare.com: <strong className="font-semibold">@{detectedUsername}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => void handleUseDetected()}
                  className="rounded-lg bg-sky-400/25 px-2 py-0.5 text-[10px] font-semibold text-sky-50 hover:bg-sky-400/40"
                >
                  Use
                </button>
              </div>
            )}

          {/* Mode bar on every tab: Set (Common) | Limited | Rare | Super Rare | Unique | Essence */}
          <div className="mt-1.5 space-y-1">
            <div className="grid grid-cols-6 gap-1">
              <button
                type="button"
                onClick={() => selectPlayMode("set")}
                data-active={playMode === "set" ? "true" : undefined}
                data-rarity="set"
                title="Set (Common cards): Set lineups, packs, Squad, Set gallery and duplicates"
                className={`jam-mode-pill h-7 truncate rounded-lg border px-1 text-[10.5px] font-medium transition ${
                  playMode === "set"
                    ? "border-set-400/60 bg-set-500/25 font-semibold text-set-200"
                    : "border-white/8 bg-white/[0.03] text-slate-400 hover:text-slate-200"
                }`}
              >
                Set
              </button>
              {RARITIES.map((rarity) => {
                const meta = RARITY_META[rarity];
                const active = playMode === "pro" && rarity === activeRarity;
                return (
                  <button
                    key={rarity}
                    type="button"
                    data-active={active ? "true" : undefined}
                    data-rarity={rarity}
                    onClick={() => {
                      selectPlayMode("pro");
                      void handleSelectRarity(rarity);
                    }}
                    className={`jam-mode-pill h-7 truncate rounded-lg border px-1 text-[10.5px] font-medium transition ${
                      active ? `${meta.badgeClass} font-semibold` : "border-white/8 bg-white/[0.03] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {rarity === "super_rare" ? (
                      <>
                        <span className="min-[440px]:hidden">S. Rare</span>
                        <span className="hidden min-[440px]:inline">{meta.label}</span>
                      </>
                    ) : (
                      meta.label
                    )}
                  </button>
                );
              })}
              {playMode === "set" ? (
                <div
                  className="glass-pill flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5"
                  title="Set Essence (auto-syncs from sorare.com Set pages, or click to type)"
                >
                  <Sparkles className="h-3 w-3 shrink-0 text-set-300" />
                  <input
                    type="number"
                    min={0}
                    max={50000}
                    step={1}
                    placeholder="--"
                    value={typeof settings.commonEssence === "number" ? settings.commonEssence : ""}
                    onChange={(e) => handleCommonEssenceChange(e.target.value)}
                    className="w-full min-w-0 bg-transparent text-[11px] font-semibold tabular-nums text-slate-100 placeholder-slate-400 focus:outline-none"
                    aria-label="Current Set Essence balance"
                  />
                </div>
              ) : (
                <div
                  className="glass-pill flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5"
                  title={`${RARITY_META[activeRarity].label} Essence (auto-syncs from sorare.com sidebar, or click to type)`}
                >
                  <Sparkles className={`h-3 w-3 shrink-0 ${RARITY_META[activeRarity].accentClass}`} />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={activeEssence}
                    onChange={(e) => handleEssenceChange(e.target.value)}
                    className="w-full min-w-0 bg-transparent text-[11px] font-semibold tabular-nums text-slate-100 focus:outline-none"
                    aria-label={`Current ${RARITY_META[activeRarity].label} Essence balance`}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <EssenceTubeBar
                rarity={barRarity}
                pct={barPct}
                amount={barAmount}
                ready={barReady}
                ariaLabel={
                  isSetBar
                    ? `Set Essence progress toward ${setPackTarget.label}`
                    : `${RARITY_META[activeRarity].label} Essence progress toward Craft`
                }
              />
              {isSetBar ? (
                setEssenceGap === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      selectPlayMode("set");
                      setActiveTab("lineups");
                      setSetSubTabNav((prev) => ({ tab: "packs", seq: (prev?.seq ?? 0) + 1 }));
                    }}
                    className="jam-ready-pill shrink-0 cursor-pointer rounded-full px-2 py-0.5 font-semibold text-emerald-200 transition"
                    title="Open Set Packs & Mission Advisor"
                  >
                    {setPackReadyCount >= 2 ? `${setPackReadyCount}x Packs ready` : "Pack ready"}
                  </button>
                ) : (
                  <span className="shrink-0 tabular-nums text-slate-400">
                    {setEssenceGap.toLocaleString()} Essence to {setPackTarget.label}
                  </span>
                )
              ) : (
                <>
                  {essenceGap === 0 ? (
                    <button
                      type="button"
                      onClick={() => navigateTab("craft")}
                      className="jam-ready-pill shrink-0 cursor-pointer rounded-full px-2 py-0.5 font-semibold text-emerald-200 transition"
                      title="Open Craft tab"
                    >
                      {craftReadyCount >= 2 ? `${craftReadyCount}x Craft ready` : "Craft ready"}
                    </button>
                  ) : (
                    <span className="shrink-0 tabular-nums text-slate-400">
                      {essenceGap.toLocaleString()} Essence to craft
                    </span>
                  )}
                  {settings.walletBalance?.cashAmount !== null &&
                    settings.walletBalance?.cashAmount !== undefined && (
                      <span
                        className="shrink-0 tabular-nums text-emerald-300"
                        title="Auto-synced from sorare.com sidebar wallet"
                      >
                        {`${settings.walletBalance.cashSymbol ?? "€"}${settings.walletBalance.cashAmount.toFixed(2)}`}
                      </span>
                    )}
                </>
              )}
            </div>
          </div>

          {/* Accessible Tablist + Scan Age */}
          <div className="mt-1.5 flex items-center justify-between gap-1 border-t border-white/8 pt-1 text-[11px]">
            <div
              role="tablist"
              aria-label="Workspace views"
              onKeyDown={(e) => {
                const order: ActiveTab[] = [
                  "collections",
                  "craft",
                  "lineups",
                  "bargains",
                  "gallery",
                ];
                const idx = order.indexOf(activeTab);
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  const next = order[(idx + 1) % order.length];
                  navigateTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  const prev = order[(idx - 1 + order.length) % order.length];
                  navigateTab(prev);
                  document.getElementById(`tab-${prev}`)?.focus();
                }
              }}
              className="flex min-w-0 flex-wrap items-center gap-1"
            >
              <button
                type="button"
                role="tab"
                id="tab-collections"
                aria-controls="panel-collections"
                aria-selected={activeTab === "collections"}
                tabIndex={activeTab === "collections" ? 0 : -1}
                onClick={() => navigateTab("collections")}
                data-pro-only={playMode === "set" ? "true" : undefined}
                title={playMode === "set" ? "Pro only (Limited and up): click to switch to Pro" : undefined}
                className="jam-nav-tab"
              >
                <Trophy className="h-3 w-3" />
                Collections
              </button>
              <button
                type="button"
                role="tab"
                id="tab-craft"
                aria-controls="panel-craft"
                aria-selected={activeTab === "craft"}
                tabIndex={activeTab === "craft" ? 0 : -1}
                onClick={() => navigateTab("craft")}
                data-pro-only={playMode === "set" ? "true" : undefined}
                title={playMode === "set" ? "Pro only (Limited and up): click to switch to Pro" : undefined}
                className="jam-nav-tab"
              >
                <Sparkles className="h-3 w-3" />
                Craft
              </button>
              <button
                type="button"
                role="tab"
                id="tab-lineups"
                aria-controls="panel-lineups"
                aria-selected={activeTab === "lineups"}
                tabIndex={activeTab === "lineups" ? 0 : -1}
                onClick={() => navigateTab("lineups")}
                className="jam-nav-tab"
              >
                <Wand2 className="h-3 w-3" />
                Lineups
              </button>
              <button
                type="button"
                role="tab"
                id="tab-bargains"
                aria-controls="panel-bargains"
                aria-selected={activeTab === "bargains"}
                tabIndex={activeTab === "bargains" ? 0 : -1}
                onClick={() => navigateTab("bargains")}
                data-pro-only={playMode === "set" ? "true" : undefined}
                title={playMode === "set" ? "Pro only (Limited and up): click to switch to Pro" : undefined}
                className="jam-nav-tab"
              >
                <TrendingDown className="h-3 w-3" />
                Deals
                {(settings.watchlistAlerts?.length ?? 0) > 0 && (
                  <span className="rounded-full bg-amber-400 px-1 text-[9px] font-bold leading-tight text-slate-950">
                    {settings.watchlistAlerts!.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                id="tab-gallery"
                aria-controls="panel-gallery"
                aria-selected={activeTab === "gallery"}
                tabIndex={activeTab === "gallery" ? 0 : -1}
                onClick={() => navigateTab("gallery")}
                className="jam-nav-tab"
              >
                <Layers className="h-3 w-3" />
                Gallery
              </button>
            </div>

            {scanResult && activeTab === "collections" && (
              <span className="shrink-0 pr-1 text-[10px] text-slate-400">
                {formatRelativeAge(scanResult.fetchedAt)}
              </span>
            )}
          </div>
        </header>
      </div>

      <main className="p-3">
        {updateState?.updateAvailable && updateState.latestVersion && (
          <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-100">
            <div className="min-w-0 truncate">
              <span className="font-semibold text-emerald-300">
                Update available: v{updateState.latestVersion}
              </span>{" "}
              <span className="text-slate-300">(running v{updateState.currentVersion})</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {updateState.releaseUrl && (
                <button
                  type="button"
                  onClick={() => void openInActiveTab(updateState.releaseUrl!)}
                  className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-500/30"
                >
                  Download
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss update banner"
                onClick={() => {
                  const v = updateState.latestVersion!;
                  setUpdateState((prev) =>
                    prev ? { ...prev, updateAvailable: false, dismissedVersion: v } : null,
                  );
                  void dismissUpdate(v);
                }}
                className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        {/* Optional local API key onboarding card */}
        {!isActiveTabInitialLoading &&
          !settings.sorareApiKey &&
          !settings.apiKeyPromptDismissed && (
            <div className="mb-3 rounded-xl border border-amber-400/25 bg-[#111726] p-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <div>
                    <div className="font-semibold text-slate-100">
                      Unlock Near-Instant Scans (Optional)
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                      Add your own Sorare API Key (stored{" "}
                      <strong>locally on your device only</strong>) to boost
                      query limits 60× and avoid rate limits.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFocusApiKeyInSettings(true);
                          setShowSettings(true);
                        }}
                        className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
                      >
                        Add API Key
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateSettings({ apiKeyPromptDismissed: true })
                        }
                        className="text-[11px] text-slate-400 hover:text-slate-200"
                      >
                        Use Safe Mode
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void updateSettings({ apiKeyPromptDismissed: true })
                  }
                  className="rounded p-0.5 text-slate-500 hover:text-slate-200"
                  aria-label="Dismiss API key prompt"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

        {anyLoading && !isActiveTabInitialLoading && (
          <div className="glass-pill mb-3 space-y-1.5 rounded-xl border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
            <div className="flex items-center justify-between gap-2">
              <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-300" />
                <span className="truncate">
                  {progress?.message ?? "Loading Sorare NBA data..."}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {progress && progress.total > 0 && (
                  <span className="tabular-nums text-[10.5px] font-semibold text-sky-200">
                    {Math.min(100, Math.round((progress.completed / progress.total) * 100))}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleCancelScan()}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-white/15 bg-slate-950/60 px-2 py-0.5 text-[10px] font-medium text-slate-200 hover:border-sky-400/50 hover:bg-slate-800"
                >
                  <X className="h-3 w-3" />
                  Cancel
                </button>
              </div>
            </div>
            {progress && progress.total > 0 ? (
              <progress
                className="jam-progress"
                data-rarity={progressAccentRarity}
                value={Math.min(progress.completed, progress.total)}
                max={progress.total}
                aria-label="Scan progress"
              />
            ) : (
              <progress
                className="jam-progress"
                data-rarity={progressAccentRarity}
                aria-label="Scan in progress"
              />
            )}
          </div>
        )}

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-400/35 bg-rose-500/10 p-2.5 text-xs text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {isActiveTabInitialLoading && (
          <LoadingStage
            title={loadingStageMeta.title}
            subtitle={loadingStageMeta.subtitle}
            progress={progress}
            rarity={progressAccentRarity}
            onCancel={initialized && anyLoading ? () => void handleCancelScan() : undefined}
          />
        )}

        {!isActiveTabInitialLoading && activeTab === "collections" && (
          <div
            role="tabpanel"
            id="panel-collections"
            aria-labelledby="tab-collections"
            tabIndex={0}
            className="jam-panel-enter"
          >
            <CollectionsTab
              analyses={analysis.analyses}
              summary={analysis.summary}
              cardCounts={scanResult?.cardCounts ?? null}
              questCards={scanResult?.questCards ?? []}
              walletBalance={settings.walletBalance}
              bargains={
                bargainsResult &&
                bargainsResult.rarity === activeRarity &&
                bargainsResult.currency === settings.currency
                  ? bargainsResult
                  : null
              }
              allScannedBargains={allScannedBargains}
              galleryCards={galleryResult?.cards ?? []}
              activeEssence={activeEssence}
              craftThreshold={settings.craftThreshold}
              injuriesByName={galleryResult?.injuriesByName ?? {}}
              pricedSlugs={scanResult?.pricedCollectionSlugs ?? []}
              pricingSlug={pricingSlug}
              isQuestDealsLoading={isQuestDealsLoading}
              hasLoadedQuestDeals={hasLoadedQuestDeals}
              onPriceCollection={(slug) => void handlePriceCollection(slug)}
              onPriceTopCollections={(slugs) =>
                void handlePriceTopCollections(slugs)
              }
              onCancelScan={() => void handleCancelScan()}
              onLoadQuestDeals={() => void handleLoadQuestDeals()}
              onSwitchTab={(tab) => {
                navigateTab(tab);
                if (tab === "bargains" && !bargainsResult && !isBargainsLoading) {
                  void loadBargains(
                    activeRarity,
                    "ending_auctions",
                    settings.currency,
                    false,
                    false,
                  );
                }
              }}
              onScanNow={() =>
                void runScan(
                  settings.username || usernameDraft,
                  activeRarity,
                  settings.currency,
                  settings.inSeasonOnly,
                  false,
                  false,
                )
              }
              currency={settings.currency}
              rarity={activeRarity}
              craftReadyOnly={settings.craftReadyOnly}
              onToggleCraftReadyOnly={() =>
                void updateSettings({
                  craftReadyOnly: !settings.craftReadyOnly,
                })
              }
              inSeasonOnly={settings.inSeasonOnly}
              onToggleInSeasonOnly={() => void handleToggleInSeasonOnly()}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              hasScanned={hasCollectionsData}
              hasUsername={Boolean((settings.username || usernameDraft).trim())}
              isLoading={isLoading}
              onTryDemo={() => {
                setUsernameDraft("pjampjam");
                void updateSettings({ username: "pjampjam", usernameLockedByUser: false });
                void runScan("pjampjam", activeRarity, settings.currency, settings.inSeasonOnly, false, false);
              }}
            />
          </div>
        )}

        <Suspense
          fallback={
            <LoadingStage
              title={loadingStageMeta.title}
              subtitle={loadingStageMeta.subtitle}
              progress={null}
              rarity={progressAccentRarity}
            />
          }
        >
        {!isActiveTabInitialLoading && activeTab === "craft" && (
          <div
            role="tabpanel"
            id="panel-craft"
            aria-labelledby="tab-craft"
            tabIndex={0}
            className="jam-panel-enter"
          >
            <CraftTab
              craftPool={
                craftPool &&
                craftPool.rarity === activeRarity &&
                craftPool.currency === settings.currency
                  ? craftPool
                  : null
              }
              rarity={activeRarity}
              currency={settings.currency}
              isLoading={isCraftLoading}
              isPricing={isCraftPricing}
              collectionNeedSlugs={collectionNeedSlugs}
              injuriesByName={galleryResult?.injuriesByName ?? {}}
              onLoadPool={(force) =>
                void loadCraftPool(activeRarity, settings.currency, force)
              }
              onPriceTopCandidates={(slugs) =>
                void handlePriceCraftCandidates(slugs)
              }
            />
          </div>
        )}

        {!isActiveTabInitialLoading && activeTab === "lineups" && (
          <div
            role="tabpanel"
            id="panel-lineups"
            aria-labelledby="tab-lineups"
            tabIndex={0}
            className="jam-panel-enter"
          >
            <LineupsTab
              mode={playMode === "set" ? "set_common" : "pro"}
              onModeChange={(m) => selectPlayMode(m === "set_common" ? "set" : "pro")}
              requestedSetSubTab={setSubTabNav}
              onConsumeRequestedSetSubTab={() => setSetSubTabNav(null)}
              commonEssence={settings.commonEssence}
              gallery={galleryResult}
              bargains={bargainsResult}
              allScannedBargains={allScannedBargains}
              collectionNeedSlugs={collectionNeedSlugs}
              walletBalance={settings.walletBalance}
              currency={settings.currency}
              activeRarity={activeRarity}
              projectionSource={settings.projectionSource}
              customProjectionsRaw={settings.customProjectionsRaw}
              hasUsername={Boolean((settings.username || usernameDraft).trim())}
              isLoading={isGalleryLoading}
              isMarketLoading={isBargainsLoading}
              cutoffReminderEnabled={settings.cutoffReminderEnabled === true}
              onToggleCutoffReminder={(enabled) =>
                void updateSettings({ cutoffReminderEnabled: enabled })
              }
              onScanMarketForBudget={() =>
                void loadBargains(
                  activeRarity,
                  "instant_value",
                  settings.currency,
                  true,
                  false,
                )
              }
              onUpdateProjectionSource={(source: ProjectionSource) =>
                void updateSettings({ projectionSource: source })
              }
              onSaveCustomProjections={(raw: string) =>
                void updateSettings({ customProjectionsRaw: raw })
              }
              onLoadGallery={(force) =>
                void loadGallery(
                  settings.username || usernameDraft,
                  Boolean(force),
                  false,
                )
              }
              onTryDemo={() => {
                setUsernameDraft("pjampjam");
                void updateSettings({ username: "pjampjam", usernameLockedByUser: false });
                void loadGallery("pjampjam", false, false);
              }}
              savedRosters={normalizeSavedRosters(settings.savedRosters)}
              onSaveRoster={(preset: SavedRosterPreset) => {
                const next = normalizeSavedRosters([
                  preset,
                  ...(settings.savedRosters ?? []),
                ]);
                void updateSettings({ savedRosters: next });
              }}
              onDeleteRoster={(id: string) => {
                const next = normalizeSavedRosters(
                  (settings.savedRosters ?? []).filter((r) => r.id !== id),
                );
                void updateSettings({ savedRosters: next });
              }}
              onOpenWrapped={() => {
                void getProProgressHistory()
                  .then(setWrappedHistory)
                  .catch(() => {});
                setShowWrapped(true);
              }}
            />
          </div>
        )}

        {!isActiveTabInitialLoading && activeTab === "bargains" && (
          <div
            role="tabpanel"
            id="panel-bargains"
            aria-labelledby="tab-bargains"
            tabIndex={0}
            className="jam-panel-enter"
          >
            <BargainsTab
              bargains={
                bargainsResult &&
                bargainsResult.rarity === activeRarity &&
                bargainsResult.currency === settings.currency
                  ? bargainsResult
                  : null
              }
              collectionNeedSlugs={collectionNeedSlugs}
              rarity={activeRarity}
              currency={settings.currency}
              isLoading={isBargainsLoading || isWatchlistChecking}
              gallery={galleryResult}
              watchlist={settings.watchlist ?? []}
              watchlistAlerts={settings.watchlistAlerts ?? []}
              onUpdateWatchlist={(next) => void updateSettings({ watchlist: next })}
              onRunWatchlistCheck={() => {
                setIsWatchlistChecking(true);
                void runWatchlistCheck()
                  .then((alerts) =>
                    setSettings((prev) => ({ ...prev, watchlistAlerts: alerts })),
                  )
                  .finally(() => setIsWatchlistChecking(false));
              }}
              onClearWatchlistAlerts={() => {
                void clearWatchlistAlerts().then(() =>
                  setSettings((prev) => ({ ...prev, watchlistAlerts: [] })),
                );
              }}
              onScanBargains={(mode, force) =>
                void loadBargains(
                  activeRarity,
                  mode,
                  settings.currency,
                  Boolean(force),
                  false,
                )
              }
            />
          </div>
        )}
        {!isActiveTabInitialLoading && activeTab === "gallery" && (
          <div
            role="tabpanel"
            id="panel-gallery"
            aria-labelledby="tab-gallery"
            tabIndex={0}
            className="jam-panel-enter"
          >
            <GalleryTab
              pool={playMode === "set" ? "common" : "pro"}
              gallery={galleryResult}
              walletBalance={settings.walletBalance}
              rarity={activeRarity}
              currency={settings.currency}
              hasUsername={Boolean((settings.username || usernameDraft).trim())}
              isLoading={isGalleryLoading}
              isPricingGallery={isPricingGallery}
              onRefreshGallery={() =>
                void loadGallery(
                  settings.username || usernameDraft,
                  true,
                  false,
                )
              }
              onPriceGallery={() => void handlePriceGallery()}
              cardTags={settings.cardTags ?? {}}
              onSetCardTag={(cardSlug: string, tag: CardTag | null) => {
                const next = setCardTagInMap(settings.cardTags ?? {}, cardSlug, tag);
                void updateSettings({ cardTags: next });
              }}
              onPnlLoaded={(pnl: PortfolioPnlResult) => {
                setPnlRecords(pnl.records);
              }}
              onOpenWrapped={() => {
                void getProProgressHistory()
                  .then(setWrappedHistory)
                  .catch(() => {});
                setShowWrapped(true);
              }}
            />
          </div>
        )}
        </Suspense>
      </main>

      {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}

      <Suspense fallback={null}>
        {showWhatsNew && (
          <WhatsNewModal
            version={version}
            onClose={() => setShowWhatsNew(false)}
          />
        )}

        {showWrapped && (
          <WrappedModal
            open={showWrapped}
            onClose={() => setShowWrapped(false)}
            username={settings.username || galleryResult?.username || null}
            progressHistory={wrappedHistory}
            galleryCards={[
              ...(galleryResult?.cards ?? []),
              ...(galleryResult?.commonCards ?? []),
            ]}
            ownershipRecords={pnlRecords}
            essenceByRarity={settings.essenceByRarity}
            commonEssence={settings.commonEssence}
            currency={settings.currency}
          />
        )}

        {showGuides && <GuidesModal onClose={() => setShowGuides(false)} />}

        {showCmdPalette && (
          <CommandPaletteModal
            galleryCards={[
              ...(galleryResult?.cards ?? []),
              ...(galleryResult?.commonCards ?? []),
            ]}
            collections={scanResult?.collections ?? []}
            deals={allScannedBargains}
            currency={settings.currency}
            onSwitchTab={(t) => navigateTab(t)}
            onOpenGuides={() => setShowGuides(true)}
            onOpenSettings={() => setShowSettings(true)}
            onOpenDashboard={() => void openDashboardTab(activeTab)}
            onClose={() => setShowCmdPalette(false)}
          />
        )}

        {showSettings && (
          <SettingsModal
            version={version}
            settings={settings}
            focusApiKey={focusApiKeyInSettings}
            onUpdateSettings={(patch) => void updateSettings(patch)}
            onOpenTierEditor={() => setShowTierEditor(true)}
            onOpenWhatsNew={() => {
              setShowSettings(false);
              setShowWhatsNew(true);
              setHasUnseenWhatsNew(false);
              try {
                window.localStorage.setItem("jamassist_last_seen_version", version);
              } catch {
                // Ignore
              }
            }}
            onClearCache={() => void clearCache()}
            onReloadExtension={() => void reloadExtension()}
            onClose={() => {
              setFocusApiKeyInSettings(false);
              setShowSettings(false);
            }}
          />
        )}
      </Suspense>

      {showTierEditor && (
        <TierEditorModal
          rarity={activeRarity}
          rules={settings.milestoneRulesByRarity[activeRarity] ?? []}
          onSave={handleSaveTiers}
          onClose={() => setShowTierEditor(false)}
        />
      )}

      <footer className="px-3 pb-4 pt-1 text-center text-[10px] text-slate-500">
        <button
          type="button"
          onClick={() => {
            setShowWhatsNew(true);
            setHasUnseenWhatsNew(false);
            try {
              window.localStorage.setItem("jamassist_last_seen_version", version);
            } catch {
              // Ignore
            }
          }}
          className={`mr-1.5 inline-flex items-center rounded px-1 py-px font-mono text-[9.5px] font-medium transition ${
            isExperimentalBuild
              ? "border border-rose-400/40 bg-rose-500/12 text-rose-300 hover:bg-rose-500/20"
              : "bg-white/8 text-amber-300 hover:bg-amber-400/20"
          }`}
          title="View What's New & Changelog"
        >
          {versionBadgeLabel}
        </button>
        Use at own risk • Estimates only (not financial advice) • Unofficial
        companion by pjampjam (not affiliated with Sorare or NBA) • Local-only
        storage • MIT License
      </footer>
      </div>
    </div>
  );
}

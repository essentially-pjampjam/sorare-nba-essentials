import { mergeApiAndDomLineups } from "../shared/domLineupMerge";
import {
  AlertCircle,
  AlignJustify,
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
  UserCheck,
  Wallet,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeCollections } from "../calculators/collectionEssenceMath";
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
  CraftPoolResult,
  Currency,
  EssenceMilestoneRule,
  GalleryResult,
  ProjectionSource,
  Rarity,
  ScanProgress,
  ScanResult,
  UserSettings,
} from "../shared/types";
import {
  cancelScan,
  clearCache,
  clearWatchlistAlerts,
  connectProgressPort,
  fetchBargains,
  fetchCraftPool,
  fetchGalleryForLineups,
  getDetectedUsername,
  getSettings,
  openDashboardTab,
  priceCollection,
  priceCraftCandidates,
  priceGalleryCards,
  priceTopCollections,
  reloadExtension,
  runWatchlistCheck,
  saveSettings,
  scanCollections,
} from "./api";
import { CommandPaletteModal } from "./components/CommandPaletteModal";
import { SettingsModal } from "./components/SettingsModal";
import { SupportModal } from "./components/SupportModal";
import { TierEditorModal } from "./components/TierEditorModal";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { BargainsTab } from "./tabs/BargainsTab";
import { CollectionsTab } from "./tabs/CollectionsTab";
import { CraftTab } from "./tabs/CraftTab";
import { GalleryTab } from "./tabs/GalleryTab";
import { LineupsTab } from "./tabs/LineupsTab";
import { formatRelativeAge } from "./utils/format";

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
  const [isCraftLoading, setIsCraftLoading] = useState<boolean>(false);
  const [isGalleryLoading, setIsGalleryLoading] = useState<boolean>(false);
  const [isPricingGallery, setIsPricingGallery] = useState<boolean>(false);
  const [isBargainsLoading, setIsBargainsLoading] = useState<boolean>(false);
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
  const [showHeaderMenu, setShowHeaderMenu] = useState<boolean>(false);
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
  const navigateTab = (tab: ActiveTab) => {
    if (tab === "collections" || tab === "craft" || tab === "bargains") {
      setPlayMode("pro");
      try {
        localStorage.setItem("jamassist_play_mode", "pro");
      } catch {
        // per-device convenience only
      }
    }
    setActiveTab(tab);
  };
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
  }, []);
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
  const [initialized, setInitialized] = useState<boolean>(false);

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
        }
      }
    },
    [],
  );

  const loadCraftPool = useCallback(
    async (rarity: Rarity, currency: Currency, forceRefresh = false) => {
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

      if (scanResult && scanResult.rarity === activeRarity) {
        const pricedSet = new Set(scanResult.pricedCollectionSlugs);
        const closestInSeasonTeam = [...scanResult.collections]
          .filter((c) => !c.complete && c.inSeason && Boolean(c.teamSlug))
          .sort((a, b) => {
            const ra = a.slotsCount - a.fulfilledSlotsCount;
            const rb = b.slotsCount - b.fulfilledSlotsCount;
            if (ra !== rb) return ra - rb;
            return b.fulfilledSlotsCount - a.fulfilledSlotsCount;
          })[0];
        if (closestInSeasonTeam && !pricedSet.has(closestInSeasonTeam.slug)) {
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
      (tab) => {
        navigateTab(tab);
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

    void (async () => {
      try {
        const [loaded, detected, pendingRaw] = await Promise.all([
          getSettings(),
          getDetectedUsername(),
          chrome.storage.local.get("jamassist_pending_tab"),
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
        const resolvedTab = urlTab ?? pendingTab;
        if (
          resolvedTab === "craft" ||
          resolvedTab === "collections" ||
          resolvedTab === "lineups" ||
          resolvedTab === "bargains" ||
          resolvedTab === "gallery"
        ) {
          navigateTab(resolvedTab);
          if (pendingTab) {
            void chrome.storage.local.remove("jamassist_pending_tab");
          }
        }
        const initialUser = loaded.username || safeDetected || "";
        setUsernameDraft(initialUser);
        setInitialized(true);

        // Cache-only on startup so opening Side Panel never blasts Sorare with automatic API calls
        if (initialUser) {
          void runScan(
            initialUser,
            loaded.selectedRarity,
            loaded.currency,
            loaded.inSeasonOnly,
            false,
            true,
          );
          void loadGallery(initialUser, false, true);
        }
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
    setIsLoading(false);
    setIsCraftLoading(false);
    setIsGalleryLoading(false);
    setIsBargainsLoading(false);
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
  const anyLoading =
    isLoading ||
    isCraftLoading ||
    isGalleryLoading ||
    isPricingGallery ||
    isBargainsLoading ||
    isQuestDealsLoading;

  return (
    <div
      className="jam-canvas min-h-screen text-slate-100"
      data-theme={settings.theme}
      data-density={settings.density ?? "cozy"}
    >
      <div className={isDashboardMode ? "jam-dashboard-mode" : ""}>
      <div ref={stickyHeaderRef} className="jam-sticky-wrap sticky top-0 z-30 px-2.5 pb-1.5 pt-2.5">
        <header className="glass-chrome rounded-2xl px-3 py-2.5">
          {/* Row 1: identity, username, Refresh, overflow menu */}
          <div className="flex items-center gap-2">
            {/* Logo with the connection bolt: blue = API key active (Fast Mode), gray = public mode. */}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="relative h-8 w-8 shrink-0"
              title={
                settings.sorareApiKey
                  ? "Fast Mode: your Sorare API key is active (click for Settings)"
                  : "Public mode, no API key: click to add one in Settings for faster, fuller data"
              }
              aria-label={settings.sorareApiKey ? "Fast Mode active, open Settings" : "No API key, open Settings to add one"}
            >
              <img src="/logo.png" alt="pjampjam's Sorare NBA Essentials" className="h-8 w-8 rounded-lg object-contain" />
              <span
                className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--jam-chrome-bot)] ${
                  settings.sorareApiKey ? "bg-sky-400 text-slate-950" : "bg-slate-600 text-slate-200"
                }`}
              >
                <Zap className="h-2.5 w-2.5" fill="currentColor" />
              </span>
            </button>
            <div className="flex min-w-0 shrink-0 flex-col justify-center gap-0.5 leading-none">
              <h1 className="whitespace-nowrap text-xs font-semibold tracking-tight text-slate-100">Sorare NBA</h1>
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
                className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded px-1 py-px font-mono text-[9px] font-medium transition ${
                  isExperimentalBuild
                    ? "border border-rose-400/50 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                    : "bg-white/8 text-amber-300 hover:bg-amber-400/20"
                }`}
                title={`${isExperimentalBuild ? "Experimental build " : ""}v${version} • What's New & Send Feedback`}
              >
                <span>{versionBadgeLabel}</span>
                {hasUnseenWhatsNew && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              </button>
            </div>

            <div className="min-w-0 flex-1">
              {settings.username && !editingUsername ? (
                <button
                  type="button"
                  onClick={() => setEditingUsername(true)}
                  className="glass-pill inline-flex h-7 max-w-full items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-100 hover:border-sky-400/50"
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
                    placeholder="Sorare slug"
                    aria-label="Sorare username or slug"
                    autoFocus={editingUsername}
                    className="glass-pill w-full min-w-0 rounded-lg px-2 py-1 text-[11px] text-slate-100 placeholder-slate-500 focus:border-sky-400/70 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={anyLoading || !usernameDraft.trim()}
                    className="glass-pill shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:border-sky-400/50 disabled:opacity-50"
                  >
                    Scan
                  </button>
                </form>
              )}
            </div>

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

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowHeaderMenu((v) => !v)}
                className="glass-pill flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition hover:border-sky-400/50 hover:text-slate-100"
                title="Search, currency, density, support, pop-out, settings"
                aria-label="More options"
                aria-expanded={showHeaderMenu}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
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
                    <button
                      type="button"
                      onClick={() => void updateSettings({ density: settings.density === "compact" ? "cozy" : "compact" })}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/8"
                    >
                      <AlignJustify className="h-3.5 w-3.5 text-slate-400" /> Density
                      <span className="ml-auto text-[10px] text-slate-400">{settings.density === "compact" ? "Compact" : "Cozy"}</span>
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
          <div className="mt-2 space-y-1">
            <div className="grid grid-cols-6 gap-1">
              <button
                type="button"
                onClick={() => selectPlayMode("set")}
                title="Set (Common cards): Set lineups, packs, Squad, Set gallery and duplicates"
                className={`h-7 truncate rounded-lg border px-1 text-[10.5px] font-medium transition ${
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
                    onClick={() => {
                      selectPlayMode("pro");
                      void handleSelectRarity(rarity);
                    }}
                    className={`h-7 truncate rounded-lg border px-1 text-[10.5px] font-medium transition ${
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
                  title="Your Sorare Essence (auto-syncs from sorare.com sidebar, or click to type)"
                >
                  <Sparkles className="h-3 w-3 shrink-0 text-amber-400" />
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={activeEssence}
                    onChange={(e) => handleEssenceChange(e.target.value)}
                    className="w-full min-w-0 bg-transparent text-[11px] font-semibold text-slate-100 focus:outline-none"
                    aria-label="Current Essence balance"
                  />
                </div>
              )}
            </div>
            {playMode === "pro" && (activeTab === "collections" || activeTab === "craft" || activeTab === "bargains") && (
              <div className="flex items-center gap-2 text-[10px]">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-950/70">
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${essencePct}%`, backgroundColor: essenceGap === 0 ? "var(--jam-money)" : "var(--jam-info)" }}
                  />
                </div>
                {essenceGap === 0 ? (
                  <span className="shrink-0 font-semibold text-emerald-300">Craft ready</span>
                ) : (
                  <span className="shrink-0 tabular-nums text-slate-400">{essenceGap.toLocaleString()} Essence to craft</span>
                )}
                {settings.walletBalance?.cashAmount !== null && settings.walletBalance?.cashAmount !== undefined && (
                  <span className="shrink-0 tabular-nums text-emerald-300" title="Auto-synced from sorare.com sidebar wallet">
                    {`${settings.walletBalance.cashSymbol ?? "€"}${settings.walletBalance.cashAmount.toFixed(2)}`}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Accessible Tablist + Scan Age */}
          <div className="mt-2 flex items-center justify-between gap-1 border-t border-white/8 pt-1.5 text-[11px]">
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
              className="flex min-w-0 flex-wrap items-center gap-0.5"
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
                className={`px-2 py-1 font-medium transition ${
                  activeTab === "collections"
                    ? "text-slate-50 shadow-[inset_0_-2px_0_var(--jam-info)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
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
                className={`inline-flex items-center gap-1 px-2 py-1 font-medium transition ${
                  activeTab === "craft"
                    ? "text-slate-50 shadow-[inset_0_-2px_0_var(--jam-info)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
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
                className={`inline-flex items-center gap-1 px-2 py-1 font-medium transition ${
                  activeTab === "lineups"
                    ? "text-slate-50 shadow-[inset_0_-2px_0_var(--jam-info)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
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
                className={`inline-flex items-center gap-1 px-2 py-1 font-medium transition ${
                  activeTab === "bargains"
                    ? "text-slate-50 shadow-[inset_0_-2px_0_var(--jam-info)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
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
                className={`inline-flex items-center gap-1 px-2 py-1 font-medium transition ${
                  activeTab === "gallery"
                    ? "text-slate-50 shadow-[inset_0_-2px_0_var(--jam-info)]"
                    : "text-slate-400 hover:text-slate-200"
                }`}
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
        {/* Optional local API key onboarding card */}
        {initialized &&
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

        {anyLoading && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <div className="flex min-w-0 items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
              <span className="truncate">
                {progress?.message ?? "Loading Sorare NBA data..."}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleCancelScan()}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-amber-400/30 bg-[#111726] px-2 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-slate-800"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-400/35 bg-rose-500/10 p-2.5 text-xs text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {initialized && activeTab === "collections" && (
          <div
            role="tabpanel"
            id="panel-collections"
            aria-labelledby="tab-collections"
            tabIndex={0}
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
              hasScanned={Boolean(scanResult)}
              hasUsername={Boolean((settings.username || usernameDraft).trim())}
              isLoading={isLoading}
            />
          </div>
        )}

        {initialized && activeTab === "craft" && (
          <div
            role="tabpanel"
            id="panel-craft"
            aria-labelledby="tab-craft"
            tabIndex={0}
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

        {initialized && activeTab === "lineups" && (
          <div
            role="tabpanel"
            id="panel-lineups"
            aria-labelledby="tab-lineups"
            tabIndex={0}
          >
            <LineupsTab
              mode={playMode === "set" ? "set_common" : "pro"}
              onModeChange={(m) => selectPlayMode(m === "set_common" ? "set" : "pro")}
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
            />
          </div>
        )}

        {initialized && activeTab === "bargains" && (
          <div
            role="tabpanel"
            id="panel-bargains"
            aria-labelledby="tab-bargains"
            tabIndex={0}
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
              isLoading={isBargainsLoading}
              gallery={galleryResult}
              watchlist={settings.watchlist ?? []}
              watchlistAlerts={settings.watchlistAlerts ?? []}
              onUpdateWatchlist={(next) => void updateSettings({ watchlist: next })}
              onRunWatchlistCheck={() => {
                setIsBargainsLoading(true);
                void runWatchlistCheck()
                  .then((alerts) =>
                    setSettings((prev) => ({ ...prev, watchlistAlerts: alerts })),
                  )
                  .finally(() => setIsBargainsLoading(false));
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
        {initialized && activeTab === "gallery" && (
          <div
            role="tabpanel"
            id="panel-gallery"
            aria-labelledby="tab-gallery"
            tabIndex={0}
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
            />
          </div>
        )}
      </main>

      {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}

      {showWhatsNew && (
        <WhatsNewModal
          version={version}
          onClose={() => setShowWhatsNew(false)}
        />
      )}

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
          onOpenSettings={() => setShowSettings(true)}
          onOpenDashboard={() => void openDashboardTab(activeTab)}
          onClose={() => setShowCmdPalette(false)}
        />
      )}

      {showTierEditor && (
        <TierEditorModal
          rarity={activeRarity}
          rules={settings.milestoneRulesByRarity[activeRarity] ?? []}
          onSave={handleSaveTiers}
          onClose={() => setShowTierEditor(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          version={version}
          settings={settings}
          focusApiKey={focusApiKeyInSettings}
          onUpdateSettings={(patch) => void updateSettings(patch)}
          onOpenTierEditor={() => setShowTierEditor(true)}
          onClearCache={() => void clearCache()}
          onReloadExtension={() => void reloadExtension()}
          onClose={() => {
            setFocusApiKeyInSettings(false);
            setShowSettings(false);
          }}
        />
      )}

      <footer className="px-3 pb-4 pt-1 text-center text-[10px] text-slate-500">
        Use at own risk • Estimates only (not financial advice) • Unofficial
        companion by pjampjam (not affiliated with Sorare or NBA) • Local-only
        storage • MIT License
      </footer>
      </div>
    </div>
  );
}

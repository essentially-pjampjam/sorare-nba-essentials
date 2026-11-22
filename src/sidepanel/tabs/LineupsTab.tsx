import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Calendar,
  Check,
  ChevronRight,
  Copy,
  Crown,
  ExternalLink,
  FileSpreadsheet,
  Flame,
  Info,
  Layers,
  Lock,
  Send,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  TrendingUp,
  Trophy,
  Wallet,
  Wand2,
  Zap,
} from "lucide-react";
import { StatusStrip } from "../components/StatusStrip";
import { DailyPlayHub } from "../components/DailyPlayHub";
import { SquadActivityCard } from "../components/SquadActivityCard";
import { PackAdvisorCard } from "../components/PackAdvisorCard";
import { ProProgressCard } from "../components/ProProgressCard";
import { GoButton } from "../components/GoButton";
import { LineupCardStrip } from "../components/LineupCardStrip";
import { LineupRangeBar } from "../components/LineupRangeBar";
import { RewardPreviewStrip } from "../components/RewardPreviewStrip";
import { InjuryImpactPanel } from "../components/InjuryImpactPanel";
import { evaluateInjuryBeneficiaries } from "../../calculators/injuryImpactMath";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSetTeams,
  type SetBuildMode,
  SET_SOLO_LATER_WEIGHT,
  type SetSoloTiming,
} from "../../calculators/commonSetMath";
import {
  buildBudgetLineups,
  compareCurrentVsOptimalLineups,
  generateTopLineups,
  analyzeFocusStrength,
  getCompetitionEntryLimit,
  optimizeMultiCompetitionPortfolio,
  recommendBestFormat,
  resolveSyncedLineupCardSlugs,
  recommendLineupMarketBuys,
  recommendTwoCardComboSwaps,
  type BuyAdvisorRankMode,
  type LineupBuyRecommendation,
  type LineupSeasonRule,
  type LineupSlotPick,
} from "../../calculators/lineupOptimizerMath";
import { buildTeamOutStarMap } from "../../calculators/questOptimizerMath";
import {
  BOOSTING_GUIDE_RULES,
  NBA_COMPETITION_DIRECTORY,
  NBA_POSITION_LABELS,
} from "../../shared/constants";
import { buildArenaLineupsUrl, buildProPlayUrl, buildSetPlayUrl } from "../../shared/routes";
import type {
  BargainListing,
  BargainsResult,
  Currency,
  GalleryResult,
  InjuryStatus,
  LineupAgeFilter,
  LineupFormat,
  ProjectionSource,
  Rarity,
  WalletBalanceInfo,
  DailyPickerPool,
} from "../../shared/types";
import { applyLineupHighlight, getDailyPickerPool, openInActiveTab } from "../api";
import { HeadToHeadCompareBox } from "../components/HeadToHeadCompareBox";
import { PlayerCardRow } from "../components/PlayerCardRow";
import { formatMoney } from "../utils/format";

interface LineupsTabProps {
  gallery: GalleryResult | null;
  bargains?: BargainsResult | null;
  allScannedBargains?: BargainListing[];
  collectionNeedSlugs?: Set<string>;
  walletBalance?: WalletBalanceInfo;
  currency?: Currency;
  activeRarity: Rarity;
  projectionSource: ProjectionSource;
  customProjectionsRaw: string;
  hasUsername: boolean;
  isLoading: boolean;
  isMarketLoading?: boolean;
  onUpdateProjectionSource: (source: ProjectionSource) => void;
  onSaveCustomProjections: (raw: string) => void;
  onLoadGallery: (forceRefresh?: boolean) => void;
  onScanMarketForBudget?: () => void;
  cutoffReminderEnabled?: boolean;
  /** Starting view (tests, deep links). */
  initialArenaMode?: "pro" | "set_common";
  /** Global Set | Pro switch (top bar). When set, the tab's own switch is hidden. */
  mode?: "pro" | "set_common";
  onModeChange?: (mode: "pro" | "set_common") => void;
  commonEssence?: number;
  initialFormat?: LineupFormat;
  onToggleCutoffReminder?: (enabled: boolean) => void;
}

const FORMAT_OPTIONS: Array<{ id: LineupFormat; label: string; sub: string }> = [
  { id: "champion_16", label: "Champion", sub: "16★ Cap" },
  { id: "contender_11", label: "Contender", sub: "11★ Cap" },
  { id: "arena_champion_15", label: "Arena Champ", sub: "16★ Cap" },
  { id: "arena_contender_12", label: "Arena Cont", sub: "11★ Cap" },
  { id: "uncapped", label: "Uncapped", sub: "Raw Best" },
];

const SOURCE_OPTIONS: Array<{ id: ProjectionSource; label: string }> = [
  { id: "blended_smart", label: "Smart Consensus (Inj-Adj)" },
  { id: "sorare_projected", label: "Sorare Fixture Predictor" },
  { id: "sorare_l10", label: "Sorare L10 Baseline" },
  { id: "sorare_l5", label: "Sorare L5 Recent Form" },
  { id: "custom_csv", label: "External CSV / Custom Paste" },
];

function slotBadgeClass(slotLabel: LineupSlotPick["slotLabel"]): string {
  switch (slotLabel) {
    case "MVP":
      return "border-amber-400/50 bg-amber-400/20 text-amber-200";
    case "G":
      return "border-sky-400/45 bg-sky-500/15 text-sky-200";
    case "F":
      return "border-emerald-400/45 bg-emerald-500/15 text-emerald-200";
    case "C":
    case "FLEX":
    default:
      return "border-violet-400/45 bg-violet-500/15 text-violet-200";
  }
}

function injuryBadge(status: InjuryStatus): {
  label: string;
  cls: string;
} | null {
  switch (status) {
    case "OUT":
      return {
        label: "OUT",
        cls: "border-rose-400/50 bg-rose-500/20 text-rose-200",
      };
    case "DOUBTFUL":
      return {
        label: "DBT",
        cls: "border-rose-400/40 bg-rose-500/15 text-rose-200",
      };
    case "QUESTIONABLE":
    case "DAY_TO_DAY":
      return {
        label: "GTD",
        cls: "border-amber-400/45 bg-amber-500/15 text-amber-200",
      };
    case "ACTIVE":
    default:
      return null;
  }
}

function dvpTagClass(tag: "EASY" | "NEUTRAL" | "TOUGH"): string {
  if (tag === "EASY") {
    return "border-emerald-400/35 bg-emerald-500/15 text-emerald-300";
  }
  if (tag === "TOUGH") {
    return "border-rose-400/35 bg-rose-500/15 text-rose-300";
  }
  return "border-white/10 bg-white/5 text-slate-300";
}

function primaryPosKey(positions: readonly string[]): "G" | "F" | "C" {
  const first = positions[0] ?? "";
  if (first === "basketball_center") return "C";
  if (first === "basketball_forward") return "F";
  return "G";
}

export function LineupsTab({
  gallery,
  bargains,
  allScannedBargains = [],
  collectionNeedSlugs,
  walletBalance,
  currency = "EUR",
  activeRarity,
  projectionSource,
  customProjectionsRaw,
  hasUsername,
  isLoading,
  isMarketLoading = false,
  onUpdateProjectionSource,
  onSaveCustomProjections,
  onLoadGallery,
  onScanMarketForBudget,
  cutoffReminderEnabled = false,
  initialArenaMode = "pro",
  mode,
  onModeChange,
  commonEssence,
  initialFormat = "contender_11",
  onToggleCutoffReminder,
}: LineupsTabProps) {
  const [localArenaMode, setLocalArenaMode] = useState<"pro" | "set_common">(initialArenaMode);
  const arenaMode = mode ?? localArenaMode;
  const setArenaMode = (next: "pro" | "set_common") => (onModeChange ? onModeChange(next) : setLocalArenaMode(next));
  const [format, setFormat] = useState<LineupFormat>(initialFormat);
  const [ageFilter, setAgeFilter] = useState<LineupAgeFilter>("all");
  const [rarityScope, setRarityScope] = useState<Rarity | "ALL">(activeRarity);
  const [excludeOut, setExcludeOut] = useState(true);
  const [excludeQuestionable, setExcludeQuestionable] = useState(false);
  const [seasonRule, setSeasonRule] =
    useState<LineupSeasonRule>("4_in_1_classic");
  const [buyRankMode, setBuyRankMode] =
    useState<BuyAdvisorRankMode>("best_value");
  const [buyMaxPriceEuros, setBuyMaxPriceEuros] = useState<string>("");
  const [buySlotFilter, setBuySlotFilter] = useState<
    "split" | "classic" | "in_season"
  >("split");
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);
  const [disjointLineups, setDisjointLineups] = useState(true);
  const [excludeSubmittedCards, setExcludeSubmittedCards] = useState(false);
  const [excludedCardSlugs, setExcludedCardSlugs] = useState<string[]>([]);
  const [expandedSlotSlug, setExpandedSlotSlug] = useState<string | null>(null);
  const [setBuildMode, setSetBuildMode] = useState<SetBuildMode>("solo");
  const [setTeamCount, setSetTeamCount] = useState<number>(4);
  // Live Set rules: Solo up to 4 teams, Squad 1 team per manager.
  const setMaxTeams = setBuildMode === "solo" ? 4 : 1;
  const effectiveSetTeams = Math.min(setTeamCount, setMaxTeams);
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [customDraft, setCustomDraft] = useState(customProjectionsRaw);
  const [copiedRank, setCopiedRank] = useState<number | null>(null);
  const [buildSeed, setBuildSeed] = useState(0);
  const [rebuildNotice, setRebuildNotice] = useState<string | null>(null);
  const lineupsResultRef = useRef<HTMLDivElement>(null);
  const [budgetCents, setBudgetCents] = useState<number>(1000);
  const [includeOwnedInBudget, setIncludeOwnedInBudget] = useState<boolean>(true);

  const strictInSeasonOnly = seasonRule === "5_in_season";
  // Live entry caps: Arena / In-Season up to 5, Classic 3 (Limited) per competition.
  const entryLimit = getCompetitionEntryLimit({
    format,
    rarity: rarityScope === "ALL" ? "limited" : rarityScope,
    seasonScope: format.startsWith("arena")
      ? "arena"
      : seasonRule === "any_season"
        ? "classic"
        : "in_season",
  });
  const minInSeasonCards =
    seasonRule === "5_in_season" ? 5 : seasonRule === "4_in_1_classic" ? 4 : 0;

  const toggleCompareCard = (slug: string) => {
    setCompareSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= 2) return [prev[1], slug];
      return [...prev, slug];
    });
  };

  const openFixture =
    gallery?.fixtures.find((f) => f.aasmState === "opened") ??
    gallery?.fixtures[0] ??
    null;

  const teamOutBoostMap = useMemo(() => {
    if (!gallery) return {};
    return buildTeamOutStarMap(
      [...gallery.cards, ...(gallery.commonCards ?? [])],
      gallery.injuriesByName,
    );
  }, [gallery]);

  const [proSubTab, setProSubTab] = useState<"overview" | "builder" | "upgrades">(() => {
    try {
      const saved = localStorage.getItem("jamassist_lineups_pro_subtab");
      return saved === "builder" || saved === "upgrades" ? saved : "overview";
    } catch {
      return "overview";
    }
  });
  const selectProSubTab = (next: "overview" | "builder" | "upgrades") => {
    setProSubTab(next);
    try {
      localStorage.setItem("jamassist_lineups_pro_subtab", next);
    } catch {
      // ignore storage failure
    }
  };

  const [setSubTab, setSetSubTab] = useState<"daily" | "solo_squad" | "packs">(() => {
    try {
      const saved = localStorage.getItem("jamassist_lineups_set_subtab");
      return saved === "solo_squad" || saved === "packs" ? saved : "daily";
    } catch {
      return "daily";
    }
  });
  const selectSetSubTab = (next: "daily" | "solo_squad" | "packs") => {
    setSetSubTab(next);
    try {
      localStorage.setItem("jamassist_lineups_set_subtab", next);
    } catch {
      // ignore storage failure
    }
  };

  const submittedCardsCount = useMemo(() => {
    if (!gallery) return 0;
    return gallery.cards.filter(
      (c) => c.openedLineupIds && c.openedLineupIds.length > 0,
    ).length;
  }, [gallery]);

  const benchmarkSeasonScope: "in_season" | "classic" =
    seasonRule === "any_season" ? "classic" : "in_season";

  const formatRec = useMemo(() => {
    if (!gallery) return null;
    return recommendBestFormat(gallery.cards, {
      rarityFilter: rarityScope,
      projectionSource,
      customProjectionsRaw,
      injuriesByName: gallery.injuriesByName,
      gamesPerTeam: gallery.gamesPerTeam,
      scheduleByTeam: gallery.scheduleByTeam,
      excludeOut,
      excludeQuestionable,
      inSeasonOnly: strictInSeasonOnly,
      minInSeasonCards,
      disjointAcrossLineups: disjointLineups,
      ageFilter,
      captainBonusPct: 0,
      benchmarks: gallery.leaderboardBenchmarks,
      benchmarkSeasonScope,
    });
  }, [
    ageFilter,
    benchmarkSeasonScope,
    customProjectionsRaw,
    disjointLineups,
    excludeOut,
    excludeQuestionable,
    gallery,
    minInSeasonCards,
    projectionSource,
    rarityScope,
    strictInSeasonOnly,
  ]);

  const currentLineupComparisons = useMemo(() => {
    if (!gallery || !gallery.currentLineups?.length) return [];
    const nonEmpty = gallery.currentLineups.filter(
      (l) => l.cardSlugs.length > 0 || (l.playerNames?.length ?? 0) > 0,
    );
    if (nonEmpty.length === 0) return [];
    // Highest potential first: best current projection on top (ties: bigger possible gain first).
    return compareCurrentVsOptimalLineups(nonEmpty, gallery.cards, {
      rarityFilter: rarityScope,
      projectionSource,
      customProjectionsRaw,
      injuriesByName: gallery.injuriesByName,
      gamesPerTeam: gallery.gamesPerTeam,
      scheduleByTeam: gallery.scheduleByTeam,
      excludeOut,
      excludeQuestionable,
      inSeasonOnly: strictInSeasonOnly,
      minInSeasonCards,
      disjointAcrossLineups: false,
      captainBonusPct: 0,
      benchmarks: gallery.leaderboardBenchmarks,
      benchmarkSeasonScope,
    }).sort(
      (a, b) =>
        Math.max(b.currentProjected, b.optimalProjected ?? 0) - Math.max(a.currentProjected, a.optimalProjected ?? 0) ||
        b.currentProjected - a.currentProjected,
    );
  }, [
    benchmarkSeasonScope,
    customProjectionsRaw,
    excludeOut,
    excludeQuestionable,
    gallery,
    minInSeasonCards,
    projectionSource,
    rarityScope,
    strictInSeasonOnly,
  ]);

  const commonPool = gallery?.commonCards ?? [];

  // Live Daily Picker slate (today's games before the next 07:00 UTC reset + their rosters).
  const [dailyPool, setDailyPool] = useState<DailyPickerPool | null>(null);
  const injuryImpacts = useMemo(() => {
    if (!gallery) return [];
    return evaluateInjuryBeneficiaries(gallery.cards, gallery.injuriesByName, {
      rosterCards: dailyPool?.rosterCards,
      gamesPerTeam: gallery.gamesPerTeam,
    });
  }, [dailyPool?.rosterCards, gallery]);
  const [dailyPoolLoading, setDailyPoolLoading] = useState(false);
  const loadDailyPool = useCallback((refresh: boolean) => {
    setDailyPoolLoading(true);
    getDailyPickerPool(refresh)
      .then((pool) => {
        if (pool?.window) setDailyPool(pool);
      })
      .catch(() => {})
      .finally(() => setDailyPoolLoading(false));
  }, []);
  useEffect(() => {
    if (!gallery) return;
    loadDailyPool(false);
    // Re-check every 10 min so tip-offs and the 07:00 UTC reset move the slate along.
    const timer = setInterval(() => loadDailyPool(false), 10 * 60_000);
    return () => clearInterval(timer);
  }, [gallery, loadDailyPool]);


  // Solo stages finish as soon as the scores reach the target: "today first" can finish today.
  const [soloTiming, setSoloTiming] = useState<SetSoloTiming>(() => {
    try {
      const v = localStorage.getItem("setSoloTiming");
      return v === "today_first" || v === "any_day" ? v : "today_only";
    } catch {
      return "today_only";
    }
  });
  const chooseSoloTiming = (t: SetSoloTiming) => {
    setSoloTiming(t);
    try {
      localStorage.setItem("setSoloTiming", t);
    } catch {
      // Per-viewer convenience only.
    }
  };

  const setAutoBuilt = useMemo(() => {
    if (!gallery || commonPool.length === 0) return null;
    void buildSeed;
    return buildSetTeams(commonPool, {
      mode: setBuildMode,
      teamCount: effectiveSetTeams,
      projectionSource,
      customProjectionsRaw,
      injuriesByName: gallery.injuriesByName,
      // Set lineups are played on the daily slate: only teams with a game before the next reset.
      gamesPerTeam:
        dailyPool && dailyPool.window.teamSlugs.length > 0
          ? Object.fromEntries(dailyPool.window.teamSlugs.map((t) => [t, 1]))
          : gallery.gamesPerTeam,
      excludeOut,
      disjointAcrossTeams: disjointLineups,
      soloTiming,
      todayTeamSlugs: dailyPool?.window.teamSlugs ?? [],
      laterTeamSlugs: dailyPool?.laterTeamSlugs ?? [],
    });
  }, [
    buildSeed,
    commonPool,
    dailyPool,
    soloTiming,
    customProjectionsRaw,
    disjointLineups,
    excludeOut,
    gallery,
    projectionSource,
    setBuildMode,
    effectiveSetTeams,
  ]);

  // Skip Locked also covers lineups synced from sorare.com pages (names only, no card ids).
  const effectiveExcludedCardSlugs = useMemo(() => {
    if (!gallery || !excludeSubmittedCards) return excludedCardSlugs;
    const synced = resolveSyncedLineupCardSlugs(gallery.currentLineups ?? [], gallery.cards);
    return Array.from(new Set([...excludedCardSlugs, ...synced]));
  }, [excludeSubmittedCards, excludedCardSlugs, gallery]);

  // Lineup strategy: max projection, safe floor (p10) or high ceiling (p90), optimized directly in DFS.
  const [lineupStrategy, setLineupStrategy] = useState<"proj" | "floor" | "ceiling">("proj");

  const built = useMemo(() => {
    if (!gallery) return null;
    // Reference buildSeed so clicking Auto-Build triggers explicit recomputation feedback
    void buildSeed;
    return generateTopLineups(gallery.cards, {
      format,
      strategy: lineupStrategy,
      rarityFilter: rarityScope,
      projectionSource,
      customProjectionsRaw,
      injuriesByName: gallery.injuriesByName,
      gamesPerTeam: gallery.gamesPerTeam,
      scheduleByTeam: gallery.scheduleByTeam,
      excludeOut,
      excludeQuestionable,
      inSeasonOnly: strictInSeasonOnly,
      minInSeasonCards,
      disjointAcrossLineups: disjointLineups,
      ageFilter,
      excludeSubmittedCards,
      excludedCardSlugs: effectiveExcludedCardSlugs,
      maxLineups: entryLimit,
      captainBonusPct: 0,
      benchmarks: gallery.leaderboardBenchmarks,
      benchmarkSeasonScope,
    });
  }, [
    ageFilter,
    benchmarkSeasonScope,
    buildSeed,
    customProjectionsRaw,
    disjointLineups,
    excludeOut,
    excludeQuestionable,
    effectiveExcludedCardSlugs,
    entryLimit,
    excludeSubmittedCards,
    format,
    gallery,
    lineupStrategy,
    minInSeasonCards,
    projectionSource,
    rarityScope,
    strictInSeasonOnly,
  ]);

  const shownLineups = useMemo(
    () => (built?.lineups ?? []).slice(0, entryLimit),
    [built, entryLimit],
  );

  const effectiveMarketListings = useMemo(
    () =>
      allScannedBargains.length > 0
        ? allScannedBargains
        : (bargains?.listings ?? []),
    [allScannedBargains, bargains],
  );

  // Focus grade (computed only while its panel is open: it scans market listings).
  const [focusOpen, setFocusOpen] = useState(false);
  const focusAnalysis = useMemo(() => {
    if (!focusOpen || !gallery) return null;
    return analyzeFocusStrength(
      gallery.cards,
      {
        format,
        rarityFilter: rarityScope,
        projectionSource,
        customProjectionsRaw,
        injuriesByName: gallery.injuriesByName,
        gamesPerTeam: gallery.gamesPerTeam,
        scheduleByTeam: gallery.scheduleByTeam,
        excludeOut,
        excludeQuestionable,
        inSeasonOnly: strictInSeasonOnly,
        minInSeasonCards,
        disjointAcrossLineups: false,
        ageFilter,
        excludeSubmittedCards,
        excludedCardSlugs: effectiveExcludedCardSlugs,
        captainBonusPct: 0,
        benchmarks: gallery.leaderboardBenchmarks,
        benchmarkSeasonScope,
      },
      effectiveMarketListings,
      gallery.currentLineups ?? [],
    );
  }, [
    ageFilter,
    benchmarkSeasonScope,
    customProjectionsRaw,
    effectiveExcludedCardSlugs,
    effectiveMarketListings,
    excludeOut,
    excludeQuestionable,
    excludeSubmittedCards,
    focusOpen,
    format,
    gallery,
    minInSeasonCards,
    projectionSource,
    rarityScope,
    strictInSeasonOnly,
  ]);

  const budgetLineups = useMemo(() => {
    if (!gallery || effectiveMarketListings.length === 0) return [];
    return buildBudgetLineups(gallery.cards, effectiveMarketListings, {
      format,
      rarityFilter: rarityScope,
      projectionSource,
      customProjectionsRaw,
      injuriesByName: gallery.injuriesByName,
      gamesPerTeam: gallery.gamesPerTeam,
      scheduleByTeam: gallery.scheduleByTeam,
      budgetCents,
      includeOwned: includeOwnedInBudget,
      inSeasonOnly: strictInSeasonOnly,
      minInSeasonCards,
      captainBonusPct: 0,
    });
  }, [
    budgetCents,
    customProjectionsRaw,
    effectiveMarketListings,
    format,
    gallery,
    includeOwnedInBudget,
    minInSeasonCards,
    projectionSource,
    rarityScope,
    strictInSeasonOnly,
  ]);

  const portfolio = useMemo(() => {
    if (!gallery || arenaMode !== "pro") return null;
    void buildSeed;
    return optimizeMultiCompetitionPortfolio(gallery.cards, {
      rarityFilter: rarityScope,
      projectionSource,
      customProjectionsRaw,
      injuriesByName: gallery.injuriesByName,
      gamesPerTeam: gallery.gamesPerTeam,
      scheduleByTeam: gallery.scheduleByTeam,
      excludeOut,
      excludeQuestionable,
      inSeasonOnly: strictInSeasonOnly,
      minInSeasonCards,
      excludeSubmittedCards,
      excludedCardSlugs: effectiveExcludedCardSlugs,
      captainBonusPct: 0,
      benchmarks: gallery.leaderboardBenchmarks,
      benchmarkSeasonScope,
    });
  }, [
    arenaMode,
    benchmarkSeasonScope,
    buildSeed,
    customProjectionsRaw,
    excludeOut,
    excludeQuestionable,
    effectiveExcludedCardSlugs,
    excludeSubmittedCards,
    gallery,
    minInSeasonCards,
    projectionSource,
    rarityScope,
    strictInSeasonOnly,
  ]);

  const sortedSchedule = useMemo(() => {
    const map = gallery?.scheduleByTeam ?? {};
    return Object.values(map).sort((a, b) => {
      if (b.games !== a.games) return b.games - a.games;
      return a.teamName.localeCompare(b.teamName);
    });
  }, [gallery]);

  const dualBuyAdvisor = useMemo(() => {
    const topLineup = built?.lineups[0];
    if (!gallery || !topLineup || effectiveMarketListings.length === 0) {
      return null;
    }
    const ownedPlayerSlugs = new Set(gallery.cards.map((c) => c.playerSlug));
    const maxPriceNum = Number(buyMaxPriceEuros);
    const maxPriceCents =
      buyMaxPriceEuros.trim() && Number.isFinite(maxPriceNum) && maxPriceNum > 0
        ? Math.round(maxPriceNum * 100)
        : null;
    return recommendLineupMarketBuys(
      topLineup,
      ownedPlayerSlugs,
      collectionNeedSlugs ?? new Set<string>(),
      effectiveMarketListings,
      {
        format,
        rarityFilter: rarityScope,
        seasonRule,
        rankMode: buyRankMode,
        maxPriceCents,
        projectionSource,
        customProjectionsRaw,
        injuriesByName: gallery.injuriesByName,
        gamesPerTeam: gallery.gamesPerTeam,
        scheduleByTeam: gallery.scheduleByTeam,
        excludeOut,
        excludeQuestionable,
        captainBonusPct: 0,
      },
    );
  }, [
    built,
    buyMaxPriceEuros,
    buyRankMode,
    collectionNeedSlugs,
    customProjectionsRaw,
    effectiveMarketListings,
    excludeOut,
    excludeQuestionable,
    format,
    gallery,
    projectionSource,
    rarityScope,
    seasonRule,
  ]);

  const comboSwaps = useMemo(() => {
    const topLineup = built?.lineups[0];
    if (!gallery || !topLineup || effectiveMarketListings.length === 0) {
      return [];
    }
    const maxPriceNum = Number(buyMaxPriceEuros);
    const maxPriceCents =
      buyMaxPriceEuros.trim() && Number.isFinite(maxPriceNum) && maxPriceNum > 0
        ? Math.round(maxPriceNum * 100)
        : null;
    return recommendTwoCardComboSwaps(
      topLineup,
      gallery.cards,
      effectiveMarketListings,
      {
        format,
        rarityFilter: rarityScope,
        seasonRule,
        rankMode: buyRankMode,
        maxPriceCents,
        projectionSource,
        customProjectionsRaw,
        injuriesByName: gallery.injuriesByName,
        gamesPerTeam: gallery.gamesPerTeam,
        scheduleByTeam: gallery.scheduleByTeam,
        excludeOut,
        excludeQuestionable,
        captainBonusPct: 0,
      },
    );
  }, [
    built,
    buyMaxPriceEuros,
    buyRankMode,
    customProjectionsRaw,
    effectiveMarketListings,
    excludeOut,
    excludeQuestionable,
    format,
    gallery,
    projectionSource,
    rarityScope,
    seasonRule,
  ]);

  const compareCards = useMemo(() => {
    if (!gallery || compareSlugs.length === 0) return [];
    const cardMap = new Map(gallery.cards.map((c) => [c.slug, c]));
    return compareSlugs
      .map((s) => cardMap.get(s))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [compareSlugs, gallery]);

  if (!gallery && !isLoading) {
    return (
      <div className="rounded-2xl border border-white/8 bg-[#111726] p-6 text-center">
        <Wand2 className="mx-auto mb-2.5 h-7 w-7 text-amber-400" />
        <h2 className="jam-heading-balance text-sm font-semibold text-slate-100">
          Lineup Builder &amp; Auto-Optimizer
        </h2>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
          Loads your Sorare NBA gallery, upcoming Game Week schedule, and live
          ESPN injury reports to auto-build top lineups and estimate win odds.
        </p>
        <button
          type="button"
          disabled={!hasUsername}
          onClick={() => onLoadGallery(false)}
          className="mt-3.5 rounded-xl jam-btn-primary px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-sm disabled:opacity-50"
        >
          {hasUsername ? "Load Gallery & Injuries" : "Enter Username First"}
        </button>
      </div>
    );
  }

  const proGoUrl = format.startsWith("arena")
    ? buildArenaLineupsUrl(openFixture?.aasmState === "opened" ? openFixture.slug : null)
    : buildProPlayUrl();

  return (
    <div className="space-y-3">
      <StatusStrip
        gallery={gallery}
        reminderEnabled={cutoffReminderEnabled}
        onToggleReminder={onToggleCutoffReminder}
        onShowProgress={() => {
          setArenaMode("pro");
          setTimeout(() => document.getElementById("sec-progress")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        }}
      />

      {/* Pro vs Set/Common Mode Switcher (only when the top bar does not drive it) */}
      {mode === undefined && (
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/8 bg-[#111726] p-1.5">
        <button
          type="button"
          onClick={() => setArenaMode("pro")}
          className={`rounded-xl py-1.5 text-[11px] font-semibold transition ${
            arenaMode === "pro"
              ? "bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/40"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Pro Lineups ({gallery?.cards.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setArenaMode("set_common")}
          className={`rounded-xl py-1.5 text-[11px] font-semibold transition ${
            arenaMode === "set_common"
              ? "bg-set-500/20 text-set-200 ring-1 ring-set-400/40"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Set / Common ({commonPool.length})
        </button>
      </div>
      )}

      {/* Focused Sub-Tabs (reduces cognitive overload by splitting Overview, Builder, and Upgrades) */}
      {arenaMode === "pro" ? (
        <div
          role="tablist"
          aria-label="Pro lineup views"
          className="jam-subtabs"
        >
          {(
            [
              { id: "overview", label: "Overview & Live" },
              { id: "builder", label: "Builder" },
              { id: "upgrades", label: "Upgrades & Schedule" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={proSubTab === t.id}
              onClick={() => selectProSubTab(t.id)}
              className="jam-subtab cursor-pointer"
            >
              {t.label}
              {t.id === "upgrades" && injuryImpacts.length > 0 && (
                <span className="rounded-full bg-rose-500/25 px-1.5 py-0.2 text-[9px] font-bold text-rose-200">
                  {injuryImpacts.length}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div
          role="tablist"
          aria-label="Set lineup views"
          className="jam-subtabs"
        >
          {(
            [
              { id: "daily", label: "Daily Play" },
              { id: "solo_squad", label: "Solo & Squad" },
              { id: "packs", label: "Packs" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={setSubTab === t.id}
              onClick={() => selectSetSubTab(t.id)}
              className="jam-subtab cursor-pointer"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {arenaMode === "pro" && (
        <div
          role="tabpanel"
          aria-label="Overview & Live"
          hidden={proSubTab !== "overview"}
          className={proSubTab === "overview" ? "jam-panel-enter space-y-3" : "hidden"}
        >
          <div id="sec-progress">
            <ProProgressCard gallery={gallery} />
          </div>

      {/* Current Submitted/Open Lineups & Upgrade Swaps */}
      {gallery && (
        <details id="sec-swaps"
          open={currentLineupComparisons.length > 0}
          className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]"
        >
          <summary className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
              <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-sky-400" />
              <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
              Upcoming Lineups &amp; Upgrade Swaps
            </span>
            <span className="text-[10px] text-slate-400">
              {currentLineupComparisons.length} submitted
            </span>
          </summary>

          <div className="space-y-2 border-t border-white/8 bg-[#0b101b] p-3 text-[11px]">
            {currentLineupComparisons.length === 0 ? (
              <div className="space-y-2 text-slate-400">
                <p className="leading-relaxed">
                  No lineups for the upcoming Game Week yet. Sorare keeps lineups private (the public API never returns them), so they are read from your logged-in Sorare tab: open the upcoming Game Week&apos;s Lineups page once and press Refresh. Live Game Week lineups show in Current Pro Progress.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      // Open (pre-lock) lineups live on the upcoming fixture page; /ongoing only shows locked LIVE lineups.
                      void openInActiveTab(
                        buildArenaLineupsUrl(
                          openFixture?.aasmState === "opened" ? openFixture.slug : null,
                        ),
                      )
                    }
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg jam-btn-primary px-2.5 py-1.5 text-[10px] font-bold text-slate-950 shadow-sm"
                  >
                    Open Sorare Arena to Sync
                    <ExternalLink className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void openInActiveTab(buildProPlayUrl())
                    }
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/15 bg-[#111726] px-2.5 py-1.5 text-[10px] font-semibold text-slate-200 hover:border-white/30"
                  >
                    Open Pro Play
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <>
              {(() => {
                const captured = currentLineupComparisons
                  .map((c) => c.entry.detectedAt)
                  .filter((t): t is number => typeof t === "number");
                if (captured.length === 0) return null;
                const ageMin = Math.max(0, Math.round((Date.now() - Math.min(...captured)) / 60_000));
                const stale = ageMin >= 120;
                const ageText = ageMin < 60 ? `${ageMin}m` : `${Math.round(ageMin / 60)}h`;
                return (
                  <div
                    className={`flex flex-wrap items-center justify-between gap-1 rounded-lg px-2 py-1 text-[10px] ${
                      stale ? "border border-amber-400/30 bg-amber-500/10 text-amber-200" : "text-slate-400"
                    }`}
                  >
                    <span>
                      Page-synced {ageText} ago
                      {stale ? ": edits made on Sorare since then are not shown." : "."}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void openInActiveTab(
                          buildArenaLineupsUrl(
                            openFixture?.aasmState === "opened" ? openFixture.slug : null,
                          ),
                        )
                      }
                      className="rounded-md jam-btn-secondary px-1.5 py-0.5 font-semibold text-sky-100"
                    >
                      Open Sorare Lineups to refresh
                    </button>
                  </div>
                );
              })()}
              {currentLineupComparisons.map((cmp) => {
                const lowerName = cmp.entry.leaderboardName.toLowerCase();
                const fallbackTarget = lowerName.includes("contender")
                  ? 145
                  : lowerName.includes("champion")
                    ? 205
                    : 155;
                const essTarget = Math.round(cmp.paidCutoffScore ?? fallbackTarget);
                const progressPct = Math.min(
                  100,
                  Math.round((cmp.currentProjected / Math.max(1, essTarget)) * 100),
                );
                const activeSlugs = new Set(
                  cmp.resolvedCardSlugs ?? cmp.entry.cardSlugs,
                );
                const submittedCards = gallery.cards.filter((gc) =>
                  activeSlugs.has(gc.slug),
                );
                const hotCount = submittedCards.filter(
                  (gc) => gc.l5 !== null && gc.l10 !== null && gc.l5 - gc.l10 >= 3.5,
                ).length;
                const coldCount = submittedCards.filter(
                  (gc) => gc.l5 !== null && gc.l10 !== null && gc.l5 - gc.l10 <= -3.5,
                ).length;

                let totalSlateGames = 0;
                let completedSlateGames = 0;
                let liveSlateGames = 0;
                let remainingSlateGames = 0;
                const liveClocks: string[] = [];
                for (const gc of submittedCards) {
                  const sched = gc.teamSlug
                    ? gallery.scheduleByTeam?.[gc.teamSlug]
                    : undefined;
                  if (!sched) continue;
                  totalSlateGames += sched.games;
                  completedSlateGames += sched.completedGames ?? 0;
                  liveSlateGames += sched.liveGames ?? 0;
                  remainingSlateGames += sched.upcomingGames ?? 0;
                  if (sched.liveClockLabel && liveClocks.length < 2) {
                    liveClocks.push(sched.liveClockLabel);
                  }
                }
                const paceBadge =
                  progressPct >= 95
                    ? { label: "On Pace", kind: "hot" as const, cls: "text-emerald-300" }
                    : progressPct >= 80
                      ? { label: "Close Sweat", kind: "close" as const, cls: "text-amber-300" }
                      : { label: "Behind Cut", kind: "cold" as const, cls: "text-rose-300" };

                return (
                <div
                  key={cmp.entry.id}
                  className="rounded-xl border border-white/8 bg-[#111726] p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1 font-semibold text-slate-100">
                      <span>{cmp.entry.leaderboardName}</span>
                      {cmp.entry.source === "dom" && (
                        <span className="rounded border border-emerald-400/35 bg-emerald-500/15 px-1 text-[8.5px] font-bold text-emerald-200">
                          Live Synced
                        </span>
                      )}
                      {cmp.entry.draft && (
                        <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">
                          DRAFT
                        </span>
                      )}
                    </div>
                    <div className="text-[11px]">
                      <span className="font-semibold text-slate-200">
                        {cmp.currentProjected.toFixed(1)}
                      </span>
                      {cmp.optimalProjected !== null && (
                        <span className="text-slate-400">
                          {" "}
                          / Opt {cmp.optimalProjected.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Visual 5-Card Artwork Preview Strip & p10-mean-p90 Range Bar */}
                  {submittedCards.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <LineupCardStrip
                        compact
                        cards={submittedCards.slice(0, 5).map((gc) => ({
                          key: gc.slug,
                          playerName: gc.playerName,
                          teamSlug: gc.teamSlug,
                          rarity: gc.rarity,
                          pictureUrl: gc.pictureUrl,
                          starCost: gc.starCost,
                          projectedPts: gc.sorareClassicProjected ?? gc.l10,
                          isCaptain: cmp.entry.captainCardSlug === gc.slug,
                        }))}
                      />
                      <LineupRangeBar
                        p10={cmp.overlaySummary?.p10Floor ?? Math.max(0, cmp.currentProjected * 0.78)}
                        mean={cmp.currentProjected}
                        p90={cmp.overlaySummary?.p90Ceiling ?? cmp.currentProjected * 1.24}
                        cutLine={essTarget}
                        label={cmp.entry.leaderboardName}
                      />
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[9.5px] text-slate-400">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/50">
                      <div
                        className="h-full bg-emerald-400"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <span>
                        {progressPct}% of {essTarget} cut
                        {cmp.estRank && cmp.estTotalEntries
                          ? ` • Est. #${cmp.estRank.toLocaleString()}/${cmp.estTotalEntries.toLocaleString()}`
                          : ""}
                      </span>
                      <strong className={`inline-flex items-center gap-0.5 ${paceBadge.cls}`}>
                        {paceBadge.kind === "hot" ? (
                          <Flame className="h-2.5 w-2.5" />
                        ) : paceBadge.kind === "close" ? (
                          <Zap className="h-2.5 w-2.5" />
                        ) : (
                          <Snowflake className="h-2.5 w-2.5" />
                        )}
                        {paceBadge.label}
                      </strong>
                      {hotCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-300">
                          <Flame className="h-2.5 w-2.5" />
                          {hotCount}
                        </span>
                      )}
                      {coldCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-sky-300">
                          <Snowflake className="h-2.5 w-2.5" />
                          {coldCount}
                        </span>
                      )}
                    </span>
                  </div>
                  {submittedCards.length > 0 && (
                    <div className="mt-1 truncate text-[9.5px] text-slate-400">
                      Lineup ({submittedCards.length}/5):{" "}
                      {submittedCards.map((sc) => sc.playerName).join(" • ")}
                    </div>
                  )}
                  {cmp.overlaySummary && submittedCards.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-slate-400">
                      <span title="10th to 90th percentile of the lineup score (variance model)">
                        Floor/Ceiling:{" "}
                        <strong className="text-slate-200">
                          {cmp.overlaySummary.p10Floor.toFixed(0)} / {cmp.overlaySummary.p90Ceiling.toFixed(0)}
                        </strong>
                      </span>
                      {cmp.overlaySummary.totalBoostPct !== 0 && (
                        <span>Avg boost +{cmp.overlaySummary.totalBoostPct}%</span>
                      )}
                      {cmp.overlaySummary.riskFlags.slice(0, 2).map((f) => (
                        <span key={f} className="text-rose-300">
                          {f}
                        </span>
                      ))}
                      {cmp.overlaySummary.upsideFlags.slice(0, 2).map((f) => (
                        <span key={f} className="text-emerald-300">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                  {(cmp.editFocusPoints ?? []).filter((p) => p.kind !== "swap").length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[9.5px] text-slate-300">
                      {(cmp.editFocusPoints ?? [])
                        .filter((p) => p.kind !== "swap")
                        .slice(0, 4)
                        .map((p, i) => (
                          <li key={`${p.kind}-${i}`} className="flex gap-1">
                            <span className="shrink-0 rounded bg-white/5 px-1 text-[8.5px] uppercase text-slate-400">
                              {p.kind}
                            </span>
                            <span>{p.text}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  {totalSlateGames > 0 && (
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[9.5px] text-slate-400">
                      <span>
                        GW Sweat: {completedSlateGames}/{totalSlateGames}G played •{" "}
                        {liveSlateGames > 0 && (
                          <strong className="text-emerald-300">
                            {liveSlateGames} LIVE •{" "}
                          </strong>
                        )}
                        {remainingSlateGames}G left
                      </span>
                      {liveClocks.length > 0 && (
                        <span className="text-sky-300">{liveClocks.join(" • ")}</span>
                      )}
                    </div>
                  )}
                  {cmp.swaps.length > 0 ? (
                    <div className="mt-1.5 space-y-1">
                      {cmp.swaps.map((sw, idx) => (
                        <div
                          key={idx}
                          title={sw.reason}
                          className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[10px] ${
                            sw.kind === "cap_fix"
                              ? "border border-amber-400/25 bg-amber-500/5"
                              : "bg-[#0b101b]"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-1 text-slate-300">
                            {sw.kind === "cap_fix" && (
                              <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-300">
                                Cap fix
                              </span>
                            )}
                            <span className="truncate text-rose-300">{sw.outPlayer}</span>
                            <ArrowRight className="h-2.5 w-2.5 shrink-0 text-slate-500" />
                            <span className="truncate text-emerald-300">{sw.inPlayer}</span>
                            {sw.usedInOtherLineup && (
                              <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] text-sky-300">
                                in other lineup
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span
                              className={`font-semibold ${
                                sw.deltaPts >= 0 ? "text-emerald-300" : "text-amber-300"
                              }`}
                            >
                              {sw.deltaPts >= 0 ? "+" : ""}
                              {sw.deltaPts.toFixed(1)} pts
                            </span>
                            <Info
                              className="h-3 w-3 cursor-help text-slate-500 hover:text-slate-300"
                              aria-label={sw.reason}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-[10px] text-emerald-300">
                      {cmp.optimalProjected !== null &&
                      cmp.optimalProjected < cmp.currentProjected
                        ? `Your lineup already beats the calculated optimum (${cmp.currentStars}★${cmp.starCap ? ` / ${cmp.starCap}★` : ""}).`
                        : `Matches optimal core (${cmp.currentStars}★${cmp.starCap ? ` / ${cmp.starCap}★` : ""}).`}
                    </div>
                  )}
                  {cmp.betterCaptainName && (
                    <div className="mt-1 text-[10px] text-amber-300">
                      MVP Slot Tip: Assign Cap-Free MVP to{" "}
                      <strong>{cmp.betterCaptainName}</strong>.
                    </div>
                  )}
                </div>
                );
              })}
              </>
            )}
          </div>
        </details>
      )}

      {/* Optimal Entry Disclosure + Recommended Competition Priority */}
      {formatRec && (
        <div id="sec-entry" className="rounded-2xl border border-white/8 bg-[#101829] p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 rounded-lg bg-sky-500/20 p-1.5 text-sky-300">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-sky-200">
                    Recommended Entry:{" "}
                    {FORMAT_OPTIONS.find((f) => f.id === formatRec.recommendedFormat)
                      ?.label ?? formatRec.recommendedFormat}
                  </span>
                  <span className="rounded border border-sky-400/35 bg-sky-500/15 px-1 text-[9px] font-bold uppercase text-sky-200">
                    Optimal EV
                  </span>
                  {formatRec.fieldPaidPct !== undefined && (
                    <span className="rounded border border-emerald-400/35 bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-200">
                      {formatRec.fieldPaidPct}% rewarded
                      {formatRec.paidCutoffScore
                        ? ` • Cut ~${Math.round(formatRec.paidCutoffScore)}`
                        : ""}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                  {formatRec.reason}
                </p>
                {formatRec.inSeasonVsClassicTip && (
                  <p className="mt-1 text-[10px] font-medium text-amber-300">
                    {formatRec.inSeasonVsClassicTip}
                  </p>
                )}
              </div>
            </div>
            {format !== formatRec.recommendedFormat && (
              <button
                type="button"
                onClick={() => setFormat(formatRec.recommendedFormat)}
                className="shrink-0 rounded-lg bg-sky-400 px-2.5 py-1 text-[10px] font-semibold text-slate-950 hover:bg-sky-300"
              >
                Switch
              </button>
            )}
          </div>
          {formatRec.candidates.length > 1 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[10px] tabular-nums text-slate-300">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="font-medium">Contest</th>
                    <th className="text-right font-medium">Top</th>
                    <th
                      className="text-right font-medium"
                      title="Odds of any reward: Essence or cash (XP-only ranks not counted)"
                    >
                      Reward
                    </th>
                    <th className="text-right font-medium" title="Odds of finishing in the real cash (USD) ranks">
                      Cash $
                    </th>
                    <th className="text-right font-medium">Podium</th>
                  </tr>
                </thead>
                <tbody>
                  {formatRec.candidates.slice(0, 5).map((c, i) => (
                    <tr
                      key={`${c.format}-${c.seasonScope}`}
                      className={i === 0 ? "text-sky-200" : c.viable ? "" : "text-slate-500"}
                    >
                      <td className="truncate pr-1">{c.label}</td>
                      <td className="text-right">{c.topScore !== null ? c.topScore.toFixed(0) : "--"}</td>
                      <td className="text-right">{c.cashProb.toFixed(0)}%</td>
                      <td
                        className="text-right"
                        title={
                          c.cashPlaces
                            ? `Cash for the top ${c.cashPlaces}${c.topCashLabel ? `, up to ${c.topCashLabel}` : ""}`
                            : "Cash ranks not loaded"
                        }
                      >
                        {c.moneyProb !== null && c.moneyProb !== undefined ? `${c.moneyProb.toFixed(0)}%` : "--"}
                      </td>
                      <td className="text-right">{c.podiumProb.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(() => {
                const topCand = formatRec.candidates[0];
                const tiers = topCand?.rewardTiers ?? [];
                if (
                  tiers.length === 0 &&
                  !topCand?.expectedCashUsd &&
                  !topCand?.expectedEssence
                ) {
                  return null;
                }
                return (
                  <div className="mt-2 space-y-1 border-t border-white/6 pt-2">
                    <div className="text-[9.5px] font-medium text-slate-400">
                      Live Reward Preview ({topCand.label}, last GW):
                    </div>
                    <RewardPreviewStrip
                      tiers={tiers}
                      expectedCashUsd={topCand.expectedCashUsd}
                      expectedEssence={topCand.expectedEssence}
                    />
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Pro Daily Play pickers */}
      <div id="sec-pro-daily"><DailyPlayHub gallery={gallery} pool={dailyPool} poolLoading={dailyPoolLoading} onRefreshPool={() => loadDailyPool(true)} missions={["pro_daily", "double_double", "rebounds"]} /></div>
        </div>
      )}

      {/* SET / COMMON MODE WORKSPACE */}
      {arenaMode === "set_common" && (
        <div className="space-y-3">
          {/* Set packs: Daily Pack, Bronze+, Live Today, 3★+ odds */}
          <div
            role="tabpanel"
            aria-label="Packs"
            hidden={setSubTab !== "packs"}
            className={setSubTab === "packs" ? "jam-panel-enter" : "hidden"}
          >
            <div id="sec-set-packs"><PackAdvisorCard commonEssence={commonEssence} /></div>
          </div>

          {/* Set Squad & Solo Team Builder */}
          <div
            role="tabpanel"
            aria-label="Solo & Squad"
            hidden={setSubTab !== "solo_squad"}
            className={setSubTab === "solo_squad" ? "jam-panel-enter space-y-3" : "hidden"}
          >
            <div id="sec-set-squad"><SquadActivityCard mySlug={gallery?.username ?? null} /></div>

          {/* Configurable N Teams Auto-Builder for Solo / Squad */}
          <div id="sec-set-builder" className="space-y-2.5 rounded-2xl border border-white/8 bg-[#111726] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/8 bg-[#0b101b] p-0.5">
                <button
                  type="button"
                  onClick={() => setSetBuildMode("solo")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    setBuildMode === "solo"
                      ? "bg-sky-500/15 text-sky-100"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Solo Mode
                </button>
                <button
                  type="button"
                  onClick={() => setSetBuildMode("squad")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    setBuildMode === "squad"
                      ? "bg-sky-500/15 text-sky-100"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Squad Mode
                </button>
              </div>
              <GoButton
                url={buildSetPlayUrl(setBuildMode === "squad" ? "squad" : "arcade")}
                title={setBuildMode === "squad" ? "Open Set Squad on Sorare" : "Open Set Solo play on Sorare"}
              />

              <label className="inline-flex items-center gap-1.5 rounded-xl border border-white/8 bg-[#0b101b] px-2.5 py-1 text-[11px] text-slate-300">
                Teams:
                <input
                  type="number"
                  min={1}
                  max={setMaxTeams}
                  value={effectiveSetTeams}
                  aria-label="Number of Set teams"
                  onChange={(e) =>
                    setSetTeamCount(
                      Math.max(1, Math.min(setMaxTeams, Number(e.target.value) || 1)),
                    )
                  }
                  className="w-8 bg-transparent text-center font-semibold text-amber-300 focus:outline-none"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => setBuildSeed((s) => s + 1)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl jam-btn-primary py-2 text-xs font-semibold text-slate-950 shadow-sm"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Auto-Build {effectiveSetTeams}{" "}
              {setBuildMode === "solo" ? "Solo Teams (5 cards, 16★)" : "Squad Team (5 cards, 16★)"}
            </button>

            {setBuildMode === "solo" && (
              <div className="flex flex-wrap items-center gap-1 text-[10px]">
                <span className="text-slate-400">Game days:</span>
                {(
                  [
                    ["today_only", "Only today", "Only players with a game today (before the 07:00 UTC reset)"],
                    [
                      "today_first",
                      "Prioritize today (fast finish)",
                      "A Solo stage completes as soon as your players' scores reach the target, even if others play later. Ranks today's players first and fills with tomorrow's.",
                    ],
                    ["any_day", "Best of today + tomorrow", "Highest projection across today's and tomorrow's games, no preference"],
                  ] as Array<[SetSoloTiming, string, string]>
                ).map(([id, label, hint]) => (
                  <button
                    key={id}
                    type="button"
                    title={hint}
                    onClick={() => chooseSoloTiming(id)}
                    className={`rounded-lg border px-2 py-0.5 font-semibold ${
                      soloTiming === id ? "border-sky-400/50 bg-sky-500/15 text-sky-100" : "border-white/10 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {soloTiming !== "today_only" && (dailyPool?.laterTeamSlugs?.length ?? 0) === 0 && (
                  <span className="text-amber-300">Tomorrow's games not loaded yet: using today only.</span>
                )}
              </div>
            )}

            {setAutoBuilt && setBuildMode === "solo" && (
              <div className="space-y-2">
                {setAutoBuilt.soloTeams.length === 0 && (
                  <div className="text-xs text-slate-400">
                    Not enough Common cards for a 5-card team under the 16★ cap.
                  </div>
                )}
                {setAutoBuilt.soloTeams.map((team, idx) => {
                  const lu = team.lineup;
                  const names = lu.slots.map((sl) => sl.evaluated.card.playerName);
                  const label = `Set Solo #${idx + 1}`;
                  return (
                    <div key={lu.rank} className="rounded-xl border border-white/8 bg-[#0b101b] p-2.5">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-emerald-300">
                          {label} • {team.projectedTotal.toFixed(1)} pts •{" "}
                          {lu.capLimit ? `${lu.capUsed}/${lu.capLimit}★` : `${lu.totalStars}★`}
                          {team.avgBoostPct > 0 && (
                            <span className="ml-1 text-[10px] font-normal text-sky-300">
                              +{team.avgBoostPct}% boost
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              void applyLineupHighlight(
                                names,
                                label,
                                team.projectedTotal,
                                lu.slots.map((sl) => ({
                                  slotLabel: sl.slotLabel,
                                  cardSlug: sl.evaluated.card.slug,
                                  playerName: sl.evaluated.card.playerName,
                                  rarity: sl.evaluated.card.rarity,
                                  seasonYear: sl.evaluated.card.seasonYear,
                                  isCaptain: sl.isCaptainOrMvp,
                                })),
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200"
                          >
                            <Send className="h-2.5 w-2.5" />
                            Apply
                          </button>
                          <GoButton url={buildSetPlayUrl("arcade")} title="Open Set Solo play on Sorare" />
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300">
                        {lu.slots
                          .map((sl) => {
                            const t = sl.evaluated.card.teamSlug;
                            const isToday = !dailyPool || (t !== null && dailyPool.window.teamSlugs.includes(t));
                            const w = soloTiming === "today_first" && !isToday ? SET_SOLO_LATER_WEIGHT : 1;
                            return `${sl.evaluated.card.playerName} ${(sl.slotScore / w).toFixed(0)}${
                              soloTiming !== "today_only" ? (isToday ? " (today)" : " (tmrw)") : ""
                            }`;
                          })
                          .join(" • ")}
                      </div>
                      {soloTiming !== "today_only" && (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9.5px] text-sky-300">
                          <span>
                            Today: {team.todayPlayers} player{team.todayPlayers === 1 ? "" : "s"}, {team.todayProjected.toFixed(0)} pts • finish today:
                          </span>
                          {team.todayStepOdds.slice(0, 4).map((o) => (
                            <span key={o.target}>
                              {o.target}: {o.hitPct}%
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[9.5px] text-slate-400">
                        <span>Step odds:</span>
                        {team.stepOdds.slice(0, 4).map((o) => (
                          <span
                            key={o.target}
                            className={o.hitPct >= 60 ? "text-emerald-300" : o.hitPct >= 30 ? "text-amber-300" : ""}
                          >
                            {o.target}: {o.hitPct}%
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {setAutoBuilt && setBuildMode === "squad" && (
              <div className="space-y-2">
                {setAutoBuilt.squadTeams.map((team) => {
                  const names = team.slots.map((s) => s.evaluated.card.playerName);
                  return (
                    <div
                      key={team.rank}
                      className="rounded-xl border border-white/8 bg-[#0b101b] p-2.5"
                    >
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="font-semibold text-emerald-300">
                          Set Squad #{team.rank} • {team.totalScore.toFixed(1)}{" "}
                          pts
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void applyLineupHighlight(
                              names,
                              `Set Squad #${team.rank}`,
                              team.totalScore,
                              team.slots.map((s) => ({
                                slotLabel: s.slotLabel,
                                cardSlug: s.evaluated.card.slug,
                                playerName: s.evaluated.card.playerName,
                                rarity: s.evaluated.card.rarity,
                                seasonYear: s.evaluated.card.seasonYear,
                                isCaptain: s.isCaptainOrMvp,
                              })),
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200"
                        >
                          <Send className="h-2.5 w-2.5" />
                          Apply
                        </button>
                        <GoButton url={buildSetPlayUrl("squad")} title="Open Set Squad on Sorare" />
                      </div>
                      <LineupCardStrip
                        compact
                        cards={team.slots.map((s) => ({
                          key: s.evaluated.card.slug,
                          playerName: s.evaluated.card.playerName,
                          teamSlug: s.evaluated.card.teamSlug,
                          rarity: s.evaluated.card.rarity,
                          pictureUrl: s.evaluated.card.pictureUrl,
                          starCost: s.evaluated.card.starCost,
                          projectedPts: s.slotScore,
                          isCaptain: s.isCaptainOrMvp,
                        }))}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>

          {/* Daily Play: Set Daily Picker (best / safe / risk picks, owned vs not owned) */}
          <div
            role="tabpanel"
            aria-label="Daily Play"
            hidden={setSubTab !== "daily"}
            className={setSubTab === "daily" ? "jam-panel-enter space-y-3" : "hidden"}
          >
              <div id="sec-set-daily"><DailyPlayHub gallery={gallery} pool={dailyPool} poolLoading={dailyPoolLoading} onRefreshPool={() => loadDailyPool(true)} missions={["set_daily"]} /></div>

              {/* Set Quests & Arcade Guide */}
              <details id="sec-set-guide" className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]">
            <summary className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
                <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                Set Daily Quests, Picker &amp; Arcade Guide
              </span>
              <span className="text-[10px] text-slate-400">Common Mode</span>
            </summary>
            <div className="space-y-1.5 border-t border-white/8 bg-[#0b101b] p-3 text-[10px] text-slate-300">
              <div>
                <strong className="text-emerald-300">1. Daily Quests:</strong>{" "}
                Open Daily Pack • Buy a Pack • Play Daily Picker • Collect ≥ 3★
                player to stack Energy &amp; Set Essence.
              </div>
              <div>
                <strong className="text-amber-300">2. Daily Picker:</strong>{" "}
                Must score{" "}
                <strong className="text-slate-100">
                  both ≥ L10 + 7 pts AND ≥ 20 pts
                </strong>
                . Ideal picks are healthy high-minute starters whose L10 is
                temporarily dipped (e.g. L10 = 12-18, projected ≥ 24).
              </div>
              <div>
                <strong className="text-sky-300">3. Solo vs Squad Mode:</strong>{" "}
                Solo Arcade prioritizes your single highest-ceiling active
                anchor per step; Squad Mode builds multiple Cap 120 + MVP teams
                for leaderboard checkpoints.
              </div>
            </div>
          </details>
          </div>
        </div>
      )}

      {/* PRO MODE: Format & Projection Reference Controls (Builder & Upgrades Sub-Tabs) */}
      {arenaMode === "pro" && (
        <>
          <div
            role="tabpanel"
            aria-label="Builder"
            hidden={proSubTab !== "builder"}
            className={proSubTab === "builder" ? "jam-panel-enter space-y-3" : "hidden"}
          >
          <div id="sec-builder" className="space-y-2 rounded-2xl border border-white/8 bg-[#111726] p-3">
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
          {FORMAT_OPTIONS.map((opt) => {
            const active = format === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFormat(opt.id)}
                className={`cursor-pointer rounded-xl border px-1.5 py-1.5 text-center transition ${
                  active
                    ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                    : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
                }`}
              >
                <div className="text-[10px] font-semibold leading-tight">
                  {opt.label}
                </div>
                <div className="text-[9px] opacity-80">{opt.sub}</div>
              </button>
            );
          })}
        </div>

        {/* Arena Sub-Room Age Eligibility Filter */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-white/8 bg-[#0b101b] px-2 py-1 text-[10px]">
          <span className="font-medium text-slate-400">Arena Sub-Room:</span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: "all", label: "All Ages" },
                { id: "u23", label: "U23 (<=23)" },
                { id: "veterans", label: "Veterans (30+)" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAgeFilter(opt.id)}
                className={`cursor-pointer rounded-md px-2 py-0.5 font-semibold transition ${
                  ageFilter === opt.id
                    ? "bg-sky-500/25 text-sky-200"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-1.5 text-xs">
          <div className="col-span-8">
            <select
              value={projectionSource}
              onChange={(e) =>
                onUpdateProjectionSource(e.target.value as ProjectionSource)
              }
              className="w-full rounded-xl border border-white/10 bg-[#0b101b] px-2.5 py-1.5 text-[11px] font-medium text-slate-100 focus:border-amber-400 focus:outline-none"
              aria-label="Projection source"
            >
              {SOURCE_OPTIONS.map((src) => (
                <option key={src.id} value={src.id}>
                  Ref: {src.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-4">
            <select
              value={rarityScope}
              onChange={(e) =>
                setRarityScope(e.target.value as Rarity | "ALL")
              }
              className="w-full rounded-xl border border-white/10 bg-[#0b101b] px-2 py-1.5 text-[11px] font-medium text-slate-100 focus:border-amber-400 focus:outline-none"
              aria-label="Gallery rarity scope"
            >
              <option value="ALL">All Rarities</option>
              <option value="limited">Limited</option>
              <option value="rare">Rare</option>
              <option value="super_rare">Super Rare</option>
              <option value="unique">Unique</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/8 bg-[#0b101b] p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setSeasonRule("4_in_1_classic")}
            className={`rounded-lg px-2 py-1 font-semibold transition ${
              seasonRule === "4_in_1_classic"
                ? "bg-sky-500/15 text-sky-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Allows 1 Out-of-Season Classic card alongside 4 In-Season (26-27) cards"
          >
            4 In-S + 1 Classic
          </button>
          <button
            type="button"
            onClick={() => setSeasonRule("5_in_season")}
            className={`rounded-lg px-2 py-1 font-semibold transition ${
              seasonRule === "5_in_season"
                ? "bg-sky-500/20 text-sky-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Strictly 5/5 current 2026-27 In-Season cards"
          >
            5/5 In-Season
          </button>
          <button
            type="button"
            onClick={() => setSeasonRule("any_season")}
            className={`rounded-lg px-2 py-1 font-semibold transition ${
              seasonRule === "any_season"
                ? "bg-violet-500/20 text-violet-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="No In-Season minimum (unlimited Classic prior-season cards)"
          >
            Any Season
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExcludeOut((v) => !v)}
              className={`rounded-lg border px-2 py-0.5 transition ${
                excludeOut
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
                  : "border-white/8 bg-[#0b101b] text-slate-400"
              }`}
            >
              Hide OUT
            </button>
            <button
              type="button"
              onClick={() => setExcludeQuestionable((v) => !v)}
              className={`rounded-lg border px-2 py-0.5 transition ${
                excludeQuestionable
                  ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                  : "border-white/8 bg-[#0b101b] text-slate-400"
              }`}
            >
              Hide GTD
            </button>
            <button
              type="button"
              onClick={() => setDisjointLineups((v) => !v)}
              className={`rounded-lg border px-2 py-0.5 transition ${
                disjointLineups
                  ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                  : "border-white/8 bg-[#0b101b] text-slate-400"
              }`}
              title="Prevent reusing the same card across Lineup #1, #2, #3"
            >
              Unique Picks
            </button>
            {submittedCardsCount > 0 && (
              <button
                type="button"
                onClick={() => setExcludeSubmittedCards((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 transition ${
                  excludeSubmittedCards
                    ? "border-violet-400/45 bg-violet-500/15 text-violet-200"
                    : "border-white/8 bg-[#0b101b] text-slate-400"
                }`}
                title="Exclude cards already locked inside open Sorare Pro lineups"
              >
                <Lock className="h-2.5 w-2.5" />
                Skip Locked ({submittedCardsCount})
              </button>
            )}
            {excludedCardSlugs.length > 0 && (
              <button
                type="button"
                onClick={() => setExcludedCardSlugs([])}
                className="rounded-lg border border-rose-400/35 bg-rose-500/10 px-2 py-0.5 text-rose-200 hover:bg-rose-500/20"
              >
                Reset ({excludedCardSlugs.length} skipped)
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowCustomEditor((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#0b101b] px-2 py-0.5 text-[10px] text-slate-300 hover:border-amber-400/40"
          >
            <FileSpreadsheet className="h-3 w-3 text-amber-400" />
            Import CSV
          </button>
        </div>

        {showCustomEditor && (
          <div className="rounded-xl border border-white/10 bg-[#0b101b] p-2.5 text-xs">
            <div className="mb-1 text-[10px] text-slate-400">
              Paste external projections (<code>Player Name, Score</code> per
              line from RotoWire / Hashtag Basketball / SorareNBAJet):
            </div>
            <textarea
              rows={4}
              value={customDraft}
              aria-label="Custom external player projections CSV"
              onChange={(e) => setCustomDraft(e.target.value)}
              placeholder={"Victor Wembanyama, 64.5\nLuka Doncic, 68.0"}
              className="w-full rounded-lg border border-white/10 bg-[#141c2f] p-2 font-mono text-[11px] text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCustomEditor(false)}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onSaveCustomProjections(customDraft);
                  onUpdateProjectionSource("custom_csv");
                  setShowCustomEditor(false);
                }}
                className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
              >
                Apply External Projections
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setBuildSeed((s) => s + 1);
            const fmtName =
              FORMAT_OPTIONS.find((f) => f.id === format)?.label ?? format;
            const count = built?.lineups.length ?? 0;
            setRebuildNotice(
              count > 0
                ? `Rebuilt top ${count} ${fmtName} lineup${count > 1 ? "s" : ""} below`
                : `Checked ${fmtName} pool - adjust filters above`,
            );
            lineupsResultRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
            window.setTimeout(() => setRebuildNotice(null), 2600);
          }}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl jam-btn-primary py-2 text-xs font-semibold text-slate-950 shadow-sm transition active:scale-[0.99]"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Auto-Build Best Pro Lineups
        </button>
        {rebuildNotice && (
          <div className="rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2.5 py-1 text-center text-[10.5px] font-semibold text-emerald-200">
            {rebuildNotice}
          </div>
        )}
      </div>

      {/* 2-Player Head-to-Head Compare Matrix */}
      <HeadToHeadCompareBox
        cards={compareCards}
        currency={currency}
        scheduleByTeam={gallery?.scheduleByTeam}
        gamesPerTeam={gallery?.gamesPerTeam}
        onRemove={(slug) =>
          setCompareSlugs((prev) => prev.filter((s) => s !== slug))
        }
        onClear={() => setCompareSlugs([])}
      />

      {/* Suggested Top Pro Lineups */}
      <div ref={lineupsResultRef} className="space-y-3">
      {built && built.lineups.length > 0 && (
        <div className="px-1 text-[10px] text-slate-400">
          <div className="flex flex-wrap items-center gap-1">
            <span>
              Showing {shownLineups.length} / {entryLimit} lineups (up to {entryLimit} entries for this
              competition) •
            </span>
            {(
              [
                { id: "proj", label: "Max projection", hint: "Highest projected total" },
                { id: "floor", label: "Safe floor", hint: "Best 10th-percentile score: least likely to bust" },
                { id: "ceiling", label: "High ceiling", hint: "Best 90th-percentile score: for podium chasing" },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.hint}
                onClick={() => setLineupStrategy(o.id)}
                className={`rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold ${
                  lineupStrategy === o.id
                    ? "border-sky-300/60 bg-sky-500/20 text-sky-100"
                    : "border-white/10 text-slate-400 hover:text-slate-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {arenaMode === "pro" && gallery && (
        <details
          className="rounded-xl border border-white/8 bg-[#111726] px-3 py-2 text-[11px]"
          onToggle={(e) => setFocusOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-semibold text-slate-200">
            Focus strength grade ({FORMAT_OPTIONS.find((f) => f.id === format)?.label ?? format})
          </summary>
          {focusAnalysis && (
            <div className="mt-1.5 space-y-1 text-[10px] text-slate-300">
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-sky-400/40 bg-sky-500/15 px-1.5 py-0.5 text-sm font-bold text-sky-100">
                  {focusAnalysis.grade}
                </span>
                <span>
                  Best {focusAnalysis.bestOwnedScore.toFixed(0)} vs cut {focusAnalysis.cutScore.toFixed(0)}
                </span>
              </div>
              <p>{focusAnalysis.summary}</p>
              {[...focusAnalysis.missingPositions, ...focusAnalysis.weakPositions].slice(0, 3).map((n) => (
                <div key={`${n.position}-${n.reason}`} className="text-amber-200">
                  {n.label}: {n.reason}
                </div>
              ))}
              {focusAnalysis.topReplacements.slice(0, 3).map((r) => (
                <div key={r.cardSlug} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.outPlayer ? `${r.outPlayer} → ` : ""}
                    {r.inPlayer} (+{r.gainPts.toFixed(1)})
                  </span>
                  <button
                    type="button"
                    onClick={() => void openInActiveTab(r.marketUrl)}
                    className="shrink-0 rounded border border-sky-400/40 px-1 text-sky-200"
                  >
                    Market
                  </button>
                </div>
              ))}
            </div>
          )}
        </details>
      )}
      {built && built.lineups.length === 0 ? (
        <div className="rounded-xl border border-white/8 bg-[#111726] p-4 text-center text-xs text-slate-400">
          Not enough eligible cards ({built.evaluatedPool.length} available) to
          form a 5-card lineup under current filters. Try switching to{" "}
          <strong>All Rarities</strong> or <strong>Uncapped</strong>.
        </div>
      ) : (
        shownLineups.map((lineup, shownIdx) => {
          const fmtLabel =
            FORMAT_OPTIONS.find((f) => f.id === lineup.format)?.label ??
            lineup.format;
          const names = lineup.slots.map((s) => s.evaluated.card.playerName);

          return (
            <div
              key={lineup.rank}
              className="rounded-2xl border border-white/8 bg-[#111726] p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                      #{shownIdx + 1}
                    </span>
                    <span className="text-sm font-bold text-slate-100">
                      {lineup.totalScore.toFixed(1)}{" "}
                      <span className="text-[11px] font-normal text-slate-400">
                        proj pts
                        {lineup.stdDev
                          ? ` • ${(lineup.totalScore - 1.2816 * lineup.stdDev).toFixed(0)}-${(lineup.totalScore + 1.2816 * lineup.stdDev).toFixed(0)}`
                          : ""}
                      </span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {lineup.format === "daily_120_mvp"
                      ? `Cap: ${lineup.capUsed}/120 + MVP`
                      : lineup.capLimit
                        ? `${lineup.capUsed}/${lineup.capLimit}★`
                        : `${lineup.totalStars}★ total`}{" "}
                    • {lineup.inSeasonCount}/5 In-Season
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(names.join(", "));
                      setCopiedRank(lineup.rank);
                      window.setTimeout(() => setCopiedRank(null), 1500);
                    }}
                    className="rounded-lg border border-white/10 bg-[#0b101b] p-1.5 text-slate-300 hover:border-amber-400/40"
                    title="Copy 5 players"
                    aria-label="Copy 5 players"
                  >
                    {copiedRank === lineup.rank ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void applyLineupHighlight(
                        names,
                        fmtLabel,
                        lineup.totalScore,
                        lineup.slots.map((s) => ({
                          slotLabel: s.slotLabel,
                          cardSlug: s.evaluated.card.slug,
                          playerName: s.evaluated.card.playerName,
                          rarity: s.evaluated.card.rarity,
                          seasonYear: s.evaluated.card.seasonYear,
                          isCaptain: s.isCaptainOrMvp,
                        })),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/30"
                    title="Launch Assisted / Semi-Auto Lineup Helper on sorare.com"
                  >
                    <Send className="h-3 w-3" />
                    Apply
                  </button>
                  <GoButton url={proGoUrl} title="Open the Sorare lineup page" />
                </div>
              </div>

              {/* Visual 5-Card Artwork Preview Strip + p10-mean-p90 Range Bar */}
              <div className="mb-2.5 space-y-2">
                <LineupCardStrip
                  cards={lineup.slots.map((slot) => ({
                    key: slot.evaluated.card.slug,
                    playerName: slot.evaluated.card.playerName,
                    teamSlug: slot.evaluated.card.teamSlug,
                    rarity: slot.evaluated.card.rarity,
                    pictureUrl: slot.evaluated.card.pictureUrl,
                    starCost: slot.evaluated.card.starCost,
                    projectedPts: slot.slotScore,
                    badge: slot.isCaptainOrMvp ? (lineup.format === "daily_120_mvp" ? "MVP" : "C") : null,
                    isCaptain: slot.isCaptainOrMvp,
                  }))}
                />
                {typeof lineup.stdDev === "number" && lineup.stdDev > 0 && (
                  <LineupRangeBar
                    p10={Math.max(0, lineup.totalScore - 1.2816 * lineup.stdDev)}
                    mean={lineup.totalScore}
                    p90={lineup.totalScore + 1.2816 * lineup.stdDev}
                    cutLine={lineup.odds.essenceTarget}
                    label={`Lineup #${shownIdx + 1}`}
                  />
                )}
              </div>

              {/* Estimated Win Odds Strip */}
              <div className="mb-2.5 grid grid-cols-3 gap-1.5 text-center text-[10px]">
                <div className="rounded-lg border border-white/6 bg-[#0b101b] px-1 py-1">
                  <div className="truncate text-slate-400">
                    {lineup.odds.paidLabel ?? "Essence"} (≥{lineup.odds.essenceTarget})
                  </div>
                  <div className="font-semibold text-emerald-300">
                    {lineup.odds.essencePct}%
                  </div>
                </div>
                <div className="rounded-lg border border-white/6 bg-[#0b101b] px-1 py-1">
                  <div className="truncate text-slate-400">
                    {lineup.odds.tierLabel ?? "Tier 1"} (≥{lineup.odds.tier1Target})
                  </div>
                  <div className="font-semibold text-sky-300">
                    {lineup.odds.tier1Pct}%
                  </div>
                </div>
                <div className="rounded-lg border border-white/6 bg-[#0b101b] px-1 py-1">
                  <div className="truncate text-slate-400">
                    {lineup.odds.estRank && lineup.odds.totalEntries
                      ? `Est. Rank (${lineup.odds.benchmarkFixture ?? "Last GW"})`
                      : `Podium (≥${lineup.odds.podiumTarget})`}
                  </div>
                  <div className="font-semibold text-amber-300">
                    {lineup.odds.estRank && lineup.odds.totalEntries
                      ? `#${lineup.odds.estRank.toLocaleString()}/${lineup.odds.totalEntries.toLocaleString()} (Top ${lineup.odds.topPercentilePct}%)`
                      : `${lineup.odds.podiumPct}%`}
                  </div>
                </div>
              </div>

              {/* Color-Coded 5-Slot Roster with Sorare Portraits */}
              <div className="space-y-1">
                {lineup.slots.map((slot) => {
                  const ev = slot.evaluated;
                  const c = ev.card;
                  const inj = injuryBadge(ev.injuryStatus);
                  const boostPct = Math.round((c.powerMultiplier - 1) * 100);
                  const capDeltaPts =
                    slot.isCaptainOrMvp
                      ? Math.round(slot.slotScore - ev.effectiveScore)
                      : 0;
                  const usageBoost =
                    c.teamSlug && ev.injuryStatus === "ACTIVE"
                      ? teamOutBoostMap[c.teamSlug]
                      : undefined;
                  const posLabel =
                    c.positions.map((p) => NBA_POSITION_LABELS[p]).join("/") ||
                    "--";
                  const formDelta =
                    c.l5 !== null && c.l10 !== null
                      ? Math.round((c.l5 - c.l10) * 10) / 10
                      : null;
                  const isOnFire = formDelta !== null && formDelta >= 3.5;
                  const isCold = formDelta !== null && formDelta <= -3.5;
                  const posKey = primaryPosKey(c.positions);
                  const posDvp =
                    c.teamSlug
                      ? gallery?.scheduleByTeam?.[c.teamSlug]?.dvpByPos?.[posKey] ??
                        gallery?.scheduleByTeam?.[c.teamSlug]?.difficultyTag
                      : undefined;
                  const isSlotOpen = expandedSlotSlug === `${lineup.rank}:${c.slug}`;

                  return (
                    <PlayerCardRow
                      key={c.slug}
                      playerName={c.playerName}
                      teamSlug={c.teamSlug}
                      teamName={c.teamName}
                      rarity={c.rarity}
                      pictureUrl={c.pictureUrl}
                      leftBadge={
                        <span
                          className={`inline-flex w-9 items-center justify-center gap-0.5 rounded-md border py-0.5 text-[10px] font-bold ${slotBadgeClass(slot.slotLabel)}`}
                        >
                          {slot.isCaptainOrMvp && (
                            <Crown className="h-2.5 w-2.5" />
                          )}
                          {slot.slotLabel}
                        </span>
                      }
                      statusBadge={
                        <div className="flex flex-wrap items-center gap-1">
                          {inj && (
                            <span
                              className={`shrink-0 rounded border px-1 text-[9px] font-semibold ${inj.cls}`}
                            >
                              {inj.label}
                            </span>
                          )}
                          {isOnFire && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-400/40 bg-amber-400/15 px-1 text-[9px] font-bold text-amber-200">
                              <Flame className="h-2.5 w-2.5" />
                              +{formDelta}
                            </span>
                          )}
                          {isCold && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-rose-400/35 bg-rose-500/15 px-1 text-[9px] font-semibold text-rose-200">
                              <Snowflake className="h-2.5 w-2.5" />
                              {formDelta}
                            </span>
                          )}
                          {!inj && usageBoost && (
                            <span className="shrink-0 rounded border border-emerald-400/35 bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-300">
                              {usageBoost}
                            </span>
                          )}
                        </div>
                      }
                      subline={
                        <>
                          <span>{posLabel}</span>
                          <span>• {c.starCost}★</span>
                          <span
                            className={
                              ev.gamesInSlate === 0
                                ? "font-semibold text-rose-400"
                                : ev.gamesInSlate >= 3
                                  ? "font-semibold text-emerald-300"
                                  : ev.gamesInSlate === 2
                                    ? "text-sky-300"
                                    : "text-slate-400"
                            }
                            title="Scheduled NBA games in 4-day GW window"
                          >
                            • {ev.gamesInSlate}G
                            {posDvp === "EASY"
                              ? ` (vs ${posKey}: EASY)`
                              : posDvp === "TOUGH"
                                ? ` (vs ${posKey}: TOUGH)`
                                : ""}
                          </span>
                          <span>• x{c.powerMultiplier.toFixed(2)}</span>
                          {slot.isCaptainOrMvp && (
                            <span className="text-amber-300">
                              {capDeltaPts > 0
                                ? `• +${capDeltaPts} MVP`
                                : "• Cap-Free MVP"}
                            </span>
                          )}
                          <span
                            className={
                              c.inSeasonEligible ? "text-sky-300" : "text-slate-400"
                            }
                          >
                            • {c.inSeasonEligible ? "26-27" : c.seasonYear}
                          </span>
                        </>
                      }
                      heroRight={
                        <span className="inline-flex items-center gap-0.5 text-emerald-300">
                          <Activity className="h-3 w-3 text-slate-400" />
                          {slot.slotScore.toFixed(1)}
                        </span>
                      }
                      subRight={<span>L10: {c.l10?.toFixed(0) ?? "--"}</span>}
                      actionRight={
                        <button
                          type="button"
                          onClick={() => toggleCompareCard(c.slug)}
                          className={`rounded-lg border p-1 transition ${
                            compareSlugs.includes(c.slug)
                              ? "border-sky-400/50 bg-sky-500/20 text-sky-200"
                              : "border-white/10 bg-[#111726] text-slate-400 hover:text-slate-200"
                          }`}
                          title="Pin card to Head-to-Head Compare"
                          aria-label={`Compare ${c.playerName}`}
                        >
                          <ArrowLeftRight className="h-3 w-3" />
                        </button>
                      }
                      onToggleExpand={() =>
                        setExpandedSlotSlug((prev) =>
                          prev === `${lineup.rank}:${c.slug}`
                            ? null
                            : `${lineup.rank}:${c.slug}`,
                        )
                      }
                      expandedContent={
                        isSlotOpen ? (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="space-y-0.5">
                              <div>
                                Proj:{" "}
                                {ev.allSources.sorareProjected?.toFixed(1) ?? "--"}{" "}
                                | L10: {ev.allSources.l10?.toFixed(1) ?? "--"} |
                                L5: {ev.allSources.l5?.toFixed(1) ?? "--"} |
                                Boost: +{boostPct}%
                                {c.powerBreakdown
                                  ? ` (S +${Math.round(c.powerBreakdown.season * 100)}%, C +${Math.round(c.powerBreakdown.collection * 100)}%, XP +${Math.round(c.powerBreakdown.xp * 100)}%)`
                                  : ""}
                              </div>
                              {ev.injury && (
                                <div className="text-amber-200">
                                  ESPN {ev.injury.rawStatus}: {ev.injury.comment}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExcludedCardSlugs((prev) =>
                                  prev.includes(c.slug)
                                    ? prev
                                    : [...prev, c.slug],
                                )
                              }
                              className="rounded border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/25"
                            >
                              Skip Card
                            </button>
                          </div>
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })
      )}
      </div>
          </div>

      {/* Position-Aware "Who Steps Up" Injury Impact Panel (Upgrades Sub-Tab) */}
      <div
        role="tabpanel"
        aria-label="Upgrades & Schedule"
        hidden={proSubTab !== "upgrades"}
        className={proSubTab === "upgrades" ? "jam-panel-enter space-y-3" : "hidden"}
      >
          <InjuryImpactPanel impacts={injuryImpacts} />

      {/* Dual Lineup Market Buy Advisor (Out-of-Season 1-Slot Classic vs. In-Season) */}
      <details id="sec-market"
        open={Boolean(dualBuyAdvisor)}
        className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]"
      >
        <summary className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-white/[0.03]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-sky-200">
            <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-sky-400" />
            <TrendingUp className="h-3.5 w-3.5 text-sky-400" />
            Lineup Buy Advisor (1 Classic vs. In-Season)
          </span>
          <span className="text-[10px] text-slate-400">
            {dualBuyAdvisor
              ? `${dualBuyAdvisor.classicSlotBuys.length} Classic • ${dualBuyAdvisor.inSeasonSlotBuys.length} In-S`
              : "Scan market"}
          </span>
        </summary>

        <div className="space-y-2.5 border-t border-white/8 bg-[#0b101b] p-3 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: "best_value", label: "Best Value (+Pts/€)" },
                  { id: "max_upgrade", label: "Max Upgrade (+Pts)" },
                  { id: "quest_synergy", label: "2-in-1 Quest Synergy" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setBuyRankMode(m.id)}
                  className={`rounded-lg border px-2 py-1 font-semibold transition ${
                    buyRankMode === m.id
                      ? "border-sky-400/50 bg-sky-500/20 text-sky-200"
                      : "border-white/8 bg-[#111726] text-slate-300 hover:border-white/25"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                step={1}
                value={buyMaxPriceEuros}
                onChange={(e) => setBuyMaxPriceEuros(e.target.value)}
                placeholder="Max €"
                aria-label="Maximum buy advisor price"
                className="w-16 rounded-lg border border-white/10 bg-[#111726] px-2 py-1 text-right text-[10px] font-semibold text-amber-300 placeholder-slate-500 focus:outline-none"
              />
              {onScanMarketForBudget && (
                <button
                  type="button"
                  disabled={isMarketLoading}
                  onClick={onScanMarketForBudget}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg jam-btn-primary px-3 py-1.5 text-[10.5px] font-bold text-slate-950 shadow-sm transition disabled:opacity-50"
                >
                  {isMarketLoading ? "Scanning Market..." : "Scan Market Buys"}
                </button>
              )}
            </div>
          </div>

          {(!dualBuyAdvisor || dualBuyAdvisor.topOverallBuys.length === 0) &&
            comboSwaps.length === 0 && (
              <div className="rounded-xl border border-white/6 bg-[#111726] p-3 text-center text-[11px] text-slate-400">
                {effectiveMarketListings.length === 0
                  ? "Click Scan Market Buys above to scan live Sorare NBA Instant Buys (best value + lowest price) for 1-for-1 and 2-Card upgrades."
                  : `Checked ${effectiveMarketListings.length} live market listings - no 1-for-1 or 2-Card market upgrades beat your #1 lineup under current cap (${
                      FORMAT_OPTIONS.find((f) => f.id === format)?.sub ?? format
                    }), season rule, and price filter. Try clearing Max € or switching Buy Rank Mode.`}
              </div>
            )}

          {dualBuyAdvisor && dualBuyAdvisor.topOverallBuys.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/8 bg-[#111726] p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setBuySlotFilter("split")}
                  className={`rounded-lg py-1 font-semibold transition ${
                    buySlotFilter === "split"
                      ? "bg-sky-500/15 text-sky-100"
                      : "text-slate-400"
                  }`}
                >
                  Split View
                </button>
                <button
                  type="button"
                  onClick={() => setBuySlotFilter("classic")}
                  className={`rounded-lg py-1 font-semibold transition ${
                    buySlotFilter === "classic"
                      ? "bg-violet-500/20 text-violet-200"
                      : "text-slate-400"
                  }`}
                >
                  1 Classic Slot ({dualBuyAdvisor.classicSlotBuys.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBuySlotFilter("in_season")}
                  className={`rounded-lg py-1 font-semibold transition ${
                    buySlotFilter === "in_season"
                      ? "bg-sky-500/20 text-sky-200"
                      : "text-slate-400"
                  }`}
                >
                  In-Season ({dualBuyAdvisor.inSeasonSlotBuys.length})
                </button>
              </div>

              {(
                [
                  ...(buySlotFilter === "split" || buySlotFilter === "classic"
                    ? [
                        {
                          key: "classic",
                          title:
                            seasonRule === "5_in_season"
                              ? "Out-of-Season Disabled (5/5 In-Season Rule)"
                              : "Best Out-of-Season Steals (1 Allowed Classic Slot)",
                          tone: "text-violet-300",
                          rows: dualBuyAdvisor.classicSlotBuys,
                        },
                      ]
                    : []),
                  ...(buySlotFilter === "split" || buySlotFilter === "in_season"
                    ? [
                        {
                          key: "in_season",
                          title: "Best In-Season (26-27) Upgrades & Quest Synergy",
                          tone: "text-sky-300",
                          rows: dualBuyAdvisor.inSeasonSlotBuys,
                        },
                      ]
                    : []),
                ] as Array<{
                  key: string;
                  title: string;
                  tone: string;
                  rows: LineupBuyRecommendation[];
                }>
              ).map((group) => (
                <div key={group.key} className="space-y-1">
                  <div className={`text-[10px] font-semibold ${group.tone}`}>
                    {group.title}
                  </div>
                  {group.rows.length === 0 ? (
                    <div className="rounded-lg border border-white/6 bg-[#111726] px-2.5 py-1.5 text-[10px] text-slate-400">
                      No qualifying market upgrades in this bucket.
                    </div>
                  ) : (
                    group.rows.slice(0, 4).map((rec) => (
                      <div
                        key={rec.listing.cardSlug}
                        className="flex items-center justify-between gap-2 rounded-xl border border-white/6 bg-[#111726] px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="truncate font-semibold text-slate-100">
                              {rec.listing.playerName}
                            </span>
                            <span className="rounded border border-white/10 bg-white/5 px-1 text-[8.5px] font-semibold text-slate-300">
                              {rec.listing.inSeasonEligible ? "26-27" : rec.listing.seasonYear}
                            </span>
                            {rec.listing.isPrimaryOffer && (
                              <span className="rounded border border-emerald-400/40 bg-emerald-500/15 px-1 text-[8.5px] font-bold text-emerald-300">
                                1ST
                              </span>
                            )}
                            {rec.advancesCollection && (
                              <span className="inline-flex items-center gap-0.5 rounded border border-violet-400/40 bg-violet-500/15 px-1 text-[8.5px] font-bold text-violet-200">
                                <Trophy className="h-2 w-2" />
                                Need
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[10px] tabular-nums text-slate-400">
                            {rec.listing.starCost}★ • Replaces {rec.replacesPlayerName} ({rec.replacesSlotLabel}) •{" "}
                            <strong className="text-emerald-300">
                              +{rec.deltaLineupPts} pts
                            </strong>{" "}
                            <span className="text-sky-300">
                              ({rec.ptsGainPerEuro} pts/€)
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void openInActiveTab(rec.listing.marketUrl)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-400/35 bg-amber-400/15 px-2 py-1 text-[10px] font-semibold tabular-nums text-amber-200 hover:bg-amber-400/25"
                        >
                          {formatMoney(rec.listing.priceCents, currency)}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </>
          )}

          {comboSwaps.length > 0 && (
                <div className="mt-2 space-y-1.5 border-t border-white/8 pt-2">
                  <div className="text-[10px] font-semibold text-amber-300">
                    2-Card Cap Re-Allocator Combos (Downgrade 1 + Buy Star)
                  </div>
                  {comboSwaps.map((combo, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-amber-400/20 bg-[#111726] p-2 text-[10px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 font-semibold text-slate-100">
                          {combo.inCards[0].playerName} ({combo.inCards[0].starCost}★) +{" "}
                          {combo.inCards[1].playerName} ({combo.inCards[1].starCost}★)
                        </div>
                        <span className="shrink-0 font-bold text-emerald-300">
                          +{combo.deltaLineupPts} pts ({combo.ptsGainPerEuro} pts/€)
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-slate-400">
                        <span>
                          Replaces {combo.outPlayers[0]} ({combo.outSlotLabels[0]}) &amp;{" "}
                          {combo.outPlayers[1]} ({combo.outSlotLabels[1]}) •{" "}
                          {combo.newTotalStars}★ total
                        </span>
                        <div className="flex items-center gap-1">
                          {combo.inCards
                            .filter((ic) => !ic.isOwned)
                            .map((ic) => (
                              <button
                                key={ic.playerName}
                                type="button"
                                onClick={() => void openInActiveTab(ic.marketUrl)}
                                className="inline-flex items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 font-semibold text-amber-200 hover:bg-amber-400/25"
                              >
                                {ic.playerName.split(" ").pop()}{" "}
                                {formatMoney(ic.priceCents, currency)}
                                <ExternalLink className="h-2.5 w-2.5" />
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </div>
      </details>
      </div>

      {/* Multi-Competition Portfolio Optimizer & Hybrid Budget (Builder Sub-Tab) */}
      <div
        role="tabpanel"
        aria-label="Portfolio & Budget"
        hidden={proSubTab !== "builder"}
        className={proSubTab === "builder" ? "jam-panel-enter space-y-3" : "hidden"}
      >
      {portfolio && portfolio.lineups.length > 0 && (
        <details className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]">
          <summary className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-white/[0.03]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-100">
              <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-violet-400" />
              <Layers className="h-3.5 w-3.5 text-violet-400" />
              Multi-Competition Portfolio ({portfolio.lineups.length} Disjoint)
            </span>
            <span className="text-[10px] font-semibold text-emerald-300">
              ≥1 Essence: {portfolio.atLeastOneEssencePct}%
            </span>
          </summary>

          <div className="space-y-2 border-t border-white/8 bg-[#0b101b] p-3 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-400/20 bg-[#111726] px-2.5 py-1.5 text-[10px] text-slate-300">
              <span>
                Uses <strong className="text-slate-100">{portfolio.cardsUsedCount}</strong>{" "}
                unique cards across {portfolio.lineups.length} competitions
              </span>
              <span>
                Combined:{" "}
                <strong className="text-amber-300">
                  {portfolio.totalProjectedPts.toFixed(1)} pts
                </strong>
              </span>
            </div>

            {portfolio.lineups.map((pl) => {
              const fmtTitle =
                FORMAT_OPTIONS.find((f) => f.id === pl.format)?.label ?? pl.format;
              const pNames = pl.slots.map((s) => s.evaluated.card.playerName);
              return (
                <div
                  key={pl.format}
                  className="rounded-xl border border-white/8 bg-[#111726] p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-violet-200">
                        {fmtTitle}
                      </span>{" "}
                      <span className="text-[10px] text-slate-400">
                        • {pl.totalScore.toFixed(1)} pts •{" "}
                        {pl.capLimit ? `${pl.capUsed}/${pl.capLimit}★` : `${pl.totalStars}★`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-emerald-300">
                        {pl.odds.essencePct}% Ess
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void applyLineupHighlight(
                            pNames,
                            fmtTitle,
                            pl.totalScore,
                            pl.slots.map((s) => ({
                              slotLabel: s.slotLabel,
                              cardSlug: s.evaluated.card.slug,
                              playerName: s.evaluated.card.playerName,
                              rarity: s.evaluated.card.rarity,
                              seasonYear: s.evaluated.card.seasonYear,
                              isCaptain: s.isCaptainOrMvp,
                            })),
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/30"
                      >
                        <Send className="h-2.5 w-2.5" />
                        Apply
                      </button>
                      <GoButton url={proGoUrl} title="Open the Sorare lineup page" />
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-300">
                    {pl.slots
                      .map((s) => `${s.slotLabel}: ${s.evaluated.card.playerName}`)
                      .join(" • ")}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Hybrid Budget Lineup Builder (Owned Cards + Market Buys) */}
      <details
        open
        className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]"
      >
        <summary className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-white/[0.03]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-100">
            <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <Wallet className="h-3.5 w-3.5 text-emerald-400" />
            Hybrid Budget Lineup Builder ({formatMoney(budgetCents, currency)})
          </span>
          <span className="text-[10px] text-slate-400">
            {effectiveMarketListings.length > 0
              ? `${effectiveMarketListings.length} deals ready`
              : "Scan market"}
          </span>
        </summary>

        <div className="space-y-2.5 border-t border-white/8 bg-[#0b101b] p-3">
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            {[300, 500, 1000, 2500, 5000].map((cents) => (
              <button
                key={cents}
                type="button"
                onClick={() => setBudgetCents(cents)}
                className={`rounded-lg border px-2 py-1 font-semibold transition ${
                  budgetCents === cents
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                    : "border-white/8 bg-[#111726] text-slate-300 hover:border-white/25"
                }`}
              >
                {formatMoney(cents, currency)}
              </button>
            ))}
            {walletBalance?.cashAmount !== null &&
              walletBalance?.cashAmount !== undefined &&
              walletBalance.cashAmount >= 0.5 && (
                <button
                  type="button"
                  onClick={() =>
                    setBudgetCents(Math.round(walletBalance.cashAmount! * 100))
                  }
                  className="rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 py-1 font-semibold text-amber-200"
                >
                  Wallet ({formatMoney(Math.round(walletBalance.cashAmount * 100), currency)})
                </button>
              )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-200">
              <input
                type="checkbox"
                checked={includeOwnedInBudget}
                onChange={(e) => setIncludeOwnedInBudget(e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-400"
              />
              Include my owned cards (€0)
            </label>

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                step={1}
                value={Math.round(budgetCents / 100)}
                onChange={(e) =>
                  setBudgetCents(Math.max(100, (Number(e.target.value) || 1) * 100))
                }
                aria-label="Custom cash budget"
                className="w-14 rounded-lg border border-white/10 bg-[#111726] px-2 py-0.5 text-right text-xs font-semibold text-amber-300 focus:outline-none"
              />
              {onScanMarketForBudget && (
                <button
                  type="button"
                  disabled={isMarketLoading}
                  onClick={onScanMarketForBudget}
                  className="jam-btn-secondary rounded-lg px-2.5 py-1 text-[10px] font-semibold disabled:opacity-50"
                >
                  {isMarketLoading ? "Loading..." : "Load Market Deals"}
                </button>
              )}
            </div>
          </div>

          {budgetLineups.length === 0 ? (
            <div className="rounded-xl border border-white/6 bg-[#111726] p-3 text-center text-[11px] text-slate-400">
              Click <strong>Load Market Deals</strong> above (or scan in the
              Deals tab) to generate optimal hybrid lineups within your{" "}
              {formatMoney(budgetCents, currency)} budget.
            </div>
          ) : (
            <div className="space-y-2">
              {budgetLineups.map((pick) => (
                <div
                  key={pick.rank}
                  className="rounded-xl border border-white/8 bg-[#111726] p-2.5"
                >
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="mr-1.5 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                        Budget #{pick.rank}
                      </span>
                      <strong className="text-slate-100">
                        {pick.totalScore.toFixed(1)} pts
                      </strong>{" "}
                      <span className="text-[10px] text-slate-400">
                        ({pick.capUsed}/{pick.capLimit ?? "∞"}★ •{" "}
                        {pick.marketBuysCount} buy{pick.marketBuysCount === 1 ? "" : "s"})
                      </span>
                    </div>
                    <span className="font-semibold text-amber-300">
                      {formatMoney(pick.totalCostCents, currency)} /{" "}
                      {formatMoney(budgetCents, currency)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {pick.slots.map((slot) => {
                      const c = slot.evaluated.card;
                      const meta = pick.slotCostBySlug[c.slug];
                      return (
                        <PlayerCardRow
                          key={c.slug}
                          playerName={c.playerName}
                          teamSlug={c.teamSlug}
                          teamName={c.teamName}
                          rarity={c.rarity}
                          pictureUrl={c.pictureUrl}
                          leftBadge={
                            <span
                              className={`inline-flex w-9 items-center justify-center rounded-md border py-0.5 text-[9.5px] font-bold ${slotBadgeClass(slot.slotLabel)}`}
                            >
                              {slot.slotLabel}
                            </span>
                          }
                          statusBadge={
                            meta?.isOwned ? (
                              <span className="rounded border border-sky-400/35 bg-sky-500/15 px-1 text-[8.5px] font-bold text-sky-200">
                                OWNED
                              </span>
                            ) : meta?.isPrimaryOffer ? (
                              <span className="rounded border border-emerald-400/40 bg-emerald-500/20 px-1 text-[8.5px] font-bold text-emerald-200">
                                1ST BUY
                              </span>
                            ) : (
                              <span className="rounded border border-amber-400/35 bg-amber-400/15 px-1 text-[8.5px] font-bold text-amber-200">
                                MARKET
                              </span>
                            )
                          }
                          subline={
                            <>
                              <span>{c.starCost}★</span>
                              <span>• L10 {c.l10?.toFixed(1) ?? "--"}</span>
                              {c.l5 !== null && (
                                <span className="text-emerald-300">
                                  • L5 {c.l5.toFixed(1)}
                                </span>
                              )}
                            </>
                          }
                          heroRight={
                            <span
                              className={
                                meta?.isOwned
                                  ? "text-sky-300"
                                  : "text-amber-300"
                              }
                            >
                              {meta?.isOwned
                                ? "€0.00"
                                : formatMoney(meta?.costCents, currency)}
                            </span>
                          }
                          subRight={
                            <span>{slot.slotScore.toFixed(1)} pts</span>
                          }
                          actionRight={
                            !meta?.isOwned && meta?.marketUrl ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void openInActiveTab(meta.marketUrl)
                                }
                                className="inline-flex items-center gap-0.5 rounded-lg bg-amber-400/15 px-1.5 py-1 text-[9.5px] font-semibold text-amber-200 hover:bg-amber-400/25"
                              >
                                Buy
                                <ExternalLink className="h-2.5 w-2.5" />
                              </button>
                            ) : undefined
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
      </div>
        </>
      )}

      {/* 4-Day Gameweek Schedule & Matchups */}
      {arenaMode === "pro" && sortedSchedule.length > 0 && (
        <div hidden={proSubTab !== "upgrades"} className={proSubTab === "upgrades" ? "jam-panel-enter" : "hidden"}>
        <details id="sec-schedule" className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]">
          <summary className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
              <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <Calendar className="h-3.5 w-3.5 text-emerald-400" />
              4-Day Gameweek Schedule &amp; Matchups
            </span>
            <span className="text-[10px] text-slate-400">
              {sortedSchedule.length} teams
            </span>
          </summary>
          <div className="grid grid-cols-1 gap-1.5 border-t border-white/8 bg-[#0b101b] p-3 sm:grid-cols-2">
            {sortedSchedule.map((tm) => (
              <div
                key={tm.teamSlug}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/6 bg-[#111726] px-2.5 py-1.5 text-[10px]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-100">{tm.abbr}</span>
                    <span
                      className={`rounded px-1 text-[9px] font-bold ${
                        tm.games >= 3
                          ? "bg-emerald-500/20 text-emerald-300"
                          : tm.games === 2
                            ? "bg-sky-500/15 text-sky-300"
                            : "bg-white/8 text-slate-300"
                      }`}
                    >
                      {tm.games}G
                    </span>
                    {tm.hasBackToBack && (
                      <span className="rounded bg-amber-400/15 px-1 text-[8.5px] font-semibold text-amber-300">
                        B2B
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[9.5px] text-slate-400">
                    {tm.matchups.join(" • ")}
                  </div>
                  {tm.dvpByPos && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[8.5px]">
                      {(["G", "F", "C"] as const).map((pos) => (
                        <span
                          key={pos}
                          className={`rounded border px-1 font-semibold ${dvpTagClass(tm.dvpByPos![pos])}`}
                        >
                          vs {pos}: {tm.dvpByPos![pos]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                    tm.difficultyTag === "EASY"
                      ? "border border-emerald-400/35 bg-emerald-500/15 text-emerald-300"
                      : tm.difficultyTag === "TOUGH"
                        ? "border border-rose-400/35 bg-rose-500/15 text-rose-300"
                        : "border border-white/10 bg-white/5 text-slate-300"
                  }`}
                >
                  {tm.difficultyTag}
                </span>
              </div>
            ))}
          </div>
        </details>
        </div>
      )}

      {/* Collapsible Boosting & Multiplier Guide (2026-27 Verified Rules) */}
      <div
        hidden={arenaMode === "pro" && proSubTab !== "upgrades"}
        className={arenaMode !== "pro" || proSubTab === "upgrades" ? "space-y-3" : "hidden"}
      >
      <details id="sec-guides" className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]">
        <summary className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
            <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-amber-400" />
            <Flame className="h-3.5 w-3.5 text-amber-400" />
            Best Boosting, Stars &amp; Multiplier Guide
          </span>
          <span className="text-[10px] text-slate-400">
            {BOOSTING_GUIDE_RULES.length} rules
          </span>
        </summary>
        <div className="space-y-1.5 border-t border-white/8 bg-[#0b101b] p-3 text-[11px]">
          {BOOSTING_GUIDE_RULES.map((rule) => (
            <div
              key={rule.id}
              className="rounded-xl border border-white/8 bg-[#111726] p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-amber-200">
                  {rule.title}
                </span>
                <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                  {rule.tag}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                {rule.detail}
              </p>
            </div>
          ))}
        </div>
      </details>

      {/* Live Competition Rooms & Sub-Rooms Directory (Pro, Arena & Set) */}
      <details className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]">
        <summary className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
            <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <Trophy className="h-3.5 w-3.5 text-emerald-400" />
            Live Competition Rooms &amp; Sub-Rooms (2026-27)
          </span>
          <span className="text-[10px] text-slate-400">
            {NBA_COMPETITION_DIRECTORY.length} rooms
          </span>
        </summary>
        <div className="space-y-1.5 border-t border-white/8 bg-[#0b101b] p-3 text-[11px]">
          {NBA_COMPETITION_DIRECTORY.map((room) => (
            <div
              key={room.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-[#111726] p-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-white/8 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300">
                    {room.group}
                  </span>
                  <span className="font-semibold text-slate-100">
                    {room.name}
                  </span>
                  <span className="rounded bg-amber-400/15 px-1 text-[9px] font-semibold text-amber-300">
                    {room.capLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {room.eligibility}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void openInActiveTab(room.url)}
                className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-lg border border-white/10 bg-[#0b101b] px-2 py-1 text-[10px] font-semibold text-sky-300 hover:border-sky-400/40"
              >
                Open
                <ExternalLink className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      </details>
      </div>
    </div>
  );
}

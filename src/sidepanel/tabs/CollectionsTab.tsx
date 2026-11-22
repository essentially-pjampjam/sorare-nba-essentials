import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Gavel,
  Layers,
  Loader2,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  Trophy,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { PortfolioSummary } from "../../calculators/collectionEssenceMath";
import { normalizePlayerName } from "../../calculators/lineupOptimizerMath";
import { evaluateLeagueQuests } from "../../calculators/questOptimizerMath";
import {
  ESSENCE_EARNING_SOURCES,
  LEAGUE_ESSENCE_MISSIONS,
  RARITY_META,
} from "../../shared/constants";
import type {
  BargainsResult,
  CardCounts,
  CollectionAnalysis,
  Currency,
  GalleryCard,
  InjuryReportEntry,
  QuestCardSummary,
  Rarity,
  WalletBalanceInfo,
} from "../../shared/types";
import { openInActiveTab } from "../api";
import {
  formatCostPerEssence,
  formatMoney,
  formatTimeLeft,
} from "../utils/format";

export type SortField =
  | "minCard"
  | "costPerEssence"
  | "totalCost"
  | "cardsNeeded"
  | "essenceRewarded"
  | "name";

interface TeamTargetSummary {
  kind: "custom_essence" | "bonus" | "floor";
  cardsNeeded: number;
  subLabel: string;
  primaryText: string;
  costCents: number | null;
  auctionCostCents: number | null;
  costPerEssenceCents: number | null;
  minCardCents: number | null;
  highlightCount: number;
}

function getCollectionOps(item: CollectionAnalysis) {
  return item.opportunities ?? item.nextEssenceMilestone?.rankedShoppingList ?? [];
}

function getTeamTargetSummary(item: CollectionAnalysis): TeamTargetSummary {
  const ops = getCollectionOps(item);
  const minCardCents =
    item.cheapestCardCents ??
    ops.find((op) => op.instantBuyCents !== null)?.instantBuyCents ??
    null;
  const minAucCents =
    ops
      .map((op) => op.auctionBidCents)
      .filter((p): p is number => p !== null)
      .sort((a, b) => a - b)[0] ?? null;

  if (item.nextEssenceMilestone) {
    const m = item.nextEssenceMilestone;
    return {
      kind: "custom_essence",
      cardsNeeded: m.cardsNeeded,
      subLabel: m.label,
      primaryText: `+${m.essenceRewarded}E (Custom)`,
      costCents: m.totalCostCents,
      auctionCostCents: m.auctionAssistedCostCents,
      costPerEssenceCents: m.costPerEssenceCents,
      minCardCents,
      highlightCount: m.cardsNeeded,
    };
  }

  if (item.nextBonusThreshold) {
    const nb = item.nextBonusThreshold;
    const pct = Math.round(nb.bonus * 100);
    return {
      kind: "bonus",
      cardsNeeded: nb.instantBuyCardsNeeded,
      subLabel: `Score ${nb.threshold}`,
      primaryText: `+${pct}% Bonus`,
      costCents: nb.totalCostCents ?? minCardCents,
      auctionCostCents: nb.auctionAssistedCostCents ?? minAucCents,
      costPerEssenceCents: null,
      minCardCents,
      highlightCount: nb.instantBuyCardsNeeded,
    };
  }

  const remainingSlots = Math.max(
    1,
    item.collection.slotsCount - item.collection.fulfilledSlotsCount,
  );
  return {
    kind: "floor",
    cardsNeeded: remainingSlots,
    subLabel: `${remainingSlots} to Full`,
    primaryText: "Lineup Bonus %",
    costCents: minCardCents,
    auctionCostCents: minAucCents,
    costPerEssenceCents: null,
    minCardCents,
    highlightCount: Math.min(3, ops.length),
  };
}

interface CollectionsTabProps {
  analyses: CollectionAnalysis[];
  summary: PortfolioSummary;
  cardCounts: CardCounts | null;
  questCards?: QuestCardSummary[];
  walletBalance?: WalletBalanceInfo;
  bargains?: BargainsResult | null;
  allScannedBargains?: BargainsResult["listings"];
  galleryCards?: GalleryCard[];
  activeEssence?: number;
  craftThreshold?: number;
  injuriesByName: Record<string, InjuryReportEntry>;
  pricedSlugs: string[];
  pricingSlug: string | null;
  isQuestDealsLoading?: boolean;
  hasLoadedQuestDeals?: boolean;
  onPriceCollection: (slug: string) => void;
  onPriceTopCollections: (slugs: string[]) => void;
  onCancelScan?: () => void;
  onLoadQuestDeals?: () => void;
  onSwitchTab?: (tab: "bargains" | "gallery") => void;
  onScanNow: () => void;
  currency: Currency;
  rarity: Rarity;
  craftReadyOnly: boolean;
  onToggleCraftReadyOnly: () => void;
  inSeasonOnly: boolean;
  onToggleInSeasonOnly: () => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  hasScanned: boolean;
  hasUsername: boolean;
  isLoading: boolean;
}

function extractCollectionSeasonTag(slug: string): string | null {
  const m = slug.match(/(\d{4})-(\d{2})$/);
  if (!m) return null;
  return `${m[1].slice(-2)}-${m[2]}`;
}

function getOwnedCountForRarity(
  cardCounts: CardCounts | null,
  rarity: Rarity,
): number | null {
  if (!cardCounts) return null;
  switch (rarity) {
    case "limited":
      return cardCounts.limited;
    case "rare":
      return cardCounts.rare;
    case "super_rare":
      return cardCounts.superRare;
    case "unique":
      return cardCounts.unique;
  }
}

export function CollectionsTab({
  analyses,
  summary,
  cardCounts,
  questCards = [],
  walletBalance,
  bargains = null,
  allScannedBargains = [],
  galleryCards = [],
  activeEssence = 0,
  craftThreshold = 1000,
  injuriesByName,
  pricedSlugs,
  pricingSlug,
  isQuestDealsLoading = false,
  hasLoadedQuestDeals = false,
  onPriceCollection,
  onPriceTopCollections,
  onCancelScan,
  onLoadQuestDeals,
  onSwitchTab,
  onScanNow,
  currency,
  rarity,
  craftReadyOnly,
  onToggleCraftReadyOnly,
  inSeasonOnly,
  onToggleInSeasonOnly,
  searchQuery,
  onSearchQueryChange,
  hasScanned,
  hasUsername,
  isLoading,
}: CollectionsTabProps) {
  const [sortField, setSortField] = useState<SortField>("minCard");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [pricedOnly, setPricedOnly] = useState<boolean>(false);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [expandedQuestId, setExpandedQuestId] = useState<string | null>(null);
  const [activeBatchButton, setActiveBatchButton] = useState<
    "top3" | "season" | "all" | null
  >(null);
  const [questBuyFilter, setQuestBuyFilter] = useState<
    "all" | "primary_instant" | "auction"
  >("all");

  const rarityMeta = RARITY_META[rarity];
  const pricedSet = useMemo(() => new Set(pricedSlugs), [pricedSlugs]);
  const ownedCount = getOwnedCountForRarity(cardCounts, rarity);
  const isBatchLoading = pricingSlug === "__batch__";
  const currentBatchBtn = isBatchLoading ? activeBatchButton : null;
  const hasCustomTeamTiers = useMemo(
    () => analyses.some((a) => a.nextEssenceMilestone !== null),
    [analyses],
  );

  // Quick-find: closest unpriced team collections (for Bonus % / Full Team / Any-Year Floor Hunter)
  const closestUnpricedSlugs = useMemo(() => {
    return [...analyses]
      .filter((a) => !a.collection.complete && !pricedSet.has(a.collection.slug))
      .sort((a, b) => {
        const ia = a.collection.inSeason ? 0 : 1;
        const ib = b.collection.inSeason ? 0 : 1;
        if (ia !== ib) return ia - ib;
        const ta = getTeamTargetSummary(a).cardsNeeded;
        const tb = getTeamTargetSummary(b).cardsNeeded;
        return ta - tb;
      })
      .slice(0, 3)
      .map((a) => a.collection.slug);
  }, [analyses, pricedSet]);

  const inSeasonUnpricedSlugs = useMemo(() => {
    return analyses
      .filter(
        (a) =>
          !a.collection.complete &&
          a.collection.inSeason &&
          !pricedSet.has(a.collection.slug),
      )
      .sort(
        (a, b) =>
          getTeamTargetSummary(a).cardsNeeded -
          getTeamTargetSummary(b).cardsNeeded,
      )
      .map((a) => a.collection.slug);
  }, [analyses, pricedSet]);

  const allUnpricedIncompleteSlugs = useMemo(() => {
    return analyses
      .filter((a) => !a.collection.complete && !pricedSet.has(a.collection.slug))
      .sort((a, b) => {
        const ia = a.collection.inSeason ? 0 : 1;
        const ib = b.collection.inSeason ? 0 : 1;
        if (ia !== ib) return ia - ib;
        return (
          getTeamTargetSummary(a).cardsNeeded -
          getTeamTargetSummary(b).cardsNeeded
        );
      })
      .map((a) => a.collection.slug);
  }, [analyses, pricedSet]);

  const questEval = useMemo(() => {
    const listings =
      allScannedBargains.length > 0
        ? allScannedBargains
        : (bargains?.listings ?? []);
    return evaluateLeagueQuests(questCards, analyses, rarity, listings);
  }, [allScannedBargains, analyses, bargains, questCards, rarity]);

  const topQuest = questEval.quests[0] ?? null;

  const cheapestTeamFloorPick = useMemo(() => {
    let best: {
      cents: number;
      playerName: string;
      teamName: string;
      slug: string;
    } | null = null;
    for (const item of analyses) {
      if (!pricedSet.has(item.collection.slug)) continue;
      const ops = getCollectionOps(item);
      const firstInstant = ops.find((op) => op.instantBuyCents !== null);
      if (!firstInstant || firstInstant.instantBuyCents === null) continue;
      if (!best || firstInstant.instantBuyCents < best.cents) {
        best = {
          cents: firstInstant.instantBuyCents,
          playerName: firstInstant.slot.playerName,
          teamName: item.collection.name,
          slug: item.collection.slug,
        };
      }
    }
    return best;
  }, [analyses, pricedSet]);

  const nearingGoals = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      detail: string;
      pct: number;
      accent: string;
    }> = [];

    if (craftThreshold > 0) {
      const pct = Math.min(100, Math.round((activeEssence / craftThreshold) * 100));
      const gap = Math.max(0, craftThreshold - activeEssence);
      items.push({
        id: "craft",
        label: `Craft Threshold (${activeEssence}/${craftThreshold})`,
        detail: gap === 0 ? "CRAFT READY!" : `${gap}E left`,
        pct,
        accent: gap === 0 ? "bg-emerald-400" : "bg-amber-400",
      });
    }

    const topTwoQuests = [...questEval.quests]
      .filter((q) => q.id !== "full-collection" && q.target > 0)
      .sort((a, b) => b.progressPct - a.progressPct)
      .slice(0, 2);
    for (const q of topTwoQuests) {
      items.push({
        id: `quest-${q.id}`,
        label: `${q.name} (${q.current}/${q.target})`,
        detail: `${q.remaining} 1ST left • +${q.essenceReward}E`,
        pct: q.progressPct,
        accent: "bg-emerald-400",
      });
    }

    const closestBonus = [...analyses]
      .filter((a) => a.collection.inSeason && a.nextBonusThreshold !== null)
      .sort(
        (a, b) =>
          (a.nextBonusThreshold?.scoreNeeded ?? 999) -
          (b.nextBonusThreshold?.scoreNeeded ?? 999),
      )[0];
    if (closestBonus?.nextBonusThreshold) {
      const nb = closestBonus.nextBonusThreshold;
      const pct = Math.min(
        100,
        Math.round((closestBonus.collection.score / Math.max(1, nb.threshold)) * 100),
      );
      items.push({
        id: `bonus-${closestBonus.collection.slug}`,
        label: `${closestBonus.collection.name.replace(/ Limited| Rare/g, "")} +${Math.round(nb.bonus * 100)}% Bonus`,
        detail: `${nb.instantBuyCardsNeeded}×2nd / ${nb.firstOwnerCardsNeeded}×1st left`,
        pct,
        accent: "bg-sky-400",
      });
    }

    return items.slice(0, 4);
  }, [activeEssence, analyses, craftThreshold, questEval.quests]);

  const teamQuickPicks = useMemo(() => {
    return [...analyses]
      .filter((a) => {
        if (!pricedSet.has(a.collection.slug)) return false;
        const target = getTeamTargetSummary(a);
        return target.costCents !== null || target.minCardCents !== null;
      })
      .sort((a, b) => {
        const ta = getTeamTargetSummary(a);
        const tb = getTeamTargetSummary(b);
        if (hasCustomTeamTiers) {
          const ca = ta.costPerEssenceCents ?? Number.MAX_SAFE_INTEGER;
          const cb = tb.costPerEssenceCents ?? Number.MAX_SAFE_INTEGER;
          if (ca !== cb) return ca - cb;
        }
        const pa = ta.costCents ?? ta.minCardCents ?? Number.MAX_SAFE_INTEGER;
        const pb = tb.costCents ?? tb.minCardCents ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return ta.cardsNeeded - tb.cardsNeeded;
      })
      .slice(0, 3);
  }, [analyses, hasCustomTeamTiers, pricedSet]);

  const liquidityAdvice = useMemo(() => {
    const topTargetCostCents = questEval.topQuestInstantCostCents ?? null;
    const cashCents =
      walletBalance?.cashAmount !== null &&
      walletBalance?.cashAmount !== undefined
        ? Math.round(walletBalance.cashAmount * 100)
        : null;
    const shortfallCents =
      topTargetCostCents !== null && cashCents !== null
        ? Math.max(0, topTargetCostCents - cashCents)
        : null;
    const sellCandidate = galleryCards
      .filter(
        (c) =>
          c.rarity === rarity &&
          (c.openedLineupIds?.length ?? 0) === 0,
      )
      .sort((a, b) => {
        const va = a.lowestAskCents ?? (a.l10 ?? 0) * 15;
        const vb = b.lowestAskCents ?? (b.l10 ?? 0) * 15;
        return vb - va;
      })[0];
    return {
      cashCents,
      topTargetCostCents,
      shortfallCents,
      sellCandidate,
    };
  }, [galleryCards, questEval.topQuestInstantCostCents, rarity, walletBalance]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(field !== "essenceRewarded");
    }
  };

  const ariaSortFor = (
    field: SortField,
  ): "ascending" | "descending" | undefined => {
    if (sortField !== field) return undefined;
    return sortAsc ? "ascending" : "descending";
  };

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = analyses.filter((item) => {
      if (pricedOnly && !pricedSet.has(item.collection.slug)) {
        return false;
      }
      if (
        hasCustomTeamTiers &&
        craftReadyOnly &&
        !item.nextEssenceMilestone?.isCraftReadyBridge
      ) {
        return false;
      }
      if (q) {
        const matchesName = item.collection.name.toLowerCase().includes(q);
        const matchesPlayer = getCollectionOps(item).some((op) =>
          op.slot.playerName.toLowerCase().includes(q),
        );
        if (!matchesName && !matchesPlayer) return false;
      }
      return true;
    });

    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      const ta = getTeamTargetSummary(a);
      const tb = getTeamTargetSummary(b);
      switch (sortField) {
        case "name":
          return a.collection.name.localeCompare(b.collection.name) * dir;
        case "cardsNeeded":
          return (ta.cardsNeeded - tb.cardsNeeded) * dir;
        case "essenceRewarded": {
          const va = a.nextEssenceMilestone?.essenceRewarded ?? -1;
          const vb = b.nextEssenceMilestone?.essenceRewarded ?? -1;
          return (va - vb) * dir;
        }
        case "totalCost": {
          const va = ta.costCents ?? Number.MAX_SAFE_INTEGER;
          const vb = tb.costCents ?? Number.MAX_SAFE_INTEGER;
          return (va - vb) * dir;
        }
        case "costPerEssence": {
          const va = ta.costPerEssenceCents ?? Number.MAX_SAFE_INTEGER;
          const vb = tb.costPerEssenceCents ?? Number.MAX_SAFE_INTEGER;
          if (va !== vb) return (va - vb) * dir;
          return (ta.cardsNeeded - tb.cardsNeeded) * dir;
        }
        case "minCard":
        default: {
          const va = ta.minCardCents ?? Number.MAX_SAFE_INTEGER;
          const vb = tb.minCardCents ?? Number.MAX_SAFE_INTEGER;
          if (va !== vb) return (va - vb) * dir;
          const ia = a.collection.inSeason ? 0 : 1;
          const ib = b.collection.inSeason ? 0 : 1;
          if (ia !== ib) return (ia - ib) * dir;
          return ta.cardsNeeded - tb.cardsNeeded;
        }
      }
    });
  }, [
    analyses,
    craftReadyOnly,
    hasCustomTeamTiers,
    pricedOnly,
    pricedSet,
    searchQuery,
    sortAsc,
    sortField,
  ]);

  const handleToggleRow = (slug: string) => {
    if (expandedSlug === slug) {
      setExpandedSlug(null);
      return;
    }
    setExpandedSlug(slug);
    if (!pricedSet.has(slug)) {
      onPriceCollection(slug);
    }
  };

  if (!hasScanned && !isLoading) {
    return (
      <div className="rounded-2xl border border-white/8 bg-[#111726] p-6 text-center">
        <Sparkles className={`mx-auto mb-2.5 h-7 w-7 ${rarityMeta.accentClass}`} />
        <h2 className="text-sm font-semibold text-slate-100">
          {hasUsername
            ? `Ready to Scan ${rarityMeta.label}`
            : "Enter Your Sorare Username"}
        </h2>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
          Loads your active NBA collections first (~1-3 API calls), then prices
          individual collections only when you click them - keeping Sorare fast
          and rate-limit safe.
        </p>
        {hasUsername && (
          <button
            type="button"
            onClick={onScanNow}
            className="mt-3.5 rounded-xl jam-btn-primary px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-sm"
          >
            Scan {rarityMeta.label} Collections
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Minimalist 4-Card KPI Grid (Real Verified Data Only) */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/8 bg-[#111726] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <Trophy className="h-3 w-3 text-amber-400" />
            {rarityMeta.label} Gallery
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg font-semibold text-slate-100">
              {ownedCount !== null ? ownedCount : "--"}
            </span>
            <span className="text-[11px] text-slate-400">
              • {analyses.length} active
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <Sparkles className={`h-3 w-3 ${rarityMeta.accentClass}`} />
            Live Quest Essence
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={`text-lg font-semibold ${rarityMeta.accentClass}`}>
              {questEval.totalLiveQuestEssence.toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-400">Essence</span>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <Zap className="h-3 w-3 text-emerald-400" />
            Best Real Quest
          </div>
          {topQuest ? (
            <>
              <div className="mt-1 text-base font-semibold text-emerald-300">
                +{topQuest.essencePerRemainingCard}E/card
              </div>
              <div
                className="truncate text-[11px] text-slate-400"
                title={topQuest.name}
              >
                {topQuest.name} ({topQuest.remaining} left)
              </div>
            </>
          ) : (
            <div className="mt-1 text-xs text-slate-400">Scan to score</div>
          )}
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <TrendingDown className="h-3 w-3 text-sky-400" />
            Cheapest Any-Year
          </div>
          {cheapestTeamFloorPick ? (
            <>
              <div className="mt-1 text-base font-semibold text-sky-300">
                {formatMoney(cheapestTeamFloorPick.cents, currency)}
              </div>
              <div
                className="truncate text-[11px] text-slate-400"
                title={`${cheapestTeamFloorPick.playerName} • ${cheapestTeamFloorPick.teamName}`}
              >
                {cheapestTeamFloorPick.playerName} •{" "}
                {cheapestTeamFloorPick.teamName.replace(/ Limited| Rare/g, "")}
              </div>
            </>
          ) : (
            <div className="mt-1 text-xs text-slate-400">
              Use Team Hunter below
            </div>
          )}
        </div>
      </div>

      {/* Nearing Goal Progress Radar */}
      {nearingGoals.length > 0 && (
        <div className="rounded-2xl border border-white/8 bg-[#111726] p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span className="inline-flex items-center gap-1.5 text-slate-200">
              <Sparkles className={`h-3.5 w-3.5 ${rarityMeta.accentClass}`} />
              Nearing Goal Radar
            </span>
            <span>Real Quests &amp; Bonus %</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {nearingGoals.map((g) => (
              <div
                key={g.id}
                className="rounded-xl border border-white/6 bg-[#0b101b] px-2.5 py-1.5 text-[10px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-slate-100">
                    {g.label}
                  </span>
                  <span className="shrink-0 font-bold text-amber-300">
                    {g.pct}%
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/50">
                  <div
                    className={`h-full ${g.accent}`}
                    style={{ width: `${g.pct}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[9.5px] text-slate-400">
                  {g.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hero Section 1 (Open by default): Real NBA League Quests Quick Finder */}
      <details
        open
        className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]"
      >
        <summary className="flex w-full cursor-pointer select-none items-center justify-between px-3 py-2.5 text-left text-[11px] hover:bg-white/[0.03]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-100">
            <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
            Real Essence Quests (Quick Finder)
          </span>
          <span className="text-[10px] text-emerald-300">
            {questCards.length > 0
              ? `${questCards.length} cards tracked`
              : `${LEAGUE_ESSENCE_MISSIONS.length} quests`}
          </span>
        </summary>

        <div className="space-y-2.5 border-t border-white/8 bg-[#0b101b] p-3 text-[11px]">
          <div className="rounded-lg border border-white/6 bg-[#111726] px-2.5 py-1.5 text-[10px] text-amber-200">
            <strong className="text-amber-300">Best Move:</strong>{" "}
            {questEval.bestOverallSummary}
          </div>

          {(walletBalance?.cashAmount !== null ||
            walletBalance?.ethAmount !== null) && (
            <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-white/6 bg-[#111726] px-2.5 py-1.5 text-[10px]">
              <div className="flex items-center gap-1.5 text-slate-200">
                <Wallet className="h-3 w-3 text-emerald-400" />
                <span>
                  Wallet:{" "}
                  <strong className="text-emerald-300">
                    {walletBalance?.cashAmount !== null &&
                    walletBalance?.cashAmount !== undefined
                      ? `${walletBalance.cashSymbol ?? "€"}${walletBalance.cashAmount.toFixed(2)}`
                      : "--"}
                  </strong>
                  {walletBalance?.ethAmount !== null &&
                    walletBalance?.ethAmount !== undefined && (
                      <span className="text-slate-400">
                        {" "}
                        + {walletBalance.ethAmount} ETH
                      </span>
                    )}
                </span>
              </div>
              {liquidityAdvice.shortfallCents !== null ? (
                <div className="flex items-center gap-1.5">
                  {liquidityAdvice.shortfallCents === 0 ? (
                    <span className="font-semibold text-emerald-300">
                      Enough Cash for #1 Quest!
                    </span>
                  ) : (
                    <>
                      <span className="text-amber-300">
                        Need +
                        {formatMoney(liquidityAdvice.shortfallCents, currency)}{" "}
                        for #1 Quest{" "}
                        {liquidityAdvice.sellCandidate
                          ? `(Sell ${liquidityAdvice.sellCandidate.playerName})`
                          : ""}
                      </span>
                      {onSwitchTab && (
                        <button
                          type="button"
                          onClick={() => onSwitchTab("gallery")}
                          className="rounded border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                        >
                          Sell Cards
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                !hasLoadedQuestDeals && (
                  <span className="text-slate-400">
                    Click Load 1ST Instant &amp; Auctions to check cost vs Wallet
                  </span>
                )
              )}
            </div>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#111726] p-0.5">
                {(
                  [
                    { id: "all", label: "All 1ST" },
                    { id: "primary_instant", label: "1ST Instant Buy" },
                    { id: "auction", label: "1ST Auctions (<1h)" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setQuestBuyFilter(opt.id)}
                    className={`cursor-pointer rounded-md px-2 py-0.5 text-[9.5px] font-semibold transition ${
                      questBuyFilter === opt.id
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {onLoadQuestDeals && (
                <button
                  type="button"
                  disabled={isQuestDealsLoading}
                  onClick={onLoadQuestDeals}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg jam-btn-primary px-2.5 py-1 text-[10px] font-bold text-slate-950 shadow-xs transition disabled:opacity-50"
                >
                  {isQuestDealsLoading && (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  )}
                  Load 1ST Instant &amp; Auctions
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {questEval.quests.map((q) => {
                const isOpen =
                  expandedQuestId === q.id ||
                  (expandedQuestId === null && q.isTopOptimal);
                const visibleBuys = q.cheapestBuys
                  .filter((cand) => {
                    if (questBuyFilter === "primary_instant") {
                      return q.firstOwnerOnly
                        ? Boolean(cand.isPrimaryOffer)
                        : cand.saleType === "instant_buy";
                    }
                    if (questBuyFilter === "auction") {
                      return q.firstOwnerOnly
                        ? Boolean(cand.isFirstOwnerEligible) &&
                            cand.saleType === "auction"
                        : cand.saleType === "auction";
                    }
                    return q.firstOwnerOnly
                      ? cand.isFirstOwnerEligible || Boolean(cand.isPrimaryOffer)
                      : true;
                  })
                  .slice(0, 5);
                return (
                  <div
                    key={q.id}
                    title={q.description}
                    className={`rounded-xl border p-2.5 ${
                      q.isTopOptimal
                        ? "border-amber-400/50 bg-[#141c2f]"
                        : "border-white/8 bg-[#111726]"
                    }`}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() =>
                        setExpandedQuestId((prev) =>
                          prev === q.id ? "__none__" : q.id,
                        )
                      }
                      className="block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-amber-400"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="flex min-w-0 items-center gap-1">
                          {isOpen ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-amber-300" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                          )}
                          <span className="truncate font-semibold text-slate-100">
                            {q.name}
                          </span>
                          {q.isTopOptimal && (
                            <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[9px] font-bold text-amber-300">
                              BEST
                            </span>
                          )}
                        </span>
                        <span
                          className={`shrink-0 rounded border px-1 text-[9px] font-bold ${
                            q.firstOwnerOnly
                              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                              : "border-sky-400/40 bg-sky-500/15 text-sky-300"
                          }`}
                        >
                          {q.firstOwnerOnly ? "1ST" : "ANY"}
                        </span>
                      </div>

                      {/* Progress Count & Bar */}
                      <div className="mt-1 flex items-center justify-between text-[10px]">
                        <span className="text-slate-300">
                          {q.id === "full-collection"
                            ? q.closestTeamName
                              ? `${q.closestTeamName.replace(/ Limited| Rare/g, "")}`
                              : "Closest team"
                            : `${q.current} / ${q.target}`}{" "}
                          •{" "}
                          <strong className="text-amber-300">
                            +{q.essenceReward.toLocaleString()}E
                          </strong>
                        </span>
                        <span className="text-emerald-300">
                          +{q.essencePerRemainingCard}E/card
                        </span>
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/50">
                        <div
                          className={`h-full ${
                            q.isTopOptimal ? "bg-amber-400" : "bg-emerald-400"
                          }`}
                          style={{ width: `${q.progressPct}%` }}
                        />
                      </div>
                    </button>

                    <div className="mt-1.5 flex items-center justify-between text-[9px] text-slate-400">
                      <span>
                        {q.remaining === 0
                          ? "Completed"
                          : `${q.remaining} ${q.firstOwnerOnly ? "1st-owner" : "Instant Buy"} left`}
                      </span>
                      <div className="flex items-center gap-2">
                        {visibleBuys.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedQuestId((prev) =>
                                prev === q.id ? "__none__" : q.id,
                              )
                            }
                            className="cursor-pointer text-sky-300 hover:text-sky-200"
                          >
                            {isOpen ? "Hide picks" : `${visibleBuys.length} cheapest`}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void openInActiveTab(q.marketFilterUrl)}
                          className="inline-flex cursor-pointer items-center gap-0.5 text-amber-300 hover:text-amber-200"
                        >
                          {q.firstOwnerOnly ? "Primary Auctions" : "Market"}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-2 space-y-1 border-t border-white/8 pt-1.5">
                        {visibleBuys.length === 0 ? (
                          <div className="flex items-center justify-between gap-2 text-[9.5px] text-slate-400">
                            <span>
                              {hasLoadedQuestDeals || allScannedBargains.length > 0
                                ? "No live matches on Sorare right now (auctions only show if < 1h left). Click Refresh or check Sorare directly."
                                : questBuyFilter === "primary_instant"
                                  ? "Click Load Prices to find direct Sorare Primary Offers."
                                  : questBuyFilter === "auction"
                                    ? "Click Load Prices to scan live <1h 2026 auctions."
                                    : "Click Load Prices to rank cheapest eligible buys."}
                            </span>
                            {onLoadQuestDeals ? (
                              <button
                                type="button"
                                disabled={isQuestDealsLoading}
                                onClick={onLoadQuestDeals}
                                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg jam-btn-primary px-2.5 py-1 font-bold text-slate-950 shadow-xs transition disabled:opacity-50"
                              >
                                {isQuestDealsLoading && (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                )}
                                {hasLoadedQuestDeals || allScannedBargains.length > 0
                                  ? "Refresh Prices"
                                  : "Load Prices"}
                              </button>
                            ) : (
                              onSwitchTab && (
                                <button
                                  type="button"
                                  onClick={() => onSwitchTab("bargains")}
                                  className="shrink-0 cursor-pointer rounded-lg jam-btn-primary px-2.5 py-1 font-bold text-slate-950 shadow-xs"
                                >
                                  Scan Deals
                                </button>
                              )
                            )}
                          </div>
                        ) : (
                          visibleBuys.map((cand, idx) => (
                            <div
                              key={`${cand.playerSlug}-${cand.saleType}-${cand.isPrimaryOffer ? "p" : "s"}-${idx}`}
                              className="flex items-center justify-between gap-1.5 rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1 text-[10px]"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                  <span
                                    className={`shrink-0 rounded px-1 text-[8.5px] font-bold ${
                                      cand.isPrimaryOffer
                                        ? "bg-emerald-500/25 text-emerald-200"
                                        : cand.isFirstOwnerEligible
                                          ? "bg-amber-400/20 text-amber-200"
                                          : "bg-sky-500/15 text-sky-300"
                                    }`}
                                  >
                                    {cand.isPrimaryOffer
                                      ? "1ST BUY"
                                      : cand.isFirstOwnerEligible
                                        ? "1ST AUC"
                                        : cand.saleType === "auction"
                                          ? "AUC"
                                          : "BUY"}
                                  </span>
                                  <span className="truncate font-medium text-slate-100">
                                    {cand.playerName}
                                  </span>
                                  {cand.saleType === "auction" && cand.endDate && (
                                    <span className="shrink-0 text-[8.5px] font-semibold text-sky-300">
                                      {formatTimeLeft(cand.endDate)}
                                    </span>
                                  )}
                                </div>
                                {cand.overlappingQuestLabels.length > 1 && (
                                  <div className="truncate text-[8.5px] text-violet-300">
                                    Multi: {cand.overlappingQuestLabels.join(" + ")}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => void openInActiveTab(cand.marketUrl)}
                                className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-amber-400/15 px-1.5 py-0.5 font-semibold text-amber-200 hover:bg-amber-400/25"
                              >
                                {formatMoney(cand.priceCents, currency)}
                                <ExternalLink className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              All Essence Earning Channels
            </div>
            <div className="space-y-1">
              {ESSENCE_EARNING_SOURCES.map((src) => (
                <div
                  key={src.id}
                  className="flex items-baseline justify-between gap-2 rounded-lg border border-white/6 bg-[#111726] px-2 py-1 text-[10px]"
                >
                  <span className="font-medium text-slate-200">
                    {src.label}
                  </span>
                  <span className="truncate text-slate-400">{src.detail}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-white/8 pt-2 text-[10px]">
            <span className="rounded border border-emerald-400/40 bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300">
              1ST = First-Owner (Quests)
            </span>
            <span className="rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300">
              2ND = Secondary (Team Bonus Only)
            </span>
            <span className="rounded border border-sky-400/40 bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-300">
              IN-S = In-Season Pro
            </span>
            <span className="rounded border border-rose-400/40 bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-300">
              OUT/GTD = ESPN Injury
            </span>
            <span className="rounded border border-violet-400/40 bg-violet-500/15 px-1.5 py-0.5 font-semibold text-violet-300">
              xN = Multi-Collection Overlap
            </span>
          </div>
        </div>
      </details>

      {/* Hero Section 2 (Open by default): Team Collections - Bonus % & Cheapest Any-Year Hunter */}
      <details
        open
        className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]"
      >
        <summary className="flex w-full cursor-pointer select-none items-center justify-between border-b border-white/6 px-3 py-2.5 text-left text-[11px] hover:bg-white/[0.03]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-100">
            <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-sky-400" />
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            Team Collections - Bonus % &amp; Any-Year Hunter
          </span>
          <span className="text-[10px] text-slate-400">
            {filteredAndSorted.length} shown
          </span>
        </summary>

        <div className="space-y-2.5 border-b border-white/6 bg-[#0e1422]/70 p-3">
          <div className="text-[10px] leading-relaxed text-slate-400">
            Team Collections earn <strong className="text-sky-300">+1% to +5% Lineup Bonus</strong> across any season
            {" "}(finishing 100% of a team unlocks the <strong className="text-amber-300">+2,000E Full Collection</strong> Quest above).
          </div>

          {/* Search, Season Switcher (Active 26-27 <-> All Years), and Quick Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Filter team or player..."
              aria-label="Filter collections by team or player"
              className="min-w-[120px] flex-1 rounded-xl border border-white/8 bg-[#0b101b] px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-400/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={onToggleInSeasonOnly}
              className={`cursor-pointer rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition ${
                !inSeasonOnly
                  ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                  : "border-amber-400/50 bg-amber-500/15 text-amber-200"
              }`}
              title="Toggle between Active 2026-27 sets only and All Seasons (to hunt cheapest any-year options)"
            >
              {inSeasonOnly ? "Active 26-27" : "All Years"}
            </button>
            <button
              type="button"
              onClick={() => setPricedOnly((prev) => !prev)}
              className={`cursor-pointer rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition ${
                pricedOnly
                  ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                  : "border-white/8 bg-[#0b101b] text-slate-300 hover:text-slate-100"
              }`}
            >
              Priced ({pricedSlugs.length})
            </button>
            {hasCustomTeamTiers && (
              <button
                type="button"
                onClick={onToggleCraftReadyOnly}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition ${
                  craftReadyOnly
                    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                    : "border-white/8 bg-[#0b101b] text-slate-300 hover:text-slate-100"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                Craft Ready
                {summary.craftReadyMatches.length > 0 && (
                  <span className="rounded bg-emerald-500/25 px-1 text-[10px] text-emerald-100">
                    {summary.craftReadyMatches.length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Cheapest Any-Year Team Hunter Controls */}
          <div className="rounded-xl border border-sky-400/20 bg-[#0b101b] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-[11px] font-semibold text-slate-100">
                Cheapest Any-Year &amp; Quickest Team Hunter
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {closestUnpricedSlugs.length > 0 && (
                  <button
                    type="button"
                    disabled={Boolean(pricingSlug)}
                    onClick={() => {
                      setActiveBatchButton("top3");
                      onPriceTopCollections(closestUnpricedSlugs);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg jam-btn-primary px-2.5 py-1 text-[10.5px] font-bold text-slate-950 shadow-xs transition disabled:opacity-50"
                    title="Price the 3 closest unpriced teams (~4s)"
                  >
                    {currentBatchBtn === "top3" && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {currentBatchBtn === "top3"
                      ? "Loading Top 3..."
                      : `Top ${closestUnpricedSlugs.length}`}
                  </button>
                )}
                {!inSeasonOnly &&
                  inSeasonUnpricedSlugs.length > closestUnpricedSlugs.length && (
                    <button
                      type="button"
                      disabled={Boolean(pricingSlug)}
                      onClick={() => {
                        setActiveBatchButton("season");
                        onPriceTopCollections(inSeasonUnpricedSlugs);
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-sky-400/50 bg-sky-500/20 px-2.5 py-1 text-[10.5px] font-bold text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-50"
                      title="Price all incomplete active 2026-27 team collections (~45s in Public Mode)"
                    >
                      {currentBatchBtn === "season" && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {currentBatchBtn === "season"
                        ? "Loading 26-27..."
                        : `Load 26-27 (${inSeasonUnpricedSlugs.length})`}
                    </button>
                  )}
                {allUnpricedIncompleteSlugs.length > closestUnpricedSlugs.length && (
                  <button
                    type="button"
                    disabled={Boolean(pricingSlug)}
                    onClick={() => {
                      setActiveBatchButton("all");
                      onPriceTopCollections(allUnpricedIncompleteSlugs);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg jam-btn-primary px-2.5 py-1 text-[10.5px] font-bold text-slate-950 shadow-xs transition disabled:opacity-50"
                    title="Price every incomplete team in this view (2-4 min in Public Mode)"
                  >
                    {currentBatchBtn === "all" && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {currentBatchBtn === "all"
                      ? "Loading All..."
                      : `Load All (${allUnpricedIncompleteSlugs.length})`}
                  </button>
                )}
                {Boolean(pricingSlug) && onCancelScan && (
                  <button
                    type="button"
                    onClick={onCancelScan}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-rose-400/45 bg-rose-500/20 px-2 py-1 text-[10px] font-bold text-rose-100 hover:bg-rose-500/30"
                  >
                    <X className="h-3 w-3" />
                    Stop
                  </button>
                )}
              </div>
            </div>

            {(allUnpricedIncompleteSlugs.length > 0 || Boolean(pricingSlug)) && (
              <div className="mt-1.5 text-[9.5px] leading-relaxed text-slate-400">
                <strong className="text-amber-200">Rate-limit note:</strong> Public Mode (~50-120 req/min):{" "}
                <strong className="text-emerald-300">Top 3</strong> ~4s,{" "}
                <strong className="text-sky-300">26-27</strong> ~45s,{" "}
                <strong className="text-amber-300">
                  Load All ({allUnpricedIncompleteSlugs.length})
                </strong>{" "}
                2-4 min. Add a local API Key in Settings for 60x speed.
              </div>
            )}

            {teamQuickPicks.length === 0 ? (
              <p className="mt-1.5 text-[10.5px] text-slate-400">
                Switch between <strong>Active 26-27</strong> and <strong>All Years</strong> above, then click{" "}
                <strong>Top {Math.max(1, closestUnpricedSlugs.length)}</strong> or <strong>Load All</strong> to hunt the cheapest team cards &amp; Bonus % jumps.
              </p>
            ) : (
              <div className="mt-2 space-y-1">
                {teamQuickPicks.map((item) => {
                  const target = getTeamTargetSummary(item);
                  const ops = getCollectionOps(item);
                  const cheapestPlayer = ops.find((op) => op.instantBuyCents !== null);
                  const seasonTag = extractCollectionSeasonTag(item.collection.slug);
                  return (
                    <button
                      key={item.collection.slug}
                      type="button"
                      onClick={() => handleToggleRow(item.collection.slug)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/6 bg-[#111726] px-2.5 py-1.5 text-left text-[11px] hover:border-sky-400/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-slate-100">
                            {item.collection.name}
                          </span>
                          {seasonTag && (
                            <span className="rounded bg-white/8 px-1 text-[9px] text-slate-300">
                              {seasonTag}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {target.kind === "custom_essence" ? (
                            <>
                              {target.cardsNeeded} buys →{" "}
                              <strong className="text-amber-300">
                                {target.primaryText}
                              </strong>{" "}
                              ({formatCostPerEssence(target.costPerEssenceCents, currency)})
                            </>
                          ) : target.kind === "bonus" ? (
                            <>
                              {target.cardsNeeded} card
                              {target.cardsNeeded > 1 ? "s" : ""} →{" "}
                              <strong className="text-sky-300">
                                {target.primaryText}
                              </strong>{" "}
                              • {target.subLabel}
                            </>
                          ) : (
                            <>
                              Floor:{" "}
                              <strong className="text-slate-200">
                                {cheapestPlayer?.slot.playerName ?? "Player"}
                              </strong>{" "}
                              • {target.subLabel}
                            </>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 font-semibold text-emerald-300">
                        {target.kind === "floor"
                          ? `from ${formatMoney(target.minCardCents, currency)}`
                          : formatMoney(target.costCents, currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div role="region" aria-labelledby="collections-table-caption">
          <table className="w-full border-collapse text-left">
          <caption id="collections-table-caption" className="sr-only">
            NBA team collections ranked by cheapest floor and bonus targets
          </caption>
          <thead>
            <tr className="border-b border-white/8 bg-[#0e1422] text-[10px] font-medium uppercase tracking-wider text-slate-400">
              <th scope="col" aria-sort={ariaSortFor("name")} className="p-0">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="flex w-full items-center gap-1 px-3 py-2.5 text-left hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-amber-400"
                >
                  Collection
                  <SortArrow active={sortField === "name"} asc={sortAsc} />
                </button>
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor("cardsNeeded")}
                className="p-0 text-right"
              >
                <button
                  type="button"
                  onClick={() => handleSort("cardsNeeded")}
                  className="flex w-full items-center justify-end gap-0.5 px-2 py-2.5 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-amber-400"
                >
                  Goal
                  <SortArrow
                    active={sortField === "cardsNeeded"}
                    asc={sortAsc}
                  />
                </button>
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor("totalCost")}
                className="p-0 text-right"
              >
                <button
                  type="button"
                  onClick={() => handleSort("totalCost")}
                  className="flex w-full items-center justify-end gap-0.5 px-2 py-2.5 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-amber-400"
                >
                  Cost
                  <SortArrow active={sortField === "totalCost"} asc={sortAsc} />
                </button>
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor(hasCustomTeamTiers ? "costPerEssence" : "minCard")}
                className="p-0 text-right"
              >
                <button
                  type="button"
                  onClick={() =>
                    handleSort(hasCustomTeamTiers ? "costPerEssence" : "minCard")
                  }
                  className="flex w-full items-center justify-end gap-0.5 px-3 py-2.5 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-amber-400"
                >
                  {hasCustomTeamTiers ? "$/E" : "Min Card"}
                  <SortArrow
                    active={
                      sortField ===
                      (hasCustomTeamTiers ? "costPerEssence" : "minCard")
                    }
                    asc={sortAsc}
                  />
                </button>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/6">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="p-5 text-center text-xs text-slate-400"
                >
                  {isLoading
                    ? "Loading active collections..."
                    : "No collections match the current filters."}
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((item) => {
                const {
                  collection,
                  nextEssenceMilestone,
                  nextBonusThreshold,
                } = item;
                const ops = getCollectionOps(item);
                const target = getTeamTargetSummary(item);
                const isExpanded = expandedSlug === collection.slug;
                const isPriced = pricedSet.has(collection.slug);
                const isRowLoading = pricingSlug === collection.slug;
                const isCraftBridge =
                  nextEssenceMilestone?.isCraftReadyBridge ?? false;
                const seasonTag = extractCollectionSeasonTag(collection.slug);

                return (
                  <Fragment key={collection.slug}>
                    <tr
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        handleToggleRow(collection.slug);
                      }}
                      className={`cursor-pointer transition hover:bg-white/[0.03] ${
                        isCraftBridge ? "bg-emerald-950/15" : ""
                      }`}
                    >
                      <td className="p-0 align-middle">
                        <button
                          type="button"
                          onClick={() => handleToggleRow(collection.slug)}
                          aria-expanded={isExpanded}
                          className="block w-full cursor-pointer px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-amber-400"
                        >
                          <div className="flex items-center gap-1.5">
                            {isRowLoading ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                            ) : isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                            )}
                            <span className="max-w-[145px] truncate text-xs font-medium text-slate-100">
                              {collection.name}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-5 text-[10px] text-slate-400">
                            {seasonTag && (
                              <span
                                className={`rounded px-1 text-[9px] font-semibold ${
                                  collection.inSeason
                                    ? "border border-amber-400/35 bg-amber-400/15 text-amber-200"
                                    : "bg-white/6 text-slate-400"
                                }`}
                              >
                                {seasonTag}
                              </span>
                            )}
                            <span>
                              {collection.fulfilledSlotsCount}/
                              {collection.slotsCount}
                            </span>
                            {collection.bonus > 0 && (
                              <span className="text-sky-300">
                                • +{Math.round(collection.bonus * 100)}% now
                              </span>
                            )}
                            {nextBonusThreshold && (
                              <span
                                className="text-slate-400"
                                title="Instant Buys add +10 Collection Score; 1st-Owner cards add +20"
                              >
                                → +{Math.round(nextBonusThreshold.bonus * 100)}% @{" "}
                                {nextBonusThreshold.threshold}
                              </span>
                            )}
                            {isCraftBridge && (
                              <span className="rounded border border-emerald-400/35 bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-300">
                                Craft Ready
                              </span>
                            )}
                          </div>
                        </button>
                      </td>

                      <td className="px-2 py-2.5 text-right align-middle">
                        <div className="text-xs font-medium text-slate-200">
                          {target.cardsNeeded}
                        </div>
                        <div
                          className={`text-[10px] ${
                            target.kind === "custom_essence"
                              ? "text-amber-300"
                              : target.kind === "bonus"
                                ? "text-sky-300"
                                : "text-slate-400"
                          }`}
                        >
                          {target.kind === "floor"
                            ? "to Full"
                            : target.primaryText}
                        </div>
                      </td>

                      <td className="px-2 py-2.5 text-right align-middle">
                        {isPriced ? (
                          <>
                            <div className="text-xs font-semibold text-slate-100">
                              {target.kind === "floor" && target.costCents !== null
                                ? `from ${formatMoney(target.costCents, currency)}`
                                : formatMoney(target.costCents, currency)}
                            </div>
                            {target.auctionCostCents !== null &&
                              target.auctionCostCents <
                                (target.costCents ?? Number.MAX_SAFE_INTEGER) && (
                                <div className="text-[10px] text-sky-400">
                                  Auc: {formatMoney(target.auctionCostCents, currency)}
                                </div>
                              )}
                          </>
                        ) : (
                          <span className="rounded-md border border-white/10 bg-[#182136] px-1.5 py-0.5 text-[10px] text-slate-300">
                            Price
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-right align-middle">
                        {hasCustomTeamTiers ? (
                          <>
                            <div className="text-xs font-semibold text-amber-300">
                              {isPriced
                                ? formatCostPerEssence(
                                    target.costPerEssenceCents,
                                    currency,
                                  )
                                : "--"}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {target.subLabel}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs font-semibold text-emerald-300">
                              {isPriced
                                ? formatMoney(target.minCardCents, currency)
                                : "--"}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {target.kind === "bonus"
                                ? target.subLabel
                                : "1st card"}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td
                          colSpan={4}
                          className="border-t border-white/6 bg-[#0b101b] px-3 py-2.5"
                        >
                          {isRowLoading ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-amber-200">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                              Fetching missing players & live floors...
                            </div>
                          ) : !isPriced ? (
                            <div className="py-2 text-xs text-slate-400">
                              Click row to load live prices.
                            </div>
                          ) : ops.length === 0 ? (
                            <div className="py-2 text-xs text-slate-400">
                              No unowned player slots returned for this collection.
                            </div>
                          ) : (
                            <>
                              <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
                                <span>
                                  {target.highlightCount > 0
                                    ? `Cheapest ${target.highlightCount} highlighted (${target.primaryText})`
                                    : "Missing players ranked by floor"}
                                </span>
                                <span>
                                  {item.pricedInstantBuyCount ??
                                    ops.filter((op) => op.instantBuyCents !== null)
                                      .length}
                                  /{ops.length} Instant Buy
                                </span>
                              </div>

                              <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                                {ops.map((op, idx) => {
                                  const isTargetPick = idx < target.highlightCount;
                                    const hasOverlap = op.overlapCount >= 2;
                                    const otherCollections =
                                      op.overlappingCollections
                                        .filter(
                                          (c) => c.slug !== collection.slug,
                                        )
                                        .map((c) => c.name)
                                        .join(", ");
                                    const inj =
                                      injuriesByName[
                                        normalizePlayerName(op.slot.playerName)
                                      ] ?? null;
                                    const savingsCents =
                                      op.instantBuyCents !== null &&
                                      op.auctionBidCents !== null
                                        ? op.instantBuyCents - op.auctionBidCents
                                        : null;
                                    const savingsPct =
                                      savingsCents !== null &&
                                      op.instantBuyCents
                                        ? Math.round(
                                            (savingsCents /
                                              op.instantBuyCents) *
                                              100,
                                          )
                                        : null;

                                    return (
                                      <div
                                        key={`${op.slot.slotId}-${idx}`}
                                        className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-xs ${
                                          isTargetPick
                                            ? "border-amber-400/35 bg-amber-500/10"
                                            : "border-white/6 bg-[#111726]"
                                        }`}
                                      >
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-1">
                                            <span className="font-mono text-[10px] text-slate-500">
                                              #{idx + 1}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void openInActiveTab(
                                                  op.targetUrl,
                                                );
                                              }}
                                              className="inline-flex items-center gap-1 truncate font-medium text-slate-100 hover:text-amber-300 hover:underline"
                                            >
                                              <span className="truncate">
                                                {op.slot.playerName}
                                              </span>
                                              <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
                                            </button>
                                            {op.instantBuyCents !== null && (
                                              <span
                                                className="rounded border border-amber-400/35 bg-amber-500/15 px-1 text-[9px] font-bold text-amber-200"
                                                title="Secondary market Instant Buy: counts for Team Collections, NOT First-Owner League Collect Quests."
                                              >
                                                2ND
                                              </span>
                                            )}
                                            <span
                                              className={`rounded border px-1 text-[9px] font-semibold ${
                                                collection.inSeason
                                                  ? "border-sky-400/35 bg-sky-500/15 text-sky-200"
                                                  : "border-slate-700 bg-slate-800/70 text-slate-400"
                                              }`}
                                              title={
                                                collection.inSeason
                                                  ? "In-Season 2026-27 eligible"
                                                  : "Classic season card"
                                              }
                                            >
                                              {collection.inSeason
                                                ? "IN-S"
                                                : "CLS"}
                                            </span>
                                            {inj && inj.status !== "ACTIVE" && (
                                              <span
                                                className={`inline-flex items-center gap-0.5 rounded border px-1 text-[9px] font-bold ${
                                                  inj.status === "OUT" ||
                                                  inj.status === "DOUBTFUL"
                                                    ? "border-rose-400/45 bg-rose-500/15 text-rose-200"
                                                    : "border-amber-400/45 bg-amber-500/15 text-amber-200"
                                                }`}
                                                title={`ESPN ${inj.rawStatus}: ${inj.comment}`}
                                              >
                                                <ShieldAlert className="h-2.5 w-2.5" />
                                                {inj.status === "OUT"
                                                  ? "OUT"
                                                  : "GTD"}
                                              </span>
                                            )}
                                            {hasOverlap && (
                                              <span
                                                className="inline-flex items-center gap-0.5 rounded border border-violet-400/35 bg-violet-500/15 px-1 text-[9px] font-semibold text-violet-300"
                                                title={`Also needed in: ${otherCollections}`}
                                              >
                                                <Layers className="h-2.5 w-2.5" />
                                                x{op.overlapCount}
                                              </span>
                                            )}
                                          </div>
                                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                                            <span>
                                              {op.slot.seasonYear ?? "Any"} •{" "}
                                              {op.slot.teamName ?? "NBA"}
                                            </span>
                                            {op.auctionBidCents !== null && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void openInActiveTab(
                                                    op.market?.auctionUrl ??
                                                      op.targetUrl,
                                                  );
                                                }}
                                                title={
                                                  savingsCents !== null &&
                                                  savingsCents > 0
                                                    ? `Auction bid ${formatMoney(op.auctionBidCents, currency)} vs Instant Buy ${formatMoney(op.instantBuyCents, currency)} (${savingsPct}% lower right now)`
                                                    : "Lowest active non-bundle auction bid"
                                                }
                                                className="inline-flex items-center gap-0.5 text-sky-400 hover:underline"
                                              >
                                                <Gavel className="h-2.5 w-2.5" />
                                                {formatMoney(
                                                  op.auctionBidCents,
                                                  currency,
                                                )}
                                                {savingsPct !== null &&
                                                savingsPct > 0
                                                  ? ` (-${savingsPct}%)`
                                                  : ""}
                                                {op.market?.auctionEndDate
                                                  ? ` • ${formatTimeLeft(op.market.auctionEndDate)}`
                                                  : ""}
                                              </button>
                                            )}
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void openInActiveTab(op.targetUrl);
                                          }}
                                          title={
                                            op.instantBuyCents !== null
                                              ? `Instant Buy floor: ${formatMoney(op.instantBuyCents, currency)}${op.auctionBidCents !== null ? ` | Auction bid: ${formatMoney(op.auctionBidCents, currency)}` : ""}`
                                              : "Open Sorare market filters in active tab"
                                          }
                                          className={`shrink-0 rounded-lg px-2 py-0.5 font-semibold transition ${
                                            op.instantBuyCents !== null
                                              ? "bg-[#192236] text-emerald-300 hover:bg-slate-700"
                                              : "bg-[#192236]/60 text-slate-400 hover:bg-slate-800"
                                          }`}
                                        >
                                          {op.instantBuyCents !== null
                                            ? formatMoney(
                                                op.instantBuyCents,
                                                currency,
                                              )
                                            : "Browse"}
                                        </button>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </details>
    </div>
  );
}

function SortArrow({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return null;
  return asc ? (
    <ArrowUp aria-hidden="true" className="h-2.5 w-2.5 text-amber-400" />
  ) : (
    <ArrowDown aria-hidden="true" className="h-2.5 w-2.5 text-amber-400" />
  );
}

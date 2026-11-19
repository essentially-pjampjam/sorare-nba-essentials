import {
  ArrowLeftRight,
  Banknote,
  Download,
  ExternalLink,
  Flame,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Tag,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  evaluateStarTierShift,
  evaluateVaultVsSellRoi,
  resolveSyncedLineupCardSlugs,
  type VaultAdviceContext,
} from "../../calculators/lineupOptimizerMath";
import { evaluateSealCandidates } from "../../calculators/vaultSealingMath";
import {
  NBA_POSITION_LABELS,
  RARITY_META,
  SORARE_NBA_CARD_URL,
} from "../../shared/constants";
import type {
  Currency,
  GalleryCard,
  GalleryResult,
  Rarity,
  WalletBalanceInfo,
} from "../../shared/types";
import { openInActiveTab } from "../api";
import { HeadToHeadCompareBox } from "../components/HeadToHeadCompareBox";
import { PlayerCardRow } from "../components/PlayerCardRow";
import { formatMoney } from "../utils/format";

type GallerySortBy =
  | "stars_desc"
  | "l10_desc"
  | "l5_desc"
  | "form_hot"
  | "form_cold"
  | "proj_edge"
  | "ask_desc"
  | "ask_asc"
  | "sell_priority";

function getFormDelta(c: GalleryCard): number | null {
  if (c.l5 === null || c.l10 === null) return null;
  return Math.round((c.l5 - c.l10) * 10) / 10;
}

function getProjEdge(c: GalleryCard): number | null {
  const proj = c.sorareClassicProjected ?? c.sorareDailyProjected ?? null;
  if (proj === null || c.l10 === null) return null;
  return Math.round((proj - c.l10) * 10) / 10;
}

function isSealCandidate(c: GalleryCard, ctx: VaultAdviceContext): boolean {
  return evaluateVaultVsSellRoi(c, ctx).action === "SEAL_VAULT";
}

interface GalleryTabProps {
  gallery: GalleryResult | null;
  walletBalance?: WalletBalanceInfo;
  rarity: Rarity;
  currency: Currency;
  hasUsername: boolean;
  isLoading: boolean;
  isPricingGallery: boolean;
  onRefreshGallery: () => void;
  onPriceGallery: () => void;
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = val === null || val === undefined ? "" : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function computeSellLiquidityScore(card: GalleryCard): number {
  const ask = card.lowestAskCents ?? 0;
  const isLocked = (card.openedLineupIds?.length ?? 0) > 0;
  if (isLocked || ask <= 0) return -1;
  // Favor cards with solid market ask that aren't core 4★-5★ in-season starters
  const inSeasonPenalty = card.inSeasonEligible ? 0.85 : 1.15;
  const starPenalty = card.starCost >= 4 ? 0.65 : 1.1;
  return ask * inSeasonPenalty * starPenalty;
}

export function GalleryTab({
  gallery,
  walletBalance,
  rarity,
  currency,
  hasUsername,
  isLoading,
  isPricingGallery,
  onRefreshGallery,
  onPriceGallery,
}: GalleryTabProps) {
  const [poolMode, setPoolMode] = useState<"pro" | "common">("pro");
  const [sortBy, setSortBy] = useState<GallerySortBy>("stars_desc");
  const [inSeasonOnly, setInSeasonOnly] = useState<boolean>(false);
  const [firstOwnerOnly, setFirstOwnerOnly] = useState<boolean>(false);
  const [unlockedOnly, setUnlockedOnly] = useState<boolean>(false);
  const [formFilter, setFormFilter] = useState<
    "all" | "hot" | "cold" | "proj" | "shift" | "seal"
  >("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [compareSlugs, setCompareSlugs] = useState<string[]>([]);

  const toggleCompareCard = (slug: string) => {
    setCompareSlugs((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= 2) return [prev[1], slug];
      return [...prev, slug];
    });
  };

  const rarityMeta = RARITY_META[rarity];

  const sourceCards = useMemo(() => {
    if (!gallery) return [];
    if (poolMode === "common") return gallery.commonCards;
    return gallery.cards.filter((c) => c.rarity === rarity);
  }, [gallery, poolMode, rarity]);

  // Cards in synced (page-captured) lineups and spare duplicates drive the Vault advice.
  const vaultContextBySlug = useMemo(() => {
    const map = new Map<string, VaultAdviceContext>();
    if (!gallery) return map;
    const locked = new Set(resolveSyncedLineupCardSlugs(gallery.currentLineups ?? [], gallery.cards));
    const duplicates = new Set(
      evaluateSealCandidates(gallery.cards, { currentLineups: gallery.currentLineups ?? [] })
        .filter((e) => e.isDuplicate)
        .map((e) => e.cardSlug),
    );
    for (const c of gallery.cards) {
      map.set(c.slug, { locked: locked.has(c.slug), duplicate: duplicates.has(c.slug) });
    }
    return map;
  }, [gallery]);
  const vaultContext = (c: GalleryCard): VaultAdviceContext => vaultContextBySlug.get(c.slug) ?? {};

  const formCounts = useMemo(() => {
    let hot = 0;
    let cold = 0;
    let proj = 0;
    let shift = 0;
    let seal = 0;
    for (const c of sourceCards) {
      const fd = getFormDelta(c);
      const pe = getProjEdge(c);
      const st = evaluateStarTierShift(c.l10, c.l5);
      if (fd !== null && fd >= 3.5) hot += 1;
      if (fd !== null && fd <= -3.5) cold += 1;
      if (pe !== null && pe >= 3.0) proj += 1;
      if (st.direction !== "stable") shift += 1;
      if (isSealCandidate(c, vaultContext(c))) seal += 1;
    }
    return { hot, cold, proj, shift, seal };
  }, [sourceCards, vaultContextBySlug]);

  const vaultSummary = useMemo(() => {
    let sealableCards = 0;
    let totalVaultPoints = 0;
    let sellRecommendedCards = 0;
    let totalFloorCents = 0;
    for (const c of sourceCards) {
      if (c.inSeasonEligible || (c.openedLineupIds?.length ?? 0) > 0 || vaultContext(c).locked) continue;
      const advice = evaluateVaultVsSellRoi(c, vaultContext(c));
      if (advice.action === "SEAL_VAULT") {
        sealableCards += 1;
        totalVaultPoints += advice.vaultPoints;
      } else if (advice.action === "SELL_CASH") {
        sellRecommendedCards += 1;
      }
      if (typeof c.lowestAskCents === "number" && c.lowestAskCents > 0) {
        totalFloorCents += c.lowestAskCents;
      }
    }
    return {
      sealableCards,
      totalVaultPoints,
      sellRecommendedCards,
      totalFloorCents,
    };
  }, [sourceCards, vaultContextBySlug]);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = sourceCards.filter((c) => {
      if (inSeasonOnly && !c.inSeasonEligible) return false;
      if (firstOwnerOnly && !c.isFirstOwner) return false;
      if (unlockedOnly && (c.openedLineupIds?.length ?? 0) > 0) return false;
      if (formFilter !== "all") {
        const fd = getFormDelta(c);
        const pe = getProjEdge(c);
        const st = evaluateStarTierShift(c.l10, c.l5);
        if (formFilter === "hot" && (fd === null || fd < 3.5)) return false;
        if (formFilter === "cold" && (fd === null || fd > -3.5)) return false;
        if (formFilter === "proj" && (pe === null || pe < 3.0)) return false;
        if (formFilter === "shift" && st.direction === "stable") return false;
        if (formFilter === "seal" && !isSealCandidate(c, vaultContext(c))) return false;
      }
      if (q) {
        const hay = `${c.playerName} ${c.teamName ?? ""} ${c.cardEditionName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "l10_desc":
          return (b.l10 ?? -1) - (a.l10 ?? -1);
        case "l5_desc":
          return (b.l5 ?? -1) - (a.l5 ?? -1);
        case "form_hot":
          return (getFormDelta(b) ?? -999) - (getFormDelta(a) ?? -999);
        case "form_cold":
          return (getFormDelta(a) ?? 999) - (getFormDelta(b) ?? 999);
        case "proj_edge":
          return (getProjEdge(b) ?? -999) - (getProjEdge(a) ?? -999);
        case "ask_desc":
          return (b.lowestAskCents ?? -1) - (a.lowestAskCents ?? -1);
        case "ask_asc": {
          const aa = a.lowestAskCents ?? Number.MAX_SAFE_INTEGER;
          const bb = b.lowestAskCents ?? Number.MAX_SAFE_INTEGER;
          return aa - bb;
        }
        case "sell_priority":
          return computeSellLiquidityScore(b) - computeSellLiquidityScore(a);
        case "stars_desc":
        default:
          if (b.starCost !== a.starCost) return b.starCost - a.starCost;
          return (b.l10 ?? -1) - (a.l10 ?? -1);
      }
    });
  }, [
    firstOwnerOnly,
    formFilter,
    inSeasonOnly,
    searchQuery,
    sortBy,
    sourceCards,
    unlockedOnly,
  ]);

  const portfolioStats = useMemo(() => {
    let pricedCount = 0;
    let totalAskCents = 0;
    let firstOwnerCount = 0;
    let lockedCount = 0;

    for (const c of sourceCards) {
      if (c.isFirstOwner) firstOwnerCount += 1;
      if ((c.openedLineupIds?.length ?? 0) > 0) lockedCount += 1;
      if (typeof c.lowestAskCents === "number" && c.lowestAskCents > 0) {
        pricedCount += 1;
        totalAskCents += c.lowestAskCents;
      }
    }

    const bestToSell = [...sourceCards]
      .filter(
        (c) =>
          (c.openedLineupIds?.length ?? 0) === 0 &&
          typeof c.lowestAskCents === "number" &&
          c.lowestAskCents > 0,
      )
      .sort(
        (a, b) => computeSellLiquidityScore(b) - computeSellLiquidityScore(a),
      )
      .slice(0, 3);

    return {
      totalCards: sourceCards.length,
      pricedCount,
      totalAskCents,
      firstOwnerCount,
      lockedCount,
      bestToSell,
    };
  }, [sourceCards, vaultContextBySlug]);

  const handleExportCsv = () => {
    if (filteredAndSorted.length === 0) return;
    const headers = [
      "Player",
      "Team",
      "Rarity",
      "Season",
      "Edition",
      "Ownership",
      "Stars",
      "L10",
      "L5",
      "Proj",
      `Lowest Ask (${currency})`,
      `Fast Sell -3% (${currency})`,
      `Auction Bid (${currency})`,
      "Locked In Lineup",
      "Card URL",
    ];
    const rows = filteredAndSorted.map((c) => {
      const ask =
        typeof c.lowestAskCents === "number"
          ? (c.lowestAskCents / 100).toFixed(2)
          : "";
      const fastSell =
        typeof c.lowestAskCents === "number"
          ? ((c.lowestAskCents * 0.97) / 100).toFixed(2)
          : "";
      const bid =
        typeof c.auctionBidCents === "number"
          ? (c.auctionBidCents / 100).toFixed(2)
          : "";
      return [
        escapeCsvCell(c.playerName),
        escapeCsvCell(c.teamName ?? ""),
        escapeCsvCell(c.rarity),
        escapeCsvCell(c.seasonYear),
        escapeCsvCell(c.cardEditionName ?? "classic"),
        escapeCsvCell(c.isFirstOwner ? "1ST" : "2ND"),
        escapeCsvCell(c.starCost),
        escapeCsvCell(c.l10?.toFixed(1) ?? ""),
        escapeCsvCell(c.l5?.toFixed(1) ?? ""),
        escapeCsvCell(c.sorareClassicProjected?.toFixed(1) ?? ""),
        escapeCsvCell(ask),
        escapeCsvCell(fastSell),
        escapeCsvCell(bid),
        escapeCsvCell((c.openedLineupIds?.length ?? 0) > 0 ? "Yes" : "No"),
        escapeCsvCell(`${SORARE_NBA_CARD_URL}/${c.slug}`),
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sorare-${gallery?.username ?? "gallery"}-${poolMode}-${rarity}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!gallery && !isLoading) {
    return (
      <div className="rounded-2xl border border-white/8 bg-[#111726] p-6 text-center">
        <Layers className="mx-auto mb-2.5 h-7 w-7 text-amber-400" />
        <h2 className="jam-heading-balance text-sm font-semibold text-slate-100">
          My Gallery &amp; Sell Advisor ({rarityMeta.label})
        </h2>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
          Inspect your owned cards by Star tier, L10, L5, lowest live floor ask,
          and identify unlocked cards to sell for Cash / ETH.
        </p>
        {hasUsername && (
          <button
            type="button"
            onClick={onRefreshGallery}
            className="mt-3.5 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-sm hover:from-amber-200 hover:to-amber-400"
          >
            Load My Gallery
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Portfolio & Wallet Liquidity Overview */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {poolMode === "pro" ? `${rarityMeta.label} Cards` : "Common / Set"}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-base font-semibold text-slate-100">
              {portfolioStats.totalCards}
            </span>
            <span className="text-[10px] text-emerald-300">
              {portfolioStats.firstOwnerCount} 1ST
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Floor Value ({portfolioStats.pricedCount}/{portfolioStats.totalCards})
          </div>
          <div className="mt-1 text-base font-semibold text-amber-300">
            {portfolioStats.pricedCount > 0
              ? formatMoney(portfolioStats.totalAskCents, currency)
              : "--"}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            <Wallet className="h-3 w-3 text-emerald-400" />
            Live Wallet
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-100">
            {walletBalance &&
            (walletBalance.cashAmount !== null || walletBalance.ethAmount !== null) ? (
              <>
                {walletBalance.cashAmount !== null &&
                  `${walletBalance.cashSymbol ?? "€"}${walletBalance.cashAmount.toFixed(2)}`}
                {walletBalance.cashAmount !== null &&
                  walletBalance.ethAmount !== null &&
                  " • "}
                {walletBalance.ethAmount !== null &&
                  `${walletBalance.ethAmount} ETH`}
              </>
            ) : (
              <span className="text-[10px] text-slate-400">
                Open sorare.com to sync
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Safe to Sell (Unlocked)
          </div>
          <div className="mt-1 text-xs font-semibold text-sky-300">
            {Math.max(0, portfolioStats.totalCards - portfolioStats.lockedCount)}{" "}
            available{" "}
            <span className="text-[10px] text-slate-400">
              ({portfolioStats.lockedCount} locked)
            </span>
          </div>
        </div>
      </div>

      {/* Best Liquidity Candidates Banner */}
      {poolMode === "pro" && portfolioStats.bestToSell.length > 0 && (
        <div className="rounded-2xl border border-emerald-400/25 bg-[#111726] p-2.5 text-[11px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold text-emerald-300">
              Fastest Liquidity (Sell Unlocked Cards for Cash / Quests)
            </span>
            <span className="text-[10px] text-slate-400">
              Sorted by floor ask -3% undercut
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            {portfolioStats.bestToSell.map((c) => {
              const undercut = Math.round((c.lowestAskCents ?? 0) * 0.97);
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() =>
                    void openInActiveTab(`${SORARE_NBA_CARD_URL}/${c.slug}`)
                  }
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#0b101b] px-2 py-1 text-left hover:border-emerald-400/40"
                >
                  <span className="truncate font-medium text-slate-200">
                    {c.playerName}
                  </span>
                  <span className="shrink-0 font-semibold text-emerald-300">
                    {formatMoney(undercut, currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Pool, Actions, Filters & Sorting */}
      <div className="space-y-2 rounded-2xl border border-white/8 bg-[#111726] p-3">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/8 bg-[#0b101b] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setPoolMode("pro")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                poolMode === "pro"
                  ? "bg-amber-400/20 text-amber-200"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Pro ({rarityMeta.shortLabel})
            </button>
            <button
              type="button"
              onClick={() => setPoolMode("common")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                poolMode === "common"
                  ? "bg-emerald-400/20 text-emerald-200"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Common / Set
            </button>
          </div>

          <div className="flex items-center gap-1">
            {poolMode === "pro" && (
              <button
                type="button"
                disabled={isPricingGallery || sourceCards.length === 0}
                onClick={onPriceGallery}
                className="inline-flex items-center gap-1 rounded-xl border border-amber-400/35 bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/25 disabled:opacity-50"
              >
                {isPricingGallery ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Tag className="h-3 w-3" />
                )}
                Price Floor Asks
              </button>
            )}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredAndSorted.length === 0}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#0b101b] px-2 py-1 text-[11px] text-slate-300 hover:border-white/25 disabled:opacity-50"
              title="Export gallery to CSV"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={onRefreshGallery}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#0b101b] p-1.5 text-slate-300 hover:border-amber-400/40 disabled:opacity-50"
              title="Refresh gallery from Sorare"
              aria-label="Refresh gallery"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter player, team, edition..."
            aria-label="Filter gallery cards"
            className="min-w-[120px] flex-1 rounded-xl border border-white/8 bg-[#0b101b] px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-400/60 focus:outline-none"
          />
          <select
            value={sortBy}
            aria-label="Sort gallery by"
            onChange={(e) => setSortBy(e.target.value as GallerySortBy)}
            className="rounded-xl border border-white/8 bg-[#0b101b] px-2 py-1 text-[10px] font-medium text-amber-200 focus:border-amber-400/60 focus:outline-none"
          >
            <option value="stars_desc">Sort: Stars (★ High → Low)</option>
            <option value="l10_desc">Sort: L10 Avg (High → Low)</option>
            <option value="l5_desc">Sort: L5 Last Week</option>
            <option value="form_hot">Sort: On Fire (L5 - L10)</option>
            <option value="form_cold">Sort: Underperforming (Cold)</option>
            <option value="proj_edge">Sort: Proj Edge (Proj - L10)</option>
            <option value="ask_desc">Sort: Floor Ask (High → Low)</option>
            <option value="ask_asc">Sort: Floor Ask (Low → High)</option>
            <option value="sell_priority">Sort: Best to Sell (Safe)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() => setFormFilter((v) => (v === "hot" ? "all" : "hot"))}
            className={`inline-flex items-center gap-0.5 rounded-lg border px-2 py-0.5 font-medium transition ${
              formFilter === "hot"
                ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
                : "border-white/8 bg-[#0b101b] text-slate-300"
            }`}
          >
            <Flame className="h-2.5 w-2.5 text-amber-400" />
            On Fire ({formCounts.hot})
          </button>
          <button
            type="button"
            onClick={() => setFormFilter((v) => (v === "cold" ? "all" : "cold"))}
            className={`inline-flex items-center gap-0.5 rounded-lg border px-2 py-0.5 font-medium transition ${
              formFilter === "cold"
                ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
                : "border-white/8 bg-[#0b101b] text-slate-300"
            }`}
          >
            <Snowflake className="h-2.5 w-2.5 text-sky-300" />
            Cold ({formCounts.cold})
          </button>
          <button
            type="button"
            onClick={() => setFormFilter((v) => (v === "proj" ? "all" : "proj"))}
            className={`inline-flex items-center gap-0.5 rounded-lg border px-2 py-0.5 font-medium transition ${
              formFilter === "proj"
                ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                : "border-white/8 bg-[#0b101b] text-slate-300"
            }`}
          >
            <Target className="h-2.5 w-2.5 text-emerald-300" />
            Proj Beat ({formCounts.proj})
          </button>
          <button
            type="button"
            onClick={() => setFormFilter((v) => (v === "shift" ? "all" : "shift"))}
            className={`inline-flex items-center gap-0.5 rounded-lg border px-2 py-0.5 font-medium transition ${
              formFilter === "shift"
                ? "border-sky-400/50 bg-sky-500/20 text-sky-200"
                : "border-white/8 bg-[#0b101b] text-slate-300"
            }`}
          >
            <TrendingUp className="h-2.5 w-2.5 text-sky-300" />
            ★ Shift ({formCounts.shift})
          </button>
          <button
            type="button"
            onClick={() => setFormFilter((v) => (v === "seal" ? "all" : "seal"))}
            className={`inline-flex items-center gap-0.5 rounded-lg border px-2 py-0.5 font-medium transition ${
              formFilter === "seal"
                ? "border-violet-400/50 bg-violet-500/20 text-violet-200"
                : "border-white/8 bg-[#0b101b] text-slate-300"
            }`}
          >
            <ShieldCheck className="h-2.5 w-2.5 text-violet-300" />
            Vault ({formCounts.seal})
          </button>
          <button
            type="button"
            onClick={() => setInSeasonOnly((v) => !v)}
            className={`rounded-lg border px-2 py-0.5 font-medium transition ${
              inSeasonOnly
                ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                : "border-white/8 bg-[#0b101b] text-slate-400"
            }`}
          >
            26-27 Only
          </button>
          <button
            type="button"
            onClick={() => setFirstOwnerOnly((v) => !v)}
            className={`rounded-lg border px-2 py-0.5 font-medium transition ${
              firstOwnerOnly
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                : "border-white/8 bg-[#0b101b] text-slate-400"
            }`}
          >
            1ST-Owner Only
          </button>
          <button
            type="button"
            onClick={() => setUnlockedOnly((v) => !v)}
            className={`rounded-lg border px-2 py-0.5 font-medium transition ${
              unlockedOnly
                ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                : "border-white/8 bg-[#0b101b] text-slate-400"
            }`}
          >
            Unlocked Only
          </button>
          <span className="ml-auto text-slate-400">
            Showing {filteredAndSorted.length} of {sourceCards.length}
          </span>
        </div>
      </div>

      {/* Vault vs. Sell ROI Summary Banner */}
      {formFilter === "seal" && (
        <div className="rounded-2xl border border-violet-400/30 bg-[#111726] px-3 py-2 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-violet-200">
              Vault vs. Sell ROI Advisor
            </span>
            <span className="tabular-nums text-[10px] text-slate-300">
              <strong className="text-violet-300">
                +{vaultSummary.totalVaultPoints} VP
              </strong>{" "}
              across {vaultSummary.sealableCards} sealable •{" "}
              <strong className="text-emerald-300">
                {vaultSummary.sellRecommendedCards} Sell &gt; Seal
              </strong>
              {vaultSummary.totalFloorCents > 0 &&
                ` (${formatMoney(vaultSummary.totalFloorCents, currency)} total floor)`}
            </span>
          </div>
        </div>
      )}

      {/* 2-Player Head-to-Head Compare Matrix */}
      <HeadToHeadCompareBox
        cards={sourceCards.filter((c) => compareSlugs.includes(c.slug))}
        currency={currency}
        scheduleByTeam={gallery?.scheduleByTeam}
        gamesPerTeam={gallery?.gamesPerTeam}
        onRemove={(slug) =>
          setCompareSlugs((prev) => prev.filter((s) => s !== slug))
        }
        onClear={() => setCompareSlugs([])}
      />

      {/* Cards Grid / List */}
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
        {filteredAndSorted.map((c) => {
          const posLabel =
            c.positions.map((p) => NBA_POSITION_LABELS[p]).join("/") || "--";
          const isLocked = (c.openedLineupIds?.length ?? 0) > 0;
          const isRookie = c.cardEditionName === "rookie";
          const hasAsk =
            typeof c.lowestAskCents === "number" && c.lowestAskCents > 0;
          const fastSell = hasAsk
            ? Math.round((c.lowestAskCents ?? 0) * 0.97)
            : null;
          const formDelta = getFormDelta(c);
          const projEdge = getProjEdge(c);
          const projScore =
            c.sorareClassicProjected ?? c.sorareDailyProjected ?? null;
          const isOnFire = formDelta !== null && formDelta >= 3.5;
          const isCold = formDelta !== null && formDelta <= -3.5;
          const tierShift = evaluateStarTierShift(c.l10, c.l5);
          const vaultAdvice = evaluateVaultVsSellRoi(c, vaultContext(c));
          const showVaultBadge =
            !c.inSeasonEligible &&
            (c.openedLineupIds?.length ?? 0) === 0 &&
            (vaultAdvice.action === "SEAL_VAULT" ||
              vaultAdvice.action === "SELL_CASH");

          return (
            <PlayerCardRow
              key={c.slug}
              playerName={c.playerName}
              teamSlug={c.teamSlug}
              teamName={c.teamName}
              rarity={c.rarity}
              pictureUrl={c.pictureUrl}
              leftBadge={
                <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                  {c.starCost}★
                </span>
              }
              statusBadge={
                <div className="flex flex-wrap items-center gap-1">
                  {isOnFire && (
                    <span className="inline-flex items-center gap-0.5 rounded border border-amber-400/45 bg-amber-400/20 px-1 text-[9px] font-bold text-amber-200">
                      <Flame className="h-2.5 w-2.5" />
                      +{formDelta}
                    </span>
                  )}
                  {isCold && (
                    <span className="inline-flex items-center gap-0.5 rounded border border-rose-400/40 bg-rose-500/15 px-1 text-[9px] font-bold text-rose-200">
                      <Snowflake className="h-2.5 w-2.5" />
                      {formDelta}
                    </span>
                  )}
                  {projEdge !== null && projEdge >= 3.0 && (
                    <span className="rounded border border-emerald-400/35 bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-200">
                      Proj +{projEdge}
                    </span>
                  )}
                  {tierShift.label && (
                    <span
                      className={`rounded border px-1 text-[9px] font-semibold ${
                        tierShift.direction === "value_lock"
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                          : "border-sky-400/40 bg-sky-500/15 text-sky-200"
                      }`}
                    >
                      {tierShift.label}
                    </span>
                  )}
                  {showVaultBadge && (
                    <span
                      className={`inline-flex items-center gap-0.5 rounded border px-1 text-[9px] font-semibold ${
                        vaultAdvice.action === "SELL_CASH"
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                          : "border-violet-400/40 bg-violet-500/15 text-violet-200"
                      }`}
                      title={vaultAdvice.reason}
                    >
                      {vaultAdvice.action === "SELL_CASH" ? (
                        <Banknote className="h-2.5 w-2.5" />
                      ) : (
                        <Lock className="h-2.5 w-2.5" />
                      )}
                      <span>
                        {vaultAdvice.label.replace(/^[\p{Extended_Pictographic}\uFE0F]+\s*/u, "")}
                      </span>
                    </span>
                  )}
                  {c.isFirstOwner && (
                    <span className="rounded border border-emerald-400/35 bg-emerald-500/15 px-1 text-[9px] font-bold text-emerald-300">
                      1ST
                    </span>
                  )}
                  {isRookie && (
                    <span className="rounded border border-violet-400/35 bg-violet-500/15 px-1 text-[9px] font-semibold text-violet-200">
                      Draft 26&apos;
                    </span>
                  )}
                  {isLocked && (
                    <span
                      className="inline-flex items-center gap-0.5 rounded border border-sky-400/35 bg-sky-500/15 px-1 text-[9px] font-semibold text-sky-200"
                      title="Currently placed in an open Sorare Pro lineup"
                    >
                      <Lock className="h-2.5 w-2.5" />
                      Lineup
                    </span>
                  )}
                </div>
              }
              subline={
                <>
                  <span>{c.inSeasonEligible ? "26-27" : c.seasonYear}</span>
                  <span>• {posLabel}</span>
                  <span>• L10 {c.l10?.toFixed(1) ?? "--"}</span>
                  {c.l5 !== null && (
                    <span className={isCold ? "text-rose-300" : "text-emerald-300"}>
                      • L5 {c.l5.toFixed(1)}
                    </span>
                  )}
                  {projScore !== null && (
                    <span className="text-sky-300">
                      • Proj {projScore.toFixed(1)}
                    </span>
                  )}
                </>
              }
              heroRight={
                hasAsk ? (
                  <span className="text-amber-300">
                    {formatMoney(c.lowestAskCents, currency)}
                  </span>
                ) : (
                  <span className="text-slate-200">
                    {c.l10 !== null ? c.l10.toFixed(1) : "--"} L10
                  </span>
                )
              }
              subRight={
                fastSell !== null ? (
                  <span className="text-emerald-300">
                    Fast Sell ~{formatMoney(fastSell, currency)}
                  </span>
                ) : typeof c.auctionBidCents === "number" ? (
                  <span className="text-sky-300">
                    Bid {formatMoney(c.auctionBidCents, currency)}
                  </span>
                ) : (
                  <span>+{Math.round((c.powerMultiplier - 1) * 100)}% Boost</span>
                )
              }
              actionRight={
                <div className="flex items-center gap-1">
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
                  <button
                    type="button"
                    onClick={() =>
                      void openInActiveTab(`${SORARE_NBA_CARD_URL}/${c.slug}`)
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-white/8 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-amber-400/20 hover:text-amber-200"
                    title="Open this card on sorare.com to list/sell"
                  >
                    Sell
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                </div>
              }
            />
          );
        })}
      </div>
    </div>
  );
}

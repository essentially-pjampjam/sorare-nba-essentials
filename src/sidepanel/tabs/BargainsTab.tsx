import type { GalleryResult } from "../../shared/types";
import { JumpBar } from "../components/JumpBar";
import { SealDealsSection } from "../components/SealDealsSection";
import {
  Bell,
  ChevronRight,
  ExternalLink,
  Flame,
  Gavel,
  RefreshCw,
  Tag,
  TrendingDown,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { filterAndRankBargains } from "../../calculators/bargainHunterMath";
import { evaluateStarTierShift } from "../../calculators/lineupOptimizerMath";
import { NBA_POSITION_LABELS, RARITY_META } from "../../shared/constants";
import type {
  BargainMode,
  BargainsResult,
  BargainSortBy,
  Currency,
  Rarity,
  WatchlistAlert,
  WatchlistEntry,
  WatchlistRuleKind,
} from "../../shared/types";
import { openInActiveTab } from "../api";
import { PlayerCardRow } from "../components/PlayerCardRow";
import { formatMoney, formatTimeLeft } from "../utils/format";

interface BargainsTabProps {
  bargains: BargainsResult | null;
  collectionNeedSlugs?: Set<string>;
  rarity: Rarity;
  currency: Currency;
  isLoading: boolean;
  watchlist?: WatchlistEntry[];
  watchlistAlerts?: WatchlistAlert[];
  onScanBargains: (mode: BargainMode, force?: boolean) => void;
  onUpdateWatchlist?: (next: WatchlistEntry[]) => void;
  onRunWatchlistCheck?: () => void;
  onClearWatchlistAlerts?: () => void;
  /** For the Sealing Deal Finder (moved here from Gallery in 2.7.4-exp3). */
  gallery?: GalleryResult | null;
}

const SORT_OPTIONS: Array<{ id: BargainSortBy; label: string }> = [
  { id: "value_score", label: "Best Deal ($/L10)" },
  { id: "l10_desc", label: "Highest L10 Avg" },
  { id: "l5_desc", label: "Last Week (L5)" },
  { id: "price_asc", label: "Lowest Price" },
  { id: "ending_soon", label: "Ending Soon" },
];

export function BargainsTab({
  bargains,
  collectionNeedSlugs,
  rarity,
  currency,
  isLoading,
  watchlist = [],
  watchlistAlerts = [],
  onScanBargains,
  onUpdateWatchlist,
  onRunWatchlistCheck,
  onClearWatchlistAlerts,
  gallery = null,
}: BargainsTabProps) {
  const [mode, setMode] = useState<BargainMode>("instant_value");
  const [sortBy, setSortBy] = useState<BargainSortBy>("value_score");
  const [minL10, setMinL10] = useState<number>(12);
  const [inSeasonOnly, setInSeasonOnly] = useState<boolean>(false);
  const [firstOwnerEligibleOnly, setFirstOwnerEligibleOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const rarityMeta = RARITY_META[rarity];

  const ranked = useMemo(() => {
    if (!bargains) return [];
    return filterAndRankBargains(bargains.listings, {
      minL10,
      inSeasonOnly,
      firstOwnerEligibleOnly,
      searchQuery,
      maxPriceCents: null,
      sortBy,
    });
  }, [bargains, firstOwnerEligibleOnly, inSeasonOnly, minL10, searchQuery, sortBy]);

  const activePlayerRuleSlugs = useMemo(
    () =>
      new Set(
        watchlist
          .filter((w) => w.kind === "player" && w.playerSlug)
          .map((w) => w.playerSlug!),
      ),
    [watchlist],
  );

  const combinedAlerts = useMemo(() => {
    const bySlug = new Map<string, WatchlistAlert>();
    for (const a of watchlistAlerts) {
      bySlug.set(a.cardSlug, a);
    }
    if (bargains && watchlist.length > 0) {
      for (const item of bargains.listings) {
        if (item.priceCents === null || bySlug.has(item.cardSlug)) continue;
        for (const rule of watchlist) {
          if (rule.rarity !== item.rarity) continue;
          if (item.priceCents > rule.maxPriceCents) continue;
          if (rule.firstOwnerOnly && !item.isFirstOwnerEligible) continue;
          const match =
            (rule.kind === "player" && item.playerSlug === rule.playerSlug) ||
            (rule.kind === "quest_draft_26" &&
              item.isFirstOwnerEligible &&
              (item.cardEditionName === "rookie" ||
                item.questLabels?.includes("Draft 26'"))) ||
            (rule.kind === "quest_non_playoffs" &&
              item.isFirstOwnerEligible &&
              item.questLabels?.includes("26' Non-Playoffs")) ||
            (rule.kind === "quest_conf_finals" &&
              item.isFirstOwnerEligible &&
              item.questLabels?.includes("26' Conf Finals")) ||
            (rule.kind === "any_first_owner" && Boolean(item.isFirstOwnerEligible));
          if (match) {
            bySlug.set(item.cardSlug, {
              id: `live:${rule.id}:${item.cardSlug}`,
              ruleId: rule.id,
              ruleLabel: rule.label,
              cardSlug: item.cardSlug,
              playerSlug: item.playerSlug,
              playerName: item.playerName,
              rarity: item.rarity,
              priceCents: item.priceCents,
              currency: item.currency,
              saleType: item.saleType,
              isPrimaryOffer: Boolean(item.isPrimaryOffer),
              marketUrl: item.marketUrl,
              detectedAt: Date.now(),
            });
            break;
          }
        }
      }
    }
    return [...bySlug.values()].sort((a, b) => a.priceCents - b.priceCents);
  }, [bargains, watchlist, watchlistAlerts]);

  const addPresetRule = (
    kind: WatchlistRuleKind,
    label: string,
    maxPriceCents: number,
  ) => {
    if (!onUpdateWatchlist) return;
    if (watchlist.some((w) => w.kind === kind && w.rarity === rarity)) return;
    const entry: WatchlistEntry = {
      id: `${kind}:${rarity}:${Date.now()}`,
      kind,
      label,
      rarity,
      maxPriceCents,
      firstOwnerOnly: kind !== "player",
      createdAt: Date.now(),
    };
    onUpdateWatchlist([entry, ...watchlist]);
  };

  const togglePlayerWatch = (
    playerSlug: string,
    playerName: string,
    priceCents: number | null,
    isFirstOwnerEligible?: boolean,
  ) => {
    if (!onUpdateWatchlist) return;
    const existing = watchlist.find(
      (w) => w.kind === "player" && w.playerSlug === playerSlug,
    );
    if (existing) {
      onUpdateWatchlist(watchlist.filter((w) => w.id !== existing.id));
    } else {
      const cap =
        priceCents !== null && priceCents > 0 ? Math.max(100, priceCents) : 200;
      const entry: WatchlistEntry = {
        id: `player:${playerSlug}:${Date.now()}`,
        kind: "player",
        label: playerName,
        playerSlug,
        rarity,
        maxPriceCents: cap,
        firstOwnerOnly: Boolean(isFirstOwnerEligible),
        createdAt: Date.now(),
      };
      onUpdateWatchlist([entry, ...watchlist]);
    }
  };

  const sniperWatchlistPanel = (
    <details
      open={combinedAlerts.length > 0 || watchlist.length > 0}
      className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]"
    >
      <summary className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-amber-200">
          <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-amber-400" />
          <Bell className="h-3.5 w-3.5 text-amber-400" />
          Quest &amp; Auction Sniper Watchlist ({watchlist.length})
        </span>
        <span className="text-[10px] font-semibold text-emerald-300">
          {combinedAlerts.length > 0
            ? `${combinedAlerts.length} live hit${combinedAlerts.length === 1 ? "" : "s"}`
            : "10m Auto-Check"}
        </span>
      </summary>
      <div className="space-y-2 border-t border-white/8 bg-[#0b101b] p-3 text-[10px]">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => addPresetRule("quest_draft_26", "Draft 26' 1ST", 200)}
            className="rounded-lg border border-amber-400/35 bg-amber-400/15 px-2 py-1 font-semibold text-amber-200 hover:bg-amber-400/25"
          >
            + Draft 26&apos; ≤ {formatMoney(200, currency)}
          </button>
          <button
            type="button"
            onClick={() =>
              addPresetRule("quest_non_playoffs", "26' Non-Playoffs 1ST", 150)
            }
            className="rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-200 hover:bg-emerald-500/25"
          >
            + Non-Playoffs ≤ {formatMoney(150, currency)}
          </button>
          <button
            type="button"
            onClick={() =>
              addPresetRule("quest_conf_finals", "26' Conf Finals 1ST", 150)
            }
            className="rounded-lg border border-violet-400/35 bg-violet-500/15 px-2 py-1 font-semibold text-violet-200 hover:bg-violet-500/25"
          >
            + Conf Finals ≤ {formatMoney(150, currency)}
          </button>
          <button
            type="button"
            onClick={() => addPresetRule("any_first_owner", "Any 1ST Deal", 100)}
            className="rounded-lg border border-sky-400/35 bg-sky-500/15 px-2 py-1 font-semibold text-sky-200 hover:bg-sky-500/25"
          >
            + Any 1ST ≤ {formatMoney(100, currency)}
          </button>
          {onRunWatchlistCheck && (
            <button
              type="button"
              disabled={isLoading}
              onClick={onRunWatchlistCheck}
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1 font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50"
            >
              <Zap className="h-3 w-3" />
              Check Now
            </button>
          )}
        </div>

        {watchlist.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {watchlist.map((rule) => (
              <span
                key={rule.id}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#111726] px-2 py-0.5 text-slate-200"
              >
                <span>
                  {rule.label} ≤{" "}
                  <strong className="text-amber-300">
                    {formatMoney(rule.maxPriceCents, currency)}
                  </strong>
                </span>
                {onUpdateWatchlist && (
                  <button
                    type="button"
                    aria-label={`Remove ${rule.label} rule`}
                    onClick={() =>
                      onUpdateWatchlist(watchlist.filter((w) => w.id !== rule.id))
                    }
                    className="text-slate-400 hover:text-rose-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {combinedAlerts.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-wider text-emerald-300">
              <span>Sniper Hits ({combinedAlerts.length})</span>
              {watchlistAlerts.length > 0 && onClearWatchlistAlerts && (
                <button
                  type="button"
                  onClick={onClearWatchlistAlerts}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Clear Badge
                </button>
              )}
            </div>
            {combinedAlerts.slice(0, 6).map((hit) => (
              <div
                key={hit.cardSlug}
                className="flex items-center justify-between gap-2 rounded-lg border border-emerald-400/25 bg-[#111726] px-2 py-1"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-100">
                    {hit.playerName}{" "}
                    <span className="text-[9px] text-emerald-300">
                      ({hit.ruleLabel})
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-400">
                    {hit.isPrimaryOffer
                      ? "1ST Instant"
                      : hit.saleType === "auction"
                        ? "Auction"
                        : "Market"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void openInActiveTab(hit.marketUrl)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-1 text-[9.5px] font-bold text-emerald-200 hover:bg-emerald-500/30"
                >
                  Snipe {formatMoney(hit.priceCents, currency)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );

  if (!bargains && !isLoading) {
    return (
      <div className="space-y-3">
        {sniperWatchlistPanel}
        <div className="rounded-2xl border border-white/8 bg-[#111726] p-6 text-center">
          <TrendingDown className="mx-auto mb-2.5 h-7 w-7 text-amber-400" />
          <h2 className="jam-heading-balance text-sm font-semibold text-slate-100">
            NBA Bargain &amp; Auction Hunter ({rarityMeta.label})
          </h2>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
            Scans live {rarityMeta.label} Instant Buys and ending-soon auctions
            in 1 GraphQL query and ranks underpriced fantasy value by $/L10
            point.
          </p>
          <div className="mt-3.5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => onScanBargains(mode, false)}
              className="rounded-xl jam-btn-primary px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-sm"
            >
              Scan Live Market Deals
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <JumpBar
        items={[
          { id: "sec-deals", label: "Deals" },
          { id: "sec-watchlist", label: "Watchlist" },
          { id: "sec-seal-deals", label: "Sealing deals" },
        ]}
      />
      <div id="sec-watchlist">{sniperWatchlistPanel}</div>
      {/* Mode & Filters */}
      <div id="sec-deals" className="space-y-2 rounded-2xl border border-white/8 bg-[#111726] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="grid flex-1 grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => {
                setMode("primary_instant");
                setSortBy("price_asc");
                onScanBargains("primary_instant", false);
              }}
              className={`inline-flex items-center justify-center gap-1 rounded-xl border px-1.5 py-1.5 text-[10.5px] font-medium transition ${
                mode === "primary_instant"
                  ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                  : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
              }`}
              title="Direct Sorare Primary Instant Buys - counts as 1st-Owner for Quests (+20 Collection pts)"
            >
              <Tag className="h-3 w-3 shrink-0" />
              <span className="truncate">1ST Instant</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("ending_auctions");
                setSortBy("ending_soon");
                onScanBargains("ending_auctions", false);
              }}
              className={`inline-flex items-center justify-center gap-1 rounded-xl border px-1.5 py-1.5 text-[10.5px] font-medium transition ${
                mode === "ending_auctions"
                  ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                  : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
              }`}
              title="Live NBA auctions ending within 1 hour (filters out unrealistic early 0-bid starting prices)"
            >
              <Gavel className="h-3 w-3 shrink-0" />
              <span className="truncate">1ST Auctions (&lt;1h)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("instant_value");
                if (sortBy === "ending_soon") setSortBy("value_score");
                onScanBargains("instant_value", false);
              }}
              className={`inline-flex items-center justify-center gap-1 rounded-xl border px-1.5 py-1.5 text-[10.5px] font-medium transition ${
                mode === "instant_value"
                  ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                  : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
              }`}
              title="Cheapest $/L10 market deals (includes secondary & primary Instant Buys)"
            >
              <TrendingDown className="h-3 w-3 shrink-0" />
              <span className="truncate">Value $/L10</span>
            </button>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => onScanBargains(mode, true)}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#0b101b] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-amber-400/40 disabled:opacity-50"
            title="Refresh live bargains"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter player or team..."
            aria-label="Filter deals by player or team"
            className="min-w-[110px] flex-1 rounded-xl border border-white/8 bg-[#0b101b] px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-400/60 focus:outline-none"
          />
          <label className="inline-flex items-center gap-1 rounded-xl border border-white/8 bg-[#0b101b] px-2 py-1 text-[10px] text-slate-300">
            Min L10
            <input
              type="number"
              min={0}
              max={60}
              value={minL10}
              onChange={(e) => setMinL10(Math.max(0, Number(e.target.value) || 0))}
              className="w-9 bg-transparent text-right font-semibold text-amber-300 focus:outline-none"
            />
          </label>
          <select
            value={sortBy}
            aria-label="Sort deals by"
            onChange={(e) => setSortBy(e.target.value as BargainSortBy)}
            className="rounded-xl border border-white/8 bg-[#0b101b] px-2 py-1 text-[10px] font-medium text-amber-200 focus:border-amber-400/60 focus:outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setInSeasonOnly((v) => !v)}
            className={`rounded-xl border px-2.5 py-1 text-[10px] font-medium transition ${
              inSeasonOnly
                ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
                : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
            }`}
          >
            IN-S Only
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !firstOwnerEligibleOnly;
              setFirstOwnerEligibleOnly(next);
              if (next && mode === "instant_value") {
                setMode("primary_instant");
                setSortBy("price_asc");
                onScanBargains("primary_instant", false);
              }
            }}
            className={`rounded-xl border px-2.5 py-1 text-[10px] font-medium transition ${
              firstOwnerEligibleOnly
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
            }`}
            title="Show live 1st-Owner Sorare listings (Primary Instant Buys & Primary Auctions) for League Quests (+20 Collection pts)"
          >
            1ST Quest Only
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>
            {ranked.length} matches (
            {mode === "primary_instant"
              ? "direct Sorare 1st-owner Instant Buys"
              : mode === "instant_value"
                ? "includes 2026 In-Season"
                : "active live & primary auctions"}
            )
          </span>
          <span className="text-amber-300">Sorted by $/L10 &amp; L5</span>
        </div>
      </div>

      {/* Results List */}
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
        {ranked.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-[#111726] p-5 text-center text-xs text-slate-400">
            {isLoading
              ? "Scanning live Sorare NBA marketplace..."
              : "No listings match your filters. Try lowering Min L10 or clicking Refresh."}
          </div>
        ) : (
          ranked.map((item) => {
            const posLabel =
              item.positions.map((p) => NBA_POSITION_LABELS[p]).join("/") || "--";
            const isHot = item.l5 !== null && item.l5 > item.l10 + 3;
            const isNeeded = collectionNeedSlugs?.has(item.playerSlug) ?? false;
            const tierShift = evaluateStarTierShift(item.l10, item.l5);

            return (
              <PlayerCardRow
                key={item.cardSlug}
                playerName={item.playerName}
                teamSlug={item.teamSlug}
                teamName={item.teamName}
                rarity={item.rarity}
                pictureUrl={item.pictureUrl}
                statusBadge={
                  <div className="flex flex-wrap items-center gap-1">
                    {item.isPrimaryOffer ? (
                      <span className="rounded border border-emerald-400/45 bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-200">
                        1ST INSTANT (+20)
                      </span>
                    ) : item.isFirstOwnerEligible ? (
                      <span className="rounded border border-emerald-400/40 bg-emerald-500/15 px-1 text-[9px] font-bold text-emerald-300">
                        1ST AUCTION (+20)
                      </span>
                    ) : null}
                    {tierShift.direction === "value_lock" && tierShift.label && (
                      <span className="rounded border border-amber-400/40 bg-amber-400/15 px-1 text-[9px] font-semibold text-amber-200">
                        {tierShift.label}
                      </span>
                    )}
                    {isNeeded && (
                      <span className="rounded border border-violet-400/40 bg-violet-500/15 px-1 text-[9px] font-bold text-violet-200">
                        Need
                      </span>
                    )}
                    {item.cardEditionName === "rookie" && (
                      <span className="rounded border border-fuchsia-400/40 bg-fuchsia-500/15 px-1 text-[9px] font-semibold text-fuchsia-200">
                        Draft 26&apos;
                      </span>
                    )}
                    {isHot ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-400/40 bg-amber-400/15 px-1 text-[9px] font-bold text-amber-200">
                        <Flame className="h-2.5 w-2.5" />
                        HOT
                      </span>
                    ) : item.inSeasonEligible ? (
                      <span className="shrink-0 rounded border border-sky-400/35 bg-sky-500/15 px-1 text-[9px] font-semibold text-sky-300">
                        26-27
                      </span>
                    ) : null}
                  </div>
                }
                subline={
                  <>
                    <span>{item.seasonYear}</span>
                    <span>• {posLabel}</span>
                    <span>• L10 {item.l10}</span>
                    {item.l5 !== null && (
                      <span className="text-emerald-300">
                        • L5 {item.l5.toFixed(1)}
                      </span>
                    )}
                    <span>• {item.starCost}★</span>
                  </>
                }
                heroRight={
                  <span className="text-amber-300">
                    {formatMoney(item.priceCents, currency)}
                  </span>
                }
                subRight={
                  item.saleType === "auction" ? (
                    <span>Bid • {formatTimeLeft(item.endDate)}</span>
                  ) : item.centsPerL10 !== null ? (
                    <span className="text-sky-300">
                      {formatMoney(Math.round(item.centsPerL10), currency)}/L10
                    </span>
                  ) : (
                    <span>Instant Buy</span>
                  )
                }
                actionRight={
                  <div className="flex items-center gap-1">
                    {onUpdateWatchlist && (
                      <button
                        type="button"
                        onClick={() =>
                          togglePlayerWatch(
                            item.playerSlug,
                            item.playerName,
                            item.priceCents,
                            item.isFirstOwnerEligible,
                          )
                        }
                        className={`rounded-lg border p-1 transition ${
                          activePlayerRuleSlugs.has(item.playerSlug)
                            ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
                            : "border-white/10 bg-[#111726] text-slate-400 hover:text-slate-200"
                        }`}
                        title={
                          activePlayerRuleSlugs.has(item.playerSlug)
                            ? "Remove player from Sniper Watchlist"
                            : "Alert me on Sniper Watchlist"
                        }
                        aria-label={`Watch ${item.playerName}`}
                      >
                        <Bell className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void openInActiveTab(item.marketUrl)}
                      className="inline-flex items-center gap-1 rounded-lg bg-amber-400/15 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-400/25"
                      aria-label={`Open ${item.playerName} on Sorare`}
                    >
                      Open
                      <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  </div>
                }
              />
            );
          })
        )}
      </div>
      <div id="sec-seal-deals">
        <SealDealsSection gallery={gallery} rarity={rarity} currency={currency} />
      </div>
    </div>
  );
}

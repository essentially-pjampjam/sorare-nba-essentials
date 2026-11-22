import {
  ArrowDown,
  ArrowUp,
  DollarSign,
  ExternalLink,
  Layers,
  Loader2,
  RotateCcw,
  Sparkles,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  DEFAULT_CRAFT_CLUES,
  evaluateCraftPool,
  recommendBestCraftClue,
} from "../../calculators/craftAdvisorMath";
import { normalizePlayerName } from "../../calculators/lineupOptimizerMath";
import {
  NBA_POSITION_LABELS,
  QUALITY_TIERS,
  QUALITY_TIER_META,
  RARITY_META,
} from "../../shared/constants";
import type {
  CardQualityTier,
  CraftClueFilter,
  CraftPoolResult,
  Currency,
  InjuryReportEntry,
  NbaPosition,
  Rarity,
} from "../../shared/types";
import { openInActiveTab } from "../api";
import { formatMoney } from "../utils/format";

type CraftSortField = "tier" | "pullChance" | "floor" | "l10" | "supply" | "name";

interface CraftTabProps {
  craftPool: CraftPoolResult | null;
  rarity: Rarity;
  currency: Currency;
  isLoading: boolean;
  isPricing: boolean;
  collectionNeedSlugs: Set<string>;
  injuriesByName?: Record<string, InjuryReportEntry>;
  onLoadPool: (forceRefresh?: boolean) => void;
  onPriceTopCandidates: (playerSlugs: string[]) => void;
}

const POSITIONS: NbaPosition[] = [
  "basketball_guard",
  "basketball_forward",
  "basketball_center",
];

function formatDeltaPct(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

export function CraftTab({
  craftPool,
  rarity,
  currency,
  isLoading,
  isPricing,
  collectionNeedSlugs,
  injuriesByName = {},
  onLoadPool,
  onPriceTopCandidates,
}: CraftTabProps) {
  const [clues, setClues] = useState<CraftClueFilter>(DEFAULT_CRAFT_CLUES);
  const [sortField, setSortField] = useState<CraftSortField>("tier");
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const rarityMeta = RARITY_META[rarity];

  const teamsInPool = useMemo(() => {
    if (!craftPool) return [];
    const map = new Map<string, string>();
    for (const p of craftPool.players) {
      if (p.teamSlug && p.teamName) {
        map.set(p.teamSlug, p.teamName);
      }
    }
    return Array.from(map.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [craftPool]);

  const evaluation = useMemo(() => {
    if (!craftPool) return null;
    return evaluateCraftPool(craftPool.players, clues, collectionNeedSlugs);
  }, [clues, collectionNeedSlugs, craftPool]);

  const clueEvoi = useMemo(() => {
    if (!craftPool) return null;
    return recommendBestCraftClue(craftPool.players, clues, collectionNeedSlugs);
  }, [clues, collectionNeedSlugs, craftPool]);

  const sortedCandidates = useMemo(() => {
    if (!evaluation) return [];
    const dir = sortAsc ? 1 : -1;
    return [...evaluation.candidates].sort((a, b) => {
      switch (sortField) {
        case "name":
          return a.player.playerName.localeCompare(b.player.playerName) * dir;
        case "pullChance":
          return (a.pullChancePct - b.pullChancePct) * dir;
        case "floor": {
          const va = a.player.floorCents ?? -1;
          const vb = b.player.floorCents ?? -1;
          return (va - vb) * dir;
        }
        case "l10": {
          const va = a.player.averageL10 ?? -1;
          const vb = b.player.averageL10 ?? -1;
          return (va - vb) * dir;
        }
        case "supply":
          return (a.player.availableSupply - b.player.availableSupply) * dir;
        case "tier":
        default: {
          const ra = QUALITY_TIER_META[a.player.qualityTier].rank;
          const rb = QUALITY_TIER_META[b.player.qualityTier].rank;
          if (ra !== rb) return (ra - rb) * dir;
          return (b.player.averageL10 ?? -1) - (a.player.averageL10 ?? -1);
        }
      }
    });
  }, [evaluation, sortAsc, sortField]);

  const handleSort = (field: CraftSortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(field === "tier" || field === "name");
    }
  };

  const toggleTier = (tier: CardQualityTier) => {
    setClues((prev) => ({
      ...prev,
      tiers: prev.tiers.includes(tier)
        ? prev.tiers.filter((t) => t !== tier)
        : [...prev.tiers, tier],
    }));
  };

  const togglePosition = (pos: NbaPosition) => {
    setClues((prev) => ({
      ...prev,
      positions: prev.positions.includes(pos)
        ? prev.positions.filter((p) => p !== pos)
        : [...prev.positions, pos],
    }));
  };

  const excludePlayer = (slug: string) => {
    setClues((prev) => ({
      ...prev,
      excludedPlayerSlugs: [...prev.excludedPlayerSlugs, slug],
    }));
  };

  if (!craftPool && !isLoading) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#111726] p-5 text-center">
        <Sparkles className="mx-auto mb-2 h-7 w-7 text-amber-400" />
        <h3 className="text-sm font-semibold text-slate-100">
          {rarityMeta.label} Craft Reveal & EV Advisor
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Load Sorare&apos;s live NBA crafting pool across Tiers 0-5 to narrow
          clues, track exact win-% shifts, and spot your best possible pull.
        </p>
        <button
          type="button"
          onClick={() => onLoadPool(false)}
          className="mt-3 rounded-xl jam-btn-primary px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-sm"
        >
          Load Live {rarityMeta.label} Pool
        </button>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div className="rounded-xl border border-white/8 bg-[#111726] p-4 text-center text-xs text-slate-400">
        Loading {rarityMeta.label} crafting pool...
      </div>
    );
  }

  const top10UnpricedSlugs = sortedCandidates
    .filter((c) => c.player.floorCents === null)
    .slice(0, 10)
    .map((c) => c.player.playerSlug);

  return (
    <div className="space-y-3">
      {/* KPI Probability & Value Strip */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Trophy className="h-3 w-3 text-amber-400" />
              Tier 0 Odds
            </span>
            {evaluation.tier0DeltaPct !== 0 && (
              <span
                className={`rounded px-1 font-semibold ${
                  evaluation.tier0DeltaPct > 0
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {formatDeltaPct(evaluation.tier0DeltaPct)}
              </span>
            )}
          </div>
          <div className="mt-1 text-base font-bold text-amber-300">
            {evaluation.tier0ChancePct.toFixed(1)}%
            <span className="ml-1.5 text-[10px] font-normal text-slate-400">
              T0+T1: {evaluation.topTwoTierChancePct.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-sky-400" />
              Pool Left
            </span>
            {evaluation.highL10DeltaPct !== 0 && (
              <span
                className={`rounded px-1 font-semibold ${
                  evaluation.highL10DeltaPct > 0
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}
              >
                L10≥45 {formatDeltaPct(evaluation.highL10DeltaPct)}
              </span>
            )}
          </div>
          <div className="mt-1 text-base font-bold text-slate-100">
            {evaluation.filteredCount}
            <span className="ml-1 text-[11px] font-normal text-slate-400">
              / {evaluation.totalPoolCount} ({evaluation.poolShareRemainingPct.toFixed(1)}%)
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <DollarSign className="h-3 w-3 text-emerald-400" />
            Most Expensive
          </div>
          {evaluation.mostExpensivePlayer ? (
            <>
              <div className="mt-1 text-sm font-bold text-emerald-300">
                {formatMoney(
                  evaluation.mostExpensivePlayer.player.floorCents,
                  currency,
                )}
              </div>
              <div className="truncate text-[10px] text-slate-400">
                {evaluation.mostExpensivePlayer.player.playerName} (
                {evaluation.mostExpensivePlayer.pullChancePct.toFixed(1)}%)
              </div>
            </>
          ) : (
            <div className="mt-1 text-[11px] text-slate-400">
              {evaluation.bestL10Player
                ? `Top L10: ${evaluation.bestL10Player.player.playerName}`
                : "Click Price Top 10"}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/8 bg-[#111726] p-2.5">
          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <Sparkles className="h-3 w-3 text-amber-400" />
            Expected Value
          </div>
          {evaluation.expectedValueCents !== null ? (
            <>
              <div className="mt-1 text-sm font-bold text-slate-100">
                {formatMoney(evaluation.expectedValueCents, currency)}
              </div>
              <div className="text-[10px] text-slate-400">
                Across {evaluation.pricedCount} priced pulls
              </div>
            </>
          ) : (
            <div className="mt-1 text-[11px] text-slate-400">
              Price top pulls to see EV
            </div>
          )}
        </div>
      </div>

      {/* Collection Overlap Callout */}
      {evaluation.bestCollectionNeedPlayer && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-violet-500/35 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-200">
          <span className="inline-flex items-center gap-1.5 truncate">
            <Layers className="h-3.5 w-3.5 shrink-0 text-violet-300" />
            <span>
              Collection match in pool:{" "}
              <strong>
                {evaluation.bestCollectionNeedPlayer.player.playerName}
              </strong>{" "}
              ({evaluation.bestCollectionNeedPlayer.pullChancePct.toFixed(1)}%)
            </span>
          </span>
        </div>
      )}

      {/* Craft Clue EVOI Advisor ("Best Clue to Use") */}
      {clueEvoi && clueEvoi.bestClue && (
        <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-2.5 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-200">
              <Sparkles className="h-3.5 w-3.5 text-sky-300" />
              Best Clue to Use: {clueEvoi.bestClue.label}
            </span>
            <div className="flex items-center gap-1.5 text-[10px] tabular-nums">
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-semibold text-sky-100">
                -{clueEvoi.bestClue.expectedPoolReductionPct}% pool
              </span>
              {clueEvoi.bestClue.evoiCents !== null && clueEvoi.bestClue.evoiCents > 0 && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-semibold text-emerald-200">
                  +{formatMoney(clueEvoi.bestClue.evoiCents, currency)} EVOI
                </span>
              )}
            </div>
          </div>
          <div className="mt-1 text-[10px] text-slate-300">
            Top outcome: <span className="text-slate-100">{clueEvoi.bestClue.bestOutcomeLabel}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1 text-[9.5px] tabular-nums">
            {clueEvoi.rankedClues
              .filter((c) => !c.alreadyUsed)
              .slice(0, 4)
              .map((c, idx) => (
                <span
                  key={c.id}
                  className={`rounded-md border px-1.5 py-0.5 ${
                    idx === 0
                      ? "border-sky-400/40 bg-sky-500/20 text-sky-100 font-semibold"
                      : "border-white/10 bg-black/25 text-slate-400"
                  }`}
                >
                  #{idx + 1} {c.label} (-{c.expectedPoolReductionPct}%)
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Clue Reveal Controls */}
      <div className="space-y-2 rounded-xl border border-white/8 bg-[#111726] p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            Revealed Clues
          </span>
          <div className="flex items-center gap-1.5">
            {top10UnpricedSlugs.length > 0 && (
              <button
                type="button"
                disabled={isPricing}
                onClick={() => onPriceTopCandidates(top10UnpricedSlugs)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                {isPricing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <DollarSign className="h-3 w-3" />
                )}
                Price Top {top10UnpricedSlugs.length}
              </button>
            )}
            <button
              type="button"
              onClick={() => setClues(DEFAULT_CRAFT_CLUES)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reset
            </button>
          </div>
        </div>

        {/* Quality Tier Clues */}
        <div className="flex flex-wrap gap-1">
          {QUALITY_TIERS.map((tier) => {
            const meta = QUALITY_TIER_META[tier];
            const active = clues.tiers.includes(tier);
            return (
              <button
                key={tier}
                type="button"
                onClick={() => toggleTier(tier)}
                className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                  active
                    ? meta.badgeClass
                    : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
                }`}
              >
                {meta.shortLabel}
              </button>
            );
          })}
          <span className="mx-0.5 border-l border-white/8" />
          {POSITIONS.map((pos) => {
            const active = clues.positions.includes(pos);
            return (
              <button
                key={pos}
                type="button"
                onClick={() => togglePosition(pos)}
                className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                  active
                    ? "border-sky-400/50 bg-sky-500/20 text-sky-200"
                    : "border-white/8 bg-[#0b101b] text-slate-400 hover:text-slate-200"
                }`}
              >
                {NBA_POSITION_LABELS[pos]}
              </button>
            );
          })}
        </div>

        {/* Conference, Team, Age, Min L10 */}
        <div className="grid grid-cols-12 gap-1.5 text-[11px]">
          <select
            value={clues.conference}
            aria-label="Filter by conference"
            onChange={(e) =>
              setClues((prev) => ({
                ...prev,
                conference: e.target.value as CraftClueFilter["conference"],
              }))
            }
            className="col-span-3 rounded-lg border border-white/8 bg-[#0b101b] px-1.5 py-1 text-slate-200 focus:border-amber-400 focus:outline-none"
          >
            <option value="ALL">All Conf</option>
            <option value="EAST">East</option>
            <option value="WEST">West</option>
          </select>

          <select
            value={clues.teamSlug}
            aria-label="Filter by NBA team"
            onChange={(e) =>
              setClues((prev) => ({ ...prev, teamSlug: e.target.value }))
            }
            className="col-span-5 rounded-lg border border-white/8 bg-[#0b101b] px-1.5 py-1 text-slate-200 focus:border-amber-400 focus:outline-none"
          >
            <option value="">All Teams</option>
            {teamsInPool.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            placeholder="Min L10"
            aria-label="Minimum L10 average score"
            value={clues.minL10 || ""}
            onChange={(e) =>
              setClues((prev) => ({
                ...prev,
                minL10: Math.max(0, Number(e.target.value) || 0),
              }))
            }
            className="col-span-2 rounded-lg border border-white/8 bg-[#0b101b] px-1.5 py-1 text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
            title="Minimum L10 average score"
          />

          <input
            type="number"
            min={18}
            max={45}
            placeholder="Max Age"
            aria-label="Maximum player age"
            value={clues.ageMax ?? ""}
            onChange={(e) =>
              setClues((prev) => ({
                ...prev,
                ageMax: e.target.value ? Number(e.target.value) : null,
              }))
            }
            className="col-span-2 rounded-lg border border-white/8 bg-[#0b101b] px-1.5 py-1 text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
            title="Maximum player age"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={clues.searchQuery}
            aria-label="Search player or team in craft pool"
            onChange={(e) =>
              setClues((prev) => ({ ...prev, searchQuery: e.target.value }))
            }
            placeholder="Search player or team in pool..."
            className="flex-1 rounded-lg border border-white/8 bg-[#0b101b] px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
          />
          {clues.excludedPlayerSlugs.length > 0 && (
            <span className="rounded-md bg-rose-500/15 px-2 py-1 text-[10px] text-rose-200">
              {clues.excludedPlayerSlugs.length} excluded
            </span>
          )}
        </div>
      </div>

      {/* Sortable Candidate Table */}
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#111726]">
        <div className="grid grid-cols-12 items-center gap-1 border-b border-white/8 bg-[#0e1422] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <button
            type="button"
            onClick={() => handleSort("name")}
            className="col-span-5 flex items-center gap-0.5 text-left hover:text-slate-200"
          >
            Player
            <SortArrow active={sortField === "name"} asc={sortAsc} />
          </button>
          <button
            type="button"
            onClick={() => handleSort("l10")}
            className="col-span-2 flex items-center justify-end gap-0.5 hover:text-slate-200"
          >
            L10
            <SortArrow active={sortField === "l10"} asc={sortAsc} />
          </button>
          <button
            type="button"
            onClick={() => handleSort("pullChance")}
            className="col-span-2 flex items-center justify-end gap-0.5 hover:text-slate-200"
          >
            Odds
            <SortArrow active={sortField === "pullChance"} asc={sortAsc} />
          </button>
          <button
            type="button"
            onClick={() => handleSort("floor")}
            className="col-span-3 flex items-center justify-end gap-0.5 hover:text-slate-200"
          >
            Floor
            <SortArrow active={sortField === "floor"} asc={sortAsc} />
          </button>
        </div>

        <div className="max-h-80 divide-y divide-slate-800/80 overflow-y-auto">
          {sortedCandidates.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              No players match these clues.
            </div>
          ) : (
            sortedCandidates.slice(0, 80).map((c) => {
              const tierMeta = QUALITY_TIER_META[c.player.qualityTier];
              const posText = c.player.positions
                .map((p) => NBA_POSITION_LABELS[p])
                .join("/");
              const inj =
                injuriesByName[normalizePlayerName(c.player.playerName)] ?? null;

              return (
                <div
                  key={c.player.playerSlug}
                  className="grid grid-cols-12 items-center gap-1 px-2.5 py-2 text-xs hover:bg-slate-800/40"
                >
                  <div className="col-span-5 min-w-0 pr-1">
                    <div className="flex items-center gap-1">
                      <span
                        className={`shrink-0 rounded border px-1 text-[9px] font-bold ${tierMeta.badgeClass}`}
                      >
                        {tierMeta.shortLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => void openInActiveTab(c.player.marketUrl)}
                        className="inline-flex min-w-0 items-center gap-0.5 truncate font-medium text-slate-100 hover:text-amber-300 hover:underline"
                      >
                        <span className="truncate">{c.player.playerName}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0 text-slate-500" />
                      </button>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                      <span>
                        {posText || "NBA"} • {c.player.age}y
                      </span>
                      {inj && inj.status !== "ACTIVE" && (
                        <span
                          className={`rounded border px-1 text-[9px] font-semibold ${
                            inj.status === "OUT" || inj.status === "DOUBTFUL"
                              ? "border-rose-400/45 bg-rose-500/15 text-rose-200"
                              : "border-amber-400/45 bg-amber-500/15 text-amber-200"
                          }`}
                          title={`ESPN ${inj.rawStatus}: ${inj.comment}`}
                        >
                          {inj.status === "OUT" ? "OUT" : "GTD"}
                        </span>
                      )}
                      {c.advancesCollection && (
                        <span className="rounded border border-violet-500/40 bg-violet-500/15 px-1 text-[9px] font-semibold text-violet-300">
                          Need
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="col-span-2 text-right font-semibold text-slate-200">
                    {c.player.averageL10 !== null ? c.player.averageL10 : "--"}
                  </div>

                  <div className="col-span-2 text-right">
                    <div className="font-semibold text-amber-300">
                      {c.pullChancePct.toFixed(1)}%
                    </div>
                    {c.oddsMultiplier > 1.05 && (
                      <div className="text-[9px] text-emerald-300">
                        {c.oddsMultiplier.toFixed(1)}x
                      </div>
                    )}
                  </div>

                  <div className="col-span-3 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void openInActiveTab(c.player.marketUrl)}
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        c.player.floorCents !== null
                          ? "bg-slate-800 text-emerald-300 hover:bg-slate-700"
                          : "bg-slate-800/50 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {c.player.floorCents !== null
                        ? formatMoney(c.player.floorCents, currency)
                        : "Market"}
                    </button>
                    <button
                      type="button"
                      onClick={() => excludePlayer(c.player.playerSlug)}
                      className="rounded p-0.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                      title="Exclude player (already seen in draw)"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function SortArrow({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return null;
  return asc ? (
    <ArrowUp className="h-2.5 w-2.5 text-amber-400" />
  ) : (
    <ArrowDown className="h-2.5 w-2.5 text-amber-400" />
  );
}

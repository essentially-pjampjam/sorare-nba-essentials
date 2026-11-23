import {
  Activity,
  Award,
  Camera,
  ChevronDown,
  ChevronUp,
  LineChart,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  computePortfolioPnl,
  filterPriceHistoryByRange,
  summarizePortfolioSeries,
} from "../../calculators/portfolioMath";
import { getActiveNbaSeasonYear } from "../../shared/constants";
import type {
  Currency,
  GalleryCard,
  PlayerPricePoint,
  PortfolioPnlResult,
  PortfolioSnapshot,
  PortfolioTimeRange,
  Rarity,
} from "../../shared/types";
import {
  fetchPlayerPriceHistory,
  fetchPortfolioPnl,
  getPortfolioSnapshots,
  recordPortfolioSnapshotNow,
} from "../api";
import { formatMoney } from "../utils/format";

interface PortfolioTrackerSectionProps {
  username: string;
  rarity: Rarity;
  currency: Currency;
  cards: GalleryCard[];
  selectedPricePlayer?: { playerSlug: string; playerName: string } | null;
  onPnlLoaded?: (pnl: PortfolioPnlResult) => void;
}

function SvgAreaSparkChart({
  values,
  labels,
  currency,
  strokeColor = "#34d399",
  fillColor = "rgba(52, 211, 153, 0.14)",
}: {
  values: number[];
  labels: string[];
  currency: Currency;
  strokeColor?: string;
  fillColor?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (values.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-white/6 bg-[#090d16] text-[10.5px] text-slate-500">
        No chart points recorded yet.
      </div>
    );
  }

  const w = 320;
  const h = 92;
  const padX = 8;
  const padY = 10;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = Math.max(1, maxVal - minVal);

  const pts = values.map((v, i) => {
    const x =
      values.length === 1
        ? w / 2
        : padX + (i / (values.length - 1)) * (w - padX * 2);
    const y = h - padY - ((v - minVal) / span) * (h - padY * 2);
    return { x, y, v, label: labels[i] ?? "" };
  });

  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${(h - padY).toFixed(1)} L${pts[0].x.toFixed(1)},${(h - padY).toFixed(1)} Z`;

  const activePt = hoverIdx !== null ? pts[hoverIdx] : pts[pts.length - 1];

  return (
    <div className="rounded-xl border border-white/6 bg-[#090d16] p-2">
      <div className="mb-1 flex items-center justify-between text-[10px]">
        <span className="text-slate-400">{activePt?.label}</span>
        <span className="font-semibold tabular-nums text-slate-100">
          {activePt ? formatMoney(activePt.v, currency) : "--"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-24 w-full overflow-visible"
        role="img"
        aria-label="Portfolio value chart"
      >
        <path d={areaPath} fill={fillColor} />
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map((p, idx) => (
          <circle
            key={`${p.label}-${idx}`}
            cx={p.x}
            cy={p.y}
            r={hoverIdx === idx ? 4.5 : pts.length <= 12 ? 3 : 2}
            fill={hoverIdx === idx ? "#f8fafc" : strokeColor}
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
      </svg>
    </div>
  );
}

export function PortfolioTrackerSection({
  username,
  rarity,
  currency,
  cards,
  selectedPricePlayer,
  onPnlLoaded,
}: PortfolioTrackerSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [range, setRange] = useState<PortfolioTimeRange>("week");
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [snapshotting, setSnapshotting] = useState(false);

  const [pnlResult, setPnlResult] = useState<PortfolioPnlResult | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [excludeCurrentSeason, setExcludeCurrentSeason] = useState(false);

  const [priceRange, setPriceRange] = useState<PortfolioTimeRange>("month");
  const [activePlayer, setActivePlayer] = useState<{
    playerSlug: string;
    playerName: string;
  } | null>(null);
  const [pricePoints, setPricePoints] = useState<PlayerPricePoint[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);

  useEffect(() => {
    getPortfolioSnapshots()
      .then(setSnapshots)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedPricePlayer) {
      setActivePlayer(selectedPricePlayer);
      setExpanded(true);
    }
  }, [selectedPricePlayer]);

  useEffect(() => {
    if (!activePlayer) return;
    setPriceLoading(true);
    fetchPlayerPriceHistory(activePlayer.playerSlug, rarity, currency)
      .then(setPricePoints)
      .catch(() => setPricePoints([]))
      .finally(() => setPriceLoading(false));
  }, [activePlayer, rarity, currency]);

  const activeSeasonYear = getActiveNbaSeasonYear();
  const matchingCards = useMemo(
    () => cards.filter((c) => c.rarity === rarity),
    [cards, rarity],
  );

  const liveFloorStats = useMemo(() => {
    let totalFloorCents = 0;
    let pricedCardCount = 0;
    for (const c of matchingCards) {
      const val = c.lowestAskCents ?? null;
      if (val !== null && val > 0) {
        totalFloorCents += val;
        pricedCardCount += 1;
      }
    }
    return { totalFloorCents, pricedCardCount, cardCount: matchingCards.length };
  }, [matchingCards]);

  const series = useMemo(
    () => summarizePortfolioSeries(snapshots, rarity, currency, range),
    [snapshots, rarity, currency, range],
  );

  const pnlSummary = useMemo(
    () =>
      pnlResult
        ? computePortfolioPnl(pnlResult.records, {
            excludeCurrentSeason,
            activeSeasonYear,
          })
        : null,
    [pnlResult, excludeCurrentSeason, activeSeasonYear],
  );

  const filteredPricePoints = useMemo(
    () => filterPriceHistoryByRange(pricePoints, priceRange),
    [pricePoints, priceRange],
  );

  const handleSnapshotNow = async () => {
    if (liveFloorStats.pricedCardCount === 0) return;
    setSnapshotting(true);
    try {
      const next = await recordPortfolioSnapshotNow({
        totalFloorCents: liveFloorStats.totalFloorCents,
        cardCount: liveFloorStats.cardCount,
        pricedCardCount: liveFloorStats.pricedCardCount,
        rarity,
        currency,
      });
      setSnapshots(next);
    } finally {
      setSnapshotting(false);
    }
  };

  const handleScanPnl = async () => {
    if (!username.trim()) return;
    setPnlLoading(true);
    setPnlError(null);
    try {
      const res = await fetchPortfolioPnl(username, rarity, currency, true);
      setPnlResult(res);
      onPnlLoaded?.(res);
    } catch (err) {
      setPnlError(err instanceof Error ? err.message : "Failed to scan P&L history.");
    } finally {
      setPnlLoading(false);
    }
  };

  const rangeButtons: Array<{ id: PortfolioTimeRange; label: string }> = [
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];

  return (
    <section className="rounded-2xl border border-white/8 bg-[#111726] p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-left"
        >
          <LineChart className="h-3.5 w-3.5 text-emerald-300" />
          <span className="text-xs font-semibold text-slate-100">
            Portfolio Value &amp; P&amp;L
          </span>
          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-px text-[9.5px] font-semibold text-emerald-300">
            {liveFloorStats.pricedCardCount > 0
              ? formatMoney(liveFloorStats.totalFloorCents, currency)
              : `${liveFloorStats.cardCount} cards`}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
          )}
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleSnapshotNow()}
            disabled={snapshotting || liveFloorStats.pricedCardCount === 0}
            title="Save today's portfolio floor snapshot locally"
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:border-emerald-400/40 disabled:opacity-40"
          >
            <Camera className="h-3 w-3 text-emerald-300" />
            Snap
          </button>
          <button
            type="button"
            onClick={() => void handleScanPnl()}
            disabled={pnlLoading || !username.trim()}
            title="Scan Sorare ownership & auction history for P&L highlights"
            className="inline-flex items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:border-sky-300 disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${pnlLoading ? "animate-spin" : ""}`} />
            Scan P&amp;L
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 space-y-2.5">
          {/* 1. Daily Portfolio Value Chart */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10.5px]">
                <span className="font-semibold text-slate-300">Value History</span>
                {series.points.length >= 2 && (
                  <span
                    className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${
                      series.deltaCents >= 0 ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {series.deltaCents >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {series.deltaCents >= 0 ? "+" : ""}
                    {formatMoney(series.deltaCents, currency)}
                    {series.deltaPct !== null
                      ? ` (${series.deltaPct >= 0 ? "+" : ""}${series.deltaPct}%)`
                      : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-[#0b101b] p-0.5">
                {rangeButtons.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setRange(b.id)}
                    className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${
                      range === b.id
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <SvgAreaSparkChart
              values={series.points.map((p) => p.totalFloorCents)}
              labels={series.points.map((p) => `${p.date} (${p.pricedCardCount} priced)`)}
              currency={currency}
            />
            {series.points.length === 0 && (
              <p className="mt-1 text-[10px] text-slate-500">
                Click &quot;Load Live Floors&quot; then &quot;Snap&quot; (or let the daily alarm record automatically) to build your value curve.
              </p>
            )}
          </div>

          {/* 2. Skinledger-style P&L & Highlights */}
          <div className="rounded-xl border border-white/6 bg-[#0b101b] p-2.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Award className="h-3.5 w-3.5 text-amber-300" />
                <span className="text-[11px] font-semibold text-slate-200">
                  Acquisition P&amp;L &amp; Highlights
                </span>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-300">
                <input
                  type="checkbox"
                  checked={excludeCurrentSeason}
                  onChange={(e) => setExcludeCurrentSeason(e.target.checked)}
                  className="h-3 w-3 rounded border-white/20 bg-slate-900 accent-emerald-400"
                />
                Exclude {activeSeasonYear % 100}-{(activeSeasonYear + 1) % 100} mints
              </label>
            </div>

            {pnlError && <div className="mb-2 text-[10px] text-rose-300">{pnlError}</div>}

            {pnlSummary ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-lg border border-white/6 bg-[#111726] p-1.5">
                    <div className="text-[9px] uppercase text-slate-500">Cost Basis</div>
                    <div className="text-[11.5px] font-bold tabular-nums text-slate-100">
                      {formatMoney(pnlSummary.totalCostBasisCents, currency)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#111726] p-1.5">
                    <div className="text-[9px] uppercase text-slate-500">Est. Floor</div>
                    <div className="text-[11.5px] font-bold tabular-nums text-sky-200">
                      {formatMoney(pnlSummary.totalCurrentValueCents, currency)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#111726] p-1.5">
                    <div className="text-[9px] uppercase text-slate-500">Unrealized P&amp;L</div>
                    <div
                      className={`text-[11.5px] font-bold tabular-nums ${
                        pnlSummary.unrealizedPnlCents >= 0 ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {pnlSummary.unrealizedPnlCents >= 0 ? "+" : ""}
                      {formatMoney(pnlSummary.unrealizedPnlCents, currency)}
                      {pnlSummary.unrealizedPnlPct !== null
                        ? ` (${pnlSummary.unrealizedPnlPct >= 0 ? "+" : ""}${pnlSummary.unrealizedPnlPct}%)`
                        : ""}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  <div className="rounded-lg border border-white/6 bg-[#111726] px-2 py-1.5">
                    <div className="text-[9px] uppercase text-slate-500">Biggest Spend</div>
                    <div className="truncate text-[11px] font-semibold text-slate-100">
                      {pnlSummary.biggestSpend
                        ? `${pnlSummary.biggestSpend.playerName} (${formatMoney(pnlSummary.biggestSpend.acquiredPriceCents, currency)})`
                        : "--"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#111726] px-2 py-1.5">
                    <div className="text-[9px] uppercase text-slate-500">Best Auction Won</div>
                    <div className="truncate text-[11px] font-semibold text-emerald-300">
                      {pnlSummary.bestAuctionWon && pnlSummary.bestAuctionWon.pnlCents !== null
                        ? `${pnlSummary.bestAuctionWon.playerName} (${pnlSummary.bestAuctionWon.pnlCents >= 0 ? "+" : ""}${formatMoney(pnlSummary.bestAuctionWon.pnlCents, currency)})`
                        : "--"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#111726] px-2 py-1.5">
                    <div className="text-[9px] uppercase text-slate-500">Best Trade</div>
                    <div className="truncate text-[11px] font-semibold text-sky-300">
                      {pnlSummary.bestTrade && pnlSummary.bestTrade.pnlCents !== null
                        ? `${pnlSummary.bestTrade.playerName} (${pnlSummary.bestTrade.pnlCents >= 0 ? "+" : ""}${formatMoney(pnlSummary.bestTrade.pnlCents, currency)})`
                        : "--"}
                    </div>
                  </div>
                </div>

                {excludeCurrentSeason && pnlSummary.excludedCurrentSeasonCards > 0 && (
                  <div className="text-[9.5px] text-slate-500">
                    Excluded {pnlSummary.excludedCurrentSeasonCards} current-season cards for prior-year comparison.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400">
                Click <span className="font-semibold text-sky-200">Scan P&amp;L</span> to fetch your Sorare ownership, auction &amp; trade acquisition history (rate-limited safely in background).
              </p>
            )}
          </div>

          {/* 3. Per-Card / Per-Player Price History */}
          {activePlayer && (
            <div className="rounded-xl border border-sky-400/20 bg-[#0b101b] p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                  <span className="truncate text-[11px] font-semibold text-slate-100">
                    {activePlayer.playerName} Price History ({rarity})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-[#111726] p-0.5">
                    {rangeButtons.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setPriceRange(b.id)}
                        className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${
                          priceRange === b.id
                            ? "bg-sky-500/20 text-sky-200"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActivePlayer(null)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-200"
                  >
                    Close
                  </button>
                </div>
              </div>

              {priceLoading ? (
                <div className="flex h-24 items-center justify-center text-[10.5px] text-slate-400">
                  Loading Sorare recent sales...
                </div>
              ) : (
                <SvgAreaSparkChart
                  values={filteredPricePoints.map((p) => p.priceCents)}
                  labels={filteredPricePoints.map(
                    (p) => `${p.date.slice(0, 10)}${p.source ? ` • ${p.source}` : ""}`,
                  )}
                  currency={currency}
                  strokeColor="#38bdf8"
                  fillColor="rgba(56, 189, 248, 0.14)"
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

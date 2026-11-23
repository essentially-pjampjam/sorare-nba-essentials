import type {
  CardOwnershipRecord,
  Currency,
  PlayerPricePoint,
  PortfolioSnapshot,
  PortfolioTimeRange,
  Rarity,
} from "../shared/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Formats a UTC timestamp into YYYY-MM-DD for daily portfolio snapshots. */
export function toUtcDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Upserts a daily portfolio snapshot (deduping by date + rarity + currency) and caps storage. */
export function upsertPortfolioSnapshot(
  existing: PortfolioSnapshot[],
  next: PortfolioSnapshot,
  maxRecords = 365,
): PortfolioSnapshot[] {
  const keyOf = (s: PortfolioSnapshot) => `${s.date}|${s.rarity}|${s.currency}`;
  const map = new Map<string, PortfolioSnapshot>();
  for (const item of existing) {
    map.set(keyOf(item), item);
  }
  map.set(keyOf(next), next);
  return Array.from(map.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.capturedAtMs - b.capturedAtMs)
    .slice(-maxRecords);
}

export interface PortfolioSeriesResult {
  points: PortfolioSnapshot[];
  latestValueCents: number;
  startValueCents: number;
  deltaCents: number;
  deltaPct: number | null;
}

/** Filters snapshots for a given rarity, currency, and time window (Day=7d, Week=30d, Month=180d). */
export function summarizePortfolioSeries(
  snapshots: PortfolioSnapshot[],
  rarity: Rarity,
  currency: Currency,
  range: PortfolioTimeRange,
  nowMs: number = Date.now(),
): PortfolioSeriesResult {
  const windowDays = range === "day" ? 7 : range === "week" ? 30 : 180;
  const cutoffMs = nowMs - windowDays * DAY_MS;

  const matching = snapshots
    .filter((s) => s.rarity === rarity && s.currency === currency)
    .sort((a, b) => a.date.localeCompare(b.date));

  const inWindow = matching.filter((s) => s.capturedAtMs >= cutoffMs);
  const points = inWindow.length > 0 ? inWindow : matching.slice(-14);

  if (points.length === 0) {
    return {
      points: [],
      latestValueCents: 0,
      startValueCents: 0,
      deltaCents: 0,
      deltaPct: null,
    };
  }

  const startValueCents = points[0].totalFloorCents;
  const latestValueCents = points[points.length - 1].totalFloorCents;
  const deltaCents = latestValueCents - startValueCents;
  const deltaPct =
    startValueCents > 0 ? Math.round((deltaCents / startValueCents) * 1000) / 10 : null;

  return {
    points,
    latestValueCents,
    startValueCents,
    deltaCents,
    deltaPct,
  };
}

export interface CardPnlHighlight {
  cardSlug: string;
  playerName: string;
  seasonYear: number;
  acquisitionType: CardOwnershipRecord["acquisitionType"];
  acquiredPriceCents: number;
  currentFloorCents: number | null;
  pnlCents: number | null;
  pnlPct: number | null;
}

export interface PortfolioPnlSummary {
  includedCards: number;
  pairedCards: number;
  excludedCurrentSeasonCards: number;
  totalCostBasisCents: number;
  totalCurrentValueCents: number;
  unrealizedPnlCents: number;
  unrealizedPnlPct: number | null;
  biggestSpend: CardPnlHighlight | null;
  bestAuctionWon: CardPnlHighlight | null;
  bestTrade: CardPnlHighlight | null;
  topGainer: CardPnlHighlight | null;
}

function toHighlight(r: CardOwnershipRecord): CardPnlHighlight | null {
  if (r.acquiredPriceCents === null || r.acquiredPriceCents < 0) return null;
  const pnlCents =
    r.currentFloorCents !== null ? r.currentFloorCents - r.acquiredPriceCents : null;
  const pnlPct =
    pnlCents !== null && r.acquiredPriceCents > 0
      ? Math.round((pnlCents / r.acquiredPriceCents) * 1000) / 10
      : null;
  return {
    cardSlug: r.cardSlug,
    playerName: r.playerName,
    seasonYear: r.seasonYear,
    acquisitionType: r.acquisitionType,
    acquiredPriceCents: r.acquiredPriceCents,
    currentFloorCents: r.currentFloorCents,
    pnlCents,
    pnlPct,
  };
}

/**
 * Skinledger-style Portfolio P&L calculator.
 * Supports excluding cards minted in the active season for prior-year historical comparisons.
 */
export function computePortfolioPnl(
  records: CardOwnershipRecord[],
  options?: {
    excludeCurrentSeason?: boolean;
    activeSeasonYear?: number;
  },
): PortfolioPnlSummary {
  const excludeCurrentSeason = Boolean(options?.excludeCurrentSeason);
  const activeSeasonYear = options?.activeSeasonYear ?? 2026;

  let excludedCurrentSeasonCards = 0;
  const filtered: CardOwnershipRecord[] = [];
  for (const r of records) {
    if (excludeCurrentSeason && r.seasonYear >= activeSeasonYear) {
      excludedCurrentSeasonCards += 1;
      continue;
    }
    filtered.push(r);
  }

  let totalCostBasisCents = 0;
  let totalCurrentValueCents = 0;
  let pairedCostBasisCents = 0;
  let pairedCurrentValueCents = 0;
  let pairedCards = 0;
  const highlights: CardPnlHighlight[] = [];

  for (const r of filtered) {
    const hasCost = r.acquiredPriceCents !== null && r.acquiredPriceCents >= 0;
    const hasFloor = r.currentFloorCents !== null && r.currentFloorCents >= 0;
    if (hasCost) {
      totalCostBasisCents += r.acquiredPriceCents as number;
    }
    if (hasFloor) {
      totalCurrentValueCents += r.currentFloorCents as number;
    }
    if (hasCost && hasFloor) {
      pairedCards += 1;
      pairedCostBasisCents += r.acquiredPriceCents as number;
      pairedCurrentValueCents += r.currentFloorCents as number;
    }
    const h = toHighlight(r);
    if (h) highlights.push(h);
  }

  const unrealizedPnlCents = pairedCurrentValueCents - pairedCostBasisCents;
  const unrealizedPnlPct =
    pairedCards > 0 && pairedCostBasisCents > 0
      ? Math.round((unrealizedPnlCents / pairedCostBasisCents) * 1000) / 10
      : null;

  const paidHighlights = highlights.filter((h) => h.acquiredPriceCents > 0);
  const biggestSpend =
    [...paidHighlights].sort((a, b) => b.acquiredPriceCents - a.acquiredPriceCents)[0] ?? null;

  const auctionHighlights = highlights.filter(
    (h) => h.acquisitionType === "auction" && h.pnlCents !== null,
  );
  const bestAuctionWon =
    [...auctionHighlights].sort((a, b) => (b.pnlCents ?? -1e12) - (a.pnlCents ?? -1e12))[0] ??
    null;

  const tradeHighlights = highlights.filter(
    (h) => h.acquisitionType === "trade" && h.pnlCents !== null,
  );
  const bestTrade =
    [...tradeHighlights].sort((a, b) => (b.pnlCents ?? -1e12) - (a.pnlCents ?? -1e12))[0] ?? null;

  const pricedHighlights = highlights.filter((h) => h.pnlCents !== null);
  const topGainer =
    [...pricedHighlights].sort((a, b) => (b.pnlCents ?? -1e12) - (a.pnlCents ?? -1e12))[0] ?? null;

  return {
    includedCards: filtered.length,
    pairedCards,
    excludedCurrentSeasonCards,
    totalCostBasisCents,
    totalCurrentValueCents,
    unrealizedPnlCents,
    unrealizedPnlPct,
    biggestSpend,
    bestAuctionWon,
    bestTrade,
    topGainer,
  };
}

/** Filters per-player/per-card tokenPrices history by Day (3d), Week (14d), or Month (90d). */
export function filterPriceHistoryByRange(
  points: PlayerPricePoint[],
  range: PortfolioTimeRange,
  nowMs: number = Date.now(),
): PlayerPricePoint[] {
  const sorted = [...points].sort((a, b) => a.timestampMs - b.timestampMs);
  if (sorted.length === 0) return [];
  const windowDays = range === "day" ? 3 : range === "week" ? 14 : 90;
  const cutoffMs = nowMs - windowDays * DAY_MS;
  const inWindow = sorted.filter((p) => p.timestampMs >= cutoffMs);
  return inWindow.length >= 2 ? inWindow : sorted.slice(-Math.min(sorted.length, 10));
}

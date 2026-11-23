import type { BargainListing } from "../shared/types";

export interface SealDeal {
  listing: BargainListing;
  sealingPoints: number;
  priceCents: number;
  /** Sealing Points per 1 unit of currency (EUR / USD). */
  pointsPerUnit: number;
  /** You already own this player (a spare copy is free to seal). */
  ownedPlayer: boolean;
  /** Weak lineup value (low L10): sealing it costs you nothing in lineups. */
  lowLineupValue: boolean;
}

export interface SealPlan {
  deals: SealDeal[];
  totalPoints: number;
  totalCents: number;
}

/**
 * Ranks Instant Buy listings for Vault sealing by live Sealing Points (`sealableFor`) per euro.
 * Auctions are excluded (Instant Buy prices only, never auction bids).
 */
export function rankSealDeals(
  listings: BargainListing[],
  options: { ownedPlayerSlugs?: Set<string>; maxPriceCents?: number | null; lowL10?: number } = {},
): SealDeal[] {
  const lowL10 = options.lowL10 ?? 15;
  return listings
    .filter(
      (l) =>
        l.saleType === "instant_buy" &&
        typeof l.priceCents === "number" &&
        l.priceCents > 0 &&
        typeof l.sealingPoints === "number" &&
        l.sealingPoints > 0 &&
        (options.maxPriceCents == null || l.priceCents <= options.maxPriceCents),
    )
    .map((l) => {
      const priceCents = l.priceCents as number;
      const sealingPoints = l.sealingPoints as number;
      return {
        listing: l,
        sealingPoints,
        priceCents,
        pointsPerUnit: Math.round((sealingPoints / (priceCents / 100)) * 100) / 100,
        ownedPlayer: options.ownedPlayerSlugs?.has(l.playerSlug) ?? false,
        lowLineupValue: (l.l10 ?? 0) < lowL10,
      };
    })
    .sort((a, b) => b.pointsPerUnit - a.pointsPerUnit || b.sealingPoints - a.sealingPoints || a.priceCents - b.priceCents);
}

/**
 * Exact 0/1 Knapsack budget planner maximizing total Sealing Points within budgetCents
 * (breaking ties by lowest total cost). Falls back to greedy only for extreme point sums.
 */
export function planSealBudget(deals: SealDeal[], budgetCents: number): SealPlan {
  if (!Number.isFinite(budgetCents) || budgetCents <= 0 || deals.length === 0) {
    return { deals: [], totalPoints: 0, totalCents: 0 };
  }
  const feasible = deals.filter(
    (d) =>
      Number.isFinite(d.priceCents) &&
      d.priceCents > 0 &&
      d.priceCents <= budgetCents &&
      Number.isFinite(d.sealingPoints) &&
      Math.floor(d.sealingPoints) > 0,
  );
  if (feasible.length === 0) {
    return { deals: [], totalPoints: 0, totalCents: 0 };
  }

  const maxPts = feasible.reduce((sum, d) => sum + Math.floor(d.sealingPoints), 0);
  if (maxPts <= 50_000 && feasible.length * (maxPts + 1) <= 5_000_000) {
    const stride = maxPts + 1;
    const minCost = new Float64Array(stride);
    minCost.fill(Number.POSITIVE_INFINITY);
    minCost[0] = 0;
    const take = new Uint8Array(feasible.length * stride);

    let runningMax = 0;
    for (let i = 0; i < feasible.length; i += 1) {
      const pts = Math.floor(feasible[i].sealingPoints);
      const cost = feasible[i].priceCents;
      const rowOffset = i * stride;
      for (let p = runningMax; p >= 0; p -= 1) {
        const nextCost = minCost[p] + cost;
        if (nextCost <= budgetCents && nextCost < minCost[p + pts]) {
          minCost[p + pts] = nextCost;
          take[rowOffset + p + pts] = 1;
        }
      }
      runningMax += pts;
    }

    let bestPts = 0;
    for (let p = runningMax; p >= 0; p -= 1) {
      if (minCost[p] <= budgetCents) {
        bestPts = p;
        break;
      }
    }

    const picked: SealDeal[] = [];
    let curPts = bestPts;
    for (let i = feasible.length - 1; i >= 0 && curPts > 0; i -= 1) {
      if (take[i * stride + curPts] === 1) {
        picked.push(feasible[i]);
        curPts -= Math.floor(feasible[i].sealingPoints);
      }
    }
    picked.reverse();
    return {
      deals: picked,
      totalPoints: picked.reduce((s, d) => s + d.sealingPoints, 0),
      totalCents: picked.reduce((s, d) => s + d.priceCents, 0),
    };
  }

  // Fallback for synthetic inputs with huge point totals
  const sorted = [...feasible].sort(
    (a, b) => b.pointsPerUnit - a.pointsPerUnit || b.sealingPoints - a.sealingPoints || a.priceCents - b.priceCents,
  );
  const picked: SealDeal[] = [];
  let spent = 0;
  for (const d of sorted) {
    if (spent + d.priceCents > budgetCents) continue;
    picked.push(d);
    spent += d.priceCents;
  }
  return { deals: picked, totalPoints: picked.reduce((s, d) => s + d.sealingPoints, 0), totalCents: spent };
}

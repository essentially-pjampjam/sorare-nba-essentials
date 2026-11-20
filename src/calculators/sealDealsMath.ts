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

/** Best deals that fit a budget (greedy by points per euro). */
export function planSealBudget(deals: SealDeal[], budgetCents: number): SealPlan {
  const picked: SealDeal[] = [];
  let spent = 0;
  for (const d of deals) {
    if (spent + d.priceCents > budgetCents) continue;
    picked.push(d);
    spent += d.priceCents;
  }
  return { deals: picked, totalPoints: picked.reduce((s, d) => s + d.sealingPoints, 0), totalCents: spent };
}

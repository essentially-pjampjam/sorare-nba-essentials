import type { BargainListing, BargainSortBy } from "../shared/types";

export interface BargainFilterOptions {
  minL10: number;
  inSeasonOnly: boolean;
  firstOwnerEligibleOnly?: boolean;
  searchQuery: string;
  maxPriceCents: number | null;
  sortBy?: BargainSortBy;
  prioritizeEndingSoon?: boolean;
}

/**
 * Computes a 1-100 NBA bargain score combining cost per L10 fantasy point,
 * recent L5 momentum vs L10 baseline, and In-Season eligibility.
 */
export function scoreBargainListing(
  l10: number,
  priceCents: number | null,
  inSeasonEligible: boolean,
  l5: number | null = null,
): { centsPerL10: number | null; valueScore: number } {
  if (priceCents === null || priceCents <= 0 || l10 <= 0) {
    return { centsPerL10: null, valueScore: 0 };
  }
  const centsPerL10 = Math.round((priceCents / l10) * 10) / 10;
  // Smooth curve: 2c/L10 -> ~92, 10c/L10 -> ~69, 22c/L10 -> ~50, 100c/L10 -> ~18
  const baseScore = 100 / (1 + centsPerL10 / 22);
  const inSeasonBoost = inSeasonEligible ? 8 : 0;
  const hotFormBoost = l5 !== null && l5 > l10 + 3 ? 6 : 0;
  return {
    centsPerL10,
    valueScore: Math.max(
      1,
      Math.round(Math.min(100, baseScore + inSeasonBoost + hotFormBoost)),
    ),
  };
}

export function filterAndRankBargains(
  listings: BargainListing[],
  options: BargainFilterOptions,
): BargainListing[] {
  const q = options.searchQuery.trim().toLowerCase();
  const sortBy: BargainSortBy =
    options.sortBy ??
    (options.prioritizeEndingSoon ? "ending_soon" : "value_score");

  return listings
    .filter((item) => {
      if (item.l10 < options.minL10) return false;
      if (options.inSeasonOnly && !item.inSeasonEligible) return false;
      if (options.firstOwnerEligibleOnly && !item.isFirstOwnerEligible) return false;
      if (
        options.maxPriceCents !== null &&
        item.priceCents !== null &&
        item.priceCents > options.maxPriceCents
      ) {
        return false;
      }
      if (q) {
        const hay = `${item.playerName} ${item.teamName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aTime =
        a.saleType === "auction" && a.endDate
          ? Date.parse(a.endDate)
          : Number.MAX_SAFE_INTEGER;
      const bTime =
        b.saleType === "auction" && b.endDate
          ? Date.parse(b.endDate)
          : Number.MAX_SAFE_INTEGER;
      const safeATime = Number.isFinite(aTime) ? aTime : Number.MAX_SAFE_INTEGER;
      const safeBTime = Number.isFinite(bTime) ? bTime : Number.MAX_SAFE_INTEGER;
      const aPrice = a.priceCents ?? Number.MAX_SAFE_INTEGER;
      const bPrice = b.priceCents ?? Number.MAX_SAFE_INTEGER;

      switch (sortBy) {
        case "ending_soon":
          if (safeATime !== safeBTime) return safeATime - safeBTime;
          if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
          return b.l10 - a.l10;
        case "l10_desc":
          if (b.l10 !== a.l10) return b.l10 - a.l10;
          return aPrice - bPrice;
        case "l5_desc": {
          const al5 = a.l5 ?? -1;
          const bl5 = b.l5 ?? -1;
          if (bl5 !== al5) return bl5 - al5;
          if (b.l10 !== a.l10) return b.l10 - a.l10;
          return aPrice - bPrice;
        }
        case "price_asc":
          if (aPrice !== bPrice) return aPrice - bPrice;
          return b.l10 - a.l10;
        case "value_score":
        default: {
          if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
          const ca = a.centsPerL10 ?? Number.MAX_SAFE_INTEGER;
          const cb = b.centsPerL10 ?? Number.MAX_SAFE_INTEGER;
          if (ca !== cb) return ca - cb;
          return b.l10 - a.l10;
        }
      }
    });
}

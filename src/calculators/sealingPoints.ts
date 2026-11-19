import type { CardRarity, GalleryCard } from "../shared/types";

/**
 * Sorare NBA Vault & Sealing (live-verified 2026-11-19, docs/SORARE_FACTS.md):
 * - One Vault per scarcity (Limited, Rare, Super Rare, Unique). Common cards have no Vault.
 * - A sealed card is locked: it cannot be sold, traded or used in competitions.
 * - Sealing a card in an upcoming or live lineup cancels that lineup.
 * - Max 1 unseal per scarcity every 14 days; unsealing removes its Sealing Points.
 * - Sealing Points per card: 1, 2, 5, 20, 50 or 200 by a quality tier Sorare decides
 *   (shown in-game before sealing). There is no first-owner / loyalty bonus since 2026.
 * - The Vault boost (Level 1-20 = +1%..+20%) applies to In-Season and Classic rewards only,
 *   not Arena, Hot Streaks, Missions or Special Events.
 */
export const SEALING_POINT_TIERS = [1, 2, 5, 20, 50, 200] as const;
export const UNSEAL_COOLDOWN_DAYS = 14;

export const SEALABLE_RARITIES: ReadonlySet<CardRarity> = new Set<CardRarity>([
  "limited",
  "rare",
  "super_rare",
  "unique",
]);

const SCARCITY_TIER_BASE: Partial<Record<CardRarity, number>> = {
  limited: 0,
  rare: 1,
  super_rare: 2,
  unique: 3,
};

export interface SealingPointsEstimate {
  /** 0-based index into SEALING_POINT_TIERS. */
  tierIndex: number;
  tier: string;
  sealingPoints: number;
}

/**
 * Estimates the Sealing Points tier. Sorare's real tier is its own quality rating, so this is
 * an estimate from scarcity and current form (L10); the in-game seal dialog shows the exact value.
 */
export function estimateSealingPoints(
  card: Pick<GalleryCard, "rarity" | "l10"> & Partial<Pick<GalleryCard, "sealingPoints">>,
): SealingPointsEstimate {
  const base = SCARCITY_TIER_BASE[card.rarity];
  if (base === undefined) return { tierIndex: -1, tier: "Not sealable", sealingPoints: 0 };
  // Sorare's own value (`Card.sealableFor`) wins over the estimate.
  if (typeof card.sealingPoints === "number" && Number.isFinite(card.sealingPoints) && card.sealingPoints > 0) {
    const idx = SEALING_POINT_TIERS.findIndex((p) => p === card.sealingPoints);
    return {
      tierIndex: idx >= 0 ? idx : 0,
      tier: idx >= 0 ? `Tier ${idx + 1}/6 (live)` : "Live",
      sealingPoints: card.sealingPoints,
    };
  }
  const l10 = card.l10 ?? 0;
  const quality = l10 >= 35 ? 2 : l10 >= 25 ? 1 : 0;
  const tierIndex = Math.min(SEALING_POINT_TIERS.length - 1, base + quality);
  return {
    tierIndex,
    tier: `Tier ${tierIndex + 1}/6 (est.)`,
    sealingPoints: SEALING_POINT_TIERS[tierIndex],
  };
}

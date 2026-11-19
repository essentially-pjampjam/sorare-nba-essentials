import type { CurrentLineupEntry, GalleryCard } from "../shared/types";
import { resolveSyncedLineupCardSlugs } from "./lineupOptimizerMath";
import {
  SEALABLE_RARITIES,
  UNSEAL_COOLDOWN_DAYS,
  estimateSealingPoints,
} from "./sealingPoints";

export {
  SEALING_POINT_TIERS,
  UNSEAL_COOLDOWN_DAYS,
  estimateSealingPoints,
} from "./sealingPoints";
export type { SealingPointsEstimate } from "./sealingPoints";

export interface SealCandidateEvaluation {
  cardSlug: string;
  playerName: string;
  rarity: GalleryCard["rarity"];
  tier: string;
  sealingPoints: number;
  /** A better copy of the same player in the same scarcity is kept playable. */
  isDuplicate: boolean;
  /** In an open/synced lineup or currently listed for sale (sealing would cancel/delist). */
  isLockedOrListed: boolean;
  /** Higher = better seal candidate. */
  score: number;
  reason: string;
  warnings: string[];
}

function keeperRank(c: GalleryCard): number {
  return (c.inSeasonEligible ? 1000 : 0) + c.powerMultiplier * 100 + (c.l10 ?? 0);
}

/**
 * Ranks the manager's unsealed Limited+ cards by how sensible they are to seal: spare
 * duplicates and low-value bench cards first; In-Season starters and cards in open
 * lineups or on the market last. Already-sealed and Common cards are left out.
 */
export function evaluateSealCandidates(
  cards: GalleryCard[],
  options: { currentLineups?: CurrentLineupEntry[]; lockedCardSlugs?: string[] } = {},
): SealCandidateEvaluation[] {
  const sealable = cards.filter((c) => !c.sealed && SEALABLE_RARITIES.has(c.rarity));
  if (sealable.length === 0) return [];

  const syncedLocked = new Set([
    ...resolveSyncedLineupCardSlugs(options.currentLineups ?? [], cards),
    ...(options.lockedCardSlugs ?? []),
  ]);

  const keeperByGroup = new Map<string, GalleryCard>();
  const groupSize = new Map<string, number>();
  for (const c of sealable) {
    const key = `${c.playerSlug}|${c.rarity}`;
    groupSize.set(key, (groupSize.get(key) ?? 0) + 1);
    const keeper = keeperByGroup.get(key);
    if (!keeper || keeperRank(c) > keeperRank(keeper)) keeperByGroup.set(key, c);
  }

  const evaluations = sealable.map((c): SealCandidateEvaluation => {
    const key = `${c.playerSlug}|${c.rarity}`;
    const isDuplicate = (groupSize.get(key) ?? 0) > 1 && keeperByGroup.get(key)?.slug !== c.slug;
    const openLineups = c.openedLineupIds?.length ?? 0;
    const inLineup = openLineups > 0 || syncedLocked.has(c.slug);
    const isListed = Boolean(c.lowestAskCardSlug) && c.lowestAskCardSlug === c.slug;
    const isLockedOrListed = inLineup || isListed;
    const est = estimateSealingPoints(c);
    const l10 = c.l10 ?? 0;

    let score = 50;
    if (isDuplicate) score += 30;
    if (isLockedOrListed) score -= 60;
    if (c.inSeasonEligible) score -= 20;
    score -= Math.min(40, l10);
    score += est.tierIndex * 4;
    score = Math.round(score * 10) / 10;

    const warnings = [
      "Sealing locks the card: it can't be sold, traded or played while sealed.",
      `Max 1 unseal per scarcity every ${UNSEAL_COOLDOWN_DAYS} days (${UNSEAL_COOLDOWN_DAYS}-day cooldown); unsealing removes its Sealing Points.`,
      "Any live market listing of this card is delisted when you seal it.",
    ];
    if (inLineup) {
      warnings.push(
        `Sealing cancels the upcoming/live lineup${openLineups > 1 ? `s (${openLineups})` : ""} that use this card.`,
      );
    }
    if (isListed) warnings.push("This card is listed for sale right now: sealing delists it.");

    const reasons: string[] = [];
    if (isDuplicate) reasons.push("spare copy: a better copy of this player stays playable");
    if (c.inSeasonEligible) reasons.push("In-Season eligible, still useful in lineups");
    if (l10 > 0 && l10 < 20) reasons.push(`low current form (L10 ${l10.toFixed(1)})`);
    if (l10 >= 30) reasons.push(`strong starter (L10 ${l10.toFixed(1)})`);
    if (isLockedOrListed) reasons.push(inLineup ? "in an open lineup" : "listed for sale");
    const reason = `${est.sealingPoints} SP est. (${c.rarity.replace("_", " ")} Vault)${reasons.length ? `: ${reasons.join(", ")}` : ""}.`;

    return {
      cardSlug: c.slug,
      playerName: c.playerName,
      rarity: c.rarity,
      tier: est.tier,
      sealingPoints: est.sealingPoints,
      isDuplicate,
      isLockedOrListed,
      score,
      reason,
      warnings,
    };
  });

  return evaluations.sort((a, b) => b.score - a.score || b.sealingPoints - a.sealingPoints);
}

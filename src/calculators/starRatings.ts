import { computeStarCost } from "./lineupOptimizerMath";

/**
 * Sorare NBA star ratings by player gameplay tier, from
 * `config { gameplayTierRatings(sport: NBA) }` (live-verified 2026-11-19, docs/SORARE_FACTS.md).
 * The background prefers the live list from the same query; this is the fallback copy.
 */
export const NBA_GAMEPLAY_TIER_STARS: Readonly<Record<string, number>> = {
  GOAT: 5,
  STAR_PLUS: 4.5,
  STAR: 4,
  IMPACT_PLUS: 3.5,
  IMPACT: 3,
  ROSTER_PLUS: 2.5,
  ROSTER: 2,
  DNP_PLUS: 1.5,
  DNP: 1,
};

export interface StarRating {
  stars: number;
  /** "live" = Sorare's gameplay tier; "estimated" = extension's L10 tier fallback. */
  source: "live" | "estimated";
}

/** Builds a tier -> stars map from Sorare's live config, falling back to the known table. */
export function buildTierStarMap(
  ratings: ReadonlyArray<{ gameplayTier: string; stars: number }> | null | undefined,
): Record<string, number> {
  const map: Record<string, number> = { ...NBA_GAMEPLAY_TIER_STARS };
  for (const r of ratings ?? []) {
    if (typeof r.stars === "number" && Number.isFinite(r.stars) && r.gameplayTier) {
      map[r.gameplayTier] = r.stars;
    }
  }
  return map;
}

/** Sorare's live star rating when the gameplay tier is known, else the L10 estimate. */
export function resolveStarRating(
  gameplayTier: string | null | undefined,
  l10: number | null,
  tierStars: Readonly<Record<string, number>> = NBA_GAMEPLAY_TIER_STARS,
): StarRating {
  const live = gameplayTier ? tierStars[gameplayTier] : undefined;
  if (typeof live === "number") return { stars: live, source: "live" };
  return { stars: computeStarCost(l10), source: "estimated" };
}

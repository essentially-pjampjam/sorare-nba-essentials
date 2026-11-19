import { QUALITY_TIER_META } from "../shared/constants";
import type {
  CraftClueFilter,
  CraftPoolPlayer,
} from "../shared/types";

export interface CraftRankedCandidate {
  player: CraftPoolPlayer;
  pullChancePct: number;
  baselineChancePct: number;
  oddsMultiplier: number;
  advancesCollection: boolean;
}

export interface CraftPoolEvaluation {
  totalPoolCount: number;
  totalPoolSupply: number;
  filteredCount: number;
  filteredSupply: number;
  poolShareRemainingPct: number;
  tier0ChancePct: number;
  tier0DeltaPct: number;
  topTwoTierChancePct: number;
  topTwoTierDeltaPct: number;
  highL10ChancePct: number;
  highL10DeltaPct: number;
  expectedValueCents: number | null;
  pricedCount: number;
  pricedSupplyCoveragePct: number;
  mostExpensivePlayer: CraftRankedCandidate | null;
  bestL10Player: CraftRankedCandidate | null;
  bestCollectionNeedPlayer: CraftRankedCandidate | null;
  candidates: CraftRankedCandidate[];
}

export const DEFAULT_CRAFT_CLUES: CraftClueFilter = {
  tiers: [],
  positions: [],
  conference: "ALL",
  teamSlug: "",
  ageMin: null,
  ageMax: null,
  minL10: 0,
  excludedPlayerSlugs: [],
  searchQuery: "",
};

function playerWeight(player: CraftPoolPlayer): number {
  return player.availableSupply > 0 ? player.availableSupply : 1;
}

function matchesClues(
  player: CraftPoolPlayer,
  clues: CraftClueFilter,
  excludedSet: Set<string>,
): boolean {
  if (excludedSet.has(player.playerSlug)) return false;

  if (clues.tiers.length > 0 && !clues.tiers.includes(player.qualityTier)) {
    return false;
  }

  if (
    clues.positions.length > 0 &&
    !clues.positions.some((pos) => player.positions.includes(pos))
  ) {
    return false;
  }

  if (clues.conference !== "ALL" && player.conference !== clues.conference) {
    return false;
  }

  if (clues.teamSlug && player.teamSlug !== clues.teamSlug) {
    return false;
  }

  if (clues.ageMin !== null && player.age < clues.ageMin) {
    return false;
  }

  if (clues.ageMax !== null && player.age > clues.ageMax) {
    return false;
  }

  if (clues.minL10 > 0 && (player.averageL10 ?? 0) < clues.minL10) {
    return false;
  }

  if (clues.searchQuery.trim()) {
    const q = clues.searchQuery.trim().toLowerCase();
    const matchesName = player.playerName.toLowerCase().includes(q);
    const matchesTeam = (player.teamName ?? "").toLowerCase().includes(q);
    if (!matchesName && !matchesTeam) return false;
  }

  return true;
}

function sharePct(
  players: CraftPoolPlayer[],
  totalWeight: number,
  predicate: (p: CraftPoolPlayer) => boolean,
): number {
  if (totalWeight <= 0) return 0;
  let matching = 0;
  for (const p of players) {
    if (predicate(p)) matching += playerWeight(p);
  }
  return (matching / totalWeight) * 100;
}

/**
 * Pure probability, reveal delta, and EV analyzer for the Sorare NBA crafting pool.
 */
export function evaluateCraftPool(
  players: CraftPoolPlayer[],
  clues: CraftClueFilter,
  collectionNeedSlugs: Set<string> = new Set(),
): CraftPoolEvaluation {
  const excludedSet = new Set(clues.excludedPlayerSlugs);

  const totalPoolSupply = players.reduce((s, p) => s + playerWeight(p), 0);
  const baselineTier0Pct = sharePct(
    players,
    totalPoolSupply,
    (p) => p.qualityTier === "TIER_0",
  );
  const baselineTopTwoPct = sharePct(
    players,
    totalPoolSupply,
    (p) => p.qualityTier === "TIER_0" || p.qualityTier === "TIER_1",
  );
  const baselineHighL10Pct = sharePct(
    players,
    totalPoolSupply,
    (p) => (p.averageL10 ?? 0) >= 45,
  );

  const filtered = players.filter((p) => matchesClues(p, clues, excludedSet));
  const filteredSupply = filtered.reduce((s, p) => s + playerWeight(p), 0);

  const tier0ChancePct = sharePct(
    filtered,
    filteredSupply,
    (p) => p.qualityTier === "TIER_0",
  );
  const topTwoTierChancePct = sharePct(
    filtered,
    filteredSupply,
    (p) => p.qualityTier === "TIER_0" || p.qualityTier === "TIER_1",
  );
  const highL10ChancePct = sharePct(
    filtered,
    filteredSupply,
    (p) => (p.averageL10 ?? 0) >= 45,
  );

  const candidates: CraftRankedCandidate[] = filtered.map((player) => {
    const w = playerWeight(player);
    const baselineChancePct =
      totalPoolSupply > 0 ? (w / totalPoolSupply) * 100 : 0;
    const pullChancePct = filteredSupply > 0 ? (w / filteredSupply) * 100 : 0;
    const oddsMultiplier =
      baselineChancePct > 0 ? pullChancePct / baselineChancePct : 1;

    return {
      player,
      pullChancePct,
      baselineChancePct,
      oddsMultiplier,
      advancesCollection: collectionNeedSlugs.has(player.playerSlug),
    };
  });

  // Sort default by: highest quality tier (lowest rank), then highest L10, then highest pull chance
  candidates.sort((a, b) => {
    const ra = QUALITY_TIER_META[a.player.qualityTier].rank;
    const rb = QUALITY_TIER_META[b.player.qualityTier].rank;
    if (ra !== rb) return ra - rb;
    const la = a.player.averageL10 ?? -1;
    const lb = b.player.averageL10 ?? -1;
    if (la !== lb) return lb - la;
    return b.pullChancePct - a.pullChancePct;
  });

  const priced = candidates.filter((c) => c.player.floorCents !== null);
  let expectedValueCents: number | null = null;
  let pricedWeight = 0;
  if (priced.length > 0) {
    // Selection-bias fix: unpriced players are mostly illiquid low-tier cards. Averaging only
    // the priced ones over-states EV, so each unpriced player is imputed at the cheapest
    // floor seen for its own or a lower quality tier, or 0 when no such market evidence exists.
    const imputeFor = (tierRank: number): number => {
      const floors = priced
        .filter((c) => QUALITY_TIER_META[c.player.qualityTier].rank >= tierRank)
        .map((c) => c.player.floorCents ?? 0);
      return floors.length > 0 ? Math.min(...floors) : 0;
    };
    let weightedSum = 0;
    let totalWeight = 0;
    for (const c of candidates) {
      const w = playerWeight(c.player);
      totalWeight += w;
      if (c.player.floorCents !== null) {
        weightedSum += c.player.floorCents * w;
        pricedWeight += w;
      } else {
        weightedSum += imputeFor(QUALITY_TIER_META[c.player.qualityTier].rank) * w;
      }
    }
    expectedValueCents = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;
  }
  const pricedSupplyCoveragePct =
    filteredSupply > 0 ? Math.round((pricedWeight / filteredSupply) * 1000) / 10 : 0;

  const mostExpensivePlayer =
    [...priced].sort(
      (a, b) => (b.player.floorCents ?? 0) - (a.player.floorCents ?? 0),
    )[0] ?? null;

  const bestL10Player =
    [...candidates].sort(
      (a, b) => (b.player.averageL10 ?? -1) - (a.player.averageL10 ?? -1),
    )[0] ?? null;

  const bestCollectionNeedPlayer =
    [...candidates]
      .filter((c) => c.advancesCollection)
      .sort((a, b) => {
        const ra = QUALITY_TIER_META[a.player.qualityTier].rank;
        const rb = QUALITY_TIER_META[b.player.qualityTier].rank;
        if (ra !== rb) return ra - rb;
        return b.pullChancePct - a.pullChancePct;
      })[0] ?? null;

  return {
    totalPoolCount: players.length,
    totalPoolSupply,
    filteredCount: filtered.length,
    filteredSupply,
    poolShareRemainingPct:
      totalPoolSupply > 0 ? (filteredSupply / totalPoolSupply) * 100 : 0,
    tier0ChancePct,
    tier0DeltaPct: tier0ChancePct - baselineTier0Pct,
    topTwoTierChancePct,
    topTwoTierDeltaPct: topTwoTierChancePct - baselineTopTwoPct,
    highL10ChancePct,
    highL10DeltaPct: highL10ChancePct - baselineHighL10Pct,
    expectedValueCents,
    pricedCount: priced.length,
    pricedSupplyCoveragePct,
    mostExpensivePlayer,
    bestL10Player,
    bestCollectionNeedPlayer,
    candidates,
  };
}

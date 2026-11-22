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

export type CraftClueDimensionId =
  | "quality_tier"
  | "conference"
  | "position"
  | "team"
  | "age_bracket";

export interface CraftClueEvoiItem {
  id: CraftClueDimensionId;
  label: string;
  alreadyUsed: boolean;
  /** Average fraction (%) of the current pool eliminated when this clue is revealed. */
  expectedPoolReductionPct: number;
  /** Shannon information gain (bits) from partitioning the remaining supply. */
  entropyBits: number;
  /** Expected value of information in cents (EV dispersion across reveal buckets). */
  evoiCents: number | null;
  /** Best single reveal bucket and its odds/EV summary. */
  bestOutcomeLabel: string;
  /** Composite score (0..100) used to rank the best next clue to reveal. */
  score: number;
}

export interface CraftClueEvoiReport {
  bestClue: CraftClueEvoiItem | null;
  rankedClues: CraftClueEvoiItem[];
  summary: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Computes Expected Value of Information (EVOI) and entropy reduction for each unused
 * Sorare NBA Craft clue dimension so managers know which clue narrows the pool and
 * separates high-EV pulls most effectively.
 */
export function recommendBestCraftClue(
  players: CraftPoolPlayer[],
  clues: CraftClueFilter,
  collectionNeedSlugs: Set<string> = new Set(),
): CraftClueEvoiReport {
  const baseEval = evaluateCraftPool(players, clues, collectionNeedSlugs);
  const pool = baseEval.candidates.map((c) => c.player);
  const totalWeight = pool.reduce((s, p) => s + playerWeight(p), 0);

  if (pool.length <= 1 || totalWeight <= 0) {
    return {
      bestClue: null,
      rankedClues: [],
      summary: "Pool is already narrowed to 1 or fewer candidates.",
    };
  }

  const baseEv = baseEval.expectedValueCents;
  const priced = pool.filter((p) => p.floorCents !== null);
  const imputeFloor = (tierRank: number): number => {
    const floors = priced
      .filter((p) => QUALITY_TIER_META[p.qualityTier].rank >= tierRank)
      .map((p) => p.floorCents ?? 0);
    return floors.length > 0 ? Math.min(...floors) : 0;
  };
  const bucketEvCents = (bucket: CraftPoolPlayer[]): number | null => {
    if (priced.length === 0 || bucket.length === 0) return null;
    let sum = 0;
    let wSum = 0;
    for (const p of bucket) {
      const w = playerWeight(p);
      wSum += w;
      sum += (p.floorCents !== null ? p.floorCents : imputeFloor(QUALITY_TIER_META[p.qualityTier].rank)) * w;
    }
    return wSum > 0 ? Math.round(sum / wSum) : null;
  };

  const dimensions: Array<{
    id: CraftClueDimensionId;
    label: string;
    alreadyUsed: boolean;
    bucketOf: (p: CraftPoolPlayer) => string;
  }> = [
    {
      id: "quality_tier",
      label: "Quality Tier",
      alreadyUsed: clues.tiers.length === 1,
      bucketOf: (p) => QUALITY_TIER_META[p.qualityTier].label,
    },
    {
      id: "team",
      label: "NBA Team",
      alreadyUsed: Boolean(clues.teamSlug),
      bucketOf: (p) => p.teamName ?? p.teamSlug ?? "Unknown",
    },
    {
      id: "position",
      label: "Position (G / F / C)",
      alreadyUsed: clues.positions.length === 1,
      bucketOf: (p) => p.positions[0] ?? "F",
    },
    {
      id: "conference",
      label: "Conference (East / West)",
      alreadyUsed: clues.conference !== "ALL",
      bucketOf: (p) => p.conference === "EAST" ? "East" : p.conference === "WEST" ? "West" : "Other",
    },
    {
      id: "age_bracket",
      label: "Age Bracket (U23 / 23-27 / 28+)",
      alreadyUsed: clues.ageMin !== null || clues.ageMax !== null,
      bucketOf: (p) => (p.age <= 22 ? "U23" : p.age <= 27 ? "23-27" : "28+"),
    },
  ];

  const items: CraftClueEvoiItem[] = dimensions.map((dim) => {
    const groups = new Map<string, CraftPoolPlayer[]>();
    for (const p of pool) {
      const key = dim.bucketOf(p);
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }

    let entropy = 0;
    let expectedRemainingShare = 0;
    let evoiAccum = 0;
    let bestBucketLabel = "N/A";
    let bestBucketScore = -1;

    for (const [label, bucket] of groups.entries()) {
      const bw = bucket.reduce((s, p) => s + playerWeight(p), 0);
      const prob = bw / totalWeight;
      if (prob <= 0) continue;
      entropy -= prob * Math.log2(prob);
      expectedRemainingShare += prob * prob;

      const bEv = bucketEvCents(bucket);
      if (bEv !== null && baseEv !== null) {
        // Decision value gain: positive upside above baseline if you keep/craft on favorable reveal
        evoiAccum += prob * Math.max(0, bEv - baseEv);
      }

      const t01Pct = sharePct(
        bucket,
        bw,
        (p) => p.qualityTier === "TIER_0" || p.qualityTier === "TIER_1",
      );
      const bucketQuality = bEv !== null ? bEv : t01Pct * 100;
      if (bucketQuality > bestBucketScore) {
        bestBucketScore = bucketQuality;
        bestBucketLabel = `${label} (${round1(prob * 100)}% chance, ${round1(t01Pct)}% T0/T1)`;
      }
    }

    const expectedPoolReductionPct = round1(Math.max(0, (1 - expectedRemainingShare) * 100));
    const entropyBits = Math.round(entropy * 100) / 100;
    const evoiCents = baseEv !== null ? Math.round(evoiAccum) : null;

    // Score blends EVOI (when priced), pool reduction, and entropy (capped so 30-team clue doesn't always ignore EV)
    const evComponent =
      evoiCents !== null && baseEv !== null && baseEv > 0
        ? Math.min(55, (evoiCents / baseEv) * 100)
        : 0;
    const infoComponent = Math.min(45, expectedPoolReductionPct * 0.45 + entropyBits * 4);
    const score = dim.alreadyUsed || groups.size <= 1 ? 0 : round1(evComponent + infoComponent);

    return {
      id: dim.id,
      label: dim.label,
      alreadyUsed: dim.alreadyUsed || groups.size <= 1,
      expectedPoolReductionPct,
      entropyBits,
      evoiCents,
      bestOutcomeLabel: bestBucketLabel,
      score,
    };
  });

  const rankedClues = items.sort((a, b) => {
    if (a.alreadyUsed !== b.alreadyUsed) return a.alreadyUsed ? 1 : -1;
    return b.score - a.score;
  });

  const bestClue = rankedClues.find((c) => !c.alreadyUsed && c.score > 0) ?? null;
  const summary = bestClue
    ? `Best next clue: ${bestClue.label} (eliminates ~${bestClue.expectedPoolReductionPct}% of pool on average${bestClue.evoiCents !== null && bestClue.evoiCents > 0 ? `, +${(bestClue.evoiCents / 100).toFixed(2)} EVOI` : ""}).`
    : "All high-signal clues are already applied to this pool.";

  return { bestClue, rankedClues, summary };
}

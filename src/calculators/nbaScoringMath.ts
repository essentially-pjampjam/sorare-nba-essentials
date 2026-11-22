/**
 * Official Sorare NBA Scoring Matrix & Box-Score Calculator (pure TypeScript).
 *
 * Weights:
 * - Points (PTS): +1
 * - Rebounds (REB): +1.2
 * - Assists (AST): +1.5
 * - Steals (STL): +3
 * - Blocks (BLK): +3
 * - Turnovers (TO): -2
 * - Made 3-Pointers (3PM): +1
 * - Double-Double (DD): +1 (at least 2 categories >= 10 among PTS, REB, AST, STL, BLK)
 * - Triple-Double (TD): +1 (cumulative +2 total with DD when >= 3 categories >= 10)
 */

export const SORARE_NBA_SCORING_WEIGHTS = {
  points: 1,
  rebounds: 1.2,
  assists: 1.5,
  steals: 3,
  blocks: 3,
  turnovers: -2,
  threePointersMade: 1,
  doubleDouble: 1,
  tripleDouble: 1,
} as const;

export interface NbaBoxScoreInput {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  threePointersMade: number;
}

export interface NbaScoreBreakdownRow {
  key: string;
  label: string;
  count: number;
  weight: number;
  points: number;
}

export interface NbaBoxScoreResult {
  rawScore: number;
  doubleDoubleBonus: number;
  tripleDoubleBonus: number;
  doubleDigitCategories: number;
  totalScore: number;
  breakdown: NbaScoreBreakdownRow[];
}

function cleanStat(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Calculates a player's Sorare NBA fantasy score from a single-game box score. */
export function calculateSorareNbaScore(input: NbaBoxScoreInput): NbaBoxScoreResult {
  const pts = cleanStat(input.points);
  const reb = cleanStat(input.rebounds);
  const ast = cleanStat(input.assists);
  const stl = cleanStat(input.steals);
  const blk = cleanStat(input.blocks);
  const tov = cleanStat(input.turnovers);
  const tpm = cleanStat(input.threePointersMade);

  const breakdown: NbaScoreBreakdownRow[] = [
    { key: "points", label: "PTS", count: pts, weight: SORARE_NBA_SCORING_WEIGHTS.points, points: round1(pts * SORARE_NBA_SCORING_WEIGHTS.points) },
    { key: "rebounds", label: "REB", count: reb, weight: SORARE_NBA_SCORING_WEIGHTS.rebounds, points: round1(reb * SORARE_NBA_SCORING_WEIGHTS.rebounds) },
    { key: "assists", label: "AST", count: ast, weight: SORARE_NBA_SCORING_WEIGHTS.assists, points: round1(ast * SORARE_NBA_SCORING_WEIGHTS.assists) },
    { key: "steals", label: "STL", count: stl, weight: SORARE_NBA_SCORING_WEIGHTS.steals, points: round1(stl * SORARE_NBA_SCORING_WEIGHTS.steals) },
    { key: "blocks", label: "BLK", count: blk, weight: SORARE_NBA_SCORING_WEIGHTS.blocks, points: round1(blk * SORARE_NBA_SCORING_WEIGHTS.blocks) },
    { key: "turnovers", label: "TO", count: tov, weight: SORARE_NBA_SCORING_WEIGHTS.turnovers, points: round1(tov * SORARE_NBA_SCORING_WEIGHTS.turnovers) },
    { key: "threePointersMade", label: "3PM", count: tpm, weight: SORARE_NBA_SCORING_WEIGHTS.threePointersMade, points: round1(tpm * SORARE_NBA_SCORING_WEIGHTS.threePointersMade) },
  ];

  const rawScore = round1(breakdown.reduce((sum, row) => sum + row.points, 0));

  const doubleDigitCategories = [pts, reb, ast, stl, blk].filter((v) => v >= 10).length;
  const doubleDoubleBonus = doubleDigitCategories >= 2 ? SORARE_NBA_SCORING_WEIGHTS.doubleDouble : 0;
  const tripleDoubleBonus = doubleDigitCategories >= 3 ? SORARE_NBA_SCORING_WEIGHTS.tripleDouble : 0;
  const totalScore = round1(rawScore + doubleDoubleBonus + tripleDoubleBonus);

  return {
    rawScore,
    doubleDoubleBonus,
    tripleDoubleBonus,
    doubleDigitCategories,
    totalScore,
    breakdown,
  };
}

/** Applies a total card bonus percentage (e.g. +5% In-Season + 5% Collection + 5% XP = +15%) to a score. */
export function applyLineupBonus(baseScore: number, bonusPct: number): number {
  if (!Number.isFinite(baseScore)) return 0;
  const pct = Number.isFinite(bonusPct) ? Math.max(0, bonusPct) : 0;
  return round1(baseScore * (1 + pct / 100));
}

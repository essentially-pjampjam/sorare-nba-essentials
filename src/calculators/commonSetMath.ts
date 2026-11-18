import type {
  GalleryCard,
  InjuryReportEntry,
  InjuryStatus,
  ProjectionSource,
} from "../shared/types";
import {
  evaluateCardForLineup,
  generateTopLineups,
  normalCdf,
  parseCustomProjections,
  type EvaluatedLineupCard,
  type SuggestedLineup,
} from "./lineupOptimizerMath";

export interface DailyPickerCandidate {
  card: GalleryCard;
  l10: number;
  projectedScore: number;
  targetScore: number;
  edgeVsTarget: number;
  hitChancePct: number;
  injuryStatus: InjuryStatus;
  rationale: string;
}

/**
 * Ranks Common/Set cards for the Sorare NBA Daily Picker quest:
 * "Pick a player who outperforms his L10 by 7 points AND scores >= 20 fantasy points."
 */
export function rankDailyPickerCandidates(
  commonCards: GalleryCard[],
  injuriesByName: Record<string, InjuryReportEntry>,
  gamesPerTeam: Record<string, number>,
  limit = 8,
): DailyPickerCandidate[] {
  const seenPlayers = new Set<string>();
  const candidates: DailyPickerCandidate[] = [];

  for (const card of commonCards) {
    if (seenPlayers.has(card.playerSlug)) continue;
    const ev = evaluateCardForLineup(
      card,
      "blended_smart",
      new Map(),
      injuriesByName,
      gamesPerTeam,
    );
    if (ev.injuryStatus === "OUT" || ev.injuryStatus === "DOUBTFUL") continue;

    const l10 = card.l10 ?? 0;
    const projectedScore = Math.round(ev.injuryAdjustedBase * 10) / 10;
    if (projectedScore < 12) continue;

    seenPlayers.add(card.playerSlug);
    const targetScore = Math.round(Math.max(20, l10 + 7) * 10) / 10;
    const edgeVsTarget = Math.round((projectedScore - targetScore) * 10) / 10;

    // Single-game NBA fantasy scoring stdev (~26% of projected points, min 5.5)
    const sigma = Math.max(5.5, projectedScore * 0.26);
    const z = (projectedScore - targetScore) / sigma;
    const hitChancePct = Math.round(
      Math.max(1, Math.min(92, (1 - normalCdf(-z)) * 100)),
    );

    let rationale = "Balanced floor vs L10+7 target";
    if (l10 <= 13 && projectedScore >= 20) {
      rationale = `Depressed L10 (${l10}) keeps target at 20.0 floor while projecting ${projectedScore}`;
    } else if (ev.allSources.l5 !== null && ev.allSources.l5 > l10 + 5) {
      rationale = `Hot L5 form (${ev.allSources.l5.toFixed(1)} vs ${l10} L10)`;
    } else if (edgeVsTarget >= 0) {
      rationale = `Projection clears L10+7 bar by +${edgeVsTarget.toFixed(1)} pts`;
    }

    candidates.push({
      card,
      l10,
      projectedScore,
      targetScore,
      edgeVsTarget,
      hitChancePct,
      injuryStatus: ev.injuryStatus,
      rationale,
    });
  }

  return candidates
    .sort((a, b) => {
      if (b.hitChancePct !== a.hitChancePct) {
        return b.hitChancePct - a.hitChancePct;
      }
      return b.edgeVsTarget - a.edgeVsTarget;
    })
    .slice(0, Math.max(1, limit));
}

export type SetBuildMode = "solo" | "squad";

export interface SetAutoBuildResult {
  mode: SetBuildMode;
  soloPicks: EvaluatedLineupCard[];
  squadTeams: SuggestedLineup[];
  activePoolCount: number;
}

/**
 * Builds configurable N teams (e.g., 4 teams or any N in 1..8) for Common / Set Play:
 * - "solo": Top N unique single-player picks for Set Solo / Arcade progression boards.
 * - "squad": Top N distinct 5-card Cap 120 + MVP teams (16★/120+MVP Set Squad rules).
 */
export function buildSetTeams(
  commonCards: GalleryCard[],
  options: {
    mode: SetBuildMode;
    teamCount: number;
    projectionSource: ProjectionSource;
    customProjectionsRaw: string;
    injuriesByName: Record<string, InjuryReportEntry>;
    gamesPerTeam: Record<string, number>;
    excludeOut: boolean;
    disjointAcrossTeams: boolean;
  },
): SetAutoBuildResult {
  const count = Math.max(1, Math.min(8, Math.round(options.teamCount)));

  if (options.mode === "solo") {
    const customMap = parseCustomProjections(options.customProjectionsRaw);
    const evaluatedPool = commonCards
      .filter((c) => c.rarity === "common")
      .map((card) =>
        evaluateCardForLineup(
          card,
          options.projectionSource,
          customMap,
          options.injuriesByName,
          options.gamesPerTeam,
        ),
      )
      .filter(
        (ev) =>
          (!options.excludeOut || ev.injuryStatus !== "OUT") &&
          ev.effectiveScore > 0,
      )
      .sort((a, b) => b.effectiveScore - a.effectiveScore);

    const seenSolo = new Set<string>();
    const soloPicks: EvaluatedLineupCard[] = [];
    for (const ev of evaluatedPool) {
      if (options.disjointAcrossTeams && seenSolo.has(ev.card.playerSlug)) {
        continue;
      }
      seenSolo.add(ev.card.playerSlug);
      soloPicks.push(ev);
      if (soloPicks.length >= count) break;
    }

    return {
      mode: "solo",
      soloPicks,
      squadTeams: [],
      activePoolCount: evaluatedPool.length,
    };
  }

  // Generate up to count squad teams via the branch-and-bound optimizer
  const squadRes = generateTopLineups(commonCards, {
    format: "daily_120_mvp",
    rarityFilter: "common",
    projectionSource: options.projectionSource,
    customProjectionsRaw: options.customProjectionsRaw,
    injuriesByName: options.injuriesByName,
    gamesPerTeam: options.gamesPerTeam,
    excludeOut: options.excludeOut,
    excludeQuestionable: false,
    inSeasonOnly: false,
    minInSeasonCards: 0,
    disjointAcrossLineups: options.disjointAcrossTeams,
    maxLineups: count,
    captainBonusPct: 0,
  });

  return {
    mode: "squad",
    soloPicks: [],
    squadTeams: squadRes.lineups,
    activePoolCount: squadRes.evaluatedPool.length,
  };
}

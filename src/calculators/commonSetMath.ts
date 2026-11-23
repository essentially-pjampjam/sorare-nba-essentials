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
import { lineupStdDev, probabilityAtLeast } from "./entryEvMath";

/** Live Set Solo (Arcade / Hot Streak) step targets, checked 2026-11-19 (CareerStep.target). */
export const SET_SOLO_STEP_TARGETS = [150, 180, 210, 240, 270, 290] as const;
/** Live: a Solo step allows up to 4 lineups (CareerStep.maxLineupsCount), 5 cards each. */
export const SET_SOLO_MAX_TEAMS = 4;

export interface SetTeamStepOdds {
  target: number;
  /** P(team total >= target), percent. */
  hitPct: number;
}

/** When Solo players should play: a stage finishes as soon as the scores reach its target. */
export type SetSoloTiming = "today_only" | "today_first" | "any_day";
/** Ranking weight for players who play after today in "today first" mode. */
export const SET_SOLO_LATER_WEIGHT = 0.8;

export interface SetSoloTeam {
  lineup: SuggestedLineup;
  /** Real projected total (ranking weights removed). */
  projectedTotal: number;
  /** Projected points of the players who play today (finishes the stage today if enough). */
  todayProjected: number;
  todayPlayers: number;
  /** Odds that today's players alone reach each step (instant finish once the target is reached). */
  todayStepOdds: SetTeamStepOdds[];
  /** Average card power bonus across the 5 cards (%). */
  avgBoostPct: number;
  stepOdds: SetTeamStepOdds[];
}

export interface DailyPickerOptions {
  /** Teams playing in the live Daily Picker window; when set, only their players are ranked. */
  allowedTeamSlugs?: string[];
  /** Players of those teams not in the manager's gallery (any player can be picked). */
  extraPlayers?: GalleryCard[];
}

export interface DailyPickerCandidate {
  card: GalleryCard;
  l10: number;
  projectedScore: number;
  targetScore: number;
  edgeVsTarget: number;
  hitChancePct: number;
  injuryStatus: InjuryStatus;
  rationale: string;
  /** False for roster players the manager has no Common card of (shown grayed, "Not owned"). */
  owned: boolean;
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
  options: DailyPickerOptions = {},
): DailyPickerCandidate[] {
  const seenPlayers = new Set<string>();
  const candidates: DailyPickerCandidate[] = [];

  // Live Daily Picker: only players whose team plays in today's window (before the next
  // 07:00 UTC reset), owned or not. Each such team plays exactly one game in that daily slate.
  const allowed = options.allowedTeamSlugs ? new Set(options.allowedTeamSlugs) : null;
  const pool = allowed
    ? [...commonCards, ...(options.extraPlayers ?? [])].filter(
        (c) => c.teamSlug !== null && allowed.has(c.teamSlug),
      )
    : commonCards;
  const games = allowed
    ? Object.fromEntries(Array.from(allowed).map((t) => [t, 1]))
    : gamesPerTeam;

  for (const card of pool) {
    if (seenPlayers.has(card.playerSlug)) continue;
    const ev = evaluateCardForLineup(
      card,
      "blended_smart",
      new Map(),
      injuriesByName,
      games,
    );
    if (ev.injuryStatus === "OUT" || ev.injuryStatus === "DOUBTFUL") continue;

    const l10 = card.l10 ?? 0;
    // Sorare's own next-daily projection when present, else the blended injury-adjusted base.
    const daily = allowed && typeof card.sorareDailyProjected === "number" ? card.sorareDailyProjected : null;
    const projectedScore = Math.round((daily ?? ev.injuryAdjustedBase) * 10) / 10;
    if (projectedScore < 12) continue;

    seenPlayers.add(card.playerSlug);
    const targetScore = Math.round(Math.max(20, l10 + 7) * 10) / 10;
    const edgeVsTarget = Math.round((projectedScore - targetScore) * 10) / 10;

    // Single-game NBA fantasy scoring stdev (~35% CV matching the unified NBA model, min 5.5)
    const sigma = Math.max(5.5, projectedScore * 0.35);
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
      owned: !card.slug.startsWith("roster:"),
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
  /** Solo mode: full 5-card teams under the 16-star cap (up to 4), like the Pro builder. */
  soloTeams: SetSoloTeam[];
  activePoolCount: number;
}

function toSoloTeam(
  lineup: SuggestedLineup,
  todayTeams: Set<string> | null,
  weights: Record<string, number> | undefined,
): SetSoloTeam {
  const real = lineup.slots.map((s) => {
    const team = s.evaluated.card.teamSlug;
    const w = (team && weights?.[team]) || 1;
    return { projectedScore: s.slotScore / w, teamSlug: team, today: !todayTeams || (team !== null && todayTeams.has(team)) };
  });
  const projectedTotal = Math.round(real.reduce((a, r) => a + r.projectedScore, 0) * 10) / 10;
  const todayCards = real.filter((r) => r.today);
  const todayProjected = Math.round(todayCards.reduce((a, r) => a + r.projectedScore, 0) * 10) / 10;
  const sd = lineupStdDev(real);
  const todaySd = todayCards.length > 0 ? lineupStdDev(todayCards) : 1;
  const boosts = lineup.slots.map((s) => ((s.evaluated.card.powerMultiplier ?? 1) - 1) * 100);
  return {
    lineup,
    projectedTotal,
    todayProjected,
    todayPlayers: todayCards.length,
    todayStepOdds: SET_SOLO_STEP_TARGETS.map((target) => ({
      target,
      hitPct: todayCards.length > 0 ? Math.round(probabilityAtLeast(todayProjected, todaySd, target)) : 0,
    })),
    avgBoostPct: boosts.length ? Math.round((boosts.reduce((a, b) => a + b, 0) / boosts.length) * 10) / 10 : 0,
    stepOdds: SET_SOLO_STEP_TARGETS.map((target) => ({
      target,
      hitPct: Math.round(probabilityAtLeast(projectedTotal, sd, target)),
    })),
  };
}

/**
 * Builds configurable N teams (e.g., 4 teams or any N in 1..8) for Common / Set Play:
 * - "solo": Top N unique single-player picks for Set Solo / Arcade progression boards.
 * - "squad": Top N distinct 5-card teams under the live 16-star cap (Arcade: up to 4 teams;
 *   Squad: 1 team per manager, the squad's 3 best teams count).
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
    /** Solo timing (default today_only): which game days count and how they rank. */
    soloTiming?: SetSoloTiming;
    /** Teams with a game today (before the next 07:00 UTC reset). */
    todayTeamSlugs?: string[];
    /** Teams with a game in the next daily window (tomorrow), for today_first / any_day. */
    laterTeamSlugs?: string[];
  },
): SetAutoBuildResult {
  const count = Math.max(1, Math.min(8, Math.round(options.teamCount)));

  if (options.mode === "solo") {
    const timing = options.soloTiming ?? "today_only";
    const today = options.todayTeamSlugs ?? [];
    const later = options.laterTeamSlugs ?? [];
    const todaySet = today.length > 0 ? new Set(today) : null;
    let soloGames = options.gamesPerTeam;
    let weights: Record<string, number> | undefined;
    if (timing !== "today_only" && (today.length > 0 || later.length > 0)) {
      soloGames = Object.fromEntries([...today, ...later].map((t) => [t, 1]));
      if (timing === "today_first") {
        weights = Object.fromEntries(later.filter((t) => !todaySet?.has(t)).map((t) => [t, SET_SOLO_LATER_WEIGHT]));
      }
    }
    const customMap = parseCustomProjections(options.customProjectionsRaw);
    const evaluatedPool = commonCards
      .filter((c) => c.rarity === "common")
      .map((card) =>
        evaluateCardForLineup(
          card,
          options.projectionSource,
          customMap,
          options.injuriesByName,
          soloGames,
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

    // Live Solo rules: each lineup is 5 Common cards under a 16-star cap, up to 4 per step.
    const teamsRes = generateTopLineups(commonCards, {
      format: "champion_16",
      rarityFilter: "common",
      projectionSource: options.projectionSource,
      customProjectionsRaw: options.customProjectionsRaw,
      injuriesByName: options.injuriesByName,
      gamesPerTeam: soloGames,
      scoreWeightByTeam: weights,
      excludeOut: options.excludeOut,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: options.disjointAcrossTeams,
      maxLineups: Math.min(count, SET_SOLO_MAX_TEAMS),
      captainBonusPct: 0,
    });

    return {
      mode: "solo",
      soloPicks,
      squadTeams: [],
      soloTeams: teamsRes.lineups
        .map((l) => toSoloTeam(l, todaySet, weights))
        .sort((x, y) =>
          timing === "today_first" ? y.todayProjected - x.todayProjected || y.projectedTotal - x.projectedTotal : y.projectedTotal - x.projectedTotal,
        ),
      activePoolCount: evaluatedPool.length,
    };
  }

  // Live Set rules (2026-11-19, docs/SORARE_FACTS.md): Arcade and Squad teams are 5 cards
  // under a 16-star cap (Sorare gameplay-tier stars); the old 120 L10 + MVP rule is retired.
  const squadRes = generateTopLineups(commonCards, {
    format: "champion_16",
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
    soloTeams: [],
    activePoolCount: squadRes.evaluatedPool.length,
  };
}

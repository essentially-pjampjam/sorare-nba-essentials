import type { GalleryCard, InjuryReportEntry, PlayerSeasonStats } from "../shared/types";
import { rankDailyPickerCandidates } from "./commonSetMath";
import { normalCdf, normalizePlayerName } from "./lineupOptimizerMath";
import { buildTeamOutStarMap } from "./questOptimizerMath";

/** Live daily missions (checked 2026-11-20 on sorare.com, Play missions). */
export type DailyMission = "set_daily" | "pro_daily" | "rebounds";
export type PickStrategy = "best" | "safe" | "risk";
export type OwnershipFilter = "owned" | "not_owned" | "all";

export interface DailyMissionInfo {
  title: string;
  rule: string;
  reward: string;
  picks: number;
  /** Only cards of this rarity can be picked (Sorare shows only your own cards of it). */
  rarity: GalleryCard["rarity"];
}

export const DAILY_MISSIONS: Record<DailyMission, DailyMissionInfo> = {
  set_daily: {
    title: "Set Daily Picker",
    rule: "Player beats his L10 by 7+ and scores 20+",
    reward: "Common Essence",
    picks: 1,
    rarity: "common",
  },
  pro_daily: {
    title: "Pro Daily Picker",
    rule: "Player beats his L10 by 7+ and scores 20+",
    reward: "100 XP per hit",
    picks: 3,
    rarity: "limited",
  },
  rebounds: {
    title: "Rebounds Picker",
    rule: "Player rated 1.5★ or less grabs 5+ rebounds",
    reward: "1 Division Clue per hit, 10 if all 3 hit",
    picks: 3,
    rarity: "limited",
  },
};

export const REBOUNDS_TARGET = 5;
export const REBOUNDS_MAX_STARS = 1.5;

export interface DailyPickIdea {
  card: GalleryCard;
  owned: boolean;
  mission: DailyMission;
  /** Projected fantasy score (score missions) or expected rebounds (rebounds). */
  expected: number;
  /** What the pick must reach, e.g. "28 pts" or "5 reb". */
  targetLabel: string;
  hitPct: number;
  /** Strategy score used for sorting (higher first). */
  strategyScore: number;
  upsideTags: string[];
  riskTags: string[];
  reason: string;
}

export interface DailyPickArgs {
  mission: DailyMission;
  strategy: PickStrategy;
  ownership: OwnershipFilter;
  /** Manager's cards (all rarities); filtered to the mission's rarity. */
  ownedCards: GalleryCard[];
  /** Roster players of slate teams (not owned stand-ins). */
  extraPlayers: GalleryCard[];
  injuriesByName: Record<string, InjuryReportEntry>;
  /** Teams in today's Daily Picker slate; empty = no slate known (all teams allowed). */
  slateTeamSlugs: string[];
  /** ESPN season averages by normalized player name. */
  statsByName: Record<string, PlayerSeasonStats>;
  limit?: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** P(X >= target) for a count stat with mean `mean` (normal approx with continuity correction). */
export function probabilityStatAtLeast(mean: number, target: number): number {
  if (!(mean > 0)) return 0;
  const sd = Math.max(1.6, Math.sqrt(mean) * 1.2);
  const z = (mean - (target - 0.5)) / sd;
  return Math.max(0, Math.min(99, Math.round(normalCdf(z) * 100)));
}

function tagPlayer(
  card: GalleryCard,
  injury: InjuryReportEntry | undefined,
  usageTag: string | undefined,
  stats: PlayerSeasonStats | undefined,
): { upside: string[]; risk: string[] } {
  const upside: string[] = [];
  const risk: string[] = [];
  const l10 = card.l10 ?? 0;
  const l5 = card.l5 ?? 0;
  if (l5 - l10 >= 5) upside.push(`Hot: L5 ${l5.toFixed(0)} vs L10 ${l10.toFixed(0)}`);
  if (usageTag) upside.push(usageTag);
  if (stats && stats.avgMinutes >= 30) upside.push(`${stats.avgMinutes.toFixed(0)} min/game`);
  if (injury && (injury.status === "QUESTIONABLE" || injury.status === "DAY_TO_DAY")) {
    risk.push(`${injury.status === "QUESTIONABLE" ? "Questionable" : "Day-to-day"}`);
  }
  if (l10 - l5 >= 5) risk.push(`Cold: L5 ${l5.toFixed(0)} vs L10 ${l10.toFixed(0)}`);
  if (stats && stats.avgMinutes > 0 && stats.avgMinutes < 20) risk.push(`Low minutes (${stats.avgMinutes.toFixed(0)})`);
  if (stats && stats.gamesPlayed > 0 && stats.gamesPlayed < 5) risk.push(`Small sample (${stats.gamesPlayed} games)`);
  return { upside, risk };
}

function strategyScore(strategy: PickStrategy, hitPct: number, upside: string[], risk: string[]): number {
  switch (strategy) {
    case "safe":
      return hitPct - 12 * risk.length;
    case "risk":
      return hitPct + 15 * upside.length;
    default:
      return hitPct;
  }
}

/**
 * Daily pick ideas for one mission. Your own cards of the mission's rarity are the real options
 * (Sorare only offers those); not-owned players are listed for comparison. Strategies:
 * best = highest hit odds, safe = odds minus risk flags, risk = upside plays (hot form,
 * a star teammate OUT, big minutes) that can beat their usual numbers.
 */
export function buildDailyPickIdeas(args: DailyPickArgs): DailyPickIdea[] {
  const info = DAILY_MISSIONS[args.mission];
  const limit = args.limit ?? 8;
  const owned = args.ownedCards.filter((c) => c.rarity === info.rarity && !c.sealed);
  const slate = args.slateTeamSlugs.length > 0 ? new Set(args.slateTeamSlugs) : null;
  const inSlate = (c: GalleryCard) => !slate || (c.teamSlug !== null && slate.has(c.teamSlug));
  const usageByTeam = buildTeamOutStarMap([...args.ownedCards, ...args.extraPlayers], args.injuriesByName);

  const ideas: DailyPickIdea[] = [];
  if (args.mission === "rebounds") {
    const seen = new Set<string>();
    for (const card of [...owned, ...args.extraPlayers]) {
      if (seen.has(card.playerSlug) || !inSlate(card)) continue;
      seen.add(card.playerSlug);
      if (card.starCost > REBOUNDS_MAX_STARS) continue;
      const key = normalizePlayerName(card.playerName);
      const injury = args.injuriesByName[key];
      if (injury && (injury.status === "OUT" || injury.status === "DOUBTFUL")) continue;
      const stats = args.statsByName[key];
      if (!stats || !(stats.avgRebounds > 0)) continue;
      const usageTag = card.teamSlug ? usageByTeam[card.teamSlug] : undefined;
      let mean = stats.avgRebounds;
      if (usageTag) mean *= 1.08;
      if (injury && injury.status !== "ACTIVE") mean *= 0.85;
      const hitPct = probabilityStatAtLeast(mean, REBOUNDS_TARGET);
      const { upside, risk } = tagPlayer(card, injury, usageTag, stats);
      if (card.starSource !== "live") risk.push("Stars estimated");
      ideas.push({
        card,
        owned: !card.slug.startsWith("roster:"),
        mission: args.mission,
        expected: round1(mean),
        targetLabel: `${REBOUNDS_TARGET} reb`,
        hitPct,
        strategyScore: strategyScore(args.strategy, hitPct, upside, risk),
        upsideTags: upside,
        riskTags: risk,
        reason: `${stats.avgRebounds.toFixed(1)} reb/game in ${stats.avgMinutes.toFixed(0)} min, ${card.starCost}★`,
      });
    }
  } else {
    const ranked = rankDailyPickerCandidates(
      owned,
      args.injuriesByName,
      {},
      200,
      slate ? { allowedTeamSlugs: Array.from(slate), extraPlayers: args.extraPlayers } : {},
    );
    for (const c of ranked) {
      const key = normalizePlayerName(c.card.playerName);
      const usageTag = c.card.teamSlug ? usageByTeam[c.card.teamSlug] : undefined;
      const { upside, risk } = tagPlayer(c.card, args.injuriesByName[key], usageTag, args.statsByName[key]);
      ideas.push({
        card: c.card,
        owned: c.owned,
        mission: args.mission,
        expected: c.projectedScore,
        targetLabel: `${c.targetScore} pts`,
        hitPct: c.hitChancePct,
        strategyScore: strategyScore(args.strategy, c.hitChancePct, upside, risk),
        upsideTags: upside,
        riskTags: risk,
        reason: c.rationale,
      });
    }
  }

  return ideas
    .filter((i) => (args.ownership === "all" ? true : args.ownership === "owned" ? i.owned : !i.owned))
    .filter((i) => args.strategy !== "risk" || i.upsideTags.length > 0)
    .sort((a, b) => b.strategyScore - a.strategyScore || b.hitPct - a.hitPct)
    .slice(0, limit);
}

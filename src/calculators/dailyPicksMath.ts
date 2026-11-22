import type { GalleryCard, InjuryReportEntry, PlayerSeasonStats } from "../shared/types";
import { rankDailyPickerCandidates } from "./commonSetMath";
import { normalizePlayerName } from "./lineupOptimizerMath";
import { buildTeamOutStarMap } from "./questOptimizerMath";

/** Preset mission ids (used until the live missions are scanned from Sorare). */
export type DailyMission = "set_daily" | "pro_daily" | "rebounds" | "playmaker" | "double_double";
export type PickStrategy = "best" | "safe" | "risk";
export type OwnershipFilter = "owned" | "not_owned" | "all";

export type PickerKind = "score" | "stat" | "double_double" | "triple_double";
export type PickerStat = "rebounds" | "points" | "assists" | "steals" | "blocks";

/** One daily picker mission, preset or parsed from Sorare's live task (`DecisivePlayerPickerTask`). */
export interface PickerMissionSpec {
  id: string;
  title: string;
  rule: string;
  reward: string;
  picks: number;
  /** Only cards of this rarity can be picked (Sorare shows only your own cards of it). */
  rarity: GalleryCard["rarity"];
  kind: PickerKind;
  stat?: PickerStat;
  /** Stat target for kind "stat" (e.g. 5 rebounds). */
  target?: number;
  /** Highest star rating allowed (e.g. 1.5), when the mission has one. */
  maxStars?: number | null;
  source: "preset" | "detected";
}

/** Kept for older imports: preset missions are full specs. */
export type DailyMissionInfo = PickerMissionSpec;

export const DAILY_MISSIONS: Record<DailyMission, PickerMissionSpec> = {
  set_daily: {
    id: "set_daily",
    title: "Set Daily Picker",
    rule: "Player beats his L10 by 7+ and scores 20+",
    reward: "Common Essence",
    picks: 1,
    rarity: "common",
    kind: "score",
    source: "preset",
  },
  pro_daily: {
    id: "pro_daily",
    title: "Pro Daily Picker",
    rule: "Player beats his L10 by 7+ and scores 20+",
    reward: "100 XP per hit",
    picks: 3,
    rarity: "limited",
    kind: "score",
    source: "preset",
  },
  rebounds: {
    id: "rebounds",
    title: "Rebounds Picker",
    rule: "Player rated 1.5★ or less grabs 5+ rebounds",
    reward: "1 Division Clue per hit, 10 if all 3 hit",
    picks: 3,
    rarity: "limited",
    kind: "stat",
    stat: "rebounds",
    target: 5,
    maxStars: 1.5,
    source: "preset",
  },
  playmaker: {
    id: "playmaker",
    title: "Playmaker Picker",
    rule: "Player ranked DNP Plus (1.5★) or less records 4+ assists",
    reward: "25 Essence per hit, 250 if all hit",
    picks: 3,
    rarity: "limited",
    kind: "stat",
    stat: "assists",
    target: 4,
    maxStars: 1.5,
    source: "preset",
  },
  double_double: {
    id: "double_double",
    title: "Double Double Picker",
    rule: "Player records a double-double in today's games",
    reward: "$2 market credit per hit, $15 if all 3 hit",
    picks: 3,
    rarity: "limited",
    kind: "double_double",
    source: "preset",
  },
};

/** Raw fields of a live picker task as Sorare's page loads them. */
export interface RawPickerTask {
  title: string;
  description: string;
  mode: string;
  slug: string;
  picks: number;
}

const STAT_WORDS: Array<[PickerStat, RegExp]> = [
  ["rebounds", /rebound/],
  ["assists", /assist/],
  ["steals", /steal/],
  ["blocks", /block/],
  ["points", /\bpoints?\b(?!\s+per)/],
];

const NAMED_TIER_STARS: Array<[RegExp, number]> = [
  [/^dnp(?:\s+plus|\s*\+)$/, 1.5],
  [/^dnp$/, 1],
  [/^reserve(?:\s+plus|\s*\+)$/, 1.5],
  [/^reserve$/, 1],
  [/^roster(?:\s+plus|\s*\+)$/, 2.5],
  [/^roster$/, 2],
  [/^impact(?:\s+plus|\s*\+)$/, 3.5],
  [/^impact$/, 3],
  [/^star(?:\s+plus|\s*\+)$/, 4.5],
  [/^star$/, 4],
  [/^goat$/, 5],
  [/^icon$/, 5],
];

function parseNamedTierMaxStars(text: string): number | null {
  const candidates = [
    ...Array.from(text.matchAll(/\b(?:ranked|rated)\s+([a-z]+(?:\s+plus|\s*\+)?)(?=\s|$|[.,;:])/g)).map((m) => m[1]),
    ...Array.from(text.matchAll(/\b([a-z]+(?:\s+plus|\s*\+)?)\s+(?:or\s+(?:less|below|lower)|max)\b/g)).map((m) => m[1]),
  ];
  for (const raw of candidates) {
    const clean = raw.replace(/\s+/g, " ").trim();
    const match = NAMED_TIER_STARS.find(([re]) => re.test(clean));
    if (match) return match[1];
  }
  return null;
}

/**
 * Distinguishes Pro vs Set DecisivePlayerPickerTask items when Sorare's SPA Apollo cache
 * holds tasks from both modes in the same tab.
 */
export function classifyPickerTaskMode(task: RawPickerTask): "pro" | "set" {
  const desc = task.description.trim();
  const slug = task.slug.toLowerCase();
  const title = task.title.toLowerCase();
  if (/^(classic|in-season):/i.test(desc)) return "pro";
  if (/\b(xp|limited|rare|super\s*rare|unique)\b/i.test(desc)) return "pro";
  if (/\b(classic|pro|limited|rare|playmaker|rebound|double|triple)\b/.test(slug)) return "pro";
  if (/\b(playmaker|rebound|double[- ]double|triple[- ]double)\b/.test(title)) return "pro";
  if ((task.picks || 1) > 1) return "pro";
  return "set";
}

/** Filters and deduplicates cached picker tasks so Pro missions never leak into Set mode. */
export function filterPickerTasksForMode<T extends RawPickerTask>(tasks: T[], mode: "pro" | "set"): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tasks) {
    if (classifyPickerTaskMode(t) !== mode) continue;
    const key = (t.slug || `${t.title}::${t.description}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Turns a live Sorare picker task into a mission spec (rule, reward, stat target, star cap). */
export function parsePickerMission(raw: RawPickerTask, rarity: GalleryCard["rarity"]): PickerMissionSpec {
  const desc = raw.description.replace(/^classic:\s*/i, "").trim();
  const text = `${raw.title} ${desc} ${raw.slug}`.toLowerCase();
  let kind: PickerKind = "stat";
  let stat: PickerStat | undefined;
  let target: number | undefined;
  if (/triple[- ]double/.test(text)) kind = "triple_double";
  else if (/double[- ]double/.test(text)) kind = "double_double";
  else if (/outperform|l10|overperformance/.test(text) || raw.mode === "SCORE") kind = "score";
  else {
    stat = STAT_WORDS.find(([, re]) => re.test(text))?.[0];
    const num = text.match(/(\d+)\s*\+?\s*(?:or more\s+)?(?:rebounds?|assists?|steals?|blocks?|points?)/) ?? text.match(/at least (\d+)/);
    target = num ? Number(num[1]) : stat === "rebounds" ? 5 : undefined;
    if (!stat || !target) kind = "score";
  }
  const starMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:★|stars?)\s*(?:or less|or below|max)/) ?? text.match(/rated\s+(\d+(?:\.\d+)?)/);
  const maxStars = starMatch ? Number(starMatch[1]) : parseNamedTierMaxStars(text);
  const rewards = Array.from(desc.matchAll(/win (?:a total of )?([^.]+)/gi)).map((m) => m[1].trim());
  const rule = desc
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/^win a total/i.test(sentence))
    .join(" ")
    .replace(/\s+and win [^.]+/i, "")
    .trim()
    .replace(/\.$/, "");
  return {
    id: raw.slug || raw.title,
    title: raw.title,
    rule: rule || desc,
    reward: rewards.join(", ") || "See Sorare",
    picks: Math.max(1, raw.picks || 1),
    rarity,
    kind,
    stat,
    target,
    maxStars,
    source: "detected",
  };
}

export function resolveMission(mission: DailyMission | PickerMissionSpec): PickerMissionSpec {
  return typeof mission === "string" ? DAILY_MISSIONS[mission] : mission;
}

export const REBOUNDS_TARGET = 5;
export const REBOUNDS_MAX_STARS = 1.5;

export interface DailyPickIdea {
  card: GalleryCard;
  owned: boolean;
  /** Mission id (preset id or Sorare task slug). */
  mission: string;
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
  /** Preset id or a live mission spec (see `parsePickerMission`). */
  mission: DailyMission | PickerMissionSpec;
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

/**
 * P(X >= target) for a discrete NBA count stat with mean `mean` using an overdispersed
 * Poisson (Negative Binomial) CDF (dispersion r = 6 -> Var(X) = mean + mean^2 / 6).
 * Much more accurate than a Normal approximation for low-mean count stats (assists, rebounds, steals, blocks).
 */
export function probabilityStatAtLeast(mean: number, target: number): number {
  if (!(mean > 0) || !Number.isFinite(target)) return 0;
  const kTarget = Math.ceil(target);
  if (kTarget <= 0) return 99;
  const r = 6;
  const p = r / (r + mean);
  const q = 1 - p;
  let logP = r * Math.log(p);
  let cdfBelow = 0;
  for (let k = 0; k < kTarget; k += 1) {
    cdfBelow += Math.exp(logP);
    if (cdfBelow >= 1) return 0;
    logP += Math.log(k + r) - Math.log(k + 1) + Math.log(q);
  }
  const tail = Math.max(0, 1 - cdfBelow);
  return Math.max(0, Math.min(99, Math.round(tail * 100)));
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
const STAT_LABEL: Record<PickerStat, string> = { rebounds: "reb", points: "pts", assists: "ast", steals: "stl", blocks: "blk" };

function statMean(stats: PlayerSeasonStats, stat: PickerStat): number {
  switch (stat) {
    case "rebounds":
      return stats.avgRebounds;
    case "points":
      return stats.avgPoints;
    case "assists":
      return stats.avgAssists ?? 0;
    case "steals":
      return stats.avgSteals ?? 0;
    case "blocks":
      return stats.avgBlocks ?? 0;
  }
}

/**
 * P(double-double) or P(triple-double) in %: the season rate (ESPN counts) blended with a model
 * from points / rebounds / assists averages (each >= 10, treated as independent). The season rate
 * gets more weight as games played grow.
 */
export function probabilityMultiDouble(stats: PlayerSeasonStats, kind: "double_double" | "triple_double", meanBoost = 1): number {
  const p = [stats.avgPoints, stats.avgRebounds, stats.avgAssists ?? 0].map((m) => probabilityStatAtLeast(m * meanBoost, 10) / 100);
  const [a, b, c] = p;
  const model =
    kind === "triple_double"
      ? a * b * c
      : a * b * (1 - c) + a * (1 - b) * c + (1 - a) * b * c + a * b * c;
  const gp = stats.gamesPlayed;
  const count = kind === "triple_double" ? (stats.tripleDoubles ?? 0) : (stats.doubleDoubles ?? 0);
  const seasonRate = gp > 0 ? count / gp : 0;
  const w = gp > 0 ? Math.min(1, gp / 20) * 0.7 : 0;
  return Math.max(0, Math.min(99, Math.round((w * seasonRate + (1 - w) * model) * 100)));
}

export function buildDailyPickIdeas(args: DailyPickArgs): DailyPickIdea[] {
  const info = resolveMission(args.mission);
  const limit = args.limit ?? 8;
  const owned = args.ownedCards.filter((c) => c.rarity === info.rarity && !c.sealed);
  const slate = args.slateTeamSlugs.length > 0 ? new Set(args.slateTeamSlugs) : null;
  const inSlate = (c: GalleryCard) => !slate || (c.teamSlug !== null && slate.has(c.teamSlug));
  const usageByTeam = buildTeamOutStarMap([...args.ownedCards, ...args.extraPlayers], args.injuriesByName);

  const ideas: DailyPickIdea[] = [];
  if (info.kind !== "score") {
    const seen = new Set<string>();
    for (const card of [...owned, ...args.extraPlayers]) {
      if (seen.has(card.playerSlug) || !inSlate(card)) continue;
      seen.add(card.playerSlug);
      if (info.maxStars != null && card.starCost > info.maxStars) continue;
      const key = normalizePlayerName(card.playerName);
      const injury = args.injuriesByName[key];
      if (injury && (injury.status === "OUT" || injury.status === "DOUBTFUL")) continue;
      const stats = args.statsByName[key];
      if (!stats || !(stats.gamesPlayed > 0)) continue;
      const usageTag = card.teamSlug ? usageByTeam[card.teamSlug] : undefined;
      const boost = (usageTag ? 1.08 : 1) * (injury && injury.status !== "ACTIVE" ? 0.85 : 1);
      let hitPct: number;
      let expected: number;
      let targetLabel: string;
      let reason: string;
      if (info.kind === "stat" && info.stat && info.target) {
        const base = statMean(stats, info.stat);
        if (!(base > 0)) continue;
        expected = round1(base * boost);
        hitPct = probabilityStatAtLeast(base * boost, info.target);
        targetLabel = `${info.target} ${STAT_LABEL[info.stat]}`;
        reason = `${base.toFixed(1)} ${STAT_LABEL[info.stat]}/game in ${stats.avgMinutes.toFixed(0)} min, ${card.starCost}★`;
      } else {
        const multi = info.kind === "triple_double" ? "triple_double" : "double_double";
        hitPct = probabilityMultiDouble(stats, multi, boost);
        const count = multi === "triple_double" ? (stats.tripleDoubles ?? 0) : (stats.doubleDoubles ?? 0);
        expected = round1(stats.gamesPlayed > 0 ? (count / stats.gamesPlayed) * 100 : 0);
        targetLabel = multi === "triple_double" ? "triple-double" : "double-double";
        reason = `${count} ${multi === "triple_double" ? "TD" : "DD"} in ${stats.gamesPlayed} games • ${stats.avgPoints.toFixed(0)} pts / ${stats.avgRebounds.toFixed(1)} reb / ${(stats.avgAssists ?? 0).toFixed(1)} ast`;
        if (hitPct < 3) continue;
      }
      const { upside, risk } = tagPlayer(card, injury, usageTag, stats);
      if (info.maxStars != null && card.starSource !== "live") risk.push("Stars estimated");
      ideas.push({
        card,
        owned: !card.slug.startsWith("roster:"),
        mission: info.id,
        expected,
        targetLabel,
        hitPct,
        strategyScore: strategyScore(args.strategy, hitPct, upside, risk),
        upsideTags: upside,
        riskTags: risk,
        reason,
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
        mission: info.id,
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

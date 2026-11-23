import type { CardRarity, ProProgressRecord } from "../shared/types";
import type { PageGameWeekGroup, ProGameWeekSummary, ProSeasonPulse } from "./proProgressMath";

export interface GameWeekRecapLineupRow {
  leaderboardName: string;
  score: number | null;
  rank: number | null;
  totalEntries: number | null;
  topPct: number | null;
  statusLabel: string;
  isRewarded: boolean;
  isCash: boolean;
}

export interface GameWeekRecapCardData {
  fixtureSlug: string;
  fixtureLabel: string;
  username: string | null;
  rarity: CardRarity;
  totalPoints: number;
  lineupCount: number;
  rewardedCount: number;
  cashCount: number;
  bestTopPct: number | null;
  currentRewardStreak: number;
  bestLineup: GameWeekRecapLineupRow | null;
  lineups: GameWeekRecapLineupRow[];
  generatedDateLabel: string;
}

export function formatFixtureLabel(fixtureSlug: string): string {
  const stripped = fixtureSlug.replace(/^nba-/i, "").trim();
  if (!stripped) return "NBA Game Week";
  return stripped
    .split("-")
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function buildGameWeekRecapFilename(fixtureSlug: string, username?: string | null): string {
  const userPart = (username ?? "manager")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const gwPart = fixtureSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `sorare-gw-recap-${userPart || "manager"}-${gwPart || "gw"}.png`;
}

/**
 * Builds a pure 16:9 Game Week Recap Card payload from either live/finished page lineups
 * or saved local ProProgress history + Season Pulse.
 */
export function buildGameWeekRecapData(params: {
  username?: string | null;
  rarity?: CardRarity;
  group?: PageGameWeekGroup | null;
  weekSummary?: ProGameWeekSummary | null;
  historyRecords?: ProProgressRecord[];
  pulse?: ProSeasonPulse | null;
  nowDate?: Date;
}): GameWeekRecapCardData | null {
  const {
    username = null,
    rarity = "limited",
    group = null,
    weekSummary = null,
    historyRecords = [],
    pulse = null,
    nowDate = new Date(),
  } = params;

  const dateLabel = nowDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (group && group.rows.length > 0) {
    const lineups: GameWeekRecapLineupRow[] = group.rows.map((r) => ({
      leaderboardName: r.leaderboardName,
      score: r.score,
      rank: r.rank,
      totalEntries: r.totalEntries,
      topPct: r.topPct,
      statusLabel:
        r.status === "cash"
          ? "IN THE CASH"
          : r.status === "rewarded"
            ? "IN REWARDS"
            : r.status === "outside"
              ? "OUTSIDE"
              : r.status === "ranked"
                ? "RANKED"
                : "SUBMITTED",
      isRewarded: r.status === "rewarded" || r.status === "cash",
      isCash: r.status === "cash",
    }));

    const totalPoints = Math.round(lineups.reduce((s, l) => s + (l.score ?? 0), 0) * 10) / 10;
    const rewardedCount = lineups.filter((l) => l.isRewarded).length;
    const cashCount = lineups.filter((l) => l.isCash).length;
    const pcts = lineups.map((l) => l.topPct).filter((v): v is number => v !== null);
    const bestTopPct = pcts.length > 0 ? Math.min(...pcts) : null;
    const bestLineup =
      [...lineups].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] ?? null;

    return {
      fixtureSlug: group.fixtureSlug,
      fixtureLabel: group.fixtureName || formatFixtureLabel(group.fixtureSlug),
      username,
      rarity,
      totalPoints,
      lineupCount: lineups.length,
      rewardedCount,
      cashCount,
      bestTopPct,
      currentRewardStreak: pulse?.currentRewardStreak ?? (rewardedCount > 0 ? 1 : 0),
      bestLineup,
      lineups: lineups.slice(0, 4),
      generatedDateLabel: dateLabel,
    };
  }

  if (weekSummary) {
    const gwRecs = historyRecords.filter((r) => r.fixtureSlug === weekSummary.fixtureSlug);
    const lineups: GameWeekRecapLineupRow[] = gwRecs
      .map((r) => {
        const topPct =
          r.rank && r.totalEntries
            ? Math.max(0.1, Math.round((r.rank / r.totalEntries) * 1000) / 10)
            : null;
        const isCash = Boolean(r.rank && r.cashPlaces && r.rank <= r.cashPlaces);
        const isRewarded = Boolean(isCash || (r.rank && r.paidPlaces && r.rank <= r.paidPlaces));
        return {
          leaderboardName: r.leaderboardName,
          score: r.score,
          rank: r.rank,
          totalEntries: r.totalEntries,
          topPct,
          statusLabel: isCash ? "IN THE CASH" : isRewarded ? "IN REWARDS" : "PLAYED",
          isRewarded,
          isCash,
        };
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

    return {
      fixtureSlug: weekSummary.fixtureSlug,
      fixtureLabel: formatFixtureLabel(weekSummary.fixtureSlug),
      username,
      rarity,
      totalPoints: weekSummary.totalScore,
      lineupCount: weekSummary.lineups,
      rewardedCount: weekSummary.rewarded,
      cashCount: weekSummary.cash,
      bestTopPct: weekSummary.bestTopPct,
      currentRewardStreak: pulse?.currentRewardStreak ?? (weekSummary.rewarded > 0 ? 1 : 0),
      bestLineup: lineups[0] ?? null,
      lineups: lineups.slice(0, 4),
      generatedDateLabel: dateLabel,
    };
  }

  return null;
}

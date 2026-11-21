import type { CurrentLineupEntry, LeaderboardBenchmark, PageLineup, ProProgressRecord } from "../shared/types";

/** "nba-21-23-nov-2026-nba_limited_in_season_champion" -> "nba-21-23-nov-2026". */
export function fixtureFromLeaderboard(leaderboardSlug: string): string {
  const i = leaderboardSlug.indexOf("-nba_");
  return i > 0 ? leaderboardSlug.slice(0, i) : leaderboardSlug;
}

/** "nba-21-23-nov-2026-nba_limited_in_season_contender" -> "nba_limited_in_season_contender". */
export function leaderboardKind(leaderboardSlug: string): string {
  const i = leaderboardSlug.indexOf("-nba_");
  return i > 0 ? leaderboardSlug.slice(i + 1) : leaderboardSlug;
}

/**
 * Benchmark for a leaderboard: the exact one, else the same competition from the last closed
 * Game Week (slugs change every week), with its paid / cash places scaled to this field size.
 */
export function benchmarkFor(
  leaderboardSlug: string,
  benchmarks: LeaderboardBenchmark[],
  entries: number | null,
): { displayName: string | null; paid: number | null; cash: number | null; paidCutoffScore: number | null } {
  const exact = benchmarks.find((b) => b.leaderboardSlug === leaderboardSlug);
  const b = exact ?? benchmarks.find((x) => leaderboardKind(x.leaderboardSlug) === leaderboardKind(leaderboardSlug));
  if (!b) return { displayName: null, paid: null, cash: null, paidCutoffScore: null };
  const scale = !exact && entries && b.totalEntries > 0 ? entries / b.totalEntries : 1;
  const cash = (b as { cashPlaces?: number | null }).cashPlaces ?? null;
  return {
    displayName: b.displayName,
    paid: Math.round(b.paidPlaces * scale) || null,
    cash: cash ? Math.max(1, Math.round(cash * scale)) : null,
    paidCutoffScore: b.paidCutoffScore,
  };
}

export type ProLineupStatus = "cash" | "rewarded" | "outside" | "unranked";

export interface ProLineupProgress {
  lineupId: string;
  name: string;
  leaderboardName: string;
  rank: number | null;
  score: number | null;
  totalEntries: number | null;
  status: ProLineupStatus;
  /** Top x% of the leaderboard. */
  topPct: number | null;
  /** Ranks to climb into the paid places (0 when inside). */
  ranksToReward: number | null;
  /** Points to the last paid score of a closed GW, when known. */
  pointsToRewardCut: number | null;
}

function statusOf(rank: number | null, paid: number | null, cash: number | null): ProLineupStatus {
  if (rank === null || rank <= 0) return "unranked";
  if (cash && rank <= cash) return "cash";
  if (paid && rank <= paid) return "rewarded";
  return "outside";
}

/** Live standing of each open Pro lineup against its leaderboard's reward and cash places. */
export function summarizeProProgress(
  lineups: CurrentLineupEntry[],
  benchmarks: LeaderboardBenchmark[],
): ProLineupProgress[] {
  return lineups
    .filter((l) => l.leaderboardSlug && !l.draft)
    .map((l) => {
      const b = benchmarks.find((x) => x.leaderboardSlug === l.leaderboardSlug);
      const rank = l.rank ?? null;
      const entries = b?.totalEntries ?? null;
      const paid = b?.paidPlaces ?? null;
      const status = statusOf(rank, paid, b?.cashPlaces ?? null);
      return {
        lineupId: l.id,
        name: l.name,
        leaderboardName: b?.displayName ?? l.leaderboardName,
        rank,
        score: l.score ?? null,
        totalEntries: entries,
        status,
        topPct: rank && entries ? Math.max(0.1, Math.round((rank / entries) * 1000) / 10) : null,
        ranksToReward: rank && paid ? Math.max(0, rank - paid) : null,
        pointsToRewardCut:
          l.score != null && b?.paidCutoffScore != null ? Math.max(0, Math.round((b.paidCutoffScore - l.score) * 10) / 10) : null,
      };
    })
    .sort((a, b) => (a.topPct ?? 999) - (b.topPct ?? 999));
}

/** Upserts the latest standings into the local history (newest 300 records kept). */
export function mergeProProgressHistory(
  history: ProProgressRecord[],
  lineups: CurrentLineupEntry[],
  benchmarks: LeaderboardBenchmark[],
  nowMs: number,
): ProProgressRecord[] {
  const byId = new Map(history.map((r) => [r.lineupId, r]));
  for (const l of lineups) {
    if (!l.leaderboardSlug || l.draft || l.source === "dom") continue;
    const b = benchmarks.find((x) => x.leaderboardSlug === l.leaderboardSlug);
    const prev = byId.get(l.id);
    const bm = benchmarkFor(l.leaderboardSlug, benchmarks, l.totalEntries ?? b?.totalEntries ?? prev?.totalEntries ?? null);
    byId.set(l.id, {
      lineupId: l.id,
      fixtureSlug: b?.fixtureSlug ?? fixtureFromLeaderboard(l.leaderboardSlug),
      leaderboardSlug: l.leaderboardSlug,
      leaderboardName: b?.displayName ?? l.leaderboardName,
      rank: l.rank ?? prev?.rank ?? null,
      score: l.score ?? prev?.score ?? null,
      totalEntries: l.totalEntries ?? b?.totalEntries ?? prev?.totalEntries ?? null,
      paidPlaces: bm.paid ?? prev?.paidPlaces ?? null,
      cashPlaces: bm.cash ?? prev?.cashPlaces ?? null,
      updatedAt: nowMs,
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 300);
}

export interface ProGameWeekSummary {
  fixtureSlug: string;
  lineups: number;
  rewarded: number;
  cash: number;
  bestTopPct: number | null;
  totalScore: number;
}

/** Per Game Week: lineups played, how many finished in rewards / cash, best placement. */
export function summarizeProHistory(history: ProProgressRecord[]): ProGameWeekSummary[] {
  const byFixture = new Map<string, ProProgressRecord[]>();
  for (const r of history) {
    const list = byFixture.get(r.fixtureSlug);
    if (list) list.push(r);
    else byFixture.set(r.fixtureSlug, [r]);
  }
  return Array.from(byFixture.entries())
    .map(([fixtureSlug, recs]) => {
      const pcts = recs
        .filter((r) => r.rank && r.totalEntries)
        .map((r) => Math.max(0.1, Math.round(((r.rank as number) / (r.totalEntries as number)) * 1000) / 10));
      return {
        fixtureSlug,
        lineups: recs.length,
        rewarded: recs.filter((r) => r.rank && r.paidPlaces && r.rank <= r.paidPlaces).length,
        cash: recs.filter((r) => r.rank && r.cashPlaces && r.rank <= r.cashPlaces).length,
        bestTopPct: pcts.length ? Math.min(...pcts) : null,
        totalScore: Math.round(recs.reduce((s, r) => s + (r.score ?? 0), 0) * 10) / 10,
      };
    })
    .sort((a, b) => {
      const ta = Math.max(...history.filter((r) => r.fixtureSlug === a.fixtureSlug).map((r) => r.updatedAt));
      const tb = Math.max(...history.filter((r) => r.fixtureSlug === b.fixtureSlug).map((r) => r.updatedAt));
      return tb - ta;
    });
}

export interface PageLineupRow extends ProLineupProgress {
  liveProjectedRank: number | null;
  playerNames: string[];
}

export interface PageGameWeekGroup {
  fixtureSlug: string;
  fixtureName: string;
  /** live = games running, upcoming = before cutoff (still editable). */
  phase: "live" | "upcoming" | "finished";
  cutOffDate: string | null;
  rows: PageLineupRow[];
}

/** Groups the manager's page lineups by Game Week (live first) with rank and reward status. */
export function summarizePageLineups(lineups: PageLineup[], benchmarks: LeaderboardBenchmark[]): PageGameWeekGroup[] {
  const groups = new Map<string, PageGameWeekGroup>();
  for (const l of lineups) {
    const phase: PageGameWeekGroup["phase"] =
      l.fixtureState === "opened" ? "upcoming" : l.fixtureState === "closed" ? "finished" : "live";
    let g = groups.get(l.fixtureSlug);
    if (!g) {
      g = { fixtureSlug: l.fixtureSlug, fixtureName: l.fixtureName || l.fixtureSlug.replace(/^nba-/, ""), phase, cutOffDate: l.cutOffDate, rows: [] };
      groups.set(l.fixtureSlug, g);
    }
    const entries = l.totalEntries;
    const b = benchmarkFor(l.leaderboardSlug, benchmarks, entries);
    const rank = phase === "upcoming" ? null : l.rank;
    g.rows.push({
      lineupId: l.id,
      name: l.name,
      leaderboardName: l.leaderboardName || b.displayName || "Sorare Pro",
      rank,
      score: l.score != null ? Math.round(l.score * 10) / 10 : null,
      totalEntries: entries,
      status: statusOf(rank, b.paid, b.cash),
      topPct: rank && entries ? Math.max(0.1, Math.round((rank / entries) * 1000) / 10) : null,
      ranksToReward: rank && b.paid ? Math.max(0, rank - b.paid) : null,
      pointsToRewardCut:
        l.score != null && b.paidCutoffScore != null ? Math.max(0, Math.round((b.paidCutoffScore - l.score) * 10) / 10) : null,
      liveProjectedRank: phase === "live" ? l.liveProjectedRank : null,
      playerNames: l.playerNames,
    });
  }
  const order = { live: 0, upcoming: 1, finished: 2 } as const;
  return Array.from(groups.values())
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)) }))
    .sort((a, b) => order[a.phase] - order[b.phase]);
}

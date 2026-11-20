import { normalizePlayerName } from "../calculators/lineupOptimizerMath";
import {
  deriveGameOdds,
  hasBackToBackDates,
  isInGameWeekRange,
  type TeamGameOdds,
} from "../calculators/vegasMath";
import type {
  DailySlateGame,
  PlayerSeasonStats,
  InjuryReportEntry,
  InjuryStatus,
  TeamSlateSchedule,
} from "../shared/types";
import { getCached, setCached } from "./cache";

const ESPN_INJURIES_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";
const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

interface EspnInjuriesPayload {
  injuries?: Array<{
    displayName?: string;
    injuries?: Array<{
      status?: string;
      shortComment?: string;
      athlete?: { displayName?: string };
    }>;
  }>;
}

interface EspnScoreboardPayload {
  events?: Array<{
    date?: string;
    competitions?: Array<{
      date?: string;
      status?: {
        type?: {
          state?: "pre" | "in" | "post" | string;
          shortDetail?: string;
        };
      };
      competitors?: Array<{
        homeAway?: string;
        score?: string;
        team?: { displayName?: string; abbreviation?: string };
        records?: Array<{ summary?: string }>;
      }>;
      odds?: Array<{
        details?: string;
        overUnder?: number;
        spread?: number;
        homeTeamOdds?: { favorite?: boolean };
        awayTeamOdds?: { favorite?: boolean };
      }>;
    }>;
  }>;
}

function classifyDifficulty(score: number): "EASY" | "NEUTRAL" | "TOUGH" {
  return score <= 0.46 ? "EASY" : score >= 0.55 ? "TOUGH" : "NEUTRAL";
}

function parseWinPct(summary: string | undefined): number | null {
  if (!summary) return null;
  const m = summary.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const l = Number(m[2]);
  if (w + l <= 0) return null;
  return w / (w + l);
}

function mapInjuryStatus(raw: string): InjuryStatus {
  const upper = raw.toUpperCase();
  if (upper.includes("OUT")) return "OUT";
  if (upper.includes("DOUBT")) return "DOUBTFUL";
  if (upper.includes("QUESTION")) return "QUESTIONABLE";
  if (upper.includes("DAY")) return "DAY_TO_DAY";
  return "ACTIVE";
}

function teamDisplayToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function formatEspnDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export interface GameWeekWindow {
  /** GW cutoff (first tip-off), ISO. */
  startIso: string;
  /** GW end, ISO. */
  endIso: string;
}

/**
 * ESPN scoreboard for each calendar day in [startMs, endMs] (max 6 days), merged and de-duplicated.
 * ESPN stopped answering `dates=A-B` ranges (checked 2026-11-20: 0 events), single days still work.
 */
async function fetchScoreboardDays(startMs: number, endMs: number): Promise<EspnScoreboardPayload | null> {
  const days: string[] = [];
  for (let t = startMs; t <= endMs && days.length < 6; t += 86_400_000) {
    const d = formatEspnDate(new Date(t));
    if (!days.includes(d)) days.push(d);
  }
  const endDay = formatEspnDate(new Date(endMs));
  if (!days.includes(endDay) && days.length < 6) days.push(endDay);

  const results = await Promise.allSettled(
    days.map((d) =>
      fetch(`${ESPN_SCOREBOARD_URL}?dates=${d}&limit=100`, {
        credentials: "omit",
        signal: AbortSignal.timeout(12_000),
      }).then((r) => (r.ok ? (r.json() as Promise<EspnScoreboardPayload>) : null)),
    ),
  );
  const seen = new Set<string>();
  const events: NonNullable<EspnScoreboardPayload["events"]> = [];
  let anyOk = false;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    anyOk = true;
    for (const ev of r.value.events ?? []) {
      const comp = ev.competitions?.[0];
      const key = `${comp?.date ?? ev.date}|${(comp?.competitors ?? []).map((c) => c.team?.displayName ?? "").join("|")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
  }
  return anyOk ? { events } : null;
}

function slateRangeMs(window?: GameWeekWindow | null): [number, number] {
  const startMs = window ? Date.parse(window.startIso) : Number.NaN;
  const endMs = window ? Date.parse(window.endIso) : Number.NaN;
  // ESPN dates are US calendar days, so pad the UTC window by 12h on the left.
  const start = Number.isFinite(startMs) ? startMs - 12 * 3_600_000 : Date.now();
  const end = Number.isFinite(endMs) ? endMs : start + 3 * 86_400_000;
  return [start, end];
}

/**
 * Fetches live NBA injuries & 4-day Gameweek scoreboard matchups from ESPN's unauthenticated JSON endpoints
 * (cached 10 minutes in chrome.storage.local, zero Sorare API impact).
 */
export async function fetchExternalNbaContext(gwWindow?: GameWeekWindow | null): Promise<{
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  scheduleByTeam: Record<string, TeamSlateSchedule>;
}> {
  const cacheKey = `espn_nba_context_v6:${gwWindow ? `${gwWindow.startIso}_${gwWindow.endIso}` : "next4d"}`;
  const cached = await getCached<{
    injuriesByName: Record<string, InjuryReportEntry>;
    gamesPerTeam: Record<string, number>;
    scheduleByTeam: Record<string, TeamSlateSchedule>;
  }>(cacheKey);
  if (cached) {
    return cached.value;
  }

  const injuriesByName: Record<string, InjuryReportEntry> = {};
  const gamesPerTeam: Record<string, number> = {};
  const accByTeam: Record<
    string,
    {
      teamName: string;
      abbr: string;
      matchups: string[];
      dates: string[];
      oppWinPcts: number[];
      oppAbbrs: string[];
      liveGames: number;
      completedGames: number;
      upcomingGames: number;
      liveClockLabel: string | null;
      odds: TeamGameOdds[];
    }
  > = {};

  const [injRes, sbRes] = await Promise.allSettled([
    fetch(ESPN_INJURIES_URL, {
      credentials: "omit",
      signal: AbortSignal.timeout(12_000),
    }).then((r) => (r.ok ? (r.json() as Promise<EspnInjuriesPayload>) : null)),
    fetchScoreboardDays(...slateRangeMs(gwWindow)),
  ]);

  let anyFeedSucceeded = false;

  if (injRes.status === "fulfilled" && injRes.value?.injuries) {
    anyFeedSucceeded = true;
    for (const team of injRes.value.injuries) {
      const teamName = team.displayName ?? "NBA";
      for (const item of team.injuries ?? []) {
        const name = item.athlete?.displayName?.trim();
        if (!name) continue;
        const normalizedName = normalizePlayerName(name);
        const rawStatus =
          typeof item.status === "string" ? item.status : "Active";
        injuriesByName[normalizedName] = {
          playerName: name,
          normalizedName,
          teamName,
          status: mapInjuryStatus(rawStatus),
          rawStatus,
          comment: item.shortComment ?? "",
        };
      }
    }
  }

  if (sbRes.status === "fulfilled" && sbRes.value?.events) {
    anyFeedSucceeded = true;
    for (const ev of sbRes.value.events) {
      const eventDate = (ev.date ?? "").slice(0, 10);
      for (const comp of ev.competitions ?? []) {
        // Only games inside the Game Week count (a player may play 2+ in one GW).
        if (!isInGameWeekRange(comp.date ?? ev.date, gwWindow)) continue;
        const dateStr = (comp.date ?? eventDate).slice(0, 10);
        const o = comp.odds?.[0];
        const gameOdds = deriveGameOdds(
          o
            ? {
                overUnder: o.overUnder,
                spread: o.spread,
                homeFavorite: o.homeTeamOdds?.favorite,
                awayFavorite: o.awayTeamOdds?.favorite,
              }
            : null,
        );
        const state = comp.status?.type?.state ?? "pre";
        const shortDetail = comp.status?.type?.shortDetail?.trim() ?? null;
        const competitors = comp.competitors ?? [];
        for (let i = 0; i < competitors.length; i += 1) {
          const c = competitors[i];
          const teamName = c.team?.displayName;
          if (!teamName) continue;
          const slug = teamDisplayToSlug(teamName);
          const abbr =
            c.team?.abbreviation ?? teamName.slice(0, 3).toUpperCase();
          gamesPerTeam[slug] = (gamesPerTeam[slug] ?? 0) + 1;

          const opp = competitors.find((_, idx) => idx !== i);
          const oppAbbr =
            opp?.team?.abbreviation ??
            opp?.team?.displayName?.slice(0, 3).toUpperCase() ??
            "OPP";
          const oppWin = parseWinPct(opp?.records?.[0]?.summary);
          const prefix = c.homeAway === "away" ? "@" : "vs ";

          if (!accByTeam[slug]) {
            accByTeam[slug] = {
              teamName,
              abbr,
              matchups: [],
              dates: [],
              oppWinPcts: [],
              oppAbbrs: [],
              liveGames: 0,
              completedGames: 0,
              upcomingGames: 0,
              liveClockLabel: null,
              odds: [],
            };
          }
          if (gameOdds) {
            accByTeam[slug].odds.push(c.homeAway === "away" ? gameOdds.away : gameOdds.home);
          }
          accByTeam[slug].matchups.push(`${prefix}${oppAbbr}`);
          accByTeam[slug].oppAbbrs.push(oppAbbr);
          if (dateStr) accByTeam[slug].dates.push(dateStr);
          if (oppWin !== null) accByTeam[slug].oppWinPcts.push(oppWin);
          if (state === "in") {
            accByTeam[slug].liveGames += 1;
            if (shortDetail && !accByTeam[slug].liveClockLabel) {
              accByTeam[slug].liveClockLabel = `${prefix}${oppAbbr} ${shortDetail}`;
            }
          } else if (state === "post") {
            accByTeam[slug].completedGames += 1;
          } else {
            accByTeam[slug].upcomingGames += 1;
          }
        }
      }
    }
  }

  const scheduleByTeam: Record<string, TeamSlateSchedule> = {};
  for (const [slug, acc] of Object.entries(accByTeam)) {
    const hasBackToBack = hasBackToBackDates(acc.dates);
    const firstOdds = acc.odds[0] ?? null;
    // overUnder / spread / ITT all describe the team's first game with a posted line.
    const firstItt = firstOdds?.impliedTeamTotal ?? null;
    const avgOppWin =
      acc.oppWinPcts.length > 0
        ? acc.oppWinPcts.reduce((s, v) => s + v, 0) / acc.oppWinPcts.length
        : 0.5;
    const difficultyTag: TeamSlateSchedule["difficultyTag"] =
      avgOppWin <= 0.45 ? "EASY" : avgOppWin >= 0.56 ? "TOUGH" : "NEUTRAL";

    scheduleByTeam[slug] = {
      teamSlug: slug,
      teamName: acc.teamName,
      abbr: acc.abbr,
      games: gamesPerTeam[slug] ?? acc.matchups.length,
      matchups: acc.matchups,
      hasBackToBack,
      difficultyTag,
      // No real defence-vs-position feed yet: every position gets the opponent-strength tag.
      dvpByPos: {
        G: classifyDifficulty(avgOppWin),
        F: classifyDifficulty(avgOppWin),
        C: classifyDifficulty(avgOppWin),
      },
      overUnder: firstOdds?.overUnder ?? null,
      spread: firstOdds?.spread ?? null,
      impliedTeamTotal: firstItt,
      blowoutRisk: acc.odds.some((g) => g.blowoutRisk),
      liveGames: acc.liveGames,
      completedGames: acc.completedGames,
      upcomingGames: acc.upcomingGames,
      liveClockLabel: acc.liveClockLabel,
    };
  }

  const result = { injuriesByName, gamesPerTeam, scheduleByTeam };
  // Never poison cache for 10m if both ESPN requests failed or timed out
  if (anyFeedSucceeded) {
    await setCached(cacheKey, result);
  }
  return result;
}

/**
 * Today's and tomorrow's NBA games (ESPN scoreboard, cached 10 min) for the Daily Picker window.
 * Independent of the Game Week window: the daily slate can fall between Game Weeks.
 */
export async function fetchDailySlateGames(nowMs: number = Date.now()): Promise<DailySlateGame[]> {
  const start = new Date(nowMs - 12 * 3_600_000);
  const cacheKey = `espn_daily_slate_v2:${formatEspnDate(start)}`;
  const cached = await getCached<DailySlateGame[]>(cacheKey);
  if (cached) return cached.value;

  const payload = await fetchScoreboardDays(nowMs - 12 * 3_600_000, nowMs + 36 * 3_600_000);
  if (!payload) return [];
  const games: DailySlateGame[] = [];
  for (const ev of payload.events ?? []) {
    for (const comp of ev.competitions ?? []) {
      const tip = comp.date ?? ev.date;
      const home = comp.competitors?.find((c) => c.homeAway === "home");
      const away = comp.competitors?.find((c) => c.homeAway === "away");
      if (!tip || !home?.team?.displayName || !away?.team?.displayName) continue;
      const rawState = comp.status?.type?.state;
      games.push({
        id: `${tip}:${home.team.displayName}`,
        tipOffIso: tip,
        homeTeamSlug: teamDisplayToSlug(home.team.displayName),
        awayTeamSlug: teamDisplayToSlug(away.team.displayName),
        homeAbbr: home.team.abbreviation ?? home.team.displayName.slice(0, 3).toUpperCase(),
        awayAbbr: away.team.abbreviation ?? away.team.displayName.slice(0, 3).toUpperCase(),
        state: rawState === "in" ? "in" : rawState === "post" ? "post" : "pre",
      });
    }
  }
  await setCached(cacheKey, games);
  return games;
}

interface EspnByAthletePayload {
  categories?: Array<{ name?: string; names?: string[] }>;
  athletes?: Array<{
    athlete?: { displayName?: string };
    categories?: Array<{ name?: string; values?: number[] }>;
  }>;
}

/** ESPN season averages for every NBA player (one request, cached 10 min). */
export async function fetchPlayerSeasonStats(): Promise<Record<string, PlayerSeasonStats>> {
  const cacheKey = "espn_player_season_stats_v1";
  const cached = await getCached<Record<string, PlayerSeasonStats>>(cacheKey);
  if (cached) return cached.value;
  const res = await fetch(
    "https://site.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?limit=600&isqualified=false&sort=general.avgRebounds:desc",
    { credentials: "omit", signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) return {};
  const payload = (await res.json()) as EspnByAthletePayload;
  const indexOf = (cat: string, stat: string) =>
    (payload.categories ?? []).find((c) => c.name === cat)?.names?.indexOf(stat) ?? -1;
  const iReb = indexOf("general", "avgRebounds");
  const iMin = indexOf("general", "avgMinutes");
  const iGp = indexOf("general", "gamesPlayed");
  const iPts = indexOf("offensive", "avgPoints");
  const out: Record<string, PlayerSeasonStats> = {};
  for (const a of payload.athletes ?? []) {
    const name = a.athlete?.displayName;
    if (!name) continue;
    const vals = (cat: string) => a.categories?.find((c) => c.name === cat)?.values ?? [];
    const g = vals("general");
    const o = vals("offensive");
    out[normalizePlayerName(name)] = {
      avgRebounds: Number(g[iReb] ?? 0) || 0,
      avgMinutes: Number(g[iMin] ?? 0) || 0,
      gamesPlayed: Number(g[iGp] ?? 0) || 0,
      avgPoints: Number(o[iPts] ?? 0) || 0,
    };
  }
  await setCached(cacheKey, out);
  return out;
}

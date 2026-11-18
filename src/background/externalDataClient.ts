import { normalizePlayerName } from "../calculators/lineupOptimizerMath";
import type {
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
    }>;
  }>;
}

function classifyDifficulty(score: number): "EASY" | "NEUTRAL" | "TOUGH" {
  return score <= 0.46 ? "EASY" : score >= 0.55 ? "TOUGH" : "NEUTRAL";
}

function positionalSeedOffset(oppAbbr: string, pos: "G" | "F" | "C"): number {
  let sum = 0;
  const tag = `${oppAbbr}:${pos}`;
  for (let i = 0; i < tag.length; i += 1) {
    sum = (sum * 31 + tag.charCodeAt(i)) % 97;
  }
  return ((sum % 17) - 8) * 0.01;
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

function buildSlateScoreboardUrl(): string {
  const start = new Date();
  const end = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);
  return `${ESPN_SCOREBOARD_URL}?dates=${formatEspnDate(start)}-${formatEspnDate(end)}&limit=100`;
}

/**
 * Fetches live NBA injuries & 4-day Gameweek scoreboard matchups from ESPN's unauthenticated JSON endpoints
 * (cached 10 minutes in chrome.storage.local, zero Sorare API impact).
 */
export async function fetchExternalNbaContext(): Promise<{
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  scheduleByTeam: Record<string, TeamSlateSchedule>;
}> {
  const cacheKey = "espn_nba_context_v4";
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
    }
  > = {};

  const [injRes, sbRes] = await Promise.allSettled([
    fetch(ESPN_INJURIES_URL, {
      credentials: "omit",
      signal: AbortSignal.timeout(12_000),
    }).then((r) => (r.ok ? (r.json() as Promise<EspnInjuriesPayload>) : null)),
    fetch(buildSlateScoreboardUrl(), {
      credentials: "omit",
      signal: AbortSignal.timeout(12_000),
    }).then((r) => (r.ok ? (r.json() as Promise<EspnScoreboardPayload>) : null)),
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
        const dateStr = (comp.date ?? eventDate).slice(0, 10);
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
            };
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
    const sortedDates = [...new Set(acc.dates)].sort();
    let hasBackToBack = false;
    for (let i = 1; i < sortedDates.length; i += 1) {
      const diffMs = Date.parse(sortedDates[i]) - Date.parse(sortedDates[i - 1]);
      if (diffMs > 0 && diffMs <= 86_400_000 * 1.1) {
        hasBackToBack = true;
        break;
      }
    }
    const avgOppWin =
      acc.oppWinPcts.length > 0
        ? acc.oppWinPcts.reduce((s, v) => s + v, 0) / acc.oppWinPcts.length
        : 0.5;
    const difficultyTag: TeamSlateSchedule["difficultyTag"] =
      avgOppWin <= 0.45 ? "EASY" : avgOppWin >= 0.56 ? "TOUGH" : "NEUTRAL";

    const avgPosOffset = (pos: "G" | "F" | "C") =>
      acc.oppAbbrs.length > 0
        ? acc.oppAbbrs.reduce((s, a) => s + positionalSeedOffset(a, pos), 0) /
          acc.oppAbbrs.length
        : 0;

    scheduleByTeam[slug] = {
      teamSlug: slug,
      teamName: acc.teamName,
      abbr: acc.abbr,
      games: gamesPerTeam[slug] ?? acc.matchups.length,
      matchups: acc.matchups,
      hasBackToBack,
      difficultyTag,
      dvpByPos: {
        G: classifyDifficulty(avgOppWin + avgPosOffset("G")),
        F: classifyDifficulty(avgOppWin + avgPosOffset("F")),
        C: classifyDifficulty(avgOppWin + avgPosOffset("C")),
      },
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

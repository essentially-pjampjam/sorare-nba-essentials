import type { CurrentLineupEntry } from "../../../src/shared/types";

/**
 * Exact 3 submitted `Arena Classic Contender` lineups (Nov 21-23, 1,868 entrants)
 * observed in Screenshot 4 (`media_1795036604577_2455724c.jpg`).
 */
export const ARENA_GW10_SUBMITTED_LINEUPS: CurrentLineupEntry[] = [
  {
    id: "arena-gw10-classic-contender-1",
    name: "Arena Classic Contender #1",
    leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-1",
    leaderboardName: "Arena Classic Contender",
    draft: false,
    cardSlugs: [
      "morez-johnson-jr-2026-limited-1",
      "demar-derozan-2026-limited-1",
      "malik-monk-2026-limited-1",
      "christian-anderson-jr-2026-limited-1",
      "taylor-hendricks-2026-limited-1",
    ],
    captainCardSlug: null,
    playerNames: [
      "Morez Johnson Jr.",
      "DeMar DeRozan",
      "Malik Monk",
      "Christian Anderson Jr.",
      "Taylor Hendricks",
    ],
    source: "dom",
  },
  {
    id: "arena-gw10-classic-contender-2",
    name: "Arena Classic Contender #2",
    leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-2",
    leaderboardName: "Arena Classic Contender",
    draft: false,
    cardSlugs: [
      "aaron-gordon-2026-limited-1",
      "brook-lopez-2025-limited-1",
      "wendell-carter-jr-2026-limited-1",
      "quenton-jackson-2025-limited-1",
      "dillon-brooks-2026-limited-1",
    ],
    captainCardSlug: null,
    playerNames: [
      "Aaron Gordon",
      "Brook Lopez",
      "Wendell Carter Jr.",
      "Quenton Jackson",
      "Dillon Brooks",
    ],
    source: "dom",
  },
  {
    id: "arena-gw10-classic-contender-3",
    name: "Arena Classic Contender #3",
    leaderboardSlug: "nba-21-23-nov-2026-nba_limited_arena_75-3",
    leaderboardName: "Arena Classic Contender",
    draft: false,
    cardSlugs: [
      "jarace-walker-2026-limited-1",
      "bub-carrington-2026-limited-1",
      "allen-graves-2026-limited-1",
      "dean-wade-2025-limited-1",
      "nikola-vucevic-2025-limited-1",
    ],
    captainCardSlug: null,
    playerNames: [
      "Jarace Walker",
      "Bub Carrington",
      "Allen Graves",
      "Dean Wade",
      "Nikola Vucevic",
    ],
    source: "dom",
  },
];

/**
 * Exact 2 ongoing `Nov 17-20 • LIVE` Arena lineups observed in Screenshot 2
 * (`media_1795036576496_0540fa9a.jpg`).
 */
export const ARENA_GW9_ONGOING_LINEUPS: CurrentLineupEntry[] = [
  {
    id: "arena-gw9-in-season-contender-1",
    name: "In-Season Contender (GW9 LIVE)",
    leaderboardSlug: "nba-17-20-nov-2026-nba_limited_arena_in_season_contender",
    leaderboardName: "Arena In-Season Contender",
    draft: false,
    cardSlugs: [
      "aaron-gordon-2026-limited-1",
      "dillon-brooks-2026-limited-1",
      "wendell-carter-jr-2026-limited-1",
      "demar-derozan-2026-limited-1",
      "quenton-jackson-2025-limited-1",
    ],
    captainCardSlug: null,
    playerNames: [
      "Aaron Gordon",
      "Dillon Brooks",
      "Wendell Carter Jr.",
      "DeMar DeRozan",
      "Quenton Jackson",
    ],
    source: "api",
  },
  {
    id: "arena-gw9-classic-contender-2",
    name: "Classic Contender (GW9 LIVE)",
    leaderboardSlug: "nba-17-20-nov-2026-nba_limited_arena_classic_contender",
    leaderboardName: "Arena Classic Contender",
    draft: false,
    cardSlugs: [
      "isaac-okoro-2025-limited-1",
      "allen-graves-2026-limited-1",
      "nikola-vucevic-2025-limited-1",
      "bub-carrington-2026-limited-1",
      "malik-monk-2026-limited-1",
    ],
    captainCardSlug: null,
    playerNames: [
      "Isaac Okoro",
      "Allen Graves",
      "Nikola Vucevic",
      "Bub Carrington",
      "Malik Monk",
    ],
    source: "api",
  },
];

export function buildArenaLineupsFixture(
  source: "dom" | "api" = "dom",
  options: { includeCardSlugs?: boolean } = {},
): CurrentLineupEntry[] {
  const includeCardSlugs = options.includeCardSlugs ?? true;
  return ARENA_GW10_SUBMITTED_LINEUPS.map((entry) => ({
    ...entry,
    cardSlugs: includeCardSlugs ? [...entry.cardSlugs] : [],
    playerNames: entry.playerNames ? [...entry.playerNames] : undefined,
    source,
  }));
}

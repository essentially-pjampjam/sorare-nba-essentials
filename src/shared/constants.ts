import {
  buildArenaOngoingUrl,
  buildProPlayUrl,
  buildSetPlayUrl,
  SORARE_NBA_CARD_URL,
  SORARE_NBA_MARKET_URL,
} from "./routes";
import type {
  AppTheme,
  CardQualityTier,
  EssenceMilestoneRule,
  NbaConference,
  NbaPosition,
  Rarity,
  UserSettings,
} from "./types";

export const SORARE_GRAPHQL_URL = "https://api.sorare.com/graphql";
export { SORARE_NBA_CARD_URL, SORARE_NBA_MARKET_URL };

/**
 * Dynamically resolves the active Sorare NBA season start year (e.g. 2026 for 2026-27,
 * advancing each October when the new NBA season tips off, with 2026 as floor).
 */
export function getActiveNbaSeasonYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const computed = month >= 10 ? year : year - 1;
  return Math.max(2026, computed);
}

export function formatCardSeasonLabel(
  seasonYear: number,
  inSeasonEligible?: boolean,
): string {
  if (inSeasonEligible) {
    const nextShort = String((seasonYear + 1) % 100).padStart(2, "0");
    return `${seasonYear % 100}-${nextShort}`;
  }
  return String(seasonYear);
}

export const RESERVED_USER_SLUGS: ReadonlySet<string> = new Set([
  "nba",
  "football",
  "mlb",
  "baseball",
  "market",
  "cards",
  "club",
  "my-club",
  "my-cards",
  "my-sorare",
  "play",
  "rewards",
  "lobby",
  "invite",
  "settings",
  "help",
  "terms",
  "privacy",
  "auth",
  "login",
  "signup",
  "craft",
  "card-factory",
  "essence",
  "collections",
  "common",
  "limited",
  "rare",
  "super-rare",
  "super_rare",
  "unique",
  "custom",
  "lineups",
  "pro",
  "set",
  "arcade",
  "series",
  "squad",
  "boards",
  "cash",
  "prev",
  "ongoing",
  "leaderboards",
  "gameplay",
  "daily",
  "following",
  "search",
  "scores",
  "missions",
  "arena",
  "classic",
  "divination",
  "rookie",
  "special",
  "all",
  "packs",
  "vault",
  "shop",
  "notifications",
]);

export const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_REQUESTS_PER_MINUTE = 12; // Safe public cap while sorare.com shares your IP
export const MIN_REQUEST_SPACING_MS = 950;
export const FAST_MODE_REQUESTS_PER_MINUTE = 45; // Unlocked when user supplies their own Sorare APIKEY
export const FAST_MODE_SPACING_MS = 220;
export const COOLDOWN_429_MS = 65_000;
export const CRAFT_THRESHOLD_DEFAULT = 1000;
export const AUTO_PRICE_TOP_N = 0;

export const QUALITY_TIERS: CardQualityTier[] = [
  "TIER_0",
  "TIER_1",
  "TIER_2",
  "TIER_3",
  "TIER_4",
  "TIER_5",
];

export const QUALITY_TIER_META: Record<
  CardQualityTier,
  { label: string; shortLabel: string; rank: number; badgeClass: string }
> = {
  TIER_0: {
    label: "Tier 0 (Star)",
    shortLabel: "T0",
    rank: 0,
    badgeClass: "border-amber-400/50 bg-amber-400/20 text-amber-200",
  },
  TIER_1: {
    label: "Tier 1",
    shortLabel: "T1",
    rank: 1,
    badgeClass: "border-emerald-400/45 bg-emerald-500/15 text-emerald-200",
  },
  TIER_2: {
    label: "Tier 2",
    shortLabel: "T2",
    rank: 2,
    badgeClass: "border-sky-400/45 bg-sky-500/15 text-sky-200",
  },
  TIER_3: {
    label: "Tier 3",
    shortLabel: "T3",
    rank: 3,
    badgeClass: "border-indigo-400/40 bg-indigo-500/15 text-indigo-200",
  },
  TIER_4: {
    label: "Tier 4",
    shortLabel: "T4",
    rank: 4,
    badgeClass: "border-slate-600 bg-slate-800/70 text-slate-300",
  },
  TIER_5: {
    label: "Tier 5",
    shortLabel: "T5",
    rank: 5,
    badgeClass: "border-slate-700 bg-slate-900 text-slate-400",
  },
};

export const NBA_POSITION_LABELS: Record<NbaPosition, string> = {
  basketball_guard: "G",
  basketball_forward: "F",
  basketball_center: "C",
};

export const NBA_TEAM_CONFERENCE: Record<string, NbaConference> = {
  "atlanta-hawks": "EAST",
  "boston-celtics": "EAST",
  "brooklyn-nets": "EAST",
  "charlotte-hornets": "EAST",
  "chicago-bulls": "EAST",
  "cleveland-cavaliers": "EAST",
  "detroit-pistons": "EAST",
  "indiana-pacers": "EAST",
  "miami-heat": "EAST",
  "milwaukee-bucks": "EAST",
  "new-york-knicks": "EAST",
  "orlando-magic": "EAST",
  "philadelphia-76ers": "EAST",
  "toronto-raptors": "EAST",
  "washington-wizards": "EAST",
  "dallas-mavericks": "WEST",
  "denver-nuggets": "WEST",
  "golden-state-warriors": "WEST",
  "houston-rockets": "WEST",
  "la-clippers": "WEST",
  "los-angeles-clippers": "WEST",
  "los-angeles-lakers": "WEST",
  "memphis-grizzlies": "WEST",
  "minnesota-timberwolves": "WEST",
  "new-orleans-pelicans": "WEST",
  "oklahoma-city-thunder": "WEST",
  "phoenix-suns": "WEST",
  "portland-trail-blazers": "WEST",
  "sacramento-kings": "WEST",
  "san-antonio-spurs": "WEST",
  "utah-jazz": "WEST",
};

export const NBA_TEAM_META: Record<string, { abbr: string; color: string }> = {
  "atlanta-hawks": { abbr: "ATL", color: "#E03A3E" },
  "boston-celtics": { abbr: "BOS", color: "#008348" },
  "brooklyn-nets": { abbr: "BKN", color: "#94A3B8" },
  "charlotte-hornets": { abbr: "CHA", color: "#00788C" },
  "chicago-bulls": { abbr: "CHI", color: "#CE1141" },
  "cleveland-cavaliers": { abbr: "CLE", color: "#860038" },
  "dallas-mavericks": { abbr: "DAL", color: "#00538C" },
  "denver-nuggets": { abbr: "DEN", color: "#FEC524" },
  "detroit-pistons": { abbr: "DET", color: "#C8102E" },
  "golden-state-warriors": { abbr: "GSW", color: "#1D428A" },
  "houston-rockets": { abbr: "HOU", color: "#CE1141" },
  "indiana-pacers": { abbr: "IND", color: "#FDBB30" },
  "la-clippers": { abbr: "LAC", color: "#C8102E" },
  "los-angeles-clippers": { abbr: "LAC", color: "#C8102E" },
  "los-angeles-lakers": { abbr: "LAL", color: "#552583" },
  "memphis-grizzlies": { abbr: "MEM", color: "#5D76A9" },
  "miami-heat": { abbr: "MIA", color: "#98002E" },
  "milwaukee-bucks": { abbr: "MIL", color: "#00471B" },
  "minnesota-timberwolves": { abbr: "MIN", color: "#236192" },
  "new-orleans-pelicans": { abbr: "NOP", color: "#0C2340" },
  "new-york-knicks": { abbr: "NYK", color: "#F58426" },
  "oklahoma-city-thunder": { abbr: "OKC", color: "#007AC1" },
  "orlando-magic": { abbr: "ORL", color: "#0077C0" },
  "philadelphia-76ers": { abbr: "PHI", color: "#006BB6" },
  "phoenix-suns": { abbr: "PHX", color: "#E56020" },
  "portland-trail-blazers": { abbr: "POR", color: "#E03A3E" },
  "sacramento-kings": { abbr: "SAC", color: "#5A2D81" },
  "san-antonio-spurs": { abbr: "SAS", color: "#94A3B8" },
  "toronto-raptors": { abbr: "TOR", color: "#CE1141" },
  "utah-jazz": { abbr: "UTA", color: "#4E2A84" },
  "washington-wizards": { abbr: "WAS", color: "#002B5C" },
};

export const NBA_26_CONF_FINALS_TEAMS = new Set<string>([
  "oklahoma-city-thunder",
  "san-antonio-spurs",
  "cleveland-cavaliers",
  "new-york-knicks",
]);

/** 2025-26 Playoff teams (excluding the 4 Conference Finals teams above) */
export const NBA_26_PLAYOFF_TEAMS = new Set<string>([
  "detroit-pistons",
  "boston-celtics",
  "orlando-magic",
  "philadelphia-76ers",
  "atlanta-hawks",
  "toronto-raptors",
  "denver-nuggets",
  "phoenix-suns",
  "minnesota-timberwolves",
  "los-angeles-lakers",
  "houston-rockets",
  "portland-trail-blazers",
]);

/** Exact 30 prospects eligible for Sorare's Draft 26' League Quest */
export const NBA_26_DRAFT_TOP_30_SLUGS: ReadonlySet<string> = new Set<string>([
  "ebuka-okorie-20070410",
  "karim-lopez-20070412",
  "zuby-ejiofor-20040420",
  "allen-graves-20060728",
  "christian-anderson-jr-20060402",
  "hannes-steinbach-20060501",
  "labaron-philon-jr-20051124",
  "chris-cenac-jr-20070201",
  "alex-karaban-20021111",
  "joshua-jefferson-20031121",
  "aday-mara-20050407",
  "aj-dybantsa-20070129",
  "bennett-stirtz-20031003",
  "brayden-burries-20050918",
  "caleb-wilson-20060718",
  "cameron-boozer-20070718",
  "cameron-carr-20041121",
  "dailyn-swain-20050715",
  "darius-acuff-20061116",
  "darryn-peterson-20070117",
  "jayden-quaintance-20070711",
  "keaton-wagler-20070203",
  "kingston-flemings-20070103",
  "koa-peat-20070120",
  "mikel-brown-20060403",
  "morez-johnson-20060125",
  "nate-ament-20061210",
  "sergio-de-larrea-20051104",
  "tarris-reed-jr-20030805",
  "yaxel-lendeborg-20020930",
]);

export const RARITIES: Rarity[] = ["limited", "rare", "super_rare", "unique"];

export const RARITY_META: Record<
  Rarity,
  { label: string; shortLabel: string; badgeClass: string; accentClass: string; ringClass: string }
> = {
  limited: {
    label: "Limited",
    shortLabel: "LIM",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/35",
    accentClass: "text-amber-400",
    ringClass: "border-amber-500/50",
  },
  rare: {
    label: "Rare",
    shortLabel: "RAR",
    badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/35",
    accentClass: "text-rose-400",
    ringClass: "border-rose-500/50",
  },
  super_rare: {
    label: "Super Rare",
    shortLabel: "SR",
    badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/35",
    accentClass: "text-sky-400",
    ringClass: "border-sky-500/50",
  },
  unique: {
    label: "Unique",
    shortLabel: "UNQ",
    badgeClass: "bg-violet-500/15 text-violet-300 border-violet-500/35",
    accentClass: "text-violet-400",
    ringClass: "border-violet-500/50",
  },
};

/**
 * Optional custom Team Collection Essence milestone rules per rarity.
 * Empty by default because Sorare NBA 2026-27 Team Collections award Lineup Scoring
 * Bonus % (+1% to +5%) and +2,000E only upon Full Collection (tracked in League Quests).
 * Pre-2.6.4 untouched preset IDs are listed in LEGACY_TEAM_PRESET_RULE_IDS for migration.
 */
export const LEGACY_TEAM_PRESET_RULE_IDS: ReadonlySet<string> = new Set([
  "lim-5",
  "lim-10",
  "lim-15",
  "rar-5",
  "rar-10",
  "rar-15",
  "sr-3",
  "sr-6",
  "sr-10",
  "unq-2",
  "unq-5",
  "unq-8",
]);

export const DEFAULT_MILESTONE_RULES: Record<Rarity, EssenceMilestoneRule[]> = {
  limited: [],
  rare: [],
  super_rare: [],
  unique: [],
};

export const APP_THEMES: Array<{
  id: AppTheme;
  label: string;
  swatch: string;
  description: string;
}> = [
  {
    id: "obsidian_gray",
    label: "Obsidian Gray (Default)",
    swatch: "#17191d",
    description: "Deep matte dark charcoal with subtle gold glow",
  },
  {
    id: "midnight_navy",
    label: "Midnight Navy",
    swatch: "#111726",
    description: "Classic Sorare deep slate blue",
  },
  {
    id: "court_emerald",
    label: "Court Emerald",
    swatch: "#111a16",
    description: "Charcoal pine with emerald hardwood glow",
  },
  {
    id: "royal_amethyst",
    label: "Amethyst Noir",
    swatch: "#171321",
    description: "Deep onyx with violet spotlight accents",
  },
  {
    id: "crimson_arena",
    label: "Arena Crimson",
    swatch: "#1b1316",
    description: "Carbon gray with NBA crimson highlights",
  },
];

export const DEFAULT_SETTINGS: UserSettings = {
  username: "",
  usernameLockedByUser: false,
  sorareApiKey: "",
  apiKeyPromptDismissed: false,
  theme: "obsidian_gray",
  density: "cozy",
  essenceByRarity: {
    limited: 0,
    rare: 0,
    super_rare: 0,
    unique: 0,
  },
  walletBalance: {
    cashAmount: null,
    cashSymbol: "€",
    ethAmount: null,
    cluesCount: null,
    updatedAt: null,
  },
  autoShowInPageWizards: true,
  watchlist: [],
  watchlistAlerts: [],
  currency: "USD",
  selectedRarity: "limited",
  craftThreshold: CRAFT_THRESHOLD_DEFAULT,
  inSeasonOnly: true,
  craftReadyOnly: false,
  autoOpenOnCraft: true,
  autoOpenOnSorare: false,
  autoPriceTopN: AUTO_PRICE_TOP_N,
  projectionSource: "blended_smart",
  customProjectionsRaw: "",
  milestoneRulesByRarity: DEFAULT_MILESTONE_RULES,
};

export interface LeagueEssenceMissionDef {
  id: string;
  name: string;
  description: string;
  nextStepTarget: number;
  essenceReward: number;
  firstOwnerOnly: boolean;
  /** Optional team slugs restricting eligibility (e.g. Conference Finals teams) */
  eligibleTeamSlugs?: string[];
}

export const LEAGUE_ESSENCE_MISSIONS: LeagueEssenceMissionDef[] = [
  {
    id: "draft-26",
    name: "Draft 26'",
    description: "Collect first-owner cards from the top 30 of this season's draft.",
    nextStepTarget: 12,
    essenceReward: 500,
    firstOwnerOnly: true,
  },
  {
    id: "non-playoffs-26",
    name: "26' Non Playoffs",
    description: "First-owner players from teams outside the 26' NBA Playoffs.",
    nextStepTarget: 20,
    essenceReward: 1000,
    firstOwnerOnly: true,
  },
  {
    id: "conf-finals-26",
    name: "26' Conference Finals",
    description: "First-owner players from OKC, SAS, CLE & NYK.",
    nextStepTarget: 10,
    essenceReward: 500,
    firstOwnerOnly: true,
    eligibleTeamSlugs: [
      "oklahoma-city-thunder",
      "san-antonio-spurs",
      "cleveland-cavaliers",
      "new-york-knicks",
    ],
  },
  {
    id: "playoffs-26",
    name: "26' Playoffs",
    description: "First-owner players from 26' Playoff teams (Conf Finals excl.).",
    nextStepTarget: 25,
    essenceReward: 500,
    firstOwnerOnly: true,
  },
  {
    id: "full-collection",
    name: "Full Collection",
    description: "Collect all available players in a single NBA team.",
    nextStepTarget: 1,
    essenceReward: 2000,
    firstOwnerOnly: false,
  },
];

export const ESSENCE_EARNING_SOURCES = [
  {
    id: "league-missions",
    label: "League Collect Missions",
    detail: "Draft 26', Playoffs, Non-Playoffs, Conf Finals, Full Team (First-Owner)",
  },
  {
    id: "team-collections",
    label: "Team Collections",
    detail: "Up to 5% Lineup Bonus + Full Collection (+2,000E)",
  },
  {
    id: "set-career-board",
    label: "Set Career Board & Missions",
    detail: "Cap 120 + MVP board checkpoints & daily tasks",
  },
  {
    id: "pro-leaderboards",
    label: "Pro & Daily Pickup",
    detail: "Champion 16★, Contender 11★, Daily Pickup Cap 120+MVP",
  },
  {
    id: "scrap-duplicates",
    label: "Card Scrapping",
    detail: "Scrap spare / duplicate Set cards directly for Essence",
  },
];

export const LINEUP_FORMAT_TARGETS: Record<
  import("./types").LineupFormat,
  { essenceTarget: number; tier1Target: number; podiumTarget: number }
> = {
  champion_16: { essenceTarget: 175, tier1Target: 215, podiumTarget: 255 },
  contender_11: { essenceTarget: 105, tier1Target: 130, podiumTarget: 155 },
  arena_champion_15: { essenceTarget: 165, tier1Target: 200, podiumTarget: 240 },
  arena_contender_12: { essenceTarget: 115, tier1Target: 140, podiumTarget: 170 },
  daily_120_mvp: { essenceTarget: 135, tier1Target: 165, podiumTarget: 195 },
  uncapped: { essenceTarget: 205, tier1Target: 245, podiumTarget: 280 },
};

export interface CompetitionRoomInfo {
  id: string;
  group: "Pro Bi-Weekly" | "Pro Arena" | "Set / Arcade";
  name: string;
  capLabel: string;
  eligibility: string;
  /** Short live rules line (docs/SORARE_FACTS.md). */
  rulesSummary?: string;
  url: string;
  maxEntries?: number;
  lineupsUrl?: string;
}

export const COMPETITION_ENTRY_LIMITS = {
  proInSeasonMaxEntries: 5,
  arenaCashMaxEntries: 5,
  // Live 2026-11-19: Classic Limited boards show "0 SET / 3" (docs/SORARE_FACTS.md).
  // Rare / Super Rare / Unique values are from the handoff spec, not yet live-verified.
  proClassicMaxEntriesByRarity: {
    limited: 3,
    rare: 4,
    super_rare: 2,
    unique: 2,
  },
  hotStreakMaxEntries: 3,
  squadBestLineupsCounted: 3,
  arenaPodSize: 10,
} as const;

export const SET_ARCADE_RULES = {
  livesPerRun: 4,
  collectionBonusPctMax: 5,
  editionBoostPct: {
    standard: 0,
    shiny: 5,
    holo: 10,
  },
  dailyPickerMinScore: 20,
  dailyPickerL10Offset: 7,
  squadSalaryCap: 120,
  squadMvpFree: true,
  hotStreakDefaultTargetPts: 150,
  duplicateScrapReward: "Essence",
  cardTiers: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "TIER_4", "TIER_5"] as const,
} as const;

/**
 * Live Sorare NBA competitions (checked 2026-11-19 with the user's screenshots and the live site,
 * docs/SORARE_FACTS.md). M3+ reads rules live where the API allows; this is the display copy.
 */
export const NBA_COMPETITION_DIRECTORY: CompetitionRoomInfo[] = [
  {
    id: "pro-in-season-champ",
    group: "Pro Bi-Weekly",
    name: "In-Season Champion",
    capLabel: "16★ Cap • Up to 5",
    eligibility:
      "Min 4 In-Season (2026-27) cards, max 4 per NBA team, Rare cards +10% • Up to 5 entries (0 SET / 5) • Hot Streak: Limited 240+ pts -> $5",
    rulesSummary: "16★ Cap • Min 4 In-Season • Up to 5 entries",
    url: buildProPlayUrl(),
    maxEntries: COMPETITION_ENTRY_LIMITS.proInSeasonMaxEntries,
  },
  {
    id: "pro-in-season-cont",
    group: "Pro Bi-Weekly",
    name: "In-Season Contender",
    capLabel: "11★ Cap • Up to 5",
    eligibility:
      "Min 4 In-Season cards, max 4 per NBA team • Limited / Rare / Super Rare • Up to 5 entries • Hot Streak: Limited 190+ pts -> 150 energy",
    rulesSummary: "11★ Cap • Min 4 In-Season • Up to 5 entries",
    url: buildProPlayUrl(),
    maxEntries: COMPETITION_ENTRY_LIMITS.proInSeasonMaxEntries,
  },
  {
    id: "pro-classic",
    group: "Pro Bi-Weekly",
    name: "Classic Champion & Contender",
    capLabel: "16★ / 11★ • 3 Entries",
    eligibility:
      "Any season, all rarities, max 4 per NBA team • Up to 3 entries per competition (Limited, live)",
    rulesSummary: "16★ / 11★ • Any season • 3 entries",
    url: buildProPlayUrl(),
    maxEntries: COMPETITION_ENTRY_LIMITS.proClassicMaxEntriesByRarity.limited,
  },
  {
    id: "arena-main",
    group: "Pro Arena",
    name: "Arena Rooms: Contender, Champion & Uncapped",
    capLabel: "11★ / 16★ / ∞ • Energy",
    eligibility:
      "10-manager rooms in Limited / Rare / Super Rare • Contender 11★ (75 energy), Champion 16★ (150 energy), Uncapped (200 energy)",
    rulesSummary: "11★ / 16★ / Uncapped • 10-manager rooms",
    url: buildArenaOngoingUrl(),
    lineupsUrl: buildArenaOngoingUrl(),
    maxEntries: COMPETITION_ENTRY_LIMITS.arenaCashMaxEntries,
  },
  {
    id: "arena-sub",
    group: "Pro Arena",
    name: "Arena Rooms: U23 & Veterans",
    capLabel: "U23 11★ / Vet 11★",
    eligibility: "Age-restricted 10-manager rooms (U23: 23 and under, Veterans: 30+), both 11★",
    rulesSummary: "U23 11★ • Veterans 11★",
    url: buildProPlayUrl(),
    lineupsUrl: buildArenaOngoingUrl(),
    maxEntries: COMPETITION_ENTRY_LIMITS.arenaCashMaxEntries,
  },
  {
    id: "set-arcade",
    group: "Set / Arcade",
    name: "Set Solo Mode (Arcade, incl. Hot Streak)",
    capLabel: "16★ Cap • 4 Teams • 4 Lives",
    eligibility:
      "Solo (Arcade): up to 4 teams of 5 Common cards, sum of stars 16 or less, 4 Lives; Hot Streak chapter/step ladder (e.g. 180 PTS) with rewards along the path; up to +5% Collection boost; card tiers Reserve to Icon (1-5★), duplicates scrap for Essence (Bronze pack = 1000 Essence)",
    rulesSummary: "Up to 4 Teams • 16★ Cap • 4 Lives • Hot Streak ladder",
    url: buildSetPlayUrl("arcade"),
    maxEntries: 4,
  },
  {
    id: "set-squad",
    group: "Set / Arcade",
    name: "Set Squad Mode",
    capLabel: "16★ Cap • 1 Team",
    eligibility:
      "Squad of up to 10 managers, 1 team each (16★ cap); the squad's 3 best teams must beat the stage target, failing resets to level 1",
    rulesSummary: "1 Team per manager • 16★ Cap • Squad of 10 • 3 best teams count",
    url: buildSetPlayUrl("squad"),
    maxEntries: 1,
  },
];

export const BOOSTING_GUIDE_RULES = [
  {
    id: "star-cap-pro",
    title: "2026-27 Star-Cap Scoring (No Captain in Pro)",
    tag: "Pro Rules",
    detail:
      "Bi-weekly Pro (Champion 16★, Contender 11★) and Arena Rooms (Champion 16★, Contender 11★, Uncapped, U23 11★, Veterans 11★) count each player's single best game per Game Week with no Captain multiplier. Set/Common Squad uses its own board rules.",
  },
  {
    id: "in-season-flat",
    title: "In-Season Card Bonus (+5%) + Team Collection (+1% to +5%)",
    tag: "Stackable",
    detail:
      "Current 2026-27 Pro cards carry a flat +5% In-Season score boost. Team Collections permanently add +1% to +5% to every matching team/season card you field (and Set Collection boosts up to +5% in Set mode).",
  },
  {
    id: "xp-scarcity-vault",
    title: "Card XP (+1%/Lvl), Scarcity Mix & Vault Sealing",
    tag: "Rewards Boost",
    detail:
      "Cards level 0-10 (+1% score/lvl; XP halves by 50% when sold). Mixing higher-scarcity cards or raising your Vault Level via Sealing adds % reward boosts on permanent Pro Cash & Essence leaderboards.",
  },
  {
    id: "unlisted-discipline",
    title: "Keep Core & Collection Cards Unlisted",
    tag: "Checklist",
    detail:
      "Cards listed on the market do NOT count toward Team Collection Score thresholds while listed, and selling resets half of accumulated card XP. Delist before locking lineups or checking bonuses.",
  },
];

export const SUPPORT_DONATION_INFO = {
  sorareTradeUrl: "https://sorare.com/nba/club/pjampjam",
  sorareHandle: "@pjampjam",
  githubUrl: "https://github.com/essentially-pjampjam/sorare-nba-essentials",
  feedbackUrl: "https://github.com/essentially-pjampjam/sorare-nba-essentials/issues/new",
  wallets: [
    {
      network: "EVM",
      hint: "ETH • Base • Arbitrum • Optimism • Polygon • BSC",
      address: "0x8e00Db956a70Bdca56D3f9dfFe8fE289B7458bB2",
    },
    {
      network: "Solana",
      hint: "SOL & SPL tokens",
      address: "371kYcJysMAQkMXCrMUT1QA56b1xZScbGPYh9Ye8WmRA",
    },
    {
      network: "TON",
      hint: "Toncoin / Jettons",
      address: "UQC7rfx-FGuXL0KMAYD_HwO-2G0CNyU2tnBnX_6ncobLgpCW",
    },
    {
      network: "NEAR",
      hint: "NEAR Protocol",
      address: "pjampjams-essentials.near",
    },
    {
      network: "TRON",
      hint: "TRX / TRC-20",
      address: "TNv3ytwYQPbqUN9VkBuTNFBVhtB7x57HNr",
    },
    {
      network: "Bitcoin (SegWit)",
      hint: "BTC Bech32",
      address: "bc1q8gwz25x95zjpdl9d6h4yldtasyxqtur7g32th2",
    },
  ],
};

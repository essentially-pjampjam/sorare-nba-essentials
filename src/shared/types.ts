export type Rarity = "limited" | "rare" | "super_rare" | "unique";
export type CardRarity = Rarity | "common";

export type Currency = "USD" | "EUR";

export type EssenceBalances = Record<Rarity, number>;

export interface EssenceMilestoneRule {
  id: string;
  label: string;
  /** Whether the milestone triggers at fulfilled slot count or collection score */
  kind: "slots" | "score";
  /** Threshold value (e.g., 5 slots, or 100 score, or 100% if slots) */
  threshold: number;
  /** Essence rewarded upon reaching this tier */
  essenceReward: number;
}

export interface BonusThreshold {
  threshold: number;
  bonus: number;
}

export interface CollectionRaw {
  slug: string;
  name: string;
  rarity: Rarity;
  inSeason: boolean;
  teamName: string | null;
  teamSlug: string | null;
  bonusThresholds: BonusThreshold[];
  score: number;
  complete: boolean;
  fulfilledSlotsCount: number;
  slotsCount: number;
  ownedPlayersCount: number;
  totalPlayersCount: number;
  bonus: number;
}

export interface MissingSlot {
  slotId: string;
  collectionSlug: string;
  collectionName: string;
  playerSlug: string;
  playerName: string;
  teamName: string | null;
  teamSlug: string | null;
  rarity: Rarity;
  seasonYear: number | null;
  displayedRequirements: string | null;
  transferMarketFilters: string;
}

export interface CardMarketPrice {
  key: string;
  playerSlug: string;
  rarity: Rarity;
  seasonYear: number | null;
  instantBuyCents: number | null;
  instantBuyCurrency: Currency | null;
  instantBuyCardSlug: string | null;
  instantBuyUrl: string | null;
  auctionBidCents: number | null;
  auctionCurrency: Currency | null;
  auctionCardSlug: string | null;
  auctionEndDate: string | null;
  auctionBidsCount: number | null;
  auctionUrl: string | null;
  excludedBundlesCount: number;
  fetchedAt: number;
}

export interface MissingPlayerOpportunity {
  slot: MissingSlot;
  market: CardMarketPrice | null;
  /** Primary cost used for Instant Buy ranking (null if unlisted for instant buy) */
  instantBuyCents: number | null;
  /** Optional lowest active non-bundle auction bid in cents */
  auctionBidCents: number | null;
  /** Best actionable market URL for the player/card */
  targetUrl: string;
  /** Number of incomplete collections in this scan that need this player */
  overlapCount: number;
  overlappingCollections: Array<{ slug: string; name: string }>;
}

export interface NextEssenceMilestone {
  label: string;
  kind: "slots" | "score";
  targetValue: number;
  currentValue: number;
  cardsNeeded: number;
  essenceRewarded: number;
  /** Sum of the cheapest `cardsNeeded` missing players with Instant Buy prices */
  totalCostCents: number | null;
  /** Total Cost / Essence Rewarded (in cents per 1 Essence) */
  costPerEssenceCents: number | null;
  /** Preview cost if lowest active non-bundle auctions are used when cheaper than Instant Buy */
  auctionAssistedCostCents: number | null;
  rankedShoppingList: MissingPlayerOpportunity[];
  pricedInstantBuyCount: number;
  missingCount: number;
  /** True when this milestone's Essence reward bridges the user's remaining gap to 1,000 */
  isCraftReadyBridge: boolean;
  source: "live_session" | "preset";
}

export interface CollectionAnalysis {
  collection: CollectionRaw;
  nextBonusThreshold: {
    threshold: number;
    bonus: number;
    scoreNeeded: number;
    instantBuyCardsNeeded: number;
    firstOwnerCardsNeeded: number;
    totalCostCents?: number | null;
    auctionAssistedCostCents?: number | null;
  } | null;
  nextEssenceMilestone: NextEssenceMilestone | null;
  totalEssenceRemaining: number;
  missingSlotsCount: number;
  opportunities?: MissingPlayerOpportunity[];
  cheapestCardCents?: number | null;
  pricedInstantBuyCount?: number;
}

export interface CardCounts {
  limited: number;
  rare: number;
  superRare: number;
  unique: number;
  total: number;
}

export interface ScanProgress {
  phase: "idle" | "collections" | "slots" | "market" | "done" | "error";
  completed: number;
  total: number;
  message: string;
}

export interface QuestCardSummary {
  slug: string;
  seasonYear: number;
  teamSlug: string | null;
  playerSlug: string;
  playerName: string;
  age: number | null;
  isFirstOwner: boolean;
  cardEditionName?: string | null;
}

export interface QuestShoppingCandidate {
  playerSlug: string;
  playerName: string;
  teamName: string | null;
  teamSlug: string | null;
  priceCents: number;
  saleType: "instant_buy" | "auction";
  isPrimaryOffer?: boolean;
  isFirstOwnerEligible: boolean;
  endDate?: string | null;
  cardSlug: string | null;
  marketUrl: string;
  overlappingQuestIds: string[];
  overlappingQuestLabels: string[];
  advancesTeamCollection: boolean;
}

export interface ScanResult {
  username: string;
  rarity: Rarity;
  inSeasonOnly: boolean;
  cardCounts: CardCounts | null;
  collections: CollectionRaw[];
  missingSlotsByCollection: Record<string, MissingSlot[]>;
  marketPrices: Record<string, CardMarketPrice>;
  /** Collection slugs whose missing slots & market prices have been fetched */
  pricedCollectionSlugs: string[];
  /** Lightweight first-owner/team summary for live NBA League Quest progress */
  questCards?: QuestCardSummary[];
  liveSessionSynced: boolean;
  liveEssenceBalances?: Partial<EssenceBalances>;
  fetchedAt: number;
  fromCache: boolean;
}

export type CardQualityTier =
  | "TIER_0"
  | "TIER_1"
  | "TIER_2"
  | "TIER_3"
  | "TIER_4"
  | "TIER_5";

export type NbaPosition =
  | "basketball_guard"
  | "basketball_forward"
  | "basketball_center";

export type NbaConference = "EAST" | "WEST";

export interface CraftPoolPlayer {
  playerSlug: string;
  playerName: string;
  age: number;
  positions: NbaPosition[];
  teamName: string | null;
  teamSlug: string | null;
  conference: NbaConference | null;
  averageL10: number | null;
  qualityTier: CardQualityTier;
  availableSupply: number;
  /** Floor instant-buy price in user's selected currency cents (if hydrated) */
  floorCents: number | null;
  floorCardSlug: string | null;
  marketUrl: string;
}

export interface CraftPoolResult {
  rarity: Rarity;
  currency: Currency;
  computedAt: string | null;
  players: CraftPoolPlayer[];
  pricedSlugs: string[];
  fetchedAt: number;
  fromCache: boolean;
}

export interface CraftClueFilter {
  tiers: CardQualityTier[];
  positions: NbaPosition[];
  conference: NbaConference | "ALL";
  teamSlug: string; // "" for all
  ageMin: number | null;
  ageMax: number | null;
  minL10: number;
  excludedPlayerSlugs: string[];
  searchQuery: string;
}

export type ProjectionSource =
  | "blended_smart"
  | "sorare_projected"
  | "sorare_l10"
  | "sorare_l5"
  | "custom_csv";

export type LineupFormat =
  | "champion_16"
  | "contender_11"
  | "arena_champion_15"
  | "arena_contender_12"
  | "daily_120_mvp"
  | "uncapped";

export type LineupAgeFilter = "all" | "u23" | "veterans";

export type InjuryStatus = "ACTIVE" | "DAY_TO_DAY" | "QUESTIONABLE" | "DOUBTFUL" | "OUT";

export interface InjuryReportEntry {
  playerName: string;
  normalizedName: string;
  teamName: string;
  status: InjuryStatus;
  rawStatus: string;
  comment: string;
}

export interface GalleryCard {
  slug: string;
  rarity: CardRarity;
  seasonYear: number;
  inSeasonEligible: boolean;
  grade: number;
  powerMultiplier: number;
  pictureUrl?: string | null;
  isFirstOwner?: boolean;
  playerAge?: number | null;
  cardEditionName?: string | null;
  acquisitionType?: string | null;
  lowestAskCents?: number | null;
  lowestAskCardSlug?: string | null;
  auctionBidCents?: number | null;
  powerBreakdown?: {
    xp: number;
    season: number;
    collection: number;
    scarcity: number;
  };
  openedLineupIds?: string[];
  /** Card is sealed in the manager's Vault (locked: not sellable, tradeable or playable). */
  sealed?: boolean;
  sealedAt?: string | null;
  /** Live Sealing Points Sorare gives for sealing this card (`Card.sealableFor`). */
  sealingPoints?: number | null;
  /** When a sealed card can be unsealed again (`Card.unsealableAt`). */
  unsealableAt?: string | null;
  /** Sorare gameplay tier of the player (e.g. ROSTER); drives the live star rating. */
  gameplayTier?: string | null;
  /** "live" when starCost comes from Sorare's gameplay tier, else the L10 estimate. */
  starSource?: "live" | "estimated";
  /**
   * NBA games played this season (ESPN season stats). 0 = hasn't played this season (L10 / L5 may
   * be last season's), null / undefined = unknown.
   */
  seasonGamesPlayed?: number | null;
  teamName: string | null;
  teamSlug: string | null;
  playerSlug: string;
  playerName: string;
  positions: NbaPosition[];
  l10: number | null;
  l5: number | null;
  sorareClassicProjected: number | null;
  sorareDailyProjected: number | null;
  starCost: number;
}

export interface CurrentLineupEntry {
  id: string;
  name: string;
  leaderboardSlug: string;
  leaderboardName: string;
  draft: boolean;
  cardSlugs: string[];
  captainCardSlug: string | null;
  playerNames?: string[];
  /** Per-starter NBA team slugs aligned with cardSlugs / playerNames when known (from Apollo page cache). */
  teamSlugs?: Array<string | null>;
  source?: "api" | "dom" | "page";
  /** DOM-synced extras (from the content script parser). */
  contestKind?: "arena" | "pro";
  seasonScope?: "in_season" | "classic";
  starCap?: number | null;
  fixtureSlug?: string | null;
  /** Sorare's own lineup UUID when the page exposes it; used to update lineups in place. */
  sorareLineupId?: string | null;
  /** When a page capture was taken (ms). Page captures can go stale if edited elsewhere. */
  detectedAt?: number;
  /** Live rank / score in its leaderboard (`So5Lineup.so5Rankings`, API key only). */
  rank?: number | null;
  score?: number | null;
  /** Lineups in its leaderboard, when the source knows it (page data). */
  totalEntries?: number | null;
}

/** One lineup read from Sorare's own page data (Apollo cache) on a logged-in sorare.com tab. */
export interface PageLineup {
  id: string;
  name: string;
  leaderboardSlug: string;
  leaderboardName: string;
  fixtureSlug: string;
  /** "Game Week 10" */
  fixtureName: string;
  /** Sorare fixture state: "opened" (before cutoff), "started" (live), "closed". */
  fixtureState: string;
  cutOffDate: string | null;
  endDate: string | null;
  cardSlugs: string[];
  playerNames: string[];
  /** Per-starter NBA team slugs aligned with cardSlugs / playerNames when available in Sorare's page cache. */
  teamSlugs?: Array<string | null>;
  rank: number | null;
  liveProjectedRank: number | null;
  score: number | null;
  /** Lineups in that leaderboard. */
  totalEntries: number | null;
  canEdit: boolean;
}

export interface PageLineupSnapshot {
  userSlug: string;
  lineups: PageLineup[];
  scannedAt: number;
}

/** One Pro lineup result kept locally per Game Week for the progress tracker. */
export interface ProProgressRecord {
  lineupId: string;
  fixtureSlug: string;
  leaderboardSlug: string;
  leaderboardName: string;
  rank: number | null;
  score: number | null;
  totalEntries: number | null;
  paidPlaces: number | null;
  cashPlaces: number | null;
  updatedAt: number;
}

export interface LeaderboardBenchmark {
  fixtureSlug: string;
  fixtureName: string;
  leaderboardSlug: string;
  displayName: string;
  format: LineupFormat;
  seasonScope: "in_season" | "classic" | "arena";
  ageScope?: LineupAgeFilter;
  rarity: CardRarity;
  totalEntries: number;
  paidPlaces: number;
  rewardWinRatePct: number;
  paidCutoffScore: number | null;
  top20Score: number | null;
  top5Score: number | null;
  podiumScore: number | null;
  top1Score: number | null;
  podSize?: number;
  /** Ranks paid in cash (MonetaryRewardConfig), live from Sorare's rewardsConfig. */
  cashPlaces?: number;
  /** Score at the last cash rank (closed GW). */
  cashCutoffScore?: number | null;
  /** Best cash prize label, e.g. "$2,000". */
  topCashLabel?: string | null;
  /** Live reward tiers (cumulative ranks) for display. */
  rewardTiers?: LeaderboardRewardTier[];
}

export type RewardTierKind = "cash" | "essence" | "xp" | "other";

export interface LeaderboardRewardTier {
  fromRank: number;
  toRank: number;
  kind: RewardTierKind;
  label: string;
  /** Numeric USD cash amount for this rank tier (when kind === "cash"). */
  cashUsd?: number;
  /** Numeric Essence quantity for this rank tier (when kind === "essence"). */
  essenceQty?: number;
}

/** One NBA game on the daily slate (ESPN scoreboard, team slugs match Sorare's). */
export interface DailySlateGame {
  id: string;
  tipOffIso: string;
  homeTeamSlug: string;
  awayTeamSlug: string;
  homeAbbr: string;
  awayAbbr: string;
  state: "pre" | "in" | "post";
}

export interface DailyPickerWindow {
  /** Window start (now, or the next reset when today's games already started). */
  startIso: string;
  /** Next 07:00 UTC daily reset after the start. */
  endIso: string;
  games: DailySlateGame[];
  teamSlugs: string[];
  /** True when every game before the next reset has tipped off and this is the next day's picker. */
  rolledToNext?: boolean;
  /** Games of the current picker day that already started (picks for them are locked). */
  lockedGames?: DailySlateGame[];
}

/** ESPN season averages (statistics/byathlete). */
export interface PlayerSeasonStats {
  avgRebounds: number;
  avgMinutes: number;
  avgPoints: number;
  gamesPlayed: number;
  avgAssists?: number;
  avgSteals?: number;
  avgBlocks?: number;
  /** Season double-doubles / triple-doubles (ESPN `general.doubleDouble` / `tripleDouble`). */
  doubleDoubles?: number;
  tripleDoubles?: number;
}

export interface DailyPickerPool {
  window: DailyPickerWindow;
  /** Active players of the teams in the window (Common stand-ins). */
  rosterCards: GalleryCard[];
  /** ESPN season averages keyed by normalized player name. */
  statsByName?: Record<string, PlayerSeasonStats>;
  fetchedAt: number;
  /** Teams playing in the following daily window (after this picker's reset), for Set Solo timing. */
  laterTeamSlugs?: string[];
  /** Teams whose roster loaded / were requested (not-owned scan). */
  rosterTeamsLoaded?: number;
  rosterTeamsRequested?: number;
  /** Why the not-owned roster scan failed, if it did. */
  rosterError?: string;
}

export interface So5FixtureSummary {
  slug: string;
  displayName: string;
  cutOffDate: string;
  endDate: string;
  aasmState: string;
}

export interface TeamGameContext {
  date: string;
  matchup: string;
  impliedTeamTotal: number | null;
  spread: number | null;
  blowoutRisk: boolean;
  isBackToBack: boolean;
}

export interface TeamSlateSchedule {
  teamSlug: string;
  teamName: string;
  abbr: string;
  games: number;
  matchups: string[];
  hasBackToBack: boolean;
  difficultyTag: "EASY" | "NEUTRAL" | "TOUGH";
  dvpByPos?: {
    G: "EASY" | "NEUTRAL" | "TOUGH";
    F: "EASY" | "NEUTRAL" | "TOUGH";
    C: "EASY" | "NEUTRAL" | "TOUGH";
  };
  liveGames?: number;
  completedGames?: number;
  /** Vegas game total (ESPN odds[0].overUnder); null when no line is posted. */
  overUnder?: number | null;
  /** Spread from this team's side (negative = favourite). */
  spread?: number | null;
  /** (overUnder - spread) / 2 for this team. */
  impliedTeamTotal?: number | null;
  /** |spread| large enough that starters risk reduced 4th-quarter minutes. */
  blowoutRisk?: boolean;
  /** Per-game Vegas & B2B context for exact peak-of-GW order statistics. */
  gameContexts?: TeamGameContext[];
  upcomingGames?: number;
  liveClockLabel?: string | null;
}

/** A live daily picker task read from Sorare's missions page. */
export interface RawPickerTaskSnapshot {
  title: string;
  description: string;
  mode: string;
  slug: string;
  picks: number;
  state: string;
}

export interface PickerMissionsSnapshot {
  mode: "pro" | "set";
  tasks: RawPickerTaskSnapshot[];
  scannedAt: number;
}

export type PickerMissionsByMode = Partial<Record<"pro" | "set", PickerMissionsSnapshot>>;

/** Odds of one gameplay tier in one pack slot (`slotGameplayTierOdds`). */
export interface PackTierOdds {
  /** Sorare tier enum, e.g. ROSTER_PLUS. */
  tier: string;
  /** Probability in basis points (450 = 4.5%). */
  basisPoints: number;
}

/** A Set pack from Sorare's shop (public `market.cardPack`). */
export interface SetPackInfo {
  slug: string;
  title: string;
  price: number;
  /** COMMON_GEM or COMMON_ESSENCE. */
  currency: string;
  /** LIVE_TODAY for the daily packs of today's teams; null for the standard packs. */
  category: string | null;
  endDate: string | null;
  cardsCount: number;
  /** Per slot (#1..#4) tier odds. */
  slots: PackTierOdds[][];
  /** Special offer found on the user's Shop page (not a standard or Live Today pack). */
  special?: boolean;
  /** When the extension first saw this special pack (ms). */
  firstSeen?: number | null;
}

/** Private Set shop status read from the user's open sorare.com Shop tab. */
export interface SetShopStatus {
  /** Daily free pack claimed today (`myCommonDailyClaimTask` CLAIMED). */
  dailyPackClaimed: boolean | null;
  /** Bronze+ unlock progress (`boughtPacksCountTask`). */
  bronzePlusProgress: number | null;
  bronzePlusTarget: number | null;
  scannedAt: number;
}

export interface SetPackAdvisorData {
  packs: SetPackInfo[];
  fetchedAt: number;
  error?: string;
  shopStatus: SetShopStatus | null;
}

/** One Set Squad stage as Sorare's page loaded it (`SquadStep`). */
export interface SquadStepSnapshot {
  /** LIVE, CLAIMED, ... */
  state: string;
  target: number;
  totalLineups: number;
  /** `minimumLineupsToStartStep` (the stage counts the squad's best teams, e.g. 3). */
  minimumLineups: number;
  totalScore: number;
  lineupUsers: Array<{ slug: string; nickname: string }>;
}

/** Set Squad data read from the user's open sorare.com Squad page (logged-in, not in the public API). */
export interface SquadSnapshot {
  squadName: string;
  membersCount: number;
  maxMembersCount: number;
  captainSlug: string | null;
  /** Empty until the Squad Members page was opened in that tab. */
  members: Array<{ slug: string; nickname: string }>;
  steps: SquadStepSnapshot[];
  scannedAt: number;
}

export interface GalleryResult {
  username: string;
  cards: GalleryCard[];
  commonCards: GalleryCard[];
  fixtures: So5FixtureSummary[];
  currentLineups: CurrentLineupEntry[];
  leaderboardBenchmarks?: LeaderboardBenchmark[];
  /** The manager's own lineups read from open sorare.com Lineups tabs (live + upcoming Game Weeks). */
  pageLineups?: PageLineupSnapshot | null;
  injuriesByName: Record<string, InjuryReportEntry>;
  gamesPerTeam: Record<string, number>;
  scheduleByTeam?: Record<string, TeamSlateSchedule>;
  fetchedAt: number;
  fromCache: boolean;
}

/** seal_value = cheapest Instant Buy per player with live Sealing Points, for Vault sealing. */
export type BargainMode = "instant_value" | "primary_instant" | "ending_auctions" | "seal_value";

export type BargainSortBy =
  | "value_score"
  | "l10_desc"
  | "l5_desc"
  | "price_asc"
  | "ending_soon";

export interface BargainListing {
  cardSlug: string;
  assetId: string;
  playerSlug: string;
  playerName: string;
  teamName: string | null;
  teamSlug?: string | null;
  pictureUrl?: string | null;
  cardEditionName?: string | null;
  isPrimaryOffer?: boolean;
  isFirstOwnerEligible?: boolean;
  questLabels?: string[];
  advancesCollection?: boolean;
  positions: NbaPosition[];
  rarity: Rarity;
  seasonYear: number;
  inSeasonEligible: boolean;
  l10: number;
  l5: number | null;
  projected: number | null;
  starCost: number;
  starSource?: "live" | "estimated";
  saleType: "instant_buy" | "auction";
  priceCents: number | null;
  currency: Currency;
  endDate: string | null;
  bidsCount: number | null;
  centsPerL10: number | null;
  valueScore: number;
  marketUrl: string;
  /** Live Sealing Points Sorare gives for sealing this card (`Card.sealableFor`, public). */
  sealingPoints?: number | null;
}

export interface BargainsResult {
  rarity: Rarity;
  mode: BargainMode;
  currency: Currency;
  listings: BargainListing[];
  fetchedAt: number;
  fromCache: boolean;
}

export type AppTheme =
  | "obsidian_gray"
  | "midnight_navy"
  | "court_emerald"
  | "royal_amethyst"
  | "crimson_arena";

export type UiDensity = "cozy" | "compact";

export interface WalletBalanceInfo {
  cashAmount: number | null;
  cashSymbol: string | null;
  ethAmount: number | null;
  cluesCount: number | null;
  updatedAt: number | null;
}

export type WatchlistRuleKind =
  | "player"
  | "quest_draft_26"
  | "quest_non_playoffs"
  | "quest_conf_finals"
  | "any_first_owner";

export interface WatchlistEntry {
  id: string;
  kind: WatchlistRuleKind;
  label: string;
  playerSlug?: string;
  rarity: Rarity;
  maxPriceCents: number;
  firstOwnerOnly: boolean;
  createdAt: number;
}

export interface WatchlistAlert {
  id: string;
  ruleId: string;
  ruleLabel: string;
  cardSlug: string;
  playerSlug: string;
  playerName: string;
  rarity: Rarity;
  priceCents: number;
  currency: Currency;
  saleType: "instant_buy" | "auction";
  isPrimaryOffer: boolean;
  marketUrl: string;
  detectedAt: number;
}

export interface UserSettings {
  username: string;
  usernameLockedByUser: boolean;
  sorareApiKey: string;
  apiKeyPromptDismissed: boolean;
  theme: AppTheme;
  density?: UiDensity;
  essenceByRarity: EssenceBalances;
  /** Set (Common) Essence read from Sorare's Set pages; kept apart from Limited Essence. */
  commonEssence?: number;
  walletBalance?: WalletBalanceInfo;
  autoShowInPageWizards?: boolean;
  watchlist?: WatchlistEntry[];
  watchlistAlerts?: WatchlistAlert[];
  currency: Currency;
  selectedRarity: Rarity;
  craftThreshold: number;
  inSeasonOnly: boolean;
  craftReadyOnly: boolean;
  autoOpenOnCraft: boolean;
  autoOpenOnSorare: boolean;
  autoPriceTopN: number;
  projectionSource: ProjectionSource;
  customProjectionsRaw: string;
  milestoneRulesByRarity: Record<Rarity, EssenceMilestoneRule[]>;
  /** Local GW-cutoff reminder (chrome.alarms + notification). */
  cutoffReminderEnabled?: boolean;
  cutoffReminderMinutesBefore?: number;
  /** Master switch for the alert & price tracker. */
  alertsEnabled?: boolean;
  alertPreferences?: AlertPreferences;
  /** Local card tags (Keep / Sell / Core / Trade) keyed by cardSlug. */
  cardTags?: Record<string, CardTag>;
  /** Saved 5-card roster presets in Lineups tab. */
  savedRosters?: SavedRosterPreset[];
  /** Optional Cloudflare Worker base URL for public card tag sync. */
  cloudSyncWorkerUrl?: string;
  /** Verified Sorare username linked to cloud sync JWT. */
  cloudSyncUsername?: string;
  /** Latest GitHub release version dismissed by the user. */
  dismissedUpdateVersion?: string;
}

export type BackgroundRequest =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<UserSettings> }
  | { type: "GET_DETECTED_USERNAME" }
  | {
      type: "SCAN_COLLECTIONS";
      username: string;
      rarity: Rarity;
      currency: Currency;
      inSeasonOnly: boolean;
      forceRefresh?: boolean;
      cacheOnly?: boolean;
    }
  | {
      type: "PRICE_COLLECTION";
      username: string;
      collectionSlug: string;
      rarity: Rarity;
      currency: Currency;
      inSeasonOnly: boolean;
    }
  | {
      type: "PRICE_TOP_COLLECTIONS";
      username: string;
      collectionSlugs: string[];
      rarity: Rarity;
      currency: Currency;
      inSeasonOnly: boolean;
    }
  | {
      type: "FETCH_CRAFT_POOL";
      rarity: Rarity;
      currency: Currency;
      forceRefresh?: boolean;
    }
  | {
      type: "PRICE_CRAFT_CANDIDATES";
      rarity: Rarity;
      currency: Currency;
      playerSlugs: string[];
    }
  | {
      type: "FETCH_GALLERY_FOR_LINEUPS";
      username: string;
      forceRefresh?: boolean;
      cacheOnly?: boolean;
    }
  | {
      type: "FETCH_BARGAINS";
      rarity: Rarity;
      mode: BargainMode;
      currency: Currency;
      forceRefresh?: boolean;
      cacheOnly?: boolean;
    }
  | {
      type: "APPLY_LINEUP_HIGHLIGHT";
      playerNames: string[];
      formatLabel: string;
      projectedTotal: number;
      slots?: Array<{
        slotLabel: string;
        cardSlug: string;
        playerName: string;
        rarity: CardRarity;
        seasonYear: number;
        isCaptain: boolean;
        pictureUrl?: string | null;
        starCost?: number | null;
        projectedPts?: number | null;
        teamSlug?: string | null;
      }>;
      /** Optional verified Sorare route to open before showing the HUD (Go actions). */
      targetUrl?: string;
      /** Auto-highlight the first resolved slot once the HUD renders. */
      autoHighlightFirst?: boolean;
    }
  | { type: "CANCEL_SCAN" }
  | {
      type: "OPEN_SIDE_PANEL";
      targetTab?: "collections" | "craft" | "lineups" | "bargains" | "gallery";
      targetMode?: "pro" | "set";
      targetSubTab?: "daily" | "packs" | "overview";
    }
  | {
      type: "OPEN_DASHBOARD_TAB";
      targetTab?: "collections" | "craft" | "lineups" | "bargains" | "gallery";
    }
  | {
      type: "PRICE_GALLERY_CARDS";
      username: string;
      rarity: Rarity;
      currency: Currency;
    }
  | {
      type: "DETECTED_WALLET_FROM_CONTENT";
      wallet: Partial<WalletBalanceInfo>;
    }
  | {
      type: "SORARE_PAGE_CONTEXT";
      url: string;
      isCraftPage: boolean;
      username: string | null;
      syncDailies?: boolean;
    }
  | { type: "RELOAD_EXTENSION" }
  | { type: "OPEN_URL_IN_ACTIVE_TAB"; url: string }
  | { type: "CLEAR_CACHE" }
  | { type: "RUN_WATCHLIST_CHECK" }
  | { type: "RUN_ALERT_CHECK" }
  | { type: "SEND_TEST_ALERT_NOTIFICATION" }
  | { type: "GET_ALERT_FEED" }
  | { type: "GET_DAILY_PICKER_POOL"; refresh?: boolean }
  | { type: "SCAN_SQUAD_ACTIVITY" }
  | { type: "SYNC_PAGE_LINEUPS"; username?: string }
  | { type: "GET_PICKER_MISSIONS" }
  | { type: "GET_SEAL_DEALS"; rarity: Rarity }
  | { type: "SCAN_PICKER_MISSIONS" }
  | { type: "GET_PRO_PROGRESS_HISTORY" }
  | { type: "GET_SET_PACK_ADVISOR"; refresh?: boolean }
  | { type: "SCAN_SET_SHOP_STATUS" }
  | { type: "GET_SQUAD_SNAPSHOT" }
  | { type: "CLEAR_WATCHLIST_ALERTS" }
  | { type: "DETECTED_USERNAME_FROM_CONTENT"; username: string; sourceUrl: string }
  | {
      type: "DETECTED_ESSENCE_FROM_CONTENT";
      /** `common` = Set Essence (read on /series/ pages), never stored as Limited. */
      balances: Partial<EssenceBalances> & { common?: number };
    }
  | {
      type: "DETECTED_LINEUPS_FROM_CONTENT";
      lineups: CurrentLineupEntry[];
      /** True when the page shows only some lineups (board pages); merge instead of replace. */
      partial?: boolean;
    }
  | { type: "GET_UPDATE_STATUS"; force?: boolean }
  | { type: "DISMISS_UPDATE"; version: string }
  | { type: "GET_PORTFOLIO_SNAPSHOTS" }
  | {
      type: "RECORD_PORTFOLIO_SNAPSHOT";
      totalFloorCents: number;
      cardCount: number;
      pricedCardCount: number;
      rarity: Rarity;
      currency: Currency;
    }
  | {
      type: "FETCH_PORTFOLIO_PNL";
      username: string;
      rarity: Rarity;
      currency: Currency;
      forceRefresh?: boolean;
    }
  | {
      type: "FETCH_PLAYER_PRICE_HISTORY";
      playerSlug: string;
      rarity: Rarity;
      currency: Currency;
      forceRefresh?: boolean;
    }
  | {
      type: "CLOUD_START_AUTH";
      username: string;
      workerUrl: string;
    }
  | {
      type: "CLOUD_VERIFY_AUTH";
      username: string;
      challengeCode: string;
      workerUrl: string;
    }
  | {
      type: "CLOUD_PUSH_TAGS";
      tags: Record<string, CardTag>;
      workerUrl: string;
    }
  | {
      type: "CLOUD_FETCH_PUBLIC_TAGS";
      username: string;
      workerUrl?: string;
    }
  | { type: "CLOUD_LOGOUT" };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Countdowns & alert tracker (Features #12, #16)
// ---------------------------------------------------------------------------

export interface CountdownSnapshot {
  /** Cutoff of the next opened Game Week, or null when none is open / parseable. */
  gwCutoffIso: string | null;
  gwRemainingMs: number | null;
  gwFixtureSlug: string | null;
  dailyResetIso: string;
  dailyRemainingMs: number;
}

export type AlertEventKind =
  | "price_surge"
  | "injury_risk"
  | "bargain_match"
  | "gw_cutoff"
  | "daily_reset";

export interface AlertPreferences {
  priceSurgeEnabled: boolean;
  /** Minimum floor rise (%) over the stored baseline that counts as a surge. */
  priceSurgePctThreshold: number;
  injuryRiskEnabled: boolean;
  /** When true, only alert on injury downgrades for players sitting in open/submitted lineups. */
  injuryLineupsOnly?: boolean;
  bargainAlertEnabled: boolean;
  cutoffAlertEnabled: boolean;
  dailyResetAlertEnabled: boolean;
  browserNotificationsEnabled: boolean;
  /** Same event (dedupeKey) is not re-emitted within this window. */
  cooldownMinutes: number;
}

export interface AlertTrackerConfig {
  alertsEnabled: boolean;
  alertPreferences: AlertPreferences;
  cutoffReminderEnabled?: boolean;
  cutoffReminderMinutesBefore?: number;
}

export interface PriceBaselineRecord {
  cardSlug: string;
  playerSlug: string;
  playerName: string;
  currency: Currency;
  baselineFloorCents: number;
  recordedAtMs: number;
  updatedAtMs: number;
}

export interface TrackedAlertEvent {
  id: string;
  dedupeKey: string;
  kind: AlertEventKind;
  title: string;
  message: string;
  cardSlug?: string;
  playerSlug?: string;
  playerName?: string;
  lineupIds?: string[];
  pctChange?: number;
  baselineCents?: number;
  currentCents?: number;
  previousStatus?: InjuryStatus;
  currentStatus?: InjuryStatus;
  targetUrl?: string;
  createdAtMs: number;
  notifyBrowser: boolean;
}

export interface AlertEvaluationInputs {
  cards: GalleryCard[];
  currentLineups: CurrentLineupEntry[];
  previousInjuriesByName: Record<string, InjuryReportEntry>;
  currentInjuriesByName: Record<string, InjuryReportEntry>;
  /** Team slug -> games count in the active Game Week slate (for 0G pre-lock health check). */
  gamesPerTeam?: Record<string, number>;
  bargainListings: BargainListing[];
  watchlist: WatchlistEntry[];
  fixtures: So5FixtureSummary[];
  /** dedupeKey -> last emitted time (ms). */
  lastAlertAtByKey: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Update checker, Portfolio P&L, Wrapped, Card Tags & Cloud Sync (v2.7.5-exp18)
// ---------------------------------------------------------------------------

export interface UpdateCheckState {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  updateAvailable: boolean;
  dismissedVersion: string | null;
  checkedAtMs: number | null;
}

export type PortfolioTimeRange = "day" | "week" | "month";

export interface PortfolioSnapshot {
  /** YYYY-MM-DD (UTC) */
  date: string;
  totalFloorCents: number;
  cardCount: number;
  pricedCardCount: number;
  rarity: Rarity;
  currency: Currency;
  capturedAtMs: number;
}

export type CardAcquisitionType =
  | "auction"
  | "instant_buy"
  | "trade"
  | "reward"
  | "craft"
  | "unknown";

export interface CardOwnershipRecord {
  cardSlug: string;
  playerSlug: string;
  playerName: string;
  teamSlug: string | null;
  rarity: CardRarity;
  seasonYear: number;
  acquiredAtMs: number | null;
  acquiredPriceCents: number | null;
  acquisitionType: CardAcquisitionType;
  currentFloorCents: number | null;
  currency: Currency;
}

export interface PlayerPricePoint {
  date: string;
  timestampMs: number;
  priceCents: number;
  currency: Currency;
  source?: string;
}

export interface PortfolioPnlResult {
  username: string;
  rarity: Rarity;
  currency: Currency;
  records: CardOwnershipRecord[];
  scannedCards: number;
  fetchedAtMs: number;
}

export type WrappedMode = "regular_season" | "playoffs" | "year_end";

export type CardTag = "keep" | "sell" | "core" | "trade";

export interface SavedRosterPreset {
  id: string;
  name: string;
  formatLabel: string;
  cardSlugs: string[];
  playerNames: string[];
  projectedTotal: number;
  createdAtMs: number;
}

export interface CloudAuthChallenge {
  username: string;
  challengeCode: string;
  expiresAtIso: string;
}

export interface CloudAuthVerifyResult {
  username: string;
  verified: boolean;
}

export interface CloudPublicTagsResult {
  username: string;
  tags: Record<string, CardTag>;
  updatedAtIso: string | null;
}

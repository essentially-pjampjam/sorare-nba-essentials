import { scoreBargainListing } from "../calculators/bargainHunterMath";
import { buildMarketPriceKey } from "../calculators/collectionEssenceMath";
import { summarizeRewardTiers, type RawRankReward } from "../calculators/rewardTiersMath";
import { buildTierStarMap, resolveStarRating } from "../calculators/starRatings";
import {
  getActiveNbaSeasonYear,
  NBA_26_DRAFT_TOP_30_SLUGS,
  NBA_TEAM_CONFERENCE,
  QUALITY_TIERS,
  SORARE_GRAPHQL_URL,
  SORARE_NBA_CARD_URL,
  SORARE_NBA_MARKET_URL,
} from "../shared/constants";
import type {
  BargainListing,
  BargainMode,
  CardCounts,
  CardMarketPrice,
  CardQualityTier,
  CardRarity,
  CollectionRaw,
  CraftPoolPlayer,
  Currency,
  CurrentLineupEntry,
  GalleryCard,
  LeaderboardBenchmark,
  LeaderboardRewardTier,
  LineupAgeFilter,
  LineupFormat,
  MissingSlot,
  NbaPosition,
  QuestCardSummary,
  Rarity,
  So5FixtureSummary,
  SetPackInfo,
} from "../shared/types";
import {
  RateLimitedError,
  RateLimitQueue,
  ScanCancelledError,
} from "./rateLimitQueue";

function combineWithTimeout(signal: AbortSignal | undefined, timeoutMs = 20_000): AbortSignal {
  const timeoutSig = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSig;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSig]);
  }
  return signal;
}

const EUR_TO_USD = 1.08;
const USD_TO_EUR = 1 / EUR_TO_USD;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

interface MonetaryAmountsRaw {
  usdCents?: number | null;
  eurCents?: number | null;
  referenceCurrency?: string | null;
}

interface LiveOfferRaw {
  dealStatus?: string | null;
  endDate?: string | null;
  receiverSide?: {
    amounts?: MonetaryAmountsRaw | null;
  } | null;
}

interface AuctionRaw {
  dealStatus?: string | null;
  cancelled?: boolean | null;
  endDate?: string | null;
  currency?: string | null;
  currentPrice?: string | null;
  minNextBid?: string | null;
  bidsCount?: number | null;
  bundledAnyCards?: Array<{ slug: string }> | null;
  bestBid?: {
    amounts?: MonetaryAmountsRaw | null;
  } | null;
}

interface CardDetailsRaw {
  slug: string;
  assetId: string;
  seasonYear?: number | null;
  anyPlayer?: { slug: string; displayName: string } | null;
  livePrimaryOffer?: { price?: MonetaryAmountsRaw | null } | null;
  liveSingleSaleOffer?: LiveOfferRaw | null;
  latestEnglishAuction?: AuctionRaw | null;
}

const MAX_REALISTIC_AUCTION_REMAINING_MS = 60 * 60 * 1000;

export function extractSeasonFromFilters(
  transferMarketFilters: string,
  collectionSlug: string,
): number | null {
  if (transferMarketFilters) {
    const params = new URLSearchParams(transferMarketFilters);
    const seasonParam = params.get("season");
    if (seasonParam && /^\d{4}$/.test(seasonParam)) {
      return Number(seasonParam);
    }
  }
  const slugMatch = collectionSlug.match(/(\d{4})-\d{2}$/);
  if (slugMatch) {
    return Number(slugMatch[1]);
  }
  return null;
}

export function convertAmountsToCurrencyCents(
  amounts: MonetaryAmountsRaw | null | undefined,
  targetCurrency: Currency,
): number | null {
  if (!amounts) return null;
  if (targetCurrency === "USD") {
    if (typeof amounts.usdCents === "number" && amounts.usdCents > 0) {
      return amounts.usdCents;
    }
    if (typeof amounts.eurCents === "number" && amounts.eurCents > 0) {
      return Math.round(amounts.eurCents * EUR_TO_USD);
    }
    return null;
  }

  if (typeof amounts.eurCents === "number" && amounts.eurCents > 0) {
    return amounts.eurCents;
  }
  if (typeof amounts.usdCents === "number" && amounts.usdCents > 0) {
    return Math.round(amounts.usdCents * USD_TO_EUR);
  }
  return null;
}

function parseAuctionPriceCents(
  auction: AuctionRaw | null | undefined,
  targetCurrency: Currency,
  maxRemainingMs = MAX_REALISTIC_AUCTION_REMAINING_MS,
): number | null {
  if (!auction || auction.cancelled) return null;
  if (auction.bundledAnyCards && auction.bundledAnyCards.length > 1) return null;

  const endMs = auction.endDate ? Date.parse(auction.endDate) : NaN;
  const now = Date.now();
  if (!Number.isFinite(endMs) || endMs <= now) return null;
  if (maxRemainingMs > 0 && endMs - now > maxRemainingMs) return null;

  const fromBestBid = convertAmountsToCurrencyCents(
    auction.bestBid?.amounts,
    targetCurrency,
  );
  if (fromBestBid !== null) return fromBestBid;

  const rawPrice =
    (auction.bidsCount ?? 0) === 0 && auction.minNextBid
      ? auction.minNextBid
      : auction.currentPrice ?? auction.minNextBid;

  if (rawPrice) {
    const num = Number(rawPrice);
    if (Number.isFinite(num) && num > 0) {
      if (auction.currency === "USD" || auction.currency === "EUR") {
        const cents = Math.round(num * 100);
        if (auction.currency === targetCurrency) return cents;
        return auction.currency === "EUR"
          ? Math.round(cents * EUR_TO_USD)
          : Math.round(cents * USD_TO_EUR);
      }
      if (auction.currency === "WEI") {
        const eth = num / 1e18;
        if (Number.isFinite(eth) && eth > 0) {
          const ethCents =
            targetCurrency === "EUR" ? Math.round(eth * 166_000) : Math.round(eth * 182_500);
          return Math.max(1, ethCents);
        }
      }
    }
  }
  return null;
}

export class SorareClient {
  private readonly queue: RateLimitQueue;
  private apiKey = "";

  constructor(queue: RateLimitQueue) {
    this.queue = queue;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey.trim();
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  async postGraphQL<T>(
    query: string,
    variables: Record<string, unknown>,
    dedupeKey?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.queue.enqueue(
      async () => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
        };
        if (this.apiKey) {
          headers["APIKEY"] = this.apiKey;
        }

        const response = await fetch(SORARE_GRAPHQL_URL, {
          method: "POST",
          headers,
          // Keep extension calls isolated from the user's sorare.com browser session cookies
          credentials: "omit",
          signal: combineWithTimeout(signal, 20_000),
          body: JSON.stringify({ query, variables }),
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const retryMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
          throw new RateLimitedError(
            "Sorare rate limit (429) - paused 60s to protect your Sorare access.",
            429,
            Number.isFinite(retryMs) ? retryMs : 65_000,
          );
        }

        if (!response.ok) {
          throw new Error(`Sorare API HTTP ${response.status}`);
        }

        const json = (await response.json()) as GraphQLResponse<T>;
        if (json.errors && json.errors.length > 0 && !json.data) {
          throw new Error(json.errors.map((e) => e.message).join("; "));
        }
        if (!json.data) {
          throw new Error("Sorare API returned empty data");
        }
        return json.data;
      },
      dedupeKey,
      signal,
    );
  }

  async fetchUserCollections(
    username: string,
    rarity: Rarity,
    inSeasonOnly: boolean,
    signal?: AbortSignal,
    onPage?: (
      collectionsSoFar: CollectionRaw[],
      cardCounts: CardCounts | null,
    ) => void,
  ): Promise<{ collections: CollectionRaw[]; cardCounts: CardCounts | null }> {
    const useFast = this.hasApiKey();
    const pageSize = useFast ? 30 : 8;
    // Omit nested `bonusThresholds` in unauthenticated list queries to stay well below complexity 500
    const query = `
      query UserNbaCollections(
        $slug: String!
        $rarity: Rarity!
        $inSeasonOnly: Boolean
        $first: Int!
        $after: String
      ) {
        user(slug: $slug) {
          slug
          cardCounts(sport: NBA) {
            limited
            rare
            superRare
            unique
            total
          }
          cardCollections(
            sport: NBA
            rarities: [$rarity]
            inSeasonOnly: $inSeasonOnly
            first: $first
            after: $after
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              slug
              name
              rarity
              inSeason
              anyTeam {
                name
                slug
              }
              ${useFast ? "bonusThresholds { threshold bonus }" : ""}
              userCardCollection(forUserSlug: $slug) {
                score
                complete
                fulfilledSlotsCount
                slotsCount
                ownedPlayersCount
                totalPlayersCount
                bonus
              }
            }
          }
        }
      }
    `;

    interface CollectionsPage {
      user: {
        slug: string;
        cardCounts: CardCounts | null;
        cardCollections: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{
            slug: string;
            name: string;
            rarity: Rarity | null;
            inSeason: boolean;
            anyTeam: { name: string; slug: string } | null;
            bonusThresholds?: Array<{ threshold: number; bonus: number }>;
            userCardCollection: {
              score: number;
              complete: boolean;
              fulfilledSlotsCount: number;
              slotsCount: number;
              ownedPlayersCount: number;
              totalPlayersCount: number;
              bonus: number;
            };
          }>;
        } | null;
      } | null;
    }

    const collected: CollectionRaw[] = [];
    let cardCounts: CardCounts | null = null;
    let after: string | null = null;
    let safetyPages = 0;

    while (safetyPages < 20) {
      safetyPages += 1;
      const data: CollectionsPage = await this.postGraphQL<CollectionsPage>(
        query,
        {
          slug: username,
          rarity,
          inSeasonOnly: inSeasonOnly ? true : null,
          first: pageSize,
          after,
        },
        `collections:${username}:${rarity}:${inSeasonOnly}:${pageSize}:${after ?? "first"}`,
        signal,
      );

      if (!data.user) {
        throw new Error(`Sorare user "${username}" not found.`);
      }

      if (!cardCounts && data.user.cardCounts) {
        cardCounts = data.user.cardCounts;
      }

      const conn = data.user.cardCollections;
      if (!conn) break;

      for (const node of conn.nodes) {
        collected.push({
          slug: node.slug,
          name: node.name,
          rarity: node.rarity ?? rarity,
          inSeason: node.inSeason,
          teamName: node.anyTeam?.name ?? null,
          teamSlug: node.anyTeam?.slug ?? null,
          bonusThresholds: node.bonusThresholds ?? [],
          score: node.userCardCollection.score,
          complete: node.userCardCollection.complete,
          fulfilledSlotsCount: node.userCardCollection.fulfilledSlotsCount,
          slotsCount: node.userCardCollection.slotsCount,
          ownedPlayersCount: node.userCardCollection.ownedPlayersCount,
          totalPlayersCount: node.userCardCollection.totalPlayersCount,
          bonus: node.userCardCollection.bonus,
        });
      }

      onPage?.([...collected], cardCounts);

      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) {
        break;
      }
      after = conn.pageInfo.endCursor;
    }

    return { collections: collected, cardCounts };
  }

  async fetchMissingSlotsForCollection(
    collection: CollectionRaw,
    username: string,
    signal?: AbortSignal,
  ): Promise<MissingSlot[]> {
    const query = `
      query CollectionMissingSlots($collectionSlug: String!, $userSlug: String!) {
        cardCollection(slug: $collectionSlug) {
          slug
          userCardCollection(forUserSlug: $userSlug) {
            allSlots: slots(onlyFulfilled: false) {
              slug
              slot {
                id
                rarity
                displayedRequirements
                transferMarketFilters
                player {
                  slug
                  displayName
                }
                anyTeam {
                  name
                  slug
                }
              }
            }
            fulfilledSlots: slots(onlyFulfilled: true) {
              slot {
                id
              }
            }
          }
        }
      }
    `;

    interface SlotsResult {
      cardCollection: {
        slug: string;
        userCardCollection: {
          allSlots: Array<{
            slug: string;
            slot: {
              id: string;
              rarity: Rarity | null;
              displayedRequirements: string | null;
              transferMarketFilters: string;
              player: { slug: string; displayName: string };
              anyTeam: { name: string; slug: string } | null;
            };
          }>;
          fulfilledSlots?: Array<{ slot: { id: string } }>;
        };
      };
    }

    const data = await this.postGraphQL<SlotsResult>(
      query,
      { collectionSlug: collection.slug, userSlug: username },
      `slots_v2:${collection.slug}:${username}`,
      signal,
    );

    const ucc = data.cardCollection?.userCardCollection;
    const rawSlots = ucc?.allSlots ?? [];
    const fulfilledIds = new Set(
      (ucc?.fulfilledSlots ?? []).map((s) => s.slot.id),
    );
    return rawSlots
      .filter((entry) => !fulfilledIds.has(entry.slot.id))
      .map((entry) => ({
        slotId: entry.slot.id,
        collectionSlug: collection.slug,
        collectionName: collection.name,
        playerSlug: entry.slot.player.slug,
        playerName: entry.slot.player.displayName,
        teamName: entry.slot.anyTeam?.name ?? collection.teamName,
        teamSlug: entry.slot.anyTeam?.slug ?? collection.teamSlug,
        rarity: entry.slot.rarity ?? collection.rarity,
        seasonYear: extractSeasonFromFilters(
          entry.slot.transferMarketFilters,
          collection.slug,
        ),
        displayedRequirements: entry.slot.displayedRequirements,
        transferMarketFilters: entry.slot.transferMarketFilters,
      }));
  }

  /**
   * Batches market floor lookup by (teamName, rarity, seasonYear) via searchGroupedCards,
   * then hydrates exact USD/EUR receiverSide amounts via anyCards(assetIds).
   * Keeps fallback individual lookups small (max 6) so unauthenticated rate limits stay safe.
   */
  async fetchMarketPricesForMissingSlots(
    slots: MissingSlot[],
    currency: Currency,
    signal?: AbortSignal,
    onStep?: (done: number, total: number) => void,
  ): Promise<Record<string, CardMarketPrice>> {
    const uniqueGroups = new Map<
      string,
      { teamName: string; rarity: Rarity; seasonYear: number | null }
    >();
    const neededPlayerSlugs = new Set<string>();

    for (const slot of slots) {
      neededPlayerSlugs.add(slot.playerSlug);
      const queryName =
        slot.teamName ??
        slot.collectionName
          .replace(/\s+(Limited|Rare|Super Rare|Unique).*$/i, "")
          .trim();
      if (queryName) {
        const gKey = `${queryName}::${slot.rarity}::${slot.seasonYear ?? "any"}`;
        if (!uniqueGroups.has(gKey)) {
          uniqueGroups.set(gKey, {
            teamName: queryName,
            rarity: slot.rarity,
            seasonYear: slot.seasonYear,
          });
        }
      }
    }

    const useFast = this.hasApiKey();
    const groupedPageSize = useFast ? 40 : 25;
    const groupedQuery = `
      query GroupedTeamFloor($filters: [SearchFilterInput!], $query: String, $pageSize: Int!) {
        searchGroupedCards(
          filters: $filters
          query: $query
          onSaleOnly: true
          cheapestWithinGroup: true
          groupBy: [PLAYER_AND_RARITY]
          groupLimit: 1
          sorts: [{ field: "price", direction: ASC }]
          pageSize: $pageSize
        ) {
          groups {
            hits {
              slug
              card {
                assetId
                anyPlayer { slug displayName }
              }
            }
          }
        }
      }
    `;

    interface GroupedResp {
      searchGroupedCards: {
        groups: Array<{
          hits: Array<{
            slug: string;
            card: {
              assetId: string;
              anyPlayer: { slug: string; displayName: string };
            } | null;
          }>;
        }>;
      };
    }

    const discoveredAssetIds: Array<{
      assetId: string;
      cardSlug: string;
      playerSlug: string;
      rarity: Rarity;
      seasonYear: number | null;
    }> = [];

    const groupList = Array.from(uniqueGroups.values());
    let doneCount = 0;
    const estimatedSteps = Math.max(1, groupList.length + 1);

    for (const group of groupList) {
      if (signal?.aborted) break;

      const filters: Array<Record<string, unknown>> = [
        {
          field: "sport",
          operator: "EQUAL",
          values: [{ stringValue: "nba" }],
        },
        {
          field: "rarity",
          operator: "EQUAL",
          values: [{ stringValue: group.rarity }],
        },
        {
          field: "sale.type",
          operator: "EQUAL",
          values: [{ stringValue: "SingleSaleOffer" }],
        },
      ];
      if (group.seasonYear !== null) {
        filters.push({
          field: "season",
          operator: "EQUAL",
          values: [{ stringValue: String(group.seasonYear) }],
        });
      }

      const data = await this.postGraphQL<GroupedResp>(
        groupedQuery,
        { filters, query: group.teamName, pageSize: groupedPageSize },
        `grouped_sso:${group.teamName}:${group.rarity}:${group.seasonYear ?? "any"}:${groupedPageSize}`,
        signal,
      );

      for (const grp of data.searchGroupedCards?.groups ?? []) {
        const hit = grp.hits?.[0];
        if (!hit?.card?.assetId) continue;
        if (
          neededPlayerSlugs.size > 0 &&
          !neededPlayerSlugs.has(hit.card.anyPlayer.slug)
        ) {
          continue;
        }
        discoveredAssetIds.push({
          assetId: hit.card.assetId,
          cardSlug: hit.slug,
          playerSlug: hit.card.anyPlayer.slug,
          rarity: group.rarity,
          seasonYear: group.seasonYear,
        });
      }

      doneCount += 1;
      onStep?.(doneCount, estimatedSteps);
    }

    const prices: Record<string, CardMarketPrice> = {};
    const now = Date.now();

    const batchQuery = `
      query BatchCardPrices($assetIds: [String!]) {
        anyCards(assetIds: $assetIds) {
          slug
          assetId
          seasonYear
          anyPlayer { slug displayName }
          livePrimaryOffer {
            price { usdCents eurCents referenceCurrency }
          }
          liveSingleSaleOffer {
            dealStatus
            endDate
            receiverSide {
              amounts { usdCents eurCents referenceCurrency }
            }
          }
          latestEnglishAuction {
            dealStatus
            cancelled
            endDate
            currency
            currentPrice
            minNextBid
            bidsCount
            bundledAnyCards { slug }
            bestBid {
              amounts { usdCents eurCents referenceCurrency }
            }
          }
        }
      }
    `;

    const uniqueAssetIds = Array.from(
      new Set(discoveredAssetIds.map((d) => d.assetId)),
    );
    const metaByAssetId = new Map(discoveredAssetIds.map((d) => [d.assetId, d]));

    const chunkSize = useFast ? 35 : 12;
    for (let i = 0; i < uniqueAssetIds.length; i += chunkSize) {
      if (signal?.aborted) break;
      const chunk = uniqueAssetIds.slice(i, i + chunkSize);
      const res = await this.postGraphQL<{ anyCards: CardDetailsRaw[] }>(
        batchQuery,
        { assetIds: chunk },
        undefined,
        signal,
      );

      for (const card of res.anyCards ?? []) {
        const meta = metaByAssetId.get(card.assetId);
        if (!meta) continue;
        const playerSlug = card.anyPlayer?.slug ?? meta.playerSlug;
        const key = buildMarketPriceKey(
          playerSlug,
          meta.rarity,
          meta.seasonYear,
        );

        const sso = card.liveSingleSaleOffer;
        const ssoOpen =
          sso &&
          (!sso.dealStatus ||
            sso.dealStatus === "opened" ||
            sso.dealStatus === "UNKNOWN");
        const instantBuyCents =
          convertAmountsToCurrencyCents(
            ssoOpen ? sso.receiverSide?.amounts : null,
            currency,
          ) ??
          convertAmountsToCurrencyCents(card.livePrimaryOffer?.price, currency);
        const isBundle =
          (card.latestEnglishAuction?.bundledAnyCards?.length ?? 0) > 1;
        const auctionBidCents = parseAuctionPriceCents(
          card.latestEnglishAuction,
          currency,
        );

        const existing = prices[key];
        const bestInstant =
          instantBuyCents !== null &&
          (existing?.instantBuyCents === null ||
            existing?.instantBuyCents === undefined ||
            instantBuyCents < existing.instantBuyCents)
            ? instantBuyCents
            : existing?.instantBuyCents ?? null;

        const bestAuction =
          auctionBidCents !== null &&
          (existing?.auctionBidCents === null ||
            existing?.auctionBidCents === undefined ||
            auctionBidCents < existing.auctionBidCents)
            ? auctionBidCents
            : existing?.auctionBidCents ?? null;

        prices[key] = {
          key,
          playerSlug,
          rarity: meta.rarity,
          seasonYear: meta.seasonYear,
          instantBuyCents: bestInstant,
          instantBuyCurrency: bestInstant !== null ? currency : null,
          instantBuyCardSlug:
            instantBuyCents !== null && bestInstant === instantBuyCents
              ? card.slug
              : existing?.instantBuyCardSlug ?? null,
          instantBuyUrl:
            instantBuyCents !== null && bestInstant === instantBuyCents
              ? `${SORARE_NBA_CARD_URL}/${card.slug}`
              : existing?.instantBuyUrl ?? null,
          auctionBidCents: bestAuction,
          auctionCurrency: bestAuction !== null ? currency : null,
          auctionCardSlug:
            auctionBidCents !== null && bestAuction === auctionBidCents
              ? card.slug
              : existing?.auctionCardSlug ?? null,
          auctionEndDate:
            auctionBidCents !== null && bestAuction === auctionBidCents
              ? card.latestEnglishAuction?.endDate ?? null
              : existing?.auctionEndDate ?? null,
          auctionBidsCount:
            auctionBidCents !== null && bestAuction === auctionBidCents
              ? card.latestEnglishAuction?.bidsCount ?? null
              : existing?.auctionBidsCount ?? null,
          auctionUrl:
            auctionBidCents !== null && bestAuction === auctionBidCents
              ? `${SORARE_NBA_CARD_URL}/${card.slug}`
              : existing?.auctionUrl ?? null,
          excludedBundlesCount:
            (existing?.excludedBundlesCount ?? 0) + (isBundle ? 1 : 0),
          fetchedAt: now,
        };
      }
    }

    onStep?.(estimatedSteps, estimatedSteps);
    return prices;
  }

  /**
   * Fetches the live NBA crafting pool (`cardShardsPool`) across TIER_0..TIER_5
   * for the given rarity (6 lightweight GraphQL calls, cached 10 min).
   */
  async fetchCraftPool(
    rarity: Rarity,
    signal?: AbortSignal,
    onTier?: (done: number, total: number, tier: CardQualityTier) => void,
  ): Promise<{ computedAt: string | null; players: CraftPoolPlayer[] }> {
    const query = `
      query CraftPoolTier($rarity: Rarity!, $quality: CardQuality!) {
        cardShardsPoolComputedAt(sport: NBA)
        cardShardsPool(rarity: $rarity, sport: NBA, quality: $quality) {
          slug
          availableSupply
          anyPlayer {
            slug
            displayName
            age
            anyPositions
            activeClub { name slug }
            averageScore(type: LAST_TEN_PLAYED_SO5_AVERAGE_SCORE)
          }
        }
      }
    `;

    interface PoolResp {
      cardShardsPoolComputedAt: string | null;
      cardShardsPool: Array<{
        slug: string;
        availableSupply: number | null;
        anyPlayer: {
          slug: string;
          displayName: string;
          age: number;
          anyPositions: string[];
          activeClub: { name: string; slug: string } | null;
          averageScore: number | null;
        };
      }>;
    }

    const bySlug = new Map<string, CraftPoolPlayer>();
    let computedAt: string | null = null;

    for (let i = 0; i < QUALITY_TIERS.length; i += 1) {
      if (signal?.aborted) break;
      const tier = QUALITY_TIERS[i];
      onTier?.(i, QUALITY_TIERS.length, tier);

      const data = await this.postGraphQL<PoolResp>(
        query,
        { rarity, quality: tier },
        `craft_pool:${rarity}:${tier}`,
        signal,
      );

      if (!computedAt && data.cardShardsPoolComputedAt) {
        computedAt = data.cardShardsPoolComputedAt;
      }

      for (const entry of data.cardShardsPool ?? []) {
        const p = entry.anyPlayer;
        if (!p || bySlug.has(p.slug)) continue;
        const positions = (p.anyPositions ?? []).filter(
          (pos): pos is NbaPosition =>
            pos === "basketball_guard" ||
            pos === "basketball_forward" ||
            pos === "basketball_center",
        );
        const teamSlug = p.activeClub?.slug ?? null;
        bySlug.set(p.slug, {
          playerSlug: p.slug,
          playerName: p.displayName,
          age: p.age,
          positions,
          teamName: p.activeClub?.name ?? null,
          teamSlug,
          conference: teamSlug ? NBA_TEAM_CONFERENCE[teamSlug] ?? null : null,
          averageL10:
            typeof p.averageScore === "number" ? Math.round(p.averageScore * 10) / 10 : null,
          qualityTier: tier,
          availableSupply: entry.availableSupply ?? 1,
          floorCents: null,
          floorCardSlug: null,
          marketUrl: `${SORARE_NBA_MARKET_URL}?player=${encodeURIComponent(p.displayName)}&rarity=${encodeURIComponent(rarity)}`,
        });
      }
    }

    onTier?.(QUALITY_TIERS.length, QUALITY_TIERS.length, "TIER_5");
    return { computedAt, players: Array.from(bySlug.values()) };
  }

  /**
   * Hydrates live Instant Buy floor prices for up to 10 selected craft-pool candidates.
   */
  async priceCraftPlayers(
    players: CraftPoolPlayer[],
    rarity: Rarity,
    currency: Currency,
    signal?: AbortSignal,
  ): Promise<Record<string, { floorCents: number | null; floorCardSlug: string | null }>> {
    const query = `
      query CraftPlayerFloor($filters: [SearchFilterInput!], $query: String) {
        searchCards(
          filters: $filters
          query: $query
          onSaleOnly: true
          sorts: [{ field: "price", direction: ASC }]
          pageSize: 5
        ) {
          hits {
            slug
            card {
              slug
              anyPlayer { slug }
              liveSingleSaleOffer {
                receiverSide {
                  amounts { usdCents eurCents referenceCurrency }
                }
              }
            }
          }
        }
      }
    `;

    const filters = [
      { field: "sport", operator: "EQUAL", values: [{ stringValue: "nba" }] },
      { field: "rarity", operator: "EQUAL", values: [{ stringValue: rarity }] },
    ];

    const out: Record<
      string,
      { floorCents: number | null; floorCardSlug: string | null }
    > = {};

    for (const player of players.slice(0, 10)) {
      if (signal?.aborted) break;
      try {
        const res = await this.postGraphQL<{
          searchCards: {
            hits: Array<{
              slug: string;
              card: {
                slug: string;
                anyPlayer: { slug: string };
                liveSingleSaleOffer: LiveOfferRaw | null;
              } | null;
            }>;
          };
        }>(
          query,
          { filters, query: player.playerName },
          `craft_floor:${player.playerSlug}:${rarity}`,
          signal,
        );

        let bestCents: number | null = null;
        let bestSlug: string | null = null;
        for (const hit of res.searchCards?.hits ?? []) {
          const card = hit.card;
          if (!card || card.anyPlayer.slug !== player.playerSlug) continue;
          const cents = convertAmountsToCurrencyCents(
            card.liveSingleSaleOffer?.receiverSide?.amounts,
            currency,
          );
          if (cents !== null && (bestCents === null || cents < bestCents)) {
            bestCents = cents;
            bestSlug = card.slug;
          }
        }
        out[player.playerSlug] = {
          floorCents: bestCents,
          floorCardSlug: bestSlug,
        };
      } catch (err) {
        if (
          err instanceof RateLimitedError ||
          err instanceof ScanCancelledError ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          throw err;
        }
        // Individual player price miss is non-fatal
      }
    }
    return out;
  }

  /**
   * Fetches the user's NBA gallery cards (Pro + Common/Set), upcoming Game Week fixtures,
   * and open/submitted SO5 lineups (when available within complexity limits).
   */
  async fetchUserGalleryAndFixtures(
    username: string,
    signal?: AbortSignal,
  ): Promise<{
    cards: GalleryCard[];
    commonCards: GalleryCard[];
    fixtures: So5FixtureSummary[];
    currentLineups: CurrentLineupEntry[];
    leaderboardBenchmarks: LeaderboardBenchmark[];
  }> {
    const useFast = this.hasApiKey();
    const proExtraFields = useFast
      ? `
              powerBreakdown {
                xp
                season
                collection
                scarcity
              }
              openedSo5Lineups {
                id
                name
                draft
                so5Leaderboard { slug displayName }
                so5Rankings { ranking score }
              }`
      : `
              openedSo5Lineups {
                id
                name
                draft
              }`;

    const buildCardsQuery = (raritiesLiteral: string) => `
      query GalleryAndFixtures($slug: String!, $first: Int!, $after: String) {
        user(slug: $slug) {
          cards(
            sport: NBA
            rarities: [${raritiesLiteral}]
            first: $first
            after: $after
          ) {
            pageInfo { hasNextPage endCursor }
            nodes {
              slug
              rarityTyped
              seasonYear
              inSeasonEligible
              grade
              power
              pictureUrl(derivative: "tinified")
              ownershipHistory { transferType }
              ... on NBACard { cardEditionName }
              anyTeam { name slug }
              anyPlayer {
                slug
                displayName
                age
                anyPositions
                l10: averageScore(type: LAST_TEN_PLAYED_SO5_AVERAGE_SCORE)
                l5: averageScore(type: LAST_FIVE_AVERAGE_ALL_AROUND_SCORE)
                nextClassicFixtureProjectedScore
                nextDailyFixtureProjectedScore
                ... on NBAPlayer { gameplayTier }
              }
              sealed
              sealedAt
              sealableFor
              unsealableAt${proExtraFields}
            }
          }
        }
        config { gameplayTierRatings(sport: NBA) { gameplayTier stars } }
        so5 {
          featuredSo5Fixtures(sport: NBA, first: 4) {
            slug
            displayName
            cutOffDate
            endDate
            aasmState
          }
        }
      }
    `;

    interface RawCardNode {
      slug: string;
      rarityTyped: CardRarity;
      seasonYear: number;
      inSeasonEligible: boolean;
      grade: number;
      power: string;
      pictureUrl?: string | null;
      cardEditionName?: string | null;
      ownershipHistory?: Array<{ transferType: string }>;
      anyTeam: { name: string; slug: string } | null;
      anyPlayer: {
        slug: string;
        displayName: string;
        age?: number | null;
        anyPositions: string[];
        l10: number | null;
        l5: number | null;
        nextClassicFixtureProjectedScore: number | null;
        nextDailyFixtureProjectedScore: number | null;
        gameplayTier?: string | null;
      };
      sealed?: boolean | null;
      sealedAt?: string | null;
      sealableFor?: number | null;
      unsealableAt?: string | null;
      powerBreakdown?: {
        xp: string | null;
        season: string;
        collection: string;
        scarcity: string;
      };
      openedSo5Lineups?: Array<{
        id: string;
        name: string | null;
        draft: boolean;
        so5Leaderboard?: { slug: string; displayName: string } | null;
        so5Rankings?: Array<{ ranking: number | null; score: number | null }> | null;
      }>;
    }

    interface Resp {
      user: {
        cards: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: RawCardNode[];
        };
      } | null;
      config?: { gameplayTierRatings?: Array<{ gameplayTier: string; stars: number }> } | null;
      so5: {
        featuredSo5Fixtures: So5FixtureSummary[];
      };
    }

    // No-key limit is complexity 500: 10 cards/page measured 720, 6 fits (checked 2026-11-20).
    const pageSize = useFast ? 50 : 6;
    let tierStars = buildTierStarMap(null);
    const cards: GalleryCard[] = [];
    const commonCards: GalleryCard[] = [];
    let fixtures: So5FixtureSummary[] = [];
    const lineupsById = new Map<string, CurrentLineupEntry>();

    const mapNode = (n: RawCardNode): GalleryCard => {
      const pwr = Number(n.power);
      const positions = (n.anyPlayer.anyPositions ?? []).filter(
        (pos): pos is NbaPosition =>
          pos === "basketball_guard" ||
          pos === "basketball_forward" ||
          pos === "basketball_center",
      );
      const openedIds: string[] = [];
      for (const ln of n.openedSo5Lineups ?? []) {
        openedIds.push(ln.id);
        const existing = lineupsById.get(ln.id);
        if (existing) {
          if (!existing.cardSlugs.includes(n.slug)) {
            existing.cardSlugs.push(n.slug);
          }
          if (
            existing.playerNames &&
            !existing.playerNames.includes(n.anyPlayer.displayName)
          ) {
            existing.playerNames.push(n.anyPlayer.displayName);
          }
        } else {
          lineupsById.set(ln.id, {
            id: ln.id,
            name: ln.name?.trim() || ln.so5Leaderboard?.displayName || "Open Lineup",
            leaderboardSlug: ln.so5Leaderboard?.slug ?? "",
            leaderboardName: ln.so5Leaderboard?.displayName ?? ln.name ?? "Sorare Pro",
            draft: ln.draft,
            cardSlugs: [n.slug],
            playerNames: [n.anyPlayer.displayName],
            captainCardSlug: null,
            source: "api",
            rank: ln.so5Rankings?.[0]?.ranking ?? null,
            score: typeof ln.so5Rankings?.[0]?.score === "number" ? Math.round(ln.so5Rankings[0].score * 10) / 10 : null,
          });
        }
      }

      const pb = n.powerBreakdown
        ? {
            xp: Number(n.powerBreakdown.xp ?? 0) || 0,
            season: Number(n.powerBreakdown.season ?? 0) || 0,
            collection: Number(n.powerBreakdown.collection ?? 0) || 0,
            scarcity: Number(n.powerBreakdown.scarcity ?? 0) || 0,
          }
        : undefined;

      const transfers = n.ownershipHistory ?? [];
      return {
        slug: n.slug,
        rarity: n.rarityTyped,
        seasonYear: n.seasonYear,
        inSeasonEligible: n.inSeasonEligible,
        grade: n.grade,
        powerMultiplier: Number.isFinite(pwr) && pwr > 0 ? pwr : 1,
        pictureUrl: n.pictureUrl ?? null,
        isFirstOwner: transfers.length === 1,
        playerAge: typeof n.anyPlayer.age === "number" ? n.anyPlayer.age : null,
        cardEditionName: n.cardEditionName ?? null,
        acquisitionType:
          transfers.length > 0 ? transfers[transfers.length - 1]?.transferType ?? null : null,
        powerBreakdown: pb,
        openedLineupIds: openedIds.length > 0 ? openedIds : undefined,
        teamName: n.anyTeam?.name ?? null,
        teamSlug: n.anyTeam?.slug ?? null,
        playerSlug: n.anyPlayer.slug,
        playerName: n.anyPlayer.displayName,
        positions,
        l10: n.anyPlayer.l10,
        l5: n.anyPlayer.l5,
        sorareClassicProjected: n.anyPlayer.nextClassicFixtureProjectedScore,
        sorareDailyProjected: n.anyPlayer.nextDailyFixtureProjectedScore,
        ...(() => {
          const rating = resolveStarRating(n.anyPlayer.gameplayTier, n.anyPlayer.l10, tierStars);
          return { starCost: rating.stars, starSource: rating.source };
        })(),
        gameplayTier: n.anyPlayer.gameplayTier ?? null,
        sealed: n.sealed === true,
        sealedAt: n.sealedAt ?? null,
        sealingPoints: typeof n.sealableFor === "number" ? n.sealableFor : null,
        unsealableAt: n.unsealableAt ?? null,
      };
    };

    // 1) Pro Cards (Limited / Rare / Super Rare / Unique)
    let after: string | null = null;
    let pages = 0;
    const maxProPages = 10;
    const proQuery = buildCardsQuery("limited, rare, super_rare, unique");
    while (pages < maxProPages) {
      pages += 1;
      const data: Resp = await this.postGraphQL<Resp>(
        proQuery,
        { slug: username, first: pageSize, after },
        `gallery:${username}:${pageSize}:${after ?? "first"}`,
        signal,
      );
      if (!data.user) {
        throw new Error(`Sorare user "${username}" not found.`);
      }
      if (pages === 1 && data.so5?.featuredSo5Fixtures) {
        fixtures = data.so5.featuredSo5Fixtures;
      }
      if (pages === 1 && data.config?.gameplayTierRatings) {
        tierStars = buildTierStarMap(data.config.gameplayTierRatings);
      }
      for (const n of data.user.cards?.nodes ?? []) {
        cards.push(mapNode(n));
      }
      if (!data.user.cards?.pageInfo?.hasNextPage || !data.user.cards.pageInfo.endCursor) {
        break;
      }
      after = data.user.cards.pageInfo.endCursor;
    }

    // 2) Set / Common Cards (up to 100 in Fast mode, 36 in Safe mode)
    const commonQuery = buildCardsQuery("common").replace(proExtraFields, "");
    let commonAfter: string | null = null;
    let commonPages = 0;
    // Set collections run to ~400 cards: load them all (duplicates, Solo pool), 50 per page with a key.
    while (commonPages < (useFast ? 12 : 20)) {
      commonPages += 1;
      const data: Resp = await this.postGraphQL<Resp>(
        commonQuery,
        { slug: username, first: pageSize, after: commonAfter },
        `gallery_common:${username}:${pageSize}:${commonAfter ?? "first"}`,
        signal,
      );
      for (const n of data.user?.cards?.nodes ?? []) {
        commonCards.push(mapNode(n));
      }
      if (
        !data.user?.cards?.pageInfo?.hasNextPage ||
        !data.user.cards.pageInfo.endCursor
      ) {
        break;
      }
      commonAfter = data.user.cards.pageInfo.endCursor;
    }

    const closedFixture = fixtures.find((f) => f.aasmState === "closed") ?? null;
    let leaderboardBenchmarks: LeaderboardBenchmark[] = [];
    if (closedFixture) {
      try {
        leaderboardBenchmarks = await this.fetchClosedLeaderboardBenchmarks(
          closedFixture.slug,
          closedFixture.displayName,
          "limited",
          signal,
        );
      } catch {
        // Non-fatal: lineup builder falls back cleanly to static targets
      }
    }

    return {
      cards,
      commonCards,
      fixtures,
      currentLineups: Array.from(lineupsById.values()),
      leaderboardBenchmarks,
    };
  }

  /**
   * Fetches real closed-Gameweek field counts, paid places, and exact cutoff scores
   * across In-Season, Classic, and Arena rooms so win odds & entry recommendations
   * reflect live Sorare NBA competition difficulty rather than static estimates.
   */
  /**
   * Active players of the given NBA teams (`team(slug).activePlayers`, public) as Common-card
   * stand-ins for the Daily Picker: any player in today's games can be picked, owned or not.
   * Needs an API key for more than one team (no-key complexity limit 500).
   */
  /**
   * Set shop packs (public `market`): today's Live Today packs from `setSections`, plus the set's
   * standard Gold / Silver / Bronze packs (slug pattern `<set>-nba-<quality>-pack`, set taken from
   * the Live Today slug). Slot odds (`slotGameplayTierOdds`) need an API key (complexity ~1000 per slot).
   */
  async fetchSetPacks(signal?: AbortSignal): Promise<SetPackInfo[]> {
    interface Sections {
      market?: { setSections?: Array<{ __typename?: string; cardPacks?: Array<{ slug: string }> | null }> | null } | null;
    }
    const sections = await this.postGraphQL<Sections>(
      `query SetShopSections { market { setSections(sport: NBA) { __typename ... on MarketLiveOps { cardPacks { slug } } } } }`,
      {},
      "set_shop_sections_v1",
      signal,
    );
    const liveSlugs = (sections.market?.setSections ?? [])
      .flatMap((s) => s.cardPacks ?? [])
      .map((p) => p.slug)
      .filter((slug) => /^[a-z0-9-]+$/.test(slug));
    const setPrefix = liveSlugs[0]?.split("-nba-")[0] ?? "";
    const standard = setPrefix ? ["gold", "silver", "bronze"].map((q) => `${setPrefix}-nba-${q}-pack`) : [];
    const slugs = Array.from(new Set([...liveSlugs, ...standard])).slice(0, 8);
    if (slugs.length === 0) return [];
    const withOdds = this.hasApiKey();
    type Odds = Array<{ gameplayTier: string; probabilityBasisPoint: number }> | null;
    interface RawPack {
      slug: string;
      title: string | null;
      price: number | null;
      currency: string | null;
      category: string | null;
      endDate: string | null;
      cardsCount: number | null;
      s0?: Odds;
      s1?: Odds;
      s2?: Odds;
      s3?: Odds;
    }
    const plain = await this.postGraphQL<{ market?: Record<string, RawPack | null> | null }>(
      `query SetShopPacks { market { ${slugs
        .map((slug, i) => `p${i}: cardPack(slug: "${slug}") { slug title price currency category endDate cardsCount }`)
        .join(" ")} } }`,
      {},
      `set_shop_packs_v2:${slugs.join(",")}`,
      signal,
    );
    const rawPacks = Object.values(plain.market ?? {}).filter((p): p is RawPack => p !== null);
    if (withOdds && rawPacks.length > 0) {
      // Only ask for slots the pack has (Live Today packs have 3 cards, standard packs 4).
      const oddsBlocks = rawPacks
        .map((p, i) => {
          const n = Math.min(4, Math.max(1, Number(p.cardsCount ?? 4) || 4));
          const slots = Array.from({ length: n }, (_, s) => `s${s}: slotGameplayTierOdds(slotIndex: ${s}) { gameplayTier probabilityBasisPoint }`);
          return `p${i}: cardPack(slug: "${p.slug}") { slug ${slots.join(" ")} }`;
        })
        .join(" ");
      try {
        const odds = await this.postGraphQL<{ market?: Record<string, RawPack | null> | null }>(
          `query SetShopPackOdds { market { ${oddsBlocks} } }`,
          {},
          `set_shop_odds_v1:${rawPacks.map((p) => p.slug).join(",")}`,
          signal,
        );
        for (const o of Object.values(odds.market ?? {})) {
          const target = o ? rawPacks.find((p) => p.slug === o.slug) : undefined;
          if (target && o) Object.assign(target, { s0: o.s0, s1: o.s1, s2: o.s2, s3: o.s3 });
        }
      } catch {
        // Odds are optional: prices and Live Today timing still show.
      }
    }
    const packs: SetPackInfo[] = [];
    for (const raw of rawPacks) {
      const slots = [raw.s0, raw.s1, raw.s2, raw.s3]
        .filter((s): s is NonNullable<Odds> => Array.isArray(s) && s.length > 0)
        .map((s) => s.map((o) => ({ tier: o.gameplayTier, basisPoints: Number(o.probabilityBasisPoint) || 0 })));
      packs.push({
        slug: raw.slug,
        title: raw.title ?? raw.slug,
        price: Number(raw.price ?? 0) || 0,
        currency: raw.currency ?? "",
        category: raw.category ?? null,
        endDate: raw.endDate ?? null,
        cardsCount: Number(raw.cardsCount ?? slots.length) || slots.length,
        slots,
      });
    }
    return packs;
  }

  async fetchTeamRosterCards(
    teamSlugs: string[],
    signal?: AbortSignal,
  ): Promise<{ cards: GalleryCard[]; teamsLoaded: number; teamsRequested: number; error?: string }> {
    const slugs = Array.from(new Set(teamSlugs.filter((t) => /^[a-z0-9-]+$/.test(t)))).slice(0, 30);
    // Sorare rejects the same root field twice in one query ("Duplicated root field: team"), even
    // with aliases, so each team is its own request (cached 10 min, paced by the queue).
    const perRequest = 1;
    const cards: GalleryCard[] = [];
    let teamsLoaded = 0;
    let error: string | undefined;
    for (let i = 0; i < slugs.length; i += perRequest) {
      try {
        const batch = await this.fetchTeamRosterBatch(slugs.slice(i, i + perRequest), signal);
        cards.push(...batch.cards);
        teamsLoaded += batch.teams;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        if (err instanceof RateLimitedError) break;
      }
    }
    return { cards, teamsLoaded, teamsRequested: slugs.length, error };
  }

  private async fetchTeamRosterBatch(slugs: string[], signal?: AbortSignal): Promise<{ cards: GalleryCard[]; teams: number }> {
    const blocks = slugs.map(
      (slug, i) => `
        t${i}: team(slug: "${slug}") {
          slug
          name
          activePlayers(first: 18) {
            nodes {
              slug
              displayName
              anyPositions
              l10: averageScore(type: LAST_TEN_PLAYED_SO5_AVERAGE_SCORE)
              l5: averageScore(type: LAST_FIVE_AVERAGE_ALL_AROUND_SCORE)
              daily: nextDailyFixtureProjectedScore
            }
          }
        }`,
    );
    interface RosterTeam {
      slug: string;
      name: string;
      activePlayers?: {
        nodes?: Array<{
          slug: string;
          displayName: string;
          anyPositions?: string[] | null;
          l10?: number | null;
          l5?: number | null;
          daily?: number | null;
        }>;
      } | null;
    }
    const data = await this.postGraphQL<Record<string, RosterTeam | null>>(
      `query DailyPickerRosters { ${blocks.join("\n")} }`,
      {},
      `daily_rosters_v2:${slugs.slice().sort().join(",")}`,
      signal,
    );
    const round1 = (v: number | null | undefined): number | null =>
      typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
    const cards: GalleryCard[] = [];
    let teams = 0;
    for (const team of Object.values(data ?? {})) {
      if (!team) continue;
      teams += 1;
      for (const p of team.activePlayers?.nodes ?? []) {
        const positions = (p.anyPositions ?? []).filter(
          (pos): pos is NbaPosition =>
            pos === "basketball_guard" || pos === "basketball_forward" || pos === "basketball_center",
        );
        const l10 = round1(p.l10);
        cards.push({
          slug: `roster:${p.slug}`,
          rarity: "common",
          seasonYear: new Date().getUTCFullYear(),
          inSeasonEligible: false,
          grade: 0,
          powerMultiplier: 1,
          teamName: team.name,
          teamSlug: team.slug,
          playerSlug: p.slug,
          playerName: p.displayName,
          positions,
          l10,
          l5: round1(p.l5),
          sorareClassicProjected: null,
          sorareDailyProjected: round1(p.daily),
          starCost: resolveStarRating(null, l10).stars,
          starSource: "estimated",
        });
      }
    }
    return { cards, teams };
  }

  async fetchClosedLeaderboardBenchmarks(
    fixtureSlug: string,
    fixtureName: string,
    rarity: CardRarity = "limited",
    signal?: AbortSignal,
  ): Promise<LeaderboardBenchmark[]> {
    const listQuery = `
      query ClosedFixtureBoards($slug: String!) {
        so5 {
          so5Fixture(slug: $slug) {
            slug
            so5Leaderboards {
              slug
              displayName
              rarityType
              so5LineupsCount
              rewardsConfig {
                ranking {
                  ranks
                  rewardConfigs {
                    __typename
                    ... on MonetaryRewardConfig { amount { usdCents eurCents } }
                    ... on CardShardRewardConfig { quantity }
                    ... on InGameCurrencyRewardConfig { currency amount }
                  }
                }
              }
            }
          }
        }
      }
    `;

    interface RawLb {
      slug: string;
      displayName: string;
      rarityType: string | null;
      so5LineupsCount: number | null;
      rewardsConfig?: {
        ranking?: RawRankReward[];
      } | null;
    }

    interface ListResp {
      so5: {
        so5Fixture: {
          slug: string;
          so5Leaderboards: RawLb[];
        } | null;
      };
    }

    let listResp: ListResp;
    try {
      listResp = await this.postGraphQL<ListResp>(
        listQuery,
        { slug: fixtureSlug },
        `benchmarks_list_v2:${fixtureSlug}:${rarity}`,
        signal,
      );
    } catch {
      // Typed reward tiers need depth 8 (API key limit 13, no-key limit 7): fall back to rank counts.
      listResp = await this.postGraphQL<ListResp>(
        listQuery.replace(/rewardConfigs \{[\s\S]*?\n {18}\}/, ""),
        { slug: fixtureSlug },
        `benchmarks_list_v2_basic:${fixtureSlug}:${rarity}`,
        signal,
      );
    }

    const allBoards = listResp.so5?.so5Fixture?.so5Leaderboards ?? [];
    const suffixRarity = rarity.toLowerCase();

    interface TargetAgg {
      key: string;
      format: LineupFormat;
      seasonScope: "in_season" | "classic" | "arena";
      ageScope: LineupAgeFilter;
      displayName: string;
      sampleSlug: string;
      sampleTotal: number;
      samplePaid: number;
      totalEntries: number;
      paidPlaces: number;
      isPod: boolean;
      cashPlaces: number;
      topCashLabel: string | null;
      rewardTiers: LeaderboardRewardTier[];
    }

    const aggMap = new Map<string, TargetAgg>();

    const recordAgg = (
      key: string,
      lb: RawLb,
      format: LineupFormat,
      seasonScope: "in_season" | "classic" | "arena",
      ageScope: LineupAgeFilter,
      isPod: boolean,
    ) => {
      const entries = Math.max(0, Number(lb.so5LineupsCount ?? 0) || 0);
      if (entries <= 0) return;
      const tierInfo = summarizeRewardTiers(lb.rewardsConfig?.ranking);
      const paid = tierInfo.paidPlaces;
      const existing = aggMap.get(key);
      if (existing) {
        existing.totalEntries += entries;
        existing.paidPlaces += paid;
        if (entries > existing.sampleTotal) {
          existing.sampleSlug = lb.slug;
          existing.sampleTotal = entries;
          existing.samplePaid = paid;
          existing.cashPlaces = tierInfo.cashPlaces;
          existing.topCashLabel = tierInfo.topCashLabel;
          existing.rewardTiers = tierInfo.tiers;
        }
      } else {
        aggMap.set(key, {
          key,
          format,
          seasonScope,
          ageScope,
          displayName: lb.displayName,
          sampleSlug: lb.slug,
          sampleTotal: entries,
          samplePaid: paid,
          totalEntries: entries,
          paidPlaces: paid,
          isPod,
          cashPlaces: tierInfo.cashPlaces,
          topCashLabel: tierInfo.topCashLabel,
          rewardTiers: tierInfo.tiers,
        });
      }
    };

    for (const lb of allBoards) {
      if ((lb.rarityType ?? "").toLowerCase() !== suffixRarity) continue;
      const s = lb.slug.toLowerCase();
      if (s.endsWith(`-nba_${suffixRarity}_in_season_champion`)) {
        recordAgg("in_champ", lb, "champion_16", "in_season", "all", false);
      } else if (s.endsWith(`-nba_${suffixRarity}_champion`)) {
        recordAgg("cl_champ", lb, "champion_16", "classic", "all", false);
      } else if (s.endsWith(`-nba_${suffixRarity}_in_season_contender`)) {
        recordAgg("in_cont", lb, "contender_11", "in_season", "all", false);
      } else if (s.endsWith(`-nba_${suffixRarity}_contender`)) {
        recordAgg("cl_cont", lb, "contender_11", "classic", "all", false);
      } else if (s.includes(`-nba_${suffixRarity}_arena_75-`)) {
        recordAgg("ar_cont", lb, "arena_contender_12", "arena", "all", true);
      } else if (s.includes(`-nba_${suffixRarity}_arena_140-`)) {
        recordAgg("ar_champ", lb, "arena_champion_15", "arena", "all", true);
      } else if (s.includes(`-nba_${suffixRarity}_arena_140_under_twenty_one-`)) {
        recordAgg("ar_u23", lb, "arena_champion_15", "arena", "u23", true);
      } else if (s.includes(`-nba_${suffixRarity}_arena_140_veterans-`)) {
        recordAgg("ar_vet", lb, "arena_champion_15", "arena", "veterans", true);
      } else if (s.includes(`-nba_${suffixRarity}_arena_uncapped-`)) {
        recordAgg("ar_uncap", lb, "uncapped", "arena", "all", true);
      }
    }

    const targets = Array.from(aggMap.values()).filter((t) => t.sampleTotal >= 5);
    if (targets.length === 0) return [];

    const encodeRankCursor = (rankOneBased: number): string => {
      const offset = Math.max(0, Math.min(rankOneBased - 1, 50_000));
      return btoa(
        JSON.stringify([offset, "00000000-0000-0000-0000-000000000000"]),
      );
    };

    const varDecls: string[] = [];
    const variables: Record<string, string> = {};
    const blocks: string[] = [];

    targets.forEach((t, idx) => {
      const n = t.sampleTotal;
      const paidRank =
        t.samplePaid > 0
          ? Math.min(n, t.samplePaid)
          : Math.max(1, Math.round(n * 0.2));
      const top20Rank = Math.max(1, Math.min(n, Math.round(n * 0.2)));
      const top5Rank = Math.max(1, Math.min(n, Math.round(n * 0.05)));
      const podiumRank = Math.max(1, Math.min(n, Math.min(3, Math.round(n * 0.02))));

      const cashRank = t.cashPlaces > 0 ? Math.min(n, t.cashPlaces) : 0;
      const vCash = `c_${idx}`;
      if (cashRank > 0) {
        varDecls.push(`$${vCash}: String`);
        variables[vCash] = encodeRankCursor(cashRank);
      }
      const vPaid = `p_${idx}`;
      const vTop20 = `t20_${idx}`;
      const vTop5 = `t5_${idx}`;
      const vPod = `pod_${idx}`;
      varDecls.push(`$${vPaid}: String`, `$${vTop20}: String`, `$${vTop5}: String`, `$${vPod}: String`);
      variables[vPaid] = encodeRankCursor(paidRank);
      variables[vTop20] = encodeRankCursor(top20Rank);
      variables[vTop5] = encodeRankCursor(top5Rank);
      variables[vPod] = encodeRankCursor(podiumRank);

      blocks.push(`
        ${t.key}: so5Leaderboard(slug: "${t.sampleSlug}") {
          top1: so5Rankings(first: 1) { nodes { score } }
          podium: so5Rankings(first: 1, after: $${vPod}) { nodes { score } }
          top5: so5Rankings(first: 1, after: $${vTop5}) { nodes { score } }
          top20: so5Rankings(first: 1, after: $${vTop20}) { nodes { score } }
          paidCut: so5Rankings(first: 1, after: $${vPaid}) { nodes { score } }
          ${cashRank > 0 ? `cashCut: so5Rankings(first: 1, after: $${vCash}) { nodes { score } }` : ""}
        }
      `);
    });

    const cutoffQuery = `
      query ClosedCutoffs(${varDecls.join(", ")}) {
        so5 {
          ${blocks.join("\n")}
        }
      }
    `;

    interface ScoreConn {
      nodes?: Array<{ score?: number | null }>;
    }
    interface CutoffBoardResp {
      top1?: ScoreConn;
      podium?: ScoreConn;
      top5?: ScoreConn;
      top20?: ScoreConn;
      paidCut?: ScoreConn;
      cashCut?: ScoreConn;
    }
    interface CutoffResp {
      so5: Record<string, CutoffBoardResp | null>;
    }

    const cutoffsResp = await this.postGraphQL<CutoffResp>(
      cutoffQuery,
      variables,
      `benchmarks_cutoffs_v2:${fixtureSlug}:${rarity}`,
      signal,
    );

    const readScore = (conn?: ScoreConn): number | null => {
      const val = conn?.nodes?.[0]?.score;
      return typeof val === "number" && Number.isFinite(val)
        ? Math.round(val * 10) / 10
        : null;
    };

    return targets.map((t) => {
      const b = cutoffsResp.so5?.[t.key];
      const winRate =
        t.totalEntries > 0
          ? Math.min(100, Math.round((t.paidPlaces / t.totalEntries) * 1000) / 10)
          : 0;
      return {
        fixtureSlug,
        fixtureName,
        leaderboardSlug: t.sampleSlug,
        displayName: t.displayName,
        format: t.format,
        seasonScope: t.seasonScope,
        ageScope: t.ageScope,
        rarity,
        totalEntries: t.totalEntries,
        paidPlaces: t.paidPlaces,
        rewardWinRatePct: winRate,
        paidCutoffScore: readScore(b?.paidCut),
        top20Score: readScore(b?.top20),
        top5Score: readScore(b?.top5),
        podiumScore: readScore(b?.podium),
        top1Score: readScore(b?.top1),
        podSize: t.isPod ? t.sampleTotal : undefined,
        cashPlaces: t.cashPlaces,
        cashCutoffScore: t.cashPlaces > 0 ? readScore(b?.cashCut) : null,
        topCashLabel: t.topCashLabel,
        rewardTiers: t.rewardTiers,
      };
    });
  }

  /**
   * Fetches lightweight 1st-owner / team / age summaries of the user's NBA cards
   * for live NBA League Collect Quest progress calculation (`ownershipHistory.length === 1`).
   */
  async fetchUserQuestCards(
    username: string,
    rarity: Rarity,
    signal?: AbortSignal,
  ): Promise<QuestCardSummary[]> {
    const query = `
      query UserQuestCards($slug: String!, $rarity: Rarity!, $first: Int!, $after: String) {
        user(slug: $slug) {
          cards(sport: NBA, rarities: [$rarity], first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              slug
              seasonYear
              ... on NBACard { cardEditionName }
              anyTeam { slug }
              anyPlayer { slug displayName age }
              ownershipHistory { transferType }
            }
          }
        }
      }
    `;
    interface QuestResp {
      user: {
        cards: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{
            slug: string;
            seasonYear: number;
            cardEditionName?: string | null;
            anyTeam: { slug: string } | null;
            anyPlayer: { slug: string; displayName: string; age?: number | null };
            ownershipHistory?: Array<{ transferType: string }>;
          }>;
        };
      } | null;
    }

    const pageSize = this.hasApiKey() ? 50 : 18;
    const maxPages = this.hasApiKey() ? 6 : 5;
    const out: QuestCardSummary[] = [];
    let after: string | null = null;
    let pages = 0;

    while (pages < maxPages) {
      pages += 1;
      const data: QuestResp = await this.postGraphQL<QuestResp>(
        query,
        { slug: username, rarity, first: pageSize, after },
        `quest_cards_v2:${username}:${rarity}:${pageSize}:${after ?? "first"}`,
        signal,
      );
      const activeSeason = getActiveNbaSeasonYear();
      const nodes = data.user?.cards?.nodes ?? [];
      let sawActiveSeason = false;
      for (const n of nodes) {
        if (n.seasonYear >= activeSeason) sawActiveSeason = true;
        out.push({
          slug: n.slug,
          seasonYear: n.seasonYear,
          teamSlug: n.anyTeam?.slug ?? null,
          playerSlug: n.anyPlayer.slug,
          playerName: n.anyPlayer.displayName,
          age: typeof n.anyPlayer.age === "number" ? n.anyPlayer.age : null,
          isFirstOwner: (n.ownershipHistory?.length ?? 99) === 1,
          cardEditionName: n.cardEditionName ?? null,
        });
      }
      if (
        !sawActiveSeason ||
        !data.user?.cards?.pageInfo?.hasNextPage ||
        !data.user.cards.pageInfo.endCursor
      ) {
        break;
      }
      after = data.user.cards.pageInfo.endCursor;
    }
    return out;
  }

  /**
   * Prices up to 30 owned Pro cards via grouped market floor lookup so the Gallery tab
   * can sort and identify liquid cards to sell for Cash / ETH.
   */
  async priceGalleryCards(
    cards: GalleryCard[],
    rarity: Rarity,
    currency: Currency,
    signal?: AbortSignal,
  ): Promise<Record<string, CardMarketPrice>> {
    const seen = new Set<string>();
    const syntheticSlots: MissingSlot[] = [];

    for (const card of cards) {
      if (card.rarity === "common") continue;
      if (card.rarity !== rarity) continue;
      if (!card.teamName) continue;
      const key = `${card.playerSlug}::${card.rarity}::${card.seasonYear}`;
      if (seen.has(key)) continue;
      seen.add(key);

      syntheticSlots.push({
        slotId: key,
        collectionSlug: key,
        collectionName: card.teamName,
        playerSlug: card.playerSlug,
        playerName: card.playerName,
        teamName: card.teamName,
        teamSlug: card.teamSlug,
        rarity,
        seasonYear: card.seasonYear,
        displayedRequirements: null,
        transferMarketFilters: "",
      });
      if (syntheticSlots.length >= 30) break;
    }

    if (syntheticSlots.length === 0) return {};
    return this.fetchMarketPricesForMissingSlots(
      syntheticSlots,
      currency,
      signal,
    );
  }

  /**
   * Scans live Sorare NBA marketplace listings (grouped unique-player Instant Buys + 1ST Primary Offers,
   * or realistic <1h active English Auctions) including L10 + L5 + Projected + Card Artwork.
   * Keeps unauthenticated queries strictly under Sorare's 500 complexity limit.
   */
  async fetchNbaBargains(
    rarity: Rarity,
    mode: BargainMode,
    currency: Currency,
    signal?: AbortSignal,
  ): Promise<BargainListing[]> {
    const groupedDiscoverQuery = `
      query GroupedBargainIds($filters: [SearchFilterInput!], $sorts: [SearchSortInput!], $pageSize: Int!) {
        searchGroupedCards(
          filters: $filters
          onSaleOnly: true
          cheapestWithinGroup: true
          groupBy: [PLAYER_AND_RARITY]
          groupLimit: 1
          sorts: $sorts
          pageSize: $pageSize
        ) {
          groups {
            hits {
              card {
                assetId
              }
            }
          }
        }
      }
    `;

    const hydrateBuyQuery = `
      query HydrateBargainCards($assetIds: [String!]) {
        anyCards(assetIds: $assetIds) {
          slug
          assetId
          rarityTyped
          seasonYear
          inSeasonEligible
          pictureUrl(derivative: "tinified")
          ... on NBACard { cardEditionName }
          ownershipHistory { transferType }
          anyTeam { name slug }
          anyPlayer {
            slug
            displayName
            anyPositions
            l10: averageScore(type: LAST_TEN_PLAYED_SO5_AVERAGE_SCORE)
            l5: averageScore(type: LAST_FIVE_AVERAGE_ALL_AROUND_SCORE)
            projected: nextClassicFixtureProjectedScore
            ... on NBAPlayer { gameplayTier }
          }
          liveSingleSaleOffer {
            dealStatus
            endDate
            receiverSide { amounts { usdCents eurCents referenceCurrency } }
          }
          livePrimaryOffer {
            price { usdCents eurCents referenceCurrency }
          }
        }
      }
    `;

    const discoverAuctionIdsQuery = `
      query DiscoverAuctionIds($filters: [SearchFilterInput!], $sorts: [SearchSortInput!], $page: Int!, $pageSize: Int!) {
        searchCards(
          filters: $filters
          onSaleOnly: true
          sorts: $sorts
          page: $page
          pageSize: $pageSize
        ) {
          hits {
            card {
              assetId
              latestEnglishAuction { endDate }
            }
          }
        }
      }
    `;

    const hydrateAuctionQuery = `
      query HydrateAuctionCards($assetIds: [String!]) {
        anyCards(assetIds: $assetIds) {
          slug
          assetId
          rarityTyped
          seasonYear
          inSeasonEligible
          pictureUrl(derivative: "tinified")
          ... on NBACard { cardEditionName }
          ownershipHistory { transferType }
          anyTeam { name slug }
          anyPlayer {
            slug
            displayName
            anyPositions
            l10: averageScore(type: LAST_TEN_PLAYED_SO5_AVERAGE_SCORE)
            l5: averageScore(type: LAST_FIVE_AVERAGE_ALL_AROUND_SCORE)
            projected: nextClassicFixtureProjectedScore
            ... on NBAPlayer { gameplayTier }
          }
          latestEnglishAuction {
            dealStatus
            cancelled
            endDate
            currency
            currentPrice
            minNextBid
            bidsCount
            bundledAnyCards { slug }
            bestBid { amounts { usdCents eurCents referenceCurrency } }
          }
        }
      }
    `;

    const baseFilters = [
      { field: "sport", operator: "EQUAL", values: [{ stringValue: "nba" }] },
      { field: "rarity", operator: "EQUAL", values: [{ stringValue: rarity }] },
    ];

    interface RawBargainCard {
      slug: string;
      assetId: string;
      rarityTyped: Rarity;
      seasonYear: number;
      inSeasonEligible: boolean;
      pictureUrl?: string | null;
      cardEditionName?: string | null;
      ownershipHistory?: Array<{ transferType: string }>;
      anyTeam: { name: string; slug: string } | null;
      anyPlayer: {
        slug: string;
        displayName: string;
        anyPositions: string[];
        l10: number | null;
        l5: number | null;
        projected: number | null;
        gameplayTier?: string | null;
      };
      liveSingleSaleOffer?: LiveOfferRaw | null;
      livePrimaryOffer?: { price?: MonetaryAmountsRaw | null } | null;
      latestEnglishAuction?: AuctionRaw | null;
    }

    interface GroupedIdsResp {
      searchGroupedCards: {
        groups: Array<{
          hits: Array<{ card: { assetId: string } | null }>;
        }>;
      };
    }

    interface HydrateCardsResp {
      anyCards: RawBargainCard[];
    }

    interface AuctionIdsResp {
      searchCards: {
        hits: Array<{
          card: {
            assetId: string;
            latestEnglishAuction?: { endDate?: string | null } | null;
          } | null;
        }>;
      };
    }

    const useFast = this.hasApiKey();
    const hydrateChunkSize = useFast ? 35 : 12;
    const auctionChunkSize = useFast ? 35 : 10;
    const activeSeasonStr = String(getActiveNbaSeasonYear());
    const activeSeasonNum = Number(activeSeasonStr);
    const draft26SlugValues = Array.from(NBA_26_DRAFT_TOP_30_SLUGS).map(
      (slug) => ({ stringValue: slug }),
    );
    const now = Date.now();
    const bySlug = new Map<string, BargainListing>();
    const hydratedAssetIds = new Set<string>();

    const recordCard = (
      c: RawBargainCard,
      passKind: "auction" | "primary_instant" | "secondary_instant",
    ): void => {
      if (bySlug.has(c.slug)) return;

      let saleType: "instant_buy" | "auction" = "instant_buy";
      let isPrimaryOffer = false;
      let priceCents: number | null = null;
      let endDate: string | null = null;
      let bidsCount: number | null = null;

      if (passKind === "auction") {
        const auc = c.latestEnglishAuction;
        if (!auc || auc.cancelled) return;
        const aucEnd = auc.endDate ? Date.parse(auc.endDate) : 0;
        if (
          !Number.isFinite(aucEnd) ||
          aucEnd <= now ||
          aucEnd - now > MAX_REALISTIC_AUCTION_REMAINING_MS
        ) {
          return;
        }
        priceCents = parseAuctionPriceCents(auc, currency);
        if (priceCents === null) return;
        saleType = "auction";
        endDate = auc.endDate ?? null;
        bidsCount = auc.bidsCount ?? 0;
      } else if (passKind === "primary_instant") {
        const primaryPrice = c.livePrimaryOffer?.price;
        if (!primaryPrice) return;
        priceCents = convertAmountsToCurrencyCents(primaryPrice, currency);
        if (priceCents === null) return;
        saleType = "instant_buy";
        isPrimaryOffer = true;
      } else {
        const offer = c.liveSingleSaleOffer;
        if (!offer) return;
        if (
          offer.dealStatus &&
          offer.dealStatus !== "opened" &&
          offer.dealStatus !== "UNKNOWN"
        ) {
          return;
        }
        priceCents = convertAmountsToCurrencyCents(
          offer.receiverSide?.amounts,
          currency,
        );
        if (priceCents === null) return;
        saleType = "instant_buy";
        endDate = offer.endDate ?? null;
      }

      const l10 = c.anyPlayer.l10 ?? 0;
      const l5 =
        typeof c.anyPlayer.l5 === "number"
          ? Math.round(c.anyPlayer.l5 * 10) / 10
          : null;
      const projected =
        typeof c.anyPlayer.projected === "number"
          ? Math.round(c.anyPlayer.projected * 10) / 10
          : null;

      const { centsPerL10, valueScore } = scoreBargainListing(
        l10,
        priceCents,
        c.inSeasonEligible,
        l5,
      );
      const positions = (c.anyPlayer.anyPositions ?? []).filter(
        (pos): pos is NbaPosition =>
          pos === "basketball_guard" ||
          pos === "basketball_forward" ||
          pos === "basketball_center",
      );

      const isFirstOwnerEligible =
        (isPrimaryOffer || saleType === "auction") &&
        (c.inSeasonEligible || c.seasonYear >= activeSeasonNum) &&
        (c.ownershipHistory?.length ?? 0) === 0;

      bySlug.set(c.slug, {
        cardSlug: c.slug,
        assetId: c.assetId,
        playerSlug: c.anyPlayer.slug,
        playerName: c.anyPlayer.displayName,
        teamName: c.anyTeam?.name ?? null,
        teamSlug: c.anyTeam?.slug ?? null,
        pictureUrl: c.pictureUrl ?? null,
        cardEditionName: c.cardEditionName ?? null,
        isPrimaryOffer,
        isFirstOwnerEligible,
        positions,
        rarity: c.rarityTyped,
        seasonYear: c.seasonYear,
        inSeasonEligible: c.inSeasonEligible,
        l10,
        l5,
        projected,
        ...(() => {
          const rating = resolveStarRating(c.anyPlayer.gameplayTier, l10);
          return { starCost: rating.stars, starSource: rating.source };
        })(),
        saleType,
        priceCents,
        currency,
        endDate,
        bidsCount,
        centsPerL10,
        valueScore,
        marketUrl: `${SORARE_NBA_CARD_URL}/${c.slug}`,
      });
    };

    const runGroupedBuys = async (
      passKind: "primary_instant" | "secondary_instant",
      extraFilters: Array<Record<string, unknown>>,
      groupPageSize: number,
      maxHydrate: number,
      tag: string,
      sortField: "price" | "best_value" = "price",
      sortDir: "ASC" | "DESC" = "ASC",
    ): Promise<void> => {
      if (signal?.aborted) return;
      const groupResp = await this.postGraphQL<GroupedIdsResp>(
        groupedDiscoverQuery,
        {
          filters: [...baseFilters, ...extraFilters],
          sorts: [{ field: sortField, direction: sortDir }],
          pageSize: groupPageSize,
        },
        `bargains_grp_v8:${rarity}:${tag}:${sortField}:${sortDir}:${groupPageSize}`,
        signal,
      );

      const ids = Array.from(
        new Set(
          (groupResp.searchGroupedCards?.groups ?? [])
            .map((g) => g.hits?.[0]?.card?.assetId)
            .filter(
              (id): id is string =>
                typeof id === "string" &&
                id.length > 0 &&
                !hydratedAssetIds.has(id),
            ),
        ),
      ).slice(0, maxHydrate);

      for (const id of ids) hydratedAssetIds.add(id);

      for (let i = 0; i < ids.length; i += hydrateChunkSize) {
        if (signal?.aborted) break;
        const chunk = ids.slice(i, i + hydrateChunkSize);
        const hydResp = await this.postGraphQL<HydrateCardsResp>(
          hydrateBuyQuery,
          { assetIds: chunk },
          `bargains_hyd_v7:${rarity}:${tag}:${i}:${chunk.length}`,
          signal,
        );
        for (const c of hydResp.anyCards ?? []) {
          recordCard(c, passKind);
        }
      }
    };

    const runEndingAuctionPass = async (
      extraFilters: Array<Record<string, unknown>>,
      pageSize: number,
      maxHydrate: number,
      tag: string,
    ): Promise<void> => {
      if (signal?.aborted) return;
      const discResp = await this.postGraphQL<AuctionIdsResp>(
        discoverAuctionIdsQuery,
        {
          filters: [...baseFilters, ...extraFilters],
          sorts: [{ field: "sale.end_date", direction: "ASC" }],
          page: 1,
          pageSize,
        },
        `bargains_auc_disc_v7:${rarity}:${tag}:${pageSize}`,
        signal,
      );

      const ids: string[] = [];
      for (const hit of discResp.searchCards?.hits ?? []) {
        const assetId = hit.card?.assetId;
        const endDate = hit.card?.latestEnglishAuction?.endDate;
        if (!assetId || !endDate || hydratedAssetIds.has(assetId)) continue;
        const endMs = Date.parse(endDate);
        if (
          !Number.isFinite(endMs) ||
          endMs <= now ||
          endMs - now > MAX_REALISTIC_AUCTION_REMAINING_MS
        ) {
          continue;
        }
        hydratedAssetIds.add(assetId);
        ids.push(assetId);
        if (ids.length >= maxHydrate) break;
      }

      for (let i = 0; i < ids.length; i += auctionChunkSize) {
        if (signal?.aborted) break;
        const chunk = ids.slice(i, i + auctionChunkSize);
        const hydResp = await this.postGraphQL<HydrateCardsResp>(
          hydrateAuctionQuery,
          { assetIds: chunk },
          `bargains_auc_hyd_v7:${rarity}:${tag}:${i}:${chunk.length}`,
          signal,
        );
        for (const c of hydResp.anyCards ?? []) {
          recordCard(c, "auction");
        }
      }
    };

    if (mode === "primary_instant") {
      await runGroupedBuys(
        "primary_instant",
        [
          {
            field: "sale.type",
            operator: "EQUAL",
            values: [{ stringValue: "PrimaryOffer" }],
          },
          {
            field: "season",
            operator: "EQUAL",
            values: [{ stringValue: activeSeasonStr }],
          },
        ],
        useFast ? 40 : 35,
        useFast ? 40 : 24,
        `prim_${activeSeasonStr}`,
      );

      await runGroupedBuys(
        "primary_instant",
        [
          {
            field: "sale.type",
            operator: "EQUAL",
            values: [{ stringValue: "PrimaryOffer" }],
          },
          {
            field: "season",
            operator: "EQUAL",
            values: [{ stringValue: activeSeasonStr }],
          },
          {
            field: "player.slug",
            operator: "EQUAL",
            values: draft26SlugValues,
          },
        ],
        30,
        30,
        `prim_draft26_${activeSeasonStr}`,
      );
      return Array.from(bySlug.values());
    }

    if (mode === "ending_auctions") {
      await runEndingAuctionPass(
        [
          {
            field: "sale.type",
            operator: "EQUAL",
            values: [{ stringValue: "EnglishAuction" }],
          },
          {
            field: "season",
            operator: "EQUAL",
            values: [{ stringValue: activeSeasonStr }],
          },
        ],
        30,
        useFast ? 30 : 20,
        `auc_${activeSeasonStr}`,
      );

      await runEndingAuctionPass(
        [
          {
            field: "sale.type",
            operator: "EQUAL",
            values: [{ stringValue: "EnglishAuction" }],
          },
          {
            field: "season",
            operator: "EQUAL",
            values: [{ stringValue: activeSeasonStr }],
          },
          {
            field: "player.slug",
            operator: "EQUAL",
            values: draft26SlugValues,
          },
        ],
        15,
        15,
        `auc_draft26_${activeSeasonStr}`,
      );

      await runEndingAuctionPass(
        [
          {
            field: "sale.type",
            operator: "EQUAL",
            values: [{ stringValue: "EnglishAuction" }],
          },
        ],
        25,
        useFast ? 20 : 10,
        "auc_all",
      );
      return Array.from(bySlug.values());
    }

    // mode === "instant_value": best-value starters + unique cheap players across all seasons, 2026 In-Season, and 1ST Primary Offers
    await runGroupedBuys(
      "secondary_instant",
      [
        {
          field: "sale.type",
          operator: "EQUAL",
          values: [{ stringValue: "SingleSaleOffer" }],
        },
      ],
      useFast ? 40 : 30,
      useFast ? 36 : 24,
      "sso_best_val_all",
      "best_value",
      "DESC",
    );

    await runGroupedBuys(
      "secondary_instant",
      [
        {
          field: "sale.type",
          operator: "EQUAL",
          values: [{ stringValue: "SingleSaleOffer" }],
        },
      ],
      useFast ? 40 : 25,
      useFast ? 36 : 24,
      "sso_all",
    );

    await runGroupedBuys(
      "secondary_instant",
      [
        {
          field: "sale.type",
          operator: "EQUAL",
          values: [{ stringValue: "SingleSaleOffer" }],
        },
        {
          field: "season",
          operator: "EQUAL",
          values: [{ stringValue: activeSeasonStr }],
        },
      ],
      useFast ? 40 : 30,
      useFast ? 36 : 24,
      `sso_${activeSeasonStr}`,
      "best_value",
      "DESC",
    );

    await runGroupedBuys(
      "primary_instant",
      [
        {
          field: "sale.type",
          operator: "EQUAL",
          values: [{ stringValue: "PrimaryOffer" }],
        },
        {
          field: "season",
          operator: "EQUAL",
          values: [{ stringValue: activeSeasonStr }],
        },
      ],
      25,
      useFast ? 24 : 12,
      `prim_${activeSeasonStr}`,
    );

    return Array.from(bySlug.values());
  }
}

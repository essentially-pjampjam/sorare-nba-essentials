import {
  getActiveNbaSeasonYear,
  LEAGUE_ESSENCE_MISSIONS,
  NBA_26_CONF_FINALS_TEAMS,
  NBA_26_DRAFT_TOP_30_SLUGS,
  NBA_26_PLAYOFF_TEAMS,
  SORARE_NBA_MARKET_URL,
} from "../shared/constants";
import type {
  BargainListing,
  CollectionAnalysis,
  GalleryCard,
  InjuryReportEntry,
  QuestCardSummary,
  QuestShoppingCandidate,
} from "../shared/types";
import { normalizePlayerName } from "./lineupOptimizerMath";

export interface QuestProgressItem {
  id: string;
  name: string;
  description: string;
  firstOwnerOnly: boolean;
  essenceReward: number;
  target: number;
  current: number;
  remaining: number;
  progressPct: number;
  essencePerRemainingCard: number;
  closestTeamName?: string;
  closestTeamCostCents?: number | null;
  marketFilterUrl: string;
  isTopOptimal: boolean;
  cheapestBuys: QuestShoppingCandidate[];
}

type QuestStep = { target: number; reward: number };
const ladder = (targets: number[], rewards: number[]): QuestStep[] =>
  targets.map((target, i) => ({ target, reward: rewards[i] }));

/**
 * Live NBA League Collect ladders (Sorare `TasksTrack.steps`, checked 2026-11-20). Each quest has
 * its own milestones and Essence rewards; Full Collection counts complete teams.
 */
export const QUEST_LADDERS: Record<string, QuestStep[]> = {
  "draft-26": ladder([5, 10, 12, 14, 16, 18, 20, 25, 28, 30], [500, 500, 500, 500, 500, 500, 1000, 1000, 1000, 3000]),
  "non-playoffs-26": ladder(
    [10, 20, 35, 50, 75, 100, 125, 150, 200, 250],
    [1000, 1000, 1000, 2000, 2000, 2000, 3000, 4000, 4500, 5000],
  ),
  "playoffs-26": ladder(
    [12, 25, 40, 60, 80, 100, 125, 150, 175, 200],
    [500, 500, 750, 750, 1000, 2000, 3000, 4000, 5000, 6000],
  ),
  "conf-finals-26": ladder(
    [10, 15, 20, 25, 30, 40, 50, 60, 65, 70],
    [500, 500, 750, 750, 1000, 2000, 3000, 4000, 5000, 6000],
  ),
  "full-collection": ladder(
    [1, 3, 6, 8, 10, 12, 15, 20, 25, 30],
    [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 15000],
  ),
};

/** Next milestone above `current` for a quest (last step once the ladder is finished). */
export function resolveNextQuestStep(questId: string, current: number): QuestStep {
  const steps = QUEST_LADDERS[questId] ?? QUEST_LADDERS["draft-26"];
  return steps.find((s) => s.target > current) ?? steps[steps.length - 1];
}

function classifyPlayerQuests(
  teamSlug: string | null,
  _cardEditionName: string | null | undefined,
  closestFullTeamSlots: Set<string>,
  playerSlug: string,
): { ids: string[]; labels: string[] } {
  const ids: string[] = [];
  const labels: string[] = [];

  if (NBA_26_DRAFT_TOP_30_SLUGS.has(playerSlug)) {
    ids.push("draft-26");
    labels.push("Draft 26'");
  }
  if (teamSlug) {
    if (NBA_26_CONF_FINALS_TEAMS.has(teamSlug)) {
      ids.push("conf-finals-26");
      labels.push("26' Conf Finals");
    } else if (NBA_26_PLAYOFF_TEAMS.has(teamSlug)) {
      ids.push("playoffs-26");
      labels.push("26' Playoffs");
    } else {
      ids.push("non-playoffs-26");
      labels.push("26' Non Playoffs");
    }
  }
  if (closestFullTeamSlots.has(playerSlug)) {
    ids.push("full-collection");
    labels.push("Full Team");
  }
  return { ids, labels };
}

/**
 * Evaluates live progress, marginal Essence ROI, and cheapest eligible shopping candidates
 * across the 5 NBA League Collect Quests using 2026 first-owner cards, team collections,
 * and scanned market deals.
 */
export function evaluateLeagueQuests(
  questCards: QuestCardSummary[],
  collectionAnalyses: CollectionAnalysis[],
  rarity: string,
  bargainListings: BargainListing[] = [],
): {
  quests: QuestProgressItem[];
  bestOverallSummary: string;
  totalLiveQuestEssence: number;
  topQuestInstantCostCents: number | null;
} {
  const activeSeason = Math.max(
    getActiveNbaSeasonYear(),
    ...questCards.map((c) => c.seasonYear),
  );
  const firstOwner2026 = questCards.filter(
    (c) => c.seasonYear >= activeSeason && c.isFirstOwner,
  );

  // Deduplicate by playerSlug so multiple prints of the same player count cleanly once
  const uniqueFirstOwners = new Map<string, QuestCardSummary>();
  for (const c of firstOwner2026) {
    if (!uniqueFirstOwners.has(c.playerSlug)) {
      uniqueFirstOwners.set(c.playerSlug, c);
    }
  }
  const pool = Array.from(uniqueFirstOwners.values());

  let confFinalsCount = 0;
  let playoffsCount = 0;
  let nonPlayoffsCount = 0;
  let draftCandidateCount = 0;

  for (const c of pool) {
    const team = c.teamSlug ?? "";
    if (NBA_26_CONF_FINALS_TEAMS.has(team)) {
      confFinalsCount += 1;
    } else if (NBA_26_PLAYOFF_TEAMS.has(team)) {
      playoffsCount += 1;
    } else if (team) {
      nonPlayoffsCount += 1;
    }

    // Exact match against Sorare's Draft 26' Top-30 rookie pool
    if (
      NBA_26_DRAFT_TOP_30_SLUGS.has(c.playerSlug) ||
      (c.cardEditionName === undefined && c.age !== null && c.age <= 20)
    ) {
      draftCandidateCount += 1;
    }
  }

  // Closest active in-season team toward Full Collection (2,000E, secondary allowed)
  const teamCandidates = collectionAnalyses.filter(
    (a) => !a.collection.complete && a.collection.slotsCount > 0,
  );
  const inSeasonTeamCandidates = teamCandidates.filter(
    (a) => a.collection.inSeason && Boolean(a.collection.teamSlug),
  );
  const closestFullTeam =
    [...(inSeasonTeamCandidates.length > 0 ? inSeasonTeamCandidates : teamCandidates)]
      .sort((a, b) => {
        const ra = a.collection.slotsCount - a.collection.fulfilledSlotsCount;
        const rb = b.collection.slotsCount - a.collection.fulfilledSlotsCount;
        if (ra !== rb) return ra - rb;
        return b.collection.fulfilledSlotsCount - a.collection.fulfilledSlotsCount;
      })[0] ?? null;

  const completeTeamsCount = collectionAnalyses.filter((a) => a.collection.complete).length;

  const getCollectionOps = (a: CollectionAnalysis | null | undefined) =>
    a?.opportunities ?? a?.nextEssenceMilestone?.rankedShoppingList ?? [];

  const closestFullTeamSlotSlugs = new Set<string>(
    getCollectionOps(closestFullTeam).map((op) => op.slot.playerSlug),
  );
  const incompleteCollectionPlayerSlugs = new Set<string>();
  for (const a of collectionAnalyses) {
    if (a.collection.complete) continue;
    for (const op of getCollectionOps(a)) {
      incompleteCollectionPlayerSlugs.add(op.slot.playerSlug);
    }
  }

  // Aggregate cheapest eligible current-season market/collection opportunities
  // (keeping primary instant vs <1h auction vs secondary instant separate)
  const nowMs = Date.now();
  const maxAuctionMs = 60 * 60 * 1000;
  const candidateByKey = new Map<string, QuestShoppingCandidate>();
  for (const listing of bargainListings) {
    if (
      (!listing.inSeasonEligible && listing.seasonYear < activeSeason) ||
      listing.priceCents === null
    ) {
      continue;
    }
    const isAuction = listing.saleType === "auction";
    if (isAuction) {
      const endMs = listing.endDate ? Date.parse(listing.endDate) : NaN;
      if (!Number.isFinite(endMs) || endMs <= nowMs || endMs - nowMs > maxAuctionMs) {
        continue;
      }
    }
    if (uniqueFirstOwners.has(listing.playerSlug)) continue;
    const isPrimaryOffer = Boolean(listing.isPrimaryOffer);
    const isFirstEligible = Boolean(listing.isFirstOwnerEligible);
    const { ids, labels } = classifyPlayerQuests(
      listing.teamSlug ?? null,
      listing.cardEditionName ?? null,
      closestFullTeamSlotSlugs,
      listing.playerSlug,
    );
    if (ids.length === 0) continue;

    const bucketKey = `${listing.playerSlug}::${isPrimaryOffer ? "primary_instant" : isAuction ? "auction" : "secondary_instant"}`;
    const existing = candidateByKey.get(bucketKey);
    const shouldReplace =
      !existing ||
      (isFirstEligible && !existing.isFirstOwnerEligible) ||
      (isFirstEligible === existing.isFirstOwnerEligible &&
        listing.priceCents < existing.priceCents);

    if (shouldReplace) {
      candidateByKey.set(bucketKey, {
        playerSlug: listing.playerSlug,
        playerName: listing.playerName,
        teamName: listing.teamName,
        teamSlug: listing.teamSlug ?? null,
        priceCents: listing.priceCents,
        saleType: isAuction ? "auction" : "instant_buy",
        isPrimaryOffer,
        isFirstOwnerEligible: isFirstEligible,
        endDate: listing.endDate ?? null,
        cardSlug: listing.cardSlug,
        marketUrl: listing.marketUrl,
        overlappingQuestIds: ids,
        overlappingQuestLabels: labels,
        advancesTeamCollection: incompleteCollectionPlayerSlugs.has(
          listing.playerSlug,
        ),
      });
    }
  }

  for (const a of collectionAnalyses) {
    if (a.collection.complete) continue;
    for (const op of getCollectionOps(a)) {
      if (op.slot.seasonYear !== null && op.slot.seasonYear < activeSeason) continue;
      if (uniqueFirstOwners.has(op.slot.playerSlug)) continue;

      const { ids, labels } = classifyPlayerQuests(
        op.slot.teamSlug,
        null,
        closestFullTeamSlotSlugs,
        op.slot.playerSlug,
      );
      if (ids.length === 0) continue;

      const defaultMarketUrl = `${SORARE_NBA_MARKET_URL}?player=${encodeURIComponent(op.slot.playerName)}&rarity=${encodeURIComponent(rarity)}`;

      if (op.instantBuyCents !== null) {
        const instantKey = `${op.slot.playerSlug}::secondary_instant`;
        if (!candidateByKey.has(instantKey)) {
          candidateByKey.set(instantKey, {
            playerSlug: op.slot.playerSlug,
            playerName: op.slot.playerName,
            teamName: op.slot.teamName,
            teamSlug: op.slot.teamSlug,
            priceCents: op.instantBuyCents,
            saleType: "instant_buy",
            isPrimaryOffer: false,
            isFirstOwnerEligible: false,
            endDate: null,
            cardSlug: op.market?.instantBuyCardSlug ?? null,
            marketUrl: op.market?.instantBuyUrl ?? defaultMarketUrl,
            overlappingQuestIds: ids,
            overlappingQuestLabels: labels,
            advancesTeamCollection: true,
          });
        }
      }

      if (op.auctionBidCents !== null && op.market?.auctionEndDate) {
        const endMs = Date.parse(op.market.auctionEndDate);
        if (Number.isFinite(endMs) && endMs > nowMs && endMs - nowMs <= maxAuctionMs) {
          const aucKey = `${op.slot.playerSlug}::auction`;
          if (!candidateByKey.has(aucKey)) {
            candidateByKey.set(aucKey, {
              playerSlug: op.slot.playerSlug,
              playerName: op.slot.playerName,
              teamName: op.slot.teamName,
              teamSlug: op.slot.teamSlug,
              priceCents: op.auctionBidCents,
              saleType: "auction",
              isPrimaryOffer: false,
              isFirstOwnerEligible: false,
              endDate: op.market.auctionEndDate,
              cardSlug: op.market?.auctionCardSlug ?? null,
              marketUrl: op.market?.auctionUrl ?? defaultMarketUrl,
              overlappingQuestIds: ids,
              overlappingQuestLabels: labels,
              advancesTeamCollection: true,
            });
          }
        }
      }
    }
  }

  const allCandidates = Array.from(candidateByKey.values());

  const rawItems: QuestProgressItem[] = LEAGUE_ESSENCE_MISSIONS.map((m) => {
    let rawCurrent = 0;
    let target = m.nextStepTarget;
    let essenceReward = m.essenceReward;
    let remaining = target;
    let closestTeamName: string | undefined;
    let closestTeamCostCents: number | null | undefined;
    let marketFilterUrl = `https://sorare.com/nba/market?rarity=${encodeURIComponent(rarity)}`;

    switch (m.id) {
      case "conf-finals-26": {
        rawCurrent = confFinalsCount;
        const step = resolveNextQuestStep(m.id, rawCurrent);
        target = step.target;
        essenceReward = step.reward;
        remaining = Math.max(0, target - rawCurrent);
        marketFilterUrl = `https://sorare.com/nba/market/auctions?rarity=${encodeURIComponent(rarity)}`;
        break;
      }
      case "playoffs-26": {
        rawCurrent = playoffsCount;
        const step = resolveNextQuestStep(m.id, rawCurrent);
        target = step.target;
        essenceReward = step.reward;
        remaining = Math.max(0, target - rawCurrent);
        marketFilterUrl = `https://sorare.com/nba/market/auctions?rarity=${encodeURIComponent(rarity)}`;
        break;
      }
      case "non-playoffs-26": {
        rawCurrent = nonPlayoffsCount;
        const step = resolveNextQuestStep(m.id, rawCurrent);
        target = step.target;
        essenceReward = step.reward;
        remaining = Math.max(0, target - rawCurrent);
        marketFilterUrl = `https://sorare.com/nba/market/auctions?rarity=${encodeURIComponent(rarity)}`;
        break;
      }
      case "draft-26": {
        rawCurrent = draftCandidateCount;
        const step = resolveNextQuestStep(m.id, rawCurrent);
        target = step.target;
        essenceReward = step.reward;
        remaining = Math.max(0, target - rawCurrent);
        marketFilterUrl = `https://sorare.com/nba/market/auctions?rarity=${encodeURIComponent(rarity)}`;
        break;
      }
      case "full-collection":
      default: {
        rawCurrent = completeTeamsCount;
        const step = resolveNextQuestStep("full-collection", rawCurrent);
        target = step.target;
        essenceReward = step.reward;
        const teamMissing = closestFullTeam
          ? Math.max(
              1,
              closestFullTeam.collection.slotsCount -
                closestFullTeam.collection.fulfilledSlotsCount,
            )
          : 15;
        remaining = rawCurrent >= target ? 0 : teamMissing;
        closestTeamName = closestFullTeam?.collection.name;
        const fullTeamInstants = getCollectionOps(closestFullTeam)
          .map((op) => op.instantBuyCents)
          .filter((p): p is number => p !== null);
        closestTeamCostCents =
          remaining > 0 && fullTeamInstants.length >= teamMissing
            ? fullTeamInstants
                .slice(0, teamMissing)
                .reduce((sum, p) => sum + p, 0)
            : (closestFullTeam?.nextEssenceMilestone?.totalCostCents ?? null);
        break;
      }
    }

    const current = Math.min(target, rawCurrent);
    const effectiveDivisor = Math.max(1, remaining);
    const essencePerRemainingCard =
      remaining === 0
        ? 0
        : Math.round((essenceReward / effectiveDivisor) * 10) / 10;

    const progressPct =
      m.id === "full-collection" && closestFullTeam
        ? Math.min(
            100,
            Math.round(
              (closestFullTeam.collection.fulfilledSlotsCount /
                Math.max(1, closestFullTeam.collection.slotsCount)) *
                100,
            ),
          )
        : Math.min(100, Math.round((current / Math.max(1, target)) * 100));

    const matching = allCandidates
      .filter((c) => c.overlappingQuestIds.includes(m.id))
      .sort((a, b) => {
        if (m.firstOwnerOnly && a.isFirstOwnerEligible !== b.isFirstOwnerEligible) {
          return a.isFirstOwnerEligible ? -1 : 1;
        }
        if (a.priceCents !== b.priceCents) return a.priceCents - b.priceCents;
        return b.overlappingQuestIds.length - a.overlappingQuestIds.length;
      });
    const cheapestBuys = [
      ...matching.filter((c) => Boolean(c.isPrimaryOffer)).slice(0, 8),
      ...matching.filter((c) => c.saleType === "auction").slice(0, 8),
      ...matching
        .filter((c) => !c.isPrimaryOffer && c.saleType === "instant_buy")
        .slice(0, 8),
    ].sort((a, b) => {
      if (m.firstOwnerOnly && a.isFirstOwnerEligible !== b.isFirstOwnerEligible) {
        return a.isFirstOwnerEligible ? -1 : 1;
      }
      if (a.priceCents !== b.priceCents) return a.priceCents - b.priceCents;
      return b.overlappingQuestIds.length - a.overlappingQuestIds.length;
    });

    return {
      id: m.id,
      name: m.name,
      description: m.description,
      firstOwnerOnly: m.firstOwnerOnly,
      essenceReward,
      target,
      current,
      remaining,
      progressPct,
      essencePerRemainingCard,
      closestTeamName,
      closestTeamCostCents,
      marketFilterUrl,
      isTopOptimal: false,
      cheapestBuys,
    };
  });

  // Sort by highest marginal Essence per remaining card needed
  const ranked = [...rawItems].sort((a, b) => {
    if (b.essencePerRemainingCard !== a.essencePerRemainingCard) {
      return b.essencePerRemainingCard - a.essencePerRemainingCard;
    }
    return a.remaining - b.remaining;
  });

  if (ranked.length > 0) {
    ranked[0].isTopOptimal = true;
  }

  const top = ranked[0];
  const totalLiveQuestEssence = ranked
    .filter((q) => q.remaining > 0)
    .reduce((sum, q) => sum + q.essenceReward, 0);

  let topQuestInstantCostCents: number | null = null;
  if (top && top.remaining > 0) {
    if (top.id === "full-collection") {
      topQuestInstantCostCents = top.closestTeamCostCents ?? null;
    } else {
      const eligibleInstantPrices = top.cheapestBuys
        .filter((c) =>
          top.firstOwnerOnly
            ? Boolean(c.isPrimaryOffer)
            : c.saleType === "instant_buy",
        )
        .map((c) => c.priceCents)
        .sort((a, b) => a - b);
      if (eligibleInstantPrices.length >= top.remaining) {
        topQuestInstantCostCents = eligibleInstantPrices
          .slice(0, top.remaining)
          .reduce((sum, p) => sum + p, 0);
      }
    }
  }

  const bestOverallSummary = top
    ? top.id === "full-collection"
      ? `Closest Full Team (${top.closestTeamName ?? "NBA Team"}): ${top.remaining} cards to +2,000E (Instant Buys OK)`
      : `Best Quest ROI: ${top.name} (${top.current}/${top.target} • ${top.remaining} 1st-owner cards away for +${top.essenceReward}E = +${top.essencePerRemainingCard}E/card)`
    : "Scan your collections to compute League Quest optimality.";

  return {
    quests: ranked,
    bestOverallSummary,
    totalLiveQuestEssence,
    topQuestInstantCostCents,
  };
}

/**
 * Surfaces team-level OUT star alerts so healthy teammates benefit from extra NBA usage.
 */
export function buildTeamOutStarMap(
  cards: GalleryCard[],
  injuriesByName: Record<string, InjuryReportEntry>,
): Record<string, string> {
  const outByTeam: Record<string, { name: string; l10: number }> = {};

  for (const c of cards) {
    if (!c.teamSlug) continue;
    const norm = normalizePlayerName(c.playerName);
    const inj = injuriesByName[norm];
    if (inj?.status === "OUT" && (c.l10 ?? 0) >= 28) {
      const prev = outByTeam[c.teamSlug];
      if (!prev || (c.l10 ?? 0) > prev.l10) {
        outByTeam[c.teamSlug] = { name: c.playerName, l10: c.l10 ?? 0 };
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [slug, val] of Object.entries(outByTeam)) {
    out[slug] = `Usage ↑ (${val.name.split(" ").pop()} OUT)`;
  }
  return out;
}

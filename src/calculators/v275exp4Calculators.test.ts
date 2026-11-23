import { describe, expect, it } from "vitest";
import { recommendBestCraftClue, DEFAULT_CRAFT_CLUES } from "./craftAdvisorMath";
import { estimateTierRewardEv } from "./entryEvMath";
import { evaluateInjuryBeneficiaries } from "./injuryImpactMath";
import { evaluateCardForLineup } from "./lineupOptimizerMath";
import { summarizeRewardTiers } from "./rewardTiersMath";
import {
  evaluateUnsealResealOpportunities,
  mergeSealedBaselineSnapshots,
} from "./vaultSealingMath";
import { computePeakOrderStatistic, computePerGamePeakMultiplier } from "./vegasMath";
import type {
  CraftPoolPlayer,
  GalleryCard,
  InjuryReportEntry,
  TeamSlateSchedule,
} from "../shared/types";

function makeCard(overrides: Partial<GalleryCard> = {}): GalleryCard {
  return {
    slug: "card-1",
    rarity: "limited",
    seasonYear: 2026,
    inSeasonEligible: true,
    grade: 10,
    powerMultiplier: 1.0,
    teamName: "Boston Celtics",
    teamSlug: "boston-celtics",
    playerSlug: "player-1",
    playerName: "Player One",
    positions: ["basketball_guard"],
    l10: 30,
    l5: 32,
    sorareClassicProjected: 30,
    sorareDailyProjected: 30,
    starCost: 3,
    ...overrides,
  };
}

describe("v2.7.5-exp4 pure calculators", () => {
  describe("per-game Vegas/B2B peak order statistics", () => {
    it("returns exact single-game mean for 1 game and higher expected max for 2+ games", () => {
      expect(computePeakOrderStatistic([], 0.35)).toBe(0);
      expect(computePeakOrderStatistic([40], 0.35)).toBe(40);
      const twoEqual = computePeakOrderStatistic([40, 40], 0.35);
      // For two identical normals N(40, 14^2), E[max] = 40 + 14 / sqrt(pi) = ~47.90
      expect(twoEqual).toBeGreaterThan(47.5);
      expect(twoEqual).toBeLessThan(48.3);
      const threeEqual = computePeakOrderStatistic([40, 40, 40], 0.35);
      expect(threeEqual).toBeGreaterThan(twoEqual);
    });

    it("favors a 2G slate with one shootout + one B2B over two neutral B2B blowout games", () => {
      const shootoutAndB2B = computePerGamePeakMultiplier([
        { impliedTeamTotal: 124, spread: -2, blowoutRisk: false, isBackToBack: false },
        { impliedTeamTotal: 108, spread: -12, blowoutRisk: true, isBackToBack: true },
      ]);
      const twoBadGames = computePerGamePeakMultiplier([
        { impliedTeamTotal: 108, spread: -12, blowoutRisk: true, isBackToBack: true },
        { impliedTeamTotal: 108, spread: -12, blowoutRisk: true, isBackToBack: true },
      ]);
      expect(shootoutAndB2B).toBeGreaterThan(twoBadGames);
    });

    it("wires gameContexts into evaluateCardForLineup without double-counting Vegas/rest", () => {
      const card = makeCard({ l10: 30, l5: 30, sorareClassicProjected: 30 });
      const sched: Record<string, TeamSlateSchedule> = {
        "boston-celtics": {
          teamSlug: "boston-celtics",
          teamName: "Boston Celtics",
          abbr: "BOS",
          games: 2,
          matchups: ["vs LAL", "@ GSW"],
          hasBackToBack: true,
          difficultyTag: "NEUTRAL",
          impliedTeamTotal: 122,
          blowoutRisk: false,
          gameContexts: [
            { date: "2026-11-22", matchup: "vs LAL", impliedTeamTotal: 122, spread: -3, blowoutRisk: false, isBackToBack: false },
            { date: "2026-11-23", matchup: "@ GSW", impliedTeamTotal: 112, spread: 4, blowoutRisk: false, isBackToBack: true },
          ],
        },
      };
      const ev = evaluateCardForLineup(card, "sorare_l10", new Map(), {}, { "boston-celtics": 2 }, sched);
      expect(ev.boostSummary.vegasMultiplier).toBe(1);
      expect(ev.boostSummary.restMultiplier).toBe(1);
      expect(ev.boostSummary.slateMultiplier).toBeGreaterThan(1.1);
      expect(ev.effectiveScore).toBeGreaterThan(33);
    });
  });

  describe("live rewardTiers-driven Dollar/Essence EV", () => {
    it("summarizes cash and Essence tiers and parses them cleanly for EV", () => {
      const summary = summarizeRewardTiers([
        { ranks: 1, rewardConfigs: [{ __typename: "MonetaryRewardConfig", amount: { usdCents: 100000 } }] },
        { ranks: 2, rewardConfigs: [{ __typename: "MonetaryRewardConfig", amount: { usdCents: 25000 } }] },
        { ranks: 50, rewardConfigs: [{ __typename: "CardShardRewardConfig", quantity: 100 }] },
      ]);
      expect(summary.tiers[0].label).toBe("$1,000");
      expect(summary.tiers[1].label).toBe("$250");
      expect(summary.tiers[2].label).toBe("100 Essence");
    });

    it("computes higher cash and Essence EV for stronger projected lineups", () => {
      const tiers = summarizeRewardTiers([
        { ranks: 1, rewardConfigs: [{ __typename: "MonetaryRewardConfig", amount: { usdCents: 50000 } }] },
        { ranks: 9, rewardConfigs: [{ __typename: "MonetaryRewardConfig", amount: { usdCents: 5000 } }] },
        { ranks: 90, rewardConfigs: [{ __typename: "CardShardRewardConfig", quantity: 150 }] },
      ]).tiers;

      const weak = estimateTierRewardEv({
        mean: 140,
        sd: 28,
        paidPlaces: 100,
        paidCutoffScore: 180,
        podiumScore: 240,
        top1Score: 260,
        rewardTiers: tiers,
      });
      const strong = estimateTierRewardEv({
        mean: 215,
        sd: 28,
        paidPlaces: 100,
        paidCutoffScore: 180,
        podiumScore: 240,
        top1Score: 260,
        rewardTiers: tiers,
      });

      expect(strong.expectedCashUsd).toBeGreaterThan(weak.expectedCashUsd);
      expect(strong.expectedEssence).toBeGreaterThan(weak.expectedEssence);
      expect(strong.expectedCashUsd).toBeGreaterThan(0);
      expect(strong.expectedEssence).toBeGreaterThan(0);
    });

    it("returns zeros cleanly when mean or rewardTiers are missing", () => {
      const empty = estimateTierRewardEv({
        mean: null,
        sd: 25,
        paidPlaces: 50,
        paidCutoffScore: 170,
        rewardTiers: [],
      });
      expect(empty.expectedCashUsd).toBe(0);
      expect(empty.expectedEssence).toBe(0);
    });
  });

  describe("position-aware injury impact analyzer", () => {
    it("gives higher boost to exact-position healthy teammates than cross-position teammates", () => {
      const injuredStar = makeCard({
        slug: "star-g",
        playerSlug: "star-g",
        playerName: "Star Guard",
        positions: ["basketball_guard"],
        l10: 45,
      });
      const backupGuard = makeCard({
        slug: "backup-g",
        playerSlug: "backup-g",
        playerName: "Backup Guard",
        positions: ["basketball_guard"],
        l10: 22,
      });
      const center = makeCard({
        slug: "center-c",
        playerSlug: "center-c",
        playerName: "Team Center",
        positions: ["basketball_center"],
        l10: 24,
      });
      const injuries: Record<string, InjuryReportEntry> = {
        "star guard": {
          playerName: "Star Guard",
          normalizedName: "star guard",
          teamName: "Boston Celtics",
          status: "OUT",
          rawStatus: "Out",
          comment: "Ankle",
        },
      };

      const impacts = evaluateInjuryBeneficiaries(
        [injuredStar, backupGuard, center],
        injuries,
        { gamesPerTeam: { "boston-celtics": 2 } },
      );

      expect(impacts).toHaveLength(1);
      expect(impacts[0].beneficiaries[0].card.playerName).toBe("Backup Guard");
      expect(impacts[0].beneficiaries[0].positionMatch).toBe("EXACT");
      expect(impacts[0].beneficiaries[0].estimatedBoostPts).toBeGreaterThan(
        impacts[0].beneficiaries[1].estimatedBoostPts,
      );
    });
  });

  describe("Craft Clue EVOI Advisor", () => {
    it("ranks unused clues by EVOI and information gain and marks used clues", () => {
      const pool: CraftPoolPlayer[] = [
        {
          playerSlug: "p1",
          playerName: "Superstar",
          teamSlug: "boston-celtics",
          teamName: "Boston Celtics",
          conference: "EAST",
          positions: ["basketball_forward"],
          age: 26,
          averageL10: 52,
          qualityTier: "TIER_0",
          availableSupply: 10,
          floorCents: 15000,
          floorCardSlug: null,
          marketUrl: "https://sorare.com/nba/market",
        },
        {
          playerSlug: "p2",
          playerName: "Starter",
          teamSlug: "los-angeles-lakers",
          teamName: "Los Angeles Lakers",
          conference: "WEST",
          positions: ["basketball_guard"],
          age: 29,
          averageL10: 34,
          qualityTier: "TIER_2",
          availableSupply: 40,
          floorCents: 1200,
          floorCardSlug: null,
          marketUrl: "https://sorare.com/nba/market",
        },
        {
          playerSlug: "p3",
          playerName: "Bench",
          teamSlug: "miami-heat",
          teamName: "Miami Heat",
          conference: "EAST",
          positions: ["basketball_center"],
          age: 21,
          averageL10: 15,
          qualityTier: "TIER_4",
          availableSupply: 50,
          floorCents: 200,
          floorCardSlug: null,
          marketUrl: "https://sorare.com/nba/market",
        },
      ];

      const report = recommendBestCraftClue(pool, DEFAULT_CRAFT_CLUES);
      expect(report.bestClue).not.toBeNull();
      expect(report.rankedClues.length).toBeGreaterThan(0);
      expect(report.bestClue!.expectedPoolReductionPct).toBeGreaterThan(0);
      expect(report.bestClue!.evoiCents).toBeGreaterThan(0);

      const withConfUsed = recommendBestCraftClue(pool, {
        ...DEFAULT_CRAFT_CLUES,
        conference: "EAST",
      });
      const confRow = withConfUsed.rankedClues.find((c) => c.id === "conference");
      expect(confRow?.alreadyUsed).toBe(true);
    });
  });

  describe("Vault Unseal & Reseal Profit Detector", () => {
    it("merges sealed baselines and detects ready vs cooldown profit opportunities", () => {
      const now = Date.parse("2026-11-22T12:00:00Z");
      const cardA = makeCard({
        slug: "sealed-ready",
        playerName: "Ready Star",
        sealed: true,
        sealingPoints: 120,
        unsealableAt: "2026-11-20T00:00:00Z",
      });
      const cardB = makeCard({
        slug: "sealed-cool",
        playerName: "Cooldown Star",
        sealed: true,
        sealingPoints: 100,
        unsealableAt: "2026-11-27T12:00:00Z",
      });
      const cardC = makeCard({
        slug: "unsealed",
        playerName: "Playable",
        sealed: false,
        sealingPoints: 80,
      });

      const initialBaselines = mergeSealedBaselineSnapshots({}, [cardA, cardB, cardC], now - 86_400_000);
      expect(initialBaselines["sealed-ready"]?.sp).toBe(120);
      expect(initialBaselines["unsealed"]).toBeUndefined();

      // Simulate live SP rising on both sealed cards
      const updatedA = { ...cardA, sealingPoints: 180 };
      const updatedB = { ...cardB, sealingPoints: 145 };
      const opps = evaluateUnsealResealOpportunities([updatedA, updatedB, cardC], initialBaselines, now);

      expect(opps).toHaveLength(2);
      expect(opps[0].cardSlug).toBe("sealed-ready");
      expect(opps[0].status).toBe("PROFIT_READY");
      expect(opps[0].netSpGain).toBe(60);
      expect(opps[0].canUnsealNow).toBe(true);

      expect(opps[1].cardSlug).toBe("sealed-cool");
      expect(opps[1].status).toBe("PROFIT_COOLDOWN");
      expect(opps[1].netSpGain).toBe(45);
      expect(opps[1].cooldownDaysLeft).toBe(5);
    });
  });
});

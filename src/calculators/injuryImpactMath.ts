import type {
  GalleryCard,
  InjuryReportEntry,
  NbaPosition,
} from "../shared/types";
import { normalizePlayerName } from "./lineupOptimizerMath";

export type PositionMatchKind = "EXACT" | "ADJACENT" | "TEAM";

export interface InjuredPlayerSummary {
  playerName: string;
  normalizedName: string;
  status: "OUT" | "DOUBTFUL";
  positions: NbaPosition[];
  l10: number | null;
  comment: string;
}

export interface InjuryBeneficiary {
  card: GalleryCard;
  isOwned: boolean;
  positionMatch: PositionMatchKind;
  estimatedBoostPts: number;
  boostedProjPts: number;
  reason: string;
}

export interface TeamInjuryImpact {
  teamSlug: string;
  teamName: string;
  gamesInSlate: number;
  injuredPlayers: InjuredPlayerSummary[];
  beneficiaries: InjuryBeneficiary[];
}

function teamNameToSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function positionOverlapWeight(
  injuredPositions: NbaPosition[],
  healthyPositions: NbaPosition[],
): { match: PositionMatchKind; weight: number } {
  if (injuredPositions.length === 0 || healthyPositions.length === 0) {
    return { match: "TEAM", weight: 0.45 };
  }
  const hasExact = injuredPositions.some((p) => healthyPositions.includes(p));
  if (hasExact) return { match: "EXACT", weight: 1.0 };

  // Adjacent: G <-> F or F <-> C
  const adjacent =
    (injuredPositions.includes("basketball_guard") &&
      healthyPositions.includes("basketball_forward")) ||
    (injuredPositions.includes("basketball_forward") &&
      healthyPositions.includes("basketball_guard")) ||
    (injuredPositions.includes("basketball_forward") &&
      healthyPositions.includes("basketball_center")) ||
    (injuredPositions.includes("basketball_center") &&
      healthyPositions.includes("basketball_forward"));
  if (adjacent) return { match: "ADJACENT", weight: 0.55 };

  return { match: "TEAM", weight: 0.25 };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Position-aware "Who Steps Up" injury impact analyzer.
 * Identifies OUT/DOUBTFUL players on teams with upcoming games and ranks healthy
 * teammates weighted by position match (EXACT G/F/C > ADJACENT > TEAM) and baseline usage.
 */
export function evaluateInjuryBeneficiaries(
  ownedCards: GalleryCard[],
  injuriesByName: Record<string, InjuryReportEntry>,
  options: {
    rosterCards?: GalleryCard[];
    gamesPerTeam?: Record<string, number>;
    maxTeams?: number;
    maxBeneficiariesPerTeam?: number;
  } = {},
): TeamInjuryImpact[] {
  const maxTeams = options.maxTeams ?? 8;
  const maxBeneficiariesPerTeam = options.maxBeneficiariesPerTeam ?? 4;
  const gamesPerTeam = options.gamesPerTeam ?? {};
  const hasSchedule = Object.keys(gamesPerTeam).length > 0;

  // Deduplicate cards by playerSlug, preferring owned cards over roster stand-ins
  const ownedSlugs = new Set<string>();
  const cardByPlayer = new Map<string, { card: GalleryCard; isOwned: boolean }>();
  for (const c of ownedCards) {
    if (c.sealed) continue;
    ownedSlugs.add(c.playerSlug);
    const prev = cardByPlayer.get(c.playerSlug);
    if (!prev || (c.l10 ?? 0) > (prev.card.l10 ?? 0)) {
      cardByPlayer.set(c.playerSlug, { card: c, isOwned: true });
    }
  }
  for (const c of options.rosterCards ?? []) {
    if (ownedSlugs.has(c.playerSlug) || cardByPlayer.has(c.playerSlug)) continue;
    cardByPlayer.set(c.playerSlug, { card: c, isOwned: false });
  }

  // Index known player metadata by normalized name so we know positions & L10 of injured players
  const metaByNormName = new Map<string, GalleryCard>();
  for (const { card } of cardByPlayer.values()) {
    metaByNormName.set(normalizePlayerName(card.playerName), card);
  }

  // Group OUT / DOUBTFUL injuries by teamSlug
  const injuredByTeam = new Map<
    string,
    { teamName: string; players: InjuredPlayerSummary[] }
  >();

  for (const entry of Object.values(injuriesByName)) {
    if (entry.status !== "OUT" && entry.status !== "DOUBTFUL") continue;
    const knownCard = metaByNormName.get(entry.normalizedName);
    const teamSlug = knownCard?.teamSlug ?? teamNameToSlug(entry.teamName);
    if (!teamSlug) continue;
    if (hasSchedule && (gamesPerTeam[teamSlug] ?? 0) <= 0) continue;

    // Ignore deep-bench injured players if we know their L10 is tiny (< 14)
    if (knownCard && knownCard.l10 !== null && knownCard.l10 < 14) continue;

    const bucket = injuredByTeam.get(teamSlug) ?? {
      teamName: knownCard?.teamName ?? entry.teamName,
      players: [],
    };
    bucket.players.push({
      playerName: entry.playerName,
      normalizedName: entry.normalizedName,
      status: entry.status,
      positions: knownCard?.positions ?? [],
      l10: knownCard?.l10 ?? null,
      comment: entry.comment,
    });
    injuredByTeam.set(teamSlug, bucket);
  }

  const results: TeamInjuryImpact[] = [];

  for (const [teamSlug, { teamName, players: injuredPlayers }] of injuredByTeam.entries()) {
    // Sort injured players by L10 descending so stars appear first
    injuredPlayers.sort((a, b) => (b.l10 ?? 24) - (a.l10 ?? 24));

    const beneficiaries: InjuryBeneficiary[] = [];
    for (const { card, isOwned } of cardByPlayer.values()) {
      if (card.teamSlug !== teamSlug) continue;
      const norm = normalizePlayerName(card.playerName);
      const ownInjury = injuriesByName[norm];
      if (ownInjury && (ownInjury.status === "OUT" || ownInjury.status === "DOUBTFUL")) {
        continue;
      }
      const baseL10 = card.l10 ?? card.sorareClassicProjected ?? 0;
      if (baseL10 < 10) continue;

      let totalBoost = 0;
      let bestMatch: PositionMatchKind = "TEAM";
      let primarySource: InjuredPlayerSummary | null = null;
      let primaryContribution = 0;

      for (const inj of injuredPlayers) {
        const { match, weight } = positionOverlapWeight(inj.positions, card.positions);
        const statusMult = inj.status === "OUT" ? 1.0 : 0.65;
        // Estimate vacated usage from injured player's L10 (or 26 pts default starter proxy)
        const vacatedL10 = inj.l10 ?? 26;
        const rawShare = Math.min(8.5, Math.max(1.8, (vacatedL10 - 10) * 0.22));
        const contribution = rawShare * weight * statusMult;
        totalBoost += contribution;
        if (contribution > primaryContribution) {
          primaryContribution = contribution;
          primarySource = inj;
          bestMatch = match;
        }
      }

      const estimatedBoostPts = round1(Math.min(11, totalBoost));
      if (estimatedBoostPts < 1.5) continue;

      const matchLabel =
        bestMatch === "EXACT"
          ? "same-pos"
          : bestMatch === "ADJACENT"
            ? "adjacent-pos"
            : "team usage";
      const srcName = primarySource?.playerName ?? injuredPlayers[0].playerName;
      const srcStatus = primarySource?.status ?? "OUT";

      beneficiaries.push({
        card,
        isOwned,
        positionMatch: bestMatch,
        estimatedBoostPts,
        boostedProjPts: round1(baseL10 + estimatedBoostPts),
        reason: `${srcName} ${srcStatus} (${matchLabel} +${estimatedBoostPts.toFixed(1)} pts)`,
      });
    }

    if (beneficiaries.length === 0) continue;

    // Sort owned beneficiaries first, then highest boost, then highest boosted projection
    beneficiaries.sort((a, b) => {
      if (a.isOwned !== b.isOwned) return a.isOwned ? -1 : 1;
      if (b.estimatedBoostPts !== a.estimatedBoostPts) {
        return b.estimatedBoostPts - a.estimatedBoostPts;
      }
      return b.boostedProjPts - a.boostedProjPts;
    });

    results.push({
      teamSlug,
      teamName,
      gamesInSlate: hasSchedule ? (gamesPerTeam[teamSlug] ?? 0) : 1,
      injuredPlayers: injuredPlayers.slice(0, 3),
      beneficiaries: beneficiaries.slice(0, maxBeneficiariesPerTeam),
    });
  }

  // Teams with owned beneficiaries first, then biggest top boost
  results.sort((a, b) => {
    const aOwned = a.beneficiaries.some((x) => x.isOwned) ? 1 : 0;
    const bOwned = b.beneficiaries.some((x) => x.isOwned) ? 1 : 0;
    if (aOwned !== bOwned) return bOwned - aOwned;
    const aMax = a.beneficiaries[0]?.estimatedBoostPts ?? 0;
    const bMax = b.beneficiaries[0]?.estimatedBoostPts ?? 0;
    return bMax - aMax;
  });

  return results.slice(0, maxTeams);
}

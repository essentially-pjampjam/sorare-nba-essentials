import type { CurrentLineupEntry, GalleryCard, InjuryReportEntry } from "../shared/types";
import { normalizePlayerName } from "./lineupOptimizerMath";

/** hold = an extra copy worth keeping for now (injured or young / rookie: value may rise). */
export type DuplicateAction = "keep" | "hold" | "sell" | "scrap";

export interface DuplicateCardAdvice {
  card: GalleryCard;
  action: DuplicateAction;
  reason: string;
  /** Instant Buy floor for the player (cents), as a selling reference; never an auction price. */
  floorCents: number | null;
}

export interface DuplicateGroup {
  playerSlug: string;
  playerName: string;
  rarity: GalleryCard["rarity"];
  cards: DuplicateCardAdvice[];
  /** Copies flagged to sell / scrap now. */
  extras: number;
  /** Extra copies to hold for now. */
  held: number;
  /** Sum of floors of the cards flagged to sell (cents). */
  sellValueCents: number;
}

/** Holo 3 > Shiny 2 > Standard 1 (Set editions like `divination_shiny_base`). */
export function editionRank(card: GalleryCard): number {
  const e = (card.cardEditionName ?? "").toLowerCase();
  if (e.includes("holo")) return 3;
  if (e.includes("shiny")) return 2;
  return 1;
}

export function editionLabel(card: GalleryCard): string {
  const r = editionRank(card);
  return r === 3 ? "Holo" : r === 2 ? "Shiny" : "Standard";
}

/** Set cards: best edition first (Collection bonus). Pro cards: in-season and power first (lineup value). */
const betterCard = (a: GalleryCard, b: GalleryCard) => {
  const edition = editionRank(b) - editionRank(a);
  const play =
    Number(b.inSeasonEligible) - Number(a.inSeasonEligible) ||
    (b.powerMultiplier ?? 1) - (a.powerMultiplier ?? 1) ||
    (b.grade ?? 0) - (a.grade ?? 0);
  return a.rarity === "common" ? edition || play : play || edition;
};

/**
 * Duplicate players per rarity: keep the best `keepPerPlayer` copies (Set 2, Pro 1), always keep
 * Shiny / Holo, sealed and in-lineup cards, hold extras of injured or young / rookie players (their
 * value may rise), and flag the rest to sell (Pro, Instant Buy floor) or scrap for Set Essence.
 */
export function buildDuplicateAdvice(
  cards: GalleryCard[],
  options: {
    lineupPlayerSlugs?: Set<string>;
    currentLineups?: CurrentLineupEntry[];
    /** Copies to keep per player (default: Set 2, Pro 1). */
    keepPerPlayer?: number;
    injuriesByName?: Record<string, InjuryReportEntry>;
    /** Players this young or younger are held as upside (default 22). */
    youngMaxAge?: number;
  } = {},
): DuplicateGroup[] {
  const inLineup = new Set((options.currentLineups ?? []).flatMap((l) => l.cardSlugs));
  const groups = new Map<string, GalleryCard[]>();
  for (const c of cards) {
    const key = `${c.rarity}:${c.playerSlug}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const out: DuplicateGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(betterCard);
    const useful = options.lineupPlayerSlugs?.has(sorted[0].playerSlug) ?? false;
    const keepN = Math.max(1, options.keepPerPlayer ?? (sorted[0].rarity === "common" ? 2 : 1));
    const injury = options.injuriesByName?.[normalizePlayerName(sorted[0].playerName)];
    const injured = injury !== undefined && injury.status !== "ACTIVE";
    const age = sorted.map((c) => c.playerAge).find((a): a is number => typeof a === "number") ?? null;
    const young = (age !== null && age <= (options.youngMaxAge ?? 22)) || sorted.some((c) => c.cardEditionName === "rookie");
    const floor = sorted.map((c) => c.lowestAskCents).find((v): v is number => typeof v === "number" && v > 0) ?? null;
    let plainKept = 0;
    let usefulExtraKept = false;
    const advice = sorted.map((card): DuplicateCardAdvice => {
      const keep = (reason: string): DuplicateCardAdvice => ({ card, action: "keep", reason, floorCents: floor });
      if (card.sealed) return keep("Sealed in your Vault");
      if (inLineup.has(card.slug) || (card.openedLineupIds?.length ?? 0) > 0) return keep("In a lineup");
      if (editionRank(card) > 1) return keep(`${editionLabel(card)} edition`);
      if (plainKept < keepN) {
        plainKept += 1;
        return keep(plainKept === 1 ? "Best copy" : `Copy ${plainKept} of ${keepN} kept per player`);
      }
      if (useful && !usefulExtraKept && keepN < 2) {
        usefulExtraKept = true;
        return keep("2nd copy of a lineup player (play two teams at once)");
      }
      if (injured) {
        return { card, action: "hold", reason: `Injured (${injury?.status ?? "OUT"}): hold until back and worth more`, floorCents: floor };
      }
      if (young) {
        return { card, action: "hold", reason: `Young${age !== null ? ` (${age})` : ""} / rookie: value may rise, hold`, floorCents: floor };
      }
      return card.rarity === "common"
        ? { card, action: "scrap", reason: "Extra Standard copy: scrap for Set Essence", floorCents: null }
        : { card, action: "sell", reason: "Extra copy", floorCents: floor };
    });
    const flagged = advice.filter((a) => a.action === "sell" || a.action === "scrap");
    out.push({
      playerSlug: sorted[0].playerSlug,
      playerName: sorted[0].playerName,
      rarity: sorted[0].rarity,
      cards: advice,
      extras: flagged.length,
      held: advice.filter((a) => a.action === "hold").length,
      sellValueCents: flagged.reduce((s, a) => s + (a.action === "sell" ? (a.floorCents ?? 0) : 0), 0),
    });
  }
  return out.sort((a, b) => b.extras - a.extras || b.held - a.held || b.sellValueCents - a.sellValueCents || a.playerName.localeCompare(b.playerName));
}

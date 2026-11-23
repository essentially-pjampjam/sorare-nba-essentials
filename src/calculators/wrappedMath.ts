import type {
  CardOwnershipRecord,
  EssenceBalances,
  GalleryCard,
  ProProgressRecord,
  WrappedMode,
} from "../shared/types";
import { computePortfolioPnl } from "./portfolioMath";
import { summarizeProHistory } from "./proProgressMath";

export interface WrappedSlide {
  id: string;
  eyebrow: string;
  headline: string;
  metric: string;
  subtext: string;
  accent: "emerald" | "sky" | "amber" | "violet";
}

export interface WrappedSummaryData {
  mode: WrappedMode;
  title: string;
  subtitle: string;
  username: string | null;
  seasonLabel: string;
  totalGameWeeks: number;
  totalLineups: number;
  rewardedLineups: number;
  cashLineups: number;
  rewardHitRatePct: number;
  bestScore: number | null;
  bestTopPct: number | null;
  longestRewardStreak: number;
  mvpCardName: string | null;
  mvpCardL10: number | null;
  bestAuctionStealLabel: string | null;
  totalEssence: number;
  favoriteTeamName: string | null;
  favoriteTeamCount: number;
  totalCardsOwned: number;
  totalFloorCents: number;
  slides: WrappedSlide[];
}

const MODE_META: Record<WrappedMode, { title: string; subtitle: string }> = {
  regular_season: {
    title: "Regular Season Wrapped",
    subtitle: "Your Sorare NBA grind, rewards & top cards",
  },
  playoffs: {
    title: "NBA Playoffs Wrapped",
    subtitle: "Postseason lineups, clutch scores & market steals",
  },
  year_end: {
    title: "Year-End Wrapped",
    subtitle: "November recap of your full Sorare NBA journey",
  },
};

export function buildWrappedFilename(mode: WrappedMode, username?: string | null): string {
  const userPart = (username ?? "manager")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `sorare-wrapped-${mode}-${userPart || "manager"}.png`;
}

function formatTeamSlugLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Builds the multi-slide Wrapped story deck and 16:9 PNG summary payload
 * from local Pro Progress history, Gallery cards, P&L records, and Essence balances.
 */
export function buildWrappedSummary(params: {
  mode: WrappedMode;
  username?: string | null;
  seasonYear?: number;
  progressHistory: ProProgressRecord[];
  galleryCards: GalleryCard[];
  ownershipRecords?: CardOwnershipRecord[];
  essenceByRarity?: EssenceBalances;
  commonEssence?: number;
}): WrappedSummaryData {
  const {
    mode,
    username = null,
    seasonYear = 2026,
    progressHistory,
    galleryCards,
    ownershipRecords = [],
    essenceByRarity,
    commonEssence = 0,
  } = params;

  const meta = MODE_META[mode];
  const seasonLabel = `${seasonYear}-${String((seasonYear + 1) % 100).padStart(2, "0")}`;

  // Filter history slightly by mode when Playoff fixtures are tagged in slugs; otherwise use full history
  const modeHistory =
    mode === "playoffs"
      ? progressHistory.filter((r) => /playoff|final|postseason/i.test(r.fixtureSlug))
      : progressHistory;
  const effectiveHistory = modeHistory.length > 0 ? modeHistory : progressHistory;

  const weeks = summarizeProHistory(effectiveHistory);
  const totalGameWeeks = weeks.length;
  const totalLineups = weeks.reduce((s, w) => s + w.lineups, 0);
  const rewardedLineups = weeks.reduce((s, w) => s + w.rewarded, 0);
  const cashLineups = weeks.reduce((s, w) => s + w.cash, 0);
  const rewardHitRatePct =
    totalLineups > 0 ? Math.round((rewardedLineups / totalLineups) * 100) : 0;

  const scores = effectiveHistory
    .map((r) => r.score)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const bestScore = scores.length > 0 ? Math.round(Math.max(...scores) * 10) / 10 : null;

  const pcts = weeks
    .map((w) => w.bestTopPct)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const bestTopPct = pcts.length > 0 ? Math.min(...pcts) : null;

  // Longest consecutive GW reward streak across tracked history (chronological)
  let longestRewardStreak = 0;
  let running = 0;
  for (const w of [...weeks].reverse()) {
    if (w.rewarded > 0) {
      running += 1;
      if (running > longestRewardStreak) longestRewardStreak = running;
    } else {
      running = 0;
    }
  }

  // MVP card: highest L10 pro card (fallback to any card)
  const proCards = galleryCards.filter((c) => c.rarity !== "common");
  const cardPool = proCards.length > 0 ? proCards : galleryCards;
  const mvpCard =
    [...cardPool].sort((a, b) => (b.l10 ?? 0) - (a.l10 ?? 0))[0] ?? null;

  // Favorite team collected
  const teamCounts = new Map<string, number>();
  for (const c of galleryCards) {
    if (!c.teamSlug) continue;
    teamCounts.set(c.teamSlug, (teamCounts.get(c.teamSlug) ?? 0) + 1);
  }
  const topTeamEntry = [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const favoriteTeamName = topTeamEntry ? formatTeamSlugLabel(topTeamEntry[0]) : null;
  const favoriteTeamCount = topTeamEntry ? topTeamEntry[1] : 0;

  // Total Essence (Pro + Set)
  const proEssence = essenceByRarity
    ? (essenceByRarity.limited ?? 0) +
      (essenceByRarity.rare ?? 0) +
      (essenceByRarity.super_rare ?? 0) +
      (essenceByRarity.unique ?? 0)
    : 0;
  const totalEssence = Math.max(0, Math.round(proEssence + (commonEssence ?? 0)));

  // Best auction steal from P&L history (or fallback to best L10/floor value card)
  const pnl = computePortfolioPnl(ownershipRecords, { activeSeasonYear: seasonYear });
  let bestAuctionStealLabel: string | null = null;
  if (pnl.bestAuctionWon && pnl.bestAuctionWon.pnlCents !== null) {
    const sign = pnl.bestAuctionWon.pnlCents >= 0 ? "+" : "-";
    const absEur = (Math.abs(pnl.bestAuctionWon.pnlCents) / 100).toFixed(2);
    bestAuctionStealLabel = `${pnl.bestAuctionWon.playerName} (${sign}€${absEur})`;
  } else {
    const pricedCards = cardPool.filter((c) => c.lowestAskCents && c.lowestAskCents > 0);
    const stealCard =
      [...pricedCards].sort(
        (a, b) =>
          (b.l10 ?? 0) / Math.max(1, (b.lowestAskCents ?? 100) / 100) -
          (a.l10 ?? 0) / Math.max(1, (a.lowestAskCents ?? 100) / 100),
      )[0] ?? null;
    if (stealCard) {
      bestAuctionStealLabel = `${stealCard.playerName} (${(stealCard.l10 ?? 0).toFixed(1)} L10)`;
    }
  }

  const totalFloorCents = cardPool.reduce((s, c) => s + (c.lowestAskCents ?? 0), 0);

  const slides: WrappedSlide[] = [
    {
      id: "overview",
      eyebrow: `${seasonLabel} ${meta.title.toUpperCase()}`,
      headline: totalGameWeeks > 0 ? "You showed up every Game Week" : "Ready for tip-off",
      metric: totalGameWeeks > 0 ? `${totalGameWeeks} GWs` : `${galleryCards.length} Cards`,
      subtext:
        totalLineups > 0
          ? `${totalLineups} lineups submitted • ${rewardedLineups} rewarded (${rewardHitRatePct}% hit rate)`
          : "Sync your Sorare Lineups tab to track every Game Week automatically.",
      accent: "sky",
    },
    {
      id: "peak",
      eyebrow: "PEAK PERFORMANCE",
      headline: bestScore !== null ? "Your highest scoring lineup" : "Chase your first reward",
      metric: bestScore !== null ? `${bestScore.toFixed(1)} PTS` : "--",
      subtext: [
        bestTopPct !== null ? `Best finish: Top ${bestTopPct}%` : null,
        longestRewardStreak > 0 ? `Best streak: ${longestRewardStreak} GW` : null,
        cashLineups > 0 ? `${cashLineups} cash finishes` : null,
      ]
        .filter(Boolean)
        .join(" • ") || "Your best Game Week finish will appear here once tracked.",
      accent: "emerald",
    },
    {
      id: "mvp",
      eyebrow: "FRANCHISE CORNERSTONE",
      headline: mvpCard ? mvpCard.playerName : "No cards scanned yet",
      metric: mvpCard ? `${(mvpCard.l10 ?? 0).toFixed(1)} L10` : "--",
      subtext: favoriteTeamName
        ? `Favorite team collected: ${favoriteTeamName} (${favoriteTeamCount} cards)`
        : `${galleryCards.length} cards in gallery`,
      accent: "amber",
    },
    {
      id: "market",
      eyebrow: "MARKET & ESSENCE",
      headline: bestAuctionStealLabel ?? "Essence Vault",
      metric: `${totalEssence.toLocaleString()} E`,
      subtext:
        totalFloorCents > 0
          ? `Est. Pro Gallery Floor: €${(totalFloorCents / 100).toFixed(2)} across ${proCards.length} Pro cards`
          : "Scan Gallery floors & P&L history to unlock your best auction steal.",
      accent: "violet",
    },
    {
      id: "summary",
      eyebrow: "SHARE YOUR WRAPPED",
      headline: username ? `@${username.replace(/^@/, "")}` : "Sorare NBA Manager",
      metric: `${rewardHitRatePct}% HIT RATE`,
      subtext: "Export a clean 16:9 PNG summary card to share with your squad.",
      accent: "emerald",
    },
  ];

  return {
    mode,
    title: meta.title,
    subtitle: meta.subtitle,
    username,
    seasonLabel,
    totalGameWeeks,
    totalLineups,
    rewardedLineups,
    cashLineups,
    rewardHitRatePct,
    bestScore,
    bestTopPct,
    longestRewardStreak,
    mvpCardName: mvpCard?.playerName ?? null,
    mvpCardL10: mvpCard ? Math.round((mvpCard.l10 ?? 0) * 10) / 10 : null,
    bestAuctionStealLabel,
    totalEssence,
    favoriteTeamName,
    favoriteTeamCount,
    totalCardsOwned: galleryCards.length,
    totalFloorCents,
    slides,
  };
}

import { NBA_26_DRAFT_TOP_30_SLUGS } from "../shared/constants";
import { buildArenaLineupsUrl, buildCardUrl, buildSetPlayUrl } from "../shared/routes";
import type {
  AlertEvaluationInputs,
  AlertEventKind,
  AlertTrackerConfig,
  BargainListing,
  InjuryReportEntry,
  InjuryStatus,
  PriceBaselineRecord,
  TrackedAlertEvent,
  WatchlistEntry,
} from "../shared/types";
import { computeCountdownSnapshot } from "./countdownMath";

/** Default lead time for the GW cutoff reminder. */
export const DEFAULT_CUTOFF_REMINDER_MINUTES = 60;
/** Daily reset reminder fires inside this window before the reset. */
export const DAILY_RESET_ALERT_WINDOW_MINUTES = 30;

const INJURY_SEVERITY: Record<InjuryStatus, number> = {
  ACTIVE: 0,
  DAY_TO_DAY: 1,
  QUESTIONABLE: 1,
  DOUBTFUL: 2,
  OUT: 3,
};

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quest labels come as "26' Non-Playoffs"; match on the label without the season prefix. */
function hasQuestLabel(listing: BargainListing, label: string): boolean {
  return (listing.questLabels ?? []).some(
    (l) => l.replace(/^\d+'\s*/, "").trim().toLowerCase() === label.toLowerCase(),
  );
}

/** Pure watchlist / sniper rule matcher (Instant Buy price within the rule's max). */
export function doesListingMatchWatchRule(listing: BargainListing, rule: WatchlistEntry): boolean {
  if (listing.priceCents === null || listing.priceCents > rule.maxPriceCents) return false;
  if (listing.rarity !== rule.rarity) return false;
  if (rule.firstOwnerOnly && !listing.isFirstOwnerEligible) return false;
  switch (rule.kind) {
    case "player":
      return listing.playerSlug === rule.playerSlug;
    case "quest_draft_26":
      return Boolean(
        listing.isFirstOwnerEligible &&
          (listing.cardEditionName === "rookie" || NBA_26_DRAFT_TOP_30_SLUGS.has(listing.playerSlug)),
      );
    case "quest_non_playoffs":
      return Boolean(listing.isFirstOwnerEligible && hasQuestLabel(listing, "Non-Playoffs"));
    case "quest_conf_finals":
      return Boolean(listing.isFirstOwnerEligible && hasQuestLabel(listing, "Conf Finals"));
    case "any_first_owner":
      return Boolean(listing.isFirstOwnerEligible);
    default:
      return false;
  }
}

/** Floor change in % (2 decimals), or null when either side is missing/zero. */
export function computePriceChangePct(baselineCents: number | null | undefined, currentCents: number | null | undefined): number | null {
  if (typeof baselineCents !== "number" || typeof currentCents !== "number") return null;
  if (!Number.isFinite(baselineCents) || !Number.isFinite(currentCents)) return null;
  if (baselineCents <= 0 || currentCents <= 0) return null;
  return Math.round(((currentCents - baselineCents) / baselineCents) * 10_000) / 100;
}

function isCoolingDown(key: string, lastAt: Record<string, number>, nowMs: number, cooldownMs: number): boolean {
  const last = lastAt[key];
  return typeof last === "number" && Number.isFinite(last) && nowMs - last < cooldownMs;
}

/**
 * Pure alert evaluation for the background tracker (alarms -> browser notifications):
 * price surges on owned cards' floors, injury downgrades of owned players (with the open
 * lineups they sit in), watchlist bargain matches, GW cutoff and daily reset reminders.
 * Respects the master switch, per-event toggles and a per-event cooldown.
 */
export function evaluateAlertEvents(
  inputs: AlertEvaluationInputs,
  baselines: Record<string, PriceBaselineRecord>,
  config: AlertTrackerConfig,
  nowMs: number,
): TrackedAlertEvent[] {
  if (!config.alertsEnabled) return [];
  const prefs = config.alertPreferences;
  const cooldownMs = Math.max(0, prefs.cooldownMinutes) * 60_000;
  const events: TrackedAlertEvent[] = [];
  const push = (kind: AlertEventKind, key: string, e: Omit<TrackedAlertEvent, "id" | "dedupeKey" | "kind" | "createdAtMs" | "notifyBrowser">) => {
    const dedupeKey = `${kind}:${key}`;
    if (isCoolingDown(dedupeKey, inputs.lastAlertAtByKey, nowMs, cooldownMs)) return;
    events.push({
      ...e,
      id: `${dedupeKey}@${nowMs}`,
      dedupeKey,
      kind,
      createdAtMs: nowMs,
      notifyBrowser: prefs.browserNotificationsEnabled,
    });
  };

  if (prefs.priceSurgeEnabled) {
    const threshold = prefs.priceSurgePctThreshold;
    for (const card of inputs.cards) {
      const base = baselines[card.slug];
      if (!base) continue;
      const pct = computePriceChangePct(base.baselineFloorCents, card.lowestAskCents);
      if (pct === null || pct < threshold) continue;
      const current = card.lowestAskCents ?? 0;
      push("price_surge", card.slug, {
        title: `${card.playerName} floor +${pct.toFixed(1)}%`,
        message: `Instant Buy floor for your ${card.playerName} ${card.rarity} rose from ${(base.baselineFloorCents / 100).toFixed(2)} to ${(current / 100).toFixed(2)} ${base.currency}: possible sell opportunity.`,
        cardSlug: card.slug,
        playerSlug: card.playerSlug,
        playerName: card.playerName,
        pctChange: pct,
        baselineCents: base.baselineFloorCents,
        currentCents: current,
        targetUrl: buildCardUrl(card.slug),
      });
    }
  }

  if (prefs.injuryRiskEnabled) {
    const ownedByName = new Map<string, string[]>();
    for (const c of inputs.cards) {
      const k = normalizeName(c.playerName);
      ownedByName.set(k, [...(ownedByName.get(k) ?? []), c.slug]);
    }
    const entries: Array<[string, InjuryReportEntry]> = Object.entries(inputs.currentInjuriesByName);
    for (const [rawKey, cur] of entries) {
      const key = normalizeName(cur.playerName || rawKey);
      const slugs = ownedByName.get(key);
      if (!slugs) continue;
      const prevStatus: InjuryStatus = inputs.previousInjuriesByName[rawKey]?.status ?? "ACTIVE";
      if (INJURY_SEVERITY[cur.status] <= INJURY_SEVERITY[prevStatus]) continue;
      const lineupIds = inputs.currentLineups
        .filter(
          (l) =>
            l.cardSlugs.some((s) => slugs.includes(s)) ||
            (l.playerNames ?? []).some((n) => normalizeName(n) === key),
        )
        .map((l) => l.id);
      if (prefs.injuryLineupsOnly && lineupIds.length === 0) continue;
      push("injury_risk", `${key}:${cur.status}`, {
        title: `${cur.playerName}: ${prevStatus} → ${cur.status}`,
        message: `${cur.comment || cur.rawStatus}${lineupIds.length ? ` In ${lineupIds.length} open lineup(s): consider a swap.` : ""}`,
        playerName: cur.playerName,
        cardSlug: slugs[0],
        lineupIds,
        previousStatus: prevStatus,
        currentStatus: cur.status,
        targetUrl: buildArenaLineupsUrl(null),
      });
    }
  }

  if (prefs.bargainAlertEnabled && inputs.watchlist.length > 0) {
    for (const listing of inputs.bargainListings) {
      if (listing.saleType !== "instant_buy") continue;
      const rule = inputs.watchlist.find((r) => doesListingMatchWatchRule(listing, r));
      if (!rule) continue;
      push("bargain_match", listing.cardSlug, {
        title: `Watchlist: ${listing.playerName} ${((listing.priceCents ?? 0) / 100).toFixed(2)} ${listing.currency}`,
        message: `Matches "${rule.label}" (Instant Buy).`,
        cardSlug: listing.cardSlug,
        playerSlug: listing.playerSlug,
        playerName: listing.playerName,
        currentCents: listing.priceCents ?? undefined,
        targetUrl: listing.marketUrl,
      });
    }
  }

  const snap = computeCountdownSnapshot(inputs.fixtures, nowMs);
  if (prefs.cutoffAlertEnabled && config.cutoffReminderEnabled !== false && snap.gwRemainingMs !== null) {
    const windowMs = (config.cutoffReminderMinutesBefore ?? DEFAULT_CUTOFF_REMINDER_MINUTES) * 60_000;
    if (snap.gwRemainingMs > 0 && snap.gwRemainingMs <= windowMs) {
      const mins = Math.round(snap.gwRemainingMs / 60_000);
      const health = findPreLockLineupRisks(
        inputs.currentLineups,
        inputs.cards,
        inputs.currentInjuriesByName,
        inputs.gamesPerTeam,
      );
      if (health.flagged.length > 0) {
        const sortedFlagged = [...health.flagged].sort();
        const preview = sortedFlagged.slice(0, 4).join(", ");
        const extra = sortedFlagged.length > 4 ? ` (+${sortedFlagged.length - 4} more)` : "";
        push("gw_cutoff", `${snap.gwFixtureSlug ?? "gw"}:risks:${sortedFlagged.join("|")}`, {
          title: `GW locks in ${mins} min: ${sortedFlagged.length} lineup risk${sortedFlagged.length === 1 ? "" : "s"}`,
          message: `Action needed before lock: ${preview}${extra}.`,
          lineupIds: health.affectedLineupIds,
          targetUrl: buildArenaLineupsUrl(snap.gwFixtureSlug),
        });
      } else {
        push("gw_cutoff", snap.gwFixtureSlug ?? "gw", {
          title: `GW locks in ${mins} min`,
          message: "Check your lineups before the Game Week cutoff.",
          targetUrl: buildArenaLineupsUrl(snap.gwFixtureSlug),
        });
      }
    }
  }

  if (prefs.dailyResetAlertEnabled && snap.dailyRemainingMs <= DAILY_RESET_ALERT_WINDOW_MINUTES * 60_000) {
    push("daily_reset", snap.dailyResetIso, {
      title: `Daily reset in ${Math.round(snap.dailyRemainingMs / 60_000)} min`,
      message: "Finish today's daily picks and missions before the reset.",
      targetUrl: buildSetPlayUrl("arcade"),
    });
  }

  return events;
}

/**
 * Scans open/submitted lineups for already-OUT, DOUBTFUL, or 0G (no game this slate) starters
 * so the pre-lock GW cutoff alert surfaces concrete swap risks before lock.
 */
export function findPreLockLineupRisks(
  currentLineups: AlertEvaluationInputs["currentLineups"],
  cards: AlertEvaluationInputs["cards"],
  currentInjuriesByName: Record<string, InjuryReportEntry>,
  gamesPerTeam?: Record<string, number>,
): { flagged: string[]; affectedLineupIds: string[] } {
  if (currentLineups.length === 0) return { flagged: [], affectedLineupIds: [] };
  const cardBySlug = new Map(cards.map((c) => [c.slug, c]));
  const cardByNormName = new Map(cards.map((c) => [normalizeName(c.playerName), c]));
  const injuryByNormName = new Map<string, InjuryReportEntry>();
  for (const [rawKey, entry] of Object.entries(currentInjuriesByName)) {
    const key = normalizeName(entry.playerName || rawKey);
    if (key) injuryByNormName.set(key, entry);
  }
  const hasSchedule = Boolean(gamesPerTeam && Object.keys(gamesPerTeam).length > 0);

  const flaggedMap = new Map<string, string>();
  const affectedLineupSet = new Set<string>();

  for (const lineup of currentLineups) {
    const starters: Array<{ name: string; normName: string; teamSlug: string | null; knownCard: boolean }> = [];
    const seenInLineup = new Set<string>();

    for (const slug of lineup.cardSlugs) {
      const card = cardBySlug.get(slug);
      if (!card) continue;
      const norm = normalizeName(card.playerName);
      if (seenInLineup.has(norm)) continue;
      seenInLineup.add(norm);
      starters.push({
        name: card.playerName,
        normName: norm,
        teamSlug: card.teamSlug,
        knownCard: true,
      });
    }
    for (const rawName of lineup.playerNames ?? []) {
      const norm = normalizeName(rawName);
      if (!norm || seenInLineup.has(norm)) continue;
      seenInLineup.add(norm);
      const card = cardByNormName.get(norm);
      starters.push({
        name: card?.playerName ?? rawName,
        normName: norm,
        teamSlug: card?.teamSlug ?? null,
        knownCard: Boolean(card),
      });
    }

    for (const starter of starters) {
      const reasons: string[] = [];
      const injury = injuryByNormName.get(starter.normName);
      if (injury?.status === "OUT" || injury?.status === "DOUBTFUL") {
        reasons.push(injury.status);
      }
      if (
        hasSchedule &&
        starter.knownCard &&
        (!starter.teamSlug || (gamesPerTeam?.[starter.teamSlug] ?? 0) === 0)
      ) {
        reasons.push("0G");
      }
      if (reasons.length > 0) {
        affectedLineupSet.add(lineup.id);
        flaggedMap.set(starter.normName, `${starter.name} (${reasons.join("/")})`);
      }
    }
  }

  return {
    flagged: Array.from(flaggedMap.values()),
    affectedLineupIds: Array.from(affectedLineupSet),
  };
}

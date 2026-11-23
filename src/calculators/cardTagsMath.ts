import type { CardTag, GalleryCard, SavedRosterPreset } from "../shared/types";

export const CARD_TAG_VALUES: readonly CardTag[] = ["keep", "sell", "core", "trade"] as const;
export const MAX_TAGS_PER_USER = 500;
export const MAX_CARD_SLUG_LENGTH = 140;
export const MAX_SAVED_ROSTERS = 25;

export const CARD_TAG_META: Record<
  CardTag,
  { label: string; shortLabel: string; badgeClass: string; activeClass: string }
> = {
  keep: {
    label: "Keep",
    shortLabel: "KEEP",
    badgeClass: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
    activeClass: "border-emerald-300 bg-emerald-500/30 text-emerald-100",
  },
  sell: {
    label: "Sell",
    shortLabel: "SELL",
    badgeClass: "border-rose-400/40 bg-rose-500/15 text-rose-200",
    activeClass: "border-rose-300 bg-rose-500/30 text-rose-100",
  },
  core: {
    label: "Core",
    shortLabel: "CORE",
    badgeClass: "border-sky-400/40 bg-sky-500/15 text-sky-200",
    activeClass: "border-sky-300 bg-sky-500/30 text-sky-100",
  },
  trade: {
    label: "Trade",
    shortLabel: "TRADE",
    badgeClass: "border-amber-400/40 bg-amber-500/15 text-amber-200",
    activeClass: "border-amber-300 bg-amber-500/30 text-amber-100",
  },
};

export function isValidCardTag(value: unknown): value is CardTag {
  return typeof value === "string" && (CARD_TAG_VALUES as readonly string[]).includes(value);
}

/** Strict anti-bloat sanitizer: only valid slugs <= 140 chars, strict enum tags, max 500 entries. */
export function sanitizeCardTagsMap(raw: unknown): Record<string, CardTag> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CardTag> = {};
  let count = 0;
  for (const [slug, tag] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_TAGS_PER_USER) break;
    const cleanSlug = slug.trim();
    if (!cleanSlug || cleanSlug.length > MAX_CARD_SLUG_LENGTH) continue;
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(cleanSlug)) continue;
    if (!isValidCardTag(tag)) continue;
    out[cleanSlug] = tag;
    count += 1;
  }
  return out;
}

export function setCardTagInMap(
  tags: Record<string, CardTag>,
  cardSlug: string,
  tag: CardTag | null,
): Record<string, CardTag> {
  const cleanSlug = cardSlug.trim();
  if (!cleanSlug || cleanSlug.length > MAX_CARD_SLUG_LENGTH) return tags;
  const next = { ...tags };
  if (tag === null) {
    delete next[cleanSlug];
    return next;
  }
  if (!isValidCardTag(tag)) return tags;
  if (!(cleanSlug in next) && Object.keys(next).length >= MAX_TAGS_PER_USER) {
    return tags;
  }
  next[cleanSlug] = tag;
  return next;
}

export function countCardTags(tags: Record<string, CardTag>): Record<CardTag, number> {
  const counts: Record<CardTag, number> = { keep: 0, sell: 0, core: 0, trade: 0 };
  for (const tag of Object.values(tags)) {
    if (isValidCardTag(tag)) counts[tag] += 1;
  }
  return counts;
}

export function filterCardsByTag(
  cards: GalleryCard[],
  tags: Record<string, CardTag>,
  filterTag: CardTag | "all" | "tagged",
): GalleryCard[] {
  if (filterTag === "all") return cards;
  if (filterTag === "tagged") return cards.filter((c) => Boolean(tags[c.slug]));
  return cards.filter((c) => tags[c.slug] === filterTag);
}

export function normalizeSavedRosters(raw: unknown): SavedRosterPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedRosterPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Partial<SavedRosterPreset>;
    if (!r.id || typeof r.id !== "string") continue;
    if (!r.name || typeof r.name !== "string") continue;
    if (!Array.isArray(r.cardSlugs) || !Array.isArray(r.playerNames)) continue;
    out.push({
      id: r.id.slice(0, 64),
      name: r.name.trim().slice(0, 60),
      formatLabel: typeof r.formatLabel === "string" ? r.formatLabel.slice(0, 60) : "Pro Lineup",
      cardSlugs: r.cardSlugs.filter((s): s is string => typeof s === "string").slice(0, 5),
      playerNames: r.playerNames.filter((s): s is string => typeof s === "string").slice(0, 5),
      projectedTotal:
        typeof r.projectedTotal === "number" && Number.isFinite(r.projectedTotal)
          ? Math.round(r.projectedTotal * 10) / 10
          : 0,
      createdAtMs: typeof r.createdAtMs === "number" ? r.createdAtMs : Date.now(),
    });
    if (out.length >= MAX_SAVED_ROSTERS) break;
  }
  return out;
}

/** Validates an optional user-configured Cloudflare Worker URL (HTTPS only, or localhost for dev). */
export function normalizeCloudWorkerUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
      return null;
    }
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

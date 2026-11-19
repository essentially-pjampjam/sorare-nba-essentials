import type { CurrentLineupEntry } from "../shared/types";

export type SorareRouteKind =
  | "craft"
  | "quests"
  | "lineups"
  | "collections"
  | "market"
  | "general";

export interface DomNodeLike {
  nodeType: number;
  nodeName?: string;
  textContent: string | null;
}

export interface DomElementLike extends DomNodeLike {
  tagName: string;
  innerText?: string;
  children: ArrayLike<DomElementLike>;
  childNodes?: ArrayLike<DomNodeLike>;
  parentElement: DomElementLike | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<DomElementLike>;
  querySelector(selector: string): DomElementLike | null;
}

export interface DomDocumentLike {
  body: DomElementLike | null;
  querySelectorAll(selector: string): ArrayLike<DomElementLike>;
  querySelector(selector: string): DomElementLike | null;
}

export interface DomDetectedLineup extends CurrentLineupEntry {
  contestKind?: "arena" | "pro";
  seasonScope?: "in_season" | "classic";
  starCap?: number | null;
  fixtureSlug?: string | null;
  lineupIndex?: number;
  expectedCardCount?: number;
}

interface SorareLineupRef {
  fixtureSlug: string;
  leaderboardSlug: string;
  /** Sorare lineup UUID; null when only the competition is known (board URL). */
  lineupId: string | null;
}

/** Board lineup pages: /nba/play/boards/arena/<kind>/<gw>/<gw>-nba_limited_contender/lineups */
const BOARD_LINEUPS_PATH_RE = /\/nba\/play\/boards\/[^?#]*?\/(nba-[a-z0-9-]+?)-(nba_[a-z0-9_]+)\/lineups\/?$/i;

function sorareRefFromBoardUrl(pathLower: string): SorareLineupRef | null {
  const m = pathLower.match(BOARD_LINEUPS_PATH_RE);
  if (!m?.[1] || !m[2]) return null;
  return { fixtureSlug: m[1], leaderboardSlug: m[2], lineupId: null };
}

/** True for Sorare pages that show only some of the manager's lineups (board pages). */
export function isPartialLineupPage(url: string): boolean {
  return getPathname(url).toLowerCase().includes("/nba/play/boards");
}

/** `nba-21-23-nov-2026-nba_limited_contender~so5-lineup~<uuid>` (element id or link href). */
const SORARE_LINEUP_REF_RE =
  /(nba-[a-z0-9-]+?)-(nba_[a-z0-9_]+)~so5-lineup~([0-9a-f]{8}-[0-9a-f-]{27,})/i;

function matchSorareLineupRef(raw: string | null | undefined): SorareLineupRef | null {
  const m = (raw ?? "").match(SORARE_LINEUP_REF_RE);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return {
    fixtureSlug: m[1].toLowerCase(),
    leaderboardSlug: m[2].toLowerCase(),
    lineupId: m[3].toLowerCase(),
  };
}

/** Finds Sorare's lineup reference on the box, its link descendants, or a close ancestor id. */
function findSorareLineupRef(box: DomElementLike): SorareLineupRef | null {
  const links = box.querySelectorAll("a[href]");
  for (let i = 0; i < links.length; i += 1) {
    const ref = matchSorareLineupRef(links[i]?.getAttribute("href"));
    if (ref) return ref;
  }
  const withIds = box.querySelectorAll("[id]");
  for (let i = 0; i < withIds.length; i += 1) {
    const ref = matchSorareLineupRef(withIds[i]?.getAttribute("id"));
    if (ref) return ref;
  }
  let cur: DomElementLike | null = box;
  for (let depth = 0; depth < 5 && cur; depth += 1) {
    const ref = matchSorareLineupRef(cur.getAttribute("id"));
    if (ref) return ref;
    cur = cur.parentElement;
  }
  return null;
}

const RARITY_LABELS: Record<string, string> = {
  limited: "Limited",
  rare: "Rare",
  super_rare: "Super Rare",
  unique: "Unique",
  common: "Common",
};

/**
 * Turns a Sorare leaderboard slug into display info. Caps live-verified 2026-11-19
 * (docs/SORARE_FACTS.md): Champion 16★, Contender / U23 / Veterans 11★, Uncapped none.
 */
function describeSorareLeaderboardSlug(slug: string): {
  label: string;
  seasonScope?: "in_season" | "classic";
  starCap: number | null;
  isRoom: boolean;
} {
  const s = slug.toLowerCase();
  const rarityKey = Object.keys(RARITY_LABELS)
    .sort((a, b) => b.length - a.length)
    .find((k) => s.includes(`_${k}_`) || s.endsWith(`_${k}`));
  const tier = /uncapped/.test(s)
    ? "Uncapped"
    : /u23/.test(s)
      ? "U23"
      : /veteran/.test(s)
        ? "Veterans"
        : /champion/.test(s)
          ? "Champion"
          : /contender/.test(s)
            ? "Contender"
            : "";
  const isRoom = /arena|room|uncapped|u23|veteran/.test(s);
  const seasonScope = /in_season/.test(s) ? "in_season" : isRoom ? undefined : "classic";
  const starCap =
    tier === "Champion" ? 16 : tier === "Contender" || tier === "U23" || tier === "Veterans" ? 11 : null;
  const parts = [
    isRoom ? "Arena Room" : seasonScope === "in_season" ? "In-Season" : "Classic",
    rarityKey ? RARITY_LABELS[rarityKey] : "",
    tier,
  ].filter(Boolean);
  return { label: parts.join(" "), seasonScope, starCap, isRoom };
}

const ACTION_BUTTON_RE =
  /^(edit lineup|clear team|view lineup|delete lineup|modify lineup)$/i;
const PRIMARY_ACTION_RE =
  /^(edit lineup|clear team|delete lineup|modify lineup)$/i;

const GENERIC_ALT_RE =
  /\b(sorare|logo|badge|crest|icon|trophy|team|nba|avatar|shield|jersey|card\s*back|background|banner|coin|essence)\b/i;

const POSITION_CODE_RE = /^(?:g|f|c|pg|sg|sf|pf|g\/f|f\/c|c\/f|f\/g)$/i;

const SUFFIX_WORDS = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

const NBA_TEAM_ABBRS = new Set([
  "ATL",
  "BOS",
  "BKN",
  "CHA",
  "CHI",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GSW",
  "HOU",
  "IND",
  "LAC",
  "LAL",
  "MEM",
  "MIA",
  "MIL",
  "MIN",
  "NOP",
  "NYK",
  "OKC",
  "ORL",
  "PHI",
  "PHX",
  "POR",
  "SAC",
  "SAS",
  "TOR",
  "UTA",
  "WAS",
]);

const CARD_NOISE_WORDS = new Set([
  "rookie",
  "rc",
  "gtd",
  "out",
  "dbt",
  "dtd",
  "inj",
  "questionable",
  "doubtful",
  "probable",
  "active",
  "healthy",
  "available",
  "inactive",
  "dnp",
  "sus",
  "suspended",
  "limited",
  "rare",
  "super rare",
  "super_rare",
  "unique",
  "common",
  "classic",
  "in-season",
  "in season",
  "inseason",
  "contender",
  "champion",
  "arena",
  "uncapped",
  "veterans",
  "veteran",
  "daily",
  "pickup",
  "pro",
  "set",
  "arcade",
  "squad",
  "hot streak",
  "live",
  "upcoming",
  "completed",
  "finished",
  "final",
  "draft",
  "empty",
  "locked",
  "listed",
  "sealed",
  "mvp",
  "captain",
  "cap",
  "starter",
  "bench",
  "bonus",
  "boost",
  "level",
  "lvl",
  "xp",
  "new",
  "hot",
  "cold",
  "best",
  "confirm",
  "submit",
  "shortcuts",
  "cancel",
  "save",
  "close",
  "select",
  "pick",
  "open",
  "slot",
  "slots",
  "guard",
  "forward",
  "center",
  "flex",
  "utility",
  "util",
  "my",
  "team",
  "roster",
  "lineup",
  "lineups",
  "choose",
  "tap",
  "click",
  "enter",
  "reset",
  "player",
  "card",
  "cards",
  "add",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "am",
  "pm",
  "vs",
  "vs.",
  "at",
  "et",
  "est",
  "pt",
  "pst",
  "utc",
  "cet",
]);

const DOTTED_INITIAL_RE = /^(?:\p{L}\.){1,3}$/u;

/**
 * Sorare renders lineup names in ALL CAPS; plain title-casing loses inner capitals.
 * Known NBA name parts with an inner capital are restored from this lookup.
 */
const MIXED_CASE_NAME_PARTS: Record<string, string> = {
  deandre: "DeAndre",
  deanthony: "DeAnthony",
  dejon: "DeJon",
  demar: "DeMar",
  demarcus: "DeMarcus",
  derozan: "DeRozan",
  devonte: "DeVonte",
  javale: "JaVale",
  jamychal: "JaMychal",
  lamarcus: "LaMarcus",
  lamelo: "LaMelo",
  liangelo: "LiAngelo",
  lavine: "LaVine",
  lebron: "LeBron",
};

const TWO_LETTER_INITIALS = new Set([
  "AJ",
  "BJ",
  "CJ",
  "DJ",
  "GG",
  "JJ",
  "KJ",
  "LJ",
  "MJ",
  "OG",
  "OJ",
  "PJ",
  "RJ",
  "TJ",
]);

const PHRASE_NOISE_RE =
  /^(?:level up|clear team|edit lineup|view lineup|modify lineup|delete lineup|view all lineups|add card|select player|pick player|(?:select|pick|choose|open|empty|add)\s+(?:guard|forward|center|flex|utility|util|slot|player|card)|my\s+(?:team|lineup|roster)|classic contender|classic champion|arena classic|arena contender|arena champion|arena classic contender|arena in-season|in-season contender|in-season champion|sorare pro|sorare nba|hot streak|set arcade|daily pickup|early tip|prize pool|pod of \d+|no game|bye week|(?:vs\.?|at|@)\s+[a-z]{2,4}|[a-z]{2,4}\s+(?:vs\.?|v\.?|at|@)\s+[a-z]{2,4}|[a-z]{2,4}\s+[-–]\s+[a-z]{2,4})$/i;

const NON_SLOT_INLINE_TAGS = new Set([
  "SPAN",
  "SMALL",
  "STRONG",
  "B",
  "EM",
  "I",
  "LABEL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
]);

const CONTEST_HEADER_RE =
  /\b(?:contender|champion|uncapped|prize\s*pool|early\s*tip|gw\s*\d+|pod\s+of|starts?\s+in)\b/i;

const BLOCK_TAGS = new Set([
  "DIV",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "ARTICLE",
  "SECTION",
  "HEADER",
  "FOOTER",
  "TR",
  "BR",
  "HR",
  "BUTTON",
  "A",
]);

const CARD_ASSET_SLUG_RE =
  /([a-z0-9-]+-\d{4}-(?:limited|rare|super_rare|unique|common)-\d+)/i;

export function normalizeNameForMatch(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCraftRoute(href: string): boolean {
  const lower = href.toLowerCase();
  if (lower.includes("/boards/") || lower.includes("/arena/")) {
    return false;
  }
  return (
    lower.includes("/craft") ||
    lower.includes("/card-factory") ||
    /\/(?:nba|football|mlb)\/essence(?:[/?#]|$)/.test(lower)
  );
}

export function classifySorareContext(
  url: string,
  hasCollectModal = false,
): SorareRouteKind {
  if (isCraftRoute(url)) return "craft";
  if (hasCollectModal) return "quests";
  const lower = url.toLowerCase();
  if (
    lower.includes("/nba/play") ||
    lower.includes("/nba/lineups") ||
    lower.includes("/nba/pro") ||
    lower.includes("/nba/series") ||
    lower.includes("/nba/set") ||
    lower.includes("/nba/arcade") ||
    lower.includes("/nba/arena")
  ) {
    return "lineups";
  }
  if (lower.includes("/collections")) return "collections";
  if (lower.includes("/market") || lower.includes("/nba/cards")) return "market";
  return "general";
}

function getPathname(url: string): string {
  try {
    return new URL(url, "https://sorare.com").pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? "";
  }
}

export function isProOrArenaLineupUrl(url: string): boolean {
  const path = getPathname(url).toLowerCase().replace(/\/+$/, "");
  if (!path) return false;
  if (
    path.includes("/nba/series") ||
    path.includes("/nba/set") ||
    path.includes("/nba/arcade") ||
    path.includes("/nba/lineups/prev") ||
    path.includes("/nba/play/boards")
  ) {
    return false;
  }
  if (path === "/nba/lineups/arena/ongoing") {
    return false;
  }
  return (
    path.includes("/nba/lineups") ||
    path.includes("/nba/play") ||
    path.includes("/nba/pro")
  );
}

function extractArenaFixtureSlug(url: string): string | null {
  const path = getPathname(url);
  const m = path.match(/\/nba\/lineups\/arena\/([^/?#]+)/i);
  if (!m?.[1]) return null;
  const slug = m[1].trim();
  if (!slug || slug.toLowerCase() === "ongoing") return null;
  return slug;
}

export function extractElementLines(
  root: DomElementLike,
  skipElements?: Set<DomElementLike>,
): string[] {
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.replace(/\s+/g, " ").trim();
    if (trimmed.length > 0) {
      if (trimmed.length < 240) {
        lines.push(trimmed);
      } else {
        const segments = trimmed
          .split(/\s*[•|]\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (segments.length > 1) {
          for (const seg of segments) {
            if (seg.length < 240) {
              lines.push(seg);
            } else {
              let rest = seg;
              while (rest.length >= 240) {
                const cut = rest.lastIndexOf(" ", 239);
                const idx = cut > 40 ? cut : 239;
                lines.push(rest.slice(0, idx).trim());
                rest = rest.slice(idx).trim();
              }
              if (rest) lines.push(rest);
            }
          }
        } else {
          let rest = trimmed;
          while (rest.length >= 240) {
            const cut = rest.lastIndexOf(" ", 239);
            const idx = cut > 40 ? cut : 239;
            lines.push(rest.slice(0, idx).trim());
            rest = rest.slice(idx).trim();
          }
          if (rest) lines.push(rest);
        }
      }
    }
    current = "";
  };

  const walk = (node: DomElementLike) => {
    if (skipElements?.has(node)) return;
    const tag = (node.tagName || "").toUpperCase();
    if (tag === "SVG" || tag === "STYLE" || tag === "SCRIPT" || tag === "NOSCRIPT") {
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) flush();

    const childNodes = node.childNodes;
    if (childNodes && childNodes.length > 0) {
      for (let i = 0; i < childNodes.length; i += 1) {
        const child = childNodes[i];
        if (!child) continue;
        if (child.nodeType === 3) {
          const txt = (child.textContent ?? "").replace(/\s+/g, " ").trim();
          if (txt) {
            current = current ? `${current} ${txt}` : txt;
          }
        } else if (child.nodeType === 1 && "tagName" in child) {
          const childEl = child as DomElementLike;
          if (!skipElements?.has(childEl)) {
            const childTag = (childEl.tagName || "").toUpperCase();
            if (!BLOCK_TAGS.has(childTag) && current) {
              const childLen = (childEl.textContent ?? "")
                .replace(/\s+/g, " ")
                .trim().length;
              if (current.length + 1 + childLen >= 180) {
                flush();
              }
            }
            walk(childEl);
          }
        }
      }
    } else if (node.children.length > 0) {
      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];
        if (child && !skipElements?.has(child)) {
          const childTag = (child.tagName || "").toUpperCase();
          if (!BLOCK_TAGS.has(childTag) && current) {
            const childLen = (child.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim().length;
            if (current.length + 1 + childLen >= 180) {
              flush();
            }
          }
          walk(child);
        }
      }
    } else {
      const raw = (node.textContent ?? "").trim();
      if (raw) {
        const parts = raw.split(/\r?\n/);
        for (let p = 0; p < parts.length; p += 1) {
          if (p > 0) flush();
          const seg = parts[p].replace(/\s+/g, " ").trim();
          if (seg) {
            current = current ? `${current} ${seg}` : seg;
          }
        }
      }
    }

    if (isBlock) flush();
  };

  walk(root);
  flush();
  return lines;
}

function isSuffixWord(raw: string): boolean {
  return SUFFIX_WORDS.has(raw.trim().toLowerCase());
}

function isMatchupPhrase(raw: string): boolean {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return false;
  if (/^(?:vs\.?|at|@)\s+[a-z]{2,4}$/i.test(trimmed)) return true;
  if (/^v\s+[A-Z]{2,4}$/.test(trimmed)) return true;
  if (/^[a-z]{2,4}\s+(?:vs\.?|v\.?|at|@)\s+[a-z]{2,4}$/i.test(trimmed)) return true;
  if (/^[a-z]{2,4}\s+[-–]\s+[a-z]{2,4}$/i.test(trimmed)) return true;
  const hyphenMatch = trimmed.match(/^([a-z]{2,4})\s*[-–]\s*([a-z]{2,4})$/i);
  if (
    hyphenMatch &&
    NBA_TEAM_ABBRS.has(hyphenMatch[1].toUpperCase()) &&
    NBA_TEAM_ABBRS.has(hyphenMatch[2].toUpperCase())
  ) {
    return true;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasTeamCode = words.some((w) => NBA_TEAM_ABBRS.has(w.toUpperCase()));
  if (
    words.length >= 2 &&
    words.some(
      (w) => /^(?:vs\.?|at|@)$/i.test(w) || (hasTeamCode && /^v\.?$/i.test(w)),
    ) &&
    words.every(
      (w) =>
        /^(?:vs\.?|v\.?|at|@|-|–)$/i.test(w) ||
        NBA_TEAM_ABBRS.has(w.toUpperCase()) ||
        CARD_NOISE_WORDS.has(w.toLowerCase()),
    )
  ) {
    return true;
  }
  return false;
}

function isNoiseWordOrToken(raw: string): boolean {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return true;
  if (/\d/.test(trimmed)) return true;
  if (trimmed.length < 2 || trimmed.length > 34) return true;
  if (POSITION_CODE_RE.test(trimmed)) return true;
  if (isMatchupPhrase(trimmed)) return true;

  const isDottedInitial = DOTTED_INITIAL_RE.test(trimmed);
  const letterCount = (trimmed.match(/\p{L}/gu) ?? []).length;
  if (letterCount < 2 && !isDottedInitial) return true;
  if (!/^[\p{L}'’.\-\s]+$/u.test(trimmed)) return true;

  const upper = trimmed.toUpperCase();
  if (NBA_TEAM_ABBRS.has(upper)) return true;

  const lower = trimmed.toLowerCase();
  if (CARD_NOISE_WORDS.has(lower)) return true;
  if (PHRASE_NOISE_RE.test(lower)) return true;

  const words = lower.split(/\s+/).filter(Boolean);
  if (
    words.length >= 2 &&
    words.every((w) => CARD_NOISE_WORDS.has(w) || NBA_TEAM_ABBRS.has(w.toUpperCase()))
  ) {
    return true;
  }
  return false;
}

function isNoisePhrase(raw: string): boolean {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return true;
  if (isMatchupPhrase(cleaned)) return true;
  if (PHRASE_NOISE_RE.test(cleaned)) return true;
  if (CARD_NOISE_WORDS.has(cleaned.toLowerCase())) return true;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2) return true;
  if (
    words.every(
      (w) =>
        CARD_NOISE_WORDS.has(w.toLowerCase()) ||
        isSuffixWord(w) ||
        NBA_TEAM_ABBRS.has(w.toUpperCase()),
    )
  ) {
    return true;
  }
  return false;
}

function capitalizeWordPart(part: string): string {
  if (!part) return part;
  if (DOTTED_INITIAL_RE.test(part)) {
    return part.toUpperCase();
  }
  const lower = part.toLowerCase();
  if (lower === "jr." || lower === "jr") return "Jr.";
  if (lower === "sr." || lower === "sr") return "Sr.";
  if (lower === "ii" || lower === "iii" || lower === "iv") {
    return lower.toUpperCase();
  }
  const knownMixed = MIXED_CASE_NAME_PARTS[lower];
  if (knownMixed) return knownMixed;
  const upper = part.toUpperCase();
  if (TWO_LETTER_INITIALS.has(upper)) {
    return upper;
  }
  if (/^mc[a-z]{2,}/i.test(lower)) {
    return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseToken(word: string): string {
  if (DOTTED_INITIAL_RE.test(word)) {
    return word.toUpperCase();
  }
  if (word.includes("-")) {
    return word
      .split("-")
      .map((seg) => titleCaseToken(seg))
      .join("-");
  }
  if (word.includes("'") || word.includes("’")) {
    const sep = word.includes("’") ? "’" : "'";
    const parts = word.split(sep);
    return parts
      .map((seg, i) => {
        if (i === 0) return capitalizeWordPart(seg);
        return seg.length > 1
          ? seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()
          : seg.toLowerCase();
      })
      .join(sep);
  }
  return capitalizeWordPart(word);
}

export function formatDisplayPlayerName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return collapsed;
  const hasLower = /\p{Ll}/u.test(collapsed);
  const hasUpper = /\p{Lu}/u.test(collapsed);
  if (hasLower && hasUpper) {
    return collapsed;
  }
  return collapsed
    .split(" ")
    .filter(Boolean)
    .map((w) => titleCaseToken(w))
    .join(" ");
}

function playerNameFromSlug(slug: string): string | null {
  const withoutCard = slug
    .trim()
    .replace(/-\d{4}-(?:limited|rare|super_rare|unique|common)(?:-\d+)?$/i, "")
    .replace(/-\d{8}$/, "");
  if (!withoutCard || !withoutCard.includes("-")) return null;
  const words = withoutCard
    .split("-")
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length < 2) return null;
  const candidate = words.map((w) => titleCaseToken(w)).join(" ");
  return isNoisePhrase(candidate) ? null : candidate;
}

function cleanAltOrAriaPlayerName(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed || GENERIC_ALT_RE.test(trimmed)) return null;
  const stripped = trimmed
    .replace(/\s*\(?(?:20\d{2}(?:-\d{2})?|\d{2}-\d{2})\)?\s*(?:limited|rare|super[\s_]?rare|unique|common)?\s*(?:#\d+)?$/i, "")
    .replace(/\s*(?:limited|rare|super[\s_]?rare|unique|common)\s*(?:#\d+)?$/i, "")
    .replace(/\s*#\d+$/i, "")
    // Live Sorare alts read "DeMar DeRozan - limited": drop the dangling separator.
    .replace(/\s*[-\u2013\u2014|·•:]+$/, "")
    .trim();
  if (!stripped || isNoiseWordOrToken(stripped) || isNoisePhrase(stripped)) {
    return null;
  }
  return formatDisplayPlayerName(stripped);
}

function isInsideActionControl(node: DomElementLike): boolean {
  const tag = (node.tagName || "").toUpperCase();
  if (tag === "BUTTON" || tag === "A") {
    const txt = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (ACTION_BUTTON_RE.test(txt)) return true;
  }
  return false;
}

function collectLeafTokens(root: DomElementLike): string[] {
  const tokens: string[] = [];

  const pushLines = (raw: string) => {
    const parts = raw.split(/\r?\n/);
    for (const part of parts) {
      const cleaned = part.replace(/\s+/g, " ").trim();
      if (cleaned) tokens.push(cleaned);
    }
  };

  const walk = (el: DomElementLike) => {
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "SVG" || tag === "STYLE" || tag === "SCRIPT" || tag === "NOSCRIPT") {
      return;
    }
    if (isInsideActionControl(el)) return;

    const childNodes = el.childNodes;
    if (childNodes && childNodes.length > 0) {
      let hasElementChild = false;
      for (let i = 0; i < childNodes.length; i += 1) {
        const cn = childNodes[i];
        if (cn && cn.nodeType === 1 && (cn.nodeName || "").toUpperCase() !== "BR") {
          hasElementChild = true;
          break;
        }
      }
      if (!hasElementChild) {
        for (let i = 0; i < childNodes.length; i += 1) {
          const cn = childNodes[i];
          if (cn && cn.nodeType === 3) {
            pushLines(cn.textContent ?? "");
          }
        }
        return;
      }
      for (let i = 0; i < childNodes.length; i += 1) {
        const cn = childNodes[i];
        if (!cn) continue;
        if (cn.nodeType === 3) {
          pushLines(cn.textContent ?? "");
        } else if (cn.nodeType === 1 && "tagName" in cn) {
          walk(cn as DomElementLike);
        }
      }
      return;
    }

    if (el.children.length === 0) {
      pushLines(el.textContent ?? "");
      return;
    }

    let onlyBr = true;
    for (let i = 0; i < el.children.length; i += 1) {
      if ((el.children[i]?.tagName || "").toUpperCase() !== "BR") {
        onlyBr = false;
        break;
      }
    }
    if (onlyBr) {
      pushLines(el.textContent ?? "");
      return;
    }

    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children[i];
      if (child) walk(child);
    }
  };

  walk(root);
  return tokens;
}

function pairStackedNameTokens(rawTokens: string[]): string[] {
  const withoutSplitMatchups: string[] = [];
  for (let i = 0; i < rawTokens.length; i += 1) {
    const t0 = rawTokens[i]?.trim() ?? "";
    const t1 = rawTokens[i + 1]?.trim() ?? "";
    const t2 = rawTokens[i + 2]?.trim() ?? "";
    if (
      i + 2 < rawTokens.length &&
      /^[A-Z]{2,4}$/.test(t0) &&
      /^(?:vs\.?|v\.?|at|@|-|\u2013|\u2014)$/i.test(t1) &&
      /^[A-Z]{2,4}$/.test(t2)
    ) {
      i += 2;
      continue;
    }
    if (
      i + 1 < rawTokens.length &&
      /^(?:vs\.?|at|@)$/i.test(t0) &&
      /^[A-Z]{2,4}$/.test(t1)
    ) {
      i += 1;
      continue;
    }
    withoutSplitMatchups.push(rawTokens[i]);
  }
  const candidates = withoutSplitMatchups.filter((t) => !isNoiseWordOrToken(t));
  const out: string[] = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const tok = candidates[i];
    const words = tok.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (words.length >= 2 && !(words.length === 2 && isSuffixWord(words[1]))) {
      let full = tok;
      if (i + 1 < candidates.length && isSuffixWord(candidates[i + 1])) {
        full = `${full} ${candidates[i + 1]}`;
        i += 1;
      }
      if (!isNoisePhrase(full)) {
        out.push(formatDisplayPlayerName(full));
      }
      continue;
    }

    if (words.length === 1 && isSuffixWord(words[0])) {
      continue;
    }

    if (words.length === 1 && i + 1 < candidates.length) {
      const next = candidates[i + 1];
      const nextWords = next.split(/\s+/).filter(Boolean);

      if (nextWords.length === 1 && !isSuffixWord(nextWords[0])) {
        let full = `${tok} ${next}`;
        let consumed = 2;
        if (i + 2 < candidates.length && isSuffixWord(candidates[i + 2])) {
          full = `${full} ${candidates[i + 2]}`;
          consumed = 3;
        }
        if (!isNoisePhrase(full)) {
          out.push(formatDisplayPlayerName(full));
          i += consumed - 1;
        }
        continue;
      }

      if (nextWords.length === 2 && isSuffixWord(nextWords[1])) {
        const full = `${tok} ${next}`;
        if (!isNoisePhrase(full)) {
          out.push(formatDisplayPlayerName(full));
          i += 1;
        }
      }
    }
  }

  return out;
}

function elementContainsActionButton(el: DomElementLike): boolean {
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "BUTTON" || tag === "A") {
    const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (ACTION_BUTTON_RE.test(txt)) return true;
  }
  const btns = el.querySelectorAll("button, a");
  for (let i = 0; i < btns.length; i += 1) {
    const txt = (btns[i]?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (ACTION_BUTTON_RE.test(txt)) return true;
  }
  return false;
}

function isPortraitImage(img: DomElementLike): boolean {
  const alt = (img.getAttribute("alt") ?? "").trim();
  const src = (img.getAttribute("src") ?? "").trim();
  if (GENERIC_ALT_RE.test(alt)) return false;
  if (/(?:logo|icon|badge|crest|trophy|svg)/i.test(src) && !CARD_ASSET_SLUG_RE.test(src)) {
    return false;
  }
  return true;
}

function extractSlotNames(slot: DomElementLike): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const push = (name: string | null | undefined) => {
    if (!name) return;
    const key = normalizeNameForMatch(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push(name);
  };

  const pLinks = slot.querySelectorAll('a[href*="/players/"]');
  for (let i = 0; i < pLinks.length; i += 1) {
    const link = pLinks[i];
    if (!link) continue;
    const text = (link.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!isNoiseWordOrToken(text) && !isNoisePhrase(text)) {
      push(formatDisplayPlayerName(text));
    } else {
      const href = link.getAttribute("href") ?? "";
      const m = href.match(/\/players\/([^/?#]+)/i);
      if (m?.[1]) push(playerNameFromSlug(m[1]));
    }
  }

  const imgs = slot.querySelectorAll('img[alt], [role="img"][aria-label]');
  for (let i = 0; i < imgs.length; i += 1) {
    const el = imgs[i];
    if (!el) continue;
    const raw = el.getAttribute("alt") ?? el.getAttribute("aria-label") ?? "";
    push(cleanAltOrAriaPlayerName(raw));
  }

  if (results.length === 0) {
    const paired = pairStackedNameTokens(collectLeafTokens(slot));
    for (const p of paired) push(p);
  }

  return results;
}

function collectCardSlugsInElement(el: DomElementLike): string[] {
  const slugs: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const clean = raw.trim().toLowerCase();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    slugs.push(clean);
  };
  const links = el.querySelectorAll('a[href*="/cards/"]');
  for (let i = 0; i < links.length; i += 1) {
    const m = (links[i]?.getAttribute("href") ?? "").match(/\/cards\/([^/?#]+)/i);
    if (m?.[1]) add(m[1]);
  }
  const dataEls = el.querySelectorAll("[data-card-slug]");
  for (let i = 0; i < dataEls.length; i += 1) {
    add(dataEls[i]?.getAttribute("data-card-slug"));
  }
  const imgs = el.querySelectorAll("img[src]");
  for (let i = 0; i < imgs.length; i += 1) {
    const m = (imgs[i]?.getAttribute("src") ?? "").match(CARD_ASSET_SLUG_RE);
    if (m?.[1]) add(m[1]);
  }
  return slugs;
}

function isNonSlotInlineBadge(el: DomElementLike): boolean {
  const tag = (el.tagName || "").toUpperCase();
  if (!NON_SLOT_INLINE_TAGS.has(tag)) return false;
  if (collectCardSlugsInElement(el).length > 0) return false;
  return el.querySelector('img, a[href*="/cards/"], a[href*="/players/"]') === null;
}

function hasCardIdentityMedia(el: DomElementLike): boolean {
  if (collectCardSlugsInElement(el).length > 0) return true;
  if (el.querySelector('a[href*="/cards/"], a[href*="/players/"]') !== null) {
    return true;
  }
  const imgs = el.querySelectorAll("img");
  for (let i = 0; i < imgs.length; i += 1) {
    const img = imgs[i];
    if (img && isPortraitImage(img)) return true;
  }
  return false;
}

function isHeaderOrFooterContainer(el: DomElementLike): boolean {
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "HEADER" || tag === "FOOTER" || tag === "NAV") return true;
  const role = (el.getAttribute("role") ?? "").trim().toLowerCase();
  if (role === "banner" || role === "contentinfo" || role === "navigation") {
    return true;
  }
  const cls = el.getAttribute("class") ?? "";
  return /(?:^|\s)[a-z0-9_-]*(?:header|footer|toolbar|banner)(?:\s|$)/i.test(cls);
}

function extractSpacedText(root: DomElementLike): string {
  const parts: string[] = [];
  const walk = (node: DomElementLike) => {
    const tag = (node.tagName || "").toUpperCase();
    if (tag === "SVG" || tag === "STYLE" || tag === "SCRIPT" || tag === "NOSCRIPT") {
      return;
    }
    const childNodes = node.childNodes;
    if (childNodes && childNodes.length > 0) {
      for (let i = 0; i < childNodes.length; i += 1) {
        const cn = childNodes[i];
        if (!cn) continue;
        if (cn.nodeType === 3) {
          const txt = (cn.textContent ?? "").replace(/\s+/g, " ").trim();
          if (txt) parts.push(txt);
        } else if (cn.nodeType === 1 && "tagName" in cn) {
          walk(cn as DomElementLike);
        }
      }
      return;
    }
    if (node.children.length > 0) {
      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];
        if (child) walk(child);
      }
      return;
    }
    const txt = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (txt) parts.push(txt);
  };
  walk(root);
  return parts.join(" ");
}

function hasContestHeaderSignal(el: DomElementLike): boolean {
  if (el.querySelector("h1, h2, h3, h4, h5, h6") !== null) return true;
  const text = extractSpacedText(el);
  if (CONTEST_HEADER_RE.test(text)) return true;
  if (/\d{1,2}\s*(?:★|stars?)?\s*\/\s*\d{1,2}\s*(?:★|stars?)/i.test(text)) {
    return true;
  }
  const hasScopeOrFormat =
    /\b(?:in[\s-]*season|classic|arena|daily\s*pickup|hot\s*streak|set\s*arcade)\b/i.test(
      text,
    );
  const hasContestMeta =
    /(?:★|\bstars?\b|\b(?:limited|rare|super[\s_]*rare|unique|common)\b|\b\d+\s*\/\s*\d+\b)/i.test(
      text,
    );
  return hasScopeOrFormat && hasContestMeta;
}

/** Lineup lock-progress badges such as "4/5 Locked" never describe a card slot. */
const LINEUP_STATUS_BADGE_RE = /\b\d\s*\/\s*\d\s*locked\b/i;

function isCardSlotCandidate(el: DomElementLike): boolean {
  if (elementContainsActionButton(el)) return false;
  if (isNonSlotInlineBadge(el)) return false;
  if (hasContestHeaderSignal(el)) return false;
  if (!hasCardIdentityMedia(el) && isHeaderOrFooterContainer(el)) return false;
  if (!hasCardIdentityMedia(el) && LINEUP_STATUS_BADGE_RE.test(extractSpacedText(el))) {
    return false;
  }
  if (collectCardSlugsInElement(el).length > 0) return true;
  const names = extractSlotNames(el);
  if (names.length === 1) return true;
  if (names.length > 1) return isMultiCardContainer(el);
  return false;
}

function isMultiCardContainer(el: DomElementLike): boolean {
  if (el.children.length < 2 || elementContainsActionButton(el)) return false;
  if (hasContestHeaderSignal(el)) return false;
  const distinctNames = new Set<string>();
  const distinctSlugs = new Set<string>();
  let childrenWithNames = 0;
  let childrenWithSlugs = 0;

  for (let i = 0; i < el.children.length; i += 1) {
    const child = el.children[i];
    if (
      !child ||
      elementContainsActionButton(child) ||
      isNonSlotInlineBadge(child) ||
      hasContestHeaderSignal(child) ||
      (!hasCardIdentityMedia(child) && isHeaderOrFooterContainer(child))
    ) {
      continue;
    }
    const names = extractSlotNames(child);
    if (names.length > 0) {
      childrenWithNames += 1;
      for (const n of names) {
        const k = normalizeNameForMatch(n);
        if (k) distinctNames.add(k);
      }
    }
    const slugs = collectCardSlugsInElement(child);
    if (slugs.length > 0) {
      childrenWithSlugs += 1;
      for (const s of slugs) distinctSlugs.add(s);
    }
  }

  if (childrenWithNames >= 2 && distinctNames.size >= 2) return true;
  if (childrenWithSlugs >= 2 && distinctSlugs.size >= 2) return true;
  return false;
}

function expandToCardSlots(el: DomElementLike, depth = 0): DomElementLike[] {
  if (depth > 4) return [el];
  if (isMultiCardContainer(el)) {
    const expanded: DomElementLike[] = [];
    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children[i];
      if (!child || elementContainsActionButton(child)) continue;
      if (isCardSlotCandidate(child)) {
        expanded.push(...expandToCardSlots(child, depth + 1));
      }
    }
    if (expanded.length >= 2) return expanded;
  }
  return [el];
}

function countDistinctSlotIdentities(slots: DomElementLike[]): {
  names: number;
  slugs: number;
} {
  const distinctNames = new Set<string>();
  const distinctSlugs = new Set<string>();
  for (const s of slots) {
    for (const n of extractSlotNames(s)) {
      const k = normalizeNameForMatch(n);
      if (k) distinctNames.add(k);
    }
    for (const slug of collectCardSlugsInElement(s)) {
      distinctSlugs.add(slug);
    }
  }
  return { names: distinctNames.size, slugs: distinctSlugs.size };
}

function isolateCardSlots(box: DomElementLike): DomElementLike[] {
  const candidates: DomElementLike[] = [box];
  const allEls = box.querySelectorAll("*");
  for (let i = 0; i < allEls.length; i += 1) {
    const el = allEls[i];
    if (el) candidates.push(el);
  }

  let bestSlots: DomElementLike[] = [];
  let bestScore = 0;
  let bestIsDedicated = false;

  for (const parent of candidates) {
    if (parent.children.length < 2 || parent.children.length > 8) continue;
    const flattenedSlots: DomElementLike[] = [];
    for (let i = 0; i < parent.children.length; i += 1) {
      const child = parent.children[i];
      if (!child || elementContainsActionButton(child)) continue;
      if (isCardSlotCandidate(child)) {
        flattenedSlots.push(...expandToCardSlots(child));
      }
    }
    // When a parent holds >= 2 media-backed card tiles (portrait / card link / card slug),
    // media-free text siblings are metadata badges ("Late Swap", "4/5 Locked"), not cards.
    const mediaSlots = flattenedSlots.filter((s) => hasCardIdentityMedia(s));
    if (mediaSlots.length >= 2 && mediaSlots.length < flattenedSlots.length) {
      flattenedSlots.splice(0, flattenedSlots.length, ...mediaSlots);
    }
    if (flattenedSlots.length >= 2 && flattenedSlots.length <= 6) {
      const distinct = countDistinctSlotIdentities(flattenedSlots);
      if (distinct.names < 2 && distinct.slugs < 2) continue;

      const leafCount = flattenedSlots.filter((s) => !isMultiCardContainer(s)).length;
      const isDedicatedSlotWrapper =
        parent !== box && !elementContainsActionButton(parent);
      const score =
        (flattenedSlots.length === 5 ? 20 : flattenedSlots.length) +
        (leafCount === flattenedSlots.length ? 10 : 0) +
        (isDedicatedSlotWrapper ? 1 : 0);
      const winsTie =
        score === bestScore &&
        isDedicatedSlotWrapper &&
        !bestIsDedicated &&
        flattenedSlots.length < bestSlots.length;
      if (score > bestScore || winsTie) {
        bestScore = score;
        bestSlots = flattenedSlots;
        bestIsDedicated = isDedicatedSlotWrapper;
        if (flattenedSlots.length === 5 && leafCount === 5 && isDedicatedSlotWrapper) {
          break;
        }
      }
    }
  }

  if (bestSlots.length >= 2) {
    return bestSlots;
  }

  const imgs = box.querySelectorAll("img");
  const portraitImgs: DomElementLike[] = [];
  for (let i = 0; i < imgs.length; i += 1) {
    const img = imgs[i];
    if (img && isPortraitImage(img)) portraitImgs.push(img);
  }

  if (portraitImgs.length >= 2) {
    const slotSet = new Set<DomElementLike>();
    for (const img of portraitImgs) {
      let cur: DomElementLike = img;
      let chosen: DomElementLike = img;
      while (cur.parentElement && cur.parentElement !== box) {
        const parent: DomElementLike = cur.parentElement;
        if (elementContainsActionButton(parent)) break;
        const parentImgs = parent.querySelectorAll("img");
        let count = 0;
        for (let k = 0; k < parentImgs.length; k += 1) {
          const pImg = parentImgs[k];
          if (pImg && isPortraitImage(pImg)) count += 1;
        }
        if (count > 1) break;
        chosen = parent;
        cur = parent;
      }
      slotSet.add(chosen);
    }
    const climbed = Array.from(slotSet);
    if (climbed.length >= 2) {
      const distinct = countDistinctSlotIdentities(climbed);
      if (climbed.length >= 3 || distinct.names >= 2 || distinct.slugs >= 2) {
        return climbed;
      }
    }
  }

  return [];
}

type ActionButtonKind = "edit" | "clear" | "view";

function classifyActionButton(el: DomElementLike): ActionButtonKind | null {
  const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (/^(edit lineup|modify lineup)$/i.test(txt)) return "edit";
  if (/^(clear team|delete lineup)$/i.test(txt)) return "clear";
  if (/^view lineup$/i.test(txt)) return "view";
  return null;
}

function elementHasCardContent(el: DomElementLike): boolean {
  if (el.querySelector('a[href*="/cards/"], a[href*="/players/"], [data-card-slug]') !== null) {
    return true;
  }
  const imgs = el.querySelectorAll("img");
  for (let i = 0; i < imgs.length; i += 1) {
    const img = imgs[i];
    if (img && isPortraitImage(img)) return true;
  }
  return extractSlotNames(el).length > 0;
}

function findLcaBranches(
  root: DomElementLike,
  a: DomElementLike,
  b: DomElementLike,
): { branchA: DomElementLike; branchB: DomElementLike } | null {
  const ancestorsA: DomElementLike[] = [];
  let cur: DomElementLike | null = a;
  while (cur) {
    ancestorsA.push(cur);
    if (cur === root) break;
    cur = cur.parentElement;
  }
  const setA = new Set(ancestorsA);
  let curB: DomElementLike | null = b;
  let prevB: DomElementLike | null = null;
  while (curB) {
    if (setA.has(curB)) {
      const idxA = ancestorsA.indexOf(curB);
      const branchA = idxA > 0 ? ancestorsA[idxA - 1] : null;
      if (branchA && prevB && branchA !== prevB) {
        return { branchA, branchB: prevB };
      }
      return null;
    }
    prevB = curB;
    if (curB === root) break;
    curB = curB.parentElement;
  }
  return null;
}

function countLineupBoxes(root: DomElementLike): number {
  const buttons = root.querySelectorAll("button, a");
  const found: Array<{ el: DomElementLike; kind: ActionButtonKind }> = [];

  for (let i = 0; i < buttons.length; i += 1) {
    const b = buttons[i];
    if (!b) continue;
    const kind = classifyActionButton(b);
    if (kind) found.push({ el: b, kind });
  }

  if (found.length <= 1) return found.length;

  const clusters: Array<Array<{ el: DomElementLike; kind: ActionButtonKind }>> = [];
  for (const item of found) {
    let placed = false;
    for (const cluster of clusters) {
      const canMerge = cluster.every((existing) => {
        if (existing.kind === item.kind) return false;
        if (existing.kind === "view" || item.kind === "view") return false;
        const branches = findLcaBranches(root, existing.el, item.el);
        if (!branches) return false;
        return (
          !elementHasCardContent(branches.branchA) &&
          !elementHasCardContent(branches.branchB)
        );
      });
      if (canMerge) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([item]);
    }
  }

  return clusters.length;
}

function isDescendant(ancestor: DomElementLike, node: DomElementLike): boolean {
  let cur = node.parentElement;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parentElement;
  }
  return false;
}

const POPUP_ROLES = new Set(["menu", "menuitem", "listbox", "option", "tooltip"]);

/** True when the element sits inside a dropdown / popup menu (portal) rather than a lineup card. */
function isInsidePopupMenu(el: DomElementLike): boolean {
  let cur: DomElementLike | null = el;
  for (let depth = 0; depth < 8 && cur; depth += 1) {
    const role = (cur.getAttribute("role") ?? "").toLowerCase();
    if (POPUP_ROLES.has(role)) return true;
    if (cur.getAttribute("data-radix-popper-content-wrapper") !== null) return true;
    const cls = (cur.getAttribute("class") ?? "").toLowerCase();
    if (/(dropdown|popover|menu-?list|contextmenu)/.test(cls)) return true;
    cur = cur.parentElement;
  }
  return false;
}

export function extractOpenLineupsFromDocument(
  doc: DomDocumentLike,
  url: string,
): DomDetectedLineup[] {
  const pathLower = getPathname(url).toLowerCase();
  // Board lineup pages (/nba/play/boards/.../<gw>-<leaderboard>/lineups) show the manager's own
  // lineups for that competition (with Edit / Clear buttons). Other board views stay ignored.
  const isBoardPage = pathLower.includes("/nba/play/boards");
  const boardRef = isBoardPage ? sorareRefFromBoardUrl(pathLower) : null;
  if (!isProOrArenaLineupUrl(url) && !boardRef) return [];

  const fixtureSlug = extractArenaFixtureSlug(url);
  const allButtons = doc.querySelectorAll("button, a");
  const actionEls: DomElementLike[] = [];
  for (let i = 0; i < allButtons.length; i += 1) {
    const el = allButtons[i];
    if (!el) continue;
    const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const allowView = !isBoardPage && !pathLower.includes("/ongoing");
    // Sorare's "..." menu also has an "Edit Lineup" item; it is not a lineup card.
    if (isInsidePopupMenu(el)) continue;
    if (PRIMARY_ACTION_RE.test(txt) || (allowView && /^view lineup$/i.test(txt))) {
      actionEls.push(el);
    }
  }

  if (actionEls.length === 0) return [];

  const containers: DomElementLike[] = [];
  const seenContainers = new Set<DomElementLike>();

  for (const btn of actionEls) {
    let cur: DomElementLike | null = btn.parentElement;
    let best: DomElementLike | null = null;
    for (let depth = 0; depth < 10 && cur && cur !== doc.body; depth += 1) {
      if (countLineupBoxes(cur) > 1) break;
      const textLen = (cur.textContent ?? "").trim().length;
      if (textLen >= 20 && textLen <= 4500) {
        best = cur;
      }
      cur = cur.parentElement;
    }
    if (best && !seenContainers.has(best)) {
      const overlaps = containers.some(
        (existing) => isDescendant(existing, best) || isDescendant(best, existing),
      );
      if (!overlaps) {
        seenContainers.add(best);
        containers.push(best);
      }
    }
  }

  const out: DomDetectedLineup[] = [];
  const urlArena = pathLower.includes("/arena");

  for (const box of containers) {
    const sorareRef = findSorareLineupRef(box) ?? boardRef;
    const cardSlugs: string[] = [];
    const seenSlugs = new Set<string>();
    const slugFallbackNames: string[] = [];

    const addSlug = (rawSlug: string | null | undefined) => {
      if (!rawSlug) return;
      const clean = rawSlug.trim();
      if (!clean || seenSlugs.has(clean)) return;
      seenSlugs.add(clean);
      cardSlugs.push(clean);
      const derived = playerNameFromSlug(clean);
      if (derived) slugFallbackNames.push(derived);
    };

    const cardLinks = box.querySelectorAll('a[href*="/cards/"]');
    for (let i = 0; i < cardLinks.length; i += 1) {
      const href = cardLinks[i]?.getAttribute("href") ?? "";
      const m = href.match(/\/cards\/([^/?#]+)/i);
      if (m?.[1]) addSlug(m[1]);
    }

    const dataSlugEls = box.querySelectorAll("[data-card-slug]");
    for (let i = 0; i < dataSlugEls.length; i += 1) {
      addSlug(dataSlugEls[i]?.getAttribute("data-card-slug"));
    }

    const imgEls = box.querySelectorAll("img[src]");
    for (let i = 0; i < imgEls.length; i += 1) {
      const src = imgEls[i]?.getAttribute("src") ?? "";
      const m = src.match(CARD_ASSET_SLUG_RE);
      if (m?.[1]) addSlug(m[1]);
    }

    const playerNames: string[] = [];
    const seenNameKeys = new Set<string>();
    const pushPlayerName = (raw: string | null | undefined) => {
      if (!raw) return;
      const cleaned = raw.replace(/\s+/g, " ").trim();
      if (!cleaned || isNoisePhrase(cleaned)) return;
      const formatted = formatDisplayPlayerName(cleaned);
      const key = normalizeNameForMatch(formatted);
      if (!key || seenNameKeys.has(key)) return;
      seenNameKeys.add(key);
      playerNames.push(formatted);
    };

    const slots = isolateCardSlots(box);
    if (slots.length > 0) {
      for (const slot of slots) {
        const slotNames = extractSlotNames(slot);
        if (slotNames.length === 1) {
          pushPlayerName(slotNames[0]);
        } else if (slotNames.length > 1) {
          if (slots.length < 5 || isMultiCardContainer(slot)) {
            for (const name of slotNames) {
              if (playerNames.length >= 5) break;
              pushPlayerName(name);
            }
          } else {
            pushPlayerName(slotNames[0]);
          }
        }
      }
    }

    if (playerNames.length < 5) {
      const boxLinks = box.querySelectorAll('a[href*="/players/"]');
      for (let i = 0; i < boxLinks.length; i += 1) {
        const txt = (boxLinks[i]?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!isNoiseWordOrToken(txt) && !isNoisePhrase(txt)) {
          pushPlayerName(txt);
        }
      }
    }

    if (playerNames.length < 5) {
      const boxImgs = box.querySelectorAll('img[alt], [role="img"][aria-label]');
      for (let i = 0; i < boxImgs.length; i += 1) {
        const el = boxImgs[i];
        if (!el) continue;
        const raw = el.getAttribute("alt") ?? el.getAttribute("aria-label") ?? "";
        pushPlayerName(cleanAltOrAriaPlayerName(raw));
      }
    }

    if (playerNames.length === 0 && slots.length === 0) {
      const paired = pairStackedNameTokens(collectLeafTokens(box));
      for (const name of paired) {
        pushPlayerName(name);
      }
    }

    for (const fallback of slugFallbackNames) {
      if (playerNames.length >= 5) break;
      pushPlayerName(fallback);
    }

    // A real lineup shows at least 2 players; fewer means a menu, toast or empty shell.
    if (Math.max(cardSlugs.length, playerNames.length) < 2) {
      continue;
    }

    const slotSet = new Set<DomElementLike>(slots);
    const headerLines =
      slotSet.size > 0
        ? extractElementLines(box, slotSet).slice(0, 24)
        : extractElementLines(box).slice(0, 20);
    const headerTokens = headerLines.join(" ");
    const lowerHeader = headerTokens.toLowerCase();

    const contestKind: "arena" | "pro" =
      urlArena || /\barena\b/i.test(lowerHeader) ? "arena" : "pro";

    let seasonScope: "in_season" | "classic" | undefined;
    if (/\bin[\s-]*season\b/i.test(lowerHeader)) {
      seasonScope = "in_season";
    } else if (/\bclassic\b/i.test(lowerHeader)) {
      seasonScope = "classic";
    }

    let tier = "";
    if (/\bcontender\b/i.test(lowerHeader)) {
      tier = "Contender";
    } else if (/\bchampion\b/i.test(lowerHeader)) {
      tier = "Champion";
    } else if (/\buncapped\b/i.test(lowerHeader)) {
      tier = "Uncapped";
    } else if (/\bveterans?\b/i.test(lowerHeader)) {
      tier = "Veterans";
    } else if (/\bu23\b|under\s*23/i.test(lowerHeader)) {
      tier = "U23";
    } else if (/\bdaily\b/i.test(lowerHeader)) {
      tier = "Daily";
    }

    const slashStarMatch = headerTokens.match(
      /(?:\d{1,2}\s*(?:★|stars?)?\s*\/\s*)(\d{1,2})\s*(?:★|stars?)/i,
    );
    const starMatch =
      slashStarMatch ?? headerTokens.match(/(\d{1,2})\s*(?:★|stars?)/i);
    const starCap = starMatch ? Number(starMatch[1]) : null;

    const compParts: string[] = [];
    if (contestKind === "arena") compParts.push("Arena");
    if (seasonScope === "in_season") compParts.push("In-Season");
    else if (seasonScope === "classic") compParts.push("Classic");
    if (tier) compParts.push(tier);

    let leaderboardName =
      compParts.length > 0 ? compParts.join(" ") : "Sorare Pro Lineup";
    let leaderboardSlug = leaderboardName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    let finalContestKind = contestKind;
    let finalSeasonScope = seasonScope;
    let finalStarCap = starCap;

    // Sorare's own leaderboard slug (e.g. nba_limited_in_season_contender) beats page heuristics:
    // the /nba/lineups/arena/<gw> page also lists Pro Classic & In-Season lineups.
    if (sorareRef) {
      const info = describeSorareLeaderboardSlug(sorareRef.leaderboardSlug);
      leaderboardSlug = sorareRef.leaderboardSlug;
      leaderboardName = info.label;
      finalContestKind = info.isRoom ? "arena" : "pro";
      finalSeasonScope = info.seasonScope ?? seasonScope;
      finalStarCap = starCap ?? info.starCap;
    }

    const lineupIndex = out.length + 1;
    const nameSig = [...cardSlugs, ...playerNames.slice(0, 5)].join("|").slice(0, 80);

    out.push({
      id: sorareRef?.lineupId
        ? `dom-${sorareRef.lineupId}`
        : `dom-${leaderboardSlug}-${lineupIndex}-${nameSig.length}`,
      name: `${leaderboardName} #${lineupIndex}`,
      leaderboardSlug,
      leaderboardName,
      draft: false,
      cardSlugs: cardSlugs.slice(0, 5),
      playerNames: playerNames.slice(0, 5),
      captainCardSlug: null,
      source: "dom",
      contestKind: finalContestKind,
      seasonScope: finalSeasonScope,
      starCap: finalStarCap,
      fixtureSlug: sorareRef?.fixtureSlug ?? fixtureSlug,
      lineupIndex,
      expectedCardCount: 5,
      sorareLineupId: sorareRef?.lineupId ?? null,
    });
  }

  return out;
}

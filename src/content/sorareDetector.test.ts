import { describe, expect, it } from "vitest";
import { compareCurrentVsOptimalLineups } from "../calculators/lineupOptimizerMath";
import type { GalleryCard } from "../shared/types";
import {
  classifySorareContext,
  extractOpenLineupsFromDocument,
  formatDisplayPlayerName,
  isPartialLineupPage,
  type DomDocumentLike,
  type DomElementLike,
  type DomNodeLike,
} from "./sorareDomParser";

interface MockTextNode extends DomNodeLike {
  nodeType: 3;
  nodeName: "#text";
  textContent: string;
}

class MockElement implements DomElementLike {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  attrs: Record<string, string>;
  children: MockElement[] = [];
  childNodes: Array<MockElement | MockTextNode> = [];
  parentElement: MockElement | null = null;

  constructor(tagName: string, attrs: Record<string, string> = {}) {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.attrs = attrs;
  }

  get textContent(): string {
    return this.childNodes.map((n) => n.textContent ?? "").join("");
  }

  get innerText(): string {
    const blockTags = new Set([
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
      "BR",
      "BUTTON",
      "A",
    ]);
    let out = "";
    const walk = (n: MockElement | MockTextNode) => {
      if (n.nodeType === 3) {
        out += n.textContent;
        return;
      }
      const el = n as MockElement;
      const isBlock = blockTags.has(el.tagName);
      if (isBlock && out && !out.endsWith("\n")) out += "\n";
      for (const c of el.childNodes) walk(c);
      if (isBlock && out && !out.endsWith("\n")) out += "\n";
    };
    walk(this);
    return out.trim();
  }

  getAttribute(name: string): string | null {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(this.attrs)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const groups = selector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const out: MockElement[] = [];
    const seen = new Set<MockElement>();

    const visit = (el: MockElement) => {
      for (const child of el.children) {
        if (groups.some((g) => matchesCompoundSelector(child, g, el))) {
          if (!seen.has(child)) {
            seen.add(child);
            out.push(child);
          }
        }
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matchesSimpleSelector(el: MockElement, sel: string): boolean {
  if (sel === "*") return true;
  let rest = sel;

  const tagMatch = rest.match(/^([a-zA-Z0-9_-]+)/);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) return false;
    rest = rest.slice(tagMatch[1].length);
  }

  while (rest.length > 0) {
    if (rest.startsWith(".")) {
      const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!m) return false;
      const classes = (el.getAttribute("class") ?? "").split(/\s+/);
      if (!classes.includes(m[1])) return false;
      rest = rest.slice(m[0].length);
      continue;
    }
    if (rest.startsWith("#")) {
      const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
      if (!m) return false;
      if ((el.getAttribute("id") ?? "") !== m[1]) return false;
      rest = rest.slice(m[0].length);
      continue;
    }
    if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end === -1) return false;
      const inner = rest.slice(1, end).trim();
      rest = rest.slice(end + 1);
      const opMatch = inner.match(/^([a-zA-Z0-9_-]+)\s*(\*=|=)\s*["']?([^"'\]]*)["']?(?:\s+i)?$/i);
      if (opMatch) {
        const attrVal = el.getAttribute(opMatch[1]);
        if (attrVal === null) return false;
        const target = opMatch[3];
        if (opMatch[2] === "*=") {
          if (!attrVal.toLowerCase().includes(target.toLowerCase())) return false;
        } else if (attrVal.toLowerCase() !== target.toLowerCase()) {
          return false;
        }
      } else {
        if (el.getAttribute(inner) === null) return false;
      }
      continue;
    }
    return false;
  }

  return true;
}

function matchesCompoundSelector(
  el: MockElement,
  selector: string,
  stopRoot: MockElement,
): boolean {
  const parts = selector.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!matchesSimpleSelector(el, parts[parts.length - 1])) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    let found = false;
    while (cur && cur !== stopRoot.parentElement) {
      if (matchesSimpleSelector(cur, parts[i])) {
        found = true;
        cur = cur.parentElement;
        break;
      }
      cur = cur.parentElement;
    }
    if (!found) return false;
  }
  return true;
}

const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "link"]);

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(raw)) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[key] = val;
  }
  return attrs;
}

function parseHtmlToDocument(html: string): DomDocumentLike {
  const root = new MockElement("document");
  const body = new MockElement("body");
  body.parentElement = root;
  root.children.push(body);
  root.childNodes.push(body);

  const stack: MockElement[] = [body];
  const tokenRe = /<[^>]+>|[^<]+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(html)) !== null) {
    const token = match[0];
    const parent = stack[stack.length - 1] ?? body;

    if (token.startsWith("</")) {
      const closeTag = token.slice(2, -1).trim().toLowerCase();
      for (let i = stack.length - 1; i >= 1; i -= 1) {
        if (stack[i].tagName.toLowerCase() === closeTag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (token.startsWith("<!--")) continue;

    if (token.startsWith("<")) {
      const selfClosing = token.endsWith("/>");
      const inner = token.slice(1, selfClosing ? -2 : -1).trim();
      const spaceIdx = inner.search(/\s/);
      const tag = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).toLowerCase();
      if (!tag) continue;
      const attrRaw = spaceIdx === -1 ? "" : inner.slice(spaceIdx + 1);
      const el = new MockElement(tag, parseAttrs(attrRaw));
      el.parentElement = parent;
      parent.children.push(el);
      parent.childNodes.push(el);
      if (!selfClosing && !VOID_TAGS.has(tag)) {
        stack.push(el);
      }
      continue;
    }

    const decoded = token
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (decoded.trim().length > 0) {
      parent.childNodes.push({
        nodeType: 3,
        nodeName: "#text",
        textContent: decoded,
      });
    }
  }

  const bodyChild = body.querySelector("body");
  const actualBody = bodyChild ?? body;

  return {
    body: actualBody,
    querySelectorAll(selector: string) {
      return actualBody.querySelectorAll(selector);
    },
    querySelector(selector: string) {
      return actualBody.querySelector(selector);
    },
  };
}

function makeCardSlotHtml(opts: {
  first: string;
  last: string;
  suffix?: string;
  team: string;
  pos: string;
  jersey: string;
  kickoff: string;
  badge?: string;
}): string {
  const badgeHtml = opts.badge ? `<span class="badge">${opts.badge}</span>` : "";
  const suffixHtml = opts.suffix ? `<span>${opts.suffix}</span>` : "";
  return `
    <div class="card-slot">
      <div class="card-top"><span>26-27</span><span>LIMITED</span>${badgeHtml}</div>
      <div class="card-art"><img src="https://assets.sorare.com/portrait.png" alt="" /></div>
      <div class="card-meta"><span>${opts.jersey}</span><span>${opts.pos}</span><span>${opts.team}</span></div>
      <div class="card-name">
        <span>${opts.first}</span>
        <span>${opts.last}</span>
        ${suffixHtml}
      </div>
      <div class="card-kickoff"><span>${opts.kickoff}</span></div>
    </div>
  `;
}

function makeGalleryCard(
  playerName: string,
  slug: string,
  opts: {
    starCost: number;
    l10: number;
    inSeason?: boolean;
    positions?: GalleryCard["positions"];
  },
): GalleryCard {
  return {
    slug,
    rarity: "limited",
    seasonYear: opts.inSeason ? 2026 : 2025,
    inSeasonEligible: Boolean(opts.inSeason),
    grade: 1,
    powerMultiplier: opts.inSeason ? 1.05 : 1,
    teamName: "NBA Team",
    teamSlug: "nba-team",
    playerSlug: slug.replace(/-\d{4}-.*$/, ""),
    playerName,
    positions: opts.positions ?? ["basketball_forward"],
    l10: opts.l10,
    l5: opts.l10 + 1,
    sorareClassicProjected: opts.l10 + 2,
    sorareDailyProjected: opts.l10 + 2,
    starCost: opts.starCost,
  };
}

describe("sorareDomParser & sorareDetector", () => {
  it("classifies /nba/series/* and other Sorare NBA routes accurately", () => {
    expect(classifySorareContext("https://sorare.com/nba/series/play")).toBe("lineups");
    expect(classifySorareContext("https://sorare.com/nba/series/squad")).toBe("lineups");
    expect(
      classifySorareContext("https://sorare.com/nba/series/4f71b2d0-8e33-4a91-9e12/lineups"),
    ).toBe("lineups");
    expect(
      classifySorareContext("https://sorare.com/nba/series/squad/lineups/BoardStep%3Aabc-123"),
    ).toBe("lineups");
    expect(
      classifySorareContext(
        "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba_limited_in_season_champion",
      ),
    ).toBe("lineups");
    expect(classifySorareContext("https://sorare.com/nba/craft")).toBe("craft");
    expect(classifySorareContext("https://sorare.com/nba/market")).toBe("market");
    expect(classifySorareContext("https://sorare.com/nba/collections")).toBe("collections");
    expect(classifySorareContext("https://sorare.com/nba/play", true)).toBe("quests");
  });

  it("extracts all 3 Screenshot 4 Arena Classic Contender lineups and 15 players without /cards/ links", () => {
    const html = `
      <main>
        <div class="arena-lineup-card">
          <div class="header">
            <h3>Arena Classic Contender</h3>
            <span>12★</span>
            <button>Edit Lineup</button>
            <button>Clear Team</button>
          </div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "MOREZ", last: "JOHNSON JR.", team: "IND", pos: "F", jersey: "14", kickoff: "SAT 2:30 AM", badge: "ROOKIE" })}
            ${makeCardSlotHtml({ first: "DEMAR", last: "DEROZAN", team: "SAC", pos: "G/F", jersey: "10", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "CHRISTIAN", last: "ANDERSON JR.", team: "CHA", pos: "G", jersey: "5", kickoff: "SAT 1:00 AM", badge: "ROOKIE" })}
            ${makeCardSlotHtml({ first: "TAYLOR", last: "HENDRICKS", team: "UTA", pos: "F", jersey: "0", kickoff: "SAT 4:00 AM" })}
          </div>
        </div>
        <div class="arena-lineup-card">
          <div class="header">
            <h3>Arena Classic Contender</h3>
            <span>12★</span>
            <button>Edit Lineup</button>
            <button>Clear Team</button>
          </div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "WENDELL", last: "CARTER JR.", team: "ORL", pos: "C", jersey: "34", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "QUENTON", last: "JACKSON", team: "IND", pos: "G", jersey: "29", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "DILLON", last: "BROOKS", team: "HOU", pos: "F", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
        <div class="arena-lineup-card">
          <div class="header">
            <h3>Arena Classic Contender</h3>
            <span>12★</span>
            <button>Edit Lineup</button>
            <button>Clear Team</button>
          </div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "JARACE", last: "WALKER", team: "IND", pos: "F", jersey: "5", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "BUB", last: "CARRINGTON", team: "WAS", pos: "G", jersey: "8", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "ALLEN", last: "GRAVES", team: "ORL", pos: "F", jersey: "22", kickoff: "SAT 1:00 AM", badge: "ROOKIE" })}
            ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SAT 1:30 AM", badge: "GTD" })}
            ${makeCardSlotHtml({ first: "NIKOLA", last: "VUČEVIĆ", team: "CHI", pos: "C", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
      </main>
    `;

    const doc = parseHtmlToDocument(html);
    const lineups = extractOpenLineupsFromDocument(
      doc,
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );

    expect(lineups).toHaveLength(3);
    expect(lineups[0]).toMatchObject({
      name: "Arena Classic Contender #1",
      leaderboardName: "Arena Classic Contender",
      leaderboardSlug: "arena_classic_contender",
      contestKind: "arena",
      seasonScope: "classic",
      starCap: 12,
      fixtureSlug: "nba-21-23-nov-2026",
      lineupIndex: 1,
      expectedCardCount: 5,
    });
    expect(lineups[0].playerNames).toEqual([
      "Morez Johnson Jr.",
      "DeMar DeRozan",
      "Malik Monk",
      "Christian Anderson Jr.",
      "Taylor Hendricks",
    ]);

    expect(lineups[1].name).toBe("Arena Classic Contender #2");
    expect(lineups[1].playerNames).toEqual([
      "Aaron Gordon",
      "Brook Lopez",
      "Wendell Carter Jr.",
      "Quenton Jackson",
      "Dillon Brooks",
    ]);

    expect(lineups[2].name).toBe("Arena Classic Contender #3");
    expect(lineups[2].playerNames).toEqual([
      "Jarace Walker",
      "Bub Carrington",
      "Allen Graves",
      "Dean Wade",
      "Nikola Vučević",
    ]);
  });

  it("handles apostrophes, hyphens, two-letter initials, and 3-line stacked suffixes", () => {
    const html = `
      <div class="lineup-box">
        <div><span>Classic Contender</span><button>Edit Lineup</button></div>
        <div class="grid">
          ${makeCardSlotHtml({ first: "DAY'RON", last: "SHARPE", team: "BKN", pos: "C", jersey: "20", kickoff: "SUN 1:00 AM" })}
          ${makeCardSlotHtml({ first: "NICKEIL", last: "ALEXANDER-WALKER", team: "MIN", pos: "G", jersey: "9", kickoff: "SUN 2:00 AM" })}
          ${makeCardSlotHtml({ first: "KARL-ANTHONY", last: "TOWNS", team: "NYK", pos: "C", jersey: "32", kickoff: "SUN 1:00 AM" })}
          ${makeCardSlotHtml({ first: "CJ", last: "MCCOLLUM", team: "NOP", pos: "G", jersey: "3", kickoff: "SUN 2:00 AM" })}
          ${makeCardSlotHtml({ first: "MOREZ", last: "JOHNSON", suffix: "JR.", team: "IND", pos: "F", jersey: "14", kickoff: "SUN 1:30 AM" })}
        </div>
      </div>
      <div class="lineup-box">
        <div><span>Classic Contender</span><button>Edit Lineup</button></div>
        <div class="grid">
          ${makeCardSlotHtml({ first: "PJ", last: "WASHINGTON", team: "DAL", pos: "F", jersey: "25", kickoff: "SUN 3:00 AM" })}
          ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SUN 3:00 AM" })}
          ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SUN 1:00 AM" })}
          ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SUN 3:00 AM" })}
          ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SUN 1:30 AM" })}
        </div>
      </div>
    `;

    const doc = parseHtmlToDocument(html);
    const lineups = extractOpenLineupsFromDocument(doc, "https://sorare.com/nba/lineups/pro");

    expect(lineups).toHaveLength(2);
    expect(lineups[0].playerNames).toEqual([
      "Day'Ron Sharpe",
      "Nickeil Alexander-Walker",
      "Karl-Anthony Towns",
      "CJ McCollum",
      "Morez Johnson Jr.",
    ]);
    expect(lineups[1].playerNames?.[0]).toBe("PJ Washington");
  });

  it("extracts Pro Lobby card slugs from card anchors and asset image URLs", () => {
    const html = `
      <div class="pro-box">
        <div><span>In-Season Champion</span><span>16★</span><button>Edit Lineup</button></div>
        <div class="grid">
          <div class="slot"><a href="/nba/cards/nikola-jokic-2026-limited-12"><img src="https://assets.sorare.com/nikola-jokic-2026-limited-12.png" alt="Nikola Jokic 2026-27 Limited #12" /></a></div>
          <div class="slot"><a href="/nba/cards/aaron-gordon-2026-limited-45"><img src="https://assets.sorare.com/aaron-gordon-2026-limited-45.png" alt="Aaron Gordon" /></a></div>
          <div class="slot"><a href="/nba/cards/malik-monk-2026-limited-88"><img src="https://assets.sorare.com/malik-monk-2026-limited-88.png" alt="Malik Monk" /></a></div>
          <div class="slot"><a href="/nba/cards/dean-wade-2026-limited-19"><img src="https://assets.sorare.com/dean-wade-2026-limited-19.png" alt="Dean Wade" /></a></div>
          <div class="slot"><a href="/nba/cards/bub-carrington-2026-limited-31"><img src="https://assets.sorare.com/bub-carrington-2026-limited-31.png" alt="Bub Carrington" /></a></div>
        </div>
      </div>
    `;

    const doc = parseHtmlToDocument(html);
    const lineups = extractOpenLineupsFromDocument(doc, "https://sorare.com/nba/lineups/pro");

    expect(lineups).toHaveLength(1);
    expect(lineups[0]).toMatchObject({
      name: "In-Season Champion #1",
      leaderboardSlug: "in_season_champion",
      contestKind: "pro",
      seasonScope: "in_season",
      starCap: 16,
      cardSlugs: [
        "nikola-jokic-2026-limited-12",
        "aaron-gordon-2026-limited-45",
        "malik-monk-2026-limited-88",
        "dean-wade-2026-limited-19",
        "bub-carrington-2026-limited-31",
      ],
    });
    expect(lineups[0].playerNames).toEqual([
      "Nikola Jokic",
      "Aaron Gordon",
      "Malik Monk",
      "Dean Wade",
      "Bub Carrington",
    ]);
  });

  it("blocks false-positive UI-noise entries, /ongoing routes, and /nba/series/* Common Squad routes", () => {
    const noiseOnlyHtml = `
      <div class="phantom-box">
        <span>Arena Classic Contender</span>
        <span>Classic Contender</span>
        <span>Arena Classic</span>
        <span>Level Up</span>
        <span>Add Card</span>
        <span>Select Player</span>
        <button>Edit Lineup</button>
        <button>Clear Team</button>
      </div>
    `;
    const noiseDoc = parseHtmlToDocument(noiseOnlyHtml);
    expect(
      extractOpenLineupsFromDocument(
        noiseDoc,
        "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
      ),
    ).toEqual([]);

    const validArenaHtml = `
      <div class="lineup">
        <span>Arena Classic Contender</span>
        <button>Edit Lineup</button>
        <button>Clear Team</button>
        <div class="grid">
          ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
          ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
          ${makeCardSlotHtml({ first: "WENDELL", last: "CARTER JR.", team: "ORL", pos: "C", jersey: "34", kickoff: "SAT 1:00 AM" })}
          ${makeCardSlotHtml({ first: "QUENTON", last: "JACKSON", team: "IND", pos: "G", jersey: "29", kickoff: "SAT 2:30 AM" })}
          ${makeCardSlotHtml({ first: "DILLON", last: "BROOKS", team: "HOU", pos: "F", jersey: "9", kickoff: "SAT 2:00 AM" })}
        </div>
      </div>
    `;
    const validDoc = parseHtmlToDocument(validArenaHtml);

    expect(
      extractOpenLineupsFromDocument(
        validDoc,
        "https://sorare.com/nba/lineups/arena/ongoing",
      ),
    ).toEqual([]);
    expect(
      extractOpenLineupsFromDocument(
        validDoc,
        "https://sorare.com/nba/series/squad/lineups/BoardStep%3Aabc-123",
      ),
    ).toEqual([]);
    expect(
      extractOpenLineupsFromDocument(
        validDoc,
        "https://sorare.com/nba/series/play",
      ),
    ).toEqual([]);
  });

  it("round-trips extracted Screenshot 4 lineups into compareCurrentVsOptimalLineups with non-zero totals", () => {
    const html = `
      <main>
        <div class="arena-lineup-card">
          <div><span>Arena Classic Contender</span><button>Edit Lineup</button></div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "MOREZ", last: "JOHNSON JR.", team: "IND", pos: "F", jersey: "14", kickoff: "SAT 2:30 AM", badge: "ROOKIE" })}
            ${makeCardSlotHtml({ first: "DEMAR", last: "DEROZAN", team: "SAC", pos: "G/F", jersey: "10", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "CHRISTIAN", last: "ANDERSON JR.", team: "CHA", pos: "G", jersey: "5", kickoff: "SAT 1:00 AM", badge: "ROOKIE" })}
            ${makeCardSlotHtml({ first: "TAYLOR", last: "HENDRICKS", team: "UTA", pos: "F", jersey: "0", kickoff: "SAT 4:00 AM" })}
          </div>
        </div>
        <div class="arena-lineup-card">
          <div><span>Arena Classic Contender</span><button>Edit Lineup</button></div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "WENDELL", last: "CARTER JR.", team: "ORL", pos: "C", jersey: "34", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "QUENTON", last: "JACKSON", team: "IND", pos: "G", jersey: "29", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "DILLON", last: "BROOKS", team: "HOU", pos: "F", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
        <div class="arena-lineup-card">
          <div><span>Arena Classic Contender</span><button>Edit Lineup</button></div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "JARACE", last: "WALKER", team: "IND", pos: "F", jersey: "5", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "BUB", last: "CARRINGTON", team: "WAS", pos: "G", jersey: "8", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "ALLEN", last: "GRAVES", team: "ORL", pos: "F", jersey: "22", kickoff: "SAT 1:00 AM", badge: "ROOKIE" })}
            ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SAT 1:30 AM", badge: "GTD" })}
            ${makeCardSlotHtml({ first: "NIKOLA", last: "VUČEVIĆ", team: "CHI", pos: "C", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
      </main>
    `;

    const extracted = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );

    const gallery: GalleryCard[] = [
      makeGalleryCard("Morez Johnson Jr.", "morez-johnson-jr-2026-limited-1", { starCost: 2, l10: 21, inSeason: true }),
      makeGalleryCard("DeMar DeRozan", "demar-derozan-2025-limited-2", { starCost: 3, l10: 29, positions: ["basketball_guard", "basketball_forward"] }),
      makeGalleryCard("Malik Monk", "malik-monk-2025-limited-3", { starCost: 2, l10: 24, positions: ["basketball_guard"] }),
      makeGalleryCard("Christian Anderson Jr.", "christian-anderson-jr-2026-limited-4", { starCost: 2, l10: 20, inSeason: true, positions: ["basketball_guard"] }),
      makeGalleryCard("Taylor Hendricks", "taylor-hendricks-2025-limited-5", { starCost: 2, l10: 19 }),
      makeGalleryCard("Aaron Gordon", "aaron-gordon-2025-limited-6", { starCost: 3, l10: 28 }),
      makeGalleryCard("Brook Lopez", "brook-lopez-2025-limited-7", { starCost: 2, l10: 22, positions: ["basketball_center"] }),
      makeGalleryCard("Wendell Carter Jr.", "wendell-carter-jr-2025-limited-8", { starCost: 3, l10: 27, positions: ["basketball_center"] }),
      makeGalleryCard("Quenton Jackson", "quenton-jackson-2026-limited-9", { starCost: 2, l10: 18, inSeason: true, positions: ["basketball_guard"] }),
      makeGalleryCard("Dillon Brooks", "dillon-brooks-2025-limited-10", { starCost: 2, l10: 21 }),
      makeGalleryCard("Jarace Walker", "jarace-walker-2025-limited-11", { starCost: 2, l10: 20 }),
      makeGalleryCard("Bub Carrington", "bub-carrington-2025-limited-12", { starCost: 2, l10: 23, positions: ["basketball_guard"] }),
      makeGalleryCard("Allen Graves", "allen-graves-2026-limited-13", { starCost: 2, l10: 19, inSeason: true }),
      makeGalleryCard("Dean Wade", "dean-wade-2025-limited-14", { starCost: 2, l10: 17 }),
      makeGalleryCard("Nikola Vucevic", "nikola-vucevic-2025-limited-15", { starCost: 4, l10: 36, positions: ["basketball_center"] }),
    ];

    const comparisons = compareCurrentVsOptimalLineups(extracted, gallery, {
      rarityFilter: "ALL",
      excludeOut: false,
      excludeQuestionable: false,
      inSeasonOnly: false,
      minInSeasonCards: 0,
      disjointAcrossLineups: false,
      projectionSource: "sorare_l10",
      customProjectionsRaw: "",
      injuriesByName: {},
      gamesPerTeam: {},
      excludedCardSlugs: [],
    });

    expect(comparisons).toHaveLength(3);
    for (const cmp of comparisons) {
      expect(cmp.resolvedCardSlugs).toHaveLength(5);
      expect(cmp.currentProjected).toBeGreaterThan(0);
      expect(cmp.currentStars).toBeGreaterThan(0);
    }
  });

  it("extracts all 5 players from multi-row 2+2+1 and 3+2 slot grids without splitting single cards", () => {
    const grid221Html = `
      <div class="arena-lineup-card">
        <div class="header">
          <h3>Arena Classic Contender</h3>
          <span>12★</span>
          <button>Edit Lineup</button>
          <button>Clear Team</button>
        </div>
        <div class="rows">
          <div class="row">
            ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
          </div>
          <div class="row">
            ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SAT 1:30 AM" })}
          </div>
          <div class="row">
            ${makeCardSlotHtml({ first: "NIKOLA", last: "VUČEVIĆ", team: "CHI", pos: "C", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
      </div>
    `;
    const lineups221 = extractOpenLineupsFromDocument(
      parseHtmlToDocument(grid221Html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(lineups221).toHaveLength(1);
    expect(lineups221[0].playerNames).toEqual([
      "Aaron Gordon",
      "Brook Lopez",
      "Malik Monk",
      "Dean Wade",
      "Nikola Vučević",
    ]);

    const grid32Html = `
      <div class="arena-lineup-card">
        <div class="header">
          <h3>Arena Classic Contender</h3>
          <span>12★</span>
          <button>Edit Lineup</button>
        </div>
        <div class="rows">
          <div class="row">
            ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SAT 3:00 AM" })}
          </div>
          <div class="row">
            ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SAT 1:30 AM" })}
            ${makeCardSlotHtml({ first: "NIKOLA", last: "VUČEVIĆ", team: "CHI", pos: "C", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
      </div>
    `;
    const lineups32 = extractOpenLineupsFromDocument(
      parseHtmlToDocument(grid32Html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(lineups32).toHaveLength(1);
    expect(lineups32[0].playerNames).toEqual([
      "Aaron Gordon",
      "Brook Lopez",
      "Malik Monk",
      "Dean Wade",
      "Nikola Vučević",
    ]);
  });

  it("separates mixed sibling Edit Lineup and View Lineup boxes under one wrapper", () => {
    const html = `
      <div class="wrapper">
        <div class="lineup-box">
          <div class="header">
            <h3>Arena Classic Contender</h3>
            <span>12★</span>
            <button>Edit Lineup</button>
            <button>Clear Team</button>
          </div>
          <div class="slots">
            ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SAT 1:30 AM" })}
            ${makeCardSlotHtml({ first: "NIKOLA", last: "VUČEVIĆ", team: "CHI", pos: "C", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
        <div class="lineup-box">
          <div class="header">
            <h3>Arena In-Season Champion</h3>
            <span>16★</span>
            <button>View Lineup</button>
          </div>
          <div class="slots">
            ${makeCardSlotHtml({ first: "JARACE", last: "WALKER", team: "IND", pos: "F", jersey: "5", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "BUB", last: "CARRINGTON", team: "WAS", pos: "G", jersey: "8", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "ALLEN", last: "GRAVES", team: "ORL", pos: "F", jersey: "22", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "QUENTON", last: "JACKSON", team: "IND", pos: "G", jersey: "29", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "DILLON", last: "BROOKS", team: "HOU", pos: "F", jersey: "9", kickoff: "SAT 2:00 AM" })}
          </div>
        </div>
      </div>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(lineups).toHaveLength(2);
    expect(lineups[0].playerNames).toHaveLength(5);
    expect(lineups[1].playerNames).toHaveLength(5);
    expect(lineups[0].playerNames?.[0]).toBe("Aaron Gordon");
    expect(lineups[1].playerNames?.[0]).toBe("Jarace Walker");
  });

  it("extracts dotted initials like J. Allen and P.J. Washington while rejecting matchup strings", () => {
    const html = `
      <div class="lineup-box">
        <div><span>Classic Contender</span><span>11★</span><button>Edit Lineup</button></div>
        <div class="grid">
          <div class="card-slot">
            <span>J.</span><span>ALLEN</span><span>DET vs LAL</span>
          </div>
          <div class="card-slot">
            <span>P.J.</span><span>WASHINGTON</span><span>DEN at BOS</span>
          </div>
          <div class="card-slot">
            <span>AJ</span><span>GREEN</span><span>DET @ LAL</span>
          </div>
          <div class="card-slot">
            <span>J.R.</span><span>SMITH</span><span>LAL - BOS</span>
          </div>
          ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
        </div>
      </div>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/pro",
    );
    expect(lineups).toHaveLength(1);
    expect(lineups[0].playerNames).toEqual([
      "J. Allen",
      "P.J. Washington",
      "AJ Green",
      "J.R. Smith",
      "Brook Lopez",
    ]);
    expect(formatDisplayPlayerName("P.J. WASHINGTON")).toBe("P.J. Washington");
    expect(formatDisplayPlayerName("J.R. SMITH")).toBe("J.R. Smith");
    expect(formatDisplayPlayerName("CJ MCCOLLUM")).toBe("CJ McCollum");
    expect(formatDisplayPlayerName("TJ MCCONNELL")).toBe("TJ McConnell");
    expect(formatDisplayPlayerName("GG JACKSON")).toBe("GG Jackson");
  });

  it("rejects extended slot-UI placeholder noise while keeping real NBA player names", () => {
    const uiNoiseHtml = `
      <div class="phantom-box">
        <div><span>Arena Classic Contender</span><button>Edit Lineup</button></div>
        <div class="grid">
          <div class="card-slot"><span>Empty</span><span>Slot</span></div>
          <div class="card-slot"><span>Select</span><span>Guard</span></div>
          <div class="card-slot"><span>Pick</span><span>Forward</span></div>
          <div class="card-slot"><span>Open</span><span>Center</span></div>
          <div class="card-slot"><span>My</span><span>Team</span></div>
        </div>
      </div>
    `;
    expect(
      extractOpenLineupsFromDocument(
        parseHtmlToDocument(uiNoiseHtml),
        "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
      ),
    ).toEqual([]);

    const realNamesHtml = `
      <div class="lineup-box">
        <div><span>Classic Contender</span><button>Edit Lineup</button></div>
        <div class="grid">
          ${makeCardSlotHtml({ first: "DERRICK", last: "WHITE", team: "BOS", pos: "G", jersey: "9", kickoff: "SAT 1:00 AM" })}
          ${makeCardSlotHtml({ first: "JAYLEN", last: "BROWN", team: "BOS", pos: "G/F", jersey: "7", kickoff: "SAT 1:00 AM" })}
          ${makeCardSlotHtml({ first: "JOSH", last: "GREEN", team: "CHA", pos: "G/F", jersey: "10", kickoff: "SAT 1:00 AM" })}
          ${makeCardSlotHtml({ first: "CHRISTIAN", last: "WOOD", team: "LAL", pos: "F/C", jersey: "35", kickoff: "SAT 3:30 AM" })}
          ${makeCardSlotHtml({ first: "MARCUS", last: "SMART", team: "MEM", pos: "G", jersey: "36", kickoff: "SAT 2:00 AM" })}
        </div>
      </div>
    `;
    const realLineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(realNamesHtml),
      "https://sorare.com/nba/lineups/pro",
    );
    expect(realLineups).toHaveLength(1);
    expect(realLineups[0].playerNames).toEqual([
      "Derrick White",
      "Jaylen Brown",
      "Josh Green",
      "Christian Wood",
      "Marcus Smart",
    ]);
  });

  it("extracts starCap from multi-line headers (> 6 lines) and ignores /prev and /play/boards/", () => {
    const deepHeaderHtml = `
      <div class="arena-lineup-card">
        <div class="header">
          <span>GW 18</span>
          <span>Nov 21 - Nov 23</span>
          <h3>Arena Classic Contender</h3>
          <span>Limited Scarcity</span>
          <span>5 / 5 Cards</span>
          <span>Starts in 2h 15m</span>
          <span>Pod of 10</span>
          <span>12★</span>
          <button>Edit Lineup</button>
          <button>Clear Team</button>
        </div>
        <div class="slots-grid">
          ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
          ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
          ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SAT 3:00 AM" })}
          ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SAT 1:30 AM" })}
          ${makeCardSlotHtml({ first: "NIKOLA", last: "VUČEVIĆ", team: "CHI", pos: "C", jersey: "9", kickoff: "SAT 2:00 AM" })}
        </div>
      </div>
    `;
    const doc = parseHtmlToDocument(deepHeaderHtml);
    const extracted = extractOpenLineupsFromDocument(
      doc,
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(extracted).toHaveLength(1);
    expect(extracted[0].starCap).toBe(12);

    expect(
      extractOpenLineupsFromDocument(doc, "https://sorare.com/nba/lineups/prev"),
    ).toEqual([]);
    expect(
      extractOpenLineupsFromDocument(
        doc,
        "https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba_limited_in_season_champion",
      ),
    ).toEqual([]);
  });

  it("preserves <span>-wrapped headers > 72 chars and slash-delimited starCap (7★ / 11★)", () => {
    const html = `
      <main>
        <div class="arena-lineup-card">
          <div class="header">
            <span>GW 18</span>
            <span>Nov 21 - Nov 23</span>
            <span>Pod of 10</span>
            <span>Arena</span>
            <span>Classic</span>
            <span>Contender</span>
            <span>Limited Scarcity</span>
            <span>5 / 5 Cards</span>
            <span>Starts in 2h 15m</span>
            <span>11★</span>
            <span>Prize Pool</span>
            <button>Edit Lineup</button>
          </div>
          <div class="slots-grid">
            <div class="card-slot"><span>3★</span><span>AARON</span><span>GORDON</span></div>
            <div class="card-slot"><span>3★</span><span>BROOK</span><span>LOPEZ</span></div>
            <div class="card-slot"><span>2★</span><span>MALIK</span><span>MONK</span></div>
            <div class="card-slot"><span>2★</span><span>DEAN</span><span>WADE</span></div>
            <div class="card-slot"><span>1★</span><span>JARACE</span><span>WALKER</span></div>
          </div>
        </div>
        <div class="arena-lineup-card">
          <div class="header">
            <span>Arena In-Season Contender</span>
            <span>7★ / 11★</span>
            <button>View Lineup</button>
          </div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "BUB", last: "CARRINGTON", team: "WAS", pos: "G", jersey: "8", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "ALLEN", last: "GRAVES", team: "ORL", pos: "F", jersey: "22", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "QUENTON", last: "JACKSON", team: "IND", pos: "G", jersey: "29", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "DILLON", last: "BROOKS", team: "HOU", pos: "F", jersey: "9", kickoff: "SAT 2:00 AM" })}
            ${makeCardSlotHtml({ first: "TAYLOR", last: "HENDRICKS", team: "UTA", pos: "F", jersey: "0", kickoff: "SAT 4:00 AM" })}
          </div>
        </div>
      </main>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(lineups).toHaveLength(2);
    expect(lineups[0]).toMatchObject({
      name: "Arena Classic Contender #1",
      leaderboardName: "Arena Classic Contender",
      seasonScope: "classic",
      starCap: 11,
    });
    expect(lineups[1]).toMatchObject({
      name: "Arena In-Season Contender #2",
      leaderboardName: "Arena In-Season Contender",
      seasonScope: "in_season",
      starCap: 11,
    });
  });

  it("isolates 2-card partial lineups without leaking header tokens and never splits single cards", () => {
    const html = `
      <main>
        <div class="lineup-box">
          <div class="header">
            <span>In-Season Contender</span>
            <span>11★</span>
            <span>Early Tip</span>
            <span>Prize Pool</span>
            <button>View Lineup</button>
          </div>
          <div class="slots">
            <div class="card-slot"><span>AARON</span><span>GORDON</span></div>
            <div class="card-slot"><span>BROOK</span><span>LOPEZ</span></div>
            <div class="empty-slot"><span>Empty</span><span>Slot</span></div>
            <div class="empty-slot"><span>Empty</span><span>Slot</span></div>
            <div class="empty-slot"><span>Empty</span><span>Slot</span></div>
          </div>
        </div>
        <div class="lineup-box">
          <div class="header">
            <span>Classic Champion</span>
            <span>16★</span>
            <button>View Lineup</button>
          </div>
          <div class="slots">
            <div class="card-slot">
              <div class="portrait"><img src="https://assets.sorare.com/malik-monk.png" alt="Malik Monk" /></div>
              <div class="label"><span>MALIK</span><span>MONK</span></div>
            </div>
            <div class="card-slot">
              <div class="portrait"><img src="https://assets.sorare.com/dean-wade.png" alt="Dean Wade" /></div>
              <div class="label"><span>DEAN</span><span>WADE</span></div>
            </div>
          </div>
        </div>
      </main>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/pro",
    );
    expect(lineups).toHaveLength(2);
    expect(lineups[0]).toMatchObject({
      name: "In-Season Contender #1",
      starCap: 11,
      playerNames: ["Aaron Gordon", "Brook Lopez"],
    });
    expect(lineups[1]).toMatchObject({
      name: "Classic Champion #2",
      starCap: 16,
      playerNames: ["Malik Monk", "Dean Wade"],
    });
  });

  it("filters NYK v MIA, NY - BOS, and split <span>DET</span><span>vs.</span><span>LAL</span> while preserving V. Wembanyama", () => {
    const html = `
      <div class="lineup-box">
        <div><span>Classic Contender</span><span>11★</span><button>Edit Lineup</button></div>
        <div class="grid">
          <div class="card-slot">
            <span>DET</span><span>vs.</span><span>LAL</span><span>J.</span><span>ALLEN</span>
          </div>
          <div class="card-slot">
            <span>NYK v MIA</span><span>AARON</span><span>GORDON</span>
          </div>
          <div class="card-slot">
            <span>NY - BOS</span><span>GS - LA</span><span>BROOK</span><span>LOPEZ</span>
          </div>
          <div class="card-slot">
            <span>V.</span><span>WEMBANYAMA</span><span>SAS vs. DAL</span>
          </div>
          <div class="card-slot">
            <span>NICKEIL</span><span>ALEXANDER-WALKER</span><span>MIN - OKC</span>
          </div>
        </div>
      </div>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/pro",
    );
    expect(lineups).toHaveLength(1);
    expect(lineups[0].playerNames).toEqual([
      "J. Allen",
      "Aaron Gordon",
      "Brook Lopez",
      "V. Wembanyama",
      "Nickeil Alexander-Walker",
    ]);
  });

  it("retains single-span headers >= 72 chars and split In- / Season tokens", () => {
    const html = `
      <main>
        <div class="arena-lineup-card">
          <div class="header">
            <span>GW 18 • Nov 21 - Nov 23 • Pod of 10 • Arena Classic Contender • Limited • 11★ • Prize Pool</span>
            <button>Edit Lineup</button>
          </div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "MIL", pos: "C", jersey: "11", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "MALIK", last: "MONK", team: "SAC", pos: "G", jersey: "0", kickoff: "SAT 3:00 AM" })}
            ${makeCardSlotHtml({ first: "DEAN", last: "WADE", team: "CLE", pos: "F", jersey: "32", kickoff: "SAT 1:30 AM" })}
            ${makeCardSlotHtml({ first: "JARACE", last: "WALKER", team: "IND", pos: "F", jersey: "5", kickoff: "SAT 2:30 AM" })}
          </div>
        </div>
        <div class="arena-lineup-card">
          <div class="header">
            <span>GW 18 • Nov 21 - Nov 23 • Pod of 10 • Featured Limited Slate •</span>
            <span>In-</span><span>Season</span>
            <span>Contender</span>
            <span>11★</span>
            <button>View Lineup</button>
          </div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "BUB", last: "CARRINGTON", team: "WAS", pos: "G", jersey: "8", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "ALLEN", last: "GRAVES", team: "ORL", pos: "F", jersey: "22", kickoff: "SAT 1:00 AM" })}
            ${makeCardSlotHtml({ first: "QUENTON", last: "JACKSON", team: "IND", pos: "G", jersey: "29", kickoff: "SAT 2:30 AM" })}
            ${makeCardSlotHtml({ first: "DILLON", last: "BROOKS", team: "HOU", pos: "F", jersey: "9", kickoff: "SAT 2:00 AM" })}
            ${makeCardSlotHtml({ first: "TAYLOR", last: "HENDRICKS", team: "UTA", pos: "F", jersey: "0", kickoff: "SAT 4:00 AM" })}
          </div>
        </div>
      </main>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(lineups).toHaveLength(2);
    expect(lineups[0]).toMatchObject({
      name: "Arena Classic Contender #1",
      leaderboardName: "Arena Classic Contender",
      seasonScope: "classic",
      starCap: 11,
    });
    expect(lineups[0].playerNames).toHaveLength(5);
    expect(lineups[1]).toMatchObject({
      name: "Arena In-Season Contender #2",
      leaderboardName: "Arena In-Season Contender",
      seasonScope: "in_season",
      starCap: 11,
    });
    expect(lineups[1].playerNames).toHaveLength(5);
  });

  it("isolates partial lineups with .footer > button and abutting header tokens across nested .slots and flat siblings", () => {
    const html = `
      <main>
        <div class="lineup-box">
          <div class="header">
            <span>In-Season Contender</span>
            <span>11★</span>
            <span>Early Tip</span>
          </div>
          <div class="meta-badges">
            <span>Late Swap</span>
            <span>2/5 Locked</span>
          </div>
          <div class="slots">
            <div class="card-slot"><span>AARON</span><span>GORDON</span></div>
            <div class="card-slot"><span>BROOK</span><span>LOPEZ</span></div>
            <div class="empty-slot"><span>Empty</span><span>Slot</span></div>
            <div class="empty-slot"><span>Empty</span><span>Slot</span></div>
            <div class="empty-slot"><span>Empty</span><span>Slot</span></div>
          </div>
          <div class="footer">
            <button>Edit Lineup</button>
          </div>
        </div>
        <div class="lineup-box">
          <div class="header"><span>In-Season</span><span>Contender</span><span>Early Tip</span><span>Late Swap</span><span>2/5 Locked</span></div>
          <div class="card-slot"><span>AARON</span><span>GORDON</span></div>
          <div class="card-slot"><span>BROOK</span><span>LOPEZ</span></div>
          <div class="footer">
            <button>Edit Lineup</button>
          </div>
        </div>
      </main>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/pro",
    );
    expect(lineups).toHaveLength(2);
    expect(lineups[0]).toMatchObject({
      name: "In-Season Contender #1",
      leaderboardName: "In-Season Contender",
      seasonScope: "in_season",
      starCap: 11,
      playerNames: ["Aaron Gordon", "Brook Lopez"],
    });
    expect(lineups[1]).toMatchObject({
      name: "In-Season Contender #2",
      leaderboardName: "In-Season Contender",
      seasonScope: "in_season",
      playerNames: ["Aaron Gordon", "Brook Lopez"],
    });
  });

  it("strips split-span 3-token matchup triples (NYK v. MIA, NY - BOS, GS - LA) without losing Malik Monk or V. Wembanyama", () => {
    const html = `
      <div class="lineup-box">
        <div><span>Classic Contender</span><span>11★</span><button>Edit Lineup</button></div>
        <div class="grid">
          <div class="card-slot">
            <span>NYK</span><span>v.</span><span>MIA</span><span>J.</span><span>ALLEN</span>
          </div>
          <div class="card-slot">
            <span>NY</span><span>-</span><span>BOS</span><span>BROOK</span><span>LOPEZ</span>
          </div>
          <div class="card-slot">
            <span>GS</span><span>-</span><span>LA</span><span>MALIK</span><span>MONK</span>
          </div>
          <div class="card-slot">
            <span>V.</span><span>WEMBANYAMA</span><span>SAS</span><span>vs.</span><span>DAL</span>
          </div>
          <div class="card-slot">
            <span>V.</span><span>EDGECOMBE</span><span>PHI</span><span>@</span><span>NY</span>
          </div>
        </div>
      </div>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/pro",
    );
    expect(lineups).toHaveLength(1);
    expect(lineups[0].playerNames).toEqual([
      "J. Allen",
      "Brook Lopez",
      "Malik Monk",
      "V. Wembanyama",
      "V. Edgecombe",
    ]);
  });
  it("restores inner capitals for known ALL-CAPS NBA names (DeMar DeRozan, LeBron, LaMelo)", () => {
    expect(formatDisplayPlayerName("DEMAR DEROZAN")).toBe("DeMar DeRozan");
    expect(formatDisplayPlayerName("LEBRON JAMES")).toBe("LeBron James");
    expect(formatDisplayPlayerName("LAMELO BALL")).toBe("LaMelo Ball");
    expect(formatDisplayPlayerName("DAY'RON SHARPE")).toBe("Day'Ron Sharpe");
    expect(formatDisplayPlayerName("DeMar DeRozan")).toBe("DeMar DeRozan");
  });

  const mediaSlot = (slug: string, name: string) =>
    `<div><a href="/nba/cards/${slug}"><img src="https://assets.sorare.com/${slug}.png" alt="${name}" /></a></div>`;
  const fourMediaCards = [
    mediaSlot("aaron-gordon-2026-limited-45", "Aaron Gordon"),
    mediaSlot("brook-lopez-2026-limited-11", "Brook Lopez"),
    mediaSlot("malik-monk-2026-limited-88", "Malik Monk"),
    mediaSlot("dean-wade-2026-limited-19", "Dean Wade"),
  ].join("");
  const expectedFour = ["Aaron Gordon", "Brook Lopez", "Malik Monk", "Dean Wade"];

  it("drops media-free metadata badge rows next to media-backed card tiles (Probe 2e/2h Tailwind layout)", () => {
    const html = `
      <main>
        <section>
          <h3>Arena In-Season Contender</h3>
          <div class="flex items-center gap-2"><span>Late Swap</span><span>4/5 Locked</span></div>
          <div class="grid grid-cols-5">${fourMediaCards}</div>
          <div class="flex justify-end"><button>Edit Lineup</button></div>
        </section>
        <section>
          <h3>Arena Classic Contender</h3>
          <div class="meta-badges"><span>Late Swap</span><span>Featured Slate</span></div>
          <div class="slots">${fourMediaCards}</div>
          <div class="footer"><button>Edit Lineup</button></div>
        </section>
      </main>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(lineups).toHaveLength(2);
    expect(lineups[0].playerNames).toEqual(expectedFour);
    expect(lineups[1].playerNames).toEqual(expectedFour);
  });

  it("drops a media-free badge sibling from flat 2-card partial lineups (Probe 2f/2g)", () => {
    const html = `
      <main>
        <section>
          <h3>In-Season Contender</h3>
          <div class="meta-a"><span>Late Swap</span></div>
          <div class="meta-b"><span>Featured Slate</span></div>
          ${mediaSlot("aaron-gordon-2026-limited-45", "Aaron Gordon")}
          ${mediaSlot("brook-lopez-2026-limited-11", "Brook Lopez")}
          <div class="footer"><button>Edit Lineup</button></div>
        </section>
      </main>
    `;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/pro",
    );
    expect(lineups).toHaveLength(1);
    expect(lineups[0].playerNames).toEqual(["Aaron Gordon", "Brook Lopez"]);
  });
  it("parses live Sorare lineup markup (2026-11-19 capture): 'Name - limited' alts, one article per lineup", () => {
    const card = (id: string, name: string, time: string) =>
      `<div><img alt="${name} - limited" src="https://assets.sorare.com/image-resize/card/${id}/picture/tinified-x.png" /><div>${time}</div><div>○</div></div>`;
    const lineup = (uuid: string, cards: string) => `
      <div id="nba-21-23-nov-2026-nba_limited_contender~so5-lineup~${uuid}">
        <article>
          <a href="/nba/play/classic/nba-21-23-nov-2026/contender/nba-21-23-nov-2026-nba_limited_contender~so5-lineup~${uuid}">
            <img alt="" src="https://frontend-assets.sorare.com/football/manager_team/limited/icon.png" />
            <div>Classic</div><div>Contender</div><div>919</div>
          </a>
          <div>${cards}</div>
          <div>LEVEL UP</div>
          <button>Clear Team</button><button>Edit Lineup</button>
        </article>
      </div>`;
    const html = `<main><div id="nba-21-23-nov-2026~competition_with_arena~contender">${[
      lineup("a1000000-0000-4000-8000-000000000001", [
        card("c1", "Morez Johnson Jr.", "SAT 2:30 AM"),
        card("c2", "DeMar DeRozan", "SAT 3:00 AM"),
        card("c3", "Malik Monk", "SAT 2:30 AM"),
        card("c4", "Christian Anderson", "SAT 8:00 PM"),
        card("c5", "Taylor Hendricks", "SAT 2:30 AM"),
      ].join("")),
      lineup("a2000000-0000-4000-8000-000000000002", [
        card("d1", "Jarace Walker", "SAT 2:30 AM"),
        card("d2", "Bub Carrington", "SAT 2:30 AM"),
        card("d3", "Allen Graves", "SAT 3:00 AM"),
        card("d4", "Dean Wade", "SAT 2:30 AM"),
        card("d5", "Nikola Vučević", "SAT 2:30 AM"),
      ].join("")),
    ].join("")}</div></main>`;
    const lineups = extractOpenLineupsFromDocument(
      parseHtmlToDocument(html),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
    );
    expect(lineups).toHaveLength(2);
    expect(lineups[0].playerNames).toEqual([
      "Morez Johnson Jr.",
      "DeMar DeRozan",
      "Malik Monk",
      "Christian Anderson",
      "Taylor Hendricks",
    ]);
    expect(lineups[1].playerNames).toEqual([
      "Jarace Walker",
      "Bub Carrington",
      "Allen Graves",
      "Dean Wade",
      "Nikola Vučević",
    ]);
    expect(lineups[0].seasonScope).toBe("classic");
    expect(lineups[0].fixtureSlug).toBe("nba-21-23-nov-2026");
    // Sorare's own leaderboard slug wins over the "/arena" page URL heuristic.
    expect(lineups[0]).toMatchObject({
      name: "Classic Limited Contender #1",
      leaderboardSlug: "nba_limited_contender",
      contestKind: "pro",
      starCap: 11,
      sorareLineupId: "a1000000-0000-4000-8000-000000000001",
      id: "dom-a1000000-0000-4000-8000-000000000001",
    });

    // Board page (shows just the edited lineup after Edit Lineup -> Confirm) now syncs too,
    // but only boxes carrying Sorare's own lineup id.
    // Live board lineup page (captured 2026-11-19): no ~so5-lineup~ ids in the markup, the
    // competition comes from the URL. Mirrors the page after swapping Quenton -> Morez.
    const boardUrl =
      "https://sorare.com/nba/play/boards/arena/essence/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_contender/lineups";
    const boardCards = [
      card("c1", "Aaron Gordon", "SAT 5:00 AM"),
      card("c2", "Brook Lopez", "SUN 3:00 AM"),
      card("c3", "Wendell Carter Jr.", "SAT 2:30 AM"),
      card("c4", "Morez Johnson Jr.", "SUN 3:00 AM"),
      card("c5", "Dillon Brooks", "SAT 4:30 AM"),
    ].join("");
    const boardHtml = `<main><article><div><div>Classic</div><div>Contender</div><div>922</div></div>
      <div>${boardCards}</div><div>LEVEL UP</div><button>Clear Team</button><button>Edit Lineup</button></article>
      <button>View all lineups</button></main>`;
    const board = extractOpenLineupsFromDocument(parseHtmlToDocument(boardHtml), boardUrl);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({
      leaderboardSlug: "nba_limited_contender",
      leaderboardName: "Classic Limited Contender",
      fixtureSlug: "nba-21-23-nov-2026",
      starCap: 11,
      sorareLineupId: null,
    });
    expect(board[0].playerNames).toContain("Morez Johnson Jr.");
    expect(board[0].playerNames).not.toContain("Quenton Jackson");
    expect(isPartialLineupPage(boardUrl)).toBe(true);
    expect(isPartialLineupPage("https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026")).toBe(false);
    // The board map view (no /lineups) still yields nothing.
    expect(
      extractOpenLineupsFromDocument(
        parseHtmlToDocument(boardHtml),
        "https://sorare.com/nba/play/boards/arena/essence/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_contender",
      ),
    ).toEqual([]);
  });

  it("ignores Sorare's open '...' menu (Edit Lineup / Move to bottom) instead of adding a ghost lineup", () => {
    const lineupCard = `
        <div class="arena-lineup-card">
          <div class="header"><span>In Season</span><span>Contender</span><button>Edit Lineup</button></div>
          <div class="slots-grid">
            ${makeCardSlotHtml({ first: "AARON", last: "GORDON", team: "DEN", pos: "F", jersey: "32", kickoff: "SAT 5:00 AM" })}
            ${makeCardSlotHtml({ first: "DILLON", last: "BROOKS", team: "PHX", pos: "F", jersey: "3", kickoff: "SAT 4:30 AM" })}
            ${makeCardSlotHtml({ first: "BROOK", last: "LOPEZ", team: "LAC", pos: "C", jersey: "11", kickoff: "SUN 3:00 AM" })}
          </div>
        </div>`;
    for (const menu of [
      `<div role="menu"><button role="menuitem">Edit Lineup</button><button role="menuitem">Move to bottom</button></div>`,
      `<div class="portal-layer"><div><button>Edit Lineup</button><button>Move to bottom</button></div></div>`,
    ]) {
      const lineups = extractOpenLineupsFromDocument(
        parseHtmlToDocument(`<main>${lineupCard}</main>${menu}`),
        "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
      );
      expect(lineups).toHaveLength(1);
      expect(lineups[0].playerNames).toHaveLength(3);
    }
  });

  it("describes In-Season, Champion and Arena Room leaderboard slugs with live-verified caps", () => {
    const html = (slug: string) => `<main><div id="nba-21-23-nov-2026-${slug}~so5-lineup~b2000000-0000-4000-8000-000000000002"><article>
      <div><div><img alt="Aaron Gordon - rare" src="https://assets.sorare.com/x.png" /></div><div><img alt="Brook Lopez - rare" src="https://assets.sorare.com/y.png" /></div></div>
      <button>Clear Team</button><button>Edit Lineup</button></article></div></main>`;
    const url = "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026";
    const inSeason = extractOpenLineupsFromDocument(parseHtmlToDocument(html("nba_rare_in_season_champion")), url);
    expect(inSeason[0]).toMatchObject({
      leaderboardName: "In-Season Rare Champion",
      seasonScope: "in_season",
      starCap: 16,
      contestKind: "pro",
    });
    const superRare = extractOpenLineupsFromDocument(parseHtmlToDocument(html("nba_super_rare_contender")), url);
    expect(superRare[0]).toMatchObject({ leaderboardName: "Classic Super Rare Contender", starCap: 11 });
  });
});

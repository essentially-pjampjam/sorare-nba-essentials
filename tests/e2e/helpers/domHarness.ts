import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { transformWithOxc } from "vite";
import { REPO_ROOT } from "./contractLoader.ts";

export interface MiniRect {
  x: number;
  y: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MiniNode {
  nodeType: number;
  nodeName: string;
  parentNode: MiniNode | null;
  childNodes: MiniNode[];
  textContent: string | null;
}

const VOID_TAGS = new Set([
  "AREA",
  "BASE",
  "BR",
  "COL",
  "EMBED",
  "HR",
  "IMG",
  "INPUT",
  "LINK",
  "META",
  "PARAM",
  "SOURCE",
  "TRACK",
  "WBR",
]);

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "DIV",
  "DL",
  "DT",
  "DD",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
  "BUTTON",
  "A",
]);

const RAW_TEXT_TAGS = new Set(["SCRIPT", "STYLE"]);

function decodeHtmlEntities(raw: string): string {
  return raw.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (full, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos" || lower === "#39") return "'";
      if (lower === "nbsp") return " ";
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : full;
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : full;
      }
      return full;
    },
  );
}

function kebabToCamel(attr: string): string {
  return attr
    .replace(/^data-/i, "")
    .toLowerCase()
    .replace(/-([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase());
}

function camelToKebab(prop: string): string {
  return `data-${prop.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)}`;
}

export class MiniTextNode implements MiniNode {
  nodeType = 3;
  nodeName = "#text";
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  textContent: string;

  constructor(text: string) {
    this.textContent = text;
  }
}

export class MiniShadowRoot {
  mode: "open" | "closed";
  host: MiniHTMLElement;
  childNodes: MiniNode[] = [];

  constructor(host: MiniHTMLElement, mode: "open" | "closed") {
    this.host = host;
    this.mode = mode;
  }

  get children(): MiniHTMLElement[] {
    return this.childNodes.filter(
      (n): n is MiniHTMLElement => n instanceof MiniHTMLElement,
    );
  }

  appendChild(node: MiniNode): MiniNode {
    node.parentNode = null;
    this.childNodes.push(node);
    return node;
  }

  append(...nodes: Array<MiniNode | string>): void {
    for (const item of nodes) {
      if (typeof item === "string") {
        this.appendChild(new MiniTextNode(item));
      } else {
        this.appendChild(item);
      }
    }
  }

  querySelectorAll(selector: string): MiniHTMLElement[] {
    return querySelectorAllFromNodes(this.children, selector);
  }

  querySelector(selector: string): MiniHTMLElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class MiniClassList {
  private readonly el: MiniHTMLElement;

  constructor(el: MiniHTMLElement) {
    this.el = el;
  }

  private tokens(): string[] {
    return (this.el.getAttribute("class") ?? "")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  private save(list: string[]): void {
    if (list.length === 0) {
      this.el.removeAttribute("class");
    } else {
      this.el.setAttribute("class", list.join(" "));
    }
  }

  contains(token: string): boolean {
    return this.tokens().includes(token);
  }

  add(...tokens: string[]): void {
    const next = new Set(this.tokens());
    for (const t of tokens) {
      if (t) next.add(t);
    }
    this.save(Array.from(next));
  }

  remove(...tokens: string[]): void {
    const removeSet = new Set(tokens);
    this.save(this.tokens().filter((t) => !removeSet.has(t)));
  }

  toggle(token: string, force?: boolean): boolean {
    const has = this.contains(token);
    const shouldAdd = force !== undefined ? force : !has;
    if (shouldAdd) {
      this.add(token);
      return true;
    }
    this.remove(token);
    return false;
  }
}

export class MiniHTMLElement implements MiniNode {
  nodeType = 1;
  tagName: string;
  nodeName: string;
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  shadowRoot: MiniShadowRoot | null = null;
  style: Record<string, string> = {};
  ownerDocument: MiniDocument | null = null;
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();
  readonly classList: MiniClassList;
  readonly dataset: Record<string, string>;

  constructor(tagName: string, ownerDocument: MiniDocument | null = null) {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.ownerDocument = ownerDocument;
    this.classList = new MiniClassList(this);
    this.dataset = new Proxy<Record<string, string>>(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop !== "string") return undefined;
          return this.attrs.get(camelToKebab(prop));
        },
        set: (_target, prop, value) => {
          if (typeof prop !== "string") return false;
          this.attrs.set(camelToKebab(prop), String(value));
          return true;
        },
        deleteProperty: (_target, prop) => {
          if (typeof prop !== "string") return false;
          this.attrs.delete(camelToKebab(prop));
          return true;
        },
        has: (_target, prop) => {
          if (typeof prop !== "string") return false;
          return this.attrs.has(camelToKebab(prop));
        },
        ownKeys: () => {
          const keys: string[] = [];
          for (const k of this.attrs.keys()) {
            if (k.startsWith("data-")) keys.push(kebabToCamel(k));
          }
          return keys;
        },
        getOwnPropertyDescriptor: (_target, prop) => {
          if (typeof prop !== "string") return undefined;
          const val = this.attrs.get(camelToKebab(prop));
          if (val === undefined) return undefined;
          return {
            enumerable: true,
            configurable: true,
            writable: true,
            value: val,
          };
        },
      },
    );
  }

  get children(): MiniHTMLElement[] {
    return this.childNodes.filter(
      (n): n is MiniHTMLElement => n instanceof MiniHTMLElement,
    );
  }

  get parentElement(): MiniHTMLElement | null {
    return this.parentNode instanceof MiniHTMLElement ? this.parentNode : null;
  }

  get id(): string {
    return this.getAttribute("id") ?? "";
  }

  set id(val: string) {
    this.setAttribute("id", val);
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }

  set className(val: string) {
    this.setAttribute("class", val);
  }

  get href(): string {
    return this.getAttribute("href") ?? "";
  }

  set href(val: string) {
    this.setAttribute("href", val);
  }

  get src(): string {
    return this.getAttribute("src") ?? "";
  }

  set src(val: string) {
    this.setAttribute("src", val);
  }

  get alt(): string {
    return this.getAttribute("alt") ?? "";
  }

  set alt(val: string) {
    this.setAttribute("alt", val);
  }

  get title(): string {
    return this.getAttribute("title") ?? "";
  }

  set title(val: string) {
    this.setAttribute("title", val);
  }

  get type(): string {
    return this.getAttribute("type") ?? "";
  }

  set type(val: string) {
    this.setAttribute("type", val);
  }

  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(val: string) {
    this.setAttribute("name", val);
  }

  get placeholder(): string {
    return this.getAttribute("placeholder") ?? "";
  }

  set placeholder(val: string) {
    this.setAttribute("placeholder", val);
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(val: boolean) {
    if (val) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }

  get readOnly(): boolean {
    return this.hasAttribute("readonly");
  }

  set readOnly(val: boolean) {
    if (val) this.setAttribute("readonly", "");
    else this.removeAttribute("readonly");
  }

  get textContent(): string {
    let acc = "";
    for (const child of this.childNodes) {
      acc += child.textContent ?? "";
    }
    return acc;
  }

  set textContent(val: string) {
    this.childNodes = val ? [new MiniTextNode(val)] : [];
    for (const c of this.childNodes) c.parentNode = this;
  }

  get innerText(): string {
    const lines: string[] = [];
    let current = "";

    const flush = () => {
      const cleaned = current.replace(/[ \t\r\f]+/g, " ").trim();
      if (cleaned) lines.push(cleaned);
      current = "";
    };

    const walk = (node: MiniNode) => {
      if (node.nodeType === 3) {
        const raw = node.textContent ?? "";
        const parts = raw.split(/\r?\n/);
        for (let i = 0; i < parts.length; i += 1) {
          if (i > 0) flush();
          const seg = parts[i].replace(/[ \t\r\f]+/g, " ").trim();
          if (seg) {
            current = current ? `${current} ${seg}` : seg;
          }
        }
        return;
      }
      if (!(node instanceof MiniHTMLElement)) return;
      const tag = node.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG") {
        return;
      }
      if (tag === "BR") {
        flush();
        return;
      }
      const isBlock = BLOCK_TAGS.has(tag);
      if (isBlock) flush();
      for (const child of node.childNodes) {
        walk(child);
      }
      if (isBlock) flush();
    };

    for (const child of this.childNodes) {
      walk(child);
    }
    flush();
    return lines.join("\n");
  }

  getAttribute(name: string): string | null {
    const val = this.attrs.get(name.toLowerCase());
    return val !== undefined ? val : null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name.toLowerCase());
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name.toLowerCase(), value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name.toLowerCase());
  }

  getAttributeNames(): string[] {
    return Array.from(this.attrs.keys());
  }

  appendChild<T extends MiniNode>(node: T): T {
    if (node.parentNode instanceof MiniHTMLElement) {
      const prevIdx = node.parentNode.childNodes.indexOf(node);
      if (prevIdx !== -1) node.parentNode.childNodes.splice(prevIdx, 1);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  append(...nodes: Array<MiniNode | string>): void {
    for (const item of nodes) {
      if (typeof item === "string") {
        this.appendChild(new MiniTextNode(item));
      } else {
        this.appendChild(item);
      }
    }
  }

  remove(): void {
    if (!this.parentNode) return;
    const idx = this.parentNode.childNodes.indexOf(this);
    if (idx !== -1) {
      this.parentNode.childNodes.splice(idx, 1);
    }
    this.parentNode = null;
  }

  attachShadow(init: { mode: "open" | "closed" }): MiniShadowRoot {
    this.shadowRoot = new MiniShadowRoot(this, init.mode);
    return this.shadowRoot;
  }

  getBoundingClientRect(): MiniRect {
    if (this.style.display === "none" || this.hasAttribute("hidden")) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      };
    }
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 220,
      bottom: 140,
      width: 220,
      height: 140,
    };
  }

  scrollIntoView(): void {
    // No-op in headless harness
  }

  focus(): void {
    // No-op in headless harness
  }

  click(): void {
    this.dispatchEvent({ type: "click", bubbles: true, target: this });
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(ev: { type: string; bubbles?: boolean; target?: unknown }): boolean {
    const set = this.listeners.get(ev.type);
    if (set) {
      for (const fn of set) fn(ev);
    }
    if (ev.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(ev);
    }
    return true;
  }

  matches(selector: string): boolean {
    return matchesSelectorList(this, selector);
  }

  closest(selector: string): MiniHTMLElement | null {
    let cur: MiniHTMLElement | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): MiniHTMLElement[] {
    return querySelectorAllFromNodes(this.children, selector);
  }

  querySelector(selector: string): MiniHTMLElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class MiniHTMLInputElement extends MiniHTMLElement {
  private _value: string | null = null;
  checked = false;

  constructor(ownerDocument: MiniDocument | null = null) {
    super("input", ownerDocument);
  }

  get value(): string {
    return this._value !== null ? this._value : (this.getAttribute("value") ?? "");
  }

  set value(v: string) {
    this._value = v;
  }
}

interface AttrCondition {
  name: string;
  op: "" | "=" | "*=" | "^=" | "$=";
  value: string;
  caseInsensitive: boolean;
}

interface SimpleCompoundSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: AttrCondition[];
  nots: SimpleCompoundSelector[];
}

interface ComplexPart {
  combinator: "" | " " | ">" | "+" | "~";
  compound: SimpleCompoundSelector;
}

function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;

  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (quote) {
      if (ch === quote && selector[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      depthParen += 1;
    } else if (ch === ")") {
      depthParen = Math.max(0, depthParen - 1);
    } else if (ch === "[") {
      depthBracket += 1;
    } else if (ch === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
    } else if (ch === "," && depthParen === 0 && depthBracket === 0) {
      const seg = selector.slice(start, i).trim();
      if (seg) parts.push(seg);
      start = i + 1;
    }
  }
  const tail = selector.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseCompoundSelector(raw: string): SimpleCompoundSelector {
  const res: SimpleCompoundSelector = {
    tag: null,
    id: null,
    classes: [],
    attrs: [],
    nots: [],
  };

  let i = 0;
  const len = raw.length;
  while (i < len) {
    const ch = raw[i];
    if (ch === "*") {
      res.tag = "*";
      i += 1;
    } else if (ch === "#") {
      i += 1;
      const start = i;
      while (i < len && /[a-zA-Z0-9_-]/.test(raw[i])) i += 1;
      res.id = raw.slice(start, i);
    } else if (ch === ".") {
      i += 1;
      const start = i;
      while (i < len && /[a-zA-Z0-9_-]/.test(raw[i])) i += 1;
      const cls = raw.slice(start, i);
      if (cls) res.classes.push(cls);
    } else if (ch === "[") {
      const closeIdx = findClosingChar(raw, i, "[", "]");
      const inner = raw.slice(i + 1, closeIdx).trim();
      const attrCond = parseAttributeCondition(inner);
      if (attrCond) res.attrs.push(attrCond);
      i = closeIdx + 1;
    } else if (raw.slice(i, i + 5).toLowerCase() === ":not(") {
      const closeIdx = findClosingChar(raw, i + 4, "(", ")");
      const inner = raw.slice(i + 5, closeIdx).trim();
      for (const sub of splitSelectorList(inner)) {
        res.nots.push(parseCompoundSelector(sub));
      }
      i = closeIdx + 1;
    } else if (ch === ":") {
      // Skip unsupported pseudo-classes gracefully without breaking match
      i += 1;
      while (i < len && /[a-zA-Z0-9_-]/.test(raw[i])) i += 1;
      if (raw[i] === "(") {
        i = findClosingChar(raw, i, "(", ")") + 1;
      }
    } else if (/[a-zA-Z0-9_-]/.test(ch)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_-]/.test(raw[i])) i += 1;
      res.tag = raw.slice(start, i).toUpperCase();
    } else {
      i += 1;
    }
  }
  return res;
}

function findClosingChar(
  str: string,
  openIdx: number,
  openCh: string,
  closeCh: string,
): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = openIdx; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      if (ch === quote && str[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth <= 0) return i;
    }
  }
  return str.length - 1;
}

function parseAttributeCondition(inner: string): AttrCondition | null {
  const m = inner.match(
    /^([a-zA-Z0-9_:-]+)\s*(?:(\*=|\^=|\$=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))(?:\s+(i|s))?)?$/i,
  );
  if (!m) return null;
  const name = m[1].toLowerCase();
  const op = (m[2] ?? "") as AttrCondition["op"];
  const value = m[3] ?? m[4] ?? m[5] ?? "";
  const caseInsensitive = (m[6] ?? "").toLowerCase() === "i";
  return { name, op, value, caseInsensitive };
}

function parseComplexSelector(selector: string): ComplexPart[] {
  const tokens: Array<{ type: "comb" | "sel"; value: string }> = [];
  let i = 0;
  const s = selector.trim();

  while (i < s.length) {
    if (/\s/.test(s[i])) {
      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (i < s.length && (s[i] === ">" || s[i] === "+" || s[i] === "~")) {
        tokens.push({ type: "comb", value: s[i] });
        i += 1;
        while (i < s.length && /\s/.test(s[i])) i += 1;
      } else if (tokens.length > 0 && tokens[tokens.length - 1].type === "sel") {
        tokens.push({ type: "comb", value: " " });
      }
      continue;
    }
    if (s[i] === ">" || s[i] === "+" || s[i] === "~") {
      tokens.push({ type: "comb", value: s[i] });
      i += 1;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      continue;
    }
    const start = i;
    let quote: '"' | "'" | null = null;
    let depthBracket = 0;
    let depthParen = 0;
    while (i < s.length) {
      const ch = s[i];
      if (quote) {
        if (ch === quote && s[i - 1] !== "\\") quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "[") depthBracket += 1;
      else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
      else if (ch === "(") depthParen += 1;
      else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
      else if (
        depthBracket === 0 &&
        depthParen === 0 &&
        (/\s/.test(ch) || ch === ">" || ch === "+" || ch === "~")
      ) {
        break;
      }
      i += 1;
    }
    const rawComp = s.slice(start, i).trim();
    if (rawComp) tokens.push({ type: "sel", value: rawComp });
  }

  const parts: ComplexPart[] = [];
  let pendingComb: ComplexPart["combinator"] = "";
  for (const tok of tokens) {
    if (tok.type === "comb") {
      pendingComb = tok.value as ComplexPart["combinator"];
    } else {
      parts.push({
        combinator: pendingComb,
        compound: parseCompoundSelector(tok.value),
      });
      pendingComb = "";
    }
  }
  return parts;
}

function matchesCompound(
  el: MiniHTMLElement,
  comp: SimpleCompoundSelector,
): boolean {
  if (comp.tag && comp.tag !== "*" && el.tagName !== comp.tag) {
    return false;
  }
  if (comp.id !== null && el.id !== comp.id) {
    return false;
  }
  if (comp.classes.length > 0) {
    for (const cls of comp.classes) {
      if (!el.classList.contains(cls)) return false;
    }
  }
  for (const attr of comp.attrs) {
    const rawVal = el.getAttribute(attr.name);
    if (rawVal === null) return false;
    if (!attr.op) continue;
    const actual = attr.caseInsensitive ? rawVal.toLowerCase() : rawVal;
    const target = attr.caseInsensitive ? attr.value.toLowerCase() : attr.value;
    if (attr.op === "=" && actual !== target) return false;
    if (attr.op === "*=" && (!target || !actual.includes(target))) return false;
    if (attr.op === "^=" && (!target || !actual.startsWith(target))) return false;
    if (attr.op === "$=" && (!target || !actual.endsWith(target))) return false;
  }
  for (const negated of comp.nots) {
    if (matchesCompound(el, negated)) return false;
  }
  return true;
}

function matchesComplexAt(
  el: MiniHTMLElement,
  parts: ComplexPart[],
  partIdx: number,
): boolean {
  const part = parts[partIdx];
  if (!part || !matchesCompound(el, part.compound)) return false;
  if (partIdx === 0) return true;

  const comb = part.combinator;
  if (comb === ">") {
    return el.parentElement
      ? matchesComplexAt(el.parentElement, parts, partIdx - 1)
      : false;
  }
  if (comb === " ") {
    let cur = el.parentElement;
    while (cur) {
      if (matchesComplexAt(cur, parts, partIdx - 1)) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  if (comb === "+") {
    const parent = el.parentElement;
    if (!parent) return false;
    const siblings = parent.children;
    const idx = siblings.indexOf(el);
    if (idx <= 0) return false;
    return matchesComplexAt(siblings[idx - 1], parts, partIdx - 1);
  }
  if (comb === "~") {
    const parent = el.parentElement;
    if (!parent) return false;
    const siblings = parent.children;
    const idx = siblings.indexOf(el);
    for (let j = idx - 1; j >= 0; j -= 1) {
      if (matchesComplexAt(siblings[j], parts, partIdx - 1)) return true;
    }
    return false;
  }
  return false;
}

function matchesSelectorList(el: MiniHTMLElement, selector: string): boolean {
  const compiled = splitSelectorList(selector).map(parseComplexSelector);
  for (const parts of compiled) {
    if (parts.length > 0 && matchesComplexAt(el, parts, parts.length - 1)) {
      return true;
    }
  }
  return false;
}

function querySelectorAllFromNodes(
  roots: MiniHTMLElement[],
  selector: string,
): MiniHTMLElement[] {
  const compiled = splitSelectorList(selector)
    .map(parseComplexSelector)
    .filter((p) => p.length > 0);
  if (compiled.length === 0) return [];

  const matched: MiniHTMLElement[] = [];
  const visit = (el: MiniHTMLElement) => {
    for (const parts of compiled) {
      if (matchesComplexAt(el, parts, parts.length - 1)) {
        matched.push(el);
        break;
      }
    }
    for (const child of el.children) {
      visit(child);
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return matched;
}

function parseAttributes(rawAttrStr: string): Array<[string, string]> {
  const attrs: Array<[string, string]> = [];
  let i = 0;
  const len = rawAttrStr.length;

  while (i < len) {
    while (i < len && /\s/.test(rawAttrStr[i])) i += 1;
    if (i >= len) break;
    if (rawAttrStr[i] === "/") {
      i += 1;
      continue;
    }
    const nameStart = i;
    while (i < len && !/[\s=/>]/.test(rawAttrStr[i])) i += 1;
    const name = rawAttrStr.slice(nameStart, i).toLowerCase();
    if (!name) {
      i += 1;
      continue;
    }
    while (i < len && /\s/.test(rawAttrStr[i])) i += 1;
    let val = "";
    if (i < len && rawAttrStr[i] === "=") {
      i += 1;
      while (i < len && /\s/.test(rawAttrStr[i])) i += 1;
      if (i < len && (rawAttrStr[i] === '"' || rawAttrStr[i] === "'")) {
        const q = rawAttrStr[i];
        i += 1;
        const valStart = i;
        while (i < len && rawAttrStr[i] !== q) i += 1;
        val = decodeHtmlEntities(rawAttrStr.slice(valStart, i));
        if (i < len && rawAttrStr[i] === q) i += 1;
      } else {
        const valStart = i;
        while (i < len && !/[\s>]/.test(rawAttrStr[i])) i += 1;
        val = decodeHtmlEntities(rawAttrStr.slice(valStart, i));
      }
    }
    attrs.push([name, val]);
  }

  return attrs;
}

export class MiniDocument {
  readonly URL: string;
  readonly location: {
    href: string;
    pathname: string;
    search: string;
    hash: string;
    origin: string;
    reload: () => void;
  };
  readonly documentElement: MiniHTMLElement;
  readonly head: MiniHTMLElement;
  readonly body: MiniHTMLElement;
  private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();

  constructor(html: string, url: string) {
    const parsed = new URL(url, "https://sorare.com");
    this.URL = parsed.toString();
    this.location = {
      href: parsed.toString(),
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      origin: parsed.origin,
      reload: () => {
        // No-op in headless harness
      },
    };
    this.documentElement = new MiniHTMLElement("html", this);
    this.head = new MiniHTMLElement("head", this);
    this.body = new MiniHTMLElement("body", this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);

    this.parseHtmlIntoBody(html);
  }

  private parseHtmlIntoBody(html: string): void {
    const stack: MiniHTMLElement[] = [this.documentElement];
    let activeTarget: MiniHTMLElement = this.body;
    let sawBody = false;
    let i = 0;
    const len = html.length;

    const currentParent = (): MiniHTMLElement => {
      if (stack.length > 1) return stack[stack.length - 1];
      return activeTarget;
    };

    while (i < len) {
      const lt = html.indexOf("<", i);
      if (lt === -1) {
        const tailText = decodeHtmlEntities(html.slice(i));
        if (tailText) {
          currentParent().appendChild(new MiniTextNode(tailText));
        }
        break;
      }

      if (lt > i) {
        const text = decodeHtmlEntities(html.slice(i, lt));
        if (text) {
          currentParent().appendChild(new MiniTextNode(text));
        }
      }

      if (html.startsWith("<!--", lt)) {
        const endComment = html.indexOf("-->", lt + 4);
        i = endComment === -1 ? len : endComment + 3;
        continue;
      }

      if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
        const endDecl = html.indexOf(">", lt + 2);
        i = endDecl === -1 ? len : endDecl + 1;
        continue;
      }

      const gt = findTagEnd(html, lt + 1);
      if (gt === -1) break;
      const tagContent = html.slice(lt + 1, gt).trim();
      i = gt + 1;

      if (!tagContent) continue;

      if (tagContent.startsWith("/")) {
        const closeTag = tagContent.slice(1).trim().toUpperCase();
        for (let s = stack.length - 1; s >= 1; s -= 1) {
          if (stack[s].tagName === closeTag) {
            stack.length = s;
            break;
          }
        }
        if (closeTag === "HEAD" && !sawBody) {
          activeTarget = this.body;
        }
        continue;
      }

      const selfClosing = tagContent.endsWith("/");
      const cleaned = selfClosing ? tagContent.slice(0, -1).trim() : tagContent;
      const spaceIdx = cleaned.search(/\s/);
      const rawTagName =
        spaceIdx === -1 ? cleaned : cleaned.slice(0, spaceIdx);
      const tagUpper = rawTagName.toUpperCase();
      const attrStr = spaceIdx === -1 ? "" : cleaned.slice(spaceIdx + 1);

      if (tagUpper === "HTML") {
        for (const [k, v] of parseAttributes(attrStr)) {
          this.documentElement.setAttribute(k, v);
        }
        continue;
      }
      if (tagUpper === "HEAD") {
        for (const [k, v] of parseAttributes(attrStr)) {
          this.head.setAttribute(k, v);
        }
        if (!selfClosing) stack.push(this.head);
        continue;
      }
      if (tagUpper === "BODY") {
        sawBody = true;
        activeTarget = this.body;
        for (const [k, v] of parseAttributes(attrStr)) {
          this.body.setAttribute(k, v);
        }
        if (!selfClosing) stack.push(this.body);
        continue;
      }

      const el = this.createElement(tagUpper);
      for (const [k, v] of parseAttributes(attrStr)) {
        el.setAttribute(k, v);
      }
      currentParent().appendChild(el);

      if (RAW_TEXT_TAGS.has(tagUpper) && !selfClosing) {
        const closeRe = new RegExp(`</${tagUpper}\\s*>`, "i");
        const match = closeRe.exec(html.slice(i));
        if (match) {
          const rawBody = html.slice(i, i + match.index);
          if (rawBody) el.appendChild(new MiniTextNode(rawBody));
          i += match.index + match[0].length;
        }
        continue;
      }

      if (!selfClosing && !VOID_TAGS.has(tagUpper)) {
        stack.push(el);
      }
    }
  }

  createElement(tagName: string): MiniHTMLElement {
    if (tagName.toLowerCase() === "input") {
      return new MiniHTMLInputElement(this);
    }
    return new MiniHTMLElement(tagName, this);
  }

  createTextNode(text: string): MiniTextNode {
    return new MiniTextNode(text);
  }

  getElementById(id: string): MiniHTMLElement | null {
    const visit = (el: MiniHTMLElement): MiniHTMLElement | null => {
      if (el.id === id) return el;
      for (const child of el.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.documentElement);
  }

  querySelectorAll(selector: string): MiniHTMLElement[] {
    return querySelectorAllFromNodes([this.documentElement], selector);
  }

  querySelector(selector: string): MiniHTMLElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
}

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

export function createMiniDocument(html: string, url: string): MiniDocument {
  return new MiniDocument(html, url);
}

function extractExportedNames(js: string): string[] {
  const names = new Set<string>();
  const declRe =
    /^\s*export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(js)) !== null) {
    names.add(m[1]);
  }
  const listRe = /^\s*export\s*\{([^}]+)\}\s*;?/gm;
  while ((m = listRe.exec(js)) !== null) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const asMatch = seg.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      names.add(asMatch ? asMatch[2] : seg);
    }
  }
  return Array.from(names);
}

function stripExportsFromTransformedJs(js: string): string {
  return js
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(
      /^\s*export\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/gm,
      "",
    )
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "");
}

function resolveLocalTsFile(fromFile: string, specifier: string): string | null {
  const baseDir = dirname(fromFile);
  const candidates = [
    resolve(baseDir, specifier),
    resolve(baseDir, `${specifier}.ts`),
    resolve(baseDir, `${specifier}.tsx`),
    resolve(baseDir, specifier, "index.ts"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function rewriteNamedImports(
  js: string,
  fromFile: string,
  depVarByPath: Map<string, string>,
): { rewrittenJs: string; depPaths: string[] } {
  const depPaths: string[] = [];
  const importRe =
    /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?\s*$/gm;

  const rewrittenJs = js.replace(importRe, (_full, clause: string, spec: string) => {
    const trimmedClause = clause.trim();
    if (!spec.startsWith(".") || trimmedClause.startsWith("type ")) {
      return "";
    }
    const target = resolveLocalTsFile(fromFile, spec);
    if (!target) return "";
    depPaths.push(target);
    let depVar = depVarByPath.get(target);
    if (!depVar) {
      depVar = `__vm_mod_${depVarByPath.size}`;
      depVarByPath.set(target, depVar);
    }

    const nsMatch = trimmedClause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (nsMatch) {
      return `const ${nsMatch[1]} = ${depVar};`;
    }
    const namedMatch = trimmedClause.match(/\{([\s\S]*)\}/);
    if (namedMatch) {
      const bindings: string[] = [];
      for (const rawItem of namedMatch[1].split(",")) {
        const item = rawItem.trim();
        if (!item || item.startsWith("type ")) continue;
        const asMatch = item.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        if (asMatch) {
          bindings.push(`${asMatch[1]}: ${asMatch[2]}`);
        } else {
          bindings.push(item);
        }
      }
      if (bindings.length === 0) return "";
      return `const { ${bindings.join(", ")} } = ${depVar};`;
    }
    return "";
  });

  return { rewrittenJs, depPaths };
}

async function compileTsBundleForVm(entryPath: string): Promise<string[]> {
  const depVarByPath = new Map<string, string>();
  const compiledModules = new Map<string, string>();
  const order: string[] = [];

  const visit = async (absPath: string, isEntry: boolean) => {
    if (compiledModules.has(absPath)) return;
    const rawTs = readFileSync(absPath, "utf8");
    const transformed = await transformWithOxc(rawTs, absPath, { lang: "ts" });
    const exportedNames = extractExportedNames(transformed.code);
    const { rewrittenJs, depPaths } = rewriteNamedImports(
      transformed.code,
      absPath,
      depVarByPath,
    );
    for (const dep of depPaths) {
      await visit(dep, false);
    }
    const bodyJs = stripExportsFromTransformedJs(rewrittenJs);
    if (isEntry) {
      compiledModules.set(absPath, bodyJs);
    } else {
      const varName =
        depVarByPath.get(absPath) ?? `__vm_mod_${depVarByPath.size}`;
      depVarByPath.set(absPath, varName);
      const returnObj = exportedNames.join(", ");
      // Also surface key parser helpers on globalThis if entry doesn't export them
      const wrapped = `const ${varName} = (() => {\n${bodyJs}\nreturn { ${returnObj} };\n})();`;
      compiledModules.set(absPath, wrapped);
    }
    order.push(absPath);
  };

  await visit(entryPath, true);
  return order.map((p) => compiledModules.get(p) ?? "");
}

function inferContextFromShadowOrMessages(
  doc: MiniDocument,
  pageContextMsg: { isCraftPage?: boolean } | null,
  sandbox: Record<string, unknown>,
  url: string,
): string {
  const classifyFn = sandbox.classifySorareContext;
  if (typeof classifyFn === "function") {
    try {
      const hasModal = doc
        .querySelectorAll('[role="dialog"]')
        .some((d) => {
          const t = d.textContent;
          return t.includes("COLLECT") && (t.includes("Draft 26") || t.includes("Full Collection"));
        });
      const out = (classifyFn as (u: string, m?: boolean) => string)(url, hasModal);
      if (typeof out === "string" && out) return out;
    } catch {
      // Fall through to shadow DOM inspection
    }
  }

  const host = doc.getElementById("jamassist-sorare-root");
  const subEl = host?.shadowRoot?.querySelector(".sub");
  const subText = (subEl?.textContent ?? "").toLowerCase();
  if (subText.includes("craft active")) return "craft";
  if (subText.includes("collect quests")) return "quests";
  if (subText.includes("lineup helper")) return "lineups";
  if (subText.includes("collection ev")) return "collections";
  if (subText.includes("market deals")) return "market";
  if (pageContextMsg?.isCraftPage) return "craft";
  return "general";
}

export async function runContentScriptInVm(
  html: string,
  url: string,
  chromeMock: unknown,
): Promise<{ extractedLineups: unknown[]; context: string; errors: string[] }> {
  const doc = createMiniDocument(html, url);
  const errors: string[] = [];
  let extractedLineups: unknown[] = [];
  let pageContextMsg: { isCraftPage?: boolean } | null = null;

  const baseChrome = (
    chromeMock && typeof chromeMock === "object"
      ? (chromeMock as Record<string, unknown>)
      : {}
  ) as {
    chrome?: Record<string, unknown>;
    runtime?: Record<string, unknown>;
    storage?: Record<string, unknown>;
  };

  // Accept either ChromeMockHandle (`{ chrome: ... }`) or a raw `chrome` object
  const chromeObj = (baseChrome.chrome ?? baseChrome) as {
    runtime?: {
      id?: string;
      lastError?: unknown;
      getURL?: (p: string) => string;
      sendMessage?: (msg: unknown, cb?: (res?: unknown) => void) => unknown;
      onMessage?: { addListener?: (fn: unknown) => void };
    };
    storage?: {
      local?: {
        get?: (keys: unknown, cb?: (res: Record<string, unknown>) => void) => unknown;
        set?: (items: unknown, cb?: () => void) => unknown;
        remove?: (keys: unknown, cb?: () => void) => unknown;
      };
      onChanged?: { addListener?: (fn: unknown) => void };
    };
  };

  const origSendMessage = chromeObj.runtime?.sendMessage?.bind(chromeObj.runtime);
  const wrappedChrome = {
    ...chromeObj,
    runtime: {
      ...(chromeObj.runtime ?? {}),
      id: chromeObj.runtime?.id ?? "jamassist-test-extension-id",
      getURL:
        chromeObj.runtime?.getURL ??
        ((p: string) => `chrome-extension://jamassist-test-extension-id/${p}`),
      onMessage: chromeObj.runtime?.onMessage ?? {
        addListener: () => {},
      },
      sendMessage: (msg: unknown, cb?: (res?: unknown) => void) => {
        if (msg && typeof msg === "object") {
          const rec = msg as Record<string, unknown>;
          if (rec.type === "DETECTED_LINEUPS_FROM_CONTENT" && Array.isArray(rec.lineups)) {
            extractedLineups = rec.lineups;
          } else if (rec.type === "SORARE_PAGE_CONTEXT") {
            pageContextMsg = rec as { isCraftPage?: boolean };
          }
        }
        if (origSendMessage) {
          return origSendMessage(msg, cb);
        }
        cb?.({ ok: true });
        return Promise.resolve({ ok: true });
      },
    },
    storage: chromeObj.storage ?? {
      local: {
        get: (_k: unknown, cb?: (res: Record<string, unknown>) => void) => {
          cb?.({});
          return Promise.resolve({});
        },
        set: (_items: unknown, cb?: () => void) => {
          cb?.();
          return Promise.resolve();
        },
        remove: (_keys: unknown, cb?: () => void) => {
          cb?.();
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: () => {},
      },
    },
  };

  const pendingTimers = new Set<ReturnType<typeof globalThis.setTimeout>>();
  const safeSetTimeout = (fn: () => void, ms?: number): number => {
    const id = globalThis.setTimeout(() => {
      pendingTimers.delete(id);
      try {
        fn();
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }, ms ?? 0);
    pendingTimers.add(id);
    return id as unknown as number;
  };
  const safeClearTimeout = (id: number): void => {
    const handle = id as unknown as ReturnType<typeof globalThis.setTimeout>;
    pendingTimers.delete(handle);
    globalThis.clearTimeout(handle);
  };

  class MockMutationObserver {
    constructor(_cb: unknown) {}
    observe(_target: unknown, _opts: unknown): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  }

  class MockEvent {
    type: string;
    bubbles: boolean;
    constructor(type: string, init?: { bubbles?: boolean }) {
      this.type = type;
      this.bubbles = Boolean(init?.bubbles);
    }
  }

  const sandbox: Record<string, unknown> = {
    document: doc,
    location: doc.location,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    HTMLElement: MiniHTMLElement,
    HTMLInputElement: MiniHTMLInputElement,
    Element: MiniHTMLElement,
    Node: Object,
    Event: MockEvent,
    MutationObserver: MockMutationObserver,
    URL,
    URLSearchParams,
    chrome: wrappedChrome,
    console: {
      log: () => {},
      warn: () => {},
      error: (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      },
    },
    setTimeout: safeSetTimeout,
    clearTimeout: safeClearTimeout,
    requestAnimationFrame: (cb: () => void) => safeSetTimeout(cb, 0),
    cancelAnimationFrame: safeClearTimeout,
    getComputedStyle: (el: MiniHTMLElement) => ({
      position: el?.style?.position || "static",
      display: el?.style?.display || "block",
    }),
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Set,
    Map,
    RegExp,
    Error,
    Promise,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const detectorPath = resolve(REPO_ROOT, "src/content/sorareDetector.ts");

  try {
    const jsChunks = await compileTsBundleForVm(detectorPath);
    const context = vm.createContext(sandbox);
    for (let i = 0; i < jsChunks.length; i += 1) {
      const script = new vm.Script(jsChunks[i], {
        filename: i === jsChunks.length - 1 ? "sorareDetector.js" : `dep-${i}.js`,
      });
      script.runInContext(context, { timeout: 3000 });
    }

    // Flush microtasks so storage callbacks or async functions settle cleanly
    await Promise.resolve();
    await new Promise<void>((r) => {
      globalThis.setTimeout(r, 15);
    });

    if (
      extractedLineups.length === 0 &&
      typeof sandbox.extractOpenLineupsFromDocument === "function"
    ) {
      try {
        const direct = (
          sandbox.extractOpenLineupsFromDocument as (
            d: MiniDocument,
            u: string,
          ) => unknown[]
        )(doc, url);
        if (Array.isArray(direct) && direct.length > 0) {
          extractedLineups = direct;
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const detectedContext = inferContextFromShadowOrMessages(
      doc,
      pageContextMsg,
      sandbox,
      url,
    );

    return {
      extractedLineups,
      context: detectedContext,
      errors,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {
      extractedLineups,
      context: inferContextFromShadowOrMessages(doc, pageContextMsg, sandbox, url),
      errors,
    };
  } finally {
    for (const id of pendingTimers) {
      globalThis.clearTimeout(id);
    }
    pendingTimers.clear();
  }
}

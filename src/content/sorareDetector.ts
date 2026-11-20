/**
 * Lightweight content script on sorare.com:
 * 1. Detects the viewed/logged-in Sorare username and Craft pages across SPA navigations.
 * 2. Injects a Liquid Glass bottom-right launcher pill displaying the user's logo.png.
 * 3. Supports optional auto-open on Craft / Sorare pages on first user gesture.
 * Imports only ./sorareDomParser (inlined by Rollup into a classic zero-import/zero-export IIFE).
 */
import {
  classifySorareContext as classifyContextFromUrl,
  extractOpenLineupsFromDocument,
  isCraftRoute as isCraftRouteUrl,
  isPartialLineupPage,
  normalizeNameForMatch,
  type DomDetectedLineup,
} from "./sorareDomParser";

(() => {
  const RESERVED_SEGMENTS = new Set([
    "nba",
    "football",
    "mlb",
    "baseball",
    "market",
    "cards",
    "club",
    "my-club",
    "play",
    "rewards",
    "lobby",
    "invite",
    "settings",
    "help",
    "terms",
    "privacy",
    "auth",
    "login",
    "signup",
    "craft",
    "card-factory",
    "essence",
    "collections",
    "common",
    "limited",
    "rare",
    "super-rare",
    "super_rare",
    "unique",
    "custom",
    "lineups",
    "pro",
    "set",
    "arcade",
    "series",
    "squad",
    "boards",
    "cash",
    "prev",
    "ongoing",
    "leaderboards",
    "gameplay",
    "daily",
    "following",
    "search",
    "my-cards",
    "my-sorare",
    "scores",
    "missions",
    "arena",
    "classic",
    "divination",
    "rookie",
    "special",
    "all",
    "packs",
    "vault",
    "shop",
    "notifications",
  ]);

  let lastSentUser = "";
  let lastCraftState: boolean | null = null;
  let lastSentEssenceSig = "";
  let lastSentWalletSig = "";
  let lastSentLineupsSig = "";
  let currentDetected: string | null = null;
  let currentRouteKind: "craft" | "quests" | "lineups" | "collections" | "market" | "general" = "general";
  let badgeSubEl: HTMLElement | null = null;
  let pillEl: HTMLButtonElement | null = null;
  let autoOpenedThisRoute = false;
  let decoratingBusy = false;
  let lastHref = window.location.href;
  let observerTimer: number | null = null;
  let activeHighlightedTile: HTMLElement | null = null;
  let activeHighlightTimer: number | null = null;

  function isValidUserSlug(raw: string): boolean {
    const candidate = raw.trim().toLowerCase();
    return Boolean(
      candidate &&
        !RESERVED_SEGMENTS.has(candidate) &&
        /^[a-z0-9_-]{2,40}$/i.test(candidate),
    );
  }

  function isCraftRoute(href: string = window.location.href): boolean {
    return isCraftRouteUrl(href);
  }

  function hasCollectModalOpen(): boolean {
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    for (const dlg of dialogs) {
      const text = dlg.textContent || "";
      if (text.includes("COLLECT") && (text.includes("Draft 26") || text.includes("Full Collection"))) {
        return true;
      }
    }
    return false;
  }

  function classifySorareContext(
    href: string = window.location.href,
  ): "craft" | "quests" | "lineups" | "collections" | "market" | "general" {
    return classifyContextFromUrl(href, hasCollectModalOpen());
  }

  function detectUsername(): string | null {
    // 1. Primary: Sorare top-right account profile button (`button[aria-haspopup="dialog"] [role="img"][aria-label]`)
    const profileImgs = document.querySelectorAll<HTMLElement>(
      'button[aria-haspopup="dialog"] [role="img"][aria-label], header [role="img"][aria-label]',
    );
    for (const img of profileImgs) {
      const label = (img.getAttribute("aria-label") || "").trim().toLowerCase();
      if (isValidUserSlug(label)) {
        return label;
      }
    }

    // 2. Fallback: explicit /club/<slug>, /u/<slug>, /gallery/<slug> URL path
    const parts = window.location.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);

    for (let i = 0; i < parts.length; i += 1) {
      const seg = parts[i].toLowerCase();
      if ((seg === "club" || seg === "u" || seg === "gallery") && parts[i + 1]) {
        const candidate = parts[i + 1].toLowerCase();
        if (isValidUserSlug(candidate)) {
          return candidate;
        }
      }
    }

    const links = document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/club/"], a[href*="/u/"], a[href*="/gallery/"]',
    );
    for (const link of links) {
      try {
        const url = new URL(link.href, window.location.origin);
        const segs = url.pathname.split("/").filter(Boolean);
        for (let i = 0; i < segs.length; i += 1) {
          const s = segs[i].toLowerCase();
          if ((s === "club" || s === "u" || s === "gallery") && segs[i + 1]) {
            const candidate = segs[i + 1].toLowerCase();
            if (isValidUserSlug(candidate)) {
              return candidate;
            }
          }
        }
      } catch {
        // Ignore malformed href
      }
    }

    return null;
  }

  /** Set (Common) pages live under /series/; there the sidebar Essence counter is Set Essence. */
  function isSetModePage(): boolean {
    return /\/series(\/|$)/i.test(location.pathname);
  }

  function detectEssenceBalances(): Record<string, number> | null {
    const out: Record<string, number> = {};
    const setMode = isSetModePage();

    // 1. Live bottom-left nav collapsed sidebar Essence button (gradient SVG + integer)
    const navButtons = document.querySelectorAll<HTMLElement>(
      "nav button, aside button",
    );
    for (const btn of navButtons) {
      const hasEssenceIcon = Boolean(
        btn.querySelector('linearGradient[id*="essence" i], path[fill*="green-400" i]'),
      );
      if (!hasEssenceIcon) continue;
      const numMatch = (btn.textContent || "").replace(/,/g, "").trim().match(/^(\d{1,5})$/);
      // Set Essence uses a purple gradient (`essence-gradient-purple`); Limited Essence is green.
      const purple = Boolean(btn.querySelector('linearGradient[id*="purple" i]'));
      if (numMatch) {
        const val = Number(numMatch[1]);
        if (Number.isFinite(val) && val >= 0 && val <= 50000) {
          const key = setMode || purple ? "common" : "limited";
          if (out[key] === undefined) out[key] = val;
        }
      }
    }

    // 2. Explicit craft/aria-labeled essence counters
    const candidates = document.querySelectorAll<HTMLElement>(
      'nav a[href*="/craft"], nav a[href*="/card-factory"], aside a[href*="/craft"], [aria-label*="essence" i], [data-testid*="essence" i], [title*="essence" i]',
    );
    for (const el of candidates) {
      const label = (
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.getAttribute("href") ||
        ""
      ).toLowerCase();
      const rawText = (el.textContent || "").replace(/,/g, "").trim();
      if (rawText.length > 24 || rawText.includes("/")) continue;
      const m = rawText.match(/^(\d{1,5})$/);
      if (!m) continue;
      const num = Number(m[1]);
      if (!Number.isFinite(num) || num <= 0 || num > 50000) continue;

      if (label.includes("unique")) {
        out.unique = num;
      } else if (label.includes("super")) {
        out.super_rare = num;
      } else if (label.includes("rare")) {
        out.rare = num;
      } else if (label.includes("limited")) {
        if (out.limited === undefined) out.limited = num;
      } else if (label.includes("essence") || label.includes("craft")) {
        // Unlabeled Essence counter: Set Essence on Set pages, Limited Essence on Pro pages.
        const key = setMode ? "common" : "limited";
        if (out[key] === undefined) out[key] = num;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  function detectWalletBalances(): {
    cashAmount: number | null;
    cashSymbol: string | null;
    ethAmount: number | null;
    cluesCount: number | null;
  } | null {
    let cashAmount: number | null = null;
    let cashSymbol: string | null = null;
    let ethAmount: number | null = null;
    let cluesCount: number | null = null;

    const buttons = document.querySelectorAll<HTMLElement>(
      "nav button, aside button",
    );
    for (const btn of buttons) {
      const text = (btn.textContent || "").replace(/\u00a0/g, " ").trim();
      if (!text) continue;

      if (btn.querySelector('linearGradient[id*="boost" i]')) {
        const clueMatch = text.replace(/,/g, "").match(/^(\d{1,4})$/);
        if (clueMatch) {
          cluesCount = Number(clueMatch[1]);
        }
      }

      const fiatMatch = text.match(/^([€$£])\s*(\d+(?:[.,]\d+)?)$/);
      if (fiatMatch) {
        const parsed = Number.parseFloat(fiatMatch[2].replace(",", "."));
        if (Number.isFinite(parsed)) {
          cashSymbol = fiatMatch[1];
          cashAmount = parsed;
        }
        continue;
      }

      const ethMatch = text.match(/^(\d+(?:[.,]\d+)?)\s*ETH$/i);
      if (ethMatch) {
        const parsed = Number.parseFloat(ethMatch[1].replace(",", "."));
        if (Number.isFinite(parsed)) {
          ethAmount = parsed;
        }
      }
    }

    if (
      cashAmount === null &&
      ethAmount === null &&
      cluesCount === null
    ) {
      return null;
    }
    return { cashAmount, cashSymbol, ethAmount, cluesCount };
  }

  function detectOpenLineupsFromDom(): DomDetectedLineup[] {
    return extractOpenLineupsFromDocument(document, window.location.href);
  }

  function isContextValid(): boolean {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function updateOverlayUI(): void {
    if (!isContextValid()) {
      if (badgeSubEl) {
        badgeSubEl.textContent = "Updated • Click to refresh";
      }
      return;
    }
    currentRouteKind = classifySorareContext();
    const onCraft = currentRouteKind === "craft";
    if (pillEl) {
      pillEl.classList.toggle("craft-glow", onCraft);
    }
    if (badgeSubEl) {
      if (currentRouteKind === "craft") {
        badgeSubEl.textContent = "Craft Active • Analyze";
      } else if (currentRouteKind === "quests") {
        badgeSubEl.textContent = "Collect Quests • View Cheapest";
      } else if (currentRouteKind === "lineups") {
        badgeSubEl.textContent = currentDetected
          ? `@${currentDetected} • Lineup Helper`
          : "Lineup Helper • Open Wizard";
      } else if (currentRouteKind === "collections") {
        badgeSubEl.textContent = "Collection EV • View Floors";
      } else if (currentRouteKind === "market") {
        badgeSubEl.textContent = "Market Deals • $/L10 & 1ST";
      } else if (currentDetected) {
        badgeSubEl.textContent = `@${currentDetected}`;
      } else {
        badgeSubEl.textContent = "Open Helper";
      }
    }
  }

  function reportContext(): void {
    const found = detectUsername();
    const onCraft = isCraftRoute();

    if (found) {
      currentDetected = found;
    }
    updateOverlayUI();

    if (found && found !== lastSentUser) {
      lastSentUser = found;
      try {
        chrome.runtime.sendMessage({
          type: "DETECTED_USERNAME_FROM_CONTENT",
          username: found,
          sourceUrl: window.location.href,
        });
      } catch {
        // Ignore if extension context reloaded
      }
    }

    if (lastCraftState !== onCraft) {
      lastCraftState = onCraft;
      try {
        chrome.runtime.sendMessage({
          type: "SORARE_PAGE_CONTEXT",
          url: window.location.href,
          isCraftPage: onCraft,
          username: found,
        });
      } catch {
        // Ignore
      }
    }

    const essence = detectEssenceBalances();
    if (essence) {
      const sig = JSON.stringify(essence);
      if (sig !== lastSentEssenceSig) {
        lastSentEssenceSig = sig;
        try {
          chrome.runtime.sendMessage({
            type: "DETECTED_ESSENCE_FROM_CONTENT",
            balances: essence,
          });
        } catch {
          // Ignore
        }
      }
    }

    const wallet = detectWalletBalances();
    if (wallet) {
      const wSig = JSON.stringify(wallet);
      if (wSig !== lastSentWalletSig) {
        lastSentWalletSig = wSig;
        try {
          chrome.runtime.sendMessage({
            type: "DETECTED_WALLET_FROM_CONTENT",
            wallet,
          });
        } catch {
          // Ignore
        }
      }
    }

    const domLineups = detectOpenLineupsFromDom();
    if (domLineups.length > 0) {
      const lSig = JSON.stringify(domLineups);
      if (lSig !== lastSentLineupsSig) {
        lastSentLineupsSig = lSig;
        try {
          chrome.runtime.sendMessage({
            type: "DETECTED_LINEUPS_FROM_CONTENT",
            lineups: domLineups,
            partial: isPartialLineupPage(window.location.href),
          });
        } catch {
          // Ignore
        }
      }
    }
  }

  let autoOpenFlags: {
    autoOpenOnCraft: boolean;
    autoOpenOnSorare: boolean;
    autoShowInPageWizards: boolean;
  } = {
    autoOpenOnCraft: true,
    autoOpenOnSorare: false,
    autoShowInPageWizards: true,
  };

  interface OverlayLookup {
    ownedSet: Set<string>;
    firstOwnerSet: Set<string>;
    hotMap: Record<string, string>;
  }

  let overlayLookup: OverlayLookup = {
    ownedSet: new Set<string>(),
    firstOwnerSet: new Set<string>(),
    hotMap: {},
  };

  const DRAFT_26_SLUGS = new Set<string>([
    "ebuka-okorie-20070410",
    "karim-lopez-20070412",
    "zuby-ejiofor-20040420",
    "allen-graves-20060728",
    "christian-anderson-jr-20060402",
    "hannes-steinbach-20060501",
    "labaron-philon-jr-20051124",
    "chris-cenac-jr-20070201",
    "alex-karaban-20021111",
    "joshua-jefferson-20031121",
    "aday-mara-20050407",
    "aj-dybantsa-20070129",
    "bennett-stirtz-20031003",
    "brayden-burries-20050918",
    "caleb-wilson-20060718",
    "cameron-boozer-20070718",
    "cameron-carr-20041121",
    "dailyn-swain-20050715",
    "darius-acuff-20061116",
    "darryn-peterson-20070117",
    "jayden-quaintance-20070711",
    "keaton-wagler-20070203",
    "kingston-flemings-20070103",
    "koa-peat-20070120",
    "mikel-brown-20060403",
    "morez-johnson-20060125",
    "nate-ament-20061210",
    "sergio-de-larrea-20051104",
    "tarris-reed-jr-20030805",
    "yaxel-lendeborg-20020930",
  ]);

  function applyRawOverlayLookup(rawObj: unknown): void {
    if (!rawObj || typeof rawObj !== "object") return;
    const rec = rawObj as {
      ownedPlayerSlugs?: unknown;
      firstOwnerPlayerSlugs?: unknown;
      hotByPlayerSlug?: unknown;
    };
    overlayLookup = {
      ownedSet: new Set(
        Array.isArray(rec.ownedPlayerSlugs)
          ? rec.ownedPlayerSlugs.filter((s): s is string => typeof s === "string")
          : [],
      ),
      firstOwnerSet: new Set(
        Array.isArray(rec.firstOwnerPlayerSlugs)
          ? rec.firstOwnerPlayerSlugs.filter(
              (s): s is string => typeof s === "string",
            )
          : [],
      ),
      hotMap:
        rec.hotByPlayerSlug && typeof rec.hotByPlayerSlug === "object"
          ? (rec.hotByPlayerSlug as Record<string, string>)
          : {},
    };
  }

  try {
    // Only read non-secret auto-open flags & public slug lookup; API keys stay isolated from content scripts
    chrome.storage.local.get(
      ["jamassist_content_flags_v1", "jamassist_overlay_lookup_v1"],
      (raw) => {
        const f = raw?.jamassist_content_flags_v1 as
          | {
              autoOpenOnCraft?: boolean;
              autoOpenOnSorare?: boolean;
              autoShowInPageWizards?: boolean;
            }
          | undefined;
        if (f) {
          autoOpenFlags = {
            autoOpenOnCraft: f.autoOpenOnCraft ?? true,
            autoOpenOnSorare: f.autoOpenOnSorare ?? false,
            autoShowInPageWizards: f.autoShowInPageWizards ?? true,
          };
        }
        applyRawOverlayLookup(raw?.jamassist_overlay_lookup_v1);
        window.setTimeout(() => {
          document
            .querySelectorAll<HTMLElement>("[data-jamassist-decorated]")
            .forEach((el) => delete el.dataset.jamassistDecorated);
          void decorateSorareCardTiles();
        }, 50);
      },
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.jamassist_content_flags_v1?.newValue) {
        const f = changes.jamassist_content_flags_v1.newValue as {
          autoOpenOnCraft?: boolean;
          autoOpenOnSorare?: boolean;
          autoShowInPageWizards?: boolean;
        };
        autoOpenFlags = {
          autoOpenOnCraft: f.autoOpenOnCraft ?? true,
          autoOpenOnSorare: f.autoOpenOnSorare ?? false,
          autoShowInPageWizards: f.autoShowInPageWizards ?? true,
        };
      }
      if (changes.jamassist_overlay_lookup_v1?.newValue) {
        applyRawOverlayLookup(changes.jamassist_overlay_lookup_v1.newValue);
        document
          .querySelectorAll<HTMLElement>("[data-jamassist-decorated]")
          .forEach((el) => delete el.dataset.jamassistDecorated);
        document
          .querySelectorAll<HTMLElement>(".jamassist-card-overlay-pill")
          .forEach((el) => el.remove());
        void decorateSorareCardTiles();
      }
    });
  } catch {
    // Ignore if context invalid
  }

  function tryAutoOpenOnGesture(): void {
    if (autoOpenedThisRoute) return;
    const onCraft = isCraftRoute();
    const shouldOpenCraft = onCraft && autoOpenFlags.autoOpenOnCraft;
    const shouldOpenAny = autoOpenFlags.autoOpenOnSorare;
    if (!shouldOpenCraft && !shouldOpenAny) return;
    autoOpenedThisRoute = true;
    try {
      chrome.runtime.sendMessage({
        type: "OPEN_SIDE_PANEL",
        targetTab: onCraft ? "craft" : undefined,
      });
    } catch {
      // Ignore
    }
  }

  function injectBottomLauncher(): void {
    if (!document.body || document.getElementById("jamassist-sorare-root")) {
      return;
    }

    const host = document.createElement("div");
    host.id = "jamassist-sorare-root";
    const shadow = host.attachShadow({ mode: "open" });

    let logoSrc = "";
    try {
      logoSrc = chrome.runtime.getURL("logo.png");
    } catch {
      logoSrc = "";
    }

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
      }
      .wrap {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, ui-sans-serif, system-ui, sans-serif;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 13px 6px 7px;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: linear-gradient(180deg, rgba(28, 39, 64, 0.78), rgba(13, 19, 34, 0.74));
        color: #f8fafc;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.28),
          inset 0 -1px 0 rgba(0, 0, 0, 0.42),
          0 14px 32px rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(20px) saturate(170%);
        -webkit-backdrop-filter: blur(20px) saturate(170%);
        cursor: pointer;
        transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease;
      }
      .pill:hover {
        transform: translateY(-1px);
        border-color: rgba(251, 191, 36, 0.7);
        background: linear-gradient(180deg, rgba(35, 48, 78, 0.88), rgba(15, 23, 42, 0.86));
      }
      .pill.craft-glow {
        border-color: rgba(52, 211, 153, 0.75);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.30),
          0 0 0 3px rgba(16, 185, 129, 0.18),
          0 14px 32px rgba(0, 0, 0, 0.55);
      }
      .pill.minimized {
        padding: 5px;
      }
      .logo-badge {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
      }
      .logo-img {
        width: 26px;
        height: 26px;
        object-fit: contain;
        display: block;
      }
      .logo-fallback {
        color: #020617;
        font-size: 10.5px;
        font-weight: 900;
      }
      .text {
        display: flex;
        flex-direction: column;
        line-height: 1.15;
        text-align: left;
      }
      .title {
        font-size: 11.5px;
        font-weight: 700;
        color: #f8fafc;
      }
      .sub {
        font-size: 10px;
        color: #fbbf24;
        font-weight: 500;
      }
      .pill.craft-glow .sub {
        color: #6ee7b7;
      }
      .min-btn {
        width: 22px;
        height: 22px;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(15, 23, 42, 0.72);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .min-btn:hover {
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.35);
      }
      .hidden {
        display: none;
      }
      @media (prefers-reduced-transparency: reduce) {
        .pill, .min-btn {
          background: #0f172a;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
      }
    `;

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "pill";
    pill.title = "Open pjampjam's Sorare NBA Essentials";
    pillEl = pill;

    const logoBadge = document.createElement("span");
    logoBadge.className = "logo-badge";
    if (logoSrc) {
      const img = document.createElement("img");
      img.src = logoSrc;
      img.alt = "Sorare NBA Essentials";
      img.className = "logo-img";
      logoBadge.appendChild(img);
    } else {
      const fb = document.createElement("span");
      fb.className = "logo-fallback";
      fb.textContent = "PE";
      logoBadge.appendChild(fb);
    }

    const text = document.createElement("span");
    text.className = "text";

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = "Sorare NBA Essentials";

    const sub = document.createElement("span");
    sub.className = "sub";
    badgeSubEl = sub;

    text.append(title, sub);
    pill.append(logoBadge, text);

    const minBtn = document.createElement("button");
    minBtn.type = "button";
    minBtn.className = "min-btn";
    minBtn.title = "Minimize / Expand";
    minBtn.textContent = "−";

    let minimized = false;
    minBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      minimized = !minimized;
      text.classList.toggle("hidden", minimized);
      pill.classList.toggle("minimized", minimized);
      minBtn.textContent = minimized ? "+" : "−";
    });

    pill.addEventListener("click", () => {
      if (!isContextValid()) {
        window.location.reload();
        return;
      }
      const routeKind = classifySorareContext();
      const targetTab =
        routeKind === "craft"
          ? "craft"
          : routeKind === "quests" || routeKind === "collections"
            ? "collections"
            : routeKind === "lineups"
              ? "lineups"
              : routeKind === "market"
                ? "bargains"
                : undefined;
      try {
        chrome.runtime.sendMessage(
          {
            type: "OPEN_SIDE_PANEL",
            targetTab,
          },
          () => {
            if (chrome.runtime.lastError && badgeSubEl) {
              badgeSubEl.textContent = "Updated • Click to refresh";
            }
          },
        );
      } catch {
        window.location.reload();
      }
    });

    const dashBtn = document.createElement("button");
    dashBtn.type = "button";
    dashBtn.className = "min-btn";
    dashBtn.title = "Open Full Dashboard Website View";
    dashBtn.textContent = "⤢";
    dashBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!isContextValid()) {
        window.location.reload();
        return;
      }
      const routeKind = classifySorareContext();
      const targetTab =
        routeKind === "craft"
          ? "craft"
          : routeKind === "quests" || routeKind === "collections"
            ? "collections"
            : routeKind === "lineups"
              ? "lineups"
              : routeKind === "market"
                ? "bargains"
                : undefined;
      try {
        chrome.runtime.sendMessage({
          type: "OPEN_DASHBOARD_TAB",
          targetTab,
        });
      } catch {
        // Ignore
      }
    });

    wrap.append(pill, dashBtn, minBtn);
    shadow.append(style, wrap);
    document.body.appendChild(host);
    updateOverlayUI();
  }

  function checkPendingLineupHud(): void {
    try {
      chrome.storage.local.get("jamassist_pending_lineup_hud", (raw) => {
        const pending = raw?.jamassist_pending_lineup_hud as
          | {
              playerNames?: string[];
              slots?: LineupHighlightSlot[];
              formatLabel?: string;
              projectedTotal?: number;
              autoHighlightFirst?: boolean;
              createdAt?: number;
            }
          | undefined;
        if (
          pending &&
          Array.isArray(pending.playerNames) &&
          pending.playerNames.length > 0 &&
          typeof pending.createdAt === "number" &&
          Date.now() - pending.createdAt < 120_000
        ) {
          void chrome.storage.local.remove("jamassist_pending_lineup_hud");
          showLineupChecklist(
            pending.playerNames,
            pending.formatLabel ?? "Lineup",
            pending.projectedTotal ?? 0,
            pending.slots,
            Boolean(pending.autoHighlightFirst),
          );
        }
      });
    } catch {
      // Ignore
    }
  }

  reportContext();
  injectBottomLauncher();
  checkPendingLineupHud();
  void decorateSorareCardTiles();

  // Trigger optional auto-open on user click when on craft / configured pages
  document.addEventListener(
    "click",
    () => {
      tryAutoOpenOnGesture();
    },
    { capture: true, passive: true },
  );

  function extractPlayerSlugFromHref(href: string): string | null {
    const queryMatch = href.match(
      /[?&](?:card|player)=([a-z0-9-]+?)(?:-\d{4}-(?:common|limited|rare|super_rare|unique)(?:-\d+)?)?(?:[&#]|$)/i,
    );
    if (queryMatch?.[1]) {
      return queryMatch[1].toLowerCase();
    }
    const pathMatch = href.match(
      /\/nba\/(?:cards|players)\/([a-z0-9-]+?)(?:-\d{4}-(?:common|limited|rare|super_rare|unique)(?:-\d+)?)?(?:[/?#]|$)/i,
    );
    return pathMatch?.[1]?.toLowerCase() ?? null;
  }

  async function decorateSorareCardTiles(): Promise<void> {
    if (decoratingBusy || !autoOpenFlags.autoShowInPageWizards) return;
    decoratingBusy = true;
    try {
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/nba/cards/"], a[href*="/nba/players/"], a[href*="card="], a[href*="player="]',
        ),
      ).filter((a) => !a.dataset.jamassistDecorated && isElementVisible(a));

      if (anchors.length === 0) return;
      const targets = anchors.slice(0, 60);
      const BATCH = 20;

      for (let i = 0; i < targets.length; i += BATCH) {
        const chunk = targets.slice(i, i + BATCH);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            for (const link of chunk) {
              link.dataset.jamassistDecorated = "1";
              const slug = extractPlayerSlugFromHref(link.getAttribute("href") ?? "");
              if (!slug) continue;

              const container =
                (link.closest("article, [data-testid*='card' i], li") as HTMLElement | null) ??
                link;
              if (container.querySelector(".jamassist-card-overlay-pill")) continue;
              const rect = container.getBoundingClientRect();
              if (rect.width < 56 || rect.height < 56) continue;

              const tags: string[] = [];
              if (overlayLookup.firstOwnerSet.has(slug)) {
                tags.push("✅ 1ST");
              } else if (overlayLookup.ownedSet.has(slug)) {
                tags.push("✅ OWNED");
              }
              if (
                DRAFT_26_SLUGS.has(slug) &&
                !overlayLookup.firstOwnerSet.has(slug)
              ) {
                tags.push("🏆 Draft 26'");
              }
              const hotLabel = overlayLookup.hotMap[slug];
              if (hotLabel) {
                tags.push(`🔥 ${hotLabel}`);
              }

              if (tags.length === 0) continue;

              const cs = window.getComputedStyle(container);
              if (cs.position === "static") {
                container.style.position = "relative";
              }

              const pill = document.createElement("div");
              pill.className = "jamassist-card-overlay-pill";
              pill.textContent = tags.slice(0, 2).join(" • ");
              pill.style.position = "absolute";
              pill.style.top = "6px";
              pill.style.left = "6px";
              pill.style.zIndex = "20";
              pill.style.pointerEvents = "none";
              pill.style.padding = "2px 6px";
              pill.style.borderRadius = "999px";
              pill.style.fontSize = "10px";
              pill.style.fontWeight = "700";
              pill.style.letterSpacing = "0.01em";
              pill.style.background = "rgba(11, 13, 18, 0.88)";
              pill.style.color = tags[0].includes("Draft")
                ? "#fcd34d"
                : tags[0].includes("1ST")
                  ? "#6ee7b7"
                  : "#e2e8f0";
              pill.style.border = "1px solid rgba(251, 191, 36, 0.45)";
              pill.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.45)";
              container.appendChild(pill);
            }
            resolve();
          });
        });
        const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
        if (g.scheduler?.yield) {
          await g.scheduler.yield();
        }
      }
    } finally {
      decoratingBusy = false;
    }
  }

  const handleSpaNavigation = () => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      autoOpenedThisRoute = false;
      checkPendingLineupHud();
    }
    reportContext();
    void decorateSorareCardTiles();
  };

  window.addEventListener("popstate", handleSpaNavigation);
  window.addEventListener("hashchange", handleSpaNavigation);

  const observer = new MutationObserver(() => {
    if (!document.getElementById("jamassist-sorare-root")) {
      injectBottomLauncher();
    }
    if (observerTimer !== null) return;
    observerTimer = window.setTimeout(() => {
      observerTimer = null;
      handleSpaNavigation();
    }, 300);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  interface LineupHighlightSlot {
    slotLabel: string;
    cardSlug: string;
    playerName: string;
    rarity: string;
    seasonYear: number;
    isCaptain: boolean;
  }

  function clearActiveTileHighlight(): void {
    if (activeHighlightTimer !== null) {
      window.clearTimeout(activeHighlightTimer);
      activeHighlightTimer = null;
    }
    if (activeHighlightedTile) {
      activeHighlightedTile.style.outline = "";
      activeHighlightedTile.style.outlineOffset = "";
      activeHighlightedTile = null;
    }
  }

  function isElementVisible(el: Element): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findDrawerSearchInput(): HTMLInputElement | null {
    const containers = Array.from(
      document.querySelectorAll('[role="dialog"], [class*="drawer" i], [class*="modal" i], main'),
    ).filter(isElementVisible);
    const roots = containers.length > 0 ? [...containers, document.body] : [document.body];
    for (const root of roots) {
      const inputs = Array.from(
        root.querySelectorAll('input[type="search"], input[type="text"], input:not([type])'),
      ).filter(
        (el): el is HTMLInputElement =>
          el instanceof HTMLInputElement &&
          isElementVisible(el) &&
          !el.disabled &&
          !el.readOnly,
      );
      const hinted = inputs.find((inp) => {
        const hint = `${inp.placeholder} ${inp.getAttribute("aria-label") ?? ""} ${inp.name}`.toLowerCase();
        return /search|player|filter|name|card/.test(hint);
      });
      if (hinted) return hinted;
      if (inputs.length > 0 && root !== document.body) return inputs[0];
    }
    return null;
  }

  function setReactInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    input.focus();
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pickClickableContainer(el: Element): HTMLElement | null {
    const candidate =
      el.closest('button, a, [role="button"], [data-testid*="card" i], article, li') ??
      el.parentElement;
    if (!(candidate instanceof HTMLElement)) return null;
    const rect = candidate.getBoundingClientRect();
    if (rect.width < 28 || rect.height < 28 || rect.height > 460) return null;
    return candidate;
  }

  function containsExactSlug(haystack: string, slug: string): boolean {
    let idx = haystack.indexOf(slug);
    while (idx !== -1) {
      const before = idx > 0 ? haystack[idx - 1] : "";
      const after = haystack[idx + slug.length] ?? "";
      const beforeOk = !before || !/[a-z0-9-]/i.test(before);
      const afterOk = !after || !/[a-z0-9-]/i.test(after);
      if (beforeOk && afterOk) return true;
      idx = haystack.indexOf(slug, idx + 1);
    }
    return false;
  }

  function findCardTile(slot: LineupHighlightSlot): HTMLElement | null {
    const slugLower = slot.cardSlug.trim().toLowerCase();
    const normName = normalizeNameForMatch(slot.playerName);
    const playerSlug = slugLower
      ? slugLower.replace(/-\d{4}-(?:common|limited|rare|super_rare|unique)(?:-\d+)?$/i, "")
      : normName
        ? normName.replace(/\s+/g, "-")
        : "";

    const drawerRoots = Array.from(
      document.querySelectorAll('[role="dialog"], [class*="drawer" i], [class*="modal" i]'),
    ).filter(isElementVisible);
    const searchRoots =
      drawerRoots.length > 0 ? [...drawerRoots, document.body] : [document.body];

    if (slugLower) {
      for (const root of searchRoots) {
        const mediaOrLinks = root.querySelectorAll(
          "img[src], a[href], [data-card-slug]",
        );
        for (const node of Array.from(mediaOrLinks)) {
          if (!isElementVisible(node)) continue;
          const src = (node.getAttribute("src") ?? "").toLowerCase();
          const href = (node.getAttribute("href") ?? "").toLowerCase();
          const dataSlug = (node.getAttribute("data-card-slug") ?? "").toLowerCase();
          const matchesSlug =
            containsExactSlug(src, slugLower) ||
            containsExactSlug(href, slugLower) ||
            dataSlug === slugLower;
          if (matchesSlug) {
            const tile = pickClickableContainer(node);
            if (tile) return tile;
          }
        }
      }
    }

    if (playerSlug || normName) {
      for (const root of searchRoots) {
        const mediaOrLinks = root.querySelectorAll(
          "img[src], img[alt], a[href], [data-card-slug], [aria-label]",
        );
        for (const node of Array.from(mediaOrLinks)) {
          if (!isElementVisible(node)) continue;
          const src = (node.getAttribute("src") ?? "").toLowerCase();
          const href = (node.getAttribute("href") ?? "").toLowerCase();
          const dataSlug = (node.getAttribute("data-card-slug") ?? "").toLowerCase();
          const altNorm = normalizeNameForMatch(node.getAttribute("alt") ?? "");
          const ariaNorm = normalizeNameForMatch(node.getAttribute("aria-label") ?? "");
          const matchesPlayerSlug = Boolean(
            playerSlug &&
              (src.includes(playerSlug) || href.includes(playerSlug) || dataSlug.startsWith(playerSlug)),
          );
          const matchesAltOrAria = Boolean(
            normName && (altNorm.includes(normName) || ariaNorm.includes(normName)),
          );
          if (matchesPlayerSlug || matchesAltOrAria) {
            const tile = pickClickableContainer(node);
            if (tile) return tile;
          }
        }
      }
    }

    if (normName) {
      const compactName = normName.replace(/\s+/g, "");
      for (const root of searchRoots) {
        const clickables = root.querySelectorAll(
          'button, a, [role="button"], article, [data-testid*="card" i]',
        );
        for (const node of Array.from(clickables)) {
          if (!isElementVisible(node)) continue;
          const nodeNorm = normalizeNameForMatch(node.textContent ?? "");
          const nodeCompact = nodeNorm.replace(/\s+/g, "");
          const hasImgMatch = Array.from(
            node.querySelectorAll("img[alt], [aria-label]"),
          ).some((child) => {
            const cAlt = normalizeNameForMatch(child.getAttribute("alt") ?? "");
            const cAria = normalizeNameForMatch(child.getAttribute("aria-label") ?? "");
            return cAlt.includes(normName) || cAria.includes(normName);
          });
          if (
            nodeNorm.includes(normName) ||
            (compactName.length >= 5 && nodeCompact.includes(compactName)) ||
            hasImgMatch
          ) {
            const rect = node.getBoundingClientRect();
            if (rect.height >= 40 && rect.height <= 420) return node;
          }
        }
      }
    }
    return null;
  }

  function highlightTile(tile: HTMLElement): void {
    clearActiveTileHighlight();
    tile.scrollIntoView({ behavior: "smooth", block: "center" });
    tile.style.outline = "3px solid #10b981";
    tile.style.outlineOffset = "2px";
    activeHighlightedTile = tile;
    activeHighlightTimer = window.setTimeout(() => {
      clearActiveTileHighlight();
    }, 6000);
  }

  function showLineupChecklist(
    playerNames: string[],
    formatLabel: string,
    projectedTotal: number,
    incomingSlots?: LineupHighlightSlot[],
    autoHighlightFirst = false,
  ): void {
    clearActiveTileHighlight();
    const existing = document.getElementById("jamassist-lineup-hud");
    if (existing) existing.remove();
    const resolvedSlots: LineupHighlightSlot[] =
      incomingSlots && incomingSlots.length > 0
        ? incomingSlots
        : playerNames.map((name, idx) => ({
            slotLabel: `S${idx + 1}`,
            cardSlug: "",
            playerName: name,
            rarity: "",
            seasonYear: 0,
            isCaptain: false,
          }));
    if (!document.body || resolvedSlots.length === 0) return;

    const host = document.createElement("div");
    host.id = "jamassist-lineup-hud";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .hud {
        position: fixed;
        right: 18px;
        bottom: 66px;
        width: 280px;
        z-index: 2147483647;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.12);
        background: linear-gradient(180deg, #1b1e24, #121418);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 40px rgba(0,0,0,0.72);
        padding: 11px 12px;
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif;
      }
      .hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .title { font-size: 11.5px; font-weight: 700; color: #fbbf24; }
      .meta { font-size: 10px; color: #a1a1aa; }
      .close {
        background: transparent; border: none; color: #a1a1aa;
        cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px;
      }
      .close:hover { color: #ffffff; }
      .list { display: flex; flex-direction: column; gap: 5px; }
      .row {
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
        font-size: 11px; padding: 5px 7px; border-radius: 9px;
        background: #1d2027; border: 1px solid rgba(255,255,255,0.06);
      }
      .row.active { border-color: rgba(16,185,129,0.55); background: #1c2824; }
      .row.done { opacity: 0.55; }
      .row-left { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; cursor: pointer; }
      .row-left input { accent-color: #10b981; cursor: pointer; flex-shrink: 0; }
      .slot-tag {
        font-size: 9px; font-weight: 700; color: #cbd5e1;
        background: rgba(255,255,255,0.08); border-radius: 5px; padding: 1px 4px; flex-shrink: 0;
      }
      .cap-tag { color: #fbbf24; font-weight: 800; font-size: 9px; flex-shrink: 0; }
      .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .row.done .name { text-decoration: line-through; color: #71717a; }
      .find-btn {
        background: rgba(56,189,248,0.16); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.3);
        border-radius: 6px; font-size: 9.5px; font-weight: 600; padding: 2px 6px; cursor: pointer; flex-shrink: 0;
      }
      .find-btn:hover { background: rgba(56,189,248,0.28); }
      .footer {
        margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
      }
      .status { font-size: 9.5px; color: #a1a1aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      .fill-btn {
        background: linear-gradient(180deg, #34d399, #10b981); color: #052e16;
        border: none; border-radius: 8px; font-size: 10.5px; font-weight: 700;
        padding: 5px 9px; cursor: pointer; flex-shrink: 0;
      }
      .fill-btn:hover { filter: brightness(1.08); }
      .fill-btn:disabled { opacity: 0.45; cursor: default; filter: none; }
    `;

    const hud = document.createElement("div");
    hud.className = "hud";

    const hdr = document.createElement("div");
    hdr.className = "hdr";
    const left = document.createElement("div");
    const t = document.createElement("div");
    t.className = "title";
    t.textContent = `Lineup Helper • ${formatLabel}`;
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = `Proj: ${projectedTotal.toFixed(1)} pts • Assisted Stepper`;
    left.append(t, m);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      clearActiveTileHighlight();
      host.remove();
    });
    hdr.append(left, closeBtn);

    const list = document.createElement("div");
    list.className = "list";
    const statusEl = document.createElement("div");
    statusEl.className = "status";
    statusEl.textContent = "Open a Sorare slot drawer, then Find or Fill Next.";

    const fillNextBtn = document.createElement("button");
    fillNextBtn.type = "button";
    fillNextBtn.className = "fill-btn";
    fillNextBtn.textContent = "Fill Next";

    const checkboxes: HTMLInputElement[] = [];
    const rows: HTMLDivElement[] = [];

    function syncActiveRow(): void {
      const nextIdx = checkboxes.findIndex((cb) => !cb.checked);
      rows.forEach((r, i) => r.classList.toggle("active", i === nextIdx));
      if (nextIdx === -1) {
        fillNextBtn.disabled = true;
        fillNextBtn.textContent = "All Picked";
        statusEl.textContent = "All slots checked. Review & Confirm on Sorare.";
      } else {
        fillNextBtn.disabled = false;
        const target = resolvedSlots[nextIdx];
        fillNextBtn.textContent = `Fill Next (${target.slotLabel})`;
      }
    }

    function locateSlot(slot: LineupHighlightSlot, andClick: boolean, onSuccess?: () => void): void {
      const immediateTile = findCardTile(slot);
      if (immediateTile) {
        highlightTile(immediateTile);
        if (andClick) {
          immediateTile.click();
          onSuccess?.();
          statusEl.textContent = `Selected ${slot.playerName} - advance to next slot.`;
        } else {
          statusEl.textContent = `Highlighted ${slot.playerName}.`;
        }
        return;
      }

      const searchInput = findDrawerSearchInput();
      if (searchInput) {
        setReactInputValue(searchInput, slot.playerName);
        statusEl.textContent = `Searching "${slot.playerName}"...`;
        window.setTimeout(() => {
          const delayedTile = findCardTile(slot);
          if (delayedTile) {
            highlightTile(delayedTile);
            if (andClick) {
              delayedTile.click();
              onSuccess?.();
              statusEl.textContent = `Selected ${slot.playerName} - open next slot drawer.`;
            } else {
              statusEl.textContent = `Highlighted ${slot.playerName}.`;
            }
          } else {
            statusEl.textContent = `Open slot drawer for ${slot.playerName} first.`;
          }
        }, 350);
      } else {
        statusEl.textContent = `Open a Sorare slot drawer to find ${slot.playerName}.`;
      }
    }

    resolvedSlots.forEach((slot) => {
      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("label");
      label.className = "row-left";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", () => {
        row.classList.toggle("done", cb.checked);
        syncActiveRow();
      });

      const slotTag = document.createElement("span");
      slotTag.className = "slot-tag";
      slotTag.textContent = slot.slotLabel;

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = slot.playerName;

      label.append(cb, slotTag);
      if (slot.isCaptain) {
        const cap = document.createElement("span");
        cap.className = "cap-tag";
        cap.textContent = "MVP";
        label.append(cap);
      }
      label.append(nameSpan);

      const findBtn = document.createElement("button");
      findBtn.type = "button";
      findBtn.className = "find-btn";
      findBtn.textContent = "Find";
      findBtn.addEventListener("click", () => {
        locateSlot(slot, false);
      });

      row.append(label, findBtn);
      list.append(row);
      checkboxes.push(cb);
      rows.push(row);
    });

    fillNextBtn.addEventListener("click", () => {
      const nextIdx = checkboxes.findIndex((cb) => !cb.checked);
      if (nextIdx === -1) return;
      const slot = resolvedSlots[nextIdx];
      const cb = checkboxes[nextIdx];
      const row = rows[nextIdx];
      locateSlot(slot, true, () => {
        cb.checked = true;
        row.classList.add("done");
        syncActiveRow();
      });
    });

    syncActiveRow();

    const footer = document.createElement("div");
    footer.className = "footer";
    footer.append(statusEl, fillNextBtn);

    hud.append(hdr, list, footer);
    shadow.append(style, hud);
    document.body.appendChild(host);

    if (autoHighlightFirst && resolvedSlots[0]) {
      const firstSlot = resolvedSlots[0];
      const immediateTile = findCardTile(firstSlot);
      if (immediateTile) {
        highlightTile(immediateTile);
        statusEl.textContent = `Highlighted ${firstSlot.playerName}.`;
      } else {
        locateSlot(firstSlot, false);
        window.setTimeout(() => {
          if (!activeHighlightedTile) {
            const retryTile = findCardTile(firstSlot);
            if (retryTile) {
              highlightTile(retryTile);
              statusEl.textContent = `Highlighted ${firstSlot.playerName}.`;
            }
          }
        }, 350);
      }
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg: {
      type?: string;
      playerNames?: string[];
      formatLabel?: string;
      projectedTotal?: number;
      slots?: unknown[];
      autoHighlightFirst?: boolean;
    }) => {
      if (
        msg.type === "SHOW_LINEUP_CHECKLIST" &&
        Array.isArray(msg.playerNames)
      ) {
        const safeNames = msg.playerNames.filter(
          (n): n is string => typeof n === "string" && n.trim().length > 0,
        );
        const safeSlots: LineupHighlightSlot[] = Array.isArray(msg.slots)
          ? msg.slots.filter((item): item is LineupHighlightSlot => {
              if (!item || typeof item !== "object") return false;
              const rec = item as Record<string, unknown>;
              return (
                typeof rec.playerName === "string" &&
                typeof rec.slotLabel === "string" &&
                typeof rec.cardSlug === "string"
              );
            })
          : [];
        const safeTotal =
          typeof msg.projectedTotal === "number" &&
          Number.isFinite(msg.projectedTotal)
            ? msg.projectedTotal
            : 0;
        showLineupChecklist(
          safeNames,
          typeof msg.formatLabel === "string" ? msg.formatLabel : "Lineup",
          safeTotal,
          safeSlots,
          Boolean(msg.autoHighlightFirst),
        );
      }
    });
  } catch {
    // Ignore if context invalid
  }
})();

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
  isNbaSorareUrl,
  isPartialLineupPage,
  normalizeNameForMatch,
  parseWalletButtonText,
  type DomDetectedLineup,
} from "./sorareDomParser";
import {
  buildDailyChecklistItems,
  DAILY_MANUAL_STORAGE_KEY,
  toggleManualCompletion,
  type DailyManualCompletionState,
} from "../calculators/dailyChecklistMath";
import type { PickerMissionsByMode, SetShopStatus } from "../shared/types";

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
  let publicGalleryTagsUser = "";
  let publicGalleryTagsMap: Record<string, string> = {};
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
      const numMatch = (btn.textContent || "").replace(/[\s,\u00a0]+/g, "").match(/^(\d{1,5})$/);
      // Sorare reuses the gradient id `essence-gradient-purple` on BOTH counters (checked live
      // 2026-11-21): the colors tell them apart. Limited Essence is filled with --c-green-400,
      // Set Essence with purple #8567C9. The URL is only a fallback when no color is readable.
      const fills = Array.from(btn.querySelectorAll("stop, path")).map((n) =>
        (n.getAttribute("stop-color") || n.getAttribute("fill") || "").toLowerCase(),
      );
      const green = fills.some((f) => f.includes("green"));
      const purple = fills.some((f) => f === "#8567c9" || f.includes("purple") || f.includes("violet"));
      if (numMatch) {
        const val = Number(numMatch[1]);
        if (Number.isFinite(val) && val >= 0 && val <= 50000) {
          const key = green ? "limited" : purple ? "common" : setMode ? "common" : "limited";
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
      const rawText = (el.textContent || "").replace(/[\s,\u00a0]+/g, "");
      if (rawText.length > 24 || rawText.includes("/")) continue;
      const m = rawText.match(/^(\d{1,5})$/);
      if (!m) continue;
      const num = Number(m[1]);
      if (!Number.isFinite(num) || num < 0 || num > 50000) continue;

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
      const text = (btn.textContent || "").replace(/[\u00a0\u202f]/g, " ").trim();
      if (!text) continue;

      if (btn.querySelector('linearGradient[id*="boost" i]')) {
        const clueMatch = text.replace(/[\s,]+/g, "").match(/^(\d{1,4})$/);
        if (clueMatch) {
          cluesCount = Number(clueMatch[1]);
        }
      }

      const parsed = parseWalletButtonText(text);
      if (parsed?.cashAmount !== undefined && parsed.cashSymbol) {
        cashSymbol = parsed.cashSymbol;
        cashAmount = parsed.cashAmount;
        continue;
      }
      if (parsed?.ethAmount !== undefined) {
        ethAmount = parsed.ethAmount;
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
    trackDailyTasks: boolean;
  } = {
    autoOpenOnCraft: true,
    autoOpenOnSorare: false,
    autoShowInPageWizards: true,
    trackDailyTasks: true,
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

  let storedPickerMissions: PickerMissionsByMode = {};
  let storedShopStatus: SetShopStatus | null = null;
  let storedManualDailyState: DailyManualCompletionState | null = null;
  let dailyPanelFilter: "all" | "set" | "pro" = "all";
  let dailyPanelOpen = false;
  let dailyPillBtnEl: HTMLButtonElement | null = null;
  let dailyPopoverEl: HTMLDivElement | null = null;

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
    // Only read non-secret auto-open flags, public slug lookup & cached daily missions/shop status; API keys stay isolated
    chrome.storage.local.get(
      [
        "jamassist_content_flags_v1",
        "jamassist_overlay_lookup_v1",
        "picker_missions_v1",
        "set_shop_status_v1",
        DAILY_MANUAL_STORAGE_KEY,
      ],
      (raw) => {
        const f = raw?.jamassist_content_flags_v1 as
          | {
              autoOpenOnCraft?: boolean;
              autoOpenOnSorare?: boolean;
              autoShowInPageWizards?: boolean;
              trackDailyTasks?: boolean;
            }
          | undefined;
        if (f) {
          autoOpenFlags = {
            autoOpenOnCraft: f.autoOpenOnCraft ?? true,
            autoOpenOnSorare: f.autoOpenOnSorare ?? false,
            autoShowInPageWizards: f.autoShowInPageWizards ?? true,
            trackDailyTasks: f.trackDailyTasks ?? true,
          };
        }
        applyRawOverlayLookup(raw?.jamassist_overlay_lookup_v1);
        if (raw?.picker_missions_v1 && typeof raw.picker_missions_v1 === "object") {
          storedPickerMissions = raw.picker_missions_v1 as PickerMissionsByMode;
        }
        if (raw?.set_shop_status_v1 && typeof raw.set_shop_status_v1 === "object") {
          storedShopStatus = raw.set_shop_status_v1 as SetShopStatus;
        }
        if (raw?.[DAILY_MANUAL_STORAGE_KEY] && typeof raw[DAILY_MANUAL_STORAGE_KEY] === "object") {
          storedManualDailyState = raw[DAILY_MANUAL_STORAGE_KEY] as DailyManualCompletionState;
        }
        renderDailyChecklistOverlay();
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
          trackDailyTasks?: boolean;
        };
        autoOpenFlags = {
          autoOpenOnCraft: f.autoOpenOnCraft ?? true,
          autoOpenOnSorare: f.autoOpenOnSorare ?? false,
          autoShowInPageWizards: f.autoShowInPageWizards ?? true,
          trackDailyTasks: f.trackDailyTasks ?? true,
        };
        renderDailyChecklistOverlay();
      }
      if (changes.picker_missions_v1?.newValue) {
        storedPickerMissions = changes.picker_missions_v1.newValue as PickerMissionsByMode;
        renderDailyChecklistOverlay();
      }
      if (changes.set_shop_status_v1?.newValue) {
        storedShopStatus = changes.set_shop_status_v1.newValue as SetShopStatus;
        renderDailyChecklistOverlay();
      }
      if (changes[DAILY_MANUAL_STORAGE_KEY]?.newValue) {
        storedManualDailyState = changes[DAILY_MANUAL_STORAGE_KEY].newValue as DailyManualCompletionState;
        renderDailyChecklistOverlay();
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
    if (autoOpenedThisRoute || !isNbaSorareUrl(window.location.href)) return;
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

  function removeBottomLauncher(): void {
    const existing = document.getElementById("jamassist-sorare-root");
    if (existing) existing.remove();
    pillEl = null;
    badgeSubEl = null;
    dailyPillBtnEl = null;
    dailyPopoverEl = null;
    dailyPanelOpen = false;
    const hud = document.getElementById("jamassist-lineup-hud");
    if (hud) {
      clearActiveTileHighlight();
      hud.remove();
    }
    const pills = document.querySelectorAll<HTMLElement>(".jamassist-card-overlay-pill");
    if (pills.length > 0) {
      pills.forEach((el) => el.remove());
      document
        .querySelectorAll<HTMLElement>("[data-jamassist-decorated]")
        .forEach((el) => delete el.dataset.jamassistDecorated);
    }
  }

  function renderDailyChecklistOverlay(): void {
    if (!dailyPillBtnEl || !dailyPopoverEl) return;
    if (
      !autoOpenFlags.trackDailyTasks ||
      !autoOpenFlags.autoShowInPageWizards ||
      !isNbaSorareUrl(window.location.href)
    ) {
      dailyPillBtnEl.classList.add("hidden");
      dailyPopoverEl.classList.add("hidden");
      dailyPanelOpen = false;
      return;
    }

    const allItems = buildDailyChecklistItems({
      shopStatus: storedShopStatus,
      pickerMissions: storedPickerMissions,
      manualState: storedManualDailyState,
    });
    const pendingItems = allItems.filter((it) => !it.done);

    // Auto-disappear once all daily tasks are completed today (zero screen clutter).
    if (pendingItems.length === 0) {
      dailyPillBtnEl.classList.add("hidden");
      dailyPopoverEl.classList.add("hidden");
      dailyPanelOpen = false;
      return;
    }

    dailyPillBtnEl.classList.remove("hidden");
    dailyPillBtnEl.textContent = `Dailies • ${pendingItems.length} left`;
    dailyPillBtnEl.title = `${pendingItems.length} Sorare NBA daily task${pendingItems.length === 1 ? "" : "s"} left before 07:00 UTC reset`;
    dailyPillBtnEl.classList.toggle("active", dailyPanelOpen);

    if (!dailyPanelOpen) {
      dailyPopoverEl.classList.add("hidden");
      return;
    }
    dailyPopoverEl.classList.remove("hidden");

    while (dailyPopoverEl.firstChild) {
      dailyPopoverEl.removeChild(dailyPopoverEl.firstChild);
    }

    const hdr = document.createElement("div");
    hdr.className = "daily-hdr";
    const hdrTitle = document.createElement("span");
    hdrTitle.className = "daily-title";
    hdrTitle.textContent = `Today's Dailies (${pendingItems.length} left)`;

    const filterRow = document.createElement("div");
    filterRow.className = "daily-filters";
    const filterModes: Array<{ id: "all" | "set" | "pro"; label: string }> = [
      { id: "all", label: "All" },
      { id: "set", label: "Set" },
      { id: "pro", label: "Pro" },
    ];
    for (const fm of filterModes) {
      const fBtn = document.createElement("button");
      fBtn.type = "button";
      fBtn.className = `daily-filter-btn${dailyPanelFilter === fm.id ? " active" : ""}`;
      fBtn.textContent = fm.label;
      fBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        dailyPanelFilter = fm.id;
        renderDailyChecklistOverlay();
      });
      filterRow.appendChild(fBtn);
    }

    const syncBtn = document.createElement("button");
    syncBtn.type = "button";
    syncBtn.className = "daily-sync-btn";
    syncBtn.textContent = "↻";
    syncBtn.title = "Re-sync daily status from open Sorare NBA tabs";
    syncBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: "SYNC_DAILIES_FROM_OPEN_TABS" });
      } catch {
        // Ignore
      }
      schedulePageDailiesSync();
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "daily-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close Dailies checklist";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dailyPanelOpen = false;
      renderDailyChecklistOverlay();
    });

    const hdrRight = document.createElement("div");
    hdrRight.className = "daily-hdr-right";
    hdrRight.append(filterRow, syncBtn, closeBtn);
    hdr.append(hdrTitle, hdrRight);
    dailyPopoverEl.appendChild(hdr);

    const visibleItems = allItems.filter(
      (it) => dailyPanelFilter === "all" || it.mode === dailyPanelFilter,
    );

    const list = document.createElement("div");
    list.className = "daily-list";
    for (const item of visibleItems) {
      const row = document.createElement("div");
      row.className = `daily-row${item.done ? " done" : ""}`;

      const left = document.createElement("div");
      left.className = "daily-row-left";

      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = `daily-check-btn${item.done ? " checked" : ""}${item.autoDone ? " auto" : ""}`;
      checkBtn.textContent = item.done ? "✓" : "";
      checkBtn.title = item.autoDone
        ? "Confirmed automatically from Sorare"
        : item.manualDone
          ? "Marked done manually (click to undo)"
          : "Mark as done (e.g. completed on mobile)";
      checkBtn.setAttribute("aria-label", `${item.done ? "Completed" : "Mark done"}: ${item.title}`);
      checkBtn.disabled = item.autoDone;
      if (!item.autoDone) {
        checkBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const next = toggleManualCompletion(storedManualDailyState, item.id, !item.manualDone);
          storedManualDailyState = next;
          try {
            void chrome.storage.local.set({ [DAILY_MANUAL_STORAGE_KEY]: next });
          } catch {
            // Ignore
          }
          renderDailyChecklistOverlay();
        });
      }

      const badge = document.createElement("span");
      badge.className = `daily-mode-badge ${item.mode}`;
      badge.textContent = item.modeBadge;

      const textCol = document.createElement("div");
      textCol.className = "daily-row-text";
      const t = document.createElement("div");
      t.className = "daily-row-title";
      t.textContent = item.title;
      const s = document.createElement("div");
      s.className = "daily-row-sub";
      s.textContent = item.sub;
      textCol.append(t, s);

      left.append(checkBtn, badge, textCol);

      const actions = document.createElement("div");
      actions.className = "daily-row-actions";

      if (item.done) {
        const donePill = document.createElement("span");
        donePill.className = "daily-done-pill";
        donePill.textContent = item.autoDone ? "✓ Done" : "✓ Manual";
        actions.appendChild(donePill);
      } else {
        const picksBtn = document.createElement("button");
        picksBtn.type = "button";
        picksBtn.className = "daily-act-btn picks";
        picksBtn.textContent = item.panelBtnLabel;
        picksBtn.title = item.panelBtnTitle;
        picksBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          try {
            chrome.runtime.sendMessage({
              type: "OPEN_SIDE_PANEL",
              targetTab: item.tab,
              targetMode: item.mode,
              targetSubTab: item.subTab,
            });
          } catch {
            // Ignore
          }
        });

        const goBtn = document.createElement("button");
        goBtn.type = "button";
        goBtn.className = "daily-act-btn go";
        goBtn.textContent = "Go ↗";
        goBtn.title = `Open ${item.title} on Sorare`;
        goBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          window.location.assign(item.url);
        });

        actions.append(picksBtn, goBtn);
      }

      row.append(left, actions);
      list.appendChild(row);
    }

    const note = document.createElement("div");
    note.className = "daily-note";
    note.textContent = "0 extra API calls • Auto-syncs on Play/Missions, or check off if done on mobile.";
    dailyPopoverEl.append(list, note);
  }

  function syncBottomLauncherVisibility(refreshText = false): void {
    if (!isNbaSorareUrl(window.location.href)) {
      removeBottomLauncher();
      return;
    }
    if (!document.getElementById("jamassist-sorare-root")) {
      injectBottomLauncher();
    } else if (refreshText) {
      updateOverlayUI();
    }
  }

  function injectBottomLauncher(): void {
    if (
      !document.body ||
      !isNbaSorareUrl(window.location.href) ||
      document.getElementById("jamassist-sorare-root")
    ) {
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
      button,
      input {
        font-family: inherit;
      }
      .wrap {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.13);
        background: linear-gradient(180deg, rgba(26, 29, 35, 0.84) 0%, rgba(17, 19, 23, 0.89) 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 14px 32px -8px rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(16px) saturate(150%);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, ui-sans-serif, system-ui, sans-serif;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 4px 11px 4px 5px;
        border-radius: 13px;
        border: 1px solid rgba(255, 255, 255, 0.10);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.02) 100%);
        color: #f8fafc;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
        cursor: pointer;
        transition:
          border-color 160ms ease-out,
          background 160ms ease-out,
          box-shadow 160ms ease-out,
          scale 160ms ease-out,
          translate 160ms ease-out;
      }
      .pill:hover {
        border-color: rgba(56, 189, 248, 0.58);
        background: linear-gradient(180deg, rgba(56, 189, 248, 0.16) 0%, rgba(56, 189, 248, 0.06) 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.18),
          0 6px 18px -6px rgba(56, 189, 248, 0.42);
      }
      .pill.craft-glow {
        border-color: rgba(52, 211, 153, 0.68);
        background: linear-gradient(180deg, rgba(52, 211, 153, 0.16) 0%, rgba(16, 185, 129, 0.06) 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.22),
          0 0 0 2px rgba(52, 211, 153, 0.18),
          0 8px 20px -6px rgba(16, 185, 129, 0.45);
      }
      .pill.minimized {
        padding: 3px;
      }
      .logo-badge {
        width: 26px;
        height: 26px;
        padding: 0;
        box-sizing: border-box;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
        background: transparent;
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.5));
        transition: scale 180ms ease-out;
      }
      .logo-img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }
      .logo-fallback {
        color: #b91c1c;
        font-size: 10.5px;
        font-weight: 900;
      }
      .text {
        display: flex;
        flex-direction: column;
        line-height: 1.18;
        text-align: left;
      }
      .title {
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: -0.01em;
        color: #f8fafc;
      }
      .sub {
        font-size: 10px;
        color: #7dd3fc;
        font-weight: 500;
      }
      .pill.craft-glow .sub {
        color: #6ee7b7;
      }
      .min-btn {
        width: 28px;
        height: 28px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.10);
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09);
        color: #cbd5e1;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
          color 150ms ease-out,
          border-color 150ms ease-out,
          background-color 150ms ease-out,
          box-shadow 150ms ease-out,
          scale 150ms ease-out,
          translate 150ms ease-out;
      }
      .min-btn:hover {
        color: #f8fafc;
        border-color: rgba(56, 189, 248, 0.52);
        background: rgba(56, 189, 248, 0.14);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.14),
          0 4px 12px -4px rgba(0, 0, 0, 0.5);
      }
      .daily-pill {
        height: 28px;
        padding: 0 9px;
        border-radius: 10px;
        border: 1px solid rgba(251, 191, 36, 0.38);
        background: linear-gradient(180deg, rgba(251, 191, 36, 0.18) 0%, rgba(245, 158, 11, 0.08) 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
        color: #fde68a;
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: -0.01em;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        cursor: pointer;
        transition:
          color 150ms ease-out,
          border-color 150ms ease-out,
          background 150ms ease-out,
          box-shadow 150ms ease-out,
          scale 150ms ease-out,
          translate 150ms ease-out;
      }
      .daily-pill:hover,
      .daily-pill.active {
        color: #fef3c7;
        border-color: rgba(251, 191, 36, 0.72);
        background: linear-gradient(180deg, rgba(251, 191, 36, 0.28) 0%, rgba(245, 158, 11, 0.14) 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.20),
          0 4px 14px -4px rgba(251, 191, 36, 0.35);
      }
      .daily-popover {
        position: fixed;
        right: 18px;
        bottom: 66px;
        width: 296px;
        z-index: 2147483647;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: linear-gradient(180deg, rgba(26, 29, 35, 0.92) 0%, rgba(15, 17, 21, 0.96) 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 20px 44px -10px rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(16px) saturate(150%);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        padding: 11px 12px;
        color: #f1f5f9;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, ui-sans-serif, system-ui, sans-serif;
      }
      .daily-hdr {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 8px;
      }
      .daily-title {
        font-size: 11.5px;
        font-weight: 700;
        color: #fbbf24;
      }
      .daily-hdr-right {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .daily-filters {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border-radius: 8px;
        background: rgba(11, 16, 27, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .daily-filter-btn {
        background: transparent;
        border: none;
        border-radius: 6px;
        padding: 2px 6px;
        font-size: 9.5px;
        font-weight: 600;
        color: #94a3b8;
        cursor: pointer;
      }
      .daily-filter-btn:hover {
        color: #e2e8f0;
      }
      .daily-filter-btn.active {
        background: rgba(56, 189, 248, 0.20);
        color: #e0f2fe;
      }
      .daily-sync-btn {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        color: #94a3b8;
        font-size: 11px;
        line-height: 1;
        padding: 3px 5px;
        cursor: pointer;
      }
      .daily-sync-btn:hover {
        color: #e0f2fe;
        border-color: rgba(56, 189, 248, 0.45);
      }
      .daily-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 14px;
        line-height: 1;
        padding: 2px 4px;
        cursor: pointer;
      }
      .daily-close:hover {
        color: #ffffff;
      }
      .daily-check-btn {
        width: 16px;
        height: 16px;
        border-radius: 5px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        background: rgba(15, 23, 42, 0.7);
        color: #34d399;
        font-size: 10px;
        font-weight: 800;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        flex-shrink: 0;
        cursor: pointer;
      }
      .daily-check-btn:hover:not(:disabled) {
        border-color: rgba(52, 211, 153, 0.75);
      }
      .daily-check-btn.checked {
        background: rgba(52, 211, 153, 0.22);
        border-color: rgba(52, 211, 153, 0.65);
      }
      .daily-check-btn.auto {
        cursor: default;
      }
      .daily-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .daily-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 10px;
        background: rgba(17, 23, 38, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.07);
      }
      .daily-row.done {
        opacity: 0.56;
      }
      .daily-row-left {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        flex: 1;
      }
      .daily-mode-badge {
        font-size: 8.5px;
        font-weight: 800;
        padding: 2px 5px;
        border-radius: 5px;
        letter-spacing: 0.03em;
        flex-shrink: 0;
      }
      .daily-mode-badge.set {
        background: rgba(217, 217, 217, 0.16);
        color: #ececec;
        border: 1px solid rgba(217, 217, 217, 0.35);
      }
      .daily-mode-badge.pro {
        background: rgba(251, 191, 36, 0.16);
        color: #fde68a;
        border: 1px solid rgba(251, 191, 36, 0.38);
      }
      .daily-row-text {
        min-width: 0;
        flex: 1;
      }
      .daily-row-title {
        font-size: 10.5px;
        font-weight: 600;
        color: #f8fafc;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .daily-row-sub {
        font-size: 9.5px;
        color: #94a3b8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .daily-row-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      .daily-act-btn {
        border-radius: 7px;
        padding: 3px 6px;
        font-size: 9.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .daily-act-btn.picks {
        background: rgba(52, 211, 153, 0.16);
        border: 1px solid rgba(52, 211, 153, 0.38);
        color: #a7f3d0;
      }
      .daily-act-btn.picks:hover {
        background: rgba(52, 211, 153, 0.26);
      }
      .daily-act-btn.go {
        background: rgba(56, 189, 248, 0.16);
        border: 1px solid rgba(56, 189, 248, 0.38);
        color: #bae6fd;
      }
      .daily-act-btn.go:hover {
        background: rgba(56, 189, 248, 0.26);
      }
      .daily-done-pill {
        font-size: 9.5px;
        font-weight: 700;
        color: #34d399;
      }
      .daily-note {
        margin-top: 7px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
        font-size: 9px;
        color: #94a3b8;
      }
      .pill:focus-visible,
      .daily-pill:focus-visible,
      .min-btn:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 2px;
      }
      .hidden {
        display: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        .wrap {
          --jam-spring: linear(0, 0.25 14%, 0.72 32%, 1.04 54%, 0.99 78%, 1);
          animation: jam-dock-in 240ms var(--jam-spring) both;
        }
        .pill,
        .min-btn {
          transition-timing-function: var(--jam-spring);
        }
        .pill:hover {
          translate: 0 -1px;
        }
        .pill:hover .logo-badge {
          scale: 1.06;
        }
        .pill:active {
          scale: 0.97;
        }
        .min-btn:hover {
          translate: 0 -1px;
        }
        .min-btn:active {
          scale: 0.93;
        }
      }
      @keyframes jam-dock-in {
        from {
          opacity: 0;
          translate: 0 8px;
          scale: 0.96;
        }
        to {
          opacity: 1;
          translate: 0 0;
          scale: 1;
        }
      }
      @media (prefers-reduced-transparency: reduce) {
        .wrap {
          background: #14161a;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
        .pill,
        .min-btn {
          background: #1a1d23;
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
      if (minimized) {
        dailyPanelOpen = false;
      }
      renderDailyChecklistOverlay();
      if (minimized && dailyPillBtnEl) {
        dailyPillBtnEl.classList.add("hidden");
      }
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

    const dailyBtn = document.createElement("button");
    dailyBtn.type = "button";
    dailyBtn.className = "daily-pill hidden";
    dailyPillBtnEl = dailyBtn;
    dailyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Auto-select context tab on first open based on current Sorare URL
      if (!dailyPanelOpen) {
        dailyPanelFilter = isSetModePage()
          ? "set"
          : /\/nba\/(play|lineups|pro)/i.test(window.location.pathname)
            ? "pro"
            : "all";
        if (autoOpenFlags.trackDailyTasks) {
          try {
            chrome.runtime.sendMessage({ type: "SYNC_DAILIES_FROM_OPEN_TABS" });
          } catch {
            // Ignore
          }
          schedulePageDailiesSync();
        }
      }
      dailyPanelOpen = !dailyPanelOpen;
      renderDailyChecklistOverlay();
    });

    const dailyPop = document.createElement("div");
    dailyPop.className = "daily-popover hidden";
    dailyPop.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    dailyPopoverEl = dailyPop;

    wrap.append(pill, dailyBtn, dashBtn, minBtn);
    shadow.append(style, dailyPop, wrap);
    document.body.appendChild(host);
    updateOverlayUI();
    renderDailyChecklistOverlay();
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
  syncBottomLauncherVisibility();
  if (isNbaSorareUrl(window.location.href)) {
    checkPendingLineupHud();
    void decorateSorareCardTiles();
  }

  let dailiesSyncTimerA: number | null = null;
  let dailiesSyncTimerB: number | null = null;
  let dailiesSyncTimerC: number | null = null;
  function schedulePageDailiesSync(): void {
    if (!autoOpenFlags.trackDailyTasks) return;
    const href = window.location.href;
    if (!/\/nba\/(play|series)(\/|$|\?)/i.test(href)) return;
    const sendSync = () => {
      if (!isContextValid() || !autoOpenFlags.trackDailyTasks) return;
      try {
        chrome.runtime.sendMessage({
          type: "SORARE_PAGE_CONTEXT",
          url: window.location.href,
          isCraftPage: isCraftRoute(),
          username: detectUsername(),
          syncDailies: true,
        });
      } catch {
        // Ignore
      }
    };
    if (dailiesSyncTimerA !== null) window.clearTimeout(dailiesSyncTimerA);
    if (dailiesSyncTimerB !== null) window.clearTimeout(dailiesSyncTimerB);
    if (dailiesSyncTimerC !== null) window.clearTimeout(dailiesSyncTimerC);
    dailiesSyncTimerA = window.setTimeout(sendSync, 900);
    dailiesSyncTimerB = window.setTimeout(sendSync, 2500);
    dailiesSyncTimerC = window.setTimeout(sendSync, 5000);
  }
  schedulePageDailiesSync();

  // Trigger optional auto-open on user click when on craft / configured pages, light-dismiss popover, and re-sync dailies after in-page claims/submissions
  document.addEventListener(
    "click",
    (ev) => {
      tryAutoOpenOnGesture();
      schedulePageDailiesSync();
      if (dailyPanelOpen) {
        const root = document.getElementById("jamassist-sorare-root");
        const target = (ev as { target?: unknown } | undefined)?.target;
        if (root && target !== root) {
          dailyPanelOpen = false;
          renderDailyChecklistOverlay();
        }
      }
    },
    { capture: true, passive: true },
  );

  window.addEventListener("keydown", (ev) => {
    const key = (ev as { key?: string } | undefined)?.key;
    if (key === "Escape" && dailyPanelOpen) {
      dailyPanelOpen = false;
      renderDailyChecklistOverlay();
    }
  });

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

  function extractCardSlugFromHref(href: string): string | null {
    const m = href.match(/\/nba\/cards\/([a-z0-9_-]+)/i);
    return m?.[1]?.toLowerCase() ?? null;
  }

  function extractVisitedClubUsername(href: string): string | null {
    try {
      const u = new URL(href);
      const m = u.pathname.match(
        /^(?:\/[a-z]{2}(?:-[a-z]{2,4})?)?\/(?:nba\/(?:my-club|club)|u)\/([a-z0-9_-]{2,40})(?:\/|$)/i,
      );
      const slug = m?.[1]?.toLowerCase() ?? null;
      return slug && isValidUserSlug(slug) ? slug : null;
    } catch {
      return null;
    }
  }

  async function ensurePublicGalleryTagsForRoute(): Promise<void> {
    const visitedUser = extractVisitedClubUsername(window.location.href);
    if (!visitedUser) {
      publicGalleryTagsUser = "";
      publicGalleryTagsMap = {};
      return;
    }
    if (visitedUser === publicGalleryTagsUser) return;
    publicGalleryTagsUser = visitedUser;
    publicGalleryTagsMap = {};
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: "CLOUD_FETCH_PUBLIC_TAGS",
        username: visitedUser,
      })) as { ok?: boolean; data?: { tags?: Record<string, string> } } | undefined;
      if (resp?.ok && resp.data?.tags && publicGalleryTagsUser === visitedUser) {
        publicGalleryTagsMap = resp.data.tags;
      } else if (publicGalleryTagsUser === visitedUser) {
        publicGalleryTagsUser = "";
      }
    } catch {
      if (publicGalleryTagsUser === visitedUser) {
        publicGalleryTagsUser = "";
      }
    }
  }

  async function decorateSorareCardTiles(): Promise<void> {
    if (decoratingBusy || !autoOpenFlags.autoShowInPageWizards || !isNbaSorareUrl(window.location.href)) return;
    decoratingBusy = true;
    try {
      await ensurePublicGalleryTagsForRoute();
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
              const cardSlug = extractCardSlugFromHref(link.getAttribute("href") ?? "");
              const publicTag = cardSlug ? publicGalleryTagsMap[cardSlug] : undefined;
              if (publicTag) {
                tags.push(`TAG: ${publicTag.toUpperCase()}`);
              }
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

              const compactTile = rect.width < 115;
              const pill = document.createElement("div");
              pill.className = "jamassist-card-overlay-pill";
              pill.textContent = compactTile ? tags[0] : tags.slice(0, 2).join(" • ");
              pill.style.position = "absolute";
              pill.style.top = compactTile ? "5px" : "7px";
              pill.style.left = compactTile ? "5px" : "7px";
              pill.style.maxWidth = "calc(100% - 14px)";
              pill.style.overflow = "hidden";
              pill.style.textOverflow = "ellipsis";
              pill.style.whiteSpace = "nowrap";
              pill.style.zIndex = "20";
              pill.style.pointerEvents = "none";
              pill.style.padding = compactTile ? "1.5px 5.5px" : "2.5px 7.5px";
              pill.style.borderRadius = "999px";
              pill.style.fontSize = compactTile ? "9px" : "10px";
              pill.style.fontWeight = "700";
              pill.style.letterSpacing = "0.01em";
              pill.style.fontFamily =
                '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, ui-sans-serif, system-ui, sans-serif';
              pill.style.background =
                "linear-gradient(180deg, rgba(20, 24, 34, 0.90) 0%, rgba(10, 12, 18, 0.95) 100%)";
              pill.style.backdropFilter = "blur(8px) saturate(140%)";
              const isDraft = tags[0].includes("Draft");
              const isFirst = tags[0].includes("1ST");
              const isHot = tags[0].includes("🔥");
              pill.style.color = isDraft
                ? "#fde68a"
                : isFirst
                  ? "#6ee7b7"
                  : isHot
                    ? "#7dd3fc"
                    : "#e2e8f0";
              pill.style.border = isDraft
                ? "1px solid rgba(251, 191, 36, 0.55)"
                : isFirst
                  ? "1px solid rgba(52, 211, 153, 0.52)"
                  : isHot
                    ? "1px solid rgba(56, 189, 248, 0.48)"
                    : "1px solid rgba(255, 255, 255, 0.22)";
              pill.style.boxShadow =
                "inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 4px 12px rgba(0, 0, 0, 0.55)";
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
      if (isNbaSorareUrl(window.location.href)) {
        checkPendingLineupHud();
      }
    }
    syncBottomLauncherVisibility(true);
    reportContext();
    schedulePageDailiesSync();
    renderDailyChecklistOverlay();
    if (isNbaSorareUrl(window.location.href)) {
      void decorateSorareCardTiles();
    }
  };

  window.addEventListener("popstate", handleSpaNavigation);
  window.addEventListener("hashchange", handleSpaNavigation);
  const navApi = (
    window as Window & {
      navigation?: { addEventListener?: (type: string, listener: () => void) => void };
    }
  ).navigation;
  navApi?.addEventListener?.("currententrychange", handleSpaNavigation);

  const observer = new MutationObserver(() => {
    syncBottomLauncherVisibility(false);
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
    pictureUrl?: string | null;
    starCost?: number | null;
    projectedPts?: number | null;
    teamSlug?: string | null;
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

  function getVisibleDrawerRoots(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [class*="drawer" i], [class*="modal" i]',
      ),
    ).filter(isElementVisible);
  }

  function isDrawerLoadingCards(): boolean {
    const drawerRoots = getVisibleDrawerRoots();
    if (drawerRoots.length === 0) return false;
    for (const root of drawerRoots) {
      const hasBusy = Array.from(
        root.querySelectorAll(
          '[aria-busy="true"], [role="progressbar"], [class*="skeleton" i], [class*="spinner" i], [class*="loading" i]',
        ),
      ).some(isElementVisible);
      if (hasBusy) return true;
    }
    const searchInput = findDrawerSearchInput();
    const hasFilterText = Boolean(searchInput && searchInput.value.trim().length > 0);
    if (!hasFilterText) {
      const hasAnyVisibleCard = drawerRoots.some((root) =>
        Array.from(
          root.querySelectorAll(
            'img[src*="assets.sorare.com"], [data-card-slug], a[href*="/nba/cards/"]',
          ),
        ).some(isElementVisible),
      );
      if (!hasAnyVisibleCard) return true;
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

    const drawerRoots = getVisibleDrawerRoots();
    // When a Sorare slot drawer/dialog is open, restrict search strictly to the open drawer
    // so we never click a background card on document.body while the drawer is loading cards.
    const searchRoots = drawerRoots.length > 0 ? drawerRoots : [document.body];

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
    dailyPanelOpen = false;
    renderDailyChecklistOverlay();
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
      button, input { font-family: inherit; }
      .hud {
        position: fixed;
        right: 18px;
        bottom: 66px;
        width: 304px;
        z-index: 2147483647;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: linear-gradient(180deg, rgba(26, 29, 35, 0.92) 0%, rgba(16, 18, 22, 0.96) 100%);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.16),
          0 20px 44px -10px rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(16px) saturate(150%);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        padding: 11px 12px;
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, ui-sans-serif, system-ui, sans-serif;
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
        font-size: 11px; padding: 5px 7px; border-radius: 10px;
        background: rgba(17, 23, 38, 0.78); border: 1px solid rgba(255, 255, 255, 0.07);
        transition: border-color 150ms ease-out, background 150ms ease-out, opacity 150ms ease-out;
      }
      .row.active { border-color: rgba(16, 185, 129, 0.58); background: rgba(16, 185, 129, 0.12); }
      .row.done { opacity: 0.52; }
      .row-left { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; cursor: pointer; }
      .row-left input { accent-color: #10b981; cursor: pointer; flex-shrink: 0; }
      .thumb {
        width: 24px; height: 24px; border-radius: 6px; overflow: hidden;
        background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12);
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        font-size: 8.5px; font-weight: 700; color: #94a3b8;
      }
      .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .slot-tag {
        font-size: 9px; font-weight: 700; color: #cbd5e1;
        background: rgba(255,255,255,0.08); border-radius: 5px; padding: 1px 4px; flex-shrink: 0;
      }
      .cap-tag { color: #fbbf24; font-weight: 800; font-size: 9px; flex-shrink: 0; }
      .name-wrap { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.15; }
      .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: #f8fafc; }
      .sub-meta { font-size: 9px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .row.done .name { text-decoration: line-through; color: #71717a; }
      .find-btn {
        background: rgba(56,189,248,0.16); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.3);
        border-radius: 6px; font-size: 9.5px; font-weight: 600; padding: 2px 6px; cursor: pointer; flex-shrink: 0;
      }
      .find-btn:hover:not(:disabled) { background: rgba(56,189,248,0.28); }
      .find-btn:disabled { opacity: 0.45; cursor: default; }
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
      .fill-btn:hover:not(:disabled) { filter: brightness(1.08); }
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

    let stepBusy = false;
    let activeTimers: number[] = [];
    function clearStepTimers(): void {
      for (const timer of activeTimers) {
        window.clearTimeout(timer);
      }
      activeTimers = [];
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      clearStepTimers();
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
    const findButtons: HTMLButtonElement[] = [];

    function syncActiveRow(): void {
      const nextIdx = checkboxes.findIndex((cb) => !cb.checked);
      rows.forEach((r, i) => r.classList.toggle("active", i === nextIdx));
      findButtons.forEach((fb) => {
        fb.disabled = stepBusy;
      });
      if (nextIdx === -1) {
        fillNextBtn.disabled = true;
        fillNextBtn.textContent = "All Picked";
        statusEl.textContent = "All slots checked. Review & Confirm on Sorare.";
      } else if (stepBusy) {
        fillNextBtn.disabled = true;
      } else {
        fillNextBtn.disabled = false;
        const target = resolvedSlots[nextIdx];
        fillNextBtn.textContent = `Fill Next (${target.slotLabel})`;
      }
    }

    /**
     * Waits until Sorare's React drawer finishes placing the clicked card (the clicked tile
     * disappears/detaches/disables) and the next slot's card list finishes loading before
     * unlocking the next step, preventing rapid clicks while the next slot drawer is loading.
     */
    function waitForPlacementConfirm(clickedTile: HTMLElement, playerName: string, onDone: () => void): void {
      const startMs = Date.now();
      let sawTilePlaced = false;
      let placedAtMs = 0;
      const poll = () => {
        const now = Date.now();
        const elapsed = now - startMs;
        if (!sawTilePlaced) {
          const tileGone =
            !clickedTile.isConnected ||
            !isElementVisible(clickedTile) ||
            clickedTile.hasAttribute("disabled") ||
            clickedTile.getAttribute("aria-disabled") === "true" ||
            clickedTile.getAttribute("aria-selected") === "true";
          if (tileGone || elapsed >= 800) {
            sawTilePlaced = true;
            placedAtMs = now;
          } else {
            fillNextBtn.textContent = "Placing...";
            statusEl.textContent = `Waiting for Sorare to place ${playerName}...`;
            const id = window.setTimeout(poll, 110);
            activeTimers.push(id);
            return;
          }
        }

        const sincePlaced = now - placedAtMs;
        if (isDrawerLoadingCards() && sincePlaced < 1100) {
          fillNextBtn.textContent = "Loading slot...";
          statusEl.textContent = `Placed ${playerName} - loading next slot cards...`;
          const id = window.setTimeout(poll, 120);
          activeTimers.push(id);
          return;
        }

        stepBusy = false;
        onDone();
        statusEl.textContent = `Placed ${playerName} - ready for next slot.`;
      };
      const firstId = window.setTimeout(poll, 140);
      activeTimers.push(firstId);
    }

    /**
     * Searches and polls for the target card tile up to ~3.2s while Sorare's drawer loads cards
     * after the previous placement.
     */
    function locateSlot(slot: LineupHighlightSlot, andClick: boolean, onSuccess?: () => void): void {
      if (stepBusy) return;
      clearStepTimers();

      const searchInput = findDrawerSearchInput();
      const targetNorm = normalizeNameForMatch(slot.playerName);
      const currentInputNorm = searchInput ? normalizeNameForMatch(searchInput.value) : "";
      const hasStaleFilter = Boolean(
        searchInput &&
          currentInputNorm.length > 0 &&
          currentInputNorm !== targetNorm &&
          !targetNorm.includes(currentInputNorm),
      );

      // Only accept an immediate match when the drawer is not actively loading and does not hold
      // a stale search filter from the previous slot.
      if (!hasStaleFilter && !isDrawerLoadingCards()) {
        const immediateTile = findCardTile(slot);
        if (immediateTile) {
          highlightTile(immediateTile);
          if (andClick) {
            stepBusy = true;
            fillNextBtn.textContent = "Placing...";
            syncActiveRow();
            immediateTile.click();
            waitForPlacementConfirm(immediateTile, slot.playerName, () => {
              onSuccess?.();
              syncActiveRow();
            });
          } else {
            statusEl.textContent = `Highlighted ${slot.playerName}.`;
          }
          return;
        }
      }

      stepBusy = true;
      fillNextBtn.textContent = "Loading cards...";
      syncActiveRow();

      if (searchInput) {
        setReactInputValue(searchInput, slot.playerName);
        statusEl.textContent = `Searching "${slot.playerName}"...`;
      } else {
        statusEl.textContent = `Waiting for ${slot.playerName} card list...`;
      }

      let attempts = 0;
      const maxAttempts = 16; // ~3.2s total (16 * 200ms)
      let typedInSearch = Boolean(searchInput);

      const retryFind = () => {
        attempts += 1;
        if (!typedInSearch) {
          const lateInput = findDrawerSearchInput();
          if (lateInput) {
            setReactInputValue(lateInput, slot.playerName);
            typedInSearch = true;
            statusEl.textContent = `Searching "${slot.playerName}"...`;
          }
        }
        if (!isDrawerLoadingCards() || attempts >= 3) {
          const delayedTile = findCardTile(slot);
          if (delayedTile) {
            highlightTile(delayedTile);
            if (andClick) {
              fillNextBtn.textContent = "Placing...";
              delayedTile.click();
              waitForPlacementConfirm(delayedTile, slot.playerName, () => {
                onSuccess?.();
                syncActiveRow();
              });
            } else {
              stepBusy = false;
              syncActiveRow();
              statusEl.textContent = `Highlighted ${slot.playerName}.`;
            }
            return;
          }
        }
        if (attempts < maxAttempts) {
          const tId = window.setTimeout(retryFind, 200);
          activeTimers.push(tId);
        } else {
          stepBusy = false;
          syncActiveRow();
          statusEl.textContent = typedInSearch
            ? `Card "${slot.playerName}" not found in this drawer.`
            : `Open a Sorare slot drawer for ${slot.playerName} first.`;
        }
      };

      const initId = window.setTimeout(retryFind, 200);
      activeTimers.push(initId);
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

      const thumb = document.createElement("span");
      thumb.className = "thumb";
      if (slot.pictureUrl && /^https:\/\/assets\.sorare\.com\//i.test(slot.pictureUrl)) {
        const img = document.createElement("img");
        img.src = slot.pictureUrl;
        img.alt = slot.playerName;
        thumb.appendChild(img);
      } else {
        const initials = slot.playerName
          .split(/\s+/)
          .map((w) => w[0] ?? "")
          .join("")
          .slice(0, 2)
          .toUpperCase();
        thumb.textContent = initials || "•";
      }

      const slotTag = document.createElement("span");
      slotTag.className = "slot-tag";
      slotTag.textContent = slot.slotLabel;

      const nameWrap = document.createElement("span");
      nameWrap.className = "name-wrap";

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = slot.playerName;
      nameWrap.appendChild(nameSpan);

      const metaParts: string[] = [];
      if (typeof slot.starCost === "number" && slot.starCost > 0) {
        metaParts.push(`${slot.starCost}★`);
      }
      if (typeof slot.projectedPts === "number" && slot.projectedPts > 0) {
        metaParts.push(`${slot.projectedPts.toFixed(1)} pts`);
      }
      if (slot.seasonYear > 0) {
        metaParts.push(String(slot.seasonYear));
      }
      if (metaParts.length > 0) {
        const subMeta = document.createElement("span");
        subMeta.className = "sub-meta";
        subMeta.textContent = metaParts.join(" • ");
        nameWrap.appendChild(subMeta);
      }

      label.append(cb, thumb, slotTag);
      if (slot.isCaptain) {
        const cap = document.createElement("span");
        cap.className = "cap-tag";
        cap.textContent = "MVP";
        label.append(cap);
      }
      label.append(nameWrap);

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
      findButtons.push(findBtn);
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

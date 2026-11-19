import { readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildArenaGw10LineupsHtml } from "./fixtures/sorareDomFixtures.ts";
import {
  createDefaultFetchHandler,
  installChromeAndFetchMock,
  type ChromeMockHandle,
} from "./helpers/chromeMock.ts";
import {
  REPO_ROOT,
  closeContractLoader,
  loadContractModule,
  readRepoText,
  repoFileExists,
  requireContractModule,
  requireExport,
} from "./helpers/contractLoader.ts";
import { createMiniDocument, runContentScriptInVm } from "./helpers/domHarness.ts";
import {
  extractButtonsAndControls,
  renderUiComponentToHtml,
} from "./helpers/uiRenderHarness.ts";

let activeMockHandle: ChromeMockHandle | null = null;

afterEach(() => {
  activeMockHandle?.restore();
  activeMockHandle = null;
});

afterAll(async () => {
  await closeContractLoader();
});

function collectSourceFilesRecursive(relDir: string): string[] {
  const rootAbs = join(REPO_ROOT, relDir);
  const collected: string[] = [];

  function walk(currentAbs: string, currentRel: string): void {
    const entries = readdirSync(currentAbs, { withFileTypes: true });
    for (const entry of entries) {
      const nextAbs = join(currentAbs, entry.name);
      const nextRel = `${currentRel}/${entry.name}`.replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(nextAbs, nextRel);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".spec.tsx") &&
        !entry.name.endsWith(".d.ts")
      ) {
        collected.push(nextRel);
      }
    }
  }

  walk(rootAbs, relDir.replace(/\\/g, "/"));
  return collected;
}

describe("F15 Tier 1 — E2E Harness Positive Contracts & Helper Fidelity", () => {
  it("T1.1 isolates E2E Vitest/TypeScript configs and excludes *.e2e.ts from default npm test", () => {
    const expectedFiles = [
      "tests/e2e/vitest.e2e.config.ts",
      "tests/e2e/tsconfig.e2e.json",
      "tests/e2e/node-builtins.d.ts",
      "tests/e2e/helpers/contractLoader.ts",
      "tests/e2e/helpers/chromeMock.ts",
      "tests/e2e/helpers/domHarness.ts",
      "tests/e2e/helpers/uiRenderHarness.ts",
      "tests/e2e/fixtures/gallery42Fixture.ts",
      "tests/e2e/fixtures/arenaLineupsFixture.ts",
      "tests/e2e/fixtures/sorareDomFixtures.ts",
      "tests/e2e/fixtures/espnAndLeaderboardFixtures.ts",
      "tests/e2e/fixtures/alertTrackerFixture.ts",
    ];

    for (const file of expectedFiles) {
      expect(repoFileExists(file), `Missing harness file: ${file}`).toBe(true);
    }

    const e2eVitestCfg = readRepoText("tests/e2e/vitest.e2e.config.ts");
    expect(e2eVitestCfg).toContain('tests/e2e/**/*.e2e.ts');
    expect(e2eVitestCfg).toContain('environment: "node"');
    expect(e2eVitestCfg).toContain("globals: false");

    const e2eTsCfg = JSON.parse(readRepoText("tests/e2e/tsconfig.e2e.json")) as {
      include?: string[];
    };
    expect(e2eTsCfg.include).toContain("./**/*.ts");
    expect(e2eTsCfg.include).toContain("./**/*.d.ts");

    const rootTsCfg = JSON.parse(readRepoText("tsconfig.json")) as {
      include?: string[];
    };
    expect(rootTsCfg.include).toEqual(["src"]);

    const pkg = JSON.parse(readRepoText("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.test).toBe("vitest run");

    const e2eDirFiles = collectSourceFilesRecursive("tests/e2e");
    expect(e2eDirFiles.some((f) => f.endsWith(".test.ts") || f.endsWith(".spec.ts"))).toBe(
      false,
    );
  });

  it("T1.2 resolves live modules and exports dynamically via contractLoader", async () => {
    const loadRes = await loadContractModule<Record<string, unknown>>("src/shared/routes.ts");
    expect(loadRes.available).toBe(true);
    expect(loadRes.mod).not.toBeNull();

    const mod = await requireContractModule<Record<string, unknown>>("src/shared/routes.ts");
    const buildProPlayUrl = requireExport<() => string>(
      mod,
      "buildProPlayUrl",
      "src/shared/routes.ts",
    );
    expect(buildProPlayUrl()).toBe("https://sorare.com/nba/play");

    const pkg = JSON.parse(readRepoText("package.json")) as { name?: string };
    expect(pkg.name).toBe("pjampjams-sorare-nba-essentials");
  });

  it("T1.3 mocks storage, alarms, tabs, runtime manifest, and default Sorare/ESPN fetch in chromeMock", async () => {
    const g = globalThis as unknown as { chrome?: unknown; fetch?: unknown };
    const priorChrome = g.chrome;
    const priorFetch = g.fetch;

    const handle = installChromeAndFetchMock({
      initialStorage: { a: 1, existingKey: "ok" },
      manifestVersion: "2.7.0",
    });
    activeMockHandle = handle;

    expect(await handle.chrome.storage.local.get("a")).toEqual({ a: 1 });
    expect(await handle.chrome.storage.local.get(["a", "missing"])).toEqual({ a: 1 });
    expect(
      await handle.chrome.storage.local.get({ a: 99, fallbackKey: "defaultVal" }),
    ).toEqual({ a: 1, fallbackKey: "defaultVal" });
    expect(await handle.chrome.storage.local.get(null)).toEqual({
      a: 1,
      existingKey: "ok",
    });

    const storageChanges: Array<Record<string, chrome.storage.StorageChange>> = [];
    handle.chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") storageChanges.push(changes);
    });
    await handle.chrome.storage.local.set({ a: 2, added: true });
    expect(storageChanges).toHaveLength(1);
    expect(storageChanges[0]?.a).toEqual({ oldValue: 1, newValue: 2 });
    expect(storageChanges[0]?.added).toEqual({ oldValue: undefined, newValue: true });

    let firedAlarmName = "";
    handle.chrome.alarms.onAlarm.addListener((alarm) => {
      firedAlarmName = alarm.name;
    });
    await handle.chrome.alarms.create("e2e-check-alarm", { delayInMinutes: 1 });
    expect(handle.alarms.has("e2e-check-alarm")).toBe(true);
    await handle.triggerAlarm("e2e-check-alarm");
    expect(firedAlarmName).toBe("e2e-check-alarm");

    const createdTab = await handle.chrome.tabs.create({
      url: "https://sorare.com/nba/series/play",
      active: true,
    });
    expect(createdTab.url).toBe("https://sorare.com/nba/series/play");
    const activeTabs = await handle.chrome.tabs.query({ active: true });
    expect(activeTabs.some((t) => t.url === "https://sorare.com/nba/series/play")).toBe(
      true,
    );

    expect(handle.chrome.runtime.getManifest().version).toBe("2.7.0");

    const espnResp = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
    );
    expect(espnResp.status).toBe(200);
    expect(await espnResp.json()).toEqual({ injuries: [] });

    const gqlResp = await fetch("https://api.sorare.com/graphql", {
      method: "POST",
      body: JSON.stringify({ query: "query UserNbaCollections { user { slug } }" }),
    });
    expect(gqlResp.status).toBe(200);
    const gqlJson = (await gqlResp.json()) as { data?: { user?: { slug?: string } } };
    expect(gqlJson.data?.user?.slug).toBe("pjampjam");

    handle.restore();
    activeMockHandle = null;
    expect(g.chrome).toBe(priorChrome);
    expect(g.fetch).toBe(priorFetch);
  });

  it("T1.4 tracks chromeMock.notifications full lifecycle, listener order, and event timeline", async () => {
    const handle = installChromeAndFetchMock();
    activeMockHandle = handle;

    const autoId = await handle.chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "Surge",
      message: "+45%",
    });
    expect(autoId).toBe("notif-1");

    let callbackId = "";
    const explicitId = await handle.chrome.notifications.create(
      "alert-2",
      {
        type: "basic",
        iconUrl: "icon.png",
        title: "Injury",
        message: "Dean Wade OUT",
      },
      (id) => {
        callbackId = id;
      },
    );
    expect(explicitId).toBe("alert-2");
    expect(callbackId).toBe("alert-2");

    expect(await handle.chrome.notifications.getAll()).toEqual({
      "notif-1": true,
      "alert-2": true,
    });

    const updated = await handle.chrome.notifications.update("alert-2", {
      title: "Updated",
    });
    expect(updated).toBe(true);
    expect(handle.notifications.get("alert-2")?.options.title).toBe("Updated");

    const clickCallOrder: string[] = [];
    handle.chrome.notifications.onClicked.addListener((id) => {
      clickCallOrder.push(`first:${id}`);
    });
    handle.chrome.notifications.onClicked.addListener((id) => {
      clickCallOrder.push(`second:${id}`);
    });
    await handle.triggerNotificationClick("alert-2");
    expect(clickCallOrder).toEqual(["first:alert-2", "second:alert-2"]);

    expect(await handle.chrome.notifications.clear("alert-2")).toBe(true);
    expect(await handle.chrome.notifications.getAll()).toEqual({ "notif-1": true });
    expect(handle.notificationEvents.map((e) => e.type)).toEqual([
      "create",
      "create",
      "update",
      "click",
      "clear",
    ]);
  });

  it("T1.5 parses selectors, entities, innerText, dataset, and Shadow DOM in MiniDocument", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><style>.hidden { color: red; }</style></head>
        <body>
          <!-- Header comment -->
          <div id="root" data-player-slug="wendell-carter-jr">
            <h3>Header &amp; Info</h3>
            <p class="lead">First Paragraph</p>
            <div class="drawer-box active">
              <span>WENDELL</span>
              <span>CARTER JR</span>
            </div>
            <div class="drawer-box muted">Ignore Me</div>
          </div>
          <script>const ignored = "never in innerText";</script>
        </body>
      </html>
    `;
    const doc = createMiniDocument(html, "https://sorare.com/nba/lineups");

    const directSpans = doc.querySelectorAll("div > span");
    expect(directSpans.map((n) => n.textContent)).toEqual(["WENDELL", "CARTER JR"]);

    const adj = doc.querySelectorAll("h3 + p");
    expect(adj).toHaveLength(1);
    expect(adj[0]?.textContent).toBe("First Paragraph");

    const siblingDivs = doc.querySelectorAll("h3 ~ div");
    expect(siblingDivs).toHaveLength(2);

    const caseInsensitiveDrawer = doc.querySelectorAll('[class*="DRAWER" i]:not(.muted)');
    expect(caseInsensitiveDrawer).toHaveLength(1);

    const multiSelectors = doc.querySelectorAll("h3, p.lead");
    expect(multiSelectors).toHaveLength(2);

    const root = doc.getElementById("root");
    expect(root).not.toBeNull();
    expect(root?.dataset.playerSlug).toBe("wendell-carter-jr");
    const text = root?.innerText ?? "";
    expect(text).toContain("Header & Info");
    expect(text).toContain("First Paragraph");
    expect(text).toContain("\n");
    expect(text).not.toContain("never in innerText");
    expect(text).not.toContain("color: red");

    const host = doc.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const shadowBtn = doc.createElement("button");
    shadowBtn.className = "shadow-cta";
    shadowBtn.textContent = "Go";
    shadow.appendChild(shadowBtn);
    expect(shadow.querySelector(".shadow-cta")?.textContent).toBe("Go");
  });

  it("T1.6 executes sorareDetector.ts inside node:vm and extracts 3 Arena GW10 lineups", async () => {
    const handle = installChromeAndFetchMock();
    activeMockHandle = handle;

    const result = await runContentScriptInVm(
      buildArenaGw10LineupsHtml(),
      "https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026",
      handle,
    );

    expect(result.errors).toEqual([]);
    expect(result.context).toBe("lineups");
    expect(Array.isArray(result.extractedLineups)).toBe(true);
    expect(result.extractedLineups).toHaveLength(3);
  });

  it("T1.7 renders React UI via uiRenderHarness with options.chromeMock, restores globals, and extracts controls", async () => {
    const g = globalThis as unknown as {
      window?: unknown;
      chrome?: unknown;
      localStorage?: unknown;
    };
    const priorWindow = g.window;
    const priorChrome = g.chrome;
    const priorStorage = g.localStorage;

    const handle = installChromeAndFetchMock({ manifestVersion: "2.7.0" });
    activeMockHandle = handle;

    const rowMod = await requireContractModule<Record<string, unknown>>(
      "src/sidepanel/components/PlayerCardRow.tsx",
    );
    const PlayerCardRow = requireExport<React.ComponentType<Record<string, unknown>>>(
      rowMod,
      "PlayerCardRow",
      "src/sidepanel/components/PlayerCardRow.tsx",
    );

    let notificationsAvailableDuringRender = false;
    let searchSeenDuringRender = "";
    let storageSeenDuringRender: string | null = null;

    function ProbeWrapper(): React.ReactElement {
      const probeGlobal = globalThis as unknown as {
        chrome?: { notifications?: { getPermissionLevel?: unknown } };
        window?: { location?: { search?: string } };
        localStorage?: { getItem?: (k: string) => string | null };
      };
      notificationsAvailableDuringRender = Boolean(
        probeGlobal.chrome?.notifications?.getPermissionLevel,
      );
      searchSeenDuringRender = probeGlobal.window?.location?.search ?? "";
      storageSeenDuringRender = probeGlobal.localStorage?.getItem?.("theme") ?? null;

      return React.createElement(
        "div",
        null,
        React.createElement(PlayerCardRow, {
          playerName: "Wendell Carter Jr.",
          teamSlug: "orlando-magic",
          teamName: "Orlando Magic",
          rarity: "limited",
          subline: React.createElement("span", null, "L10 28.0"),
          heroRight: React.createElement("span", null, "3.0★"),
          actionRight: React.createElement(
            "button",
            { type: "button", className: "btn-go" },
            "Go",
          ),
        }),
        React.createElement(
          "a",
          { href: "https://sorare.com/nba/play", className: "link-play" },
          "Open Pro Play",
        ),
        React.createElement(
          "span",
          { role: "button", "aria-label": "Pin pick" },
          "Pin",
        ),
        React.createElement("input", {
          type: "submit",
          value: "Save Rules",
          className: "submit-btn",
        }),
      );
    }

    const html = renderUiComponentToHtml(React.createElement(ProbeWrapper), {
      search: "?view=dashboard",
      chromeMock: handle,
      localStorageData: { theme: "obsidian" },
    });

    expect(notificationsAvailableDuringRender).toBe(true);
    expect(searchSeenDuringRender).toBe("?view=dashboard");
    expect(storageSeenDuringRender).toBe("obsidian");
    expect(html).toContain("Wendell Carter Jr.");

    expect(g.window).toBe(priorWindow);
    expect(g.chrome).toBe(handle.chrome);
    expect(g.localStorage).toBe(priorStorage);

    const controls = extractButtonsAndControls(html);
    expect(controls.some((c) => c.tag === "button" && c.text === "Go")).toBe(true);
    expect(
      controls.some(
        (c) =>
          c.tag === "a" &&
          c.href === "https://sorare.com/nba/play" &&
          c.text === "Open Pro Play",
      ),
    ).toBe(true);
    expect(
      controls.some((c) => c.tag === "span" && c.ariaLabel === "Pin pick" && c.text === "Pin"),
    ).toBe(true);
    expect(
      controls.some(
        (c) => c.tag === "input" && c.type === "submit" && c.text === "Save Rules",
      ),
    ).toBe(true);
  });
});

describe("F15 Tier 2 — Harness Boundaries, Resilience & AGENTS.md Invariants", () => {
  it("T2.1 fails cleanly on missing modules, missing exports, and missing repo text files", async () => {
    const missing = await loadContractModule("src/nonexistent_module_f15.ts");
    expect(missing.available).toBe(false);
    expect(missing.mod).toBeNull();
    expect(missing.error).toContain("Module not found");

    await expect(requireContractModule("src/nonexistent_module_f15.ts")).rejects.toThrow(
      /Module not found/,
    );

    expect(() => requireExport({ a: undefined }, "a", "x.ts")).toThrow(
      /Missing required contract export/,
    );

    expect(() => readRepoText("src/nonexistent_file_f15.ts")).toThrow(/does not exist/);
  });

  it("T2.2 handles chromeMock.notifications whitespace IDs, deep cloning, duplicate replace, and missing clears", async () => {
    const handle = installChromeAndFetchMock();
    activeMockHandle = handle;

    const emptyId = await handle.chrome.notifications.create("", {
      type: "basic",
      iconUrl: "icon.png",
      title: "Empty",
      message: "Auto ID 1",
    });
    const spaceId = await handle.chrome.notifications.create("   ", {
      type: "basic",
      iconUrl: "icon.png",
      title: "Whitespace",
      message: "Auto ID 2",
    });
    expect(emptyId).toBe("notif-1");
    expect(spaceId).toBe("notif-2");

    const sourceOptions: chrome.notifications.NotificationOptions = {
      type: "list",
      iconUrl: "icon.png",
      title: "Clone Check",
      message: "Original",
      buttons: [{ title: "Open" }],
      items: [{ title: "Row 1", message: "Initial" }],
    };
    const cloneId = await handle.chrome.notifications.create("clone-id", sourceOptions);
    expect(cloneId).toBe("clone-id");

    sourceOptions.buttons![0]!.title = "Mutated Button";
    sourceOptions.items![0]!.message = "Mutated Item";

    const stored = handle.notifications.get("clone-id");
    expect(stored?.options.buttons?.[0]?.title).toBe("Open");
    expect(stored?.options.items?.[0]?.message).toBe("Initial");

    await handle.chrome.notifications.create("clone-id", {
      type: "basic",
      iconUrl: "icon.png",
      title: "Replaced",
      message: "Second",
    });
    const cloneEvents = handle.notificationEvents.filter((e) => e.id === "clone-id");
    expect(cloneEvents.map((e) => e.type)).toEqual(["create", "clear", "create"]);
    expect(cloneEvents[1]?.wasCleared).toBe(true);

    expect(await handle.chrome.notifications.clear("clone-id")).toBe(true);
    expect(await handle.chrome.notifications.clear("clone-id")).toBe(false);
    expect(await handle.chrome.notifications.clear("missing-id")).toBe(false);

    expect(
      await handle.chrome.notifications.update("missing-id", { title: "Nope" }),
    ).toBe(false);
    expect(
      await handle.chrome.notifications.update("clone-id", { title: "Already Cleared" }),
    ).toBe(false);
  });

  it("T2.3 restores sentinel globals when React render throws and extracts input[aria-disabled] controls", () => {
    const g = globalThis as unknown as {
      window?: unknown;
      chrome?: unknown;
      localStorage?: unknown;
    };
    const hadWindow = "window" in g;
    const prevWindow = g.window;
    const hadChrome = "chrome" in g;
    const prevChrome = g.chrome;
    const hadStorage = "localStorage" in g;
    const prevStorage = g.localStorage;

    const sentinelWindow = { sentinel: "win" };
    const sentinelChrome = { sentinel: "chr" };
    const sentinelStorage = { sentinel: "ls" };
    g.window = sentinelWindow;
    g.chrome = sentinelChrome;
    g.localStorage = sentinelStorage;

    function ThrowingComponent(): React.ReactElement {
      throw new Error("boom");
    }

    try {
      expect(() =>
        renderUiComponentToHtml(React.createElement(ThrowingComponent)),
      ).toThrow("boom");
      expect(g.window).toBe(sentinelWindow);
      expect(g.chrome).toBe(sentinelChrome);
      expect(g.localStorage).toBe(sentinelStorage);
    } finally {
      if (hadWindow) g.window = prevWindow;
      else delete g.window;
      if (hadChrome) g.chrome = prevChrome;
      else delete g.chrome;
      if (hadStorage) g.localStorage = prevStorage;
      else delete g.localStorage;
    }

    const controls = extractButtonsAndControls(
      '<input type="submit" value="Go" aria-disabled="true" class="cta-btn" />',
    );
    expect(controls).toEqual([
      {
        tag: "input",
        text: "Go",
        className: "cta-btn",
        disabled: true,
        type: "submit",
      },
    ]);
  });

  it("T2.4 returns zero rects for hidden elements, ignores unsupported pseudo-classes, and falls back to general in VM", async () => {
    const doc = createMiniDocument(
      `
      <html><body>
        <div id="vis">Visible</div>
        <div id="hid" hidden>Hidden attr</div>
        <div id="none" style="display: none">Display none</div>
      </body></html>
      `,
      "https://sorare.com/nba/play",
    );

    const visRect = doc.getElementById("vis")?.getBoundingClientRect();
    expect(visRect?.width).toBe(220);
    expect(visRect?.height).toBe(140);

    const hidRect = doc.getElementById("hid")?.getBoundingClientRect();
    expect(hidRect?.width).toBe(0);
    expect(hidRect?.height).toBe(0);

    const noneRect = doc.getElementById("none")?.getBoundingClientRect();
    expect(noneRect?.width).toBe(0);
    expect(noneRect?.height).toBe(0);

    expect(() => doc.querySelectorAll("div:hover")).not.toThrow();

    const handle = installChromeAndFetchMock();
    activeMockHandle = handle;
    const vmRes = await runContentScriptInVm(
      "<html><body><p>Idle</p></body></html>",
      "https://sorare.com/nba/unknown-route",
      handle,
    );
    expect(vmRes.context).toBe("general");
    expect(vmRes.extractedLineups).toEqual([]);
    expect(vmRes.errors).toEqual([]);
  });

  it("T2.5 enforces AGENTS.md pure-calculator invariant across all non-test src/calculators files", () => {
    const calcFiles = collectSourceFilesRecursive("src/calculators");
    expect(calcFiles.length).toBeGreaterThan(0);

    for (const file of calcFiles) {
      const code = readRepoText(file);
      expect(code, `${file} must not reference chrome.*`).not.toMatch(/\bchrome\s*\./);
      expect(code, `${file} must not call fetch()`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${file} must not access DOM/window globals`).not.toMatch(
        /\b(document|window|localStorage|navigator)\s*\./,
      );
      expect(code, `${file} must not use XHR/WebSocket`).not.toMatch(
        /\b(XMLHttpRequest|WebSocket)\b/,
      );
    }
  });

  it("T2.6 enforces AGENTS.md network isolation invariant across non-background src/ modules", () => {
    const isolatedDirs = [
      "src/sidepanel",
      "src/content",
      "src/calculators",
      "src/shared",
    ];
    for (const dir of isolatedDirs) {
      const files = collectSourceFilesRecursive(dir);
      for (const file of files) {
        const code = readRepoText(file);
        expect(code, `${file} must not call fetch()`).not.toMatch(/\bfetch\s*\(/);
        expect(code, `${file} must not use XHR/WebSocket`).not.toMatch(
          /\b(XMLHttpRequest|WebSocket)\b/,
        );
        expect(code, `${file} must not reference site.api.espn.com`).not.toMatch(
          /site\.api\.espn\.com/,
        );
      }
    }

    for (const dir of ["src/content", "src/calculators"]) {
      for (const file of collectSourceFilesRecursive(dir)) {
        expect(
          readRepoText(file),
          `${file} must not reference api.sorare.com`,
        ).not.toMatch(/api\.sorare\.com/);
      }
    }
    expect(readRepoText("src/sidepanel/api.ts")).not.toMatch(/api\.sorare\.com/);
  });

  it("T2.7 enforces background rate-limit safety cap (<= 120 req/min) and fail-closed 404 on unmocked fetch", async () => {
    const constantsMod = await requireContractModule<Record<string, unknown>>(
      "src/shared/constants.ts",
    );
    const maxReq = requireExport<number>(
      constantsMod,
      "MAX_REQUESTS_PER_MINUTE",
      "src/shared/constants.ts",
    );
    const fastReq = requireExport<number>(
      constantsMod,
      "FAST_MODE_REQUESTS_PER_MINUTE",
      "src/shared/constants.ts",
    );

    expect(Number.isFinite(maxReq) && maxReq > 0 && maxReq <= 120).toBe(true);
    expect(Number.isFinite(fastReq) && fastReq > 0 && fastReq <= 120).toBe(true);

    const handler = createDefaultFetchHandler();
    const res = await handler("https://unmocked.example.com/data");
    expect(res.status).toBe(404);
  });
});

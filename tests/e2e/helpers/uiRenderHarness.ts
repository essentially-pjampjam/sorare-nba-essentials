import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMiniDocument } from "./domHarness.ts";

export interface UiRenderOptions {
  search?: string;
  chromeMock?: unknown;
  localStorageData?: Record<string, string>;
}

export interface ExtractedControl {
  tag: string;
  text: string;
  className: string;
  ariaLabel?: string;
  href?: string;
  disabled?: boolean;
  title?: string;
  type?: string;
}

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

export function renderUiComponentToHtml(
  element: React.ReactElement,
  options: UiRenderOptions = {},
): string {
  const g = globalThis as unknown as {
    window?: unknown;
    chrome?: unknown;
    localStorage?: Storage;
  };
  const hadWindow = "window" in g;
  const prevWindow = g.window;
  const hadChrome = "chrome" in g;
  const prevChrome = g.chrome;
  const hadLocalStorage = "localStorage" in g;
  const prevLocalStorage = g.localStorage;

  const search = options.search
    ? options.search.startsWith("?")
      ? options.search
      : `?${options.search}`
    : "";
  const localStorageMock = createMemoryStorage(options.localStorageData);

  const rawMock = options.chromeMock as
    | { chrome?: unknown }
    | Record<string, unknown>
    | undefined;
  const chromeObj =
    rawMock && typeof rawMock === "object" && "chrome" in rawMock && rawMock.chrome
      ? rawMock.chrome
      : rawMock ?? {
          runtime: {
            id: "jamassist-test-extension-id",
            getManifest: () => ({ version: "2.7.0", name: "Sorare NBA Essentials" }),
            getURL: (p: string) => `chrome-extension://jamassist-test-extension-id/${p}`,
            sendMessage: () => Promise.resolve({ ok: true, data: null }),
            connect: () => ({
              name: "jamassist-sidepanel",
              postMessage: () => {},
              disconnect: () => {},
              onMessage: { addListener: () => {}, removeListener: () => {} },
              onDisconnect: { addListener: () => {}, removeListener: () => {} },
            }),
          },
          storage: {
            local: {
              get: (_k: unknown, cb?: (r: Record<string, unknown>) => void) => {
                cb?.({});
                return Promise.resolve({});
              },
              set: (_v: unknown, cb?: () => void) => {
                cb?.();
                return Promise.resolve();
              },
            },
            onChanged: { addListener: () => {}, removeListener: () => {} },
          },
        };

  g.localStorage = localStorageMock;
  g.chrome = chromeObj;
  g.window = {
    location: {
      search,
      href: `https://extension.local/sidepanel.html${search}`,
      pathname: "/sidepanel.html",
    },
    localStorage: localStorageMock,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  try {
    return renderToStaticMarkup(element);
  } finally {
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
    if (hadChrome) g.chrome = prevChrome;
    else delete g.chrome;
    if (hadLocalStorage) g.localStorage = prevLocalStorage;
    else delete g.localStorage;
  }
}

export function extractButtonsAndControls(html: string): ExtractedControl[] {
  const doc = createMiniDocument(html, "https://extension.local/");
  const nodes = doc.querySelectorAll(
    'button, a, [role="button"], input[type="button"], input[type="submit"]',
  );
  const out: ExtractedControl[] = [];
  for (const el of nodes) {
    const tag = el.tagName.toLowerCase();
    const rawText = el.textContent.replace(/\s+/g, " ").trim();
    const valueAttr = el.getAttribute("value");
    const text = rawText || valueAttr || "";
    const className = el.className;
    const ariaLabel = el.getAttribute("aria-label") ?? undefined;
    const href = el.getAttribute("href") ?? undefined;
    const title = el.getAttribute("title") ?? undefined;
    const type = el.getAttribute("type") ?? undefined;
    const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";

    const entry: ExtractedControl = {
      tag,
      text,
      className,
    };
    if (ariaLabel !== undefined) entry.ariaLabel = ariaLabel;
    if (href !== undefined) entry.href = href;
    if (disabled) entry.disabled = true;
    if (title !== undefined) entry.title = title;
    if (type !== undefined) entry.type = type;
    out.push(entry);
  }
  return out;
}

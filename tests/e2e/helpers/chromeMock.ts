export interface ChromeMockOptions {
  fetchHandler?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> | Response;
  initialStorage?: Record<string, unknown>;
  manifestVersion?: string;
}

export interface RecordedAlarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
  delayInMinutes?: number;
}

export interface OpenedTab {
  id: number;
  url?: string;
  active?: boolean;
  windowId?: number;
}

export interface SentMessage {
  target: "runtime" | "tab";
  tabId?: number;
  message: unknown;
}

export interface RecordedNotification {
  id: string;
  options: chrome.notifications.NotificationOptions;
  createdAt: number;
  updatedAt?: number;
  cleared: boolean;
  clearedAt?: number;
}

export interface NotificationEvent {
  type: "create" | "clear" | "click" | "update" | "close";
  id: string;
  options?: chrome.notifications.NotificationOptions;
  wasCleared?: boolean;
  wasUpdated?: boolean;
  byUser?: boolean;
  timestamp: number;
}

export interface ChromeMockHandle {
  chrome: typeof chrome;
  storageData: Record<string, unknown>;
  alarms: Map<string, RecordedAlarm>;
  openedTabs: OpenedTab[];
  sentMessages: SentMessage[];
  notifications: Map<string, RecordedNotification>;
  notificationEvents: NotificationEvent[];
  triggerAlarm(name: string): Promise<void>;
  triggerNotificationClick(id: string): Promise<void>;
  triggerRuntimeMessage(
    message: unknown,
    sender?: chrome.runtime.MessageSender,
  ): Promise<unknown>;
  restore(): void;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildDefaultGraphqlPayload(query: string): Record<string, unknown> {
  if (query.includes("UserNbaCollections")) {
    return {
      data: {
        user: {
          slug: "pjampjam",
          cardCounts: { limited: 42, rare: 0, superRare: 0, unique: 0, total: 42 },
          cardCollections: {
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: [],
          },
        },
      },
    };
  }
  if (query.includes("GalleryAndFixtures")) {
    return {
      data: {
        user: {
          cards: {
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: [],
          },
        },
        so5: {
          featuredSo5Fixtures: [
            {
              slug: "nba-21-23-nov-2026",
              displayName: "Game Week 10",
              cutOffDate: "2026-11-21T00:00:00Z",
              endDate: "2026-11-23T04:24:11Z",
              aasmState: "opened",
            },
          ],
        },
      },
    };
  }
  if (query.includes("ClosedFixtureBoards")) {
    return {
      data: {
        so5: {
          so5Fixture: {
            slug: "nba-14-16-nov-2026",
            so5Leaderboards: [],
          },
        },
      },
    };
  }
  if (query.includes("ClosedCutoffs")) {
    return { data: { so5: {} } };
  }
  if (query.includes("CraftPoolTier")) {
    return {
      data: {
        cardShardsPoolComputedAt: "2026-11-18T12:00:00Z",
        cardShardsPool: [],
      },
    };
  }
  if (query.includes("UserQuestCards")) {
    return {
      data: {
        user: {
          cards: {
            pageInfo: { endCursor: null, hasNextPage: false },
            nodes: [],
          },
        },
      },
    };
  }
  if (
    query.includes("GroupedTeamFloor") ||
    query.includes("GroupedBargainIds")
  ) {
    return { data: { searchGroupedCards: { groups: [] } } };
  }
  if (
    query.includes("BatchCardPrices") ||
    query.includes("HydrateBargainCards") ||
    query.includes("HydrateAuctionCards")
  ) {
    return { data: { anyCards: [] } };
  }
  if (query.includes("DiscoverAuctionIds") || query.includes("CraftPlayerFloor")) {
    return { data: { searchCards: { hits: [] } } };
  }
  if (query.includes("CollectionMissingSlots")) {
    return {
      data: {
        cardCollection: {
          slug: "",
          userCardCollection: { allSlots: [], fulfilledSlots: [] },
        },
      },
    };
  }
  return { data: {} };
}

export function createDefaultFetchHandler(): (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("api.sorare.com/graphql")) {
      let query = "";
      if (typeof init?.body === "string") {
        try {
          const parsed = JSON.parse(init.body) as { query?: unknown };
          if (typeof parsed.query === "string") {
            query = parsed.query;
          }
        } catch {
          query = "";
        }
      }
      return jsonResponse(buildDefaultGraphqlPayload(query));
    }

    if (url.includes("site.api.espn.com") && url.includes("/injuries")) {
      return jsonResponse({ injuries: [] });
    }

    if (url.includes("site.api.espn.com") && url.includes("/scoreboard")) {
      return jsonResponse({ events: [] });
    }

    return jsonResponse({ error: `Unmocked URL in default fetchHandler: ${url}` }, 404);
  };
}

function resolveStorageGet(
  store: Record<string, unknown>,
  keys: string | string[] | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (keys === null || keys === undefined) {
    return { ...store };
  }
  if (typeof keys === "string") {
    return keys in store ? { [keys]: store[keys] } : {};
  }
  if (Array.isArray(keys)) {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (k in store) {
        out[k] = store[k];
      }
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, fallback] of Object.entries(keys)) {
    out[k] = k in store ? store[k] : fallback;
  }
  return out;
}

export function installChromeAndFetchMock(
  options: ChromeMockOptions = {},
): ChromeMockHandle {
  const g = globalThis as unknown as {
    chrome?: unknown;
    fetch?: typeof fetch;
  };
  const hadChrome = "chrome" in g;
  const prevChrome = g.chrome;
  const hadFetch = "fetch" in g;
  const prevFetch = g.fetch;

  const storageData: Record<string, unknown> = { ...(options.initialStorage ?? {}) };
  const alarms = new Map<string, RecordedAlarm>();
  const openedTabs: OpenedTab[] = [
    { id: 1, url: "https://sorare.com/nba/play", active: true, windowId: 1 },
  ];
  const sentMessages: SentMessage[] = [];
  let nextTabId = 2;
  const notifications = new Map<string, RecordedNotification>();
  const notificationEvents: NotificationEvent[] = [];
  let nextNotificationId = 1;

  const storageListeners = new Set<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => void
  >();
  const runtimeMessageListeners = new Set<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void
  >();
  const connectListeners = new Set<(port: chrome.runtime.Port) => void>();
  const installedListeners = new Set<
    (details: chrome.runtime.InstalledDetails) => void
  >();
  const alarmListeners = new Set<(alarm: chrome.alarms.Alarm) => void>();
  const notificationClickListeners = new Set<(notificationId: string) => void>();
  const notificationClosedListeners = new Set<
    (notificationId: string, byUser: boolean) => void
  >();

  const cloneNotificationOptions = (
    rawOptions: chrome.notifications.NotificationOptions,
  ): chrome.notifications.NotificationOptions => ({
    ...rawOptions,
    ...(rawOptions.buttons
      ? { buttons: rawOptions.buttons.map((b) => ({ ...b })) }
      : {}),
    ...(rawOptions.items
      ? { items: rawOptions.items.map((it) => ({ ...it })) }
      : {}),
  });

  const emitStorageChanges = (
    changes: Record<string, chrome.storage.StorageChange>,
  ) => {
    if (Object.keys(changes).length === 0) return;
    for (const fn of storageListeners) {
      fn(changes, "local");
    }
  };

  const manifestVersion = options.manifestVersion ?? "2.7.0";
  const extensionId = "jamassist-test-extension-id";

  const mockChrome = {
    storage: {
      local: {
        get: (
          keys?: string | string[] | Record<string, unknown> | null,
          cb?: (items: Record<string, unknown>) => void,
        ) => {
          const actualCb =
            typeof keys === "function"
              ? (keys as unknown as (items: Record<string, unknown>) => void)
              : cb;
          const actualKeys = typeof keys === "function" ? null : keys;
          const res = resolveStorageGet(storageData, actualKeys);
          if (actualCb) {
            actualCb(res);
          }
          return Promise.resolve(res);
        },
        set: (items: Record<string, unknown>, cb?: () => void) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: storageData[k], newValue: v };
            storageData[k] = v;
          }
          emitStorageChanges(changes);
          cb?.();
          return Promise.resolve();
        },
        remove: (keys: string | string[], cb?: () => void) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const k of list) {
            if (k in storageData) {
              changes[k] = { oldValue: storageData[k], newValue: undefined };
              delete storageData[k];
            }
          }
          emitStorageChanges(changes);
          cb?.();
          return Promise.resolve();
        },
        clear: (cb?: () => void) => {
          const changes: Record<string, chrome.storage.StorageChange> = {};
          for (const k of Object.keys(storageData)) {
            changes[k] = { oldValue: storageData[k], newValue: undefined };
            delete storageData[k];
          }
          emitStorageChanges(changes);
          cb?.();
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (
          fn: (
            changes: Record<string, chrome.storage.StorageChange>,
            areaName: string,
          ) => void,
        ) => {
          storageListeners.add(fn);
        },
        removeListener: (
          fn: (
            changes: Record<string, chrome.storage.StorageChange>,
            areaName: string,
          ) => void,
        ) => {
          storageListeners.delete(fn);
        },
        hasListener: (
          fn: (
            changes: Record<string, chrome.storage.StorageChange>,
            areaName: string,
          ) => void,
        ) => storageListeners.has(fn),
      },
    },
    runtime: {
      id: extensionId,
      lastError: undefined as chrome.runtime.LastError | undefined,
      getURL: (path: string) =>
        `chrome-extension://${extensionId}/${path.replace(/^\/+/, "")}`,
      getManifest: () =>
        ({
          manifest_version: 3,
          name: "pjampjam's Sorare NBA Essentials",
          version: manifestVersion,
        }) as chrome.runtime.ManifestV3,
      sendMessage: (
        message: unknown,
        cb?: (response?: unknown) => void,
      ): Promise<unknown> => {
        sentMessages.push({ target: "runtime", message });
        const sender: chrome.runtime.MessageSender = {
          id: extensionId,
          url: `chrome-extension://${extensionId}/sidepanel.html`,
        };
        return new Promise((resolve) => {
          let responded = false;
          const sendResponse = (resp?: unknown) => {
            if (responded) return;
            responded = true;
            cb?.(resp);
            resolve(resp);
          };
          let handledAsync = false;
          for (const listener of runtimeMessageListeners) {
            const ret = listener(message, sender, sendResponse);
            if (ret === true) {
              handledAsync = true;
            }
          }
          if (!responded && !handledAsync) {
            const fallbackResp = { ok: true, data: null };
            cb?.(fallbackResp);
            resolve(fallbackResp);
          }
        });
      },
      onMessage: {
        addListener: (
          fn: (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: unknown) => void,
          ) => boolean | void,
        ) => {
          runtimeMessageListeners.add(fn);
        },
        removeListener: (
          fn: (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: unknown) => void,
          ) => boolean | void,
        ) => {
          runtimeMessageListeners.delete(fn);
        },
        hasListener: (
          fn: (
            message: unknown,
            sender: chrome.runtime.MessageSender,
            sendResponse: (response?: unknown) => void,
          ) => boolean | void,
        ) => runtimeMessageListeners.has(fn),
        hasListeners: () => runtimeMessageListeners.size > 0,
      },
      reload: () => {},
      connect: (connectInfo?: chrome.runtime.ConnectInfo) => {
        const portName = connectInfo?.name ?? "default";
        const clientMsgListeners = new Set<(msg: unknown) => void>();
        const hostMsgListeners = new Set<(msg: unknown) => void>();
        const clientDisconnectListeners = new Set<() => void>();
        const hostDisconnectListeners = new Set<() => void>();

        const clientPort: chrome.runtime.Port = {
          name: portName,
          disconnect: () => {
            for (const fn of hostDisconnectListeners) fn();
          },
          postMessage: (msg: unknown) => {
            for (const fn of hostMsgListeners) fn(msg);
          },
          onMessage: {
            addListener: (fn: (msg: unknown) => void) =>
              clientMsgListeners.add(fn),
            removeListener: (fn: (msg: unknown) => void) =>
              clientMsgListeners.delete(fn),
            hasListener: (fn: (msg: unknown) => void) =>
              clientMsgListeners.has(fn),
          } as unknown as chrome.runtime.Port["onMessage"],
          onDisconnect: {
            addListener: (fn: () => void) => clientDisconnectListeners.add(fn),
            removeListener: (fn: () => void) =>
              clientDisconnectListeners.delete(fn),
            hasListener: (fn: () => void) => clientDisconnectListeners.has(fn),
          } as unknown as chrome.runtime.Port["onDisconnect"],
        };

        const hostPort: chrome.runtime.Port = {
          name: portName,
          sender: {
            id: extensionId,
            url: `chrome-extension://${extensionId}/sidepanel.html`,
          },
          disconnect: () => {
            for (const fn of clientDisconnectListeners) fn();
          },
          postMessage: (msg: unknown) => {
            for (const fn of clientMsgListeners) fn(msg);
          },
          onMessage: {
            addListener: (fn: (msg: unknown) => void) => hostMsgListeners.add(fn),
            removeListener: (fn: (msg: unknown) => void) =>
              hostMsgListeners.delete(fn),
            hasListener: (fn: (msg: unknown) => void) =>
              hostMsgListeners.has(fn),
          } as unknown as chrome.runtime.Port["onMessage"],
          onDisconnect: {
            addListener: (fn: () => void) => hostDisconnectListeners.add(fn),
            removeListener: (fn: () => void) =>
              hostDisconnectListeners.delete(fn),
            hasListener: (fn: () => void) => hostDisconnectListeners.has(fn),
          } as unknown as chrome.runtime.Port["onDisconnect"],
        };

        for (const fn of connectListeners) {
          fn(hostPort);
        }
        return clientPort;
      },
      onConnect: {
        addListener: (fn: (port: chrome.runtime.Port) => void) => {
          connectListeners.add(fn);
        },
        removeListener: (fn: (port: chrome.runtime.Port) => void) => {
          connectListeners.delete(fn);
        },
        hasListener: (fn: (port: chrome.runtime.Port) => void) =>
          connectListeners.has(fn),
      },
      onInstalled: {
        addListener: (fn: (details: chrome.runtime.InstalledDetails) => void) => {
          installedListeners.add(fn);
        },
        removeListener: (fn: (details: chrome.runtime.InstalledDetails) => void) => {
          installedListeners.delete(fn);
        },
        hasListener: (fn: (details: chrome.runtime.InstalledDetails) => void) =>
          installedListeners.has(fn),
      },
    },
    alarms: {
      create: (
        nameOrInfo: string | chrome.alarms.AlarmCreateInfo,
        alarmInfo?: chrome.alarms.AlarmCreateInfo,
      ) => {
        const name = typeof nameOrInfo === "string" ? nameOrInfo : "";
        const info = typeof nameOrInfo === "string" ? alarmInfo : nameOrInfo;
        const when =
          info?.when ??
          Date.now() +
            (info?.delayInMinutes ?? info?.periodInMinutes ?? 1) * 60_000;
        alarms.set(name, {
          name,
          scheduledTime: when,
          periodInMinutes: info?.periodInMinutes,
          delayInMinutes: info?.delayInMinutes,
        });
        return Promise.resolve();
      },
      get: (name: string, cb?: (alarm?: chrome.alarms.Alarm) => void) => {
        const found = alarms.get(name) as chrome.alarms.Alarm | undefined;
        cb?.(found);
        return Promise.resolve(found);
      },
      getAll: (cb?: (all: chrome.alarms.Alarm[]) => void) => {
        const all = Array.from(alarms.values()) as chrome.alarms.Alarm[];
        cb?.(all);
        return Promise.resolve(all);
      },
      clear: (name?: string, cb?: (wasCleared: boolean) => void) => {
        const target = name ?? "";
        const cleared = alarms.delete(target);
        cb?.(cleared);
        return Promise.resolve(cleared);
      },
      clearAll: (cb?: (wasCleared: boolean) => void) => {
        const had = alarms.size > 0;
        alarms.clear();
        cb?.(had);
        return Promise.resolve(had);
      },
      onAlarm: {
        addListener: (fn: (alarm: chrome.alarms.Alarm) => void) => {
          alarmListeners.add(fn);
        },
        removeListener: (fn: (alarm: chrome.alarms.Alarm) => void) => {
          alarmListeners.delete(fn);
        },
        hasListener: (fn: (alarm: chrome.alarms.Alarm) => void) =>
          alarmListeners.has(fn),
      },
    },
    tabs: {
      query: (
        queryInfo: chrome.tabs.QueryInfo,
        cb?: (tabs: chrome.tabs.Tab[]) => void,
      ) => {
        const matched = openedTabs.filter((t) => {
          if (queryInfo.active !== undefined && t.active !== queryInfo.active) {
            return false;
          }
          return true;
        }) as unknown as chrome.tabs.Tab[];
        cb?.(matched);
        return Promise.resolve(matched);
      },
      create: (
        props: chrome.tabs.CreateProperties,
        cb?: (tab: chrome.tabs.Tab) => void,
      ) => {
        if (props.active !== false) {
          for (const t of openedTabs) t.active = false;
        }
        const tab: OpenedTab = {
          id: nextTabId++,
          url: props.url,
          active: props.active ?? true,
          windowId: 1,
        };
        openedTabs.push(tab);
        const castTab = tab as unknown as chrome.tabs.Tab;
        cb?.(castTab);
        return Promise.resolve(castTab);
      },
      update: (
        tabIdOrProps: number | chrome.tabs.UpdateProperties,
        propsOrCb?: chrome.tabs.UpdateProperties | ((tab?: chrome.tabs.Tab) => void),
        cb?: (tab?: chrome.tabs.Tab) => void,
      ) => {
        const tabId =
          typeof tabIdOrProps === "number"
            ? tabIdOrProps
            : (openedTabs.find((t) => t.active)?.id ?? openedTabs[0]?.id ?? 1);
        const props =
          typeof tabIdOrProps === "number"
            ? (typeof propsOrCb === "object" ? propsOrCb : {})
            : tabIdOrProps;
        const callback =
          typeof propsOrCb === "function" ? propsOrCb : cb;
        const target = openedTabs.find((t) => t.id === tabId);
        if (target) {
          if (props.url !== undefined) target.url = props.url;
          if (props.active !== undefined) target.active = props.active;
        }
        const castTab = target as unknown as chrome.tabs.Tab | undefined;
        callback?.(castTab);
        return Promise.resolve(castTab);
      },
      sendMessage: (
        tabId: number,
        message: unknown,
        cb?: (response?: unknown) => void,
      ) => {
        sentMessages.push({ target: "tab", tabId, message });
        const resp = { ok: true };
        cb?.(resp);
        return Promise.resolve(resp);
      },
    },
    sidePanel: {
      setOptions: (
        _options: chrome.sidePanel.PanelOptions,
        cb?: () => void,
      ) => {
        cb?.();
        return Promise.resolve();
      },
      open: (_options: chrome.sidePanel.OpenOptions, cb?: () => void) => {
        cb?.();
        return Promise.resolve();
      },
      setPanelBehavior: (
        _behavior: chrome.sidePanel.PanelBehavior,
        cb?: () => void,
      ) => {
        cb?.();
        return Promise.resolve();
      },
    },
    action: {
      setBadgeText: (
        _details: chrome.action.BadgeTextDetails,
        cb?: () => void,
      ) => {
        cb?.();
        return Promise.resolve();
      },
      setBadgeBackgroundColor: (
        _details: chrome.action.BadgeColorDetails,
        cb?: () => void,
      ) => {
        cb?.();
        return Promise.resolve();
      },
    },
    notifications: {
      create: (
        idOrOptions: string | chrome.notifications.NotificationOptions,
        optionsOrCb?:
          | chrome.notifications.NotificationOptions
          | ((notificationId: string) => void),
        cb?: (notificationId: string) => void,
      ): Promise<string> => {
        const hasExplicitId = typeof idOrOptions === "string";
        const rawId = hasExplicitId ? idOrOptions : "";
        const rawOptions: chrome.notifications.NotificationOptions =
          hasExplicitId
            ? typeof optionsOrCb === "object" && optionsOrCb !== null
              ? optionsOrCb
              : {}
            : idOrOptions;
        const callback =
          typeof optionsOrCb === "function" ? optionsOrCb : cb;

        const id =
          rawId.trim().length > 0 ? rawId : `notif-${nextNotificationId++}`;
        const now = Date.now();
        const clonedOptions = cloneNotificationOptions(rawOptions);

        const existing = notifications.get(id);
        if (existing && !existing.cleared) {
          existing.cleared = true;
          existing.clearedAt = now;
          notificationEvents.push({
            type: "clear",
            id,
            wasCleared: true,
            timestamp: now,
          });
        }

        notifications.set(id, {
          id,
          options: clonedOptions,
          createdAt: now,
          cleared: false,
        });
        notificationEvents.push({
          type: "create",
          id,
          options: clonedOptions,
          timestamp: now,
        });

        callback?.(id);
        return Promise.resolve(id);
      },
      update: (
        notificationId: string,
        options: chrome.notifications.NotificationOptions,
        cb?: (wasUpdated: boolean) => void,
      ): Promise<boolean> => {
        const existing = notifications.get(notificationId);
        const wasUpdated = Boolean(existing && !existing.cleared);
        const now = Date.now();
        const clonedOptions = cloneNotificationOptions(options);
        if (existing && !existing.cleared) {
          existing.options = {
            ...existing.options,
            ...clonedOptions,
          };
          existing.updatedAt = now;
        }
        notificationEvents.push({
          type: "update",
          id: notificationId,
          options: clonedOptions,
          wasUpdated,
          timestamp: now,
        });
        cb?.(wasUpdated);
        return Promise.resolve(wasUpdated);
      },
      clear: (
        notificationId: string,
        cb?: (wasCleared: boolean) => void,
      ): Promise<boolean> => {
        const existing = notifications.get(notificationId);
        const wasCleared = Boolean(existing && !existing.cleared);
        const now = Date.now();
        if (existing && !existing.cleared) {
          existing.cleared = true;
          existing.clearedAt = now;
        }
        notificationEvents.push({
          type: "clear",
          id: notificationId,
          wasCleared,
          timestamp: now,
        });
        cb?.(wasCleared);
        return Promise.resolve(wasCleared);
      },
      getAll: (
        cb?: (activeNotifications: Record<string, true>) => void,
      ): Promise<Record<string, true>> => {
        const active: Record<string, true> = {};
        for (const [id, rec] of notifications.entries()) {
          if (!rec.cleared) {
            active[id] = true;
          }
        }
        cb?.(active);
        return Promise.resolve(active);
      },
      getPermissionLevel: (
        cb?: (level: "granted" | "denied") => void,
      ): Promise<"granted" | "denied"> => {
        const level: "granted" | "denied" = "granted";
        cb?.(level);
        return Promise.resolve(level);
      },
      onClicked: {
        addListener: (fn: (notificationId: string) => void) => {
          notificationClickListeners.add(fn);
        },
        removeListener: (fn: (notificationId: string) => void) => {
          notificationClickListeners.delete(fn);
        },
        hasListener: (fn: (notificationId: string) => void) =>
          notificationClickListeners.has(fn),
        hasListeners: () => notificationClickListeners.size > 0,
      },
      onClosed: {
        addListener: (fn: (notificationId: string, byUser: boolean) => void) => {
          notificationClosedListeners.add(fn);
        },
        removeListener: (
          fn: (notificationId: string, byUser: boolean) => void,
        ) => {
          notificationClosedListeners.delete(fn);
        },
        hasListener: (fn: (notificationId: string, byUser: boolean) => void) =>
          notificationClosedListeners.has(fn),
        hasListeners: () => notificationClosedListeners.size > 0,
      },
    },
  };

  const chromeTyped = mockChrome as unknown as typeof chrome;
  g.chrome = chromeTyped;

  const activeFetch = options.fetchHandler ?? createDefaultFetchHandler();
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    activeFetch(input, init)) as typeof fetch;

  return {
    chrome: chromeTyped,
    storageData,
    alarms,
    openedTabs,
    sentMessages,
    notifications,
    notificationEvents,
    triggerAlarm: async (name: string) => {
      const alarm =
        alarms.get(name) ??
        ({ name, scheduledTime: Date.now() } as RecordedAlarm);
      for (const fn of alarmListeners) {
        await fn(alarm as chrome.alarms.Alarm);
      }
    },
    triggerNotificationClick: async (id: string) => {
      notificationEvents.push({
        type: "click",
        id,
        timestamp: Date.now(),
      });
      for (const fn of Array.from(notificationClickListeners)) {
        await (fn as (notificationId: string) => unknown)(id);
      }
    },
    triggerRuntimeMessage: async (
      message: unknown,
      sender: chrome.runtime.MessageSender = {
        id: extensionId,
        url: `chrome-extension://${extensionId}/sidepanel.html`,
      },
    ) => {
      return new Promise((resolve) => {
        let settled = false;
        const sendResponse = (resp?: unknown) => {
          if (settled) return;
          settled = true;
          resolve(resp);
        };
        let isAsync = false;
        for (const fn of runtimeMessageListeners) {
          if (fn(message, sender, sendResponse) === true) {
            isAsync = true;
          }
        }
        if (!settled && !isAsync) {
          resolve(undefined);
        }
      });
    },
    restore: () => {
      if (hadChrome) {
        g.chrome = prevChrome;
      } else {
        delete g.chrome;
      }
      if (hadFetch) {
        g.fetch = prevFetch;
      } else {
        delete g.fetch;
      }
    },
  };
}

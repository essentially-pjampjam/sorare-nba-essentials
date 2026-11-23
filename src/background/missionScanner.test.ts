import { afterEach, describe, expect, it } from "vitest";
import { mergeMissionSnapshots, readPickerTasksFromPage } from "./missionScanner";

type ApolloCache = Record<string, Record<string, unknown>>;

function mockSorarePage(pathname: string, cache: ApolloCache) {
  (globalThis as unknown as { window: unknown }).window = {
    __APOLLO_CLIENT__: {
      cache: {
        extract: () => cache,
      },
    },
  };
  (globalThis as unknown as { location: unknown }).location = { pathname };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { location?: unknown }).location;
});

describe("missionScanner readPickerTasksFromPage", () => {
  it("confirms Set Daily Picker as submitted when appearances are present even with OPEN state", () => {
    mockSorarePage("/nba/series/play", {
      "DecisivePlayerPickerTask:set-1": {
        __typename: "DecisivePlayerPickerTask",
        title: "Daily Picker",
        description: "Pick 1 Common player",
        mode: "common",
        taskConfigSlug: "set-daily-picker",
        maxAppearancesCount: 1,
        aasmState: "OPEN",
        expired: false,
        appearances: [{ __ref: "Appearance:1" }],
        pickableGames: [{ __ref: "Game:1" }, { __ref: "Game:2" }],
      },
    });

    const res = readPickerTasksFromPage();
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.mode).toBe("set");
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0]?.pickedCount).toBe(1);
    expect(res.tasks[0]?.submitted).toBe(true);
  });

  it("does NOT false-positive on pickableGames or availableCards when no picks are set", () => {
    mockSorarePage("/nba/play/missions/play/limited", {
      "DecisivePlayerPickerTask:pro-1": {
        __typename: "DecisivePlayerPickerTask",
        title: "Daily Picker",
        description: "Classic: Pick 3 players for 100 XP",
        mode: "limited",
        taskConfigSlug: "pro-daily-picker",
        maxAppearancesCount: 3,
        aasmState: "OPEN",
        expired: false,
        pickableGames: [{ __ref: "Game:1" }, { __ref: "Game:2" }, { __ref: "Game:3" }],
        availableCards: [{ __ref: "Card:1" }, { __ref: "Card:2" }, { __ref: "Card:3" }],
      },
    });

    const res = readPickerTasksFromPage();
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.mode).toBe("pro");
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0]?.submitted).toBeUndefined();
    expect(res.tasks[0]?.pickedCount).toBeUndefined();
  });

  it("confirms Pro Daily Picker via linked TaskLineup appearances", () => {
    mockSorarePage("/nba/play/missions/play/limited", {
      "TaskLineup:pro-lineup-1": {
        __typename: "TaskLineup",
        appearances: [{ __ref: "A:1" }, { __ref: "A:2" }, { __ref: "A:3" }],
      },
      "DecisivePlayerPickerTask:pro-2": {
        __typename: "DecisivePlayerPickerTask",
        title: "Playmaker Picker",
        description: "Limited: 3 picks",
        mode: "limited",
        taskConfigSlug: "playmaker-picker",
        maxAppearancesCount: 3,
        aasmState: "IN_PROGRESS",
        expired: false,
        myLineup: { __ref: "TaskLineup:pro-lineup-1" },
      },
    });

    const res = readPickerTasksFromPage();
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.tasks[0]?.pickedCount).toBe(3);
    expect(res.tasks[0]?.submitted).toBe(true);
  });

  it("extracts non-picker Set daily missions and detects Set Daily Solo lineup while ignoring Squad", () => {
    mockSorarePage("/nba/series/play", {
      "CurrentUser:me": { slug: "pjampjam" },
      "User:me": { slug: "pjampjam" },
      "Leaderboard:solo": { slug: "set-daily-solo", displayName: "Daily Solo" },
      "Leaderboard:squad": { slug: "set-squad", displayName: "Squad" },
      "TaskLineup:squad-1": {
        __typename: "TaskLineup",
        user: { __ref: "User:me" },
        leaderboard: { __ref: "Leaderboard:squad" },
        appearances: [{ __ref: "A:1" }, { __ref: "A:2" }, { __ref: "A:3" }, { __ref: "A:4" }, { __ref: "A:5" }],
      },
      "TaskLineup:solo-1": {
        __typename: "TaskLineup",
        user: { __ref: "User:me" },
        leaderboard: { __ref: "Leaderboard:solo" },
        appearances: [{ __ref: "B:1" }, { __ref: "B:2" }, { __ref: "B:3" }, { __ref: "B:4" }, { __ref: "B:5" }],
      },
      "GenericTask:daily-1": {
        __typename: "PlayTask",
        title: "Daily Scrap Mission",
        description: "Scrap 2 duplicate Common cards today",
        taskConfigSlug: "daily-scrap-2",
        period: "DAILY",
        aasmState: "OPEN",
        progress: 1,
        target: 2,
        expired: false,
      },
      "CollectionTask:season-1": {
        __typename: "CollectionTask",
        title: "Draft 26 Collection",
        description: "Collect 12 Draft 26 rookies",
        taskConfigSlug: "draft-26-collect",
        aasmState: "OPEN",
        progress: 10,
        target: 12,
        expired: false,
      },
    });

    const res = readPickerTasksFromPage();
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.setSoloSubmitted).toBe(true);
    expect(res.dailyMissions).toHaveLength(1);
    expect(res.dailyMissions[0]?.slug).toBe("daily-scrap-2");
    expect(res.dailyMissions[0]?.progress).toBe(1);
    expect(res.dailyMissions[0]?.target).toBe(2);
    expect(res.dailyMissions[0]?.completed).toBe(false);
  });

  it("confirms 1-pick Set Daily Picker via single-object selectedPlayer ref and 3-pick Pro Picker via TaskLineup submittedAt", () => {
    mockSorarePage("/nba/series/play", {
      "DecisivePlayerPickerTask:set-single": {
        __typename: "DecisivePlayerPickerTask",
        title: "Daily Picker",
        description: "Pick 1 Common player",
        mode: "common",
        taskConfigSlug: "set-daily-picker",
        maxAppearancesCount: 1,
        aasmState: "OPEN",
        expired: false,
        selectedPlayer: { __ref: "Player:nikola-jokic" },
      },
    });
    const setRes = readPickerTasksFromPage();
    expect("error" in setRes).toBe(false);
    if (!("error" in setRes)) {
      expect(setRes.tasks[0]?.pickedCount).toBe(1);
      expect(setRes.tasks[0]?.submitted).toBe(true);
    }

    mockSorarePage("/nba/play/missions/play/limited", {
      "TaskLineup:pro-submitted": {
        __typename: "TaskLineup",
        submittedAt: "2026-11-23T18:00:00Z",
      },
      "DecisivePlayerPickerTask:pro-3": {
        __typename: "DecisivePlayerPickerTask",
        title: "Daily Picker",
        description: "Limited: Pick 3 players",
        mode: "limited",
        taskConfigSlug: "pro-daily-picker",
        maxAppearancesCount: 3,
        aasmState: "OPEN",
        expired: false,
        myLineup: { __ref: "TaskLineup:pro-submitted" },
      },
    });
    const proRes = readPickerTasksFromPage();
    expect("error" in proRes).toBe(false);
    if (!("error" in proRes)) {
      expect(proRes.tasks[0]?.submitted).toBe(true);
    }
  });

  it("mergeMissionSnapshots merges same-day tasks across sub-pages without clobbering submitted flags and resets after 07:00 UTC", () => {
    const todayNoon = Date.UTC(2026, 10, 23, 12, 0, 0);
    const prev = {
      mode: "pro" as const,
      tasks: [
        {
          title: "Limited Daily Picker",
          description: "Limited: 3 picks",
          mode: "limited",
          slug: "limited-picker",
          picks: 3,
          state: "OPEN",
          pickedCount: 3,
          submitted: true,
        },
      ],
      dailyMissions: [
        {
          title: "Daily Pro Mission",
          description: "Win 1 matchup",
          slug: "daily-pro-1",
          state: "COMPLETED",
          progress: 1,
          target: 1,
          completed: true,
        },
      ],
      scannedAt: todayNoon - 30 * 60_000,
    };

    const merged = mergeMissionSnapshots(
      prev,
      {
        mode: "pro",
        tasks: [
          {
            title: "Rare Daily Picker",
            description: "Rare: 3 picks",
            mode: "rare",
            slug: "rare-picker",
            picks: 3,
            state: "OPEN",
          },
        ],
        dailyMissions: [],
        setSoloSubmitted: null,
      },
      todayNoon,
    );

    expect(merged.tasks).toHaveLength(2);
    expect(merged.tasks.find((t) => t.slug === "limited-picker")?.submitted).toBe(true);
    expect(merged.tasks.find((t) => t.slug === "rare-picker")).toBeDefined();
    expect(merged.dailyMissions).toHaveLength(1);

    // After next day's 07:00 UTC reset, yesterday's tasks should be dropped.
    const nextDayNoon = Date.UTC(2026, 10, 24, 12, 0, 0);
    const resetMerged = mergeMissionSnapshots(
      merged,
      {
        mode: "pro",
        tasks: [
          {
            title: "Fresh Picker",
            description: "Limited: 3 picks",
            mode: "limited",
            slug: "fresh-picker",
            picks: 3,
            state: "OPEN",
          },
        ],
        dailyMissions: [],
        setSoloSubmitted: null,
      },
      nextDayNoon,
    );
    expect(resetMerged.tasks.map((t) => t.slug)).toEqual(["fresh-picker"]);
    expect(resetMerged.dailyMissions).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  buildDailyChecklistItems,
  isDailyMissionDone,
  isPickerTaskDone,
  isTaskCompletedState,
  lastDailyResetMs,
  resolveManualCompletions,
  toggleManualCompletion,
} from "./dailyChecklistMath";

const NOW = Date.UTC(2026, 10, 23, 15, 0, 0); // 15:00 UTC
const RESET_TODAY = Date.UTC(2026, 10, 23, 7, 0, 0);
const BEFORE_RESET = Date.UTC(2026, 10, 23, 5, 30, 0);
const RESET_YESTERDAY = Date.UTC(2026, 10, 22, 7, 0, 0);

describe("dailyChecklistMath", () => {
  it("computes the 07:00 UTC daily reset boundary accurately", () => {
    expect(lastDailyResetMs(NOW)).toBe(RESET_TODAY);
    expect(lastDailyResetMs(BEFORE_RESET)).toBe(RESET_YESTERDAY);
  });

  it("recognizes completed and submitted Sorare task states", () => {
    expect(isTaskCompletedState("CLAIMED")).toBe(true);
    expect(isTaskCompletedState("SUBMITTED")).toBe(true);
    expect(isTaskCompletedState("awaiting_results")).toBe(true);
    expect(isTaskCompletedState("PENDING_RESULT")).toBe(true);
    expect(isTaskCompletedState("CLAIMABLE")).toBe(true);
    expect(isTaskCompletedState("OPEN")).toBe(false);
    expect(isTaskCompletedState("IN_PROGRESS")).toBe(false);
    expect(isTaskCompletedState("")).toBe(false);
  });

  it("confirms a picker as done when picks are submitted even if aasmState is still OPEN", () => {
    expect(
      isPickerTaskDone({
        title: "Daily Picker",
        description: "Pick 3 players",
        mode: "limited",
        slug: "pro-daily-picker",
        picks: 3,
        state: "OPEN",
        pickedCount: 3,
      }),
    ).toBe(true);

    expect(
      isPickerTaskDone({
        title: "Set Daily Picker",
        description: "Pick 1 player",
        mode: "common",
        slug: "set-daily-picker",
        picks: 1,
        state: "IN_PROGRESS",
        submitted: true,
      }),
    ).toBe(true);

    expect(
      isPickerTaskDone({
        title: "Daily Picker",
        description: "Pick 3 players",
        mode: "limited",
        slug: "pro-daily-picker",
        picks: 3,
        state: "IN_PROGRESS",
        pickedCount: 1,
      }),
    ).toBe(false);
  });

  it("confirms general daily missions via progress/target, completed flag, or state", () => {
    expect(
      isDailyMissionDone({
        title: "Win 1 Daily Solo step",
        description: "",
        slug: "solo-step",
        state: "OPEN",
        progress: 1,
        target: 1,
        completed: false,
      }),
    ).toBe(true);

    expect(
      isDailyMissionDone({
        title: "Buy 2 packs",
        description: "",
        slug: "buy-2",
        state: "OPEN",
        progress: 1,
        target: 2,
        completed: false,
      }),
    ).toBe(false);
  });

  it("routes Free Daily Pack to Set Daily Solo (/nba/series/play), not Shop/Packs", () => {
    const items = buildDailyChecklistItems({
      shopStatus: {
        dailyPackClaimed: false,
        bronzePlusProgress: null,
        bronzePlusTarget: null,
        scannedAt: NOW - 60_000,
      },
      pickerMissions: {},
      nowMs: NOW,
    });
    const pack = items.find((i) => i.id === "set_daily_pack");
    expect(pack).toBeDefined();
    expect(pack?.url).toBe("https://sorare.com/nba/series/play");
    expect(pack?.subTab).toBe("solo_squad");
    expect(pack?.sub).toContain("Daily Solo");
    expect(pack?.done).toBe(false);
  });

  it("tracks Set Daily Solo, Set & Pro Daily Pickers, and non-picker Daily Missions without duplicates", () => {
    const items = buildDailyChecklistItems({
      shopStatus: {
        dailyPackClaimed: true,
        bronzePlusProgress: 2,
        bronzePlusTarget: 5,
        scannedAt: NOW - 30_000,
      },
      pickerMissions: {
        set: {
          mode: "set",
          scannedAt: NOW - 20_000,
          setSoloSubmitted: true,
          tasks: [
            {
              title: "Set Daily Picker",
              description: "1 Common pick",
              mode: "common",
              slug: "set-picker",
              picks: 1,
              state: "OPEN",
              pickedCount: 1,
              submitted: true,
            },
          ],
          dailyMissions: [
            {
              title: "Claim your Free Daily Pack",
              description: "Daily pack",
              slug: "common-daily-claim",
              state: "CLAIMED",
              progress: 1,
              target: 1,
              completed: true,
            },
            {
              title: "Enter a Daily Solo lineup",
              description: "Set Solo",
              slug: "daily-solo-entry",
              state: "COMPLETED",
              progress: 1,
              target: 1,
              completed: true,
            },
            {
              title: "Scrap 2 duplicate cards",
              description: "Earn Essence",
              slug: "daily-scrap-2",
              state: "OPEN",
              progress: 1,
              target: 2,
              completed: false,
            },
          ],
        },
        pro: {
          mode: "pro",
          scannedAt: NOW - 15_000,
          tasks: [
            {
              title: "Pro Daily Picker",
              description: "Limited: 3 picks",
              mode: "limited",
              slug: "pro-picker",
              picks: 3,
              state: "IN_PROGRESS",
              pickedCount: 2,
              submitted: false,
            },
          ],
          dailyMissions: [
            {
              title: "Score 150 pts in Pro",
              description: "Pro daily quest",
              slug: "pro-daily-150",
              state: "CLAIMED",
              progress: 150,
              target: 150,
              completed: true,
            },
          ],
        },
      },
      nowMs: NOW,
    });

    expect(items.find((i) => i.id === "set_daily_pack")?.done).toBe(true);
    expect(items.find((i) => i.id === "set_daily_solo")?.done).toBe(true);
    expect(items.find((i) => i.id === "set_task_set-picker")?.done).toBe(true);
    expect(items.find((i) => i.id === "set_mission_daily-scrap-2")?.done).toBe(false);
    expect(items.find((i) => i.id === "set_mission_daily-scrap-2")?.sub).toBe("1/2 • Earn Essence");
    // Daily Pack and Daily Solo missions must not be duplicated into extra rows
    expect(items.find((i) => i.id === "set_mission_common-daily-claim")).toBeUndefined();
    expect(items.find((i) => i.id === "set_mission_daily-solo-entry")).toBeUndefined();

    const proPicker = items.find((i) => i.id === "pro_task_pro-picker");
    expect(proPicker?.done).toBe(false);
    expect(proPicker?.sub).toBe("2/3 picked today");
    expect(items.find((i) => i.id === "pro_mission_pro-daily-150")?.done).toBe(true);
  });

  it("supports manual check-off for mobile completions and auto-resets at 07:00 UTC", () => {
    let manual = toggleManualCompletion(null, "set_daily_pack", true, NOW);
    manual = toggleManualCompletion(manual, "pro_daily_picker_default", true, NOW);

    const todayItems = buildDailyChecklistItems({
      shopStatus: null,
      pickerMissions: {},
      manualState: manual,
      nowMs: NOW,
    });
    const pack = todayItems.find((i) => i.id === "set_daily_pack");
    expect(pack?.done).toBe(true);
    expect(pack?.manualDone).toBe(true);
    expect(pack?.sub).toBe("Marked done (manual)");

    // Unchecking restores pending state
    const unchecked = toggleManualCompletion(manual, "set_daily_pack", false, NOW);
    expect(resolveManualCompletions(unchecked, RESET_TODAY).set_daily_pack).toBeUndefined();

    // Next day after 07:00 UTC automatically clears yesterday's manual check-offs
    const tomorrow = NOW + 24 * 3600_000;
    const tomorrowItems = buildDailyChecklistItems({
      shopStatus: null,
      pickerMissions: {},
      manualState: manual,
      nowMs: tomorrow,
    });
    expect(tomorrowItems.find((i) => i.id === "set_daily_pack")?.done).toBe(false);
  });
});

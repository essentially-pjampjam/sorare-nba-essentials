import { describe, expect, it } from "vitest";
import type { PageLineup, PageLineupSnapshot } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { findPreLockLineupRisks } from "../calculators/alertTrackerMath";
import { runAlertTracker } from "./alertTracker";
import { isFullLineupsOverviewUrl, mergePageLineups, openPageLineupsAsEntries } from "./lineupScanner";
import { isEncryptedSecret } from "./secretStore";
import { isSpecialPackSlug } from "./shopScanner";

function makeLineup(overrides: Partial<PageLineup> = {}): PageLineup {
  return {
    id: "lu-1",
    name: "Contender #1",
    leaderboardSlug: "nba-contender",
    leaderboardName: "Contender",
    fixtureSlug: "nba-gw-10",
    fixtureName: "Game Week 10",
    fixtureState: "opened",
    cutOffDate: "2026-11-25T00:00:00Z",
    endDate: "2026-12-01T00:00:00Z",
    cardSlugs: ["card-a", "card-b"],
    playerNames: ["Player A", "Player B"],
    rank: null,
    liveProjectedRank: null,
    score: null,
    totalEntries: 1000,
    canEdit: true,
    ...overrides,
  };
}

describe("lineupScanner mergePageLineups & URL classification", () => {
  it("recognizes full /nba/lineups overview URLs vs partial board URLs", () => {
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/lineups")).toBe(true);
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/lineups/arena/nba-21-23-nov-2026")).toBe(true);
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/play/boards/arena/cash/nba-21-23-nov-2026")).toBe(false);
    expect(isFullLineupsOverviewUrl("https://sorare.com/nba/series/play")).toBe(false);
    expect(isFullLineupsOverviewUrl(undefined)).toBe(false);
  });

  it("replaces the whole Game Week on full overview pages so deleted lineups disappear", () => {
    const prev: PageLineupSnapshot = {
      userSlug: "pjampjam",
      scannedAt: 1000,
      lineups: [
        makeLineup({ id: "lu-1", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-2", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-prev-week", fixtureSlug: "nba-gw-11" }),
      ],
    };
    const next = mergePageLineups(
      prev,
      { userSlug: "pjampjam", lineups: [makeLineup({ id: "lu-1", name: "Updated #1", fixtureSlug: "nba-gw-10" })] },
      2000,
      true,
    );
    expect(next.lineups.map((l) => l.id).sort()).toEqual(["lu-1", "lu-prev-week"]);
    expect(next.lineups.find((l) => l.id === "lu-1")?.name).toBe("Updated #1");
  });

  it("upserts by id on partial pages so sibling lineups in the same Game Week are preserved", () => {
    const prev: PageLineupSnapshot = {
      userSlug: "pjampjam",
      scannedAt: 1000,
      lineups: [
        makeLineup({ id: "lu-1", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-2", fixtureSlug: "nba-gw-10" }),
        makeLineup({ id: "lu-3", fixtureSlug: "nba-gw-10" }),
      ],
    };
    const next = mergePageLineups(
      prev,
      { userSlug: "pjampjam", lineups: [makeLineup({ id: "lu-2", name: "Edited #2", fixtureSlug: "nba-gw-10" })] },
      2000,
      false,
    );
    expect(next.lineups.map((l) => l.id).sort()).toEqual(["lu-1", "lu-2", "lu-3"]);
    expect(next.lineups.find((l) => l.id === "lu-2")?.name).toBe("Edited #2");
  });

  it("preserves teamSlugs from PageLineup into CurrentLineupEntry so 0G pre-lock risk detection works without a gallery load", () => {
    const snap: PageLineupSnapshot = {
      userSlug: "pjampjam",
      scannedAt: 3000,
      lineups: [
        makeLineup({
          id: "lu-teams",
          cardSlugs: ["c-1", "c-2"],
          playerNames: ["Luka Doncic", "Victor Wembanyama"],
          teamSlugs: ["dallas-mavericks", "san-antonio-spurs"],
        }),
      ],
    };
    const entries = openPageLineupsAsEntries(snap);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.teamSlugs).toEqual(["dallas-mavericks", "san-antonio-spurs"]);

    const risks = findPreLockLineupRisks(
      entries,
      [], // empty gallery (not loaded yet)
      {},
      { "dallas-mavericks": 2, "san-antonio-spurs": 0 },
    );
    expect(risks.flagged).toEqual(["Victor Wembanyama (0G)"]);
    expect(risks.affectedLineupIds).toEqual(["page:lu-teams"]);
  });

  it("runAlertTracker reads page_lineups_v1 and synthesizes the open fixture when no gallery snapshot exists yet", async () => {
    const store: Record<string, unknown> = {
      page_lineups_v1: {
        userSlug: "pjampjam",
        scannedAt: 3000,
        lineups: [
          makeLineup({
            id: "lu-page-only",
            fixtureSlug: "nba-gw-12",
            fixtureName: "Game Week 12",
            fixtureState: "opened",
            cutOffDate: "2026-11-23T01:00:00Z",
            cardSlugs: ["c-1", "c-2"],
            playerNames: ["Luka Doncic", "Victor Wembanyama"],
            teamSlugs: ["dallas-mavericks", "san-antonio-spurs"],
          }),
        ],
      } satisfies PageLineupSnapshot,
    };
    const prevChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.map((k) => [k, store[k]]));
          },
          set: async (patch: Record<string, unknown>) => {
            Object.assign(store, patch);
          },
        },
      },
    };
    try {
      const nowMs = Date.parse("2026-11-23T00:30:00Z"); // 30m before cutOffDate
      const events = await runAlertTracker(
        {
          ...DEFAULT_SETTINGS,
          username: "pjampjam",
          alertsEnabled: true,
          cutoffReminderEnabled: true,
        },
        {
          "victor wembanyama": {
            playerName: "Victor Wembanyama",
            normalizedName: "victor wembanyama",
            teamName: "San Antonio Spurs",
            status: "OUT",
            rawStatus: "Out",
            comment: "Rest",
          },
        },
        nowMs,
      );
      const cutoffEvent = events.find((e) => e.kind === "gw_cutoff");
      expect(cutoffEvent).toBeDefined();
      expect(cutoffEvent?.title).toContain("1 lineup risk");
      expect(cutoffEvent?.message).toContain("Victor Wembanyama (OUT)");
      expect(cutoffEvent?.lineupIds).toEqual(["page:lu-page-only"]);
    } finally {
      (globalThis as { chrome?: unknown }).chrome = prevChrome;
    }
  });
});

describe("shopScanner isSpecialPackSlug", () => {
  it("recognizes special packs across both divination and future <set>-nba- prefixes while filtering standard and Live Today packs", () => {
    expect(isSpecialPackSlug("divination-nba-emirates-cup-platinum")).toBe(true);
    expect(isSpecialPackSlug("hoops-nba-all-star-special-pack")).toBe(true);
    expect(isSpecialPackSlug("genesis27-nba-playoffs-pack")).toBe(true);

    expect(isSpecialPackSlug("divination-nba-bronze-pack")).toBe(false);
    expect(isSpecialPackSlug("hoops-nba-gold-pack")).toBe(false);
    expect(isSpecialPackSlug("divination-nba-silver-live-today-2026-11-22")).toBe(false);
    expect(isSpecialPackSlug("hoops-nba-bronze-live-today-2027-01-15")).toBe(false);
    expect(isSpecialPackSlug("divination-nba-daily-free")).toBe(false);
  });
});

describe("secretStore isEncryptedSecret", () => {
  it("requires version 1 and both iv and ct strings", () => {
    expect(isEncryptedSecret({ v: 1, iv: "abc", ct: "xyz" })).toBe(true);
    expect(isEncryptedSecret({ v: 1, ct: "xyz" })).toBe(false);
    expect(isEncryptedSecret({ v: 1, iv: 123, ct: "xyz" })).toBe(false);
    expect(isEncryptedSecret({ v: 2, iv: "abc", ct: "xyz" })).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
  });
});

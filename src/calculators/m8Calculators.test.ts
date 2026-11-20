import { describe, expect, it } from "vitest";
import { pickCurrentSquadStep, summarizeSquadActivity } from "./squadActivityMath";
import type { SquadSnapshot } from "../shared/types";

const u = (slug: string) => ({ slug, nickname: slug.toUpperCase() });

const snapshot: SquadSnapshot = {
  squadName: "Lazy Goats",
  membersCount: 4,
  maxMembersCount: 10,
  captainSlug: "cap",
  members: [u("cap"), u("me"), u("ghost"), u("busy")],
  steps: [
    { state: "CLAIMED", target: 450, totalLineups: 3, minimumLineups: 3, totalScore: 539, lineupUsers: [u("cap"), u("me"), u("busy")] },
    { state: "LIVE", target: 650, totalLineups: 2, minimumLineups: 3, totalScore: 411.7, lineupUsers: [u("cap"), u("me")] },
    { state: "LOCKED", target: 730, totalLineups: 0, minimumLineups: 3, totalScore: 0, lineupUsers: [] },
  ],
  scannedAt: 0,
};

describe("squad activity", () => {
  it("picks the LIVE stage", () => {
    expect(pickCurrentSquadStep(snapshot.steps)?.target).toBe(650);
  });

  it("flags members with no team in the live stage, least active first", () => {
    const s = summarizeSquadActivity(snapshot, "me");
    expect(s.missing.map((m) => m.slug)).toEqual(["ghost", "busy"]);
    expect(s.teamsNeededToStart).toBe(1);
    expect(s.pointsToTarget).toBe(238.3);
    expect(s.progressPct).toBe(63);
    expect(s.members.find((m) => m.slug === "me")?.isMe).toBe(true);
    expect(s.members.find((m) => m.slug === "cap")?.isCaptain).toBe(true);
    expect(s.members.find((m) => m.slug === "busy")?.stagesSeen).toBe(2);
    expect(s.counting.map((m) => m.slug)).toEqual(["cap", "me"]);
    expect(s.members[0].liveRank).toBe(1);
  });

  it("counts only the best teams (Sorare lists them best first)", () => {
    const live = { state: "LIVE", target: 650, totalLineups: 4, minimumLineups: 3, totalScore: 558, lineupUsers: [u("cap"), u("busy"), u("me"), u("ghost")] };
    const s = summarizeSquadActivity({ ...snapshot, steps: [live] }, "me");
    expect(s.counting.map((m) => m.slug)).toEqual(["cap", "busy", "me"]);
    expect(s.members.find((m) => m.slug === "ghost")?.counting).toBe(false);
    expect(s.pointsToTarget).toBe(92);
    expect(s.pointsPerCountingTeam).toBe(30.7);
  });

  it("infers members from lineups when the member list was not loaded", () => {
    const s = summarizeSquadActivity({ ...snapshot, members: [] }, null);
    expect(s.membersInferred).toBe(true);
    expect(s.members.map((m) => m.slug).sort()).toEqual(["busy", "cap", "me"]);
  });
});

import { analyzePack, buildPackAdvice, tierStars } from "./packAdvisorMath";
import type { SetPackInfo } from "../shared/types";

describe("pack advisor (live Bronze odds, 2026-11-20)", () => {
  const bronze: SetPackInfo = {
    slug: "divination-nba-bronze-pack",
    title: "Bronze",
    price: 1000,
    currency: "COMMON_ESSENCE",
    category: null,
    endDate: null,
    cardsCount: 4,
    slots: [
      [
        { tier: "ROSTER_PLUS", basisPoints: 450 },
        { tier: "ROSTER", basisPoints: 2550 },
        { tier: "RESERVE_PLUS", basisPoints: 1050 },
        { tier: "RESERVE", basisPoints: 5950 },
      ],
      [
        { tier: "GOAT", basisPoints: 10 },
        { tier: "STAR_PLUS", basisPoints: 40 },
        { tier: "STAR", basisPoints: 150 },
        { tier: "IMPACT_PLUS", basisPoints: 276 },
        { tier: "IMPACT", basisPoints: 1564 },
        { tier: "ROSTER_PLUS", basisPoints: 1194 },
        { tier: "ROSTER", basisPoints: 6766 },
      ],
    ],
  };

  it("maps tiers to stars", () => {
    expect(tierStars("GOAT")).toBe(5);
    expect(tierStars("IMPACT_PLUS")).toBe(3.5);
    expect(tierStars("RESERVE")).toBe(1);
  });

  it("computes 3★+ / 4★+ chances and affordability", () => {
    const a = analyzePack(bronze, 23);
    expect(a.chance3StarPct).toBe(20.4);
    expect(a.chance4StarPct).toBe(2);
    expect(a.affordable).toBe(false);
    expect(a.lastSlotTop[0]).toEqual({ label: "Icon", pct: 0.1 });
  });

  it("puts the free Daily Pack first and shows Bronze+ progress", () => {
    const advice = buildPackAdvice(
      [analyzePack(bronze, 23)],
      { dailyPackClaimed: false, bronzePlusProgress: 6, bronzePlusTarget: 10, scannedAt: 0 },
      23,
      0,
    );
    expect(advice[0].kind).toBe("daily");
    expect(advice.find((x) => x.kind === "bronze_plus")?.text).toContain("4 more packs");
    expect(advice.some((x) => x.kind === "essence")).toBe(true);
  });
});

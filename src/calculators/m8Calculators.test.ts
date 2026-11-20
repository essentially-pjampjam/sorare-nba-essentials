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
  });

  it("infers members from lineups when the member list was not loaded", () => {
    const s = summarizeSquadActivity({ ...snapshot, members: [] }, null);
    expect(s.membersInferred).toBe(true);
    expect(s.members.map((m) => m.slug).sort()).toEqual(["busy", "cap", "me"]);
  });
});

import type { SquadSnapshot, SquadStepSnapshot } from "../shared/types";

export interface SquadMemberActivity {
  slug: string;
  nickname: string;
  isCaptain: boolean;
  isMe: boolean;
  /** Has a team in the live (current) stage. */
  activeNow: boolean;
  /** 1-based rank in the live stage (Sorare lists teams best first), null without a team. */
  liveRank: number | null;
  /** One of the best teams whose scores add up to the stage total. */
  counting: boolean;
  /** Stages (of those Sorare loaded) this member played in. */
  stagesPlayed: number;
  stagesSeen: number;
}

export interface SquadActivitySummary {
  squadName: string;
  membersCount: number;
  maxMembersCount: number;
  current: SquadStepSnapshot | null;
  /** Members whose teams count toward the stage total (Sorare: sum of the best `minimumLineups` teams). */
  counting: SquadMemberActivity[];
  /** Average points per counting team still needed to reach the target. */
  pointsPerCountingTeam: number;
  /** Teams still needed before the stage counts (minimumLineupsToStartStep). */
  teamsNeededToStart: number;
  pointsToTarget: number;
  progressPct: number;
  members: SquadMemberActivity[];
  /** Members with no team in the live stage (sorted: least active first). */
  missing: SquadMemberActivity[];
  /** True when Sorare's member list was not loaded and members were inferred from lineups. */
  membersInferred: boolean;
}

/** Current stage = the LIVE one, else the last not-yet-claimed one, else the last stage. */
export function pickCurrentSquadStep(steps: SquadStepSnapshot[]): SquadStepSnapshot | null {
  if (steps.length === 0) return null;
  return (
    steps.find((s) => s.state === "LIVE") ??
    steps.find((s) => s.state !== "CLAIMED" && s.state !== "FAILED" && s.state !== "LOCKED") ??
    steps[steps.length - 1]
  );
}

/** Who played the live squad stage, who hasn't set a team yet, and how far the squad is from its target. */
export function summarizeSquadActivity(snapshot: SquadSnapshot, mySlug: string | null): SquadActivitySummary {
  const current = pickCurrentSquadStep(snapshot.steps);
  const known = new Map(snapshot.members.map((m) => [m.slug, m.nickname]));
  const membersInferred = snapshot.members.length === 0;
  if (membersInferred) {
    for (const step of snapshot.steps) {
      for (const u of step.lineupUsers) if (!known.has(u.slug)) known.set(u.slug, u.nickname);
    }
  }
  const activeNow = new Set(current?.lineupUsers.map((u) => u.slug) ?? []);
  const liveOrder = current?.lineupUsers.map((u) => u.slug) ?? [];
  const countN = current?.minimumLineups ?? 3;
  // Future stages (LOCKED) have no teams yet: count only stages that were played or are live.
  const playedSteps = snapshot.steps.filter((s) => s.state !== "LOCKED");
  const me = mySlug?.toLowerCase() ?? null;

  const members: SquadMemberActivity[] = Array.from(known.entries()).map(([slug, nickname]) => ({
    slug,
    nickname,
    isCaptain: slug === snapshot.captainSlug,
    isMe: me !== null && slug.toLowerCase() === me,
    activeNow: activeNow.has(slug),
    liveRank: liveOrder.indexOf(slug) >= 0 ? liveOrder.indexOf(slug) + 1 : null,
    counting: liveOrder.indexOf(slug) >= 0 && liveOrder.indexOf(slug) < countN,
    stagesPlayed: playedSteps.filter((s) => s.lineupUsers.some((u) => u.slug === slug)).length,
    stagesSeen: playedSteps.length,
  }));
  members.sort(
    (a, b) =>
      (a.liveRank ?? 99) - (b.liveRank ?? 99) || b.stagesPlayed - a.stagesPlayed || a.nickname.localeCompare(b.nickname),
  );

  const missing = members
    .filter((m) => !m.activeNow)
    .sort((a, b) => a.stagesPlayed - b.stagesPlayed || a.nickname.localeCompare(b.nickname));

  const target = current?.target ?? 0;
  const score = current?.totalScore ?? 0;
  const counting = members.filter((m) => m.counting);
  const pointsToTarget = Math.max(0, Math.round((target - score) * 10) / 10);
  return {
    counting,
    pointsPerCountingTeam: Math.round((pointsToTarget / Math.max(1, countN)) * 10) / 10,
    squadName: snapshot.squadName,
    membersCount: snapshot.membersCount || members.length,
    maxMembersCount: snapshot.maxMembersCount || 10,
    current,
    teamsNeededToStart: current ? Math.max(0, current.minimumLineups - current.totalLineups) : 0,
    pointsToTarget,
    progressPct: target > 0 ? Math.min(100, Math.round((score / target) * 100)) : 0,
    members,
    missing,
    membersInferred,
  };
}

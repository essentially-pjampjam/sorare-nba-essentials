import { RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { summarizeSquadActivity } from "../../calculators/squadActivityMath";
import type { SquadSnapshot } from "../../shared/types";
import { getSquadSnapshot, scanSquadActivity } from "../api";
import { GoButton } from "./GoButton";

const SQUAD_URL = "https://sorare.com/nba/series/squad";

/** Set Squad member activity: who has a team in the live stage, who still needs to set one. */
export function SquadActivityCard({ mySlug }: { mySlug: string | null }) {
  const [snapshot, setSnapshot] = useState<SquadSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSquadSnapshot()
      .then((s) => s && setSnapshot(s))
      .catch(() => {});
  }, []);

  const summary = useMemo(() => (snapshot ? summarizeSquadActivity(snapshot, mySlug) : null), [mySlug, snapshot]);

  const scan = () => {
    setBusy(true);
    setError(null);
    scanSquadActivity()
      .then(setSnapshot)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const cur = summary?.current ?? null;
  return (
    <div className="rounded-2xl border border-white/8 jam-attn-set bg-[#111726] p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-set-300" />
          <span className="text-xs font-semibold text-slate-100">
            Squad Activity{summary ? `: ${summary.squadName} (${summary.membersCount}/${summary.maxMembersCount})` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={scan}
            title="Reads the Squad data from your open sorare.com Squad tab (no extra Sorare requests)"
            className="jam-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Scanning..." : "Scan squad"}
          </button>
          <GoButton url={`${SQUAD_URL}/members`} title="Open your Squad members on Sorare" />
        </div>
      </div>

      {error && <div className="mb-1 text-[10px] text-rose-300">{error}</div>}

      {!summary ? (
        <div className="text-[10px] text-slate-400">
          Open your Squad on Sorare (Go opens the Members page so the full member list loads), then press Scan squad.
        </div>
      ) : (
        <>
          {cur && (
            <div className="mb-1.5 text-[10px] text-slate-300">
              Live stage: <strong className="text-slate-100">{Math.round(cur.totalScore)}</strong> / {cur.target} pts ({summary.progressPct}%)
              {summary.pointsToTarget > 0 ? `, ${summary.pointsToTarget} to go` : ", target reached"} • {cur.totalLineups} team
              {cur.totalLineups === 1 ? "" : "s"} set
              {summary.teamsNeededToStart > 0 && (
                <span className="text-amber-300"> • needs {summary.teamsNeededToStart} more to count (best {cur.minimumLineups})</span>
              )}
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-white/10">
                <div className="h-full bg-set-400/70" style={{ width: `${summary.progressPct}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-slate-300">
                Only the best {cur.minimumLineups} teams count (their scores are added up).
                {summary.counting.length > 0 && (
                  <>
                    {" "}Counting now:{" "}
                    <strong className="text-set-200">
                      {summary.counting.map((m) => `#${m.liveRank} ${m.nickname}${m.isMe ? " (you)" : ""}`).join(", ")}
                    </strong>
                    .
                  </>
                )}
                {summary.pointsToTarget > 0 && summary.counting.length > 0 && (
                  <span className="text-slate-400">
                    {" "}They need {summary.pointsToTarget} more together (~{summary.pointsPerCountingTeam} each). A member who sets a team
                    that beats #{cur.minimumLineups} {summary.counting[summary.counting.length - 1]?.nickname} raises the total.
                  </span>
                )}
              </div>
            </div>
          )}
          {summary.missing.length > 0 ? (
            <div className="mb-1 text-[10px] text-amber-200">
              No team yet ({summary.missing.length}): {summary.missing.map((m) => `${m.nickname}${m.isMe ? " (you)" : ""}`).join(", ")}
              <span className="text-slate-400"> • a strong team from them could replace a counting one</span>
            </div>
          ) : (
            <div className="mb-1 text-[10px] text-emerald-300">Every member has a team in the live stage.</div>
          )}
          <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
            {summary.members.map((m) => (
              <li key={m.slug} className="flex items-center justify-between gap-1 truncate">
                <span
                  className={`truncate ${m.counting ? "font-semibold text-set-200" : m.activeNow ? "text-slate-200" : "text-slate-500"}`}
                  title={m.counting ? "Counts toward the stage total" : m.activeNow ? "Has a team (not in the best teams right now)" : "No team in the live stage"}
                >
                  {m.liveRank ? `#${m.liveRank}` : "○"} {m.nickname}
                  {m.isCaptain ? " (C)" : ""}
                  {m.isMe ? " (you)" : ""}
                </span>
                <span className="shrink-0 text-slate-500" title="Stages played of the stages Sorare loaded">
                  {m.stagesPlayed}/{m.stagesSeen}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[9.5px] text-slate-500">
            Scanned {new Date(snapshot?.scannedAt ?? Date.now()).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            {summary.membersInferred ? " • member list not loaded: open the Members page and scan again" : ""}
          </div>
        </>
      )}
    </div>
  );
}

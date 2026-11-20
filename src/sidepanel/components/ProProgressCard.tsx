import { TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { summarizeProHistory, summarizeProProgress, type ProLineupStatus } from "../../calculators/proProgressMath";
import type { GalleryResult, ProProgressRecord } from "../../shared/types";
import { getProProgressHistory } from "../api";

const STATUS: Record<ProLineupStatus, { label: string; cls: string }> = {
  cash: { label: "In the cash", cls: "text-emerald-300" },
  rewarded: { label: "In rewards", cls: "text-sky-300" },
  outside: { label: "Outside rewards", cls: "text-amber-300" },
  unranked: { label: "Not ranked yet", cls: "text-slate-400" },
};

/** Pro Progress Tracker: live rank of each open Pro lineup and a per-Game-Week history. */
export function ProProgressCard({ gallery }: { gallery: GalleryResult | null }) {
  const [history, setHistory] = useState<ProProgressRecord[]>([]);
  useEffect(() => {
    getProProgressHistory()
      .then(setHistory)
      .catch(() => {});
  }, [gallery]);

  const live = useMemo(
    () => (gallery ? summarizeProProgress(gallery.currentLineups, gallery.leaderboardBenchmarks ?? []) : []),
    [gallery],
  );
  const weeks = useMemo(() => summarizeProHistory(history).slice(0, 6), [history]);

  return (
    <div className="rounded-2xl border border-sky-400/25 bg-[#111726] p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-sky-300" />
        <span className="text-xs font-semibold text-slate-100">Pro Progress</span>
        <span className="text-[10px] text-slate-400">live rank of your open lineups (refresh to update)</span>
      </div>
      {live.length === 0 ? (
        <div className="text-[10px] text-slate-400">No submitted Pro lineups in the open Game Week yet.</div>
      ) : (
        <ul className="space-y-1 text-[10.5px]">
          {live.map((p) => (
            <li key={p.lineupId} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-100">{p.leaderboardName}</div>
                <div className="text-[10px] text-slate-400">
                  {p.rank ? `#${p.rank.toLocaleString()}` : "--"}
                  {p.totalEntries ? ` of ${p.totalEntries.toLocaleString()}` : ""}
                  {p.topPct !== null ? ` (top ${p.topPct}%)` : ""}
                  {p.score !== null ? ` • ${p.score} pts` : ""}
                  {p.status === "outside" && p.ranksToReward ? ` • ${p.ranksToReward.toLocaleString()} ranks to rewards` : ""}
                </div>
              </div>
              <span className={`shrink-0 text-[10px] font-semibold ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
            </li>
          ))}
        </ul>
      )}
      {live.some((p) => p.rank === null) && (
        <div className="mt-1 text-[10px] text-slate-500">Ranks show once games start (live rank needs an API key).</div>
      )}
      {weeks.length > 0 && (
        <div className="mt-2">
          <div className="mb-0.5 text-[10px] font-semibold text-slate-300">Game Week history (saved on this device)</div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="font-medium">Game Week</th>
                <th className="font-medium">Lineups</th>
                <th className="font-medium">Rewards</th>
                <th className="font-medium">Cash</th>
                <th className="font-medium">Best</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.fixtureSlug} className="border-t border-white/5 text-slate-200">
                  <td className="py-0.5">{w.fixtureSlug.replace(/^nba-/, "")}</td>
                  <td>{w.lineups}</td>
                  <td className="text-sky-300">{w.rewarded}</td>
                  <td className="text-emerald-300">{w.cash}</td>
                  <td>{w.bestTopPct !== null ? `top ${w.bestTopPct}%` : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

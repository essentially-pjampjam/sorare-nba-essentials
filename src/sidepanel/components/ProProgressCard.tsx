import { ImageDown, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { selectOpenGameWeek } from "../../calculators/countdownMath";
import {
  summarizePageLineups,
  summarizeProHistory,
  summarizeProProgress,
  summarizeProSeasonPulse,
  type PageGameWeekGroup,
  type ProLineupStatus,
} from "../../calculators/proProgressMath";
import { buildGameWeekRecapData } from "../../calculators/recapShareMath";
import { buildArenaLineupsUrl, buildArenaOngoingUrl } from "../../shared/routes";
import type { GalleryResult, PageLineupSnapshot, ProProgressRecord } from "../../shared/types";
import { getProProgressHistory, openInActiveTab, syncPageLineups } from "../api";
import { formatRelativeAge } from "../utils/format";
import { shareGameWeekRecapCard } from "../utils/recapShareCard";

const STATUS: Record<ProLineupStatus, { label: string; cls: string }> = {
  // Green = rewards; a solid fill marks the cash places so they stand out from Essence / XP rewards.
  cash: { label: "In the cash", cls: "border-emerald-300 bg-emerald-400 text-slate-950" },
  rewarded: { label: "In rewards", cls: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" },
  outside: { label: "Outside rewards", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  unranked: { label: "Submitted", cls: "border-white/10 bg-white/5 text-slate-300" },
  ranked: { label: "Live rank", cls: "border-white/10 bg-white/5 text-slate-300" },
};

const PHASE: Record<PageGameWeekGroup["phase"], { label: string; cls: string }> = {
  live: { label: "LIVE", cls: "bg-rose-500/20 text-rose-300 border-rose-400/40" },
  upcoming: { label: "Before cutoff", cls: "bg-sky-500/15 text-sky-300 border-sky-400/30" },
  finished: { label: "Finished", cls: "bg-white/5 text-slate-400 border-white/10" },
};

/** Current Pro Progress: the manager's live and upcoming Pro lineups with rank, plus local history. */
export function ProProgressCard({
  gallery,
  onOpenWrapped,
}: {
  gallery: GalleryResult | null;
  onOpenWrapped?: () => void;
}) {
  const [history, setHistory] = useState<ProProgressRecord[]>([]);
  const [snap, setSnap] = useState<PageLineupSnapshot | null>(gallery?.pageLineups ?? null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [recapStatus, setRecapStatus] = useState<string | null>(null);

  useEffect(() => {
    setSnap(gallery?.pageLineups ?? null);
    getProProgressHistory()
      .then(setHistory)
      .catch(() => {});
  }, [gallery]);

  const benchmarks = useMemo(() => gallery?.leaderboardBenchmarks ?? [], [gallery]);
  const groups = useMemo(() => (snap ? summarizePageLineups(snap.lineups, benchmarks) : []), [snap, benchmarks]);
  // Fallback when no Sorare tab was read yet: lineups the public API returned (rare).
  const apiRows = useMemo(
    () =>
      gallery && groups.length === 0
        ? summarizeProProgress(gallery.currentLineups.filter((l) => l.source === "api"), benchmarks)
        : [],
    [gallery, groups.length, benchmarks],
  );
  const weeks = useMemo(() => summarizeProHistory(history).slice(0, 6), [history]);
  const pulse = useMemo(() => summarizeProSeasonPulse(history), [history]);
  const openGw = gallery ? selectOpenGameWeek(gallery.fixtures, Date.now()) : null;

  const sync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const next = await syncPageLineups(gallery?.username);
      if (next) {
        setSnap(next);
        setHistory(await getProProgressHistory().catch(() => history));
        setSyncNote(Date.now() - next.scannedAt < 15_000 ? null : "No open Sorare Lineups tab: showing the last sync.");
      } else {
        setSyncNote("Open one of the Sorare Lineups pages below, then Sync.");
      }
    } catch (e) {
      setSyncNote(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const recapData = useMemo(
    () =>
      buildGameWeekRecapData({
        username: gallery?.username ?? null,
        group: groups[0] ?? null,
        weekSummary: weeks[0] ?? null,
        historyRecords: history,
        pulse,
      }),
    [gallery?.username, groups, weeks, history, pulse],
  );

  const exportRecap = async () => {
    if (!recapData) return;
    try {
      const outcome = await shareGameWeekRecapCard(recapData);
      setRecapStatus(outcome === "copied" ? "Recap PNG copied" : "Recap PNG saved");
      window.setTimeout(() => setRecapStatus(null), 2500);
    } catch {
      setRecapStatus("Export failed");
    }
  };

  return (
    <div className={`rounded-2xl border border-white/8 bg-[#111726] p-3 ${groups.some((g) => g.phase === "live") ? "jam-attn-live" : ""}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5 text-sky-300" />
        <span className="text-xs font-semibold text-slate-100">Current Pro Progress</span>
        {snap && <span className="text-[10px] text-slate-500">synced {formatRelativeAge(snap.scannedAt)}</span>}
        <div className="ml-auto flex items-center gap-1">
          {recapData && (
            <button
              type="button"
              onClick={() => void exportRecap()}
              title="Copy or download a 16:9 PNG Game Week Recap card"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200 hover:border-emerald-300"
            >
              <ImageDown className="h-3 w-3" />
              {recapStatus ?? "Recap"}
            </button>
          )}
          {onOpenWrapped && (
            <button
              type="button"
              onClick={onOpenWrapped}
              title="Open Sorare NBA Wrapped (Regular Season / Playoffs / Year-End)"
              className="inline-flex items-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200 hover:border-violet-300"
            >
              <Sparkles className="h-3 w-3" />
              Wrapped
            </button>
          )}
          <button
            type="button"
            onClick={() => void sync()}
            disabled={syncing}
            title="Re-read your lineups from open sorare.com tabs"
            className="inline-flex items-center gap-1 rounded-lg border border-sky-400/40 px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:border-sky-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            Sync
          </button>
        </div>
      </div>

      {groups.length === 0 && apiRows.length === 0 ? (
        <div className="space-y-1.5 text-[10px] text-slate-400">
          <p>
            Your lineups are private on Sorare, so they are read from your logged-in Sorare tab. Open the Lineups page
            once (live or upcoming Game Week) and they sync automatically.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void openInActiveTab(buildArenaOngoingUrl())}
              className="rounded-lg border border-rose-400/40 px-2 py-0.5 font-semibold text-rose-200 hover:border-rose-300"
            >
              Live Game Week
            </button>
            <button
              type="button"
              onClick={() => void openInActiveTab(buildArenaLineupsUrl(openGw?.fixture.slug ?? null))}
              className="rounded-lg border border-sky-400/40 px-2 py-0.5 font-semibold text-sky-200 hover:border-sky-300"
            >
              Upcoming Game Week
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.fixtureSlug}>
              <div className="mb-1 flex items-center gap-1.5 text-[10px]">
                <span className={`rounded border px-1.5 py-px font-bold ${PHASE[g.phase].cls}`}>{PHASE[g.phase].label}</span>
                <span className="font-semibold text-slate-200">{g.fixtureName}</span>
                <span className="text-slate-500">
                  {g.rows.length} lineup{g.rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="space-y-1 text-[10.5px]">
                {g.rows.map((p) => (
                  <li key={p.lineupId} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-100">{p.leaderboardName}</div>
                      <div className="text-[10px] text-slate-400">
                        {p.rank ? `#${p.rank.toLocaleString()}` : g.phase === "upcoming" ? "Ranks start at cutoff" : "--"}
                        {p.rank && p.totalEntries ? ` of ${p.totalEntries.toLocaleString()}` : ""}
                        {p.topPct !== null ? ` (top ${p.topPct}%)` : ""}
                        {p.score !== null && g.phase !== "upcoming" ? ` • ${p.score} pts` : ""}
                        {p.liveProjectedRank ? ` • proj. #${p.liveProjectedRank.toLocaleString()}` : ""}
                      </div>
                      {p.status === "outside" && p.ranksToReward ? (
                        <div className="text-[10px] text-amber-300/80">{p.ranksToReward.toLocaleString()} ranks to rewards (est.)</div>
                      ) : null}
                      {g.phase === "upcoming" && p.playerNames.length > 0 && (
                        <div className="truncate text-[10px] text-slate-500">{p.playerNames.join(", ")}</div>
                      )}
                    </div>
                    <span className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-semibold ${STATUS[p.status].cls}`}>
                      {STATUS[p.status].label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {apiRows.map((p) => (
            <div key={p.lineupId} className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1 text-[10.5px] text-slate-200">
              {p.leaderboardName} {p.rank ? `#${p.rank.toLocaleString()}` : ""}
            </div>
          ))}
          {groups.some((g) => g.phase === "live") && (
            <div className="text-[10px] text-slate-500">Reward places are estimated from last week&apos;s field of the same competition.</div>
          )}
        </div>
      )}
      {syncNote && <div className="mt-1 text-[10px] text-amber-300/90">{syncNote}</div>}

      {weeks.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
            <span className="font-semibold text-slate-300">Game Week history (saved on this device)</span>
            {pulse && pulse.currentRewardStreak >= 2 && (
              <span className="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-px text-[9.5px] font-semibold text-emerald-300">
                {pulse.currentRewardStreak} GW streak
              </span>
            )}
          </div>
          {pulse && (
            <div className="mb-1.5 grid grid-cols-4 gap-1 text-center">
              <div className="rounded-lg border border-white/6 bg-[#0b101b] px-1 py-1">
                <div className="text-[8.5px] uppercase tracking-wide text-slate-500">Tracked</div>
                <div className="text-[11px] font-bold tabular-nums text-slate-100">{pulse.gameWeeks} GW</div>
              </div>
              <div className="rounded-lg border border-white/6 bg-[#0b101b] px-1 py-1">
                <div className="text-[8.5px] uppercase tracking-wide text-slate-500">Reward %</div>
                <div className="text-[11px] font-bold tabular-nums text-emerald-300">{pulse.rewardHitRatePct}%</div>
              </div>
              <div className="rounded-lg border border-white/6 bg-[#0b101b] px-1 py-1">
                <div className="text-[8.5px] uppercase tracking-wide text-slate-500">Cash %</div>
                <div className="text-[11px] font-bold tabular-nums text-emerald-200">{pulse.cashHitRatePct}%</div>
              </div>
              <div className="rounded-lg border border-white/6 bg-[#0b101b] px-1 py-1">
                <div className="text-[8.5px] uppercase tracking-wide text-slate-500">Best</div>
                <div className="text-[11px] font-bold tabular-nums text-sky-300">
                  {pulse.bestTopPct !== null ? `Top ${pulse.bestTopPct}%` : "--"}
                </div>
              </div>
            </div>
          )}
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
                  <td className="text-emerald-300">{w.rewarded}</td>
                  <td className="font-semibold text-emerald-200">{w.cash}</td>
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

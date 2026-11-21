import { BellRing, HeartPulse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { computeCountdownSnapshot, formatCountdown, selectOpenGameWeek } from "../../calculators/countdownMath";
import { summarizePageLineups } from "../../calculators/proProgressMath";
import type { GalleryResult } from "../../shared/types";

interface StatusStripProps {
  gallery: GalleryResult | null;
  reminderEnabled?: boolean;
  onToggleReminder?: (enabled: boolean) => void;
  /** Jumps to Current Pro Progress (switches to Pro first). */
  onShowProgress?: () => void;
}

const chip = "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 tabular-nums";

/** One line of what matters now: live Game Week, next cutoff, daily reset, injuries, reminder. */
export function StatusStrip({ gallery, reminderEnabled = false, onToggleReminder, onShowProgress }: StatusStripProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const fixtures = gallery?.fixtures ?? [];
  const snap = computeCountdownSnapshot(fixtures, nowMs);
  const openGw = selectOpenGameWeek(fixtures, nowMs);
  const live = useMemo(() => {
    const groups = gallery?.pageLineups ? summarizePageLineups(gallery.pageLineups.lineups, []) : [];
    return groups.find((g) => g.phase === "live") ?? null;
  }, [gallery]);
  const best = live?.rows.find((r) => r.rank)?.rank ?? null;
  const cutoffMs = snap.gwRemainingMs !== null && snap.gwRemainingMs > 0 ? snap.gwRemainingMs : null;
  const urgent = cutoffMs !== null && cutoffMs < 3 * 3_600_000;
  const gwLabel = openGw?.fixture.displayName.replace(/^Game Week /, "GW") ?? "GW";

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {live && (
        <button type="button" onClick={onShowProgress} className={`${chip} border-rose-400/40 bg-rose-500/10 text-rose-200 hover:border-rose-300`}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
          LIVE {live.fixtureName.replace(/^Game Week /, "GW")} • {live.rows.length} lineup{live.rows.length === 1 ? "" : "s"}
          {best ? ` • best #${best.toLocaleString()}` : ""}
        </button>
      )}
      <span
        className={`${chip} ${urgent ? "border-amber-400/50 bg-amber-400/10 text-amber-200" : "border-white/10 bg-[#111726] text-slate-200"}`}
        title={snap.gwCutoffIso ? `Locks ${new Date(snap.gwCutoffIso).toLocaleString()}` : undefined}
      >
        {cutoffMs !== null ? (
          <>
            {gwLabel} cutoff <strong className="font-semibold">{formatCountdown(cutoffMs)}</strong>
          </>
        ) : (
          "No open Game Week"
        )}
      </span>
      <span className={`${chip} border-white/10 bg-[#111726] text-slate-300`} title="Sorare's daily reset is 07:00 UTC">
        Daily reset <strong className="font-semibold text-slate-100">{formatCountdown(snap.dailyRemainingMs)}</strong>
      </span>
      {gallery && (
        <span className={`${chip} border-white/10 bg-[#111726] text-slate-300`} title="Players on the ESPN injury report">
          <HeartPulse className="h-3 w-3 text-rose-300" />
          {Object.keys(gallery.injuriesByName).length}
        </span>
      )}
      <button
        type="button"
        disabled={!onToggleReminder}
        onClick={() => onToggleReminder?.(!reminderEnabled)}
        aria-pressed={reminderEnabled}
        title={reminderEnabled ? "Cutoff reminder on (click to turn off)" : "Cutoff reminder off (click to turn on)"}
        className={`${chip} ml-auto ${reminderEnabled ? "border-sky-400/50 bg-sky-500/15 text-sky-200" : "border-white/10 bg-[#111726] text-slate-500"}`}
      >
        <BellRing className="h-3 w-3" />
        Reminder
      </button>
    </div>
  );
}

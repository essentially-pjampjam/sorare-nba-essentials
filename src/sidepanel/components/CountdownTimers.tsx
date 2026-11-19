import { BellRing, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { computeCountdownSnapshot, formatCountdown } from "../../calculators/countdownMath";
import type { So5FixtureSummary } from "../../shared/types";

interface CountdownTimersProps {
  fixtures: So5FixtureSummary[] | null;
  reminderEnabled?: boolean;
  onToggleReminder?: (enabled: boolean) => void;
}

/** Live GW cutoff + Daily Reset (07:00 UTC) countdowns with the optional cutoff reminder toggle. */
export function CountdownTimers({ fixtures, reminderEnabled = false, onToggleReminder }: CountdownTimersProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const snap = computeCountdownSnapshot(fixtures ?? [], nowMs);
  const gwText =
    snap.gwRemainingMs !== null && snap.gwRemainingMs > 0
      ? formatCountdown(snap.gwRemainingMs)
      : "no open GW";
  const urgent = snap.gwRemainingMs !== null && snap.gwRemainingMs > 0 && snap.gwRemainingMs < 3_600_000;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-[#111726] px-3 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-3 text-slate-200">
        <span
          className="inline-flex items-center gap-1"
          title={snap.gwCutoffIso ? `Locks ${new Date(snap.gwCutoffIso).toLocaleString()}` : undefined}
        >
          <Clock3 className={`h-3.5 w-3.5 ${urgent ? "text-rose-400" : "text-amber-400"}`} />
          GW Cutoff: <span className={`font-semibold ${urgent ? "text-rose-300" : "text-slate-100"}`}>{gwText}</span>
        </span>
        <span className="inline-flex items-center gap-1" title="Sorare's daily reset is 07:00 UTC">
          Daily Reset (07:00 UTC):{" "}
          <span className="font-semibold text-slate-100">{formatCountdown(snap.dailyRemainingMs)}</span>
        </span>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-1 text-slate-300">
          <BellRing className="h-3 w-3 text-amber-400" />
          Cutoff reminder
          <input
            type="checkbox"
            checked={reminderEnabled}
            aria-label="Game Week cutoff reminder"
            disabled={!onToggleReminder}
            onChange={(e) => onToggleReminder?.(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-400"
          />
      </label>
    </div>
  );
}

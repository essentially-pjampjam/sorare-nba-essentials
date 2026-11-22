import { X } from "lucide-react";
import type { Rarity, ScanProgress } from "../../shared/types";

interface LoadingStageProps {
  title: string;
  subtitle?: string;
  progress: ScanProgress | null;
  rarity?: Rarity | "set";
  onCancel?: () => void;
}

export function LoadingStage({
  title,
  subtitle,
  progress,
  rarity,
  onCancel,
}: LoadingStageProps) {
  const hasDeterminate = Boolean(progress && progress.total > 0);
  const completed = hasDeterminate ? Math.min(progress!.completed, progress!.total) : 0;
  const total = hasDeterminate ? progress!.total : 0;
  const pct = hasDeterminate ? Math.min(100, Math.round((completed / total) * 100)) : null;
  const statusText = progress?.message || subtitle || "Fetching live Sorare NBA data...";

  return (
    <section
      className="jam-panel-enter space-y-3"
      aria-label={title}
    >
      <div className="glass-chrome rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <span className="jam-logo-badge flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl p-1">
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              className="h-full w-full object-contain"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xs font-semibold tracking-tight text-slate-100">
              {title}
            </h2>
            <p
              role="status"
              aria-live="polite"
              className="mt-0.5 truncate text-[11px] text-slate-400"
            >
              {statusText}
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="glass-pill inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[10.5px] font-medium text-slate-200 hover:border-sky-400/50 hover:text-white"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          {hasDeterminate ? (
            <progress
              className="jam-progress"
              data-rarity={rarity}
              value={completed}
              max={total}
              aria-label={title}
            />
          ) : (
            <progress
              className="jam-progress"
              data-rarity={rarity}
              aria-label={title}
            />
          )}
          <div className="flex items-center justify-between text-[10.5px] tabular-nums text-slate-400">
            <span>
              {hasDeterminate ? `Step ${completed} of ${total}` : "Preparing live data..."}
            </span>
            {pct !== null && (
              <span className="font-semibold text-slate-200">{pct}%</span>
            )}
          </div>
        </div>
      </div>

      {/* Subtle layout preview placeholders so the canvas feels grounded while data loads */}
      <div aria-hidden="true" className="space-y-2 opacity-60">
        <div className="rounded-xl border border-white/6 bg-[#111726] p-3">
          <div className="jam-skeleton-bar h-3 w-2/5 rounded-md" />
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <div className="jam-skeleton-bar h-8 rounded-lg" />
            <div className="jam-skeleton-bar h-8 rounded-lg" />
            <div className="jam-skeleton-bar h-8 rounded-lg" />
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-[#111726] p-3">
          <div className="jam-skeleton-bar h-3 w-1/3 rounded-md" />
          <div className="mt-2.5 space-y-2">
            <div className="jam-skeleton-bar h-10 w-full rounded-lg" />
            <div className="jam-skeleton-bar h-10 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </section>
  );
}

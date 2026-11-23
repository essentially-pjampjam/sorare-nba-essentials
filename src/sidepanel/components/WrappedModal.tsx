import { ChevronLeft, ChevronRight, Download, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildWrappedSummary } from "../../calculators/wrappedMath";
import { getActiveNbaSeasonYear } from "../../shared/constants";
import type {
  CardOwnershipRecord,
  Currency,
  EssenceBalances,
  GalleryCard,
  ProProgressRecord,
  WrappedMode,
} from "../../shared/types";
import { shareWrappedCard } from "../utils/wrappedShareCard";

interface WrappedModalProps {
  open: boolean;
  onClose: () => void;
  username: string | null;
  progressHistory: ProProgressRecord[];
  galleryCards: GalleryCard[];
  ownershipRecords?: CardOwnershipRecord[];
  essenceByRarity?: EssenceBalances;
  commonEssence?: number;
  currency?: Currency;
}

const ACCENT_STYLES: Record<
  "emerald" | "sky" | "amber" | "violet",
  { border: string; glow: string; metric: string; badge: string }
> = {
  emerald: {
    border: "border-emerald-400/30",
    glow: "from-emerald-500/15 via-[#111726] to-[#0b101b]",
    metric: "text-emerald-300",
    badge: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
  },
  sky: {
    border: "border-sky-400/30",
    glow: "from-sky-500/15 via-[#111726] to-[#0b101b]",
    metric: "text-sky-300",
    badge: "border-sky-400/40 bg-sky-500/15 text-sky-200",
  },
  amber: {
    border: "border-amber-400/30",
    glow: "from-amber-500/15 via-[#111726] to-[#0b101b]",
    metric: "text-amber-300",
    badge: "border-amber-400/40 bg-amber-500/15 text-amber-200",
  },
  violet: {
    border: "border-violet-400/30",
    glow: "from-violet-500/15 via-[#111726] to-[#0b101b]",
    metric: "text-violet-300",
    badge: "border-violet-400/40 bg-violet-500/15 text-violet-200",
  },
};

export function WrappedModal({
  open,
  onClose,
  username,
  progressHistory,
  galleryCards,
  ownershipRecords = [],
  essenceByRarity,
  commonEssence = 0,
  currency = "EUR",
}: WrappedModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [mode, setMode] = useState<WrappedMode>("regular_season");
  const [slideIdx, setSlideIdx] = useState(0);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const summary = useMemo(
    () =>
      buildWrappedSummary({
        mode,
        username,
        seasonYear: getActiveNbaSeasonYear(),
        progressHistory,
        galleryCards,
        ownershipRecords,
        essenceByRarity,
        commonEssence,
        currency,
      }),
    [
      mode,
      username,
      progressHistory,
      galleryCards,
      ownershipRecords,
      essenceByRarity,
      commonEssence,
      currency,
    ],
  );

  const slides = summary.slides;
  const activeSlide = slides[Math.min(slideIdx, slides.length - 1)];
  const style = ACCENT_STYLES[activeSlide.accent];

  const handleExport = async () => {
    setExporting(true);
    setExportStatus(null);
    try {
      const outcome = await shareWrappedCard(summary);
      setExportStatus(outcome === "copied" ? "Copied 16:9 PNG to clipboard" : "Downloaded 16:9 PNG");
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[94vw] max-w-md rounded-2xl border border-white/15 bg-[#0c111d] p-0 text-slate-100 shadow-2xl backdrop:bg-black/75"
    >
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-violet-300" />
            <h2 className="text-sm font-bold text-slate-100">Sorare NBA Wrapped</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Wrapped modal"
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode selector */}
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-white/8 bg-[#090d16] p-1 text-[10.5px]">
          {(
            [
              { id: "regular_season", label: "Regular Season" },
              { id: "playoffs", label: "Playoffs" },
              { id: "year_end", label: "Year-End (Nov)" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                setSlideIdx(0);
              }}
              className={`rounded-lg px-2 py-1 font-semibold transition ${
                mode === m.id
                  ? "bg-violet-500/25 text-violet-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Progress bars */}
        <div className="mb-3 flex gap-1">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSlideIdx(idx)}
              aria-label={`Slide ${idx + 1}: ${s.eyebrow}`}
              className={`h-1 flex-1 rounded-full transition ${
                idx <= slideIdx ? "bg-violet-400" : "bg-white/15"
              }`}
            />
          ))}
        </div>

        {/* Active Story Slide */}
        <div
          className={`flex min-h-[210px] flex-col justify-between rounded-2xl border bg-gradient-to-br p-4 ${style.border} ${style.glow}`}
        >
          <div>
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-[9.5px] font-bold tracking-wider ${style.badge}`}
            >
              {activeSlide.eyebrow}
            </span>
            <h3 className="mt-2.5 text-base font-bold text-slate-100">
              {activeSlide.headline}
            </h3>
          </div>

          <div className={`my-3 text-4xl font-extrabold tracking-tight ${style.metric}`}>
            {activeSlide.metric}
          </div>

          <p className="text-xs leading-relaxed text-slate-300">{activeSlide.subtext}</p>
        </div>

        {/* Quick stats strip */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[10px]">
          <div className="rounded-lg border border-white/6 bg-[#111726] p-1.5">
            <div className="text-slate-500">GWs</div>
            <div className="font-bold text-slate-100">{summary.totalGameWeeks}</div>
          </div>
          <div className="rounded-lg border border-white/6 bg-[#111726] p-1.5">
            <div className="text-slate-500">MVP</div>
            <div className="truncate font-bold text-amber-200">
              {summary.mvpCardName ?? "--"}
            </div>
          </div>
          <div className="rounded-lg border border-white/6 bg-[#111726] p-1.5">
            <div className="text-slate-500">Fav Team</div>
            <div className="truncate font-bold text-sky-200">
              {summary.favoriteTeamName ?? "--"}
            </div>
          </div>
        </div>

        {/* Navigation + 16:9 PNG Export */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
              disabled={slideIdx === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-35"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => setSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
              disabled={slideIdx >= slides.length - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-35"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/45 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting..." : "Share 16:9 PNG"}
          </button>
        </div>
        {exportStatus && (
          <div className="mt-2 text-right text-[10.5px] font-medium text-emerald-300">
            {exportStatus}
          </div>
        )}
      </div>
    </dialog>
  );
}

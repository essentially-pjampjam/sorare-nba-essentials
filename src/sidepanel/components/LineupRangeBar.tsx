interface LineupRangeBarProps {
  p10: number;
  mean: number;
  p90: number;
  cutLine?: number | null;
  cashLine?: number | null;
  label?: string;
}

/**
 * Compact micro-SVG showing projected lineup score range (p10 floor, mean dot, p90 ceiling)
 * relative to the leaderboard reward cut-line (and optional cash cut-line).
 */
export function LineupRangeBar({
  p10,
  mean,
  p90,
  cutLine,
  cashLine,
  label = "Score range",
}: LineupRangeBarProps) {
  const safeP10 = Math.max(0, Number.isFinite(p10) ? p10 : 0);
  const safeMean = Math.max(safeP10, Number.isFinite(mean) ? mean : safeP10);
  const safeP90 = Math.max(safeMean, Number.isFinite(p90) ? p90 : safeMean);
  const validCut = typeof cutLine === "number" && Number.isFinite(cutLine) && cutLine > 0 ? cutLine : null;
  const validCash = typeof cashLine === "number" && Number.isFinite(cashLine) && cashLine > 0 ? cashLine : null;

  const minVal = Math.max(0, Math.min(safeP10, validCut ?? safeP10) - 15);
  const maxVal = Math.max(safeP90, validCut ?? safeP90, validCash ?? safeP90) + 15;
  const span = Math.max(1, maxVal - minVal);
  const xOf = (v: number) => Math.max(4, Math.min(196, 4 + ((v - minVal) / span) * 192));

  const x10 = xOf(safeP10);
  const xMean = xOf(safeMean);
  const x90 = xOf(safeP90);
  const xCut = validCut !== null ? xOf(validCut) : null;
  const xCash = validCash !== null ? xOf(validCash) : null;

  const clearsCut = validCut !== null && safeMean >= validCut;
  const barColor = clearsCut ? "#34d399" : "#38bdf8";

  const titleText = `${label}: Floor p10 ${safeP10.toFixed(0)} | Mean ${safeMean.toFixed(0)} | Ceiling p90 ${safeP90.toFixed(0)}${validCut ? ` | Cut ${validCut.toFixed(0)}` : ""}${validCash ? ` | Cash ${validCash.toFixed(0)}` : ""}`;

  return (
    <div className="flex items-center gap-2 text-[10px] tabular-nums">
      <span className="shrink-0 text-slate-400">
        {safeP10.toFixed(0)}
      </span>
      <svg
        viewBox="0 0 200 18"
        className="h-4 w-full min-w-[96px] max-w-[180px] overflow-visible"
        role="img"
        aria-label={titleText}
      >
        <title>{titleText}</title>
        {/* Track */}
        <rect x={4} y={7} width={192} height={4} rx={2} fill="rgba(255,255,255,0.08)" />
        {/* p10 -> p90 range */}
        <rect
          x={x10}
          y={6}
          width={Math.max(4, x90 - x10)}
          height={6}
          rx={3}
          fill={barColor}
          fillOpacity={0.35}
          stroke={barColor}
          strokeWidth={1}
        />
        {/* Reward cut-line marker */}
        {xCut !== null && (
          <line
            x1={xCut}
            y1={2}
            x2={xCut}
            y2={16}
            stroke="#fbbf24"
            strokeWidth={1.5}
            strokeDasharray="2 1.5"
          />
        )}
        {/* Cash cut-line marker */}
        {xCash !== null && (
          <line
            x1={xCash}
            y1={2}
            x2={xCash}
            y2={16}
            stroke="#34d399"
            strokeWidth={1.5}
          />
        )}
        {/* Mean dot */}
        <circle cx={xMean} cy={9} r={3.5} fill={barColor} stroke="#0b0c0e" strokeWidth={1.2} />
      </svg>
      <span className="shrink-0 text-slate-300 font-semibold">
        {safeP90.toFixed(0)}
      </span>
      {validCut !== null && (
        <span className="shrink-0 text-[9.5px] text-amber-300/90" title="Leaderboard reward cut-line">
          Cut {validCut.toFixed(0)}
        </span>
      )}
    </div>
  );
}

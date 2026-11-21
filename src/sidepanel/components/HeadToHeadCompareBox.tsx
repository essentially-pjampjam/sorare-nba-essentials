import { ArrowLeftRight, X } from "lucide-react";
import type {
  Currency,
  GalleryCard,
  TeamSlateSchedule,
} from "../../shared/types";
import { formatMoney } from "../utils/format";

interface HeadToHeadCompareBoxProps {
  cards: GalleryCard[];
  currency: Currency;
  scheduleByTeam?: Record<string, TeamSlateSchedule>;
  gamesPerTeam?: Record<string, number>;
  onRemove: (slug: string) => void;
  onClear: () => void;
}

export function HeadToHeadCompareBox({
  cards,
  currency,
  scheduleByTeam = {},
  gamesPerTeam = {},
  onRemove,
  onClear,
}: HeadToHeadCompareBoxProps) {
  if (cards.length === 0) return null;

  const left = cards[0];
  const right = cards[1] ?? null;

  const metricWin = (
    a: number | null | undefined,
    b: number | null | undefined,
    lowerWins = false,
  ): "left" | "right" | "tie" => {
    if (a === null || a === undefined || b === null || b === undefined) {
      return "tie";
    }
    if (a === b) return "tie";
    if (lowerWins) return a < b ? "left" : "right";
    return a > b ? "left" : "right";
  };

  const getProj = (c: GalleryCard) =>
    c.sorareClassicProjected ?? c.sorareDailyProjected ?? null;
  const getGames = (c: GalleryCard) =>
    c.teamSlug
      ? (scheduleByTeam[c.teamSlug]?.games ?? gamesPerTeam[c.teamSlug] ?? null)
      : null;

  const rows: Array<{
    label: string;
    leftVal: string;
    rightVal: string;
    winner: "left" | "right" | "tie";
  }> = right
    ? [
        {
          label: "Star Cap",
          leftVal: `${left.starCost}★`,
          rightVal: `${right.starCost}★`,
          winner: metricWin(left.starCost, right.starCost, true),
        },
        {
          label: "Proj Pts",
          leftVal: getProj(left)?.toFixed(1) ?? "--",
          rightVal: getProj(right)?.toFixed(1) ?? "--",
          winner: metricWin(getProj(left), getProj(right)),
        },
        {
          label: "L10 Avg",
          leftVal: left.l10?.toFixed(1) ?? "--",
          rightVal: right.l10?.toFixed(1) ?? "--",
          winner: metricWin(left.l10, right.l10),
        },
        {
          label: "L5 Form",
          leftVal: left.l5?.toFixed(1) ?? "--",
          rightVal: right.l5?.toFixed(1) ?? "--",
          winner: metricWin(left.l5, right.l5),
        },
        {
          label: "4-Day Games",
          leftVal:
            getGames(left) !== null
              ? `${getGames(left)}G${left.teamSlug && scheduleByTeam[left.teamSlug] ? ` (${scheduleByTeam[left.teamSlug].difficultyTag})` : ""}`
              : "--",
          rightVal:
            getGames(right) !== null
              ? `${getGames(right)}G${right.teamSlug && scheduleByTeam[right.teamSlug] ? ` (${scheduleByTeam[right.teamSlug].difficultyTag})` : ""}`
              : "--",
          winner: metricWin(getGames(left), getGames(right)),
        },
        {
          label: "Card Boost",
          leftVal: `+${Math.round((left.powerMultiplier - 1) * 100)}%`,
          rightVal: `+${Math.round((right.powerMultiplier - 1) * 100)}%`,
          winner: metricWin(left.powerMultiplier, right.powerMultiplier),
        },
        {
          label: "Floor Ask",
          leftVal: left.lowestAskCents
            ? formatMoney(left.lowestAskCents, currency)
            : "--",
          rightVal: right.lowestAskCents
            ? formatMoney(right.lowestAskCents, currency)
            : "--",
          winner: metricWin(left.lowestAskCents, right.lowestAskCents, true),
        },
      ]
    : [];

  return (
    <div className="rounded-2xl border border-white/8 bg-[#111726] p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-sky-200">
          <ArrowLeftRight className="h-3.5 w-3.5 text-sky-400" />
          Head-to-Head Compare ({cards.length}/2)
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-white/10 bg-[#0b101b] px-2 py-0.5 text-[10px] text-slate-300 hover:border-white/25"
        >
          Clear
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[left, right].map((card, i) => (
          <div
            key={card?.slug ?? `empty-${i}`}
            className="flex items-center justify-between gap-1 rounded-xl border border-white/8 bg-[#0b101b] px-2.5 py-1.5"
          >
            {card ? (
              <>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-100">
                    {card.playerName}
                  </div>
                  <div className="truncate text-[10px] text-slate-400">
                    {card.inSeasonEligible ? "26-27" : card.seasonYear} •{" "}
                    {card.teamName ?? "NBA"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(card.slug)}
                  aria-label={`Remove ${card.playerName} from comparison`}
                  className="shrink-0 text-slate-400 hover:text-rose-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <span className="text-[10px] text-slate-500">
                Pin a 2nd card to compare...
              </span>
            )}
          </div>
        ))}
      </div>

      {right && (
        <div className="mt-2 divide-y divide-white/6 rounded-xl border border-white/8 bg-[#0b101b]">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-3 items-center px-2.5 py-1 text-[10.5px] tabular-nums"
            >
              <span
                className={
                  r.winner === "left"
                    ? "font-bold text-emerald-300"
                    : "text-slate-300"
                }
              >
                {r.leftVal}
              </span>
              <span className="text-center text-[10px] text-slate-500">
                {r.label}
              </span>
              <span
                className={`text-right ${
                  r.winner === "right"
                    ? "font-bold text-emerald-300"
                    : "text-slate-300"
                }`}
              >
                {r.rightVal}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

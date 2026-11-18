import type { ReactNode } from "react";
import { NBA_TEAM_META } from "../../shared/constants";
import type { CardRarity } from "../../shared/types";

interface PlayerCardRowProps {
  playerName: string;
  teamSlug?: string | null;
  teamName?: string | null;
  rarity: CardRarity;
  pictureUrl?: string | null;
  leftBadge?: ReactNode;
  statusBadge?: ReactNode;
  subline: ReactNode;
  heroRight: ReactNode;
  subRight?: ReactNode;
  actionRight?: ReactNode;
  onToggleExpand?: () => void;
  expandedContent?: ReactNode;
}

function rarityPipColor(rarity: CardRarity): string {
  switch (rarity) {
    case "limited":
      return "bg-amber-400";
    case "rare":
      return "bg-rose-400";
    case "super_rare":
      return "bg-sky-400";
    case "unique":
      return "bg-violet-400";
    case "common":
    default:
      return "bg-emerald-400";
  }
}

function teamInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function PlayerCardRow({
  playerName,
  teamSlug,
  teamName,
  rarity,
  pictureUrl,
  leftBadge,
  statusBadge,
  subline,
  heroRight,
  subRight,
  actionRight,
  onToggleExpand,
  expandedContent,
}: PlayerCardRowProps) {
  const slugKey =
    teamSlug ??
    (teamName ? teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "");
  const teamMeta = slugKey ? NBA_TEAM_META[slugKey] : undefined;
  const accentColor = teamMeta?.color ?? "#52525b";

  return (
    <div
      className="jam-card-container relative overflow-hidden rounded-xl border border-white/8 bg-[#0b101b]"
      style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}
    >
      <div className="jam-card-inner text-xs">
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={!onToggleExpand}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
            onToggleExpand ? "cursor-pointer" : "cursor-default"
          }`}
        >
          {leftBadge && <div className="shrink-0">{leftBadge}</div>}

          {/* 36x36 Sorare Portrait Thumbnail + Rarity Pip */}
          <div className="jam-avatar-box relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-900">
            {pictureUrl ? (
              <img
                src={pictureUrl}
                alt={playerName}
                loading="lazy"
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-slate-300">
                {teamMeta?.abbr ?? teamInitials(playerName)}
              </div>
            )}
            <span
              className={`absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full ring-1 ring-black/80 ${rarityPipColor(rarity)}`}
            />
          </div>

          {/* 2-Line Typography */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-slate-100">
                {playerName}
              </span>
              {statusBadge}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] tabular-nums text-slate-400">
              {subline}
            </div>
          </div>
        </button>

        {/* Hero Right Metric & Optional Button */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right tabular-nums">
            <div className="font-semibold">{heroRight}</div>
            {subRight && (
              <div className="text-[10px] text-slate-400">{subRight}</div>
            )}
          </div>
          {actionRight}
        </div>
      </div>

      {expandedContent && (
        <div className="border-t border-white/6 bg-black/25 px-2.5 py-1.5 text-[10px] text-slate-300">
          {expandedContent}
        </div>
      )}
    </div>
  );
}

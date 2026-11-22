import { NBA_TEAM_META } from "../../shared/constants";
import type { CardRarity } from "../../shared/types";

export interface LineupCardPreviewItem {
  key: string;
  playerName: string;
  teamSlug?: string | null;
  rarity: CardRarity;
  pictureUrl?: string | null;
  starCost?: number | null;
  projectedPts?: number | null;
  avgMinutes?: number | null;
  badge?: string | null;
  isCaptain?: boolean;
}

interface LineupCardStripProps {
  cards: LineupCardPreviewItem[];
  compact?: boolean;
}

function rarityFrameClass(rarity: CardRarity): string {
  switch (rarity) {
    case "limited":
      return "border-amber-400/45 bg-gradient-to-b from-amber-500/15 to-black/60";
    case "rare":
      return "border-rose-400/45 bg-gradient-to-b from-rose-500/15 to-black/60";
    case "super_rare":
      return "border-sky-400/45 bg-gradient-to-b from-sky-500/15 to-black/60";
    case "unique":
      return "border-violet-400/45 bg-gradient-to-b from-violet-500/15 to-black/60";
    case "common":
    default:
      return "border-set-400/35 bg-gradient-to-b from-white/10 to-black/60";
  }
}

function shortLastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.slice(0, 10);
  const last = parts[parts.length - 1];
  return last.length > 10 ? `${last.slice(0, 9)}.` : last;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Compact 5-card Sorare lineup preview deck displaying live Sorare card artwork,
 * rarity frame accents, star rating, and projected points with zero layout shift.
 */
export function LineupCardStrip({ cards, compact = false }: LineupCardStripProps) {
  if (cards.length === 0) return null;

  return (
    <div
      className="grid grid-cols-5 gap-1.5"
      role="list"
      aria-label="Lineup card previews"
    >
      {cards.slice(0, 5).map((card) => {
        const meta = card.teamSlug ? NBA_TEAM_META[card.teamSlug] : undefined;
        return (
          <div
            key={card.key}
            role="listitem"
            title={`${card.playerName}${card.projectedPts ? ` (${card.projectedPts.toFixed(1)} pts)` : ""}`}
            className={`jam-card-preview relative overflow-hidden rounded-lg border ${rarityFrameClass(card.rarity)} shadow-sm`}
          >
            {/* Card artwork container with fixed 5:7 aspect ratio to prevent CLS */}
            <div
              className={`relative w-full overflow-hidden bg-zinc-950/80 ${
                compact ? "aspect-[4/5]" : "aspect-[5/7]"
              }`}
            >
              {card.pictureUrl ? (
                <img
                  src={card.pictureUrl}
                  alt={card.playerName}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div
                  className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-bold text-slate-300"
                  style={{
                    background: meta?.color
                      ? `radial-gradient(circle at 50% 35%, ${meta.color}40, #090b10 80%)`
                      : undefined,
                  }}
                >
                  <span>{meta?.abbr ?? initialsOf(card.playerName)}</span>
                </div>
              )}

              {/* Subtle bottom gradient for legibility */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

              {/* Top-left star / badge */}
              {typeof card.starCost === "number" && card.starCost > 0 && (
                <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[8.5px] font-bold leading-none text-amber-300 backdrop-blur-xs">
                  {card.starCost}★
                </span>
              )}

              {/* Top-right MVP / C / custom badge */}
              {(card.isCaptain || card.badge) && (
                <span className="absolute right-1 top-1 rounded bg-sky-500/85 px-1 py-0.5 text-[8px] font-bold leading-none text-slate-950">
                  {card.badge ?? "C"}
                </span>
              )}

              {/* Bottom overlay: name + projected score */}
              <div className="absolute inset-x-0 bottom-0 px-1 pb-1 pt-0.5 text-center leading-tight">
                <div className="truncate text-[9px] font-semibold text-white">
                  {shortLastName(card.playerName)}
                </div>
                {typeof card.projectedPts === "number" && (
                  <div className="flex items-center justify-center gap-1 text-[9px] font-bold tabular-nums">
                    <span className="text-emerald-300">{card.projectedPts.toFixed(1)}</span>
                    {typeof card.avgMinutes === "number" && card.avgMinutes > 0 && (
                      <span
                        className={
                          card.avgMinutes < 20
                            ? "rounded bg-amber-500/30 px-0.5 text-[7.5px] font-semibold text-amber-200"
                            : "text-[8px] font-medium text-slate-300"
                        }
                        title={
                          card.avgMinutes < 20
                            ? `Bench role (${Math.round(card.avgMinutes)} min/game)`
                            : `Season average ${Math.round(card.avgMinutes)} min/game`
                        }
                      >
                        {card.avgMinutes < 20 ? "Bench" : `${Math.round(card.avgMinutes)}m`}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

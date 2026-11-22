import { Activity, ArrowUpRight, UserMinus } from "lucide-react";
import type { TeamInjuryImpact } from "../../calculators/injuryImpactMath";
import { NBA_POSITION_LABELS, NBA_TEAM_META } from "../../shared/constants";

interface InjuryImpactPanelProps {
  impacts: TeamInjuryImpact[];
}

/**
 * Position-aware "Who Steps Up" injury impact card showing OUT/DOUBTFUL players
 * and healthy teammates weighted by exact/adjacent position match.
 */
export function InjuryImpactPanel({ impacts }: InjuryImpactPanelProps) {
  if (impacts.length === 0) return null;

  return (
    <details
      id="sec-injury-impact"
      open
      className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]"
    >
      <summary className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-slate-100 hover:bg-white/3">
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-rose-400" />
          Who Steps Up (Position-Aware Injury Impact)
        </span>
        <span className="jam-chip jam-chip-live">{impacts.length} teams</span>
      </summary>

      <div className="space-y-2 border-t border-white/6 p-2.5">
        <p className="text-[10px] text-slate-400">
          Healthy teammates ranked by position overlap with OUT/DOUBTFUL starters. Exact position matches (G/F/C) absorb the biggest usage bump.
        </p>

        {impacts.map((team) => {
          const meta = NBA_TEAM_META[team.teamSlug];
          return (
            <div
              key={team.teamSlug}
              className="rounded-xl border border-white/8 bg-[#0b101b] p-2"
              style={{
                borderLeftWidth: "3px",
                borderLeftColor: meta?.color ?? "#f43f5e",
              }}
            >
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-[10.5px]">
                <span className="font-semibold text-slate-100">
                  {team.teamName}{" "}
                  <span className="text-[10px] font-normal text-slate-400">
                    ({team.gamesInSlate}G)
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {team.injuredPlayers.map((inj) => (
                    <span
                      key={inj.normalizedName}
                      className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-rose-200"
                      title={inj.comment || `${inj.playerName} ${inj.status}`}
                    >
                      <UserMinus className="h-2.5 w-2.5" />
                      {inj.playerName} ({inj.status === "OUT" ? "OUT" : "DBT"}
                      {inj.positions.length > 0
                        ? ` · ${inj.positions.map((p) => NBA_POSITION_LABELS[p] ?? p).join("/")}`
                        : ""})
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                {team.beneficiaries.map((b) => (
                  <div
                    key={b.card.slug}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-white/[0.025] px-2 py-1 text-[10.5px]"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {b.card.pictureUrl ? (
                        <img
                          src={b.card.pictureUrl}
                          alt={b.card.playerName}
                          loading="lazy"
                          decoding="async"
                          className="h-6 w-6 shrink-0 rounded-md object-cover object-top border border-white/10"
                        />
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/8 text-[9px] font-bold text-slate-300">
                          {b.card.positions[0] ? NBA_POSITION_LABELS[b.card.positions[0]] : "F"}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-semibold text-slate-100">
                            {b.card.playerName}
                          </span>
                          {b.isOwned && (
                            <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] font-semibold text-emerald-300">
                              OWNED
                            </span>
                          )}
                          <span
                            className={`rounded px-1 py-0.2 text-[9px] font-semibold ${
                              b.positionMatch === "EXACT"
                                ? "bg-sky-500/20 text-sky-200"
                                : b.positionMatch === "ADJACENT"
                                  ? "bg-amber-500/15 text-amber-200"
                                  : "bg-white/8 text-slate-400"
                            }`}
                          >
                            {b.card.positions.map((p) => NBA_POSITION_LABELS[p] ?? p).join("/") || "UTIL"} ·{" "}
                            {b.positionMatch === "EXACT"
                              ? "Exact"
                              : b.positionMatch === "ADJACENT"
                                ? "Adj"
                                : "Team"}
                          </span>
                        </div>
                        <div className="truncate text-[9.5px] text-slate-400">
                          {b.reason}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right tabular-nums">
                      <div className="inline-flex items-center gap-0.5 font-bold text-emerald-300">
                        <ArrowUpRight className="h-3 w-3" />+{b.estimatedBoostPts.toFixed(1)}
                      </div>
                      <div className="text-[9.5px] text-slate-400">
                        {b.boostedProjPts.toFixed(1)} est
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

import { Target } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DAILY_MISSIONS,
  buildDailyPickIdeas,
  type DailyMission,
  type OwnershipFilter,
  type PickStrategy,
} from "../../calculators/dailyPicksMath";
import { buildProPlayUrl, buildSetPlayUrl } from "../../shared/routes";
import type { DailyPickerPool, GalleryResult } from "../../shared/types";
import { applyLineupHighlight } from "../api";
import { GoButton } from "./GoButton";

interface DailyPlayHubProps {
  gallery: GalleryResult | null;
  pool: DailyPickerPool | null;
  missions: DailyMission[];
}

const STRATEGIES: Array<{ id: PickStrategy; label: string; hint: string }> = [
  { id: "best", label: "Best odds", hint: "Highest chance to hit the target" },
  { id: "safe", label: "Safe", hint: "Good odds with no risk flags (injury, cold form, low minutes)" },
  { id: "risk", label: "Risk / upside", hint: "Hot form, a star teammate OUT, or big minutes: can beat their usual numbers" },
];

const OWNERSHIP: Array<{ id: OwnershipFilter; label: string }> = [
  { id: "owned", label: "Mine" },
  { id: "not_owned", label: "Not owned" },
  { id: "all", label: "All" },
];

function missionUrl(mission: DailyMission): string {
  return mission === "set_daily" ? `${buildSetPlayUrl("arcade")}?missions=play` : `${buildProPlayUrl()}/missions/play/limited`;
}

function Chip({ active, label, title, onClick }: { active: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition ${
        active ? "border-sky-300/60 bg-sky-500/20 text-sky-100" : "border-white/10 text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

/** Daily missions guide: best, safe and risk picks from your cards (and not-owned for comparison). */
export function DailyPlayHub({ gallery, pool, missions }: DailyPlayHubProps) {
  const [mission, setMission] = useState<DailyMission>(missions[0]);
  const [strategy, setStrategy] = useState<PickStrategy>("best");
  const [ownership, setOwnership] = useState<OwnershipFilter>("owned");
  const info = DAILY_MISSIONS[mission];

  const ideas = useMemo(() => {
    if (!gallery) return [];
    return buildDailyPickIdeas({
      mission,
      strategy,
      ownership,
      ownedCards: [...gallery.cards, ...gallery.commonCards],
      extraPlayers: pool?.rosterCards ?? [],
      injuriesByName: gallery.injuriesByName,
      slateTeamSlugs: pool?.window.teamSlugs ?? [],
      statsByName: pool?.statsByName ?? {},
      limit: 8,
    });
  }, [gallery, mission, ownership, pool, strategy]);

  return (
    <div className="rounded-2xl border border-emerald-400/25 bg-[#111726] p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs font-semibold text-slate-100">Daily Play: {info.title}</span>
        </div>
        <GoButton url={missionUrl(mission)} title={`Open ${info.title} on Sorare`} />
      </div>
      <div className="mb-1 text-[10px] text-slate-400">
        {info.rule} • {info.reward} • {info.picks} pick{info.picks > 1 ? "s" : ""} • only your own {info.rarity} cards can be picked
      </div>
      {pool && (
        <div className="mb-1.5 text-[10px] text-slate-400">
          {pool.window.games.length > 0
            ? `Daily slate until ${new Date(pool.window.endIso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}: ${pool.window.games
                .map((g) => `${g.awayAbbr}@${g.homeAbbr} ${new Date(g.tipOffIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`)
                .join(" • ")}`
            : "No NBA games before the next daily reset."}
          {pool.rosterCards.length === 0 && pool.window.games.length > 0 && " (add an API key to also see players you don't own)"}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1">
        {missions.length > 1 &&
          missions.map((m) => (
            <Chip key={m} active={mission === m} label={DAILY_MISSIONS[m].title} onClick={() => setMission(m)} />
          ))}
        <span className="mx-1 h-3 w-px bg-white/10" />
        {STRATEGIES.map((s) => (
          <Chip key={s.id} active={strategy === s.id} label={s.label} title={s.hint} onClick={() => setStrategy(s.id)} />
        ))}
        <span className="mx-1 h-3 w-px bg-white/10" />
        {OWNERSHIP.map((o) => (
          <Chip key={o.id} active={ownership === o.id} label={o.label} onClick={() => setOwnership(o.id)} />
        ))}
      </div>

      {!gallery ? (
        <div className="text-xs text-slate-400">Click Refresh above to load your cards for daily picks.</div>
      ) : ideas.length === 0 ? (
        <div className="text-xs text-slate-400">
          No {strategy === "risk" ? "upside " : ""}picks for this filter
          {mission === "rebounds" && !pool?.statsByName ? " (rebound stats load with the daily slate)" : ""}.
        </div>
      ) : (
        <ul className="space-y-1">
          {ideas.map((idea) => (
            <li
              key={`${idea.card.slug}-${idea.mission}`}
              title={idea.owned ? idea.reason : `You don't own a ${info.rarity} card of this player. ${idea.reason}`}
              className={`flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1.5 text-[11px] ${
                idea.owned ? "" : "opacity-50 grayscale"
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1 font-semibold text-slate-100">
                  <span className="truncate">{idea.card.playerName}</span>
                  {!idea.owned && (
                    <span className="rounded bg-slate-600/40 px-1 text-[9px] font-semibold text-slate-200">Not owned</span>
                  )}
                  <span className="text-[10px] font-normal text-slate-400">{idea.card.teamName ?? ""}</span>
                </div>
                <div className="truncate text-[10px] text-slate-400">
                  Exp {idea.expected} • need {idea.targetLabel} • {idea.reason}
                </div>
                {(idea.upsideTags.length > 0 || idea.riskTags.length > 0) && (
                  <div className="flex flex-wrap gap-1 text-[9.5px]">
                    {idea.upsideTags.map((t) => (
                      <span key={t} className="text-emerald-300">
                        ▲ {t}
                      </span>
                    ))}
                    {idea.riskTags.map((t) => (
                      <span key={t} className="text-rose-300">
                        ▼ {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="font-bold text-emerald-300">{idea.hitPct}%</span>
                <button
                  type="button"
                  disabled={!idea.owned}
                  onClick={() =>
                    void applyLineupHighlight([idea.card.playerName], info.title, idea.expected, [
                      {
                        slotLabel: "PICK",
                        cardSlug: idea.card.slug,
                        playerName: idea.card.playerName,
                        rarity: idea.card.rarity,
                        seasonYear: idea.card.seasonYear,
                        isCaptain: false,
                      },
                    ])
                  }
                  className="rounded-lg bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  Pin
                </button>
                <GoButton url={missionUrl(mission)} title={`Open ${info.title} on Sorare`} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

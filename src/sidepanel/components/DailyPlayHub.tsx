import { RefreshCw, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DAILY_MISSIONS,
  buildDailyPickIdeas,
  parsePickerMission,
  type DailyMission,
  type OwnershipFilter,
  type PickerMissionSpec,
  type PickStrategy,
} from "../../calculators/dailyPicksMath";
import { nextDailyResetMs } from "../../calculators/countdownMath";
import { buildProPlayUrl, buildSetPlayUrl } from "../../shared/routes";
import type { DailyPickerPool, GalleryResult, PickerMissionsByMode } from "../../shared/types";
import { applyLineupHighlight, getPickerMissions, scanPickerMissions } from "../api";
import { GoButton } from "./GoButton";

interface DailyPlayHubProps {
  gallery: GalleryResult | null;
  pool: DailyPickerPool | null;
  poolLoading?: boolean;
  /** Re-fetch today's slate and scan the slate teams' rosters (players you don't own). */
  onRefreshPool?: () => void;
  missions: DailyMission[];
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

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

function missionUrl(mission: PickerMissionSpec): string {
  return mission.rarity === "common" ? `${buildSetPlayUrl("arcade")}?missions=play` : `${buildProPlayUrl()}/missions/play/limited`;
}

/** Last 07:00 UTC daily reset before now: detected missions older than that are yesterday's. */
function lastResetMs(nowMs: number): number {
  return nextDailyResetMs(nowMs) - 24 * 3_600_000;
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
export function DailyPlayHub({ gallery, pool, poolLoading, onRefreshPool, missions }: DailyPlayHubProps) {
  const mode: "pro" | "set" = missions.includes("set_daily") ? "set" : "pro";
  const [detected, setDetected] = useState<PickerMissionsByMode>({});
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      getPickerMissions()
        .then(setDetected)
        .catch(() => {});
    load();
    // Instant update when watchMissionPages() writes new missions to storage on SPA navigation.
    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && changes.picker_missions_v1?.newValue) {
        setDetected(changes.picker_missions_v1.newValue as PickerMissionsByMode);
      }
    };
    chrome.storage?.onChanged?.addListener(onStorageChange);
    // Fallback poll in case storage events were missed.
    const timer = setInterval(load, 30_000);
    return () => {
      chrome.storage?.onChanged?.removeListener(onStorageChange);
      clearInterval(timer);
    };
  }, []);

  const snapshot = detected[mode];
  const fresh = snapshot ? snapshot.scannedAt >= lastResetMs(Date.now()) : false;
  const specs: PickerMissionSpec[] = useMemo(() => {
    if (snapshot && fresh && snapshot.tasks.length > 0) {
      return snapshot.tasks.map((t) => {
        const spec = parsePickerMission(t, mode === "set" ? "common" : "limited");
        // Some tasks (Set Daily Picker) have no reward text: borrow the matching preset's.
        const preset = Object.values(DAILY_MISSIONS).find((p) => p.kind === spec.kind && p.rarity === spec.rarity);
        return spec.reward === "See Sorare" && preset ? { ...spec, reward: preset.reward } : spec;
      });
    }
    return missions.map((m) => DAILY_MISSIONS[m]);
  }, [fresh, missions, mode, snapshot]);

  const [missionId, setMissionId] = useState<string>("");
  const info = specs.find((s) => s.id === missionId) ?? specs[0];
  const [strategy, setStrategy] = useState<PickStrategy>("best");
  const [ownership, setOwnership] = useState<OwnershipFilter>("owned");

  const scan = () => {
    setScanBusy(true);
    setScanError(null);
    scanPickerMissions()
      .then(setDetected)
      .catch((e: unknown) => setScanError(e instanceof Error ? e.message : String(e)))
      .finally(() => setScanBusy(false));
  };

  const ideas = useMemo(() => {
    if (!gallery) return [];
    return buildDailyPickIdeas({
      mission: info,
      strategy,
      ownership,
      ownedCards: [...gallery.cards, ...gallery.commonCards],
      extraPlayers: pool?.rosterCards ?? [],
      injuriesByName: gallery.injuriesByName,
      slateTeamSlugs: pool?.window.teamSlugs ?? [],
      statsByName: pool?.statsByName ?? {},
      limit: 8,
    });
  }, [gallery, info, ownership, pool, strategy]);

  return (
    <div className="rounded-2xl border border-white/8 bg-[#111726] p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-slate-300" />
          <span className="text-xs font-semibold text-slate-100">Daily Play: {info.title}</span>
        </div>
        <GoButton url={missionUrl(info)} title={`Open ${info.title} on Sorare`} />
      </div>
      <div className="mb-1 text-[10px] text-slate-400">
        {info.rule}
        {info.maxStars != null && (
          <span className="ml-1 inline-flex items-center rounded bg-amber-400/15 px-1 py-px font-semibold text-amber-200">
            &lt;= {info.maxStars}★
          </span>
        )}{" "}
        • {info.reward} • {info.picks} pick{info.picks > 1 ? "s" : ""} • only your own {info.rarity} cards can be picked
      </div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px]">
        {snapshot && fresh ? (
          <span className="text-slate-300">
            ✓ Today's pickers synced from Sorare ({new Date(snapshot.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
          </span>
        ) : (
          <span className="text-amber-300">
            {snapshot ? "Pickers are from yesterday" : "Using default pickers"}: open Sorare's missions (Go) to sync today's, it updates on its own.
          </span>
        )}
        <button
          type="button"
          disabled={scanBusy}
          onClick={scan}
          title="Read today's daily pickers from your open Sorare missions tab"
          className="jam-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${scanBusy ? "animate-spin" : ""}`} />
          Scan missions
        </button>
        {scanError && <span className="text-rose-300">{scanError}</span>}
      </div>
      {pool && pool.window.rolledToNext && (
        <details className="mb-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
          <summary className="cursor-pointer truncate">
            Showing the <strong>next</strong> Daily Picker (opens {fmtDay(pool.window.startIso)}) <span className="text-amber-300/70">more</span>
          </summary>
          Today's picker games have all tipped off ({(pool.window.lockedGames ?? []).map((g) => `${g.awayAbbr}@${g.homeAbbr}`).join(", ") || "picks locked"}), so the picks below are for the next one, which opens at the reset.
        </details>
      )}
      {pool && (
        <div className="mb-1.5 text-[10px] text-slate-400">
          {pool.window.games.length > 0
            ? `${pool.window.rolledToNext ? "Next" : "Today's"} slate until ${fmtDay(pool.window.endIso)}: ${pool.window.games
                .map((g) => `${g.awayAbbr}@${g.homeAbbr} ${fmtTime(g.tipOffIso)}`)
                .join(" • ")}`
            : "No NBA games before the next daily reset."}
          <span className="ml-1 text-slate-500">(updated {fmtTime(new Date(pool.fetchedAt).toISOString())})</span>
        </div>
      )}
      {pool && pool.window.games.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
          <span>
            Not-owned players: {pool.rosterCards.length} from {pool.rosterTeamsLoaded ?? 0}/{pool.rosterTeamsRequested ?? pool.window.teamSlugs.length} teams
            {pool.rosterError ? ` (scan failed: ${pool.rosterError.slice(0, 90)})` : ""}
          </span>
          {onRefreshPool && (
            <button
              type="button"
              disabled={poolLoading}
              onClick={onRefreshPool}
              title="Re-check today's games and scan their rosters for players you don't own"
              className="inline-flex items-center gap-1 rounded-lg border border-sky-300/40 px-2 py-0.5 font-semibold text-sky-200 hover:bg-sky-500/15 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${poolLoading ? "animate-spin" : ""}`} />
              {poolLoading ? "Scanning..." : "Scan not-owned / refresh slate"}
            </button>
          )}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1">
        {specs.length > 1 &&
          specs.map((m) => (
            <Chip key={m.id} active={info.id === m.id} label={m.title} onClick={() => setMissionId(m.id)} />
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
          {info.kind !== "score" && !pool?.statsByName ? " (player stats load with the daily slate)" : ""}
          {ownership !== "owned" && (pool?.rosterCards.length ?? 0) === 0 ? ": no not-owned players loaded yet, use Scan not-owned above" : ""}.
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
                <GoButton url={missionUrl(info)} title={`Open ${info.title} on Sorare`} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import {
  BookOpen,
  Calculator,
  CheckSquare,
  Layers,
  Lock,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyLineupBonus,
  calculateSorareNbaScore,
  SORARE_NBA_SCORING_WEIGHTS,
  type NbaBoxScoreInput,
} from "../../calculators/nbaScoringMath";

type GuideTabId =
  | "scoring"
  | "competitions"
  | "stars"
  | "vault"
  | "set"
  | "checklist"
  | "math";

interface GuidesModalProps {
  initialTab?: GuideTabId;
  onClose: () => void;
}

const CHECKLIST_STORAGE_KEY = "jamassist_prelock_checklist_v1";

const PRELOCK_CHECKLIST_ITEMS: Array<{ id: string; title: string; detail: string }> = [
  {
    id: "injuries",
    title: "Check ESPN injury tags (OUT / Doubtful / GTD)",
    detail: "Swap out any OUT or late-scratched starter before Game Week lock.",
  },
  {
    id: "schedule-0g",
    title: "Verify every starter has >= 1 game (no 0G cards)",
    detail: "Prioritize 3G-4G slates for higher peak-game ceilings and avoid 0G bye teams.",
  },
  {
    id: "max-4-team",
    title: "Confirm <= 4 players from any single NBA team",
    detail: "Sorare NBA caps every 5-card lineup at a maximum of 4 players per NBA team.",
  },
  {
    id: "delist-cards",
    title: "Delist core & Team Collection cards before lock",
    detail: "Listed cards do not count toward Team Collection Bonus % thresholds while listed.",
  },
  {
    id: "season-cap",
    title: "Verify 4 In-Season + 1 Classic & Star Cap (16★ / 11★)",
    detail: "In-Season competitions require at least 4 current 2026-27 cards and fit your star cap.",
  },
  {
    id: "daily-reset",
    title: "Claim Free Daily Pack & submit Daily Picker before 07:00 UTC",
    detail: "Daily missions and Set Arcade picks reset at 07:00 UTC every day.",
  },
];

const BOX_SCORE_PRESETS: Array<{ label: string; stats: NbaBoxScoreInput }> = [
  {
    label: "3-and-D Wing",
    stats: { points: 14, rebounds: 5, assists: 2, steals: 2, blocks: 1, turnovers: 1, threePointersMade: 3 },
  },
  {
    label: "All-Star Guard",
    stats: { points: 28, rebounds: 5, assists: 9, steals: 2, blocks: 0, turnovers: 3, threePointersMade: 4 },
  },
  {
    label: "Triple-Double Big",
    stats: { points: 24, rebounds: 13, assists: 10, steals: 1, blocks: 2, turnovers: 3, threePointersMade: 1 },
  },
];

const STAR_BRACKETS: Array<{ stars: string; l10: string; role: string }> = [
  { stars: "5.0★", l10: "50+", role: "MVP superstar anchor" },
  { stars: "4.5★", l10: "44 - 49.9", role: "Elite 1st option" },
  { stars: "4.0★", l10: "38 - 43.9", role: "All-Star core" },
  { stars: "3.5★", l10: "32 - 37.9", role: "High-usage starter" },
  { stars: "3.0★", l10: "26 - 31.9", role: "Solid starter / Contender anchor" },
  { stars: "2.5★", l10: "21 - 25.9", role: "Mid-cap value starter" },
  { stars: "2.0★", l10: "16 - 20.9", role: "Rotation / 6th man" },
  { stars: "1.5★", l10: "11 - 15.9", role: "Cap enabler / upside bench" },
  { stars: "1.0★", l10: "< 11", role: "Minimum-cap punt / injury-return steal" },
];

const SEALING_TIERS = [
  { tier: "Tier 5 / Bench", sp: "1 SP", note: "Lowest-L10 bench & inactive cards" },
  { tier: "Tier 4 / Rotation", sp: "2 SP", note: "Standard rotation spares" },
  { tier: "Tier 3 / Starter", sp: "5 SP", note: "Mid-tier starters" },
  { tier: "Tier 2 / Key Starter", sp: "20 SP", note: "Strong starters & young core" },
  { tier: "Tier 1 / All-Star", sp: "50 SP", note: "High-tier All-Stars" },
  { tier: "Tier 0 / Superstar", sp: "200 SP", note: "Franchise icons (Rare+)" },
];

const GUIDE_TABS: Array<{ id: GuideTabId; label: string; icon: typeof BookOpen }> = [
  { id: "scoring", label: "Scoring", icon: Calculator },
  { id: "competitions", label: "Competitions", icon: Trophy },
  { id: "stars", label: "Stars & Boosts", icon: Sparkles },
  { id: "vault", label: "Vault", icon: Lock },
  { id: "set", label: "Set / F2P", icon: Layers },
  { id: "checklist", label: "Pre-Lock", icon: CheckSquare },
  { id: "math", label: "Math & Privacy", icon: ShieldCheck },
];

function loadChecklistState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function GuidesModal({ initialTab = "scoring", onClose }: GuidesModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeTab, setActiveTab] = useState<GuideTabId>(initialTab);
  const [boxScore, setBoxScore] = useState<NbaBoxScoreInput>(BOX_SCORE_PRESETS[1].stats);
  const [bonusPct, setBonusPct] = useState<number>(5);
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => loadChecklistState());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    const onCloseEvent = () => onClose();
    dialog.addEventListener("close", onCloseEvent);

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
    };

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
    }

    return () => {
      dialog.removeEventListener("close", onCloseEvent);
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointerup", onPointerUp);
    };
  }, [onClose]);

  const calc = useMemo(() => calculateSorareNbaScore(boxScore), [boxScore]);
  const boostedTotal = useMemo(
    () => applyLineupBonus(calc.totalScore, bonusPct),
    [calc.totalScore, bonusPct],
  );

  const toggleChecklist = (id: string) => {
    setCheckedMap((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  };

  const resetChecklist = () => {
    setCheckedMap({});
    try {
      localStorage.removeItem(CHECKLIST_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const checkedCount = PRELOCK_CHECKLIST_ITEMS.filter((item) => checkedMap[item.id]).length;

  const updateStat = (field: keyof NbaBoxScoreInput, raw: string) => {
    const num = Math.max(0, Math.min(99, Math.floor(Number(raw) || 0)));
    setBoxScore((prev) => ({ ...prev, [field]: num }));
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as Record<string, string>)}
      aria-labelledby="guides-hub-title"
      className="m-auto w-[min(95vw,440px)] max-h-[88vh] overflow-hidden rounded-2xl border border-white/12 bg-[#0d111a] p-0 text-slate-100 shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex max-h-[88vh] flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-[#121723] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-sky-400" />
            <h2 id="guides-hub-title" className="text-xs font-bold tracking-tight text-slate-100">
              Guides &amp; Strategy Hub
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close guides"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Section Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-white/8 bg-[#0f1420] px-3 py-2" role="tablist">
          {GUIDE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold transition ${
                  active
                    ? "border-sky-400/50 bg-sky-500/20 text-sky-100"
                    : "border-white/8 bg-white/[0.03] text-slate-400 hover:border-white/15 hover:text-slate-200"
                }`}
              >
                <Icon className="h-3 w-3" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-[11px] leading-relaxed text-slate-300">
          {activeTab === "scoring" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5">
                <div className="mb-1.5 text-[11px] font-bold text-slate-100">
                  Sorare NBA Scoring Matrix
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">PTS</span>{" "}
                    <span className="float-right font-bold text-emerald-300">+{SORARE_NBA_SCORING_WEIGHTS.points}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">REB</span>{" "}
                    <span className="float-right font-bold text-emerald-300">+{SORARE_NBA_SCORING_WEIGHTS.rebounds}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">AST</span>{" "}
                    <span className="float-right font-bold text-emerald-300">+{SORARE_NBA_SCORING_WEIGHTS.assists}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">STL</span>{" "}
                    <span className="float-right font-bold text-sky-300">+{SORARE_NBA_SCORING_WEIGHTS.steals}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">BLK</span>{" "}
                    <span className="float-right font-bold text-sky-300">+{SORARE_NBA_SCORING_WEIGHTS.blocks}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">TO</span>{" "}
                    <span className="float-right font-bold text-rose-300">{SORARE_NBA_SCORING_WEIGHTS.turnovers}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">3PM</span>{" "}
                    <span className="float-right font-bold text-emerald-300">+{SORARE_NBA_SCORING_WEIGHTS.threePointersMade}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">DD</span>{" "}
                    <span className="float-right font-bold text-amber-300">+{SORARE_NBA_SCORING_WEIGHTS.doubleDouble}</span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-[#0b101b] px-2 py-1">
                    <span className="text-slate-400">TD</span>{" "}
                    <span className="float-right font-bold text-amber-300">+1 (+2 tot)</span>
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400">
                  Stocks (STL + BLK = +3 each) and low turnovers (-2) drive outsized Sorare edges.
                  A Triple-Double earns +1 DD plus +1 TD (+2 cumulative).
                </p>
              </div>

              <div className="rounded-xl border border-sky-400/20 bg-[#101727] p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-[11px] font-bold text-sky-200">Interactive Box-Score Calculator</span>
                  <div className="flex flex-wrap gap-1">
                    {BOX_SCORE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setBoxScore(preset.stats)}
                        className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9.5px] font-medium text-slate-300 hover:border-sky-400/40 hover:text-white"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      ["points", "PTS"],
                      ["rebounds", "REB"],
                      ["assists", "AST"],
                      ["steals", "STL"],
                      ["blocks", "BLK"],
                      ["turnovers", "TO"],
                      ["threePointersMade", "3PM"],
                    ] as Array<[keyof NbaBoxScoreInput, string]>
                  ).map(([field, label]) => (
                    <label key={field} className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                      <span>{label}</span>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={boxScore[field]}
                        onChange={(e) => updateStat(field, e.target.value)}
                        aria-label={`Box score ${label}`}
                        className="rounded-lg border border-white/10 bg-[#0a0f1a] px-2 py-1 text-xs font-semibold text-slate-100 focus:border-sky-400 focus:outline-none"
                      />
                    </label>
                  ))}
                  <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                    <span>Bonus %</span>
                    <input
                      type="number"
                      min={0}
                      max={40}
                      value={bonusPct}
                      onChange={(e) => setBonusPct(Math.max(0, Math.min(40, Number(e.target.value) || 0)))}
                      aria-label="Card bonus percentage"
                      className="rounded-lg border border-white/10 bg-[#0a0f1a] px-2 py-1 text-xs font-semibold text-amber-200 focus:border-amber-400 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-white/8 bg-[#0b101b] px-2.5 py-2">
                  <div>
                    <div className="text-[10px] text-slate-400">
                      Base Score
                      {calc.doubleDoubleBonus > 0 && (
                        <span className="ml-1.5 rounded bg-amber-500/20 px-1 py-0.5 text-[9.5px] font-semibold text-amber-200">
                          {calc.tripleDoubleBonus > 0 ? "TD (+2)" : "DD (+1)"}
                        </span>
                      )}
                    </div>
                    <div className="text-base font-extrabold text-slate-100">{calc.totalScore.toFixed(1)} pts</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">With +{bonusPct}% Bonus</div>
                    <div className="text-base font-extrabold text-emerald-300">{boostedTotal.toFixed(1)} pts</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "competitions" && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5 space-y-1.5">
                <div className="font-bold text-slate-100">2026-27 Pro &amp; Arena Caps</div>
                <ul className="list-disc space-y-1 pl-4 text-[10.5px] text-slate-300">
                  <li>
                    <strong className="text-slate-100">Champion (16★ Cap):</strong> 5 cards, max 4 per NBA team, no position locks, no Captain multiplier. In-Season requires 4+ 2026-27 cards (up to 1 Classic card allowed). Up to 5 entries.
                  </li>
                  <li>
                    <strong className="text-slate-100">Contender (11★ Cap):</strong> 5 cards, max 4 per NBA team. Rewards value-per-star efficiency and breakout 1.5★-2.5★ starters.
                  </li>
                  <li>
                    <strong className="text-slate-100">Classic Boards:</strong> Any season eligible, max 4 per NBA team, lower entry limits (3 in Limited) and steeper paid cutoffs than In-Season.
                  </li>
                  <li>
                    <strong className="text-slate-100">Arena Rooms:</strong> 10-manager pods (50% paid) in Contender 11★, Champion 16★, Uncapped, U23 11★ (age &lt;= 23), and Veterans 11★ (age &gt;= 30).
                  </li>
                </ul>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5 space-y-1">
                <div className="font-bold text-slate-100">Multi-Game Peak-Score Strategy</div>
                <p className="text-[10.5px] text-slate-300">
                  Sorare NBA counts each player&apos;s <strong className="text-slate-100">single highest game</strong> during the Game Week (not the average). A player with 3 or 4 games in a GW gets multiple rolls at a ceiling game (~1.19x to 1.24x expected peak vs 1.0x for a 1-game slate).
                </p>
                <p className="text-[10.5px] text-slate-400">
                  Use <strong className="text-slate-200">Safe floor (p10)</strong> for 50%-paid Arena pods and <strong className="text-slate-200">High ceiling (p90)</strong> for top-heavy Pro leaderboards.
                </p>
              </div>
            </div>
          )}

          {activeTab === "stars" && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5">
                <div className="mb-1.5 font-bold text-slate-100">Star Rating Brackets (Rolling L10)</div>
                <div className="space-y-1 text-[10.5px]">
                  {STAR_BRACKETS.map((row) => (
                    <div
                      key={row.stars}
                      className="flex items-center justify-between rounded-md border border-white/6 bg-[#0b101b] px-2 py-1"
                    >
                      <span className="w-10 font-bold text-amber-300">{row.stars}</span>
                      <span className="w-20 text-slate-200">L10 {row.l10}</span>
                      <span className="flex-1 text-right text-slate-400">{row.role}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5 space-y-1.5">
                <div className="font-bold text-slate-100">L10 Shifts &amp; Bonus Stacking</div>
                <ul className="list-disc space-y-1 pl-4 text-[10.5px]">
                  <li>
                    <strong className="text-emerald-300">Value Lock (Form):</strong> When L5 is well above L10, you lock in a cheaper star cost before the rolling L10 rises.
                  </li>
                  <li>
                    <strong className="text-sky-300">Cap Drop:</strong> When L5 drags L10 down, the player&apos;s star cost can drop by 0.5★ for future Contender fits.
                  </li>
                  <li>
                    <strong className="text-slate-100">Stackable Bonuses:</strong> +5% In-Season (2026-27), +1% to +5% Team Collection, +1%/level Card XP (0-10%, halves on sale), and +10% Rare card boost in Champion.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === "vault" && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5 space-y-1.5">
                <div className="font-bold text-slate-100">Vault &amp; Sealing Points Tiers</div>
                <div className="space-y-1 text-[10.5px]">
                  {SEALING_TIERS.map((t) => (
                    <div
                      key={t.sp}
                      className="flex items-center justify-between rounded-md border border-white/6 bg-[#0b101b] px-2 py-1"
                    >
                      <span className="font-semibold text-slate-200">{t.tier}</span>
                      <span className="font-bold text-violet-300">{t.sp}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-2.5 space-y-1">
                <div className="font-bold text-amber-200">Key Rules &amp; Cooldown</div>
                <ul className="list-disc space-y-1 pl-4 text-[10.5px] text-slate-300">
                  <li>
                    <strong className="text-slate-100">14-Day Unseal Cooldown:</strong> Max 1 unseal per scarcity every 14 days. Sealed cards cannot be played or sold until unsealed.
                  </li>
                  <li>
                    <strong className="text-slate-100">Cancel Warning:</strong> Sealing a card immediately cancels any active market listing and any open lineup containing that card.
                  </li>
                  <li>
                    <strong className="text-slate-100">Boost Scope:</strong> Vault Level boosts permanent Pro Cash &amp; Essence leaderboard rewards (Pro cards only; no Common Vault).
                  </li>
                  <li>
                    <strong className="text-slate-100">Seal vs Sell:</strong> Seal spare duplicates and low-L10 bench cards near floor; sell liquid cards whose floor exceeds the rarity sell threshold.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === "set" && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5 space-y-1.5">
                <div className="font-bold text-slate-100">Set (Common) F2P-to-Pro Roadmap</div>
                <ol className="list-decimal space-y-1 pl-4 text-[10.5px]">
                  <li>
                    <strong className="text-slate-100">Daily Routine (07:00 UTC reset):</strong> Claim your free Daily Pack, submit Daily Picker / stat pickers, and finish Bronze+ shop pack missions.
                  </li>
                  <li>
                    <strong className="text-slate-100">Set Solo (Arcade):</strong> Build up to 4 teams under the 16★ cap (4 Lives). Use <em>Prioritize today</em> timing to clear Hot Streak stages (150-290 pts) faster.
                  </li>
                  <li>
                    <strong className="text-slate-100">Set Squad:</strong> Submit 1 team (16★ cap) in a 10-manager squad. The best 3 teams count toward each stage target; failing resets the squad to stage 1.
                  </li>
                  <li>
                    <strong className="text-slate-100">Packs &amp; Scrapping:</strong> Keep 2 copies of core starters, protect Shiny (+5%) / Holo (+10%) editions, and scrap surplus base duplicates for Set Essence (Bronze pack = 1,000E).
                  </li>
                  <li>
                    <strong className="text-slate-100">Divination &amp; Pro Transition:</strong> Seasonal Set editions reset on Divination cycles. Convert Arena/Pro rewards and League Collect Essence into a 4 In-Season + 1 Classic Limited Contender 11★ lineup.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === "checklist" && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-100">
                  Pre-Lock GW Checklist ({checkedCount}/{PRELOCK_CHECKLIST_ITEMS.length})
                </span>
                <button
                  type="button"
                  onClick={resetChecklist}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:border-sky-400/40 hover:text-white"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset GW
                </button>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all"
                  style={{
                    width: `${Math.round((checkedCount / PRELOCK_CHECKLIST_ITEMS.length) * 100)}%`,
                  }}
                />
              </div>

              <div className="space-y-1.5">
                {PRELOCK_CHECKLIST_ITEMS.map((item) => {
                  const done = Boolean(checkedMap[item.id]);
                  return (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2 transition ${
                        done
                          ? "border-emerald-400/30 bg-emerald-500/10"
                          : "border-white/8 bg-[#121826] hover:border-white/15"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => toggleChecklist(item.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-emerald-400"
                      />
                      <div className="min-w-0">
                        <div className={`font-semibold ${done ? "text-emerald-200 line-through" : "text-slate-100"}`}>
                          {item.title}
                        </div>
                        <div className="text-[10px] text-slate-400">{item.detail}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "math" && (
            <div className="space-y-2.5">
              <div className="rounded-xl border border-white/8 bg-[#121826] p-2.5 space-y-1.5">
                <div className="font-bold text-slate-100">Math Transparency</div>
                <ul className="list-disc space-y-1 pl-4 text-[10.5px]">
                  <li>
                    <strong className="text-slate-100">Player Distributions:</strong> Right-skewed log-normal model with unified NBA CV = 0.35 (widened for bench &lt; 15 L10, GTD, B2B, and blowout spreads &gt;= 10).
                  </li>
                  <li>
                    <strong className="text-slate-100">NBA Correlation:</strong> Teammates use rho = -0.05 (shared shot/usage pool), while same-game opponents use rho = +0.06 (pace / overtime shootout lift).
                  </li>
                  <li>
                    <strong className="text-slate-100">Direct Floor / Ceiling DFS:</strong> Safe floor (p10) and High ceiling (p90) optimize totalScore - 1.2816*sd and totalScore + 1.2816*sd directly inside branch-and-bound search.
                  </li>
                  <li>
                    <strong className="text-slate-100">Exact 0/1 Knapsack Sealing:</strong> Sealing Deal Finder packs your budget with exact dynamic programming to maximize total Sealing Points (breaking ties by lowest cost).
                  </li>
                  <li>
                    <strong className="text-slate-100">Honest Market Pricing:</strong> Instant Buy floors never mix in live auction bids or multi-card bundles.
                  </li>
                </ul>
              </div>
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-2.5 space-y-1">
                <div className="font-bold text-emerald-200">Local-Only Privacy FAQ</div>
                <p className="text-[10.5px] text-slate-300">
                  100% local in your browser. No external backend, no analytics, no tracking pixels.
                  Requests go only from your browser to Sorare GraphQL and ESPN public endpoints.
                  Your optional Sorare API key is encrypted on this device and never leaves it.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

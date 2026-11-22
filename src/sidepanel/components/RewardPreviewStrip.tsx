import { DollarSign, Sparkles, Trophy } from "lucide-react";
import type { LeaderboardRewardTier } from "../../shared/types";

interface RewardPreviewStripProps {
  tiers?: LeaderboardRewardTier[] | null;
  expectedCashUsd?: number;
  expectedEssence?: number;
  maxTiers?: number;
}

function rankSpan(t: LeaderboardRewardTier): string {
  return t.fromRank === t.toRank ? `#${t.fromRank}` : `#${t.fromRank}-${t.toRank}`;
}

/**
 * Compact visual preview of live Sorare leaderboard reward tiers (Cash $, Essence, XP)
 * paired with live expected Dollar and Essence EV badges.
 */
export function RewardPreviewStrip({
  tiers,
  expectedCashUsd,
  expectedEssence,
  maxTiers = 4,
}: RewardPreviewStripProps) {
  const list = (tiers ?? []).filter((t) => t.kind !== "xp").slice(0, maxTiers);
  const hasEv =
    (typeof expectedCashUsd === "number" && expectedCashUsd > 0) ||
    (typeof expectedEssence === "number" && expectedEssence > 0);

  if (list.length === 0 && !hasEv) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      {hasEv && (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-emerald-400/35 bg-emerald-500/12 px-1.5 py-0.5 font-semibold text-emerald-200 tabular-nums"
          title="Estimated expected reward value from live Sorare reward tiers and closed-GW cutoffs"
        >
          <Trophy className="h-3 w-3 text-emerald-300" />
          EV:
          {typeof expectedCashUsd === "number" && expectedCashUsd > 0 && (
            <span>${expectedCashUsd.toFixed(2)}</span>
          )}
          {typeof expectedCashUsd === "number" &&
            expectedCashUsd > 0 &&
            typeof expectedEssence === "number" &&
            expectedEssence > 0 && <span className="text-emerald-400/70">+</span>}
          {typeof expectedEssence === "number" && expectedEssence > 0 && (
            <span className="text-violet-200">{Math.round(expectedEssence)}E</span>
          )}
        </span>
      )}

      {list.map((t, i) => {
        const isCash = t.kind === "cash";
        const isEss = t.kind === "essence";
        return (
          <span
            key={`${t.fromRank}-${t.toRank}-${i}`}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 tabular-nums ${
              isCash
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : isEss
                  ? "border-violet-400/30 bg-violet-500/10 text-violet-200"
                  : "border-white/10 bg-white/5 text-slate-300"
            }`}
          >
            {isCash ? (
              <DollarSign className="h-2.5 w-2.5 text-emerald-300" />
            ) : isEss ? (
              <Sparkles className="h-2.5 w-2.5 text-violet-300" />
            ) : null}
            <span className="text-slate-400">{rankSpan(t)}</span>
            <span className="font-semibold">{t.label}</span>
          </span>
        );
      })}
    </div>
  );
}

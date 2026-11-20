import { ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { buildDuplicateAdvice, editionLabel } from "../../calculators/duplicateAdvisorMath";
import type { Currency, GalleryResult } from "../../shared/types";
import { formatMoney } from "../utils/format";

const projection = (c: { sorareClassicProjected: number | null; l10: number | null }) => c.sorareClassicProjected ?? c.l10 ?? 0;

/** Duplicate Sell Advisor: which extra copies to sell (Pro) or scrap (Set), and which to keep. */
export function DuplicateAdvisorSection({ gallery, currency }: { gallery: GalleryResult | null; currency: Currency }) {
  const [pool, setPool] = useState<"pro" | "common">("pro");
  const groups = useMemo(() => {
    if (!gallery) return [];
    const cards = pool === "pro" ? gallery.cards : gallery.commonCards;
    // Lineup-useful = your 15 best projected players in this pool.
    const best = new Set(
      [...cards]
        .sort((a, b) => projection(b) - projection(a))
        .map((c) => c.playerSlug)
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .slice(0, 15),
    );
    return buildDuplicateAdvice(cards, { lineupPlayerSlugs: best, currentLineups: gallery.currentLineups });
  }, [gallery, pool]);

  const flagged = groups.reduce((s, g) => s + g.extras, 0);
  const sellValue = groups.reduce((s, g) => s + g.sellValueCents, 0);

  return (
    <details className="cascade-section overflow-hidden rounded-2xl border border-white/8 bg-[#111726]">
      <summary className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
          <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-amber-300" />
          <Copy className="h-3.5 w-3.5 text-amber-300" />
          Duplicate Sell Advisor
        </span>
        <span className="text-[10px] text-slate-400">
          {flagged} extra{flagged === 1 ? "" : "s"}
          {sellValue > 0 ? ` • ~${formatMoney(sellValue, currency)} at floor` : ""}
        </span>
      </summary>
      <div className="space-y-2 border-t border-white/8 bg-[#0b101b] p-3 text-[10.5px]">
        <div className="flex items-center gap-1">
          {(["pro", "common"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPool(p)}
              className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${
                pool === p ? "border-amber-300/60 bg-amber-500/20 text-amber-100" : "border-white/10 text-slate-400"
              }`}
            >
              {p === "pro" ? "Pro cards (sell)" : "Set cards (scrap)"}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-slate-400">
          Keeps the best copy of each player, every Shiny / Holo, sealed and in-lineup cards, and a 2nd copy of your top
          players. Prices are the lowest Instant Buy listing (refresh prices in the Gallery first).
        </div>
        {!gallery ? (
          <div className="text-slate-400">Load your gallery first.</div>
        ) : groups.length === 0 ? (
          <div className="text-slate-400">No duplicate players in this pool.</div>
        ) : (
          <ul className="space-y-1.5">
            {groups.map((g) => (
              <li key={`${g.rarity}:${g.playerSlug}`} className="rounded-lg border border-white/6 bg-[#111726] px-2 py-1.5">
                <div className="flex items-center justify-between font-semibold text-slate-100">
                  <span>
                    {g.playerName} <span className="font-normal text-slate-400">x{g.cards.length}</span>
                  </span>
                  {g.extras > 0 ? (
                    <span className="text-amber-300">
                      {g.extras} to {g.rarity === "common" ? "scrap" : "sell"}
                      {g.sellValueCents > 0 ? ` (~${formatMoney(g.sellValueCents, currency)})` : ""}
                    </span>
                  ) : (
                    <span className="text-emerald-300">keep all</span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
                  {g.cards.map((a) => (
                    <span
                      key={a.card.slug}
                      title={a.reason}
                      className={a.action === "keep" ? "text-slate-300" : "text-amber-200"}
                    >
                      {a.action === "keep" ? "Keep" : a.action === "sell" ? "Sell" : "Scrap"}: {editionLabel(a.card)}
                      {a.card.inSeasonEligible ? " in-season" : ""} {a.card.powerMultiplier > 1 ? `+${Math.round((a.card.powerMultiplier - 1) * 100)}%` : ""}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

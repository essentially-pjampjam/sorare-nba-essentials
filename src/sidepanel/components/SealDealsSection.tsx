import { ChevronRight, ExternalLink, Lock, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { planSealBudget, rankSealDeals } from "../../calculators/sealDealsMath";
import type { BargainListing, Currency, GalleryResult, Rarity } from "../../shared/types";
import { getSealDeals, openInActiveTab } from "../api";
import { formatMoney } from "../utils/format";

const BUDGETS = [200, 500, 1000, 2500];

/** Badge color by Sealing Points tier (1 / 2 / 5 / 20 / 50 / 200). */
function pointsBadge(points: number): string {
  if (points >= 50) return "border-fuchsia-300/60 bg-fuchsia-500/25 text-fuchsia-100";
  if (points >= 20) return "border-violet-300/60 bg-violet-500/25 text-violet-100";
  if (points >= 5) return "border-amber-300/50 bg-amber-500/20 text-amber-100";
  if (points >= 2) return "border-sky-300/40 bg-sky-500/15 text-sky-100";
  return "border-white/15 bg-white/5 text-slate-300";
}

/** Sealing Deal Finder: cheapest market cards ranked by live Sealing Points per euro. */
export function SealDealsSection({ gallery, rarity, currency }: { gallery: GalleryResult | null; rarity: Rarity; currency: Currency }) {
  const [listings, setListings] = useState<BargainListing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState(500);

  const scan = () => {
    setBusy(true);
    setError(null);
    getSealDeals(rarity)
      .then(setListings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const owned = useMemo(() => new Set((gallery?.cards ?? []).map((c) => c.playerSlug)), [gallery]);
  const deals = useMemo(() => rankSealDeals(listings ?? [], { ownedPlayerSlugs: owned }), [listings, owned]);
  const plan = useMemo(() => planSealBudget(deals, budget), [budget, deals]);

  return (
    <details className="cascade-section overflow-hidden rounded-2xl border border-violet-400/25 bg-[#111726]">
      <summary className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-white/[0.03]">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
          <ChevronRight className="cascade-chevron h-3.5 w-3.5 shrink-0 text-violet-300" />
          <Lock className="h-3.5 w-3.5 text-violet-300" />
          Sealing Deal Finder ({rarity.replace("_", " ")})
        </span>
        <span className="text-[10px] text-slate-400">
          {deals.length > 0
            ? `best: ${deals[0].sealingPoints} pts for ${formatMoney(deals[0].priceCents, currency)}`
            : "cheap cards with the most Sealing Points"}
        </span>
      </summary>
      <div className="space-y-2 border-t border-white/8 bg-[#0b101b] p-3 text-[10.5px]">
        <div className="text-[10px] text-slate-400">
          Cards cheap on the market are often ones nobody plays. Sealing Points here are Sorare's live values for each card
          (not estimates). Instant Buy prices only. Sealed cards can't be played or sold, so only buy what you mean to seal.
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={scan}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-300/40 px-2 py-0.5 text-[10px] font-semibold text-violet-100 hover:bg-violet-500/15 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Scanning..." : listings ? "Rescan market" : "Scan market"}
          </button>
          <span className="ml-2 text-[10px] text-slate-400">Budget:</span>
          {BUDGETS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBudget(b)}
              className={`rounded-md border px-1.5 text-[10px] font-semibold ${
                budget === b ? "border-violet-300/60 bg-violet-500/20 text-violet-100" : "border-white/10 text-slate-400"
              }`}
            >
              {formatMoney(b, currency)}
            </button>
          ))}
        </div>
        {error && <div className="text-rose-300">{error}</div>}
        {listings && (
          <div className="text-[10px] text-violet-200">
            {formatMoney(budget, currency)} buys {plan.deals.length} card{plan.deals.length === 1 ? "" : "s"} for{" "}
            <strong>{plan.totalPoints} Sealing Points</strong> ({formatMoney(plan.totalCents, currency)}). Checked {listings.length} listings.
          </div>
        )}
        {deals.length > 0 && (
          <ul className="space-y-1">
            {deals.slice(0, 15).map((d) => (
              <li key={d.listing.cardSlug} className="flex items-center justify-between gap-2 rounded-lg border border-white/6 bg-[#111726] px-2 py-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`flex h-8 w-11 shrink-0 flex-col items-center justify-center rounded-lg border leading-none ${pointsBadge(d.sealingPoints)}`}
                    title={`${d.sealingPoints} Sealing Points (Sorare's live value for this card)`}
                  >
                    <span className="text-[13px] font-bold">{d.sealingPoints}</span>
                    <span className="text-[8px] uppercase tracking-wide opacity-80">pts</span>
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-100">
                      {d.listing.playerName} <span className="font-normal text-slate-400">{d.listing.seasonYear}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      <span className="text-emerald-300" title="Sealing Points per 1 of your currency">
                        {d.pointsPerUnit} pts per {currency === "EUR" ? "€" : "$"}
                      </span>{" "}
                      • L10 {Math.round(d.listing.l10)}
                      {d.ownedPlayer && <span className="text-sky-300"> • you own this player</span>}
                      {d.lowLineupValue && <span className="text-slate-500"> • low lineup value</span>}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[12px] font-bold text-slate-100">{formatMoney(d.priceCents, currency)}</span>
                  <button
                    type="button"
                    onClick={() => void openInActiveTab(d.listing.marketUrl)}
                    title="Open this card on Sorare"
                    className="rounded-md border border-white/10 p-1 text-slate-300 hover:text-white"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {listings && deals.length === 0 && <div className="text-slate-400">No Instant Buy listings with Sealing Points found.</div>}
      </div>
    </details>
  );
}

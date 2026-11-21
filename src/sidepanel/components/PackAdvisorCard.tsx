import { Package, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { analyzePack, buildPackAdvice } from "../../calculators/packAdvisorMath";
import type { SetPackAdvisorData } from "../../shared/types";
import { getSetPackAdvisor, getSettings, scanSetShopStatus } from "../api";
import { formatTimeLeft } from "../utils/format";
import { GoButton } from "./GoButton";

/** Special packs the extension first saw in the last 48 hours. */
const isNewPack = (firstSeen: number | null | undefined) => typeof firstSeen === "number" && Date.now() - firstSeen < 48 * 3600_000;

const SHOP_URL = "https://sorare.com/nba/series/market";

const currencyLabel = (c: string) => (c === "COMMON_ESSENCE" ? "Essence" : c === "COMMON_GEM" ? "gems" : c.toLowerCase());

/** Set Pack & Mission Advisor: Daily Pack, Bronze+ progress, Live Today packs and per-pack 3★+ odds. */
export function PackAdvisorCard({ commonEssence: commonEssenceProp }: { commonEssence?: number } = {}) {
  const [data, setData] = useState<SetPackAdvisorData | null>(null);
  const [loadedCommonEssence, setLoadedCommonEssence] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const commonEssence =
    typeof commonEssenceProp === "number" ? commonEssenceProp : loadedCommonEssence;

  const load = useCallback(() => {
    setBusy(true);
    Promise.all([getSetPackAdvisor(), getSettings()])
      .then(([advisor, settings]) => {
        setData(advisor);
        setLoadedCommonEssence(typeof settings.commonEssence === "number" ? settings.commonEssence : null);
        setHasKey(Boolean(settings.sorareApiKey));
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => load(), [load]);

  const scanShop = () => {
    setBusy(true);
    setScanError(null);
    scanSetShopStatus()
      .then((shopStatus) => setData((d) => (d ? { ...d, shopStatus } : d)))
      .catch((e: unknown) => setScanError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const analyses = useMemo(() => (data?.packs ?? []).map((p) => analyzePack(p, commonEssence)), [commonEssence, data]);
  const advice = useMemo(
    () => buildPackAdvice(analyses, data?.shopStatus ?? null, commonEssence, Date.now()),
    [analyses, commonEssence, data],
  );
  const hasOdds = analyses.some((a) => a.pack.slots.length > 0);

  return (
    <div className="rounded-2xl border border-white/8 jam-attn-set bg-[#111726] p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-set-300" />
          <span className="text-xs font-semibold text-slate-100">Pack &amp; Mission Advisor</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={scanShop}
            title="Reads your Daily Pack and Bronze+ progress from your open Sorare Set Shop tab"
            className="jam-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            Scan shop
          </button>
          <GoButton url={SHOP_URL} title="Open the Set Shop on Sorare" />
        </div>
      </div>
      {scanError && <div className="mb-1 text-[10px] text-rose-300">{scanError}</div>}
      {data?.error && <div className="mb-1 text-[10px] text-rose-300">Packs failed to load: {data.error.slice(0, 120)}</div>}

      {advice.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-[10.5px] text-slate-200">
          {advice.map((a) => (
            <li key={a.text}>• {a.text}</li>
          ))}
        </ul>
      )}
      {!data?.shopStatus && (
        <div className="mb-1.5 text-[10px] text-slate-400">
          Open the Set Shop on Sorare (Go) and press Scan shop to add your Daily Pack and Bronze+ progress.
        </div>
      )}

      {analyses
        .filter((a) => a.pack.special)
        .map((a) => (
          <div key={`sp-${a.pack.slug}`} className="mb-1.5 rounded-lg border border-set-400/35 bg-set-500/10 px-2 py-1.5 text-[10.5px] text-slate-200">
            <span className="font-semibold text-set-200">{isNewPack(a.pack.firstSeen) ? "New special pack: " : "Special pack: "}</span>
            {a.pack.title} • {a.pack.price} {currencyLabel(a.pack.currency)} • {a.pack.cardsCount} cards
            {a.pack.endDate ? ` • ends in ${formatTimeLeft(a.pack.endDate)}` : ""}
            {a.pack.slots.length > 0
              ? ` • 3★+ ${a.chance3StarPct}%, 4★+ ${a.chance4StarPct}%, avg ${a.expectedStars}★ per pack`
              : hasKey ? " • odds not loaded yet" : " • odds load with an API key"}
          </div>
        ))}
      {analyses.length > 0 && (
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="font-medium">Pack</th>
              <th className="font-medium">Price</th>
              <th className="font-medium" title="Chance of at least one 3★+ card (Daily Boost: collect a 3-stars player)">
                3★+
              </th>
              <th className="font-medium">4★+</th>
              <th className="font-medium" title="Best tiers in the last card slot (#4 carries the best tier)">
                Last slot top
              </th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((a) => (
              <tr key={a.pack.slug} className={`border-t border-white/5 ${a.affordable === false ? "text-slate-500" : "text-slate-200"}`}>
                <td className="py-0.5">
                  {a.pack.title}
                  {a.pack.special && (
                    <span className="ml-1 rounded border border-set-400/40 bg-set-500/15 px-1 text-[9px] font-bold text-set-200">
                      {isNewPack(a.pack.firstSeen) ? "NEW" : "SPECIAL"}
                    </span>
                  )}
                </td>
                <td>
                  {a.pack.price} {currencyLabel(a.pack.currency)}
                </td>
                <td className="font-semibold text-emerald-300">{a.pack.slots.length > 0 ? `${a.chance3StarPct}%` : "--"}</td>
                <td>{a.pack.slots.length > 0 ? `${a.chance4StarPct}%` : "--"}</td>
                <td className="truncate text-slate-400">
                  {a.lastSlotTop
                    .slice(0, 3)
                    .map((t) => `${t.label} ${t.pct}%`)
                    .join(", ") || "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {analyses.length > 0 && !hasOdds && (
        <div className="mt-1 text-[10px] text-slate-400">
          {hasKey
            ? "Pack odds did not load from Sorare this time. Press Refresh in a minute."
            : "Pack odds need an API key (Sorare's limit without one is too low)."}
        </div>
      )}
    </div>
  );
}

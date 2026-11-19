import { Lock } from "lucide-react";
import { estimateSealingPoints } from "../../calculators/sealingPoints";
import type { GalleryCard } from "../../shared/types";

interface VaultGuideProps {
  /** All gallery cards (sealed ones included). */
  cards: GalleryCard[];
  /** Cards the Vault advisor marks as Seal (spare duplicates and bench-level cards). */
  candidates: GalleryCard[];
}

/** Collapsible Vault / sealing guide: live points, sealed count, rules and the best seal candidates. */
export function VaultGuide({ cards, candidates }: VaultGuideProps) {
  const sealed = cards.filter((c) => c.sealed);
  const ranked = candidates
    .map((c) => ({ card: c, est: estimateSealingPoints(c) }))
    .sort((a, b) => b.est.sealingPoints - a.est.sealingPoints)
    .slice(0, 5);
  const candidatePoints = candidates.reduce((sum, c) => sum + estimateSealingPoints(c).sealingPoints, 0);

  return (
    <details className="rounded-2xl border border-violet-400/25 bg-[#111726] px-3 py-2 text-[11px]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-violet-200">
          <Lock className="h-3.5 w-3.5" />
          Vault &amp; Sealing guide
        </span>
        <span className="text-[10px] text-slate-300">
          {sealed.length} sealed • {candidates.length} seal candidate(s) • +{candidatePoints} VP
        </span>
      </summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10px] text-slate-300">
        <li>
          Sealing locks a card in your Vault for Sealing Points (1 / 2 / 5 / 20 / 50 / 200 by tier). Points
          marked "live" come from Sorare; others are estimates.
        </li>
        <li>Sealing a card that sits in an upcoming or live lineup cancels that lineup.</li>
        <li>A listed card is delisted from the market when you seal it.</li>
        <li>Unsealing: max 1 card per scarcity every 14 days (14-day cooldown), so seal only spares.</li>
        <li>The helper only suggests spare duplicates and bench-level cards; lineup players are kept.</li>
      </ul>
      {ranked.length > 0 && (
        <div className="mt-2 space-y-0.5">
          <div className="text-[10px] font-semibold text-slate-200">Best seal candidates</div>
          {ranked.map(({ card, est }) => (
            <div key={card.slug} className="flex justify-between gap-2 text-[10px] text-slate-300">
              <span className="truncate">
                {card.playerName} <span className="text-slate-500">({card.rarity}, L10 {(card.l10 ?? 0).toFixed(1)})</span>
              </span>
              <span className="shrink-0 tabular-nums text-violet-300">
                +{est.sealingPoints} VP {card.sealingPoints !== undefined && card.sealingPoints !== null ? "live" : "est."}
              </span>
            </div>
          ))}
        </div>
      )}
      {sealed.length > 0 && (
        <div className="mt-2 text-[10px] text-slate-400">
          Sealed: {sealed.slice(0, 6).map((c) => c.playerName).join(", ")}
          {sealed.length > 6 ? ` +${sealed.length - 6} more` : ""}
        </div>
      )}
    </details>
  );
}

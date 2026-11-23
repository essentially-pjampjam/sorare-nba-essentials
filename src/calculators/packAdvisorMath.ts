import type { PackTierOdds, SetPackInfo, SetShopStatus } from "../shared/types";

/** Stars per Sorare Set gameplay tier (Reserve 1★ ... Icon / GOAT 5★). */
export function tierStars(tier: string): number {
  const t = tier.toUpperCase();
  const plus = t.endsWith("_PLUS") ? 0.5 : 0;
  if (t.startsWith("GOAT") || t.startsWith("ICON")) return 5;
  if (t.startsWith("STAR")) return 4 + plus;
  if (t.startsWith("IMPACT") || t.startsWith("KEY")) return 3 + plus;
  if (t.startsWith("ROSTER")) return 2 + plus;
  if (t.startsWith("RESERVE") || t.startsWith("DNP")) return 1 + plus;
  return 0;
}

export function tierLabel(tier: string): string {
  const stars = tierStars(tier);
  const names: Record<number, string> = {
    5: "Icon",
    4.5: "Star+",
    4: "Star",
    3.5: "Key+",
    3: "Key",
    2.5: "Roster+",
    2: "Roster",
    1.5: "Reserve+",
    1: "Reserve",
  };
  return names[stars] ?? tier;
}

/** P(a slot gives a card of at least `minStars`). */
export function slotChanceAtLeast(slot: PackTierOdds[], minStars: number): number {
  return slot.filter((o) => tierStars(o.tier) >= minStars).reduce((s, o) => s + o.basisPoints, 0) / 10_000;
}

export interface PackAnalysis {
  pack: SetPackInfo;
  /** P(at least one 3★+ card): completes the Daily Boost "Collect at least a 3-stars player". */
  chance3StarPct: number;
  /** P(at least one 4★+ card). */
  chance4StarPct: number;
  expectedStars: number;
  /** Best tier odds in the last slot (#4 carries the best tier). */
  lastSlotTop: Array<{ label: string; pct: number }>;
  affordable: boolean | null;
  /** Price per percentage point of 3★+ chance (lower is better), same currency only. */
  costPer3StarPct: number | null;
}

const pct1 = (v: number) => Math.round(v * 1000) / 10;

export function analyzePack(pack: SetPackInfo, commonEssence: number | null): PackAnalysis {
  const miss3 = pack.slots.reduce((p, s) => p * (1 - slotChanceAtLeast(s, 3)), 1);
  const miss4 = pack.slots.reduce((p, s) => p * (1 - slotChanceAtLeast(s, 4)), 1);
  const expectedStars = pack.slots.reduce(
    (sum, s) => sum + s.reduce((a, o) => a + (tierStars(o.tier) * o.basisPoints) / 10_000, 0),
    0,
  );
  const last = pack.slots[pack.slots.length - 1] ?? [];
  const lastSlotTop = [...last]
    .filter((o) => tierStars(o.tier) >= 3)
    .sort((a, b) => tierStars(b.tier) - tierStars(a.tier))
    .map((o) => ({ label: tierLabel(o.tier), pct: Math.round(o.basisPoints) / 100 }));
  const chance3StarPct = pct1(1 - miss3);
  return {
    pack,
    chance3StarPct,
    chance4StarPct: pct1(1 - miss4),
    expectedStars: Math.round(expectedStars * 10) / 10,
    lastSlotTop,
    affordable: pack.currency === "COMMON_ESSENCE" && commonEssence !== null ? commonEssence >= pack.price : null,
    costPer3StarPct: chance3StarPct > 0 ? Math.round((pack.price / chance3StarPct) * 100) / 100 : null,
  };
}

export interface PackAdvice {
  kind: "daily" | "bronze_plus" | "live_today" | "value" | "essence";
  text: string;
  priority: number;
}

/** Ordered tips: free Daily Pack first, then Bronze+ progress, Live Today timing and best value. */
export function buildPackAdvice(
  analyses: PackAnalysis[],
  status: SetShopStatus | null,
  commonEssence: number | null,
  nowMs: number,
): PackAdvice[] {
  const out: PackAdvice[] = [];
  if (status?.dailyPackClaimed === false) {
    out.push({ kind: "daily", priority: 1, text: "Open your free Daily Pack in Daily Solo (Daily Boost step 1)." });
  } else if (status?.dailyPackClaimed === true) {
    out.push({ kind: "daily", priority: 9, text: "Daily Pack already opened today." });
  }
  if (status?.bronzePlusProgress != null && status.bronzePlusTarget) {
    const left = Math.max(0, status.bronzePlusTarget - status.bronzePlusProgress);
    out.push({
      kind: "bronze_plus",
      priority: left === 0 ? 2 : 4,
      text:
        left === 0
          ? "Bronze+ is unlocked: open it."
          : `Bronze+: ${status.bronzePlusProgress}/${status.bronzePlusTarget}. ${left} more pack${left === 1 ? "" : "s"} from the NBA Packs row unlock it.`,
    });
  }
  for (const a of analyses.filter((x) => x.pack.category === "LIVE_TODAY")) {
    const end = a.pack.endDate ? Date.parse(a.pack.endDate) : NaN;
    const hours = Number.isFinite(end) ? Math.max(0, Math.round(((end - nowMs) / 3_600_000) * 10) / 10) : null;
    const oddsNote = a.pack.slots.length > 0 ? `, ${a.chance3StarPct}% for a 3★+` : "";
    out.push({
      kind: "live_today",
      priority: 5,
      text: `${a.pack.title}: players of today's teams (useful for today's lineups and Daily Picker)${oddsNote}${hours !== null ? `, ends in ${hours}h` : ""}.`,
    });
  }
  const allEssencePacks = analyses.filter((a) => a.pack.currency === "COMMON_ESSENCE" && a.pack.price > 0);
  const essencePacksWithOdds = allEssencePacks.filter((a) => a.costPer3StarPct !== null);
  const best = [...essencePacksWithOdds].sort((a, b) => (a.costPer3StarPct ?? 1e9) - (b.costPer3StarPct ?? 1e9))[0];
  if (best) {
    out.push({
      kind: "value",
      priority: 6,
      text: `Best Essence value for a 3★+: ${best.pack.title} (${best.chance3StarPct}% for ${best.pack.price} Essence).`,
    });
  }
  if (commonEssence !== null) {
    const cheapest = allEssencePacks.map((a) => a.pack.price).sort((a, b) => a - b)[0];
    if (cheapest && commonEssence < cheapest) {
      out.push({
        kind: "essence",
        priority: 7,
        text: `Set Essence ${commonEssence}/${cheapest}: scrap duplicates or finish Collect missions to afford a Bronze pack.`,
      });
    }
  }
  return out.sort((a, b) => a.priority - b.priority);
}

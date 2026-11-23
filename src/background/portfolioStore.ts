import { toUtcDateKey, upsertPortfolioSnapshot } from "../calculators/portfolioMath";
import type { Currency, PortfolioSnapshot, Rarity } from "../shared/types";

const SNAPSHOTS_STORAGE_KEY = "jamassist_portfolio_snapshots_v1";
export const PORTFOLIO_SNAPSHOT_ALARM_NAME = "jamassist-portfolio-snapshot";

export function ensurePortfolioSnapshotAlarm(): void {
  if (!chrome.alarms) return;
  try {
    chrome.alarms.create(PORTFOLIO_SNAPSHOT_ALARM_NAME, { periodInMinutes: 60 * 24 });
  } catch {
    // Ignore if alarms unavailable
  }
}

export async function getPortfolioSnapshots(): Promise<PortfolioSnapshot[]> {
  try {
    const res = await chrome.storage.local.get(SNAPSHOTS_STORAGE_KEY);
    const list = res[SNAPSHOTS_STORAGE_KEY];
    return Array.isArray(list) ? (list as PortfolioSnapshot[]) : [];
  } catch {
    return [];
  }
}

export async function recordPortfolioSnapshot(params: {
  totalFloorCents: number;
  cardCount: number;
  pricedCardCount: number;
  rarity: Rarity;
  currency: Currency;
  nowMs?: number;
}): Promise<PortfolioSnapshot[]> {
  const nowMs = params.nowMs ?? Date.now();
  const existing = await getPortfolioSnapshots();
  const next: PortfolioSnapshot = {
    date: toUtcDateKey(nowMs),
    totalFloorCents: Math.max(0, Math.round(params.totalFloorCents)),
    cardCount: Math.max(0, Math.round(params.cardCount)),
    pricedCardCount: Math.max(0, Math.round(params.pricedCardCount)),
    rarity: params.rarity,
    currency: params.currency,
    capturedAtMs: nowMs,
  };
  const updated = upsertPortfolioSnapshot(existing, next, 365);
  try {
    await chrome.storage.local.set({ [SNAPSHOTS_STORAGE_KEY]: updated });
  } catch {
    // Ignore quota errors
  }
  return updated;
}

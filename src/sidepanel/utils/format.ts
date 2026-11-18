import type { Currency } from "../../shared/types";

export function formatMoney(
  cents: number | null | undefined,
  currency: Currency,
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return "--";
  }
  const symbol = currency === "EUR" ? "€" : "$";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export function formatCostPerEssence(
  centsPerEssence: number | null | undefined,
  currency: Currency,
): string {
  if (
    centsPerEssence === null ||
    centsPerEssence === undefined ||
    !Number.isFinite(centsPerEssence)
  ) {
    return "--";
  }
  const symbol = currency === "EUR" ? "€" : "$";
  const dollarsPerEssence = centsPerEssence / 100;
  if (dollarsPerEssence < 0.01) {
    return `${symbol}${dollarsPerEssence.toFixed(4)}/E`;
  }
  return `${symbol}${dollarsPerEssence.toFixed(3)}/E`;
}

export function formatRelativeAge(timestampMs: number | null): string {
  if (!timestampMs) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  return `${diffMin}m ago`;
}

export function formatTimeLeft(isoDate: string | null): string {
  if (!isoDate) return "";
  const ms = new Date(isoDate).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Ended";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

import { NBA_TEAM_META } from "../shared/constants";
import type { CardRarity } from "../shared/types";

export interface LineupShareSlot {
  playerName: string;
  teamSlug?: string | null;
  rarity: CardRarity;
  pictureUrl?: string | null;
  starCost?: number | null;
  projectedPts: number;
  boostPct?: number | null;
  badge?: string | null;
}

export interface LineupShareStat {
  label: string;
  value: string;
  tone?: "emerald" | "sky" | "amber" | "violet" | "neutral";
}

export interface LineupShareCardData {
  title: string;
  subtitle?: string | null;
  username?: string | null;
  rarity: CardRarity;
  projectedTotal: number;
  rangeLabel?: string | null;
  capLabel?: string | null;
  slots: LineupShareSlot[];
  stats: LineupShareStat[];
}

export interface ShareRarityPalette {
  label: string;
  accent: string;
  glow: string;
  border: string;
}

export function rarityShareAccent(rarity: CardRarity): ShareRarityPalette {
  switch (rarity) {
    case "limited":
      return {
        label: "LIMITED",
        accent: "#fbbf24",
        glow: "rgba(251, 191, 36, 0.22)",
        border: "rgba(251, 191, 36, 0.55)",
      };
    case "rare":
      return {
        label: "RARE",
        accent: "#fb7185",
        glow: "rgba(251, 113, 133, 0.22)",
        border: "rgba(251, 113, 133, 0.55)",
      };
    case "super_rare":
      return {
        label: "SUPER RARE",
        accent: "#38bdf8",
        glow: "rgba(56, 189, 248, 0.22)",
        border: "rgba(56, 189, 248, 0.55)",
      };
    case "unique":
      return {
        label: "UNIQUE",
        accent: "#c084fc",
        glow: "rgba(192, 132, 252, 0.24)",
        border: "rgba(192, 132, 252, 0.55)",
      };
    case "common":
    default:
      return {
        label: "SET",
        accent: "#a78bfa",
        glow: "rgba(167, 139, 250, 0.22)",
        border: "rgba(167, 139, 250, 0.5)",
      };
  }
}

export function formatSharePlayerName(name: string): { first: string; last: string; initials: string } {
  const clean = name.trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "Player", initials: "PL" };
  if (parts.length === 1) {
    const single = parts[0].slice(0, 14);
    return { first: "", last: single, initials: single.slice(0, 2).toUpperCase() };
  }
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  const initials = `${first[0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
  return {
    first: first.length > 12 ? `${first.slice(0, 11)}.` : first,
    last: last.length > 13 ? `${last.slice(0, 12)}.` : last,
    initials,
  };
}

export function resolveShareTeamInfo(teamSlug?: string | null): { abbr: string; color: string } {
  if (teamSlug && NBA_TEAM_META[teamSlug]) {
    const meta = NBA_TEAM_META[teamSlug];
    return { abbr: meta.abbr, color: meta.color };
  }
  return { abbr: "NBA", color: "#38bdf8" };
}

export function buildLineupShareFilename(title: string, username?: string | null): string {
  const slugify = (raw: string) =>
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const parts = ["sorare-nba", slugify(title) || "lineup"];
  const userSlug = username ? slugify(username) : "";
  if (userSlug) parts.push(userSlug);
  return `${parts.join("-")}.png`;
}

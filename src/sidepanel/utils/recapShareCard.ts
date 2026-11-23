import { rarityShareAccent } from "../../calculators/lineupShareMath";
import {
  buildGameWeekRecapFilename,
  type GameWeekRecapCardData,
} from "../../calculators/recapShareMath";

const CANVAS_W = 1200;
const CANVAS_H = 675;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function renderGameWeekRecapCanvas(data: GameWeekRecapCardData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const palette = rarityShareAccent(data.rarity);

  // Obsidian dark background + emerald/rarity ambient glow
  const bg = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  bg.addColorStop(0, "#090d16");
  bg.addColorStop(0.55, "#0e1526");
  bg.addColorStop(1, "#07090f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const glow = ctx.createRadialGradient(240, 60, 20, 240, 90, 620);
  glow.addColorStop(0, palette.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const glow2 = ctx.createRadialGradient(980, 560, 20, 980, 560, 480);
  glow2.addColorStop(0, "rgba(16, 185, 129, 0.14)");
  glow2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Outer card frame
  roundRectPath(ctx, 20, 20, CANVAS_W - 40, CANVAS_H - 40, 28);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Top accent hairline
  const bar = ctx.createLinearGradient(50, 20, CANVAS_W - 50, 20);
  bar.addColorStop(0, "rgba(255,255,255,0)");
  bar.addColorStop(0.25, palette.accent);
  bar.addColorStop(0.75, "#34d399");
  bar.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = bar;
  ctx.fillRect(50, 20, CANVAS_W - 100, 3);

  // Header badge + title
  const badgeText = "GAME WEEK RECAP";
  ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const badgeW = Math.ceil(ctx.measureText(badgeText).width) + 24;
  roundRectPath(ctx, 52, 48, badgeW, 28, 14);
  ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
  ctx.fill();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = "#7dd3fc";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, 64, 62);

  if (data.currentRewardStreak > 0) {
    const streakText = `${data.currentRewardStreak} GW REWARD STREAK`;
    const sx = 52 + badgeW + 12;
    const sw = Math.ceil(ctx.measureText(streakText).width) + 24;
    roundRectPath(ctx, sx, 48, sw, 28, 14);
    ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(52, 211, 153, 0.45)";
    ctx.stroke();
    ctx.fillStyle = "#6ee7b7";
    ctx.fillText(streakText, sx + 12, 62);
  }

  ctx.textBaseline = "alphabetic";
  ctx.font = "800 38px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(data.fixtureLabel, 52, 124, 720);

  const subParts = [
    data.username ? `@${data.username.replace(/^@/, "")}` : null,
    `${data.lineupCount} lineup${data.lineupCount === 1 ? "" : "s"} played`,
    data.generatedDateLabel,
  ].filter(Boolean);
  ctx.font = "500 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(subParts.join("  •  "), 52, 154, 720);

  // Header right: Total Points
  ctx.textAlign = "right";
  ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("TOTAL GW POINTS", CANVAS_W - 52, 70);

  ctx.font = "800 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#6ee7b7";
  ctx.fillText(data.totalPoints.toFixed(1), CANVAS_W - 52, 128, 340);
  ctx.textAlign = "left";

  // 4 Hero KPI cards
  const kpis = [
    {
      label: "REWARDS WON",
      value: `${data.rewardedCount} / ${data.lineupCount}`,
      sub: data.cashCount > 0 ? `${data.cashCount} in the cash` : "Pro leaderboards",
      color: "#6ee7b7",
    },
    {
      label: "BEST RANK %",
      value: data.bestTopPct !== null ? `Top ${data.bestTopPct}%` : "--",
      sub: data.bestLineup?.rank ? `#${data.bestLineup.rank.toLocaleString()} finish` : "Tracked finish",
      color: "#7dd3fc",
    },
    {
      label: "BEST LINEUP",
      value: data.bestLineup?.score != null ? `${data.bestLineup.score.toFixed(1)} PTS` : "--",
      sub: data.bestLineup?.leaderboardName ?? "No lineup recorded",
      color: "#fcd34d",
    },
    {
      label: "REWARD STREAK",
      value: `${data.currentRewardStreak} GW`,
      sub: data.currentRewardStreak >= 2 ? "Hot streak active" : "Keep climbing",
      color: "#d8b4fe",
    },
  ];

  const kpiY = 186;
  const kpiH = 114;
  const kpiGap = 16;
  const kpiW = Math.floor((CANVAS_W - 104 - kpiGap * 3) / 4);

  kpis.forEach((k, idx) => {
    const x = 52 + idx * (kpiW + kpiGap);
    roundRectPath(ctx, x, kpiY, kpiW, kpiH, 16);
    ctx.fillStyle = "rgba(17, 23, 38, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(k.label, x + 18, kpiY + 28, kpiW - 36);

    ctx.font = "800 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = k.color;
    ctx.fillText(k.value, x + 18, kpiY + 68, kpiW - 36);

    ctx.font = "500 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(k.sub, x + 18, kpiY + 95, kpiW - 36);
  });

  // Lineup breakdown list (up to 4 rows)
  const listY = 326;
  ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("LINEUP BREAKDOWN", 52, listY);

  const rowH = 60;
  const rowGap = 10;
  data.lineups.slice(0, 4).forEach((row, idx) => {
    const y = listY + 14 + idx * (rowH + rowGap);
    roundRectPath(ctx, 52, y, CANVAS_W - 104, rowH, 14);
    ctx.fillStyle = "rgba(11, 16, 27, 0.92)";
    ctx.fill();
    ctx.strokeStyle = row.isCash
      ? "rgba(52, 211, 153, 0.45)"
      : row.isRewarded
        ? "rgba(52, 211, 153, 0.25)"
        : "rgba(255, 255, 255, 0.07)";
    ctx.stroke();

    ctx.font = "700 17px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(row.leaderboardName, 72, y + 26, 560);

    const rankLine = [
      row.rank ? `#${row.rank.toLocaleString()}` : "Unranked",
      row.totalEntries ? `of ${row.totalEntries.toLocaleString()}` : null,
      row.topPct !== null ? `(Top ${row.topPct}%)` : null,
    ]
      .filter(Boolean)
      .join(" ");
    ctx.font = "500 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(rankLine, 72, y + 47, 560);

    // Right score + status pill
    ctx.textAlign = "right";
    ctx.font = "800 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#6ee7b7";
    ctx.fillText(
      row.score !== null ? `${row.score.toFixed(1)} PTS` : "--",
      CANVAS_W - 210,
      y + 38,
      180,
    );
    ctx.textAlign = "left";

    const pillW = 128;
    const pillX = CANVAS_W - 52 - pillW - 16;
    roundRectPath(ctx, pillX, y + 16, pillW, 28, 14);
    ctx.fillStyle = row.isCash
      ? "rgba(52, 211, 153, 0.25)"
      : row.isRewarded
        ? "rgba(16, 185, 129, 0.14)"
        : "rgba(255, 255, 255, 0.06)";
    ctx.fill();
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = row.isRewarded ? "#6ee7b7" : "#cbd5e1";
    ctx.textAlign = "center";
    ctx.fillText(row.statusLabel, pillX + pillW / 2, y + 34);
    ctx.textAlign = "left";
  });

  // Footer branding
  ctx.font = "600 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText("pjampjam's Sorare NBA Essentials", 52, CANVAS_H - 36);
  ctx.textAlign = "right";
  ctx.fillText("16:9 Game Week Recap Card", CANVAS_W - 52, CANVAS_H - 36);
  ctx.textAlign = "left";

  return canvas;
}

export async function shareGameWeekRecapCard(
  data: GameWeekRecapCardData,
): Promise<"copied" | "downloaded"> {
  const canvas = renderGameWeekRecapCanvas(data);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
  });

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard.write === "function"
  ) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      // Fall through to file download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildGameWeekRecapFilename(data.fixtureSlug, data.username);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "downloaded";
}

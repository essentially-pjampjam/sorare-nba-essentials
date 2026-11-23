import { buildWrappedFilename, type WrappedSummaryData } from "../../calculators/wrappedMath";

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

export function renderWrappedShareCanvas(data: WrappedSummaryData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Obsidian + rich violet/emerald celebratory glow
  const bg = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  bg.addColorStop(0, "#090b14");
  bg.addColorStop(0.5, "#111428");
  bg.addColorStop(1, "#080b12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const glowA = ctx.createRadialGradient(220, 90, 20, 220, 90, 560);
  glowA.addColorStop(0, "rgba(139, 92, 246, 0.22)");
  glowA.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const glowB = ctx.createRadialGradient(980, 580, 20, 980, 580, 520);
  glowB.addColorStop(0, "rgba(16, 185, 129, 0.18)");
  glowB.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  roundRectPath(ctx, 20, 20, CANVAS_W - 40, CANVAS_H - 40, 28);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.11)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const bar = ctx.createLinearGradient(50, 20, CANVAS_W - 50, 20);
  bar.addColorStop(0, "rgba(255,255,255,0)");
  bar.addColorStop(0.25, "#a78bfa");
  bar.addColorStop(0.55, "#38bdf8");
  bar.addColorStop(0.85, "#34d399");
  bar.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = bar;
  ctx.fillRect(50, 20, CANVAS_W - 100, 3.5);

  // Header
  const pill = `${data.seasonLabel} SORARE NBA WRAPPED`;
  ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const pillW = Math.ceil(ctx.measureText(pill).width) + 26;
  roundRectPath(ctx, 54, 48, pillW, 30, 15);
  ctx.fillStyle = "rgba(167, 139, 250, 0.18)";
  ctx.fill();
  ctx.strokeStyle = "rgba(167, 139, 250, 0.45)";
  ctx.stroke();
  ctx.fillStyle = "#ddd6fe";
  ctx.textBaseline = "middle";
  ctx.fillText(pill, 67, 63);

  ctx.textBaseline = "alphabetic";
  ctx.font = "800 42px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(data.title, 54, 130, 760);

  ctx.font = "600 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#94a3b8";
  const handle = data.username ? `@${data.username.replace(/^@/, "")}` : "Sorare NBA Manager";
  ctx.fillText(`${handle}  •  ${data.subtitle}`, 54, 162, 820);

  // Right summary pill
  ctx.textAlign = "right";
  ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("REWARD HIT RATE", CANVAS_W - 54, 72);
  ctx.font = "800 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#6ee7b7";
  ctx.fillText(`${data.rewardHitRatePct}%`, CANVAS_W - 54, 130);
  ctx.textAlign = "left";

  // 6 Stat Tiles (3 x 2 grid)
  const tiles = [
    {
      label: "GAME WEEKS TRACKED",
      value: `${data.totalGameWeeks} GWs`,
      sub: `${data.totalLineups} lineups • ${data.rewardedLineups} rewarded`,
      color: "#7dd3fc",
    },
    {
      label: "BEST LINEUP SCORE",
      value: data.bestScore !== null ? `${data.bestScore.toFixed(1)} PTS` : "--",
      sub:
        data.bestTopPct !== null
          ? `Best finish: Top ${data.bestTopPct}% • ${data.longestRewardStreak} GW streak`
          : `Longest streak: ${data.longestRewardStreak} GW`,
      color: "#6ee7b7",
    },
    {
      label: "MVP CARD",
      value: data.mvpCardName ?? "--",
      sub: data.mvpCardL10 !== null ? `${data.mvpCardL10.toFixed(1)} L10 Average` : "Top owned player",
      color: "#fcd34d",
    },
    {
      label: "BEST AUCTION STEAL",
      value: data.bestAuctionStealLabel ?? "Scan P&L History",
      sub:
        data.totalFloorCents > 0
          ? `Est. Pro Floor: ${data.currency === "USD" ? "$" : "€"}${(data.totalFloorCents / 100).toFixed(2)}`
          : `${data.totalCardsOwned} cards in gallery`,
      color: "#f9a8d4",
    },
    {
      label: "TOTAL ESSENCE",
      value: `${data.totalEssence.toLocaleString()} E`,
      sub: "Pro + Set Essence Vault",
      color: "#c4b5fd",
    },
    {
      label: "FAVORITE TEAM COLLECTED",
      value: data.favoriteTeamName ?? "--",
      sub:
        data.favoriteTeamCount > 0
          ? `${data.favoriteTeamCount} cards owned`
          : "Most collected NBA franchise",
      color: "#67e8f9",
    },
  ];

  const cols = 3;
  const gapX = 18;
  const gapY = 18;
  const startY = 198;
  const tileW = Math.floor((CANVAS_W - 108 - gapX * 2) / cols);
  const tileH = 192;

  tiles.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 54 + col * (tileW + gapX);
    const y = startY + row * (tileH + gapY);

    roundRectPath(ctx, x, y, tileW, tileH, 20);
    ctx.fillStyle = "rgba(17, 23, 38, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(t.label, x + 22, y + 36, tileW - 44);

    ctx.font = "800 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = t.color;
    ctx.fillText(t.value, x + 22, y + 98, tileW - 44);

    ctx.font = "500 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(t.sub, x + 22, y + 148, tileW - 44);
  });

  // Footer
  ctx.font = "600 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText("pjampjam's Sorare NBA Essentials", 54, CANVAS_H - 34);
  ctx.textAlign = "right";
  ctx.fillText("github.com/essentially-pjampjam/sorare-nba-essentials", CANVAS_W - 54, CANVAS_H - 34);
  ctx.textAlign = "left";

  return canvas;
}

export async function shareWrappedCard(
  data: WrappedSummaryData,
): Promise<"copied" | "downloaded"> {
  const canvas = renderWrappedShareCanvas(data);
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
      // Fallback to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildWrappedFilename(data.mode, data.username);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "downloaded";
}

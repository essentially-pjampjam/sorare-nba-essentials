import {
  buildLineupShareFilename,
  formatSharePlayerName,
  rarityShareAccent,
  resolveShareTeamInfo,
  type LineupShareCardData,
  type LineupShareStat,
} from "../../calculators/lineupShareMath";

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

function loadCorsImage(url: string, timeoutMs = 2500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let done = false;
    const finish = (val: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function statToneColor(tone: LineupShareStat["tone"]): string {
  switch (tone) {
    case "emerald":
      return "#6ee7b7";
    case "sky":
      return "#7dd3fc";
    case "amber":
      return "#fcd34d";
    case "violet":
      return "#d8b4fe";
    default:
      return "#e2e8f0";
  }
}

export async function renderLineupShareCanvas(
  data: LineupShareCardData,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const palette = rarityShareAccent(data.rarity);

  // 1. Pitch obsidian background with subtle top-left rarity glow
  const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
  bgGrad.addColorStop(0, "#0b0f19");
  bgGrad.addColorStop(0.55, "#0d121f");
  bgGrad.addColorStop(1, "#07090f");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const radial = ctx.createRadialGradient(260, 40, 20, 260, 80, 620);
  radial.addColorStop(0, palette.glow);
  radial.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Outer card border
  roundRectPath(ctx, 18, 18, CANVAS_W - 36, CANVAS_H - 36, 26);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Top rarity accent hairline
  const barGrad = ctx.createLinearGradient(44, 18, CANVAS_W - 44, 18);
  barGrad.addColorStop(0, "rgba(255,255,255,0)");
  barGrad.addColorStop(0.25, palette.accent);
  barGrad.addColorStop(0.75, palette.accent);
  barGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = barGrad;
  ctx.fillRect(44, 18, CANVAS_W - 88, 3);

  // 2. Header left: rarity pill + competition title + username/cap subtitle
  const badgeText = palette.label;
  ctx.font = "700 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const badgeW = Math.ceil(ctx.measureText(badgeText).width) + 22;
  roundRectPath(ctx, 48, 46, badgeW, 28, 14);
  ctx.fillStyle = palette.glow;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = palette.accent;
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, 59, 60);

  if (data.capLabel) {
    const capX = 48 + badgeW + 10;
    const capW = Math.ceil(ctx.measureText(data.capLabel).width) + 22;
    roundRectPath(ctx, capX, 46, capW, 28, 14);
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.stroke();
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(data.capLabel, capX + 11, 60);
  }

  ctx.font = "800 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(data.title, 48, 118, 680);

  const subParts: string[] = [];
  if (data.username) subParts.push(`@${data.username.replace(/^@/, "")}`);
  if (data.subtitle) subParts.push(data.subtitle);
  if (subParts.length > 0) {
    ctx.font = "500 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(subParts.join("  •  "), 48, 144, 680);
  }

  // Header right: Projected Total + range
  ctx.textAlign = "right";
  ctx.font = "600 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("PROJECTED TOTAL", CANVAS_W - 48, 66);

  ctx.font = "800 48px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#6ee7b7";
  ctx.fillText(`${data.projectedTotal.toFixed(1)}`, CANVAS_W - 48, 118, 360);

  if (data.rangeLabel) {
    ctx.font = "600 15px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(data.rangeLabel, CANVAS_W - 48, 144, 360);
  }
  ctx.textAlign = "left";

  // 3. Load card portraits in parallel (best-effort CORS; fallback to team gradient)
  const slots = data.slots.slice(0, 5);
  const loadedImages = await Promise.all(
    slots.map((s) => (s.pictureUrl ? loadCorsImage(s.pictureUrl) : Promise.resolve(null))),
  );

  // 4. Draw 5 player card tiles
  const marginX = 48;
  const gap = 18;
  const cardW = Math.floor((CANVAS_W - marginX * 2 - gap * 4) / 5);
  const cardH = 360;
  const cardY = 172;

  slots.forEach((slot, i) => {
    const x = marginX + i * (cardW + gap);
    const team = resolveShareTeamInfo(slot.teamSlug);
    const slotPalette = rarityShareAccent(slot.rarity);
    const parsedName = formatSharePlayerName(slot.playerName);
    const img = loadedImages[i];

    ctx.save();
    roundRectPath(ctx, x, cardY, cardW, cardH, 18);
    ctx.clip();

    // Base fill
    const cardGrad = ctx.createLinearGradient(x, cardY, x, cardY + cardH);
    cardGrad.addColorStop(0, "#151b2b");
    cardGrad.addColorStop(1, "#090c14");
    ctx.fillStyle = cardGrad;
    ctx.fillRect(x, cardY, cardW, cardH);

    // Team color radial glow
    const teamGlow = ctx.createRadialGradient(
      x + cardW / 2,
      cardY + 120,
      10,
      x + cardW / 2,
      cardY + 120,
      cardW * 0.85,
    );
    teamGlow.addColorStop(0, `${team.color}55`);
    teamGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = teamGlow;
    ctx.fillRect(x, cardY, cardW, cardH);

    // Draw portrait image if available (cover-crop anchored to top)
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const targetAspect = cardW / cardH;
      const imgAspect = img.naturalWidth / img.naturalHeight;
      let sx = 0;
      let sy = 0;
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      if (imgAspect > targetAspect) {
        sw = img.naturalHeight * targetAspect;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sh = img.naturalWidth / targetAspect;
        sy = 0;
      }
      try {
        ctx.drawImage(img, sx, sy, sw, sh, x, cardY, cardW, cardH);
      } catch {
        // Fallback already painted beneath
      }
    } else {
      // Crisp typographic monogram fallback
      ctx.textAlign = "center";
      ctx.font = "800 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fillText(parsedName.initials, x + cardW / 2, cardY + 150);
      ctx.font = "700 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.fillText(team.abbr, x + cardW / 2, cardY + 182);
      ctx.textAlign = "left";
    }

    // Bottom dark gradient scrim for crisp text legibility
    const scrim = ctx.createLinearGradient(x, cardY + cardH * 0.42, x, cardY + cardH);
    scrim.addColorStop(0, "rgba(7, 10, 16, 0)");
    scrim.addColorStop(0.55, "rgba(7, 10, 16, 0.82)");
    scrim.addColorStop(1, "rgba(7, 10, 16, 0.97)");
    ctx.fillStyle = scrim;
    ctx.fillRect(x, cardY, cardW, cardH);

    // Top-left star badge
    if (typeof slot.starCost === "number" && slot.starCost > 0) {
      const starText = `${slot.starCost}★`;
      ctx.font = "700 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      const sw = Math.ceil(ctx.measureText(starText).width) + 16;
      roundRectPath(ctx, x + 10, cardY + 10, sw, 26, 8);
      ctx.fillStyle = "rgba(5, 8, 15, 0.82)";
      ctx.fill();
      ctx.fillStyle = "#fcd34d";
      ctx.textBaseline = "middle";
      ctx.fillText(starText, x + 18, cardY + 23);
    }

    // Top-right badge (C / MVP / Holo / Shiny)
    if (slot.badge) {
      ctx.font = "800 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      const bw = Math.ceil(ctx.measureText(slot.badge).width) + 16;
      roundRectPath(ctx, x + cardW - bw - 10, cardY + 10, bw, 26, 8);
      ctx.fillStyle = "#38bdf8";
      ctx.fill();
      ctx.fillStyle = "#082f49";
      ctx.textBaseline = "middle";
      ctx.fillText(slot.badge, x + cardW - bw - 2, cardY + 23);
    }

    // Bottom text block
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const cx = x + cardW / 2;
    const textMaxW = cardW - 20;

    if (parsedName.first) {
      ctx.font = "500 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(parsedName.first, cx, cardY + cardH - 82, textMaxW);
    }

    ctx.font = "800 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(parsedName.last, cx, cardY + cardH - 58, textMaxW);

    ctx.font = "800 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#6ee7b7";
    ctx.fillText(`${slot.projectedPts.toFixed(1)}`, cx, cardY + cardH - 29, textMaxW);

    // Subtle boost tag or team abbr
    const footerChip =
      typeof slot.boostPct === "number" && slot.boostPct > 0
        ? `${team.abbr}  •  +${Math.round(slot.boostPct)}%`
        : team.abbr;
    ctx.font = "600 11px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(footerChip, cx, cardY + cardH - 13, textMaxW);

    ctx.textAlign = "left";
    ctx.restore();

    // Rarity card border
    roundRectPath(ctx, x, cardY, cardW, cardH, 18);
    ctx.strokeStyle = slotPalette.border;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  });

  // 5. Bottom stats strip + subtle watermark
  const footerY = 556;
  const stats = data.stats.slice(0, 4);
  let statX = 48;
  for (const stat of stats) {
    const boxW = 176;
    const boxH = 74;
    const innerMaxW = boxW - 28;
    roundRectPath(ctx, statX, footerY, boxW, boxH, 14);
    ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "600 11.5px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(stat.label.toUpperCase(), statX + 14, footerY + 25, innerMaxW);

    ctx.font = "800 23px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = statToneColor(stat.tone);
    ctx.fillText(stat.value, statX + 14, footerY + 56, innerMaxW);

    statX += boxW + 12;
  }

  // Subtle bottom-right watermark
  ctx.textAlign = "right";
  ctx.font = "700 15px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText("pjampjam's Sorare NBA Essentials", CANVAS_W - 48, footerY + 34);
  ctx.font = "500 12.5px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText("Free Chrome Side Panel  •  GitHub / Chrome Web Store", CANVAS_W - 48, footerY + 56);
  ctx.textAlign = "left";

  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode PNG image"));
    }, "image/png");
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generates a 1200x675 shareable lineup PNG card, copying it to the clipboard
 * when supported and falling back to a direct PNG file download.
 */
export async function exportLineupSharePng(
  data: LineupShareCardData,
): Promise<"copied" | "downloaded"> {
  const canvas = await renderLineupShareCanvas(data);
  const blob = await canvasToPngBlob(canvas);
  const filename = buildLineupShareFilename(data.title, data.username);

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      // Fall back to download if clipboard permission is blocked
    }
  }

  downloadBlob(blob, filename);
  return "downloaded";
}

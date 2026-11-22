import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Rarity } from "../../shared/types";

export interface EssenceTubeBarProps {
  rarity: Rarity | "set";
  pct: number;
  amount: number;
  ready: boolean;
  ariaLabel: string;
}

export interface EssenceParticleSpec {
  id: number;
  kind: "bubble" | "glint";
  leftPct: number;
  topPct: number;
  sizePx: number;
  durationSec: number;
  delaySec: number;
  driftX: number;
  driftY: number;
}

/** Deterministic PRNG (Mulberry32) so particle layouts look organically random without SSR/hydration drift. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedForRarity(rarity: Rarity | "set"): number {
  switch (rarity) {
    case "limited":
      return 0x51a7_3c11;
    case "rare":
      return 0x9e37_79b9;
    case "super_rare":
      return 0x243f_6a88;
    case "unique":
      return 0xb7e1_5162;
    case "set":
    default:
      return 0x6a09_e667;
  }
}

export function generateEssenceParticles(
  rarity: Rarity | "set",
  pct: number,
  amount: number,
): EssenceParticleSpec[] {
  if (amount <= 0 || pct <= 0) return [];
  const total = Math.max(5, Math.min(18, Math.round((pct / 100) * 14) + 4));
  const rand = mulberry32(seedForRarity(rarity) ^ (total * 2654435761));
  const out: EssenceParticleSpec[] = [];

  for (let i = 0; i < total; i += 1) {
    // Roughly 1/3 star-shine glints, 2/3 rising liquid micro-bubbles
    const isGlint = i % 3 === 1;
    const leftPct = 4 + rand() * 90;
    const topPct = isGlint ? 20 + rand() * 60 : 28 + rand() * 58;
    const sizePx = isGlint
      ? 2.8 + rand() * 2.0
      : 1.5 + rand() * 1.9;
    const durationSec = isGlint
      ? 2.6 + rand() * 2.2
      : 2.2 + rand() * 3.0;
    const delaySec = -(rand() * durationSec);
    const driftX = isGlint
      ? (rand() - 0.35) * 8
      : -4 + rand() * 16;
    const driftY = isGlint
      ? (rand() - 0.5) * 3
      : -(2.2 + rand() * 3.2);

    out.push({
      id: i,
      kind: isGlint ? "glint" : "bubble",
      leftPct: Math.round(leftPct * 10) / 10,
      topPct: Math.round(topPct * 10) / 10,
      sizePx: Math.round(sizePx * 10) / 10,
      durationSec: Math.round(durationSec * 100) / 100,
      delaySec: Math.round(delaySec * 100) / 100,
      driftX: Math.round(driftX * 10) / 10,
      driftY: Math.round(driftY * 10) / 10,
    });
  }
  return out;
}

/**
 * Glass tube of living liquid Essence:
 * - Dark smoky unfilled liquid chamber on the right with subtle etched ticks
 * - Rarity-colored cylindrical glowing liquid on the left with curved meniscus tip
 * - Randomized rising micro-bubbles and shimmering 4-point star glints inside the liquid
 * - Full cylindrical top glass specular reflection and prefers-reduced-motion support
 */
export function EssenceTubeBar({
  rarity,
  pct,
  amount,
  ready,
  ariaLabel,
}: EssenceTubeBarProps) {
  const clampedPct = Math.max(0, Math.min(100, Math.round(pct)));
  const fillPct = amount > 0 ? Math.max(3, clampedPct) : 0;
  const prevAmountRef = useRef<number>(amount);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (prevAmountRef.current !== amount && amount > 0) {
      prevAmountRef.current = amount;
      setPulsing(true);
      const t = window.setTimeout(() => setPulsing(false), 700);
      return () => window.clearTimeout(t);
    }
    prevAmountRef.current = amount;
    return undefined;
  }, [amount]);

  const particles = useMemo(
    () => generateEssenceParticles(rarity, clampedPct, amount),
    [amount, clampedPct, rarity],
  );

  return (
    <div className="jam-essence-wrap">
      <div
        className="jam-essence-track"
        data-rarity={rarity}
        data-ready={ready ? "true" : undefined}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={clampedPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="jam-essence-fill"
          data-rarity={rarity}
          data-ready={ready ? "true" : undefined}
          data-empty={fillPct === 0 ? "true" : undefined}
          style={{ width: `${fillPct}%` }}
        >
          <span className="jam-essence-wave" aria-hidden="true" />
          {particles.length > 0 && (
            <span
              className="jam-essence-particles"
              data-rarity={rarity}
              aria-hidden="true"
            >
              {particles.map((p) => {
                const style = {
                  left: `${p.leftPct}%`,
                  top: `${p.topPct}%`,
                  width: `${p.sizePx}px`,
                  height: `${p.sizePx}px`,
                  "--dx": `${p.driftX}px`,
                  "--dy": `${p.driftY}px`,
                  "--dur": `${p.durationSec}s`,
                  "--delay": `${p.delaySec}s`,
                } as CSSProperties;
                return (
                  <span
                    key={p.id}
                    className={
                      p.kind === "glint"
                        ? "jam-tube-particle jam-tube-glint"
                        : "jam-tube-particle jam-tube-bubble"
                    }
                    style={style}
                  />
                );
              })}
            </span>
          )}
          {fillPct > 0 && fillPct < 100 && (
            <span
              className="jam-essence-meniscus"
              data-pulse={pulsing ? "true" : undefined}
              aria-hidden="true"
            />
          )}
        </div>
        <span className="jam-essence-glass" aria-hidden="true" />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";

export interface JumpItem {
  id: string;
  label: string;
}

/**
 * Sticky rows of quick links under the header (they wrap, so every chip is reachable at any width): jumps to a section of a long tab without scrolling.
 * Sections carry ids starting with "sec-" (scroll offset set in index.css). Missing sections are skipped.
 */
export function JumpBar({ items }: { items: JumpItem[] }) {
  const [active, setActive] = useState<string | null>(null);
  const ref = useRef<HTMLElement | null>(null);
  // Its height (1 or 2 rows) feeds the scroll offset so sections land just below it.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty("--jam-jump-h", `${Math.round(el.getBoundingClientRect().height) + 4}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const details = el instanceof HTMLDetailsElement ? el : el.querySelector(":scope > details");
    if (details instanceof HTMLDetailsElement) details.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };
  return (
    <nav
      ref={ref}
      aria-label="Jump to section"
      className="jam-jumpbar sticky z-20 -mx-3 flex flex-wrap gap-1 px-3 py-1.5"
      style={{ top: "var(--jam-header-h, 0px)" }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => jump(it.id)}
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium transition ${
            active === it.id
              ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
              : "border-white/10 bg-[#111726] text-slate-300 hover:border-white/25 hover:text-slate-100"
          }`}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}

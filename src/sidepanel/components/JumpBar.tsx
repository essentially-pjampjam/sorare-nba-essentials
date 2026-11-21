import { useState } from "react";

export interface JumpItem {
  id: string;
  label: string;
}

/**
 * Sticky row of quick links under the header: jumps to a section of a long tab without scrolling.
 * Sections carry ids starting with "sec-" (scroll offset set in index.css). Missing sections are skipped.
 */
export function JumpBar({ items }: { items: JumpItem[] }) {
  const [active, setActive] = useState<string | null>(null);
  const jump = (id: string, chip: HTMLElement) => {
    chip.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    const el = document.getElementById(id);
    if (!el) return;
    const details = el instanceof HTMLDetailsElement ? el : el.querySelector(":scope > details");
    if (details instanceof HTMLDetailsElement) details.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };
  return (
    <nav
      aria-label="Jump to section"
      className="jam-jumpbar sticky z-20 -mx-3 flex gap-1 overflow-x-auto px-3 py-1.5"
      style={{ top: "var(--jam-header-h, 0px)" }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={(e) => jump(it.id, e.currentTarget)}
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

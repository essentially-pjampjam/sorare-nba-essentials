import {
  ExternalLink,
  MessageSquare,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { SUPPORT_DONATION_INFO } from "../../shared/constants";
import { openInActiveTab } from "../api";

interface WhatsNewModalProps {
  version: string;
  onClose: () => void;
}

const RELEASE_HIGHLIGHTS: Array<{
  version: string;
  title: string;
  items: string[];
}> = [
  {
    version: "2.6.0",
    title: "Exact Scoring & Clean Community Feedback",
    items: [
      "Removed the obsolete +20% Captain bonus from Champion (16★) and Contender (11★) calculations so projections match Sorare NBA's live positional scoring.",
      "Daily Pickup (120 + MVP) now marks the cap-free superstar slot accurately without artificial score inflation.",
      "Added this in-app What's New dialog plus 1-click Send Feedback links to report bugs or request NBA features.",
    ],
  },
  {
    version: "2.5.0",
    title: "Multi-Season Longevity, 2-Card Swap & Setup Backup",
    items: [
      "Added 2-Card Cap Re-Allocator combo swaps (downsize one slot + buy a higher-tier star under your cap).",
      "Automatic October season rollover support for upcoming 2027-28+ NBA seasons.",
      "Export / Import JSON setup backup inside Settings (excludes personal API keys).",
    ],
  },
  {
    version: "2.4.0",
    title: "4+1 Classic Rule, Dual Buy Advisor & Pro UX",
    items: [
      "Added 3-way Season Rule switcher (4 In-Season + 1 Classic default, 5/5 In-Season, Any Season).",
      "Dual Buy Advisor comparing Best 1-Slot Classic steals vs. In-Season upgrades by +Pts/EUR, Max Pts, or Quest Synergy.",
      "Ctrl+K Quick Search Command Palette, Compact/Cozy density toggle, and 2-Player Head-to-Head Compare.",
    ],
  },
];

export function WhatsNewModal({ version, onClose }: WhatsNewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }

    const onCloseEvent = () => onClose();
    dialog.addEventListener("close", onCloseEvent);

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
    };

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
    }
    return () => {
      dialog.removeEventListener("close", onCloseEvent);
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointerup", onPointerUp);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="whats-new-title"
      {...({ closedby: "any" } as Record<string, string>)}
      className="glass-chrome max-h-[88vh] w-[calc(100%-24px)] max-w-md overflow-y-auto rounded-2xl p-4"
    >
      <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h2 id="whats-new-title" className="text-sm font-semibold text-slate-100">
            What&apos;s New (v{version})
          </h2>
        </div>
        <button
          type="button"
          autoFocus
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          aria-label="Close release notes"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2.5">
        {RELEASE_HIGHLIGHTS.map((rel) => (
          <div
            key={rel.version}
            className="rounded-xl border border-white/10 bg-[#0b101b] p-3"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                v{rel.version}
              </span>
              <span className="text-xs font-semibold text-slate-100">
                {rel.title}
              </span>
            </div>
            <ul className="space-y-1 text-[11px] leading-relaxed text-slate-300">
              {rel.items.map((item, idx) => (
                <li key={idx} className="flex gap-1.5">
                  <span className="text-emerald-400">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-sky-400/25 bg-sky-500/10 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-200">
          <Wrench className="h-3.5 w-3.5" />
          Feedback, Bugs &amp; Requests
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
          Found a bug, quest mismatch, or have a feature idea? Open a GitHub Issue
          directly or message <strong>{SUPPORT_DONATION_INFO.sorareHandle}</strong>.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void openInActiveTab(SUPPORT_DONATION_INFO.feedbackUrl);
              dialogRef.current?.close();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-300"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Send Feedback / Bug
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              void openInActiveTab(SUPPORT_DONATION_INFO.githubUrl);
              dialogRef.current?.close();
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-[#0b101b] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-amber-400/40"
          >
            View on GitHub
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>
    </dialog>
  );
}

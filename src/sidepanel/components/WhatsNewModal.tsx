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
    version: "2.6.7-exp.M1",
    title: "Experimental v2.7.0 M1: Working Sorare Links & Reliable Lineup Sync",
    items: [
      "Open Sorare Arena to Sync now opens the current Game Week's Arena lineups page (no more /nba/arena 404); Open Pro Play and Live Competition Rooms use verified Sorare NBA routes.",
      "The background now blocks known-404 Sorare routes, and lineup highlight can open a verified Sorare page first (groundwork for Go buttons).",
      "Arena lineup sync ignores status badges like Late Swap / 4/5 Locked and restores names shown in ALL CAPS (DeMar DeRozan, LeBron, LaMelo).",
    ],
  },
  {
    version: "2.6.6",
    title: "Live GW Cutoffs, Arena Open Lineup Sync & Market Buy Upgrades",
    items: [
      "Calibrated Pro & Arena lineup odds and Est. Rank against the latest closed Sorare Game Week cutoffs and field win rates (comparing e.g. In-Season 55% paid vs Classic 11% paid vs 50% Arena pods).",
      "Added Safe-Mode openedSo5Lineups querying plus automatic live Sorare Arena / Play DOM sync so submitted lineups populate Current Open Lineups & Upgrade Swaps immediately with a 1-click Open Sorare Arena CTA.",
      "Fixed Lineup Buy Advisor Safe-Mode market scans with best_value DESC starter discovery, unlocked 2-Card Cap Re-Allocator Combos even when 1-for-1 swaps are capped, upgraded Scan Market Buys CTA, and prioritized builder controls over reference drawers.",
    ],
  },
  {
    version: "2.6.5",
    title: "Live 2026-27 Pro/Arena Rooms, Accurate Boosting & Spinner Fix",
    items: [
      "Replaced retired Pro Daily Pickup (120 + MVP) with live 2026-27 Pro & Arena Star-Cap modes (Champion 16★, Contender 11★, Arena Champ 15★, Arena Contender 12★, Uncapped) plus U23 / Veterans sub-room filters.",
      "Updated the Best Boosting Guide to match verified 2026-27 rules (flat +5% In-Season, up to +5% Team Collection, Card XP halved on sale, Scarcity mix & Vault boosts, no Captain in Pro) and added a Live Competition Rooms directory.",
      "Added rebuild toast feedback on Auto-Build Best Pro Lineups and fixed Team Collections batch buttons so only the clicked button (Top 3, Load 26-27, or Load All) shows the loading spinner.",
    ],
  },
  {
    version: "2.6.4",
    title: "Real Essence Quests Only + Any-Year Team Hunter",
    items: [
      "Removed phantom +150E/+350E/+500E preset payouts from Team Collections so the Collections tab tracks only verified Sorare Essence sources (Live League Quests & Full Team +2,000E).",
      "Promoted Real Essence Quests (Quick Finder) to the top of Collections with Wallet Cash checks against the #1 real Quest cost.",
      "Moved Team Collections into its own Bonus % & Any-Year Hunter section with Top 3, Load 26-27, Load All, Active 26-27 <-> All Years toggle, and Min Card floor sorting.",
    ],
  },
  {
    version: "2.6.3",
    title: "Draft 26' 1ST Buy & True Ending-Soon Auctions Fix",
    items: [
      "Added targeted Draft 26' Top-30 rookie PrimaryOffer and <1h auction discovery so 1ST Instant Buys (EUR 3.49+) no longer get hidden behind cheaper vets.",
      "Switched live auction sorting to Sorare's real sale.end_date ASC field so auctions ending within <1h populate reliably in both Deals and League Quests.",
      "Kept top Instant Buy and <1h Auction picks independently per Quest so 1ST BUY rows never crowd out live auctions.",
    ],
  },
  {
    version: "2.6.2",
    title: "Sorare NBA Essentials Rebrand, <1h Auctions & Instant Buy Fix",
    items: [
      "Renamed extension & repository to pjampjam's Sorare NBA Essentials (sorare-nba-essentials) so Sorare and NBA sit front and center.",
      "Auction seeker now filters out auctions with >1h left so early 0-bid starting prices don't look artificially cheap.",
      "Switched 1ST Instant Buy & team collection pricing to grouped SingleSaleOffer / PrimaryOffer discovery so Instant Buy floors populate reliably.",
      "Added Load 26-27 alongside Top 3 / Load All with clear rate-limit timing notes, Stop button, and full-row clickable Quest & Collection headers.",
    ],
  },
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

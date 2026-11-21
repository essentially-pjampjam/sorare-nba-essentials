import {
  ArrowLeftRight,
  Check,
  Copy,
  ExternalLink,
  Heart,
  MessageSquare,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SUPPORT_DONATION_INFO } from "../../shared/constants";
import { openInActiveTab } from "../api";

interface SupportModalProps {
  onClose: () => void;
}

export function SupportModal({ onClose }: SupportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const handleCopy = (network: string, address: string) => {
    void navigator.clipboard.writeText(address);
    setCopiedKey(network);
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="support-dialog-title"
      {...({ closedby: "any" } as Record<string, string>)}
      className="glass-chrome max-h-[90vh] w-[calc(100%-24px)] max-w-md overflow-y-auto rounded-2xl p-4"
    >
      <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-amber-400" />
          <h2
            id="support-dialog-title"
            className="text-sm font-semibold text-slate-100"
          >
            Support Sorare NBA Essentials
          </h2>
        </div>
        <button
          type="button"
          autoFocus
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          aria-label="Close support dialog"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-slate-300">
        Sorare NBA Essentials is free, local-first, and open-source (MIT). Use at
        your own risk - independent companion not affiliated with Sorare or the
        NBA. Report bugs or request features directly via GitHub Issues. If this
        helper saved you time or Essence, optional Sorare card trades or tips
        are always appreciated!
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void openInActiveTab(SUPPORT_DONATION_INFO.feedbackUrl);
            dialogRef.current?.close();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/25"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Send Feedback / Report Bug
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
          Source Code (GitHub)
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {/* Sorare Card Trade / Gift CTA */}
      <div className="mt-3 rounded-xl border border-amber-400/35 bg-amber-400/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-amber-200">
              Send a Sorare Card Trade
            </div>
            <div className="mt-0.5 text-[11px] text-slate-300">
              Club handle:{" "}
              <strong className="text-amber-300">
                {SUPPORT_DONATION_INFO.sorareHandle}
              </strong>
              <span className="text-slate-400"> • opens my club; sign in to Sorare to send a trade</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void openInActiveTab(SUPPORT_DONATION_INFO.sorareTradeUrl);
              dialogRef.current?.close();
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl jam-btn-primary px-3 py-1.5 text-xs font-semibold text-slate-950"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Trade Cards
          </button>
        </div>
      </div>

      {/* Multi-Chain Crypto Tip Addresses */}
      <div className="mt-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <Wallet className="h-3 w-3 text-sky-400" />
          Crypto Tip Wallets (1-Click Copy)
        </div>
        <div className="space-y-1.5">
          {SUPPORT_DONATION_INFO.wallets.map((w) => {
            const isCopied = copiedKey === w.network;
            return (
              <div
                key={w.network}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0b101b] px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-semibold text-slate-100">
                      {w.network}
                    </span>
                    <span className="truncate text-[10px] text-slate-400">
                      {w.hint}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-amber-300">
                    {w.address}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(w.network, w.address)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1 text-[10px] font-medium text-slate-200 hover:border-amber-400/50"
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 text-slate-400" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}

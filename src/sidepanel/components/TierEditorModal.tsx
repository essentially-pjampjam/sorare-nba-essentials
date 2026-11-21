import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MILESTONE_RULES, RARITY_META } from "../../shared/constants";
import type { EssenceMilestoneRule, Rarity } from "../../shared/types";

interface TierEditorModalProps {
  rarity: Rarity;
  rules: EssenceMilestoneRule[];
  onSave: (rules: EssenceMilestoneRule[]) => void;
  onClose: () => void;
}

export function TierEditorModal({
  rarity,
  rules,
  onSave,
  onClose,
}: TierEditorModalProps) {
  const [draft, setDraft] = useState<EssenceMilestoneRule[]>(() =>
    rules.map((r) => ({ ...r })),
  );
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    const onCloseEvent = () => onClose();
    dialog.addEventListener("close", onCloseEvent);
    return () => dialog.removeEventListener("close", onCloseEvent);
  }, [onClose]);

  const meta = RARITY_META[rarity];

  const updateRule = (idx: number, patch: Partial<EssenceMilestoneRule>) => {
    setDraft((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)),
    );
  };

  const addTier = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: `${rarity}-${Date.now()}`,
        label: "Custom Tier",
        kind: "slots",
        threshold: 5,
        essenceReward: 150,
      },
    ]);
  };

  const removeTier = (idx: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="tier-editor-title"
      {...({ closedby: "any" } as Record<string, string>)}
      className="glass-chrome w-[calc(100%-24px)] max-w-md rounded-2xl p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2
            id="tier-editor-title"
            className="text-sm font-semibold text-slate-100"
          >
            Custom {meta.label} Team Essence Tiers (Optional)
          </h2>
          <p className="text-[11px] text-slate-400">
            Sorare NBA 2026-27 Team Collections award Lineup Bonus % by default
            (Quests handle real Essence). Only add custom tiers for promos or
            personal targets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          aria-label="Close tier editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {draft.map((rule, idx) => (
          <div
            key={rule.id}
            className="grid grid-cols-12 items-center gap-1.5 rounded-xl border border-white/8 bg-[#0b101b] p-2"
          >
            <input
              type="text"
              value={rule.label}
              onChange={(e) => updateRule(idx, { label: e.target.value })}
              className="col-span-4 rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
              placeholder="Label"
            />
            <select
              value={rule.kind}
              onChange={(e) =>
                updateRule(idx, {
                  kind: e.target.value as "slots" | "score",
                })
              }
              className="col-span-2 rounded-lg border border-white/10 bg-[#141c2f] px-1 py-1 text-xs text-slate-200 focus:border-amber-400 focus:outline-none"
            >
              <option value="slots">Cards</option>
              <option value="score">Score</option>
            </select>
            <input
              type="number"
              min={1}
              value={rule.threshold}
              onChange={(e) =>
                updateRule(idx, {
                  threshold: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="col-span-2 rounded-lg border border-white/10 bg-[#141c2f] px-1.5 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
              title="Target threshold"
            />
            <input
              type="number"
              min={1}
              value={rule.essenceReward}
              onChange={(e) =>
                updateRule(idx, {
                  essenceReward: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="col-span-3 rounded-lg border border-white/10 bg-[#141c2f] px-1.5 py-1 text-xs text-amber-300 focus:border-amber-400 focus:outline-none"
              title="Essence rewarded"
            />
            <button
              type="button"
              onClick={() => removeTier(idx)}
              className="col-span-1 flex justify-center text-slate-500 hover:text-rose-400"
              title="Remove tier"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addTier}
            className="rounded-lg border border-white/10 bg-[#141c2f] px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            + Add Tier
          </button>
          <button
            type="button"
            onClick={() =>
              setDraft(DEFAULT_MILESTONE_RULES[rarity].map((r) => ({ ...r })))
            }
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-lg px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              dialogRef.current?.close();
            }}
            className="rounded-lg jam-btn-primary px-3 py-1 text-xs font-semibold text-slate-950"
          >
            Save Tiers
          </button>
        </div>
      </div>
    </dialog>
  );
}

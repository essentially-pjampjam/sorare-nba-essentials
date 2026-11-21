import { openInActiveTab } from "../api";

/** Small "Go" jump: opens the matching Sorare page in the active tab (next to Apply / Pin). */
export function GoButton({ url, title }: { url: string; title: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => void openInActiveTab(url)}
      className="inline-flex shrink-0 items-center rounded-lg jam-btn-secondary px-2 py-0.5 text-[10px] font-bold text-sky-100 hover:border-sky-300"
    >
      Go
    </button>
  );
}

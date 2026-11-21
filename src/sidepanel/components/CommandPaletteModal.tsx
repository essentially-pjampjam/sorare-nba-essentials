import {
  ArrowRight,
  ExternalLink,
  Layers,
  Maximize2,
  Search,
  Settings,
  Sparkles,
  Tag,
  TrendingDown,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCardSeasonLabel, SORARE_NBA_CARD_URL } from "../../shared/constants";
import type {
  BargainListing,
  CollectionRaw,
  Currency,
  GalleryCard,
} from "../../shared/types";
import { openInActiveTab } from "../api";
import { formatMoney } from "../utils/format";

type PaletteTab = "collections" | "craft" | "lineups" | "bargains" | "gallery";

interface PaletteItem {
  id: string;
  group: "Tab" | "My Card" | "Market Deal" | "Collection";
  title: string;
  subtitle: string;
  badge?: string;
  onSelect: () => void;
}

interface CommandPaletteModalProps {
  galleryCards: GalleryCard[];
  collections: CollectionRaw[];
  deals: BargainListing[];
  currency: Currency;
  onSwitchTab: (tab: PaletteTab) => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onClose: () => void;
}

export function CommandPaletteModal({
  galleryCards,
  collections,
  deals,
  currency,
  onSwitchTab,
  onOpenSettings,
  onOpenDashboard,
  onClose,
}: CommandPaletteModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    inputRef.current?.focus();

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

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteItem[] = [];

    const navActions: PaletteItem[] = [
      {
        id: "nav-collections",
        group: "Tab",
        title: "Collections & League Quests",
        subtitle: "Track Draft 26', Playoffs, Non-Playoffs & Team Floors",
        onSelect: () => {
          onSwitchTab("collections");
          onClose();
        },
      },
      {
        id: "nav-lineups",
        group: "Tab",
        title: "Lineup Builder, 4+1 Classic & Dual Buy Advisor",
        subtitle: "Autobuilder, Portfolio Optimizer, Schedule & Market Buys",
        onSelect: () => {
          onSwitchTab("lineups");
          onClose();
        },
      },
      {
        id: "nav-bargains",
        group: "Tab",
        title: "Deals & Auction Sniper Watchlist",
        subtitle: "1ST Instant Buys, Ending Auctions, $/L10 & Sniper Alerts",
        onSelect: () => {
          onSwitchTab("bargains");
          onClose();
        },
      },
      {
        id: "nav-gallery",
        group: "Tab",
        title: "My Gallery, Vault & Sell Advisor",
        subtitle: "Sort by ★, L10, L5, Star Tier Shift & Vault ROI",
        onSelect: () => {
          onSwitchTab("gallery");
          onClose();
        },
      },
      {
        id: "nav-craft",
        group: "Tab",
        title: "Craft Reveal & Probability EV",
        subtitle: "Calculate Essence pull odds & collection overlaps",
        onSelect: () => {
          onSwitchTab("craft");
          onClose();
        },
      },
      {
        id: "nav-dashboard",
        group: "Tab",
        title: "Pop-Out Full Screen Website Dashboard",
        subtitle: "Expand into full wide multi-column view",
        onSelect: () => {
          onOpenDashboard();
          onClose();
        },
      },
      {
        id: "nav-settings",
        group: "Tab",
        title: "Settings, Themes & API Key",
        subtitle: "Switch color theme, Fast API Key & Density",
        onSelect: () => {
          onOpenSettings();
          onClose();
        },
      },
    ];

    for (const nav of navActions) {
      if (
        !q ||
        `${nav.title} ${nav.subtitle}`.toLowerCase().includes(q)
      ) {
        out.push(nav);
      }
    }

    if (q) {
      let cardHits = 0;
      const rarityLabelMap: Record<GalleryCard["rarity"], string> = {
        common: "Set",
        limited: "Limited",
        rare: "Rare",
        super_rare: "S. Rare",
        unique: "Unique",
      };
      for (const c of galleryCards) {
        if (cardHits >= 8) break;
        const rarityLabel = rarityLabelMap[c.rarity] ?? c.rarity;
        const hay = `${c.playerName} ${c.teamName ?? ""} ${c.seasonYear} ${rarityLabel}`.toLowerCase();
        if (!hay.includes(q)) continue;
        cardHits += 1;
        out.push({
          id: `card-${c.slug}`,
          group: "My Card",
          title: c.playerName,
          subtitle: `${rarityLabel} • ${c.teamName ?? "NBA"} • ${c.starCost}★ • L10 ${c.l10?.toFixed(1) ?? "--"} • ${formatCardSeasonLabel(c.seasonYear, c.inSeasonEligible)}`,
          badge: c.isFirstOwner ? "1ST" : c.rarity === "common" ? "SET" : undefined,
          onSelect: () => {
            void openInActiveTab(`${SORARE_NBA_CARD_URL}/${c.slug}`);
            onClose();
          },
        });
      }

      let dealHits = 0;
      for (const d of deals) {
        if (dealHits >= 6) break;
        const hay = `${d.playerName} ${d.teamName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
        dealHits += 1;
        out.push({
          id: `deal-${d.cardSlug}-${d.isPrimaryOffer ? "p" : d.saleType}`,
          group: "Market Deal",
          title: `${d.playerName} (${formatMoney(d.priceCents, currency)})`,
          subtitle: `${formatCardSeasonLabel(d.seasonYear, d.inSeasonEligible)} • ${d.starCost}★ • L10 ${d.l10} • ${d.isPrimaryOffer ? "1ST Instant" : d.saleType === "auction" ? "Auction" : "Instant"}`,
          onSelect: () => {
            void openInActiveTab(d.marketUrl);
            onClose();
          },
        });
      }

      let colHits = 0;
      for (const col of collections) {
        if (colHits >= 5) break;
        if (!col.name.toLowerCase().includes(q)) continue;
        colHits += 1;
        out.push({
          id: `col-${col.slug}`,
          group: "Collection",
          title: col.name,
          subtitle: `${col.fulfilledSlotsCount}/${col.slotsCount} slots • Score ${col.score}`,
          onSelect: () => {
            onSwitchTab("collections");
            onClose();
          },
        });
      }
    }

    return out;
  }, [
    collections,
    currency,
    deals,
    galleryCards,
    onClose,
    onOpenDashboard,
    onOpenSettings,
    onSwitchTab,
    query,
  ]);

  const safeIdx = Math.min(activeIndex, Math.max(0, items.length - 1));

  const renderIcon = (item: PaletteItem) => {
    if (item.id === "nav-craft") return <Sparkles className="h-3.5 w-3.5 text-emerald-400" />;
    if (item.id === "nav-lineups") return <Wand2 className="h-3.5 w-3.5 text-sky-400" />;
    if (item.id === "nav-bargains") return <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />;
    if (item.id === "nav-gallery") return <Layers className="h-3.5 w-3.5 text-amber-400" />;
    if (item.id === "nav-dashboard") return <Maximize2 className="h-3.5 w-3.5 text-sky-300" />;
    if (item.id === "nav-settings") return <Settings className="h-3.5 w-3.5 text-slate-300" />;
    if (item.group === "Market Deal") return <Tag className="h-3.5 w-3.5 text-amber-400" />;
    if (item.group === "My Card") return <Layers className="h-3.5 w-3.5 text-sky-300" />;
    return <ArrowRight className="h-3.5 w-3.5 text-amber-400" />;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="cmd-palette-title"
      {...({ closedby: "any" } as Record<string, string>)}
      className="glass-chrome max-h-[85vh] w-[calc(100%-24px)] max-w-lg overflow-hidden rounded-2xl p-0"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-amber-400" />
        <input
          ref={inputRef}
          id="cmd-palette-title"
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && items[safeIdx]) {
              e.preventDefault();
              items[safeIdx].onSelect();
            }
          }}
          placeholder="Search tabs, players, deals, or teams (Ctrl+K)..."
          aria-label="Quick command search"
          className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          aria-label="Close command palette"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            No matching tabs, owned cards, collections, or scanned deals.
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item, idx) => {
              const selected = idx === safeIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onSelect}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                    selected
                      ? "bg-amber-400/15 text-slate-50 ring-1 ring-amber-400/40"
                      : "text-slate-200 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="shrink-0">{renderIcon(item)}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-300">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-slate-400">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-[9.5px] text-slate-400">
                    <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5">
                      {item.group}
                    </span>
                    {(item.group === "My Card" || item.group === "Market Deal") && (
                      <ExternalLink className="h-3 w-3" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </dialog>
  );
}

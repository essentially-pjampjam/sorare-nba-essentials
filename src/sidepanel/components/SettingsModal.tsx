import {
  Check,
  Cloud,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { APP_THEMES, RARITIES } from "../../shared/constants";
import type { CloudAuthChallenge, ProjectionSource, Rarity, UserSettings } from "../../shared/types";
import {
  cloudLogout,
  pushCloudTags,
  startCloudAuth,
  verifyCloudAuth,
} from "../api";
import { AlertSettingsSection } from "./AlertSettingsSection";

interface SettingsModalProps {
  version: string;
  settings: UserSettings;
  focusApiKey?: boolean;
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
  onOpenTierEditor: () => void;
  onOpenWhatsNew?: () => void;
  onClearCache: () => void;
  onReloadExtension: () => void;
  onClose: () => void;
}

export function SettingsModal({
  version,
  settings,
  focusApiKey = false,
  onUpdateSettings,
  onOpenTierEditor,
  onOpenWhatsNew,
  onClearCache,
  onReloadExtension,
  onClose,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [workerUrlDraft, setWorkerUrlDraft] = useState(
    () => settings.cloudSyncWorkerUrl ?? "",
  );
  const [cloudChallenge, setCloudChallenge] = useState<CloudAuthChallenge | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(() =>
    settings.sorareApiKey?.startsWith("••••") ? "" : (settings.sorareApiKey ?? ""),
  );
  const [showKey, setShowKey] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    if (focusApiKey) {
      window.setTimeout(() => apiKeyInputRef.current?.focus(), 40);
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
  }, [focusApiKey, onClose]);

  const handleSaveApiKey = () => {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed && settings.sorareApiKey) {
      setSavedToast(true);
      window.setTimeout(() => setSavedToast(false), 1800);
      return;
    }
    onUpdateSettings({
      sorareApiKey: trimmed,
      apiKeyPromptDismissed: true,
    });
    setApiKeyDraft("");
    setSavedToast(true);
    window.setTimeout(() => setSavedToast(false), 1800);
  };

  const handleExportBackup = () => {
    const payload = {
      schema: "sorare-essentials-backup-v1",
      exportedAt: new Date().toISOString(),
      theme: settings.theme,
      density: settings.density ?? "cozy",
      currency: settings.currency,
      selectedRarity: settings.selectedRarity,
      craftThreshold: settings.craftThreshold,
      autoOpenOnCraft: settings.autoOpenOnCraft,
      autoOpenOnSorare: settings.autoOpenOnSorare,
      autoShowInPageWizards: settings.autoShowInPageWizards ?? true,
      autoPriceTopN: settings.autoPriceTopN,
      projectionSource: settings.projectionSource,
      customProjectionsRaw: settings.customProjectionsRaw,
      milestoneRulesByRarity: settings.milestoneRulesByRarity,
      watchlist: settings.watchlist ?? [],
      alertsEnabled: settings.alertsEnabled,
      cutoffReminderEnabled: settings.cutoffReminderEnabled,
      cutoffReminderMinutesBefore: settings.cutoffReminderMinutesBefore,
      alertPreferences: settings.alertPreferences,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sorare-essentials-backup-v${version}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus("Exported JSON backup (API key excluded for safety).");
  };

  const handleImportBackup = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<UserSettings> & {
        schema?: string;
      };
      if (!parsed || typeof parsed !== "object") {
        setBackupStatus("Invalid JSON backup file.");
        return;
      }
      const validThemes = new Set(APP_THEMES.map((t) => t.id));
      const validRarities = new Set<Rarity>(RARITIES);
      const validProjectionSources = new Set<ProjectionSource>([
        "blended_smart",
        "sorare_projected",
        "sorare_l10",
        "sorare_l5",
        "custom_csv",
      ]);
      const patch: Partial<UserSettings> = {};
      if (parsed.theme && validThemes.has(parsed.theme)) patch.theme = parsed.theme;
      if (parsed.density === "compact" || parsed.density === "cozy") {
        patch.density = parsed.density;
      }
      if (parsed.currency === "USD" || parsed.currency === "EUR") {
        patch.currency = parsed.currency;
      }
      if (parsed.selectedRarity && validRarities.has(parsed.selectedRarity)) {
        patch.selectedRarity = parsed.selectedRarity;
      }
      if (typeof parsed.craftThreshold === "number" && Number.isFinite(parsed.craftThreshold)) {
        patch.craftThreshold = parsed.craftThreshold;
      }
      if (typeof parsed.autoOpenOnCraft === "boolean") {
        patch.autoOpenOnCraft = parsed.autoOpenOnCraft;
      }
      if (typeof parsed.autoOpenOnSorare === "boolean") {
        patch.autoOpenOnSorare = parsed.autoOpenOnSorare;
      }
      if (typeof parsed.autoShowInPageWizards === "boolean") {
        patch.autoShowInPageWizards = parsed.autoShowInPageWizards;
      }
      if (typeof parsed.autoPriceTopN === "number" && Number.isFinite(parsed.autoPriceTopN)) {
        patch.autoPriceTopN = parsed.autoPriceTopN;
      }
      if (parsed.projectionSource && validProjectionSources.has(parsed.projectionSource)) {
        patch.projectionSource = parsed.projectionSource;
      }
      if (typeof parsed.customProjectionsRaw === "string") {
        patch.customProjectionsRaw = parsed.customProjectionsRaw;
      }
      if (parsed.milestoneRulesByRarity && typeof parsed.milestoneRulesByRarity === "object") {
        patch.milestoneRulesByRarity = parsed.milestoneRulesByRarity;
      }
      if (Array.isArray(parsed.watchlist)) {
        patch.watchlist = parsed.watchlist;
      }
      if (typeof parsed.alertsEnabled === "boolean") {
        patch.alertsEnabled = parsed.alertsEnabled;
      }
      if (typeof parsed.cutoffReminderEnabled === "boolean") {
        patch.cutoffReminderEnabled = parsed.cutoffReminderEnabled;
      }
      if (
        typeof parsed.cutoffReminderMinutesBefore === "number" &&
        Number.isFinite(parsed.cutoffReminderMinutesBefore)
      ) {
        patch.cutoffReminderMinutesBefore = parsed.cutoffReminderMinutesBefore;
      }
      if (parsed.alertPreferences && typeof parsed.alertPreferences === "object") {
        patch.alertPreferences = parsed.alertPreferences;
      }
      onUpdateSettings(patch);
      setBackupStatus("Setup imported successfully.");
    } catch {
      setBackupStatus("Failed to parse JSON backup file.");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-dialog-title"
      {...({ closedby: "any" } as Record<string, string>)}
      className="glass-chrome max-h-[90vh] w-[calc(100%-24px)] max-w-md overflow-y-auto rounded-2xl p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src="/logo.png"
            alt="pjampjam's Sorare NBA Essentials"
            className="h-8 w-8 shrink-0 rounded-lg object-contain"
          />
          <div className="min-w-0">
            <h2
              id="settings-dialog-title"
              className="text-sm font-semibold text-slate-100"
            >
              Settings &amp; API Fast Mode
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
              <span>pjampjam&apos;s Sorare NBA Essentials</span>
              <span
                className={`rounded px-1.5 py-px font-mono text-[10px] font-medium ${
                  /-exp/i.test(version)
                    ? "border border-rose-400/50 bg-rose-500/15 text-rose-300"
                    : "bg-white/8 text-amber-300"
                }`}
              >
                v{version}
              </span>
              {onOpenWhatsNew && (
                <button
                  type="button"
                  onClick={() => {
                    dialogRef.current?.close();
                    onOpenWhatsNew();
                  }}
                  className="text-[10.5px] font-medium text-sky-300 hover:text-sky-200 hover:underline"
                >
                  What&apos;s New
                </button>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Optional Sorare API Key (Fast Mode) */}
      <div className="mb-3 rounded-xl border border-amber-400/25 bg-[#0b101b] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
            <KeyRound className="h-3.5 w-3.5" />
            Sorare API Key (Optional Fast Mode)
          </div>
          {settings.sorareApiKey ? (
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              Active
            </span>
          ) : (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              Public Mode
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Stored <strong>locally on your device only</strong> (never sent
          anywhere except <code className="text-slate-300">api.sorare.com</code>
          ). Raises complexity limit 60× (500 → 30,000) for near-instant scans.
          Find or request yours in Sorare{" "}
          <span className="text-slate-300">
            Settings → Account, Safety & Legal → API key
          </span>
          .
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              ref={apiKeyInputRef}
              type={showKey ? "text" : "password"}
              value={apiKeyDraft}
              autoComplete="off"
              spellCheck={false}
              aria-label="Personal Sorare API key"
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={
                settings.sorareApiKey
                  ? `Saved (${settings.sorareApiKey}) - paste new key to replace`
                  : "Paste personal Sorare APIKEY..."
              }
              className="w-full rounded-lg border border-white/10 bg-[#141c2f] py-1.5 pl-2.5 pr-7 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((prev) => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={handleSaveApiKey}
            className="rounded-lg border border-sky-200/60 jam-btn-primary px-2.5 py-1.5 text-xs font-semibold text-slate-950"
          >
            {savedToast ? "Saved" : "Save"}
          </button>
          {settings.sorareApiKey && (
            <button
              type="button"
              onClick={() => {
                setApiKeyDraft("");
                onUpdateSettings({ sorareApiKey: "" });
              }}
              className="rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1.5 text-[11px] text-slate-300 hover:text-rose-300"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Theme / Appearance Selector */}
      <div className="mb-3 rounded-xl border border-white/10 bg-[#0b101b] p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-100">
          <Palette className="h-3.5 w-3.5 text-amber-400" />
          Theme &amp; Surface Palette
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {APP_THEMES.map((t) => {
            const active = settings.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onUpdateSettings({ theme: t.id })}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] transition ${
                  active
                    ? "border-amber-400/60 bg-amber-400/12 text-amber-200"
                    : "border-white/8 bg-[#141c2f] text-slate-300 hover:border-white/25"
                }`}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-md border border-white/25"
                  style={{ backgroundColor: t.swatch }}
                />
                <span className="min-w-0 truncate font-medium">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Behavior Settings */}
      <div className="space-y-2 text-xs">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#0b101b] px-3 py-2.5">
          <div>
            <div className="font-medium text-slate-100">
              Auto-open Craft Advisor on Craft pages
            </div>
            <div className="text-[11px] text-slate-400">
              Opens directly to Craft Advisor on your first click on Sorare
              /craft pages.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoOpenOnCraft}
            onChange={(e) =>
              onUpdateSettings({ autoOpenOnCraft: e.target.checked })
            }
            className="h-4 w-4 accent-amber-400"
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#0b101b] px-3 py-2.5">
          <div>
            <div className="font-medium text-slate-100">
              Auto-open Helper on any Sorare click
            </div>
            <div className="text-[11px] text-slate-400">
              Opens Side Panel on your first click when visiting sorare.com.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoOpenOnSorare}
            onChange={(e) =>
              onUpdateSettings({ autoOpenOnSorare: e.target.checked })
            }
            className="h-4 w-4 accent-amber-400"
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#0b101b] px-3 py-2.5">
          <div>
            <div className="font-medium text-slate-100">
              Contextual Sorare Wizards &amp; Full-View Launcher
            </div>
            <div className="text-[11px] text-slate-400">
              Auto-detects Collect Quests, Lineup Builder, and Craft dialogs on
              sorare.com and shows direct Helper + Full Dashboard actions.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoShowInPageWizards ?? true}
            onChange={(e) =>
              onUpdateSettings({ autoShowInPageWizards: e.target.checked })
            }
            className="h-4 w-4 accent-amber-400"
          />
        </label>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#0b101b] px-3 py-2.5">
          <div>
            <div className="font-medium text-slate-100">
              Auto-price closest collections
            </div>
            <div className="text-[11px] text-slate-400">
              `0 (Click to price)` keeps Sorare API calls minimal.
            </div>
          </div>
          <select
            value={settings.autoPriceTopN}
            aria-label="Auto-price closest collections count"
            onChange={(e) =>
              onUpdateSettings({ autoPriceTopN: Number(e.target.value) })
            }
            className="rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
          >
            <option value={0}>0 (Click to price)</option>
            <option value={2}>Top 2</option>
            <option value={4}>Top 4</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            dialogRef.current?.close();
            onOpenTierEditor();
          }}
          className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-[#0b101b] px-3 py-2 text-left text-slate-200 hover:border-amber-400/40"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <SlidersHorizontal className="h-3.5 w-3.5 text-amber-400" />
            Custom Team Essence Tiers (Optional)
          </span>
          <span className="text-[11px] text-slate-400">Configure</span>
        </button>
      </div>

      <AlertSettingsSection settings={settings} onUpdateSettings={onUpdateSettings} />

      {/* Backup & Restore Setup JSON */}
      <div className="mt-3 rounded-xl border border-white/8 bg-[#0b101b] p-2.5 text-[11px]">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-200">
            Backup &amp; Restore Setup (JSON)
          </span>
          <input
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void handleImportBackup(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleExportBackup}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#141c2f] px-2.5 py-1 text-[10.5px] font-medium text-slate-200 hover:border-amber-400/40"
          >
            <Download className="h-3 w-3 text-amber-400" />
            Export Setup JSON
          </button>
          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#141c2f] px-2.5 py-1 text-[10.5px] font-medium text-slate-200 hover:border-sky-400/40"
          >
            <Upload className="h-3 w-3 text-sky-400" />
            Import Setup JSON
          </button>
        </div>
        {backupStatus && (
          <div className="mt-1 text-[10px] text-emerald-300">{backupStatus}</div>
        )}
      </div>

      {/* Optional Cloud Sync & Public Card Tags (Cloudflare Worker + Bio Auth) */}
      <div className="mt-3 rounded-xl border border-white/8 bg-[#0b101b] p-3 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200">
            <Cloud className="h-3.5 w-3.5 text-sky-300" />
            Cloud Card Tags Sync (Optional)
          </div>
          {settings.cloudSyncUsername && (
            <span className="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-px text-[10px] font-semibold text-emerald-200">
              @{settings.cloudSyncUsername}
            </span>
          )}
        </div>
        <p className="mb-2 text-[10.5px] text-slate-400">
          Card tags (Keep / Sell / Core / Trade) always work 100% locally. Add your Cloudflare
          Worker URL to verify via Sorare bio and share public gallery tags.
        </p>

        <div className="flex gap-1.5">
          <input
            type="url"
            value={workerUrlDraft}
            onChange={(e) => setWorkerUrlDraft(e.target.value)}
            placeholder="https://sorare-tags.your-subdomain.workers.dev"
            aria-label="Cloudflare Worker URL"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#141c2f] px-2.5 py-1.5 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              onUpdateSettings({ cloudSyncWorkerUrl: workerUrlDraft.trim() });
              setCloudMsg("Saved Worker URL.");
            }}
            className="rounded-lg border border-white/10 bg-[#141c2f] px-2.5 py-1 text-[10.5px] font-semibold text-slate-200 hover:border-sky-400/40"
          >
            Save
          </button>
        </div>

        {!settings.cloudSyncUsername ? (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={cloudBusy || !workerUrlDraft.trim() || !settings.username.trim()}
                onClick={async () => {
                  setCloudBusy(true);
                  setCloudMsg(null);
                  try {
                    const ch = await startCloudAuth(settings.username, workerUrlDraft);
                    setCloudChallenge(ch);
                    setCloudMsg("Paste this code into your Sorare bio, then click Verify Bio.");
                  } catch (err) {
                    setCloudMsg(err instanceof Error ? err.message : "Challenge failed.");
                  } finally {
                    setCloudBusy(false);
                  }
                }}
                className="rounded-lg border border-sky-400/40 bg-sky-500/15 px-2.5 py-1 text-[10.5px] font-semibold text-sky-200 hover:bg-sky-500/25 disabled:opacity-40"
              >
                1. Generate Bio Code
              </button>
              {cloudChallenge && (
                <button
                  type="button"
                  disabled={cloudBusy}
                  onClick={async () => {
                    setCloudBusy(true);
                    setCloudMsg(null);
                    try {
                      const res = await verifyCloudAuth(
                        cloudChallenge.username,
                        cloudChallenge.challengeCode,
                        workerUrlDraft,
                      );
                      onUpdateSettings({
                        cloudSyncWorkerUrl: workerUrlDraft.trim(),
                        cloudSyncUsername: res.username,
                      });
                      setCloudChallenge(null);
                      setCloudMsg(`Verified @${res.username}! You can now remove the code from your bio.`);
                    } catch (err) {
                      setCloudMsg(err instanceof Error ? err.message : "Verification failed.");
                    } finally {
                      setCloudBusy(false);
                    }
                  }}
                  className="rounded-lg border border-emerald-400/45 bg-emerald-500/20 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  2. Verify Bio
                </button>
              )}
            </div>

            {cloudChallenge && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/30 bg-[#111726] px-2.5 py-1.5">
                <code className="text-[11px] font-bold text-sky-200">
                  {cloudChallenge.challengeCode}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(cloudChallenge.challengeCode);
                    setCopiedCode(true);
                    window.setTimeout(() => setCopiedCode(false), 1800);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-white/10"
                >
                  {copiedCode ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
                  {copiedCode ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={cloudBusy || !workerUrlDraft.trim()}
              onClick={async () => {
                setCloudBusy(true);
                setCloudMsg(null);
                try {
                  const res = await pushCloudTags(settings.cardTags ?? {}, workerUrlDraft);
                  setCloudMsg(`Synced ${res.count} public tags to Cloudflare D1.`);
                } catch (err) {
                  setCloudMsg(err instanceof Error ? err.message : "Sync failed.");
                } finally {
                  setCloudBusy(false);
                }
              }}
              className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
            >
              Push {Object.keys(settings.cardTags ?? {}).length} Tags to Cloud
            </button>
            <button
              type="button"
              onClick={async () => {
                await cloudLogout();
                onUpdateSettings({ cloudSyncUsername: "" });
                setCloudMsg("Signed out of Cloud Tag Sync.");
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1 text-[10.5px] text-slate-300 hover:border-rose-400/40 hover:text-rose-200"
            >
              <LogOut className="h-3 w-3" />
              Sign Out
            </button>
          </div>
        )}

        {cloudMsg && (
          <div className="mt-1.5 text-[10px] text-sky-300">{cloudMsg}</div>
        )}
      </div>

      {/* Disclaimers, Privacy & MIT License */}
      <div className="mt-3 rounded-xl border border-white/8 bg-[#0b101b] p-2.5 text-[10px] leading-relaxed text-slate-400">
        <div className="mb-1 flex items-center gap-1 font-semibold text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          Use at Own Risk • Disclaimer, Privacy &amp; License
        </div>
        <p>
          <strong>Use at your own risk.</strong> Independent open-source companion
          by <strong>pjampjam</strong> -{" "}
          <strong>not affiliated with, endorsed by, or sponsored by Sorare SAS, the NBA, or the NBPA.</strong>{" "}
          All market prices, Craft EV, and lineup projections are informational
          estimates only and do not constitute financial, investment, or betting
          advice. All settings and optional personal API keys remain strictly
          local in <code>chrome.storage.local</code> with zero telemetry or
          external tracking. MIT License (© 2026 pjampjam).
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={onClearCache}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#141c2f] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-800"
        >
          <Trash2 className="h-3.5 w-3.5 text-rose-400" />
          Clear 10m Cache
        </button>
        <button
          type="button"
          onClick={onReloadExtension}
          className="inline-flex items-center gap-1 rounded-lg jam-btn-primary px-3 py-1.5 text-[11px] font-semibold text-slate-950 shadow-sm"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Sync / Reload Extension
        </button>
      </div>
    </dialog>
  );
}

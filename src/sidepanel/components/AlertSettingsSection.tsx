import { BellRing, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { AlertPreferences, TrackedAlertEvent, UserSettings } from "../../shared/types";
import { getAlertFeed, runAlertCheck, sendTestAlertNotification } from "../api";

/** Mirrors DEFAULT_ALERT_PREFERENCES in src/background/alertTracker.ts (UI can't import background). */
const UI_DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  priceSurgeEnabled: true,
  priceSurgePctThreshold: 25,
  injuryRiskEnabled: true,
  bargainAlertEnabled: true,
  cutoffAlertEnabled: true,
  dailyResetAlertEnabled: true,
  browserNotificationsEnabled: true,
  cooldownMinutes: 60,
};

interface AlertSettingsSectionProps {
  settings: UserSettings;
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
}

interface ToggleRowProps {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/6 bg-[#0f1524] px-2.5 py-2 ${disabled ? "opacity-50" : ""}`}
    >
      <div>
        <div className="font-medium text-slate-100">{title}</div>
        <div className="text-[10px] text-slate-400">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={title}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-amber-400"
      />
    </label>
  );
}

function formatAgo(ms: number, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - ms) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** Settings block for the background Alert & Price Tracker (alarm every 15 min, no extra API calls). */
export function AlertSettingsSection({ settings, onUpdateSettings }: AlertSettingsSectionProps) {
  const prefs: AlertPreferences = {
    ...UI_DEFAULT_ALERT_PREFERENCES,
    ...(settings.alertPreferences ?? {}),
  };
  const alertsOn = settings.alertsEnabled === true;
  const [feed, setFeed] = useState<TrackedAlertEvent[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAlertFeed()
      .then((events) => {
        if (!cancelled && Array.isArray(events)) setFeed(events);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setPref = (patch: Partial<AlertPreferences>) =>
    onUpdateSettings({ alertPreferences: { ...prefs, ...patch } });

  const handleTest = async () => {
    try {
      const sent = await sendTestAlertNotification();
      setStatus(
        sent
          ? "Test notification sent."
          : "Not sent: turn on Alerts and Browser notifications first.",
      );
    } catch {
      setStatus("Could not send the test notification.");
    }
  };

  const handleCheck = async () => {
    try {
      const events = await runAlertCheck();
      setStatus(`Checked now: ${events.length} new alert(s).`);
      setFeed(await getAlertFeed());
    } catch {
      setStatus("Alert check failed.");
    }
  };

  const nowMs = Date.now();

  return (
    <div className="mt-3 space-y-1.5 rounded-xl border border-white/8 bg-[#0b101b] p-2.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
          <BellRing className="h-3.5 w-3.5 text-amber-400" />
          Alert &amp; Price Tracker
        </span>
        <input
          type="checkbox"
          checked={alertsOn}
          aria-label="Enable Alert & Price Tracker"
          onChange={(e) => onUpdateSettings({ alertsEnabled: e.target.checked })}
          className="h-4 w-4 accent-amber-400"
        />
      </div>
      <p className="text-[10px] text-slate-400">
        Checks every 15 min using your last panel load (no extra Sorare calls). Open the panel to
        refresh prices and injuries.
      </p>

      <ToggleRow
        title="Price surge / sell opportunity"
        description="Your card's Instant Buy floor rose past the threshold."
        checked={prefs.priceSurgeEnabled}
        disabled={!alertsOn}
        onChange={(v) => setPref({ priceSurgeEnabled: v })}
      />
      <div className={`flex items-center justify-between gap-3 px-2.5 ${alertsOn ? "" : "opacity-50"}`}>
        <span className="text-slate-300">Surge threshold</span>
        <select
          value={prefs.priceSurgePctThreshold}
          disabled={!alertsOn}
          aria-label="Price surge threshold percent"
          onChange={(e) => setPref({ priceSurgePctThreshold: Number(e.target.value) })}
          className="rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
        >
          {[10, 15, 25, 40, 60].map((p) => (
            <option key={p} value={p}>
              +{p}%
            </option>
          ))}
        </select>
      </div>
      <ToggleRow
        title="Injury risk in my cards / lineups"
        description="Owned player downgraded (e.g. Questionable to Out)."
        checked={prefs.injuryRiskEnabled}
        disabled={!alertsOn}
        onChange={(v) => setPref({ injuryRiskEnabled: v })}
      />
      <ToggleRow
        title="Watchlist bargains"
        description="Instant Buy listing matches a watchlist rule."
        checked={prefs.bargainAlertEnabled}
        disabled={!alertsOn}
        onChange={(v) => setPref({ bargainAlertEnabled: v })}
      />
      <ToggleRow
        title="Game Week cutoff reminder"
        description="Reminds you before the open Game Week locks."
        checked={settings.cutoffReminderEnabled === true}
        onChange={(v) =>
          onUpdateSettings({
            cutoffReminderEnabled: v,
            alertPreferences: { ...prefs, cutoffAlertEnabled: v || prefs.cutoffAlertEnabled },
          })
        }
      />
      <div className="flex items-center justify-between gap-3 px-2.5">
        <span className="text-slate-300">Cutoff lead time</span>
        <select
          value={settings.cutoffReminderMinutesBefore ?? 60}
          aria-label="Cutoff reminder minutes before lock"
          onChange={(e) => onUpdateSettings({ cutoffReminderMinutesBefore: Number(e.target.value) })}
          className="rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
        >
          {[30, 60, 120, 240].map((m) => (
            <option key={m} value={m}>
              {m >= 60 ? `${m / 60}h` : `${m} min`} before
            </option>
          ))}
        </select>
      </div>
      <ToggleRow
        title="Daily reset reminder (07:00 UTC)"
        description="30 min before the daily reset: dailies, Set picks, missions."
        checked={prefs.dailyResetAlertEnabled}
        disabled={!alertsOn}
        onChange={(v) => setPref({ dailyResetAlertEnabled: v })}
      />
      <ToggleRow
        title="Browser notifications"
        description="Show desktop notifications; off keeps alerts in the feed only."
        checked={prefs.browserNotificationsEnabled}
        disabled={!alertsOn}
        onChange={(v) => setPref({ browserNotificationsEnabled: v })}
      />
      <div className={`flex items-center justify-between gap-3 px-2.5 ${alertsOn ? "" : "opacity-50"}`}>
        <span className="text-slate-300">Repeat same alert after</span>
        <select
          value={prefs.cooldownMinutes}
          disabled={!alertsOn}
          aria-label="Alert cooldown minutes"
          onChange={(e) => setPref({ cooldownMinutes: Number(e.target.value) })}
          className="rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
        >
          {[30, 60, 180, 720, 1440].map((m) => (
            <option key={m} value={m}>
              {m >= 60 ? `${m / 60}h` : `${m} min`}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={handleTest}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg jam-btn-secondary px-2 py-1.5 font-semibold text-sky-100 hover:border-sky-300"
        >
          <Send className="h-3 w-3" />
          Send test notification
        </button>
        <button
          type="button"
          onClick={handleCheck}
          disabled={!alertsOn && settings.cutoffReminderEnabled !== true}
          className="flex-1 rounded-lg border border-white/10 bg-[#141c2f] px-2 py-1.5 font-semibold text-slate-200 hover:border-amber-400/40 disabled:opacity-50"
        >
          Check now
        </button>
      </div>
      {status && <div className="text-[10px] text-amber-200">{status}</div>}

      <div className="pt-1">
        <div className="mb-1 font-semibold text-slate-300">Recent alerts</div>
        {feed.length === 0 ? (
          <div className="text-[10px] text-slate-500">No alerts yet.</div>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {feed.slice(0, 10).map((ev) => (
              <li key={ev.id} className="rounded-md border border-white/6 bg-[#0f1524] px-2 py-1">
                <div className="flex justify-between gap-2">
                  {ev.targetUrl ? (
                    <a
                      href={ev.targetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-slate-100 hover:text-amber-300"
                    >
                      {ev.title}
                    </a>
                  ) : (
                    <span className="font-medium text-slate-100">{ev.title}</span>
                  )}
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {formatAgo(ev.createdAtMs, nowMs)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">{ev.message}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

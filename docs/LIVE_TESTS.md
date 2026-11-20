# Live Test Checklist (per experimental build)

Each milestone ships an experimental build. The header badge shows the build label
(`version_name` in `public/manifest.json`), so you can confirm the new build loaded.

**Load a build:** `npm run build` → `chrome://extensions` → pjampjam's Sorare NBA Essentials → **Reload** (↻).
Then reload any open sorare.com tabs so the new content script runs.

---

## 2.7.0-exp.M8 - Squad activity, Daily Picker fixes

See [../TESTING.md](../TESTING.md) T17-T20.

## 2.7.0-exp.M7 - Daily Play guide and strategies

See [../TESTING.md](../TESTING.md) T11-T15.

## 2.7.0-exp.M6 - Hardening

See [../TESTING.md](../TESTING.md) T1-T10 (T5, T9, T10 are new).

## 2.7.0-exp.M5 - Real rewards, live Daily Picker, Set Solo teams

Reload the extension, then **Refresh**. The numbered list lives in [../TESTING.md](../TESTING.md) (T1-T8).

## 2.6.10-exp.M4 - New side panel tools

Reload the extension, then **Refresh Gallery**.

| # | Do this | Expect |
|---|---|---|
| 1 | Open the side panel | Badge red, one line: `v2.6.10·M4`; What's New shows "Experimental M4" |
| 2 | Lineups tab, top bar | "GW Cutoff" and "Daily Reset (07:00 UTC)" countdowns tick; Cutoff reminder switch saves |
| 3 | Settings → Alert & Price Tracker → turn on, then **Send test notification** | A Windows/Chrome notification appears; "Check now" reports alerts; Recent alerts lists them |
| 4 | Lineups → Current Open Lineups | Each lineup shows Floor/Ceiling and notes; a "Page-synced Xm ago" line; after 2h it turns amber with "Open Sorare Lineups to refresh" |
| 5 | On sorare.com open a lineup's triple-dot menu | No empty 3rd lineup appears in the panel |
| 6 | Edit a lineup on Sorare with the panel closed, then reopen the panel | Old lineup is not shown as current (or the sync line says it's stale) |
| 7 | Recommended Entry box | Table of contests with Top / Cash / Top 20% / Podium |
| 8 | "Focus strength grade" (click to open) | Grade letter, best vs cut, weak spots and up to 3 upgrades |
| 9 | Click **Go** next to Apply / Pin (Pro, Set Solo, Set Squad, Daily Picker) | Opens the matching Sorare page in the current tab |
| 10 | Arena or In-Season builder | "Showing N / 5 lineups"; Classic shows "/ 3" |
| 11 | Gallery → "Vault & Sealing guide" | Live/est. points, sealed count, 14-day cooldown, delist and lineup-cancel warnings; Lopez / Quenton-type lineup players are **not** seal candidates |
| 12 | Gallery star badges | A small "est." only on cards without Sorare's live star rating |
| 13 | Lineups → Set | Solo allows up to 4 teams, Squad 1; rooms list only Solo (incl. Hot Streak) and Squad |

## 2.6.9-exp.M3 — Live Sorare data

Reload the extension (it now also asks for the **notifications** permission), then **Refresh Gallery**.

| # | Do this | Expect |
|---|---|---|
| 1 | Open the side panel | Badge red, one line: `v2.6.9·M3`; What's New shows "Experimental M3" |
| 2 | Lineups → Current Open Lineups, the Classic Limited Contender with Brooks / DeRozan / Gordon / Lopez / Carter Jr. | Star total matches Sorare's editor (Brooks 2★, DeRozan 1.5★); **no** "Cap fix: Brooks → Anderson" swap |
| 3 | Any built lineup | Star totals equal the sum of Sorare's star badges for those players |
| 4 | Gallery → Vault / Seal advice | VP per card matches the points Sorare shows in its seal dialog |
| 5 | Lineups → Live Competition Rooms → Set rooms | Arcade "16★ Cap • 4 Teams • 4 Lives", Squad "16★ Cap • 1 Team" |
| 6 | A lineup with a team on a back-to-back or a big-spread game | Projection slightly lower than before; 2-game players still ranked up |

**Not visible yet (UI in M4):** alert switches, alert feed, test-notification button, countdown timers.

## 2.6.8-exp.M2 — Smarter lineup math

| # | Do this | Expect |
|---|---|---|
| 1 | Open the side panel | Badge is **red** on one line: `v2.6.8·M2`; What's New shows "Experimental M2" |
| 2 | Lineups tab → Current Open Lineups (synced) → look at a swap row | Each swap has an **info icon**; hovering shows the reason (pts gained, stars before/after cap). No negative swap unless the row says **cap fix** |
| 3 | Same box, a lineup already equal to the optimum | Shows "already beats/matches the calculated optimum", no swaps, real ★ total (not 0★) |
| 4 | Build lineups with your synced lineups present | Cards from your synced lineups are not reused (no "in other lineup" card in a new build unless marked) |
| 5 | Recommended Entry line | Names a contest like **In-Season Contender 11★** with cash %, top-20% and podium odds plus the next two alternatives; never a contest under 5% cash while another is viable |
| 6 | Gallery tab → Vault/Seal advice | VP values are 1, 2, 5, 20, 50 or 200 per card (estimate) |

**Not visible yet (math only, UI in M4):** edit-focus notes, floor/ceiling overlay, seal candidate list,
countdown timers, alert tracker, side-by-side contest table, Classic 3-entry slot count.

## 2.6.7-exp.M1.1 — Lineup sync keeps up with edits

| # | Do this | Expect |
|---|---|---|
| 1 | Open the side panel | Badge is **red** and on one line: `v2.6.7·M1.1` |
| 2 | Open `sorare.com/nba/lineups/arena/<current GW>` (Open Sorare Arena to Sync) and wait ~5 s | Current Open Lineups shows **all** your open lineups, labelled e.g. **Classic Limited Contender** |
| 3 | On Sorare, edit one lineup (swap a player) → Confirm → land on the board page; wait ~5 s | That lineup updates in the panel (new player shown); your other lineups are still listed |

## 2.6.7-exp.M1 — Working Sorare links & reliable lineup sync

| # | Do this | Expect |
|---|---|---|
| 1 | Open the side panel | Header badge reads **2.6.7-exp.M1** with an unread dot; clicking it shows the "Experimental v2.7.0 M1" notes |
| 2 | Lineups tab → expand **Current Open Lineups & Upgrade Swaps** (with no synced lineups) → click **Open Sorare Arena to Sync** | Opens `sorare.com/nba/lineups/arena/<current GW>` (e.g. `nba-21-23-nov-2026`) showing your open lineups. **No 404.** (Falls back to `/nba/lineups/arena/ongoing` if no Game Week is open.) |
| 3 | Same box → **Open Pro Play** | Opens `sorare.com/nba/play` (Sorare redirects to the current Champion board). No 404 |
| 4 | Lineups tab → **Live Competition Rooms** → click **Open** on each room | Pro rooms → `/nba/play`; Arena → `/nba/lineups/arena/ongoing`; Set Solo / Hot Streak → `/nba/series/play`; Set Squad → `/nba/series/squad`. None 404 |
| 5 | With the side panel open, stay on the GW page from step 2 for ~5 s | The synced lineups show **full names with no trailing " -"** (e.g. `DeMar DeRozan`, `Nikola Vučević`), 5 players each, and no "Late Swap"/"Locked" pseudo-players |
| 6 | Any **Apply / highlight** button on a built lineup while on sorare.com | Lineup helper HUD still appears as before (no regression) |

**Known, not fixed in M1 (planned M2):** the readout can still show `0.0 / Opt …` and `0★`
for synced lineups, the lineup type is labelled "Arena Classic Contender" (it is Pro Classic
Limited Contender, 11★), and Recommended Entry still uses the old odds model.

Report results as: `M1 live: 1✅ 2✅ 3❌ (what you saw) …`

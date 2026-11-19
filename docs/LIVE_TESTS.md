# Live Test Checklist (per experimental build)

Each milestone ships an experimental build. The header badge shows the build label
(`version_name` in `public/manifest.json`), so you can confirm the new build loaded.

**Load a build:** `npm run build` → `chrome://extensions` → pjampjam's Sorare NBA Essentials → **Reload** (↻).
Then reload any open sorare.com tabs so the new content script runs.

---

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

# Changelog

All notable changes to pjampjam's Sorare NBA Essentials. Newest first.

## 2.7.2 (2026-11-20)

Added:
- Daily Play syncs Sorare's live daily pickers (auto when the missions page is opened, or Scan missions); presets until then.
- Double-double / triple-double picker odds; generic stat pickers (target and star cap parsed from Sorare).
- Sealing Deal Finder: cheapest Instant Buy cards ranked by live Sealing Points (`sealableFor`) per euro, with a budget planner.

Fixed:
- Pro Daily Play showed the Rebounds Picker when Sorare's second picker was the Double Double Picker.
- No-key Deals scan used 12 cards per request (complexity 517 > 500); now 10.

## 2.7.1 (2026-11-20)

Fixed:
- Support / Trade Cards button opened Sorare's "Page not found" (`/nba/club/pjampjam`); it now opens `/nba/my-club/pjampjam`.

## 2.7.0 (2026-11-20)

Added:
- Duplicate Sell Advisor: keep 1-3 copies per player (Set default 2), hold extras of injured or young / rookie players.
- Current lineups sorted from highest to lowest potential.
- Set Solo game days: Only today / Prioritize today (fast finish) / Best of today + tomorrow, with today-only finish odds.
- Duplicate Sell Advisor (Gallery).
- Pro Progress Tracker: live rank vs reward / cash places and Game Week history.
- Pack & Mission Advisor (Set): Daily Pack, Bronze+ progress, Live Today packs, 3★+ / 4★+ odds per pack.
- Squad Activity: best-3 counting teams and points they still need.
- Squad Activity (Set): who has a team in the live Squad stage, who is missing, points to target.
- Daily Play: Scan not-owned / refresh slate button with a loaded-players count.
- Daily Play guide: Pro Daily Picker, Rebounds Picker and Set Daily Picker with Best odds, Safe and Risk / upside strategies, and a Mine / Not owned / All filter.
- Pro lineup strategies: Max projection, Safe floor, High ceiling, with a score range per lineup.
- Daily Picker: your own cards first; better picks you don't own shown grayed as "Not owned".
- Live leaderboard rewards from Sorare: cash, Essence and XP tiers per contest. Recommended Entry now shows **Reward** odds (Essence or cash) and real **Cash $** odds separately, plus the live tier list.
- Daily Picker uses Sorare's live rule: only players from today's games before the next 07:00 UTC reset, including players you don't own (team rosters).
- Set Solo builds full 5-card teams under the 16-star cap (up to 4), with Apply, Go, card boost % and odds for the Hot Streak step targets (150 to 290).
- Release tooling: `scripts/verify.mjs` (invariants, `--full` runs the checks), `scripts/ship-helper.mjs` (read-only checklist), `.agents/skills/ship-update`, `TESTING.md`, `INPUT_NEEDED.md`.
- M4 side panel tools: GW cutoff and Daily Reset timers with a cutoff reminder; Alert & Price Tracker settings, test notification and feed; synced-lineup floor/ceiling, notes and sync age; contest table; focus grade; Go buttons; up to 5 lineups; Vault & Sealing guide; "est." star badge.
- M3 live data: Sorare star ratings (gameplay tier), sealing data and points, ESPN Vegas lines, back-to-backs, Game Week game counts; background alert tracker with browser notifications.
- M2 calculators: explained swaps, EV-ranked Recommended Entry, floor/ceiling ranges, card locking across lineups, focus grading, sealing candidates.

Changed:
- Set has two modes: Solo (incl. Hot Streak, up to 4 teams) and Squad (1 team), both 16-star cap.
- Seal advice keeps lineup players; only spare duplicates and bench-level cards are suggested.
- Primary buttons restyled green-to-blue with outlines.
- Classic Limited entry limit is 3 (live); Arena / In-Season up to 5.

Fixed:
- Gallery loaded only the first 100 Set cards with an API key (now up to 600 Set / 500 Pro), so duplicates were missed. Vault & Sealing guide hidden for Set cards.
- Set Essence was stored as Limited Essence on Set pages. Scan not-owned failed (Sorare rejects a duplicated `team` root field).
- Daily Picker silently showed the next day's slate after today's games tipped off; it now says so. Not-owned players were empty after a background restart (API key not loaded).
- League Collect quests used one shared milestone ladder (Non Playoffs showed 20 / 25 instead of 20 / 35); each quest now uses Sorare's live ladder and rewards.
- ESPN schedules were empty: ESPN stopped answering multi-day `dates=A-B` requests, so the extension fetches each day and merges them (Game Week game counts, Vegas lines, daily slate).
- Gallery failed without an API key (query complexity 720 over the 500 limit); safe mode now loads 6 cards per page.
- "Cash" odds were really odds of any reward including XP-only ranks.
- Daily Picker suggested players whose team had no game in the daily slate.
- Ghost empty lineup when opening Sorare's lineup menu; stale page-captured lineups after edits elsewhere.
- Players with no game are never drafted (0 games = 0 points).

## 2.6.4
Fixed:
- Honest Essence Quests only and Any-Year Team Hunter.

## 2.6.3
Fixed:
- Targeted Draft 26 PrimaryOffer and true sale end date for auctions under 1 hour.

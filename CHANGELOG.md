# Changelog

All notable changes to pjampjam's Sorare NBA Essentials. Newest first.

## 3.0.0 (2026-11-23)

Major public release consolidating the entire v3 redesign, portfolio & wrapped suite, on-page Dailies & Lineup Helper overhaul, and optional cloud card tagging.

Added:
- Portfolio Value Tracker, P&L & Price History Charts (`PortfolioTrackerSection.tsx`, `portfolioMath.ts`, `sorareClient.ts`): Skinledger-style daily local floor snapshots with Day / Week / Month charts, Sorare GraphQL ownership/purchase history P&L (Biggest Spend, Best Auction Won, Best Trade, and Exclude current-season mints toggle), plus per-player recent market sale charts.
- End-of-Season / Playoffs / Year-End Wrapped (`WrappedModal.tsx`, `wrappedMath.ts`, `wrappedShareCard.ts`): multi-slide Sorare NBA Wrapped modal with currency-aware stats and 1-click 16:9 PNG summary export.
- 1-Click Shareable Lineup & GW Recap PNG Cards (`lineupShareCard.ts`, `recapShareCard.ts`, `ProProgressCard.tsx`): export 16:9 PNG graphics for Pro Optimal Lineups, Set Solo/Squad teams, and Game Week recaps directly to clipboard or file, plus a Pro Season Pulse & Reward Streak strip.
- Card Tags (`Keep / Sell / Core / Trade`), Saved Rosters & Optional Cloudflare Workers/D1 Cloud Sync (`cardTagsMath.ts`, `cloudSyncClient.ts`, `cloudflare-worker/`): local card tags in Gallery, saved lineup presets in Lineups, 1-time Sorare profile verification auth (`profile.status` / `clubName` / `nickname`), and public gallery tag overlays when visiting other managers on sorare.com.
- On-Page Dailies & Daily Missions Overlay (`sorareDetector.ts`, `dailyChecklistMath.ts`, `missionScanner.ts`, `shopScanner.ts`): zero-API-call bottom-right `Dailies • N left` pill tracking Set Free Daily Pack (in Play -> Daily Solo), Set Daily Solo, Set/Pro Daily Pickers, and Daily Missions, with default-ON `trackDailyTasks` toggle, 1-click Sync, and manual mobile check-offs that auto-reset at 07:00 UTC.
- In-Panel GitHub Releases Update Checker (`updateChecker.ts`, `App.tsx`): daily check against GitHub Releases with a subtle dismissible update banner for sideloaded Chrome / Edge / Brave / Opera installs.
- Visual & Strategy Tools: Liquid Essence Glass Tube with randomized rising bubbles & star-shine glints (optional milestone ticks via `showEssenceMilestones`), username-first decluttered header, Hoops Hairline logo across all surfaces, 5-card artwork preview strips with tooltips and p10-mean-p90 range bars, Playmaker Picker & named Sorare tier caps, Lock (Must-Start) & minutes chips, Position-Aware Injury Impact panel, Craft Clue EVOI advisor, Vault Unseal & Reseal profit detector, Unified Guides & Strategy Hub (`GuidesModal.tsx`), `Try Demo (@pjampjam)` onboarding, and global `Alt+Shift+S` shortcut.

Changed & Fixed:
- Smart Lineup Helper HUD (`sorareDetector.ts`): isolates searches to the open Sorare drawer, resets stale filters, waits for placement confirmation and next-slot card loading, and displays player portraits, star cost, and projected points.
- Optimizer & Math Hardening: enforced Sorare NBA's max 4 players/team rule, direct p10/p90 DFS optimization, exact 0/1 Knapsack DP in Sealing Deal Finder, per-game Vegas/B2B peak order statistics, Negative Binomial CDF for count-stat Daily Pickers, Set Holo (+20%) / Shiny (+10%) edition bonus fallbacks, `< 24h` Quest auction window, and MV3 `chrome.storage.local` quota-safe cache eviction.
- Performance & Hygiene: Fast-Mode concurrency-2 pipelining under rate limits, parallel ESPN/local-tab sync, React.lazy code splitting, and 446 automated checks (invariants, unit tests, and E2E tests).

---

## Legacy (v2.x)

## 2.7.4 (2026-11-21)

Added:
- Set | Pro switch in the top bar (Set sits left of Limited, like on Sorare): Set mode shows Set lineups, packs, Squad, Set cards, Set duplicates and Set Essence. Collections, Craft and Deals stay Pro (Limited and up).
- Current Pro Progress shows your real lineups: live Game Week with rank, points, projected rank and field size, plus lineups submitted for the next Game Week. They are read from your logged-in Sorare tab (Sorare keeps lineups private, so the public API never returned them); Refresh and Sync re-read them.
- Special Set shop packs (for example "Emirates Cup Platinum") are found on your Sorare Shop tab and get the same price and 3★+ / 4★+ odds breakdown as the standard packs, with a NEW badge and time left.
- Quick-jump chips under the header on Lineups, Gallery and Deals.

Changed:
- New layout: two-row header with a "..." menu, a lightning bolt on the logo for your API key status (blue = Fast Mode, gray = public mode, click for Settings), one status line on Lineups (live Game Week and best rank, next cutoff, daily reset, injuries, reminder).
- Colors mean one thing each: green = money and rewards (solid green = cash places), blue = info, buttons and selected options, amber = warning, red = live / injured, light gray = Set, violet = sealing and the Vault.
- New section order: Pro starts with your progress, Set starts with packs.
- Gallery hides sealed cards by default ("Hide sealed" to show them). The Sealing Deal Finder moved to Deals. Duplicate Sell Advisor colors Pro and Set cards differently.
- "Upcoming Lineups & Upgrade Swaps" (was "Current Open Lineups") with a correct explanation.

Fixed:
- Your submitted lineups never showed up in Pro Progress.
- Set Essence could pick up your Limited Essence (Sorare uses the same icon id for both counters); they are now told apart by color.
- Squad reward packs showed up as shop packs, and pack odds failed for every pack once several packs were listed.
- Pro Progress said "Outside rewards" when the reward places were unknown.

Security:
- Your Sorare API key is encrypted on this device (AES-GCM with a key that cannot be exported and that web pages cannot reach), and the side panel only ever sees it masked.

## 2.7.3 (2026-11-21)

Fixed:
- Sealed cards were still suggested for lineups until the next refresh; sealed states are now read live from open sorare.com tabs.
- Players with no NBA games this season (L10 from last season, e.g. John Konchar) were projected and tagged as hot; now 0 projection, no form tags, "No games this season" badge (ESPN season stats).
- Free agents (no team) counted as having a game in the slate.

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

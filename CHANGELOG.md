# Changelog

All notable changes to pjampjam's Sorare NBA Essentials. Newest first.

## 2.7.5-exp10 (2026-11-22)

Changed:
- Added a white beveled-edge rounded background behind the logo on the Sorare NBA bottom-right launcher (`sorareDetector.ts`) and in the side panel header and loading stage (`App.tsx`, `LoadingStage.tsx`, `index.css`), leaving the browser toolbar / plugin icons untouched.

## 2.7.5-exp9 (2026-11-22)

Changed:
- Applied `logo3.png` across `public/logo.png` (`256x256`) and all extension icon sizes (`16`, `32`, `48`, `128`), updating the Chrome toolbar, `chrome://extensions`, side panel header, loading stage, dashboard favicon, desktop notifications, and Sorare NBA bottom-right launcher.

## 2.7.5-exp8 (2026-11-22)

Changed:
- Applied the updated `logo2.png` (`PPs essentials`) artwork across `public/logo.png` (`256x256`) and all extension icon sizes (`16`, `32`, `48`, `128`), covering the Chrome toolbar, `chrome://extensions`, side panel header, loading stage, dashboard favicon, desktop notifications, and Sorare NBA bottom-right launcher.

## 2.7.5-exp7 (2026-11-22)

Added:
- Playmaker Picker & Live Tier Parsing (`dailyPicksMath.ts`, `DailyPlayHub.tsx`, `sorareClient.ts`, `missionScanner.ts`): added a `Playmaker Picker` preset (`<= 1.5★`, `4+ assists`), mapped named Sorare gameplay tiers (`DNP`, `DNP Plus`, `Reserve`, `Reserve+`, `Roster`, `Roster Plus`, `Impact`, `Impact Plus`, `Star`, `Star Plus`, `GOAT`, `Icon`) to `maxStars` in `parsePickerMission`, displayed the resolved star cap (`<= 1.5★`) beside the rule text in `DailyPlayHub`, requested `gameplayTier` on `activePlayers.nodes` in `DailyPickerRosters` for live star caps on not-owned players, and supported localized `/<lang>/nba/...` Sorare URLs in `missionScanner.ts`.
- Set / Common Essence Bar & Rarity-Differentiated Essence Meter (`index.css`, `App.tsx`): added a matching Set / Common Essence progress bar in Set mode (brushed silver/platinum gradient + silver dust motes targeting the cheapest `COMMON_ESSENCE` pack / default `1,000` Bronze Pack, with clickable `Pack ready` / `2x Packs ready` jumping to Set Packs and Pro cash balance hidden), eliminating sticky header height jumps between Set and Pro.
- Manual Lock (Must-Start) & Projected Minutes Chips (`lineupOptimizerMath.ts`, `LineupsTab.tsx`, `LineupCardStrip.tsx`): added a `Lock (Must-Start)` toggle alongside `Skip Card` (wired through `generateTopLineups` with cap/disjoint/120+MVP support) and `32m` / `Bench (<20m)` season-average minutes chips on Pro and Set lineup slots.

Improved / Fixed:
- Count-Stat Odds & `points.` Regex (`dailyPicksMath.ts`): replaced the Normal approximation in `probabilityStatAtLeast` with an overdispersed Poisson (Negative Binomial) CDF for accurate low-mean assist/rebound/steal/block probabilities, and fixed `STAT_WORDS` `points` matching (`/\bpoints?\b(?!\s+per)/`) when descriptions end with a period.
- Essence Bar Polish (`index.css`, `App.tsx`): upgraded track height to `8px` with `25%/50%/75%` hairline ticks, `520ms` ease-out width transitions, `2%` minimum visible fill, luminous leading-edge cap, non-clipping sibling particle overlay with fill-scaled mote counts (gold embers for Limited, plasma streaks for Rare, diamond shards for Super Rare, prismatic sheen + violet/gold star motes + luminous border for Unique, silver dust for Set, respecting `prefers-reduced-motion`), and clickable `Craft ready` / `2x Craft ready` jumping to the Craft tab.
- Code Splitting & Repo Hygiene (`App.tsx`, `.gitignore`): lazy-loaded heavy modals (`GuidesModal`, `SettingsModal`, `CommandPaletteModal`, `WhatsNewModal`) and secondary tabs with `React.lazy` + `Suspense` (bringing main `sidepanel.js` from 557 kB down to 332 kB, well under Vite's 500 kB limit), deleted untracked `logo.af~lock~`, and added `*.af~lock~` to `.gitignore`.

## 2.7.5-exp6 (2026-11-22)

Changed:
- Unified PPs Essentials Brand Logo (`public/logo.png`, `public/icons/icon{16,32,48,128}.png`, `sidepanel.html`): rendered concept `05-pps-bold-icon-first` crisply across Chrome toolbar, `chrome://extensions`, notifications, side panel header, popped-out dashboard favicon, and the Sorare NBA bottom-right launcher.
- Consistent Pro Header Essence & Wallet Bar + Rarity Colors (`App.tsx`, `index.css`): the Pro Essence progress bar and synced wallet cash balance now stay visible across all Pro tabs (including Lineups and Gallery) instead of hiding on tab switch, remain hidden in Set/Common mode, and color-code both the Essence icon and progress fill to match the selected rarity (`Limited` amber, `Rare` red/rose, `Super Rare` sky blue, `Unique` violet).
- Full-Stage Loading & Native Progress Bar (`LoadingStage.tsx`, `App.tsx`, `index.css`): startup cache hydration and initial tab scans now render a dedicated loading progress stage with a native `<progress>` bar (smooth indeterminate-to-determinate transitions and reduced-motion support) before revealing the full tab UI, eliminating empty-state flicker and stale progress text.

## 2.7.5-exp5 (2026-11-22)

Added:
- NBA-Exclusive Floating Launcher (`sorareDomParser.ts`, `sorareDetector.ts`): bottom-right Sorare NBA Essentials dock now mounts exclusively on Sorare NBA pages (`/nba`, `/nba/...`, and localized `/<lang>/nba/...`) and automatically unmounts on SPA navigation to Football, MLB, or non-NBA pages; restyled to match the `.glass-chrome` dark obsidian frosted-glass design with spring hover/press micro-animations.
- Category Selection, Animations & Essence Micro-Particles (`index.css`, `App.tsx`): upgraded primary workspace tabs (`Collections`, `Craft`, `Lineups`, `Deals`, `Gallery`) and sub-tabs with frosted hover pills, luminous active borders, glowing animated bottom indicators, icon micro-scale, spring `linear()` tactile press curves, tab-panel entry transitions, collapsible `<details>` hover sheen, and subtle GPU-composited shimmer + floating motes on the Essence & live scan progress bars (fully `prefers-reduced-motion` safe).

Improved (Performance / Scan Speed):
- Rate-Limit-Safe Fast-Mode Pipelining (`rateLimitQueue.ts`, `index.ts`): enables concurrency-2 pipelining when a Sorare API key is active (still strictly enforcing `45/min` sliding window and `220ms` spacing; Safe Mode remains concurrency-1).
- Parallel Gallery & Lineups Loading + Coalescing (`index.ts`, `App.tsx`): runs ESPN season stats and local tab readers in parallel with Sorare GraphQL (and parallelizes cache-hit tab sync), coalesces duplicate in-flight gallery loads, and hydrates cached Deals instantaneously on startup with zero extra API calls.

## 2.7.5-exp4 (2026-11-22)

Added:
- Visual & UX Redesign: barely-see-through frosted glass top frame bar (`backdrop-filter: blur(14px)` with `prefers-reduced-transparency` fallback), tactile button hover/press micro-animations (`scale: 0.97`, compositor-only transitions, `:focus-visible` rings, `prefers-reduced-motion` safe), and compact `LineupsTab` sub-tab split (`Overview & Live | Builder | Upgrades & Schedule` for Pro; `Daily Play | Solo & Squad | Packs` for Set).
- Visual 5-Card Lineup Previews & Range Bars (`LineupCardStrip.tsx`, `LineupRangeBar.tsx`): renders live Sorare card artwork (`pictureUrl`) with rarity frame glow and zero-CLS `aspect-[5/7]` across Open Lineups, Generated Pro Lineups, and Set Squads, paired with micro-SVG `p10-mean-p90` vs. cut-line range bars.
- Live `rewardTiers`-driven Dollar/Essence EV & Reward Previews (`entryEvMath.ts`, `RewardPreviewStrip.tsx`): computes estimated Dollar ($) and Essence EV directly from live Sorare `rewardTiers` and closed-GW cutoffs, rendered as visual Cash/Essence tier chips inside Recommended Entry.
- Per-Game Vegas & B2B Peak Order Statistics (`vegasMath.ts`, `externalDataClient.ts`, `lineupOptimizerMath.ts`): tracks per-game `impliedTeamTotal`, `spread`, `blowoutRisk`, and second-night `isBackToBack` inside `TeamSlateSchedule.gameContexts` and computes exact recursive Clark `E[max(X_1..X_k)]` peak multipliers.
- Position-Aware "Who Steps Up" Injury Impact Panel (`injuryImpactMath.ts`, `InjuryImpactPanel.tsx`): ranks healthy teammates of `OUT`/`DOUBTFUL` starters weighted by exact/adjacent position match (`G`/`F`/`C`) in Pro `Upgrades & Schedule`.
- Craft Clue EVOI Advisor (`craftAdvisorMath.ts`, `CraftTab.tsx`): recommends the "Best Clue to Use" based on Expected Value of Information (EVOI), entropy reduction, and average pool elimination %.
- Vault "Unseal & Reseal" Profit Detector (`vaultSealingMath.ts`, `GalleryTab.tsx`): persists local baseline SP snapshots for sealed cards in `chrome.storage.local` and surfaces net SP gains against live `sealableFor` while respecting Sorare's 14-day unseal cooldown (`unsealableAt`).
- Longevity Auto-Sync (`App.tsx`): automatically refreshes stale live gallery/schedule/injury context (>15m old) when returning to the side panel.

## 2.7.5-exp3 (2026-11-22)

Added:
- Unified Guides & Strategy Hub (`GuidesModal.tsx`, header book button + Command Palette): interactive Sorare NBA Scoring Matrix & Box-Score Calculator (`nbaScoringMath.ts`), 2026-27 competitions & multi-game peak strategy, Star brackets & bonus stacking, Vault & Sealing playbook, Set F2P-to-Pro roadmap, persistent Pre-Lock GW Checklist, and Math & Privacy FAQ.
- Alert & Price Tracker upgrades: `Open/Submitted Lineups Only` injury toggle (`injuryLineupsOnly`) and a Pre-Lock Lineup Health Check inside the `gw_cutoff` window flagging already-OUT, Doubtful, or 0G rostered starters before lock.

Improved / Fixed:
- Enforced Sorare NBA's `max 4 players per NBA team` rule across `generateTopLineups`, `buildBudgetLineups`, `recommendLineupMarketBuys`, and `recommendTwoCardComboSwaps`.
- Fixed `Safe floor (p10)` and `High ceiling (p90)` strategies to optimize lineup floor/ceiling directly inside DFS instead of only re-sorting disjoint mean-optimal passes.
- Replaced greedy budget packing in `planSealBudget` with an exact 0/1 Knapsack DP maximizing total Sealing Points (breaking ties by lowest cost); scaled `evaluateVaultVsSellRoi` sell floor thresholds by rarity (`Limited 2.50`, `Rare 15.00`, `Super Rare 60.00`, `Unique 250.00`).
- Recalibrated NBA teammate correlation from `+0.15` to `-0.05` (with `SAME_GAME_RHO = +0.06`), unified variance across `buildBudgetLineups` and `entryEvMath`, and calibrated `rankDailyPickerCandidates` single-game CV to `0.35`.
- Passed `scheduleByTeam` into `buildBudgetLineups`, `recommendLineupMarketBuys`, and `recommendTwoCardComboSwaps`; fixed `buildEditFocusPoints` to remove the nonexistent NBA position filter, evaluate candidates through `evaluateCardForLineup` (respecting 0G, injury, In-Season, max 4/team, star cap), and format currency dynamically.
- Removed retired `"Cap 120 + MVP"` / `"Daily Pickup"` copy from `ESSENCE_EARNING_SOURCES`.

## 2.7.5-exp2 (2026-11-21)

Fixed:
- Wallet balance sync on sorare.com now parses thousands separators and locale formats (`€1,234.56`, `$1,200`, `1.234,56`, `12,50 €`, `1,250.5 ETH`) instead of failing or misreading `$1,200` as `1.2`.
- Pro Essence `0` balances (e.g. right after crafting) now sync cleanly from sorare.com; manual Pro Essence typing no longer uses a stale closure over other rarities.
- Cached gallery loads now filter out stale DOM lineups from closed Game Weeks just like fresh loads.
- Sealing Deal Finder discards stale in-flight responses if you switch rarity or currency mid-scan, and respects active Sorare 429 cooldowns.
- Pack & Mission Advisor no longer shows `0%` on Live Today advice when odds are unavailable, still shows Set Essence affordability tips without an API key, and refreshes special packs immediately when pressing Scan shop.
- Daily Play missions update immediately on SPA auto-sync via `chrome.storage.onChanged` (instead of waiting up to 30 seconds).
- Command Palette now shows card rarity (`Set`, `Limited`, `Rare`, `S. Rare`, `Unique`), uses dynamic season labels instead of hardcoded `26-27`, and deduplicates deal keys.
- Settings JSON backup/restore now preserves and validates all exported preferences including rarity, projection source, auto-open toggles, and alert settings.
- Header Refresh button disables properly on Gallery when no username is set, and all tab clicks route through `navigateTab()`.

## 2.7.5-exp1 (2026-11-21)

Fixed:
- Set (Common) Essence now persists in storage, broadcasts live to the top-right Essence pill and Pack & Mission Advisor, handles space/NBSP thousands separators on sorare.com, and is editable by hand just like Pro Essence.
- Set mode vs. Pro-only tab state: opening the panel in Set mode starts on Lineups instead of Collections; keyboard tab arrows, Command Palette, and external tab switches automatically switch to Pro when navigating to Collections, Craft, or Deals.
- Command Palette now includes Set (Common) cards in search results.
- Reading a partial Sorare board/lineup page now upserts by lineup ID instead of wiping sibling lineups in the same Game Week (full /nba/lineups overview pages still replace the week).
- Sealing Deal Finder clears stale listings when switching rarity or currency.
- Pack & Mission Advisor checks odds per pack row so a single pack without odds shows "--" instead of "0%".
- Daily mission auto-sync now triggers on Sorare SPA route changes, not only full page reloads.
- Settings API key input no longer traps pastes behind the masked placeholder; AES-GCM key creation deduplicates concurrent first-run calls; Set shop packs fall back cleanly on NBA off-days.

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

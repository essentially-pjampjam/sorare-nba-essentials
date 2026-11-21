# Changelog

All notable changes to pjampjam's Sorare NBA Essentials. Newest first.

## 2.7.4-exp5 (experimental, 2026-11-21)

Fixed:
- Set Essence could be read wrong: Sorare uses the same gradient id on the Limited Essence and the Set Essence counters, so a Pro page's Limited Essence could be saved as Set Essence. The two are now told apart by their colors (green = Limited, purple = Set), checked live on both pages (785 Limited, 19 Set).

Changed:
- Set has its own sage gray-green color (Set button, Set cards, packs, Squad); violet is now only for sealing and the Vault.
- Selected options in the lineup builders are blue everywhere (were a mix of amber and green); green stays for money (budgets, rewards, cash).
- All "Scan ..." buttons share one style; section icons are neutral; Pack & Mission Advisor no longer repeats Set Essence (it is in the top bar).

## 2.7.4-exp4 (experimental, 2026-11-21)

Added:
- Set | Pro switch in the top bar, like Sorare's own: Set (Common) sits left of Limited. Set mode turns Lineups into Set teams, packs and Squad, and Gallery and the Duplicate Sell Advisor into your Set cards; it shows Set Essence. Collections, Craft and Deals are Pro-only (Limited and up), dim in Set mode and switch back to Pro when clicked. The choice is remembered.

Changed:
- The Set / rarity / Essence bar shows on every tab (it no longer disappears on Lineups and Gallery); the craft progress line stays on Collections, Craft and Deals.
- The old Pro / Set switches inside Lineups, Gallery and the Duplicate Sell Advisor are gone (the top bar drives them).
- "Super Rare" reads "S. Rare" in a narrow panel.

Fixed:
- Quick-jump chips were cut off on the right in a narrow panel; they now wrap onto a second row, and sections land below it.

## 2.7.4-exp3 (experimental, 2026-11-21)

Added:
- Quick-jump bar under the header on Lineups (Pro and Set), Gallery and Deals: one tap scrolls to a section (and opens it).

Changed:
- Header: the logo carries a lightning bolt (blue = API key active, gray = public mode; click opens Settings) instead of the FAST chip. All header controls share one height, and Essence is a fifth equal column next to the rarities.
- Rewards are green everywhere: "In rewards" is a green outline, "In the cash" a solid green chip; blue stays for buttons and info.
- Duplicate Sell Advisor: Pro cards blue, Set cards violet; Hold is neutral gray.
- Sealing Deal Finder moved from Gallery to Deals.
- Dim gray text is a step brighter (contrast).

Fixed:
- Pack & Mission Advisor listed Squad reward packs (LVL 1-5, 0 Essence) as new special packs; reward packs are no longer treated as shop offers.
- Pack odds failed for every pack once more than a few packs were listed (one oversized request); odds now load per pack.

Security:
- The Sorare API key is encrypted at rest (AES-GCM, with a key that cannot be exported and that pages and content scripts cannot reach). Existing keys are encrypted on first load.
- The side panel never receives the full key, only a masked one (e.g. ••••abcd).

## 2.7.4-exp2 (experimental, 2026-11-21)

Changed:
- Cleaner header: two rows (name, manager, Refresh, a menu for search / currency / density / pop-out / support / settings; then the tabs). Rarity, Essence and craft progress only show on Collections, Craft and Deals.
- One status line on Lineups replaces the two timer rows: LIVE Game Week with your best rank, next cutoff, daily reset, injuries and the cutoff reminder.
- Colors mean one thing each: green = money, blue = info and the main button, amber = warning, red = LIVE / injured, violet = Set / Common and sealing. Cards use a neutral border with a colored edge only when they need attention; the green-to-blue gradient buttons are gone.
- New order. Pro: Current Pro Progress, Upcoming Lineups & Upgrade Swaps, Recommended Entry, Daily Play. Set: Pack & Mission Advisor, Squad, Solo / Squad builder, Daily Play, guide.
- Small text is a bit larger; the long Daily Picker note folds to one line.

Fixed:
- Current Pro Progress said "Outside rewards" when the reward places were unknown; it now says "Live rank".

## 2.7.4-exp1 (experimental, 2026-11-21)

Fixed:
- Pro lineups never showed up: Sorare keeps lineups private, so the public API returns none, and live Game Week lineups were filtered out. Lineups are now read from your logged-in Sorare tab (live and upcoming Game Weeks) with rank, score, projected rank and field size; Refresh and the new Sync button re-read them.

Changed:
- "Pro Progress" is now "Current Pro Progress": lineups grouped by Game Week (LIVE / Before cutoff) with reward status estimated from last week's field.
- "Current Open Lineups & Upgrade Swaps" is now "Upcoming Lineups & Upgrade Swaps" with a correct explanation.
- Gallery hides sealed cards by default; untick "Hide sealed" to show them.

Added:
- Special Set shop packs (for example "Emirates Cup Platinum") are detected from your Sorare Shop tab and analyzed like the standard packs (price, 3★+ / 4★+ odds, NEW badge, time left).

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

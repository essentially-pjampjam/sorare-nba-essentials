# Live Tests

Run after reloading the extension in `chrome://extensions` and pressing **Refresh**. Detailed per-build history: `docs/LIVE_TESTS.md`.

## Open (2.7.0-exp.M8)
- **T1** Header badge shows `v2.7.0·M8` in red; What's New lists 2.7.0.
- **T17** Chrome asks nothing new on reload (the new `scripting` permission has no warning); the extension still loads.
- **T18** Daily Play: "Not-owned players: N from X/Y teams" shows N > 0. Press Scan not-owned / refresh slate; Not owned / All now list grayed players.
- **T19** After the night's games tip off (before 07:00 UTC), an amber banner says today's picker is locked and the list is the NEXT Daily Picker.
- **T20** Set: open sorare.com/nba/series/squad (Go opens Members), press Scan squad on both the Members page and the Squad page: all 10 members, live stage score / target, and "No team yet" names match Sorare.
- **T16** Collections → Real Essence Quests: targets match Sorare's Collect panel (Draft 16/18 +500, Non Playoffs 20/35 +1,000, Playoffs 15/25 +500, Conf Finals 2/10 +500, Full Collection 0/1 +2,000).
- **T11** Lineups (Pro): "Daily Play" box with Pro Daily Picker / Rebounds Picker chips. Picks are from your Limited cards in today's games; Rebounds picks are 1.5★ or less with their rebounds per game.
- **T12** Switch Best odds / Safe / Risk / upside: Safe drops flagged players; Risk shows hot-form, teammate-OUT or big-minutes players with ▲ tags.
- **T13** Switch Mine / Not owned / All: not-owned rows are grayed and their Pin is disabled. Go opens Sorare's Play missions.
- **T14** Set / Common: the same box for the Set Daily Picker.
- **T15** Pro lineups: Max projection / Safe floor / High ceiling reorder the lineups; each shows a score range next to proj pts.
- **T2** Lineups → Recommended Entry table has **Reward** and **Cash $** columns. Reward = odds of Essence or cash; Cash $ = odds of the real cash ranks. A line below lists the live tiers (e.g. Cash #1-50, Essence #51-1,500, XP).
- **T3** Hover the Cash $ cell: shows "Cash for the top N, up to $X".
- **T4** Lineups → Set / Common → Daily Picker: a "Daily slate until ..." line lists only today's games (same games as Sorare's Daily Picker), and every pick plays in one of them.
- **T5** Daily Picker lists your own cards first; up to 3 better picks you don't own show grayed with "Not owned". The slate matches Sorare's picker games. Go opens Sorare's Daily Picker.
- **T9** Lineups: Game Week bar shows game counts and matchups again (ESPN per-day fix).
- **T10** Optional: remove the API key in Settings, Refresh: the gallery still loads (slower), then put the key back.
- **T6** Set Solo Mode → Auto-Build: full 5-card teams under 16★ (up to 4), each with Apply, Go, boost % and step odds (150 / 180 / 210 / 240). Only players with a game on today's slate.
- **T7** Set Squad Mode builds 1 team with Apply + Go.
- **T8** `node scripts/verify.mjs` prints all PASS; `node scripts/ship-helper.mjs next` prints a checklist and changes no files.

## Done
- **T-M7.1** 2.7.0-exp.M7.1 (2026-11-20): Not owned empty and Daily Picker looked outdated (fixed in M8).
- **T-M6** 2.7.0-exp.M6 live test (2026-11-20): OK; asked for daily play guides, pick strategies and filters (M7).
- **T-M5** 2.7.0-exp.M5 live test (2026-11-20): all OK except T5 (Daily Picker used a wrong slate: ESPN range bug). Fixed in M6.
- **T0** 2.6.10-exp.M4 live test (2026-11-19): timers, alerts, sync age, ghost lineup fix, Go buttons, Vault guide all OK. Found: Cash column meant "any reward", Daily Picker used the wrong games, Set Solo built single players. Fixed in 2.7.0-exp.M5.

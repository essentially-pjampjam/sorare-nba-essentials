# Live Tests

Run after reloading the extension in `chrome://extensions` and pressing **Refresh**. Detailed per-build history: `docs/LIVE_TESTS.md`.

## Open (2.7.0-exp.M6)
- **T1** Header badge shows `v2.7.0·M6` in red; What's New lists 2.7.0.
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
- **T-M5** 2.7.0-exp.M5 live test (2026-11-20): all OK except T5 (Daily Picker used a wrong slate: ESPN range bug). Fixed in M6.
- **T0** 2.6.10-exp.M4 live test (2026-11-19): timers, alerts, sync age, ghost lineup fix, Go buttons, Vault guide all OK. Found: Cash column meant "any reward", Daily Picker used the wrong games, Set Solo built single players. Fixed in 2.7.0-exp.M5.

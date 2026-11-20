# Live Tests

Run after reloading the extension in `chrome://extensions` and pressing **Refresh**. Detailed per-build history: `docs/LIVE_TESTS.md`.

## Open (2.7.2-exp.M1)
- **T1** Header badge shows `v2.7.2·M1` in red; What's New lists 2.7.2.
- **T29** Lineups (Pro) → Daily Play: open Sorare's Pro missions (Go). Within ~30 s the box says "Today's pickers synced from Sorare" and the chips match Sorare (e.g. Pro Daily Picker + Double Double Picker), with Sorare's reward text.
- **T30** Double Double Picker picks: big men / triple-double threats on top; each row shows "x DD in y games" and points / rebounds / assists.
- **T31** Set → Daily Play: open Sorare's Set missions; it syncs the Set Daily Picker (1 pick). Scan missions works on demand.
- **T32** Gallery (Pro cards) → Sealing Deal Finder → Scan market: cheapest cards ranked by points per €, Sealing Points match the seal dialog on Sorare for a card or two; budget chips show total points.

## Done
- **T-M9/M10** 2.7.0-exp.M9 + M10 (2026-11-20): all OK. Follow-ups shipped untested in 2.7.0 at the user's request: duplicate keep / hold rules and full Set card loading, lineups sorted by potential, Vault guide Pro-only, clearer Solo labels.
- **T-M1-M8** T2-T20 covered by the user's live tests (2026-11-20).
- **T-M8** 2.7.0-exp.M8 (2026-11-20): all OK except Scan not-owned (failed) and Set Essence saved as Limited (fixed in M9).
- **T-M7.1** 2.7.0-exp.M7.1 (2026-11-20): Not owned empty and Daily Picker looked outdated (fixed in M8).
- **T-M6** 2.7.0-exp.M6 live test (2026-11-20): OK; asked for daily play guides, pick strategies and filters (M7).
- **T-M5** 2.7.0-exp.M5 live test (2026-11-20): all OK except T5 (Daily Picker used a wrong slate: ESPN range bug). Fixed in M6.
- **T0** 2.6.10-exp.M4 live test (2026-11-19): timers, alerts, sync age, ghost lineup fix, Go buttons, Vault guide all OK. Found: Cash column meant "any reward", Daily Picker used the wrong games, Set Solo built single players. Fixed in 2.7.0-exp.M5.

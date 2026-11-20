# Live Tests

Run after reloading the extension in `chrome://extensions` and pressing **Refresh**. Detailed per-build history: `docs/LIVE_TESTS.md`.

## Open (2.7.0-exp.M10)
- **T1** Header badge shows `v2.7.0·M10` in red; What's New lists 2.7.0.
- **T21** Daily Play: Scan not-owned / refresh slate -> "Not-owned players: N from X/X teams" with no error; Not owned / All list grayed players.
- **T22** Switch Sorare from Pro to Set: the panel's Limited Essence stays at your Pro value (Set Essence shows next to Pack & Mission Advisor).
- **T23** Set: Pack & Mission Advisor lists Gold / Silver / Bronze and today's Live Today packs with 3★+ %, 4★+ % and slot #4 top tiers (Bronze 3★+ about 20%+).
- **T24** Open the Set Shop, press Scan shop: Daily Pack opened / not opened and Bronze+ x/10 match Sorare.
- **T25** Squad Activity: "Counting now" names match the 3 avatars on Sorare's squad score card; points still needed = target - score.
- **T26** Set Solo: switch Today only / Today first / Best. Today first marks players (today) / (tmrw) and shows "Today: N players, X pts, finish today: 150: y%"; Best can pick tomorrow's players.
- **T27** Gallery: Duplicate Sell Advisor lists duplicate players; Pro shows Sell with a floor price, Set shows Scrap; Shiny / Holo, sealed and in-lineup copies say Keep.
- **T28** Lineups (Pro): Pro Progress shows each submitted lineup with rank of entries, top %, and In the cash / In rewards / Outside rewards once games start; the Game Week history fills after refreshes.

## Done
- **T-M1-M8** T2-T20 covered by the user's live tests (2026-11-20).
- **T-M8** 2.7.0-exp.M8 (2026-11-20): all OK except Scan not-owned (failed) and Set Essence saved as Limited (fixed in M9).
- **T-M7.1** 2.7.0-exp.M7.1 (2026-11-20): Not owned empty and Daily Picker looked outdated (fixed in M8).
- **T-M6** 2.7.0-exp.M6 live test (2026-11-20): OK; asked for daily play guides, pick strategies and filters (M7).
- **T-M5** 2.7.0-exp.M5 live test (2026-11-20): all OK except T5 (Daily Picker used a wrong slate: ESPN range bug). Fixed in M6.
- **T0** 2.6.10-exp.M4 live test (2026-11-19): timers, alerts, sync age, ghost lineup fix, Go buttons, Vault guide all OK. Found: Cash column meant "any reward", Daily Picker used the wrong games, Set Solo built single players. Fixed in 2.7.0-exp.M5.

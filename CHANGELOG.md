# Changelog

All notable changes to pjampjam's Sorare NBA Essentials. Newest first.

## 2.7.0 (in testing as 2.7.0-exp.M5, branch v2.7.0-wip)

Added:
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

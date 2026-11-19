# Input Needed

Questions for pjampjam. Open items first; move them to Answered once settled.

## Decisions
- Set Solo lineups are assumed to use the daily slate (games before the next 07:00 UTC reset), like the Daily Picker. Confirm in the live test (TESTING.md T6).
- Multi-game Game Weeks: "best game counts" comes from a third-party guide; confirm on a live 2-game week.
- Hot Streak (Pro) entry limit is set to 3 and not verified live.
- Merge `v2.7.0-wip` into `main` after the 2.7.0 live test passes?

## FYI
- Leaderboard rewards are read live from Sorare (`rewardsConfig`): cash only for the top ranks, then Essence, then XP. "Reward" odds count cash or Essence; XP-only ranks are not counted.
- The typed reward query needs an API key (depth 8; the no-key limit is 7). Without a key the extension falls back to plain rank counts.
- Daily Picker rosters (`team.activePlayers`) also need an API key for more than one team; without one, only owned Common cards are ranked.
- Injury alerts compare against the last panel load because the background alarm makes no network calls.

## Answered
- 2026-11-19: API key is always on (gallery query complexity over the no-key limit is fine).
- 2026-11-19: Set has two modes only: Solo (incl. Hot Streak) and Squad.
- 2026-11-19: Design connectors (Figma etc.) are not needed.

# Sorare NBA Facts Register

Every Sorare rule the extension depends on, with **where** and **when** it was checked.
Sorare's official help pages lag the live game (the Competition Overview article still lists
Sorare 26 competitions such as Daily Pickup), so the **live sorare.com UI is the source of truth**.
Re-check anything marked `NEEDS CONFIRMATION` or older than one season before relying on it.

Status legend: `LIVE-VERIFIED` (seen on sorare.com) · `OFFICIAL DOC` (Sorare help/blog) ·
`THIRD-PARTY` (guides/tools) · `NEEDS CONFIRMATION` · `OUTDATED IN CODE` (code disagrees with live).

## Routes (checked 2026-11-19, signed-in Chrome)

| Route | Result | Status |
|---|---|---|
| `/nba/arena` | "Page not found" | LIVE-VERIFIED 404 — never emit |
| `/nba/set` | "Page not found" | LIVE-VERIFIED 404 — never emit |
| `/nba/lineups/arena/ongoing` | Locked **LIVE** lineups only (not editable) | LIVE-VERIFIED |
| `/nba/lineups/arena/<fixtureSlug>` e.g. `nba-21-23-nov-2026` | Open (editable) lineups for that Game Week; slug format matches the API `So5Fixture.slug` | LIVE-VERIFIED |
| `/nba/lineups/pro` | Valid lineups hub | LIVE-VERIFIED (linked from nav) |
| `/nba/play` | Redirects to `/nba/play/boards/arena/cash/<fixture>/<fixture>-nba_limited_in_season_champion` | LIVE-VERIFIED |
| `/nba/series/play` | Set / Arcade hub | LIVE-VERIFIED |
| `/nba/series/squad` | Set Squad hub | LIVE-VERIFIED |
| `/nba/play/classic/compose/<fixture>-<leaderboard>/lineup/<uuid>` | Lineup editor | LIVE-VERIFIED |

## Competitions & lineup rules

| Fact | Value | Status / Source |
|---|---|---|
| In-Season Champion entry limit | **5** per Game Week ("0 SET / 5" on the board) | LIVE-VERIFIED 2026-11-19 |
| Contender star cap | **11★** (editor star meter "4/11" on a Limited Contender lineup listed under `/nba/lineups/arena/...`) | LIVE-VERIFIED 2026-11-19 |
| Champion star cap | 16★ | THIRD-PARTY (soraregoat NBA 27 guide); matches code |
| Arena rooms use the same caps as Pro (Champion 16★ / Contender 11★) | Code currently models Arena Champion **15★** / Arena Contender **12★** | `OUTDATED IN CODE?` — THIRD-PARTY sources + live 11★ meter disagree with code. Fix in M2 after user confirms |
| "Arena" lineups on `/nba/lineups/arena/<gw>` | Includes Pro **Classic** (All Seasons) Limited Contender lineups (container id `...~competition_with_arena~contender`) | LIVE-VERIFIED — parser labels them "Arena Classic Contender" |
| Arena cash boards | Board URL `/nba/play/boards/arena/cash/...`, showed `$5` entry, 833 entrants, `$5,125` prize | LIVE-VERIFIED (factual display only) |
| Classic entry limits (4 Limited/Rare, 2 Super Rare/Unique) | In code | NEEDS CONFIRMATION — no current official source found; one guide claims "3 lineups per competition per scarcity" |
| Same card in two lineups in one Game Week | Editor has a **"Used in another lineup"** player filter → cards are tracked as committed | Strong LIVE evidence of no reuse; NEEDS CONFIRMATION (user) |
| Same player, two different cards, two lineups | Unknown | NEEDS CONFIRMATION |
| Player scoring with 2+ games in a Game Week | Best game counts | OFFICIAL DOC (help: player scores) / THIRD-PARTY |
| Star rating | From L10 average, 1–5★ | THIRD-PARTY |

## Mode structure — user screenshots 2026-11-19 (GW10) — LIVE-VERIFIED

Sorare's "Choose Mode" menu: **PRO** (events) and **ARENA** → **In-Season** / **Classic** / **Rooms**.
Ignore Sorare's naming overlap ("Arena", "Rooms"); classify by these three branches.

| Branch | Rarities | Formats & caps | Other rules |
|---|---|---|---|
| Arena **Rooms** (10-player rooms) | Limited, Rare, Super Rare | Contender 11★ (75 energy), Champion 16★ (150), Uncapped ∞ (200), U23 11★ (150), Veterans 11★ (150) | Entry cost in energy per format. **Supersedes code's 12★/15★ and third-party "Veterans 16★"** |
| Arena **Classic** | Limited, Rare, Super Rare, Unique | Champion 16★, Contender 11★ | Any season ("All Seasons"); 5 cards of the rarity; max 4 players per NBA team |
| Arena **In-Season** | Limited, Rare, Super Rare (Unique allowed inside the Super Rare section: "missing 5 Unique or Super Rare cards") | Champion 16★, Contender 11★ | Min 4 In-Season (26/27) cards; max 4 per team; Rare = card score +10%; "0 SET / 5" entries |
| In-Season **Hot Streak** | per competition | Limited Champion: score 240+ → $5 credit (0/5 steps); Limited Contender: 190+ → 150 energy | Shown as badge on the competition |
| **PRO** events (e.g. Most Wanted, featured, ends in 18 days) | Limited, higher scarcities permitted | 16★ cap | Step targets ("reach more than 200 PTS" → 500 energy), 4 lives (hearts), min 1 Most Wanted Edition card |
| Prize pools | — | Limited Contender (In-Season), 364 entrants: 1st $500, 2nd $250, 3rd $100, then energy tiers down to 1,501–2,500th | Must be read live; changes every GW |

**Direction (user request):** rules, events, hot-streak thresholds, entry costs and prizes change often, so
detect them **live** (Sorare GraphQL `so5Fixture.so5Leaderboards` + rules/rewards fields, from the
background worker) instead of hard-coding. Still open: Classic entry limits per rarity; whether one card
can sit in two lineups in the same GW (editor's "Used in another lineup" filter suggests not).

## Set / Common

| Fact | Value | Status / Source |
|---|---|---|
| Daily Picker mission | Player must beat L10 by **7** pts and score **≥ 20** | LIVE-VERIFIED (Squad page mission text) |
| Set lives | Start each level with **4 Lives**; lose a life when a lineup misses target; restart from level 1 at 0 lives | OFFICIAL DOC ("What is Sorare Set (NBA)?") |
| Collection Bonus | Up to **+5%** for owning multiple players of the same team | OFFICIAL DOC |
| Set cards get no XP / In-Season bonus | Only Collection Bonus applies | OFFICIAL DOC (Set launch blog) |
| Squad board example | "Score more than 450+ PTS", guaranteed Shiny card reward | LIVE-VERIFIED |

## DOM facts used by the content-script parser

| Fact | Status |
|---|---|
| Card images carry clean names as `alt="DeMar DeRozan - limited"` (mixed case) | LIVE-VERIFIED |
| Visible names are rendered in ALL CAPS | LIVE-VERIFIED |
| No `/cards/<slug>` anchors on lineup tiles; card art URLs are UUID-based, not slug-based | LIVE-VERIFIED |
| Each lineup is its own `<article>` with `Clear Team` / `Edit Lineup` buttons | LIVE-VERIFIED |
| Lineup anchors encode the Sorare leaderboard: `.../<fixture>-nba_limited_contender~so5-lineup~<uuid>` | LIVE-VERIFIED (not yet used by parser) |

## Sources
- Live sorare.com pages listed above (signed-in session, 2026-11-19)
- [Competition Overview (official, outdated)](https://sorare.com/help/a/30841515703581/competition-overview)
- [What is Sorare Set (NBA)?](https://sorare.com/help/a/34063004335005/-)
- [Introducing Sorare Set NBA](https://sorare.com/blog/nba/%F0%9F%86%95-introducing-sorare-set-2)
- [How are player scores calculated in Sorare NBA?](https://help.sorare.com/hc/en-us/articles/7245592557725-How-are-player-scores-calculated-in-Sorare-NBA)
- [Sorare NBA 27: Stars, Rules and 2026-27 Strategy (third-party)](https://www.soraregoat.com/sorare-nba-27/)

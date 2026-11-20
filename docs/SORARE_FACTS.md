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
| Classic entry limit | **3** per competition (Classic Limited Champion board "0 SET / 3"; Classic Limited Contender "1 SET / 3"). Code says 4 Limited/Rare, 2 SR/Unique | LIVE-VERIFIED 2026-11-19 (Limited); `OUTDATED IN CODE` — fix in M2 |
| Board URLs | Classic boards: `/nba/play/boards/arena/essence/<gw>/<gw>-nba_limited_contender`; In-Season: `/boards/arena/cash/...`; your lineups: append `/lineups` (Edit/Clear buttons, no lineup ids in markup) | LIVE-VERIFIED |
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
| PRO **Most Wanted** ladder | — | Consecutive levels: 500 energy → 1,000 energy → $10 → $50 (locks until previous step done) | 4 lives (hearts), event ends in 18 days; Pro main section has similar level ladders; Daily Picker missions too |
| Prize pools | — | Limited Contender (In-Season), 364 entrants: 1st $500, 2nd $250, 3rd $100, then energy tiers down to 1,501–2,500th | Must be read live; changes every GW |

**Direction (user request):** rules, events, hot-streak thresholds, entry costs and prizes change often, so
detect them **live** (Sorare GraphQL `so5Fixture.so5Leaderboards` + rules/rewards fields, from the
background worker) instead of hard-coding. Still open: Classic entry limits per rarity; whether one card
can sit in two lineups in the same GW (editor's "Used in another lineup" filter suggests not).

## Lineup editor (live screenshot 2026-11-19, Classic Limited Contender, GW 21-23 Nov)

| Fact | Value | Status |
|---|---|---|
| Star ratings | Shown as a badge under each card; Dillon Brooks = 2★ while the extension's L10 tiers say 2.5★. A lineup we count as 12.5★ was accepted in an 11★ competition | LIVE-VERIFIED: `computeStarCost(l10)` is OUTDATED, read live ratings in M3 |
| Games per GW | Each card lists both of its GW fixtures (e.g. PHX vs ... / @ UTA): most players have 2 games in a 3-day GW | LIVE-VERIFIED; how multiple games score (best / sum) still to verify |
| Power bonus | Shown per card (+0% / +6% / +9%) | LIVE-VERIFIED |
| Time to lock | Header badge (e.g. "1d 19h") | LIVE-VERIFIED |

## Sorare GraphQL fields (public API, probed 2026-11-19, no auth)

| Need | Field | Example |
|---|---|---|
| Star rating per player | `anyPlayer { ... on NBAPlayer { gameplayTier } }` | Dillon Brooks `ROSTER`, DeMar DeRozan `DNP_PLUS` |
| Tier -> stars map | `config { gameplayTierRatings(sport: NBA) { gameplayTier stars } }` | GOAT 5, STAR_PLUS 4.5, STAR 4, IMPACT_PLUS 3.5, IMPACT 3, ROSTER_PLUS 2.5, ROSTER 2, DNP_PLUS 1.5, DNP 1 |
| Set pack tier names | Same tiers, Set naming: Icon = GOAT, Star+ / Star, Key+ = IMPACT_PLUS, Key = IMPACT, Roster+ / Roster, Reserve+ = DNP_PLUS, Reserve = DNP | Pack odds screenshots |
| Sealing | Card `sealed`, `sealable`, `sealableFor` (live Sealing Points, e.g. 2 for a DNP Limited), `unsealableAt` | `sealableFor: 2` on Limited DNP cards |
| Introspection | Disabled (`__type` not on Query); read field names from sorare.com's Apollo cache (`window.__APOLLO_CLIENT__.cache.extract()`) | - |

## Multi-game Game Weeks

| Fact | Value | Status |
|---|---|---|
| GW span | Biweekly: Mon-Thu and Fri-Sun (3-4 days); submit before the GW's first game | OFFICIAL help (schedule article) |
| 2+ games in a GW | The player's **best single game** counts | THIRD-PARTY guide (laligaexpert); matches the extension's best-of-k model. Live check: a 2-game player's lineup score on a closed GW |

## Card reuse (user-confirmed 2026-11-19)

| Fact | Value | Status |
|---|---|---|
| Same card, two lineups, same GW | **Not allowed** (maybe in rare special events) | USER |
| Two cards of the same player in one lineup | **Not allowed** | USER |
| Two different cards of the same player in separate lineups (same GW) | **Allowed** | USER |
| Classic board note | "One of the card was listed on the marketplace" warning on a submitted lineup | LIVE (Top Lineups screenshot) |

## Vault / Sealing (NBA)

| Fact | Value | Status / Source |
|---|---|---|
| Sealed card | Locked: cannot be sold, traded or played; still counts for Collection score | OFFICIAL (Sorare NBA 26 blog; MLB/Football help match) |
| Lineups | Sealing a card in an upcoming or live lineup cancels that lineup (warning before confirm) | OFFICIAL help (MLB article; same system) |
| Unseal | 1 card per scarcity every 2 weeks (14 days); removes its Sealing Points | OFFICIAL (NBA 26 blog + help) |
| Sealing Points | 1 / 2 / 5 / 20 / 50 / 200 by a card quality tier Sorare decides; shown before sealing. No first-owner/loyalty bonus since 2026 | OFFICIAL help. Extension **estimates** the tier from scarcity + L10: user reports the estimates are wrong, fetch live in M3 |
| Vault Levels | 1-20 = +1%..+20% rewards, one Vault per scarcity (no Common Vault); mixed lineups use the card-weighted average | OFFICIAL help |
| Boost scope | In-Season and Classic only; not Arena Rooms, Hot Streaks, Missions, Special Events | OFFICIAL (NBA 26 blog) |
| Listed card | Sealed cards cannot be sold, so a live listing is removed | INFERRED from "cannot be sold"; verify in the seal dialog |

## Timers

| Fact | Value | Status / Source |
|---|---|---|
| Daily reset | **07:00 UTC** (Set daily countdown read 11H 47M at 19:12:58 UTC on 2026-11-19 = 07:00 UTC). Only shown as a countdown in the Set section (Live Today packs, daily missions) | LIVE-VERIFIED 2026-11-19 |
| GW cutoff | `so5Fixture.cutOffDate` of the opened fixture | API |

## Set / Common

| Fact | Value | Status / Source |
|---|---|---|
| Daily Picker mission | Player must beat L10 by **7** pts and score **≥ 20** | LIVE-VERIFIED (Squad page mission text) |
| Set modes | **Arcade (Solo)** and **Squad**; the current theme/season is **Divination** ("1M 18D" left; Divination set ends Jan 7th; Divination Essence and cards can't be used in the next set; Divination Streaks count through the last game Wed Jan 6th) | LIVE (user screenshots 2026-11-19) |
| Arcade (Solo) | Up to **4 teams** at once, one rule: **16 stars cap** ("sum of players' stars must remain below 16"). Hot Streak ladder: "Chapter 1 - Step 2", target **180 PTS**, rewards along the path (10 gems, 30 gems, €100, €1,000), 4 lives (hearts) | LIVE (user screenshots) |
| Squad | Join a squad of **max 10 managers** (e.g. "Lazy Goats" 10/10, has a Captain). Each manager sets **1 team** (16★ cap). Squad stage target uses the squad's **3 best teams** (e.g. "Opts: your 3 best teams need to score 650+ PTS", next stage 730). Failing a stage resets to level 1. Result settles at a fixed time (e.g. "Friday 8:30 AM"). A Squad **Hub** shares members' wins | LIVE (user screenshots + user) |
| Squad cap (old code) | Code used a **120** non-MVP L10 cap (`SET_ARCADE_RULES.squadSalaryCap`) | `OUTDATED IN CODE`: live rule is a 16-star cap, fix in M3 |
| Set card stars | Set cards carry star tiers shown on packs: Reserve 1★, Reserve+ 1.5★, Roster 2★, Roster+ 2.5★, Key 3★, Key+ 3.5★, Star 4★, Star+ 4.5★, Icon 5★ | LIVE (pack odds screenshots) |
| Set card editions | Standard / Shiny / Holo (filter icons; Legendary Chase pack: Full Holo 0.5%, Full Shiny 1%, Slot 5 Legendary 1%) | LIVE |
| Packs (Divination shop) | Gold 50 gems, Silver 10 gems, Bronze 1000 Essence, Bronze+ unlocks after a 10-step progress bar; "Live Today" Silver (10 gems) / Bronze (1000 Essence) packs of today's playing teams, 3 cards, ends with the day; Legendary Chase 65 gems (4 cards + 1% bonus 5th Legendary card) | LIVE (user screenshots) |
| Pack odds | Shown per card slot (#1-#4); odds improve per slot and the **#4 slot carries the best tier** (Bronze #4: Icon 0.1%, Star+ 0.4%, Star 1.5%, Key+ 2.76%, Key 15.64%, Roster+ 11.94%, Roster 67.66%; Bronze #1: Roster+ 4.5%, Roster 25.5%, Reserve+ 10.5%, Reserve 59.5%) | LIVE (pack details) |
| Gems | Bought with cash: 5 = €0.99 ... 500 (+250) = €99.95; bundles 320 + 2 Gold packs €59.95, 850 + 6 Gold packs €149.95 | LIVE (shop) |
| Daily Boost | Checklist: Open Daily Pack, Buy a Pack, Play the Daily Picker, Collect at least a 3-stars player | LIVE |
| Daily Pack | Free pack openable once per day | USER |
| Gallery | Set gallery shows count per scarcity tier (e.g. 495 / 89 / 18 / 0), duplicate toggle, injury tags (OUT / GTD), star badge and power % per card | LIVE |
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

## Leaderboard rewards (live, 2026-11-19, Apollo cache on sorare.com + public API)
- `So5Leaderboard.rewardsConfig { prizePoolCurrency ranking { ranks rankPct rewardConfigs } }`. `ranks` is the number of places in that tier (cumulative from rank 1).
- Reward types: `MonetaryRewardConfig { amount { usdCents eurCents } }` (cash), `CardShardRewardConfig { quantity configRarity }` (Essence), `InGameCurrencyRewardConfig { currency amount }` (e.g. `LIMITED_XP`).
- Example GW10 Limited In-Season Champion (1,243 lineups): cash for ranks 1-50 ($2,000, $1,000, $500, $250, $125, then $50 x5, $25 x40), Essence for 51-1,500 (2,000 down to 250), XP for 1,501-3,000.
- Querying `rewardConfigs` makes the board query depth 8: needs an API key (limit 13; no-key limit 7).

## Daily Picker (live, 2026-11-19)
- Mission `DecisivePlayerPickerTask` ("Daily Picker"): `overperform { averageType: LAST_TEN_PLAYED_SO5_AVERAGE_SCORE, by: 7 }`, also must score 20+, `maxAppearancesCount: 1`, reward Common Essence (`CardShardRewardConfig`).
- `pickableGames` = the not-yet-started games before the next 07:00 UTC reset (2026-11-19: 4 games at 01:00 UTC Nov 20). Any player in those games can be picked.
- Opened from `/nba/series/play?missions=play`. User-specific (needs login), so the extension rebuilds the slate from ESPN + public `team(slug).activePlayers`.

## Set Solo steps (live, 2026-11-19)
- `CareerStep { target maxLineupsCount }`: targets 150, 180, 210, 240, 270, 290; `maxLineupsCount` 4.
- Each step lineup has 5 `AppearanceRule`s (5 cards).
- Inferred, to confirm: Set lineups use the daily slate (the Set page shows a day picker beside each day's games).

## ESPN scoreboard and no-key limits (checked 2026-11-20)
- `site.api.espn.com/.../scoreboard?dates=YYYYMMDD-YYYYMMDD` now returns 0 events; single `dates=YYYYMMDD` still works (US calendar day). The extension fetches each day and merges.
- Live Daily Picker at 00:14 UTC Nov 20 offered GS@MEM, POR@MIL, NY@MIN, LAC@SA (01:00 UTC), matching ESPN's Nov 19 US-date games before the 07:00 UTC reset.
- No-key gallery query: 10 cards/page = complexity 720, 8 = 586, 6 fits under 500.

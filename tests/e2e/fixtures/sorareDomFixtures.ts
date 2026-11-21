function renderStackedSlot(
  firstName: string,
  lastName: string,
  badgeText?: string,
  extraMeta?: string,
): string {
  return `
    <div class="arena-slot-card">
      <div class="slot-art">
        <img src="https://assets.sorare.com/nba/player-portrait.png" alt="" />
        ${badgeText ? `<span class="slot-status">${badgeText}</span>` : ""}
      </div>
      <div class="slot-name-stack">
        <span>${firstName}</span>
        <span>${lastName}</span>
      </div>
      ${extraMeta ? `<div class="slot-meta">${extraMeta}</div>` : ""}
    </div>
  `;
}

function renderArenaLineupBox(
  title: string,
  entrantsLabel: string,
  slotsHtml: string,
): string {
  return `
    <section class="arena-lineup-card">
      <header class="arena-lineup-header">
        <div>
          <h3>${title}</h3>
          <p>${entrantsLabel}</p>
        </div>
        <div class="arena-lineup-actions">
          <button type="button">LEVEL UP</button>
        </div>
      </header>
      <div class="arena-lineup-slots">
        ${slotsHtml}
      </div>
      <footer class="arena-lineup-footer">
        <button type="button">Clear Team</button>
        <button type="button">Edit Lineup</button>
      </footer>
    </section>
  `;
}

function renderSorareShell(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><title>${title}</title></head>
<body>
  <header>
    <button type="button" aria-haspopup="dialog">
      <div role="img" aria-label="pjampjam">P</div>
    </button>
  </header>
  <aside>
    <nav>
      <a href="/nba/craft">85</a>
      <button type="button">€0.00</button>
      <button type="button">0.000093 ETH</button>
      <button type="button">33 Clues</button>
    </nav>
  </aside>
  <main>
    ${bodyContent}
  </main>
</body>
</html>`;
}

/**
 * Screenshot 4 (`/nba/lineups/arena/nba-21-23-nov-2026`):
 * All 3 `Arena Classic Contender` lineups side-by-side with stacked `FIRST\nLAST`
 * layout, `Edit Lineup` / `Clear Team` buttons, and NO `<a href="/cards/...">` anchors.
 */
export function buildArenaGw10LineupsHtml(): string {
  const lineup1 = renderArenaLineupBox(
    "Arena Classic Contender",
    "11★ Cap • 1,868 entrants • Nov 21-23",
    [
      renderStackedSlot("MOREZ", "JOHNSON JR.", "ROOKIE", "DAL #14"),
      renderStackedSlot("DEMAR", "DEROZAN", undefined, "DEN #10"),
      renderStackedSlot("MALIK", "MONK", undefined, "SAC #0"),
      renderStackedSlot("CHRISTIAN", "ANDERSON JR.", "ROOKIE", "CHA #5"),
      renderStackedSlot("TAYLOR", "HENDRICKS", undefined, "MEM #22"),
    ].join(""),
  );

  const lineup2 = renderArenaLineupBox(
    "Arena Classic Contender",
    "11★ Cap • 1,868 entrants • Nov 21-23",
    [
      renderStackedSlot("AARON", "GORDON", undefined, "DEN #32"),
      renderStackedSlot("BROOK", "LOPEZ", undefined, "LAC #11"),
      renderStackedSlot("WENDELL", "CARTER JR.", undefined, "ORL #34"),
      renderStackedSlot("QUENTON", "JACKSON", undefined, "IND #29"),
      renderStackedSlot("DILLON", "BROOKS", undefined, "PHX #3"),
    ].join(""),
  );

  const lineup3 = renderArenaLineupBox(
    "Arena Classic Contender",
    "11★ Cap • 1,868 entrants • Nov 21-23",
    [
      renderStackedSlot("JARACE", "WALKER", undefined, "IND #5"),
      renderStackedSlot("BUB", "CARRINGTON", undefined, "WAS #7"),
      renderStackedSlot("ALLEN", "GRAVES", "ROOKIE", "TOR #22"),
      renderStackedSlot("DEAN", "WADE", "GTD", "PHI #45"),
      renderStackedSlot("NIKOLA", "VUCEVIC", undefined, "ORL #9"),
    ].join(""),
  );

  return renderSorareShell(
    "Sorare NBA - Arena Lineups (Nov 21-23)",
    `
      <div class="gw-tabs">
        <span>Nov 14-16</span>
        <span>Nov 17-20 • LIVE</span>
        <span>Nov 21-23 2d 2h</span>
      </div>
      <h1>ARENA • Classic Contender (1,868 entrants)</h1>
      <div class="arena-grid">${lineup1}${lineup2}${lineup3}</div>
    `,
  );
}

/**
 * Screenshot 3 (`/nba/lineups/pro`):
 * Empty Pro lobby (`No lineups entered` / `Enter lineups`).
 */
export function buildProLineupsEmptyHtml(): string {
  return renderSorareShell(
    "Sorare NBA - Pro Lineups",
    `
      <section class="pro-empty-state">
        <h1>Pro Lineups</h1>
        <p>No lineups entered</p>
        <a href="/nba/play">Enter lineups</a>
      </section>
      <div class="mode-toggle">
        <button type="button">PRO</button>
        <a href="/nba/lineups/arena/ongoing">ARENA</a>
      </div>
    `,
  );
}

/**
 * Screenshot 2 (`/nba/lineups/arena/ongoing`):
 * `TOP LINEUPS • LIVE` with `In Season Contender` & `Classic Contender`.
 */
export function buildArenaOngoingHtml(): string {
  return renderSorareShell(
    "Sorare NBA - Ongoing Arena Lineups",
    `
      <div class="gw-tabs">
        <span>Nov 14-16</span>
        <span>Nov 17-20 • LIVE</span>
        <span>Nov 21-23 2d 2h</span>
      </div>
      <h1>TOP LINEUPS • LIVE</h1>
      <section class="live-lineup">
        <h3>In Season Contender</h3>
        <p>4,850 entrants • 57 PTS • 42 PTS TO REWARD • PRIZE: 4,299TH</p>
        <div>Aaron Gordon</div>
        <div>Dillon Brooks</div>
        <div>Wendell Carter Jr.</div>
        <div>DeMar DeRozan</div>
        <div>Quenton Jackson</div>
        <button type="button">View Lineup</button>
      </section>
      <section class="live-lineup">
        <h3>Classic Contender</h3>
        <p>9,094 entrants • ONE OF THE CARD WAS LISTED ON THE MARKETPLACE.</p>
        <div>Isaac Okoro</div>
        <div>Allen Graves</div>
        <div>Nikola Vucevic</div>
        <div>Bub Carrington</div>
        <div>Malik Monk</div>
        <button type="button">View Lineup</button>
      </section>
    `,
  );
}

/**
 * Screenshot 5 (`/nba/series/play`):
 * Set Arcade (`DIVINATION`, 4 Lives, ladder, Daily Picker).
 */
export function buildSetArcadePlayHtml(): string {
  return renderSorareShell(
    "Sorare NBA - Set Arcade",
    `
      <section class="set-arcade-header">
        <span>ARCADE</span>
        <h1>DIVINATION • 1M 11D</h1>
        <div class="lives">4 Lives ❤️❤️❤️❤️</div>
        <div class="timer">11H 42M</div>
      </section>
      <section class="arcade-ladder">
        <div>5,000</div>
        <div>10</div>
        <div>30</div>
        <div>100</div>
        <div>1,000</div>
      </section>
      <section class="daily-picker">
        <h3>Daily Picker</h3>
        <p>Pick a player who outperforms his L10 by 7 points. The player must also score at least 20 fantasy points.</p>
      </section>
    `,
  );
}

/**
 * Screenshot 7 (`/nba/series/squad`):
 * Set Squad (`TEST SQUAD`, `580+ PTS`, Daily Picker mission).
 */
export function buildSetSquadHtml(): string {
  return renderSorareShell(
    "Sorare NBA - Set Squad",
    `
      <section class="squad-header">
        <h1>TEST SQUAD</h1>
        <span>10 members</span>
        <span>LAST GAME 5H 42M</span>
        <p>Score more than 580+ PTS</p>
      </section>
      <aside class="squad-missions">
        <div>Collect at least a 3-stars player (0/1)</div>
        <div>Open Daily Pack</div>
        <div>Buy a Pack</div>
        <div>Play the Daily Picker</div>
        <div>DIVINATION Collect Players 363 / 462 +75 Essence</div>
        <div>
          <h4>DAILY Daily Picker</h4>
          <p>Pick a player who outperforms his L10 by 7 points. The player must also score at least 20 fantasy points.</p>
        </div>
      </aside>
    `,
  );
}

/**
 * Screenshot 6 (`/nba/series/38c6feb9-269d-4640-a136-0ac21603b058/lineups`):
 * Set Hot Streak (`HOT STREAK`, `150 PTS`).
 */
export function buildSetHotStreakLineupsHtml(): string {
  return renderSorareShell(
    "Sorare NBA - Hot Streak",
    `
      <section class="hot-streak-header">
        <h1>HOT STREAK</h1>
        <p>Build a team who will reach more than 150 PTS</p>
        <span>2,000 Essence</span>
      </section>
      <section class="hot-streak-team">
        <span>IN PROGRESS • 71.29 PTS • 79 PTS TO TARGET</span>
        <div>Jalen Johnson</div>
        <div>Devin Booker</div>
        <div>Donovan Mitchell</div>
        <div>LaMelo Ball</div>
        <div>Darius Garland</div>
        <button type="button">+ Add team now</button>
      </section>
    `,
  );
}

/**
 * Screenshot 9 (`/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion`):
 * Arena In-Season Champion Board (`0 SET / 5`, `792` entrants).
 */
export function buildArenaCashBoardHtml(): string {
  return renderSorareShell(
    "Sorare NBA - Arena In-Season Champion",
    `
      <nav class="shortcuts">
        <a href="/nba/play">Pro</a>
        <a href="/nba/play/boards/arena/cash/nba-21-23-nov-2026/nba-21-23-nov-2026-nba_limited_in_season_champion">Arena In-Season</a>
        <a href="/nba/lineups/arena/nba-21-23-nov-2026">Arena Classic</a>
      </nav>
      <section class="board-summary">
        <h1>GAMEWEEK 10 • CHAMPION NOV 21-23</h1>
        <div>2D 2H</div>
        <div>$5,125</div>
        <div>812.5K</div>
        <div>0 SET / 5</div>
        <div>792 entrants</div>
      </section>
      <section class="slate-matchups">
        <div>Hornets vs Hawks</div>
        <div>Pacers vs Cavaliers</div>
        <div>Raptors vs Pistons</div>
        <div>Magic vs Nets</div>
        <div>Wizards vs Bulls</div>
        <div>Pelicans vs Thunder</div>
      </section>
    `,
  );
}

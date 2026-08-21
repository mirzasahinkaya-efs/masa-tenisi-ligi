import { computeTable, isRanked } from './lib/standings.js';
import {
  resolveBracket, bestFourthPlayerId, allGroupsComplete, QUALIFY_PER_GROUP,
} from './lib/bracket.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

let league;
try {
  const response = await fetch('./data/league.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  league = await response.json();
} catch (error) {
  document.getElementById('progress').textContent =
    `Could not load league data (${error.message})`;
  throw error;
}

const nameOf = new Map(league.players.map((player) => [player.id, player.short]));
const fullNameOf = new Map(league.players.map((player) => [player.id, player.name]));
const resultFor = new Map(league.results.map((result) => [result.fixtureId, result]));

const allFixtures = [...league.fixtures, ...league.playoffFixtures];

const tables = {
  A: computeTable(league.groups.A, league.fixtures, league.results, league.rules, league.season.drawSeed),
  B: computeTable(league.groups.B, league.fixtures, league.results, league.rules, league.season.drawSeed),
};

const formatDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
});

const signed = (value) => (value > 0 ? `+${value}` : String(value));

function renderProgress() {
  const known = new Set(allFixtures.map((fixture) => fixture.id));
  const played = new Set(
    league.results.map((result) => result.fixtureId).filter((id) => known.has(id)),
  ).size;
  document.getElementById('progress').textContent = `${played}/${known.size} matches played`;
}

/**
 * One tick per match, in playing order. Playoff fixtures have no p1/p2 until
 * their slots resolve, so those fall back to the slot label ("A1", "W-SF1").
 */
function renderSeasonStrip() {
  const played = new Set(league.results.map((result) => result.fixtureId));

  document.getElementById('season-strip').innerHTML = allFixtures.map((fixture) => {
    const home = nameOf.get(fixture.p1) ?? fixture.slotP1;
    const away = nameOf.get(fixture.p2) ?? fixture.slotP2;
    const result = resultFor.get(fixture.id);
    const score = result ? ` · ${result.p1Games}-${result.p2Games}` : '';
    const label = `${fixture.id} · ${home} v ${away}${score}`;
    return `<span class="tick${played.has(fixture.id) ? ' tick--played' : ''}" title="${esc(label)}"></span>`;
  }).join('');
}

/** Highlights the nav link for whichever section is currently in view. */
function wireSectionNav() {
  const links = new Map(
    [...document.querySelectorAll('.sectionnav a')].map((link) => [link.hash.slice(1), link]),
  );
  const sections = [...links.keys()]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  if (!sections.length || typeof IntersectionObserver !== 'function') return;

  const setCurrent = (id) => {
    for (const [key, link] of links) {
      if (key === id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };

  const observer = new IntersectionObserver((entries) => {
    const inView = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (inView.length) setCurrent(inView[0].target.id);
  }, { rootMargin: '-56px 0px -55% 0px' });

  for (const section of sections) observer.observe(section);
  setCurrent(sections[0].id);
}

function renderTable(elementId, rows, bestFourth) {
  const ranked = isRanked(rows);

  const head = `
    <thead><tr>
      <th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th><th>Diff</th><th>Pts</th>
    </tr></thead>`;

  const classFor = (row) => {
    if (!ranked) return '';
    if (row.position <= QUALIFY_PER_GROUP) return 'qualifying';
    // The fourth place holding the cross-group play-off slot. Only ever set once
    // both groups are finished, so it marks a decided place rather than a guess.
    return row.playerId === bestFourth ? 'qualifying qualifying--playoff' : '';
  };

  const body = rows.map((row) => `
    <tr class="${classFor(row)}">
      <td>${ranked ? row.position : '–'}</td>
      <td title="${esc(fullNameOf.get(row.playerId))}">${esc(nameOf.get(row.playerId))}</td>
      <td>${row.played}</td>
      <td>${row.won}</td>
      <td>${row.lost}</td>
      <td>${signed(row.gameDiff)}</td>
      <td class="pts">${row.points}</td>
    </tr>`).join('');

  document.getElementById(elementId).innerHTML = `${head}<tbody>${body}</tbody>`;
}

/** The round the calendar says we are in — not the oldest unfinished one. */
function currentRoundNumber() {
  const today = new Date().toISOString().slice(0, 10);
  const open = league.rounds.filter((round) => round.opensAt <= today);
  return open.length ? open[open.length - 1].n : league.rounds[0].n;
}

function fixtureLine(fixture, showRound = false) {
  const result = resultFor.get(fixture.id);
  const score = result
    ? `<span class="score">${result.p1Games}-${result.p2Games}</span>`
    : '<span class="score pending">pending</span>';
  const tag = showRound ? `<span class="vs">R${fixture.round}</span>` : '';
  return `
    <li>
      <span class="who">${esc(nameOf.get(fixture.p1))}<span class="vs">vs</span>${esc(nameOf.get(fixture.p2))}</span>
      ${tag}
      ${score}
    </li>`;
}

function renderCurrentRound() {
  const number = currentRoundNumber();
  const round = league.rounds.find((entry) => entry.n === number);
  const fixtures = league.fixtures.filter((fixture) => fixture.round === number);

  // Fixtures from rounds already past their deadline that nobody has played.
  const overdue = league.fixtures.filter(
    (fixture) => fixture.round < number && !resultFor.has(fixture.id),
  );

  document.getElementById('round-title').textContent = `Round ${number}`;
  document.getElementById('round-deadline').textContent =
    round ? `Play by ${formatDate(round.deadline)}` : '';

  const overdueBlock = overdue.length
    ? `<li class="overdue-head">Still unplayed from earlier rounds</li>${
      overdue.map((fixture) => fixtureLine(fixture, true)).join('')}`
    : '';

  document.getElementById('round-fixtures').innerHTML =
    fixtures.map((fixture) => fixtureLine(fixture)).join('') + overdueBlock;
}

const PLACEHOLDER_TEXT = { BEST4: 'Best 4th' };

function bracketSlot(playerId, placeholder, games, isWinner) {
  // Any `@id` slot is the fixed entrant, read generically so it keeps working if
  // the CEO is ever a different person.
  const placeholderText = PLACEHOLDER_TEXT[placeholder]
    ?? (placeholder.startsWith('@') ? 'CEO' : placeholder);
  // A resolved id with no name means the roster and the bracket have drifted
  // apart — show the placeholder rather than an empty slot, which would give a
  // reader no clue anything was wrong.
  const name = playerId ? nameOf.get(playerId) : undefined;
  const label = name
    ? `<span class="${isWinner ? 'slot--winner' : ''}">${esc(name)}</span>`
    : `<span class="slot--empty">${esc(placeholderText)}</span>`;
  const score = games === null ? '' : `<span class="slot__games">${games}</span>`;
  return `<div class="slot">${label}${score}</div>`;
}

function renderBracket() {
  const bracket = resolveBracket(tables, allFixtures, league.results, {
    drawSeed: league.season.drawSeed,
  });
  const phases = [...new Set(bracket.map((match) => match.phase))];

  document.getElementById('bracket').innerHTML = phases.map((phase) => {
    const matches = bracket.filter((match) => match.phase === phase);
    return `
      <div class="bracket-phase">
        <h4>${esc(phase)}</h4>
        <div class="bracket-phase__matches">
          ${matches.map((match) => {
            const { result } = match;
            const p1Won = result ? result.p1Games > result.p2Games : false;
            const p2Won = result ? result.p2Games > result.p1Games : false;
            return `
              <div class="bracket-match ${match.id === 'FINAL' ? 'bracket-match--final' : ''}">
                <div class="bracket-match__label">${esc(match.label)}</div>
                ${bracketSlot(match.p1, match.slotP1, result ? result.p1Games : null, p1Won)}
                ${bracketSlot(match.p2, match.slotP2, result ? result.p2Games : null, p2Won)}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderAllFixtures() {
  document.getElementById('all-fixtures').innerHTML = league.rounds.map((round) => {
    const fixtures = league.fixtures.filter((fixture) => fixture.round === round.n);
    return `
      <div class="round-block">
        <h4>Round ${round.n} &middot; by ${formatDate(round.deadline)}</h4>
        <ul class="fixtures">${fixtures.map((fixture) => fixtureLine(fixture)).join('')}</ul>
      </div>`;
  }).join('');
}

renderProgress();
renderSeasonStrip();
// Three qualify from each group. The seventh place goes to whichever fourth
// place is stronger across the two, and the eighth is the CEO, who plays no
// group stage.
// Only once EVERY group is finished. Mid-season the two fourth places have
// played different numbers of matches, so comparing them is not like-for-like —
// and the footnote under the tables promises exactly this.
const bestFourth = allGroupsComplete(tables, allFixtures, league.results)
  ? bestFourthPlayerId(tables, league.season.drawSeed)
  : null;
renderTable('group-a', tables.A, bestFourth);
renderTable('group-b', tables.B, bestFourth);
renderCurrentRound();
renderBracket();
renderAllFixtures();
wireSectionNav();

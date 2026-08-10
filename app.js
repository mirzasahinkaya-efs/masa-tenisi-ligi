import { computeTable } from './lib/standings.js';
import { resolveBracket } from './lib/bracket.js';

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

function renderTable(elementId, rows) {
  const started = rows.some((row) => row.played > 0);

  const head = `
    <thead><tr>
      <th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th><th>Diff</th><th>Pts</th>
    </tr></thead>`;

  const body = rows.map((row) => `
    <tr class="${started && row.position <= 2 ? 'qualifying' : ''}">
      <td>${started ? row.position : '–'}</td>
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

function bracketSlot(playerId, placeholder, games, isWinner) {
  const label = playerId
    ? `<span class="${isWinner ? 'slot--winner' : ''}">${esc(nameOf.get(playerId))}</span>`
    : `<span class="slot--empty">${esc(placeholder)}</span>`;
  const score = games === null ? '' : `<span class="slot__games">${games}</span>`;
  return `<div class="slot">${label}${score}</div>`;
}

function renderBracket() {
  const bracket = resolveBracket(tables, allFixtures, league.results);

  document.getElementById('bracket').innerHTML = bracket.map((match) => {
    const { result } = match;
    const p1Won = result ? result.p1Games > result.p2Games : false;
    const p2Won = result ? result.p2Games > result.p1Games : false;
    const isFinal = match.id === 'FINAL';

    return `
      <div class="bracket-match ${isFinal ? 'bracket-match--final' : ''}">
        <div class="bracket-match__label">${esc(match.label)}</div>
        ${bracketSlot(match.p1, match.slotP1, result ? result.p1Games : null, p1Won)}
        ${bracketSlot(match.p2, match.slotP2, result ? result.p2Games : null, p2Won)}
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
renderTable('group-a', tables.A);
renderTable('group-b', tables.B);
renderCurrentRound();
renderBracket();
renderAllFixtures();

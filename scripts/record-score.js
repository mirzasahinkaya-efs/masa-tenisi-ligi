import { readFile, writeFile } from 'node:fs/promises';
import { parseScore } from '../lib/validate.js';
import { computeTable } from '../lib/standings.js';
import { resolvePlayer, playableFixtures, findOpenFixture, orientResult } from '../lib/report.js';

function printUsage() {
  console.error('Usage: npm run score -- <playerA> <playerB> <aGames>-<bGames> [--fix] [--dry-run]');
  console.error('  The score is always from playerA\'s point of view, e.g. "3-1".');
}

const rawArgs = process.argv.slice(2);
const positional = rawArgs.filter((arg) => !arg.startsWith('--'));
const dryRun = rawArgs.includes('--dry-run');
const fix = rawArgs.includes('--fix');

if (positional.length !== 3) {
  printUsage();
  process.exit(1);
}

const [queryA, queryB, scoreText] = positional;

const target = new URL('../data/league.json', import.meta.url);
const league = JSON.parse(await readFile(target, 'utf8'));

const displayName = (id) => league.players.find((player) => player.id === id)?.name ?? id;

const resolvedA = resolvePlayer(league, queryA);
const resolvedB = resolvePlayer(league, queryB);

function reportResolveFailure(query, resolved) {
  if (resolved.error === 'NOT_FOUND') {
    console.error(`No player matches "${query}".`);
    console.error(`Valid ids: ${league.players.map((player) => player.id).join(', ')}`);
  } else {
    console.error(`"${query}" is ambiguous — matches: ${resolved.candidates.join(', ')}`);
  }
}

if (!resolvedA.ok) {
  reportResolveFailure(queryA, resolvedA);
  process.exit(1);
}
if (!resolvedB.ok) {
  reportResolveFailure(queryB, resolvedB);
  process.exit(1);
}

const idA = resolvedA.id;
const idB = resolvedB.id;

if (idA === idB) {
  console.error(`"${queryA}" and "${queryB}" both resolve to the same player (${idA}).`);
  process.exit(1);
}

const parsed = parseScore(scoreText);
if (!parsed.ok) {
  if (parsed.error === 'FORMAT') {
    console.error(`Could not parse "${scoreText}" as a score. Expected a shape like "3-1".`);
  } else {
    console.error(`Illegal score "${scoreText}": a best-of-five match ends when the winner has exactly 3 games.`);
  }
  process.exit(1);
}

const openResult = findOpenFixture(league, idA, idB);

let fixture;
let existingResult = null;

if (!openResult.ok) {
  if (openResult.error === 'NO_PAIRING') {
    console.error(`${displayName(idA)} and ${displayName(idB)} are in different groups and never meet.`);
    process.exit(1);
  }

  console.error(`${displayName(idA)} and ${displayName(idB)} have already played all their fixtures:`);
  for (const played of openResult.played) {
    console.error(`  ${played.fixtureId}: ${displayName(played.p1)} ${played.p1Games}-${played.p2Games} ${displayName(played.p2)}`);
  }

  if (!fix) {
    console.error('Re-run with --fix to overwrite the most recent one.');
    process.exit(1);
  }

  // "Most recent" = highest round among the fixtures between them; a null
  // (playoff) round is later than any numbered group round.
  const between = playableFixtures(league).filter(
    (candidate) => (candidate.p1 === idA && candidate.p2 === idB) || (candidate.p1 === idB && candidate.p2 === idA),
  );
  const roundKey = (candidate) => (candidate.round === null ? Infinity : candidate.round);
  fixture = between.reduce((latest, candidate) => (roundKey(candidate) > roundKey(latest) ? candidate : latest));
  existingResult = league.results.find((result) => result.fixtureId === fixture.id);
} else {
  fixture = openResult.fixture;
}

const oriented = orientResult(fixture, idA, parsed.p1Games, parsed.p2Games);
const reportedAt = new Date().toISOString();

if (existingResult) {
  existingResult.p1Games = oriented.p1Games;
  existingResult.p2Games = oriented.p2Games;
  existingResult.reportedBy = 'cli';
  existingResult.reportedAt = reportedAt;
} else {
  league.results.push({
    fixtureId: fixture.id,
    p1Games: oriented.p1Games,
    p2Games: oriented.p2Games,
    reportedBy: 'cli',
    reportedAt,
  });
}

if (!dryRun) {
  await writeFile(target, `${JSON.stringify(league, null, 2)}\n`, 'utf8');
}

const roundLabel = fixture.stage === 'playoff' ? 'playoff' : `round ${fixture.round}`;
const scoreLine = `${fixture.id} (${roundLabel}): ${displayName(fixture.p1)} ${oriented.p1Games}-${oriented.p2Games} ${displayName(fixture.p2)}`;

console.log(`${dryRun ? '[dry run] ' : ''}${scoreLine}`);

function groupOf(playerId) {
  return Object.entries(league.groups).find(([, ids]) => ids.includes(playerId))?.[0];
}

function printStandingsRow(playerId) {
  const groupName = groupOf(playerId);
  // The CEO plays no group stage, so he has no table row to print. Without this
  // the result is written and then the script throws on the way out, which
  // leaves the operator staring at a stack trace and no commit hint.
  if (!groupName) return;

  const table = computeTable(
    league.groups[groupName],
    league.fixtures,
    league.results,
    league.rules,
    league.season.drawSeed,
  );
  const row = table.find((entry) => entry.playerId === playerId);
  const diff = row.gameDiff >= 0 ? `+${row.gameDiff}` : `${row.gameDiff}`;
  console.log(
    `  ${displayName(playerId)} — Group ${groupName}: position ${row.position}, `
    + `played ${row.played}, points ${row.points}, game diff ${diff}`,
  );
}

printStandingsRow(idA);
printStandingsRow(idB);

if (!dryRun) {
  console.log(`\nNext: git commit -am "Record ${scoreLine}" && git push`);
}

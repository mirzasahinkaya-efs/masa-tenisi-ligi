import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGroupFixtures } from '../lib/schedule.js';
import {
  resolvePlayer,
  playableFixtures,
  findOpenFixture,
  orientResult,
} from '../lib/report.js';

const RULES = { pointsWin: 3, pointsLoss: 0 };
const SEED = 20260810;

const players = [
  { id: 'aytac', name: 'Aytaç Ç.', short: 'Aytaç Ç.' },
  { id: 'mirza', name: 'Mirza Ş.', short: 'Mirza Ş.' },
  { id: 'tolga', name: 'Tolga E.', short: 'Tolga E.' },
  { id: 'emre-b', name: 'Emre B.', short: 'Emre B.' },
  { id: 'emre-k', name: 'Emre K.', short: 'Emre K.' },
  { id: 'emre-y', name: 'Emre Y.', short: 'Emre Y.' },
];

// A: aytac, mirza, tolga — B: emre-b, emre-k, emre-y. Three players per
// group gives each pair exactly two fixtures (double round-robin), which is
// the minimum needed to exercise both orientations.
const groups = { A: ['aytac', 'mirza', 'tolga'], B: ['emre-b', 'emre-k', 'emre-y'] };
const fixtures = [
  ...generateGroupFixtures('A', groups.A),
  ...generateGroupFixtures('B', groups.B),
];

function makeLeague(results = []) {
  return {
    season: { drawSeed: SEED },
    rules: RULES,
    players,
    groups,
    fixtures,
    results,
  };
}

// Confirm the premise the rest of the file leans on: mirza and tolga meet
// at A-R1-M1 (mirza p1, tolga p2) and A-R4-M1 (tolga p1, mirza p2) — the
// lowest and highest round respectively, in opposite orientations.
test('fixture data premise: mirza/tolga meet twice, orientation reversed', () => {
  const forward = fixtures.find((f) => f.id === 'A-R1-M1');
  const reverse = fixtures.find((f) => f.id === 'A-R4-M1');
  assert.deepEqual([forward.p1, forward.p2], ['mirza', 'tolga']);
  assert.deepEqual([reverse.p1, reverse.p2], ['tolga', 'mirza']);
});

test('resolvePlayer matches an exact id', () => {
  assert.deepEqual(resolvePlayer(makeLeague(), 'mirza'), { ok: true, id: 'mirza' });
});

test('resolvePlayer matches a unique case-insensitive id prefix', () => {
  assert.deepEqual(resolvePlayer(makeLeague(), 'MIRZ'), { ok: true, id: 'mirza' });
});

test('resolvePlayer matches a substring of the name or short form', () => {
  // "olga" is not a prefix of the id "tolga" but is a substring of the name.
  assert.deepEqual(resolvePlayer(makeLeague(), 'olga'), { ok: true, id: 'tolga' });
});

test('resolvePlayer is ambiguous across the three Emres', () => {
  const result = resolvePlayer(makeLeague(), 'emre');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'AMBIGUOUS');
  assert.deepEqual(result.candidates.sort(), ['emre-b', 'emre-k', 'emre-y']);
});

test('resolvePlayer reports NOT_FOUND for an unknown query', () => {
  assert.deepEqual(resolvePlayer(makeLeague(), 'nobody'), {
    ok: false,
    error: 'NOT_FOUND',
    candidates: [],
  });
});

test('playableFixtures includes every group fixture with its real round', () => {
  const list = playableFixtures(makeLeague());
  assert.equal(list.length, fixtures.length);
  const first = list.find((f) => f.id === 'A-R1-M1');
  assert.deepEqual(first, { id: 'A-R1-M1', stage: 'group', round: 1, p1: 'mirza', p2: 'tolga' });
});

test('playableFixtures omits playoff fixtures until both groups are complete', () => {
  const list = playableFixtures(makeLeague());
  assert.equal(list.some((f) => f.stage === 'playoff'), false);
});

test('findOpenFixture returns the lower-numbered round when both orientations are unplayed', () => {
  const result = findOpenFixture(makeLeague(), 'mirza', 'tolga');
  assert.equal(result.ok, true);
  assert.equal(result.fixture.id, 'A-R1-M1');
});

test('findOpenFixture works from either order of the two players', () => {
  const result = findOpenFixture(makeLeague(), 'tolga', 'mirza');
  assert.equal(result.ok, true);
  assert.equal(result.fixture.id, 'A-R1-M1');
});

test('after recording the first fixture, findOpenFixture returns the other orientation', () => {
  const league = makeLeague([
    { fixtureId: 'A-R1-M1', p1Games: 3, p2Games: 1, reportedBy: 'x', reportedAt: 'y' },
  ]);
  const result = findOpenFixture(league, 'mirza', 'tolga');
  assert.equal(result.ok, true);
  assert.equal(result.fixture.id, 'A-R4-M1');
});

test('findOpenFixture reports ALL_PLAYED once both orientations are recorded', () => {
  const league = makeLeague([
    { fixtureId: 'A-R1-M1', p1Games: 3, p2Games: 1, reportedBy: 'x', reportedAt: 'y' },
    { fixtureId: 'A-R4-M1', p1Games: 1, p2Games: 3, reportedBy: 'x', reportedAt: 'y' },
  ]);
  const result = findOpenFixture(league, 'mirza', 'tolga');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ALL_PLAYED');
  const byId = Object.fromEntries(result.played.map((p) => [p.fixtureId, p]));
  assert.deepEqual(byId['A-R1-M1'], { fixtureId: 'A-R1-M1', p1: 'mirza', p2: 'tolga', p1Games: 3, p2Games: 1 });
  assert.deepEqual(byId['A-R4-M1'], { fixtureId: 'A-R4-M1', p1: 'tolga', p2: 'mirza', p1Games: 1, p2Games: 3 });
});

test('findOpenFixture reports NO_PAIRING for players in different groups with no resolved playoff match', () => {
  const result = findOpenFixture(makeLeague(), 'mirza', 'emre-k');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_PAIRING');
  assert.deepEqual(result.played, []);
});

test('orientResult places the reporter\'s games on their own slot', () => {
  const fixture = { id: 'A-R1-M1', p1: 'mirza', p2: 'tolga' };
  assert.deepEqual(orientResult(fixture, 'mirza', 3, 1), { p1Games: 3, p2Games: 1 });
  assert.deepEqual(orientResult(fixture, 'tolga', 3, 1), { p1Games: 1, p2Games: 3 });
});

test('orientResult throws for a reporter who is not part of the fixture', () => {
  const fixture = { id: 'A-R1-M1', p1: 'mirza', p2: 'tolga' };
  assert.throws(() => orientResult(fixture, 'emre-b', 3, 1), /A-R1-M1/);
});

// This is the whole point of the module: the same human input ("I won 3-1")
// reported against the two opposite-orientation fixtures of the same pair
// must produce MIRRORED stored results, not identical ones.
test('orientResult mirrors output across the two opposite-orientation fixtures of a pair', () => {
  const forward = fixtures.find((f) => f.id === 'A-R1-M1'); // p1: mirza, p2: tolga
  const reverse = fixtures.find((f) => f.id === 'A-R4-M1'); // p1: tolga, p2: mirza

  // Mirza reports "I won 3-1" against both fixtures — identical reporter input.
  const storedForward = orientResult(forward, 'mirza', 3, 1);
  const storedReverse = orientResult(reverse, 'mirza', 3, 1);

  assert.deepEqual(storedForward, { p1Games: 3, p2Games: 1 });
  assert.deepEqual(storedReverse, { p1Games: 1, p2Games: 3 });
  assert.notDeepEqual(storedForward, storedReverse);
});

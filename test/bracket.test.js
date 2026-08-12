import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYOFF_FIXTURES, isGroupComplete, resolveBracket } from '../lib/bracket.js';
import { generateGroupFixtures } from '../lib/schedule.js';
import { computeTable } from '../lib/standings.js';

const RULES = { pointsWin: 3, pointsLoss: 0 };
const SEED = 20260810;
// Six and five, matching the real league, so A4 and B3 exist.
const GROUP_A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const GROUP_B = ['b1', 'b2', 'b3', 'b4', 'b5'];

const fixtures = [
  ...generateGroupFixtures('A', GROUP_A),
  ...generateGroupFixtures('B', GROUP_B),
];

/** Every group fixture decided in favour of whoever sorts first. */
const completeAllGroups = () => fixtures
  .filter((f) => f.stage === 'group')
  .map((f) => ({
    fixtureId: f.id,
    p1Games: f.p1 < f.p2 ? 3 : 0,
    p2Games: f.p1 < f.p2 ? 0 : 3,
  }));

const tablesFrom = (results) => ({
  A: computeTable(GROUP_A, fixtures, results, RULES, SEED),
  B: computeTable(GROUP_B, fixtures, results, RULES, SEED),
});

const byId = (bracket) => Object.fromEntries(bracket.map((m) => [m.id, m]));

test('the bracket has eight matches across four phases', () => {
  assert.equal(PLAYOFF_FIXTURES.length, 8);
  assert.deepEqual(PLAYOFF_FIXTURES.map((f) => f.id),
    ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'FINAL', 'THIRD']);
  assert.deepEqual([...new Set(PLAYOFF_FIXTURES.map((f) => f.phase))],
    ['Quarter-finals', 'Semi-finals', 'Final']);
});

test('no playoff fixture carries a numeric round key', () => {
  // `round` is the group-stage round number; playoff fixtures must not shadow it.
  for (const fixture of PLAYOFF_FIXTURES) {
    assert.equal('round' in fixture, false, fixture.id);
  }
});

test('seeding is 1v8, 4v5, 3v6, 2v7 with the CEO unseeded at eight', () => {
  const slots = Object.fromEntries(PLAYOFF_FIXTURES.map((f) => [f.id, [f.slotP1, f.slotP2]]));
  assert.deepEqual(slots.QF1, ['A1', '@tugkan']);
  assert.deepEqual(slots.QF2, ['B2', 'A3']);
  assert.deepEqual(slots.QF3, ['A2', 'B3']);
  assert.deepEqual(slots.QF4, ['B1', 'A4']);
  assert.deepEqual(slots.SF1, ['W-QF1', 'W-QF2']);
  assert.deepEqual(slots.SF2, ['W-QF3', 'W-QF4']);
  assert.deepEqual(slots.FINAL, ['W-SF1', 'W-SF2']);
  assert.deepEqual(slots.THIRD, ['L-SF1', 'L-SF2']);
});

test('no quarter-final pairs two players from the same group', () => {
  const group = (slot) => (slot.startsWith('@') ? 'CEO' : slot[0]);
  for (const fixture of PLAYOFF_FIXTURES.filter((f) => f.id.startsWith('QF'))) {
    assert.notEqual(group(fixture.slotP1), group(fixture.slotP2), fixture.id);
  }
});

test('the bracket definition cannot be mutated by a consumer', () => {
  assert.throws(() => { PLAYOFF_FIXTURES[0].slotP1 = 'X'; }, TypeError);
  assert.throws(() => { PLAYOFF_FIXTURES.push({ id: 'EXTRA' }); }, TypeError);
});

test('a group is incomplete until every one of its fixtures has a result', () => {
  const all = completeAllGroups();
  const missingOneFromA = all.slice(1);
  assert.equal(isGroupComplete('A', fixtures, []), false);
  assert.equal(isGroupComplete('A', fixtures, missingOneFromA), false);
  assert.equal(isGroupComplete('B', fixtures, missingOneFromA), true);
  assert.equal(isGroupComplete('A', fixtures, all), true);
});

test('a group with no fixtures is not complete', () => {
  assert.equal(isGroupComplete('A', [], []), false);
  assert.equal(isGroupComplete('NOPE', fixtures, completeAllGroups()), false);
});

test('the fixed CEO entrant resolves before any group is played', () => {
  // He plays no group stage, so nothing gates him.
  const bracket = byId(resolveBracket(tablesFrom([]), fixtures, []));
  assert.equal(bracket.QF1.p2, 'tugkan');
  assert.equal(bracket.QF1.p1, null, 'A1 must still be unresolved');
});

test('group slots stay null until their group is complete', () => {
  const bracket = byId(resolveBracket(tablesFrom([]), fixtures, []));
  for (const id of ['QF2', 'QF3', 'QF4']) {
    assert.equal(bracket[id].p1, null, id);
    assert.equal(bracket[id].p2, null, id);
  }
});

test('all four quarter-finals fill once both groups are complete', () => {
  const results = completeAllGroups();
  const tables = tablesFrom(results);
  const bracket = byId(resolveBracket(tables, fixtures, results));

  assert.equal(bracket.QF1.p1, tables.A[0].playerId);
  assert.equal(bracket.QF1.p2, 'tugkan');
  assert.equal(bracket.QF2.p1, tables.B[1].playerId);
  assert.equal(bracket.QF2.p2, tables.A[2].playerId);
  assert.equal(bracket.QF3.p1, tables.A[1].playerId);
  assert.equal(bracket.QF3.p2, tables.B[2].playerId);
  assert.equal(bracket.QF4.p1, tables.B[0].playerId);
  assert.equal(bracket.QF4.p2, tables.A[3].playerId);
});

test('the eight entrants are the seven qualifiers plus the CEO, all distinct', () => {
  const results = completeAllGroups();
  const bracket = resolveBracket(tablesFrom(results), fixtures, results);
  const entrants = bracket
    .filter((m) => m.id.startsWith('QF'))
    .flatMap((m) => [m.p1, m.p2]);
  assert.equal(entrants.length, 8);
  assert.equal(new Set(entrants).size, 8, 'a player must not appear twice');
  assert.ok(entrants.includes('tugkan'));
});

test('semi-finals wait for quarter-final results', () => {
  const results = completeAllGroups();
  const bracket = byId(resolveBracket(tablesFrom(results), fixtures, results));
  assert.equal(bracket.SF1.p1, null);
  assert.equal(bracket.SF2.p1, null);
  assert.equal(bracket.FINAL.p1, null);
  assert.equal(bracket.THIRD.p1, null);
});

test('quarter-final winners advance to the semi-finals', () => {
  const groupResults = completeAllGroups();
  const tables = tablesFrom(groupResults);
  const seeded = byId(resolveBracket(tables, fixtures, groupResults));

  const results = [...groupResults,
    { fixtureId: 'QF1', p1Games: 3, p2Games: 1 },   // QF1 p1 wins
    { fixtureId: 'QF2', p1Games: 1, p2Games: 3 },   // QF2 p2 wins
    { fixtureId: 'QF3', p1Games: 3, p2Games: 0 },   // QF3 p1 wins
    { fixtureId: 'QF4', p1Games: 0, p2Games: 3 },   // QF4 p2 wins
  ];
  const bracket = byId(resolveBracket(tables, fixtures, results));
  assert.deepEqual([bracket.SF1.p1, bracket.SF1.p2], [seeded.QF1.p1, seeded.QF2.p2]);
  assert.deepEqual([bracket.SF2.p1, bracket.SF2.p2], [seeded.QF3.p1, seeded.QF4.p2]);
});

test('the final and third place resolve two rounds deep', () => {
  const groupResults = completeAllGroups();
  const tables = tablesFrom(groupResults);
  const withQfs = [...groupResults,
    { fixtureId: 'QF1', p1Games: 3, p2Games: 1 },
    { fixtureId: 'QF2', p1Games: 3, p2Games: 1 },
    { fixtureId: 'QF3', p1Games: 3, p2Games: 1 },
    { fixtureId: 'QF4', p1Games: 3, p2Games: 1 },
  ];
  const semis = byId(resolveBracket(tables, fixtures, withQfs));

  const results = [...withQfs,
    { fixtureId: 'SF1', p1Games: 3, p2Games: 2 },   // SF1 p1 wins
    { fixtureId: 'SF2', p1Games: 2, p2Games: 3 },   // SF2 p2 wins
  ];
  const bracket = byId(resolveBracket(tables, fixtures, results));
  assert.deepEqual([bracket.FINAL.p1, bracket.FINAL.p2], [semis.SF1.p1, semis.SF2.p2]);
  assert.deepEqual([bracket.THIRD.p1, bracket.THIRD.p2], [semis.SF1.p2, semis.SF2.p1]);
});

test('a played playoff match carries its result', () => {
  const results = [...completeAllGroups(), { fixtureId: 'QF1', p1Games: 3, p2Games: 0 }];
  const bracket = byId(resolveBracket(tablesFrom(results), fixtures, results));
  assert.deepEqual(bracket.QF1.result, { fixtureId: 'QF1', p1Games: 3, p2Games: 0 });
});

test('a semi-final result with unresolved players does not resolve downstream', () => {
  // A stray SF result before the groups finish must not invent a finalist.
  const results = [{ fixtureId: 'SF1', p1Games: 3, p2Games: 0 }];
  const bracket = byId(resolveBracket(tablesFrom(results), fixtures, results));
  assert.equal(bracket.FINAL.p1, null);
});

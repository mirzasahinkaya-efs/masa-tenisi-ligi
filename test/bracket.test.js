import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYOFF_FIXTURES, isGroupComplete, resolveBracket } from '../lib/bracket.js';
import { generateGroupFixtures } from '../lib/schedule.js';
import { computeTable } from '../lib/standings.js';

const RULES = { pointsWin: 3, pointsLoss: 0 };
const SEED = 20260810;
const GROUP_A = ['a1', 'a2', 'a3'];
const GROUP_B = ['b1', 'b2', 'b3'];

const fixtures = [
  ...generateGroupFixtures('A', GROUP_A),
  ...generateGroupFixtures('B', GROUP_B),
];

/** Give every group fixture a 3-0 win to whoever sorts first. */
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

test('the bracket has four matches with cross-group semifinals', () => {
  assert.equal(PLAYOFF_FIXTURES.length, 4);
  const byId = Object.fromEntries(PLAYOFF_FIXTURES.map((f) => [f.id, f]));
  assert.deepEqual([byId.SF1.slotP1, byId.SF1.slotP2], ['A1', 'B2']);
  assert.deepEqual([byId.SF2.slotP1, byId.SF2.slotP2], ['B1', 'A2']);
  assert.deepEqual([byId.FINAL.slotP1, byId.FINAL.slotP2], ['W-SF1', 'W-SF2']);
  assert.deepEqual([byId.THIRD.slotP1, byId.THIRD.slotP2], ['L-SF1', 'L-SF2']);
});

test('a group is incomplete until every one of its fixtures has a result', () => {
  const all = completeAllGroups();
  // Group A's results come first, so dropping the first one leaves A short
  // while B stays complete.
  const missingOneFromA = all.slice(1);
  assert.equal(isGroupComplete('A', fixtures, []), false);
  assert.equal(isGroupComplete('A', fixtures, missingOneFromA), false);
  assert.equal(isGroupComplete('B', fixtures, missingOneFromA), true);
  assert.equal(isGroupComplete('A', fixtures, all), true);
});

test('slots stay null while the groups are unfinished', () => {
  const bracket = resolveBracket(tablesFrom([]), fixtures, []);
  for (const match of bracket) {
    assert.equal(match.p1, null, match.id);
    assert.equal(match.p2, null, match.id);
    assert.equal(match.result, null, match.id);
  }
});

test('semifinal slots fill in once both groups are complete', () => {
  const results = completeAllGroups();
  const tables = tablesFrom(results);
  const bracket = resolveBracket(tables, fixtures, results);
  const byId = Object.fromEntries(bracket.map((m) => [m.id, m]));

  assert.equal(byId.SF1.p1, tables.A[0].playerId);
  assert.equal(byId.SF1.p2, tables.B[1].playerId);
  assert.equal(byId.SF2.p1, tables.B[0].playerId);
  assert.equal(byId.SF2.p2, tables.A[1].playerId);
});

test('the final and third-place match wait for semifinal results', () => {
  const results = completeAllGroups();
  const bracket = resolveBracket(tablesFrom(results), fixtures, results);
  const byId = Object.fromEntries(bracket.map((m) => [m.id, m]));
  assert.equal(byId.FINAL.p1, null);
  assert.equal(byId.THIRD.p1, null);
});

test('semifinal winners advance and losers drop to the third-place match', () => {
  const results = completeAllGroups();
  const tables = tablesFrom(results);
  const seeded = resolveBracket(tables, fixtures, results);
  const sf1 = seeded.find((m) => m.id === 'SF1');
  const sf2 = seeded.find((m) => m.id === 'SF2');

  const withSemis = [
    ...results,
    { fixtureId: 'SF1', p1Games: 3, p2Games: 1 },  // sf1.p1 wins
    { fixtureId: 'SF2', p1Games: 1, p2Games: 3 },  // sf2.p2 wins
  ];
  const bracket = resolveBracket(tables, fixtures, withSemis);
  const byId = Object.fromEntries(bracket.map((m) => [m.id, m]));

  assert.deepEqual([byId.FINAL.p1, byId.FINAL.p2], [sf1.p1, sf2.p2]);
  assert.deepEqual([byId.THIRD.p1, byId.THIRD.p2], [sf1.p2, sf2.p1]);
});

test('a played playoff match carries its result', () => {
  const results = [...completeAllGroups(), { fixtureId: 'SF1', p1Games: 3, p2Games: 0 }];
  const bracket = resolveBracket(tablesFrom(results), fixtures, results);
  assert.deepEqual(
    bracket.find((m) => m.id === 'SF1').result,
    { fixtureId: 'SF1', p1Games: 3, p2Games: 0 },
  );
});

test('the bracket definition cannot be mutated by a consumer', () => {
  const before = PLAYOFF_FIXTURES[0].slotP1;
  assert.throws(() => { PLAYOFF_FIXTURES[0].slotP1 = 'MUTATED'; }, TypeError);
  assert.throws(() => { PLAYOFF_FIXTURES.push({ id: 'EXTRA' }); }, TypeError);
  assert.equal(PLAYOFF_FIXTURES[0].slotP1, before);
});

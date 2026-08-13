import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYOFF_FIXTURES, QUALIFY_PER_GROUP, bestFourthPlayerId, isGroupComplete, resolveBracket,
} from '../lib/bracket.js';
import { generateGroupFixtures } from '../lib/schedule.js';
import { computeTable } from '../lib/standings.js';

const RULES = { pointsWin: 3, pointsLoss: 0 };
const SEED = 20260810;
// Six and six, matching the real league, so both groups have a fourth place.
const GROUP_A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const GROUP_B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];

const fixtures = [
  ...generateGroupFixtures('A', GROUP_A),
  ...generateGroupFixtures('B', GROUP_B),
];

/** Every group fixture decided in favour of whoever sorts first. */
const completeAllGroups = () => fixtures
  .filter((f) => f.stage === 'group')
  .map((f) => ({
    fixtureId: f.id,
    p1Games: f.p1 < f.p2 ? 2 : 0,
    p2Games: f.p1 < f.p2 ? 0 : 2,
  }));

const tablesFrom = (results) => ({
  A: computeTable(GROUP_A, fixtures, results, RULES, SEED),
  B: computeTable(GROUP_B, fixtures, results, RULES, SEED),
});

const resolve = (tables, fixtureList, results) =>
  resolveBracket(tables, fixtureList, results, { drawSeed: SEED });

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

test('the bracket pairs three from each group with the best fourth and the CEO', () => {
  const slots = Object.fromEntries(PLAYOFF_FIXTURES.map((f) => [f.id, [f.slotP1, f.slotP2]]));
  assert.deepEqual(slots.QF1, ['A1', 'B3']);
  assert.deepEqual(slots.QF2, ['@tugkan', 'BEST4']);
  assert.deepEqual(slots.QF3, ['B1', 'A3']);
  assert.deepEqual(slots.QF4, ['A2', 'B2']);
  assert.deepEqual(slots.SF1, ['W-QF1', 'W-QF2']);
  assert.deepEqual(slots.SF2, ['W-QF3', 'W-QF4']);
  assert.deepEqual(slots.FINAL, ['W-SF1', 'W-SF2']);
  assert.deepEqual(slots.THIRD, ['L-SF1', 'L-SF2']);

  const groupSlots = PLAYOFF_FIXTURES
    .filter((f) => f.id.startsWith('QF'))
    .flatMap((f) => [f.slotP1, f.slotP2])
    .filter((slot) => /^[AB][1-9]$/.test(slot))
    .sort();
  assert.deepEqual(groupSlots, ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'],
    `exactly ${QUALIFY_PER_GROUP} places per group qualify outright`);
});

test('no quarter-final can be a rematch', () => {
  // BEST4 can come from either group, so the only pairing that is safe for it is
  // the CEO, who belongs to no group. Note the naive `slot[0]` reading of a
  // group letter says 'B' for BEST4, which would make this pass by accident.
  const group = (slot) => {
    if (slot === 'BEST4') return 'either';
    if (slot.startsWith('@')) return 'none';
    return slot[0];
  };
  for (const fixture of PLAYOFF_FIXTURES.filter((f) => f.id.startsWith('QF'))) {
    const sides = [group(fixture.slotP1), group(fixture.slotP2)];
    if (sides.includes('either')) {
      assert.ok(sides.includes('none'),
        `${fixture.id} pairs BEST4 with ${sides.join(' v ')}, which could be its own group`);
    } else {
      assert.notEqual(sides[0], sides[1], fixture.id);
    }
  }
});

test('the two group winners can only meet in the final', () => {
  const half = (qf) => (['QF1', 'QF2'].includes(qf) ? 1 : 2);
  const halfOf = (slot) => {
    const qf = PLAYOFF_FIXTURES.find(
      (f) => f.id.startsWith('QF') && [f.slotP1, f.slotP2].includes(slot),
    );
    return half(qf.id);
  };
  assert.notEqual(halfOf('A1'), halfOf('B1'),
    'winning your group must not risk a semi-final against the other winner');
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
  const bracket = byId(resolve(tablesFrom([]), fixtures, []));
  assert.equal(bracket.QF2.p1, 'tugkan');
  assert.equal(bracket.QF2.p2, null, 'BEST4 must still be unresolved');
});

test('group slots stay null until their group is complete', () => {
  const bracket = byId(resolve(tablesFrom([]), fixtures, []));
  for (const [id, side] of [['QF1', 'p1'], ['QF1', 'p2'], ['QF3', 'p1'], ['QF3', 'p2'],
    ['QF4', 'p1'], ['QF4', 'p2'], ['QF2', 'p2']]) {
    assert.equal(bracket[id][side], null, `${id}.${side}`);
  }
});

test('the best fourth waits for EVERY group, not just its own', () => {
  // Group B is finished, A is not. B's fourth place cannot be declared better
  // than a fourth place that does not exist yet.
  const all = completeAllGroups();
  const bWithoutA = all.filter((r) => r.fixtureId.startsWith('B-'));
  assert.equal(isGroupComplete('B', fixtures, bWithoutA), true);
  assert.equal(isGroupComplete('A', fixtures, bWithoutA), false);

  const bracket = byId(resolve(tablesFrom(bWithoutA), fixtures, bWithoutA));
  assert.equal(bracket.QF2.p2, null, 'BEST4 resolved from one finished group');
  assert.equal(bracket.QF4.p2, tablesFrom(bWithoutA).B[1].playerId, 'B2 should be resolved');
});

test('all four quarter-finals fill once both groups are complete', () => {
  const results = completeAllGroups();
  const tables = tablesFrom(results);
  const bracket = byId(resolve(tables, fixtures, results));

  assert.equal(bracket.QF1.p1, tables.A[0].playerId);
  assert.equal(bracket.QF1.p2, tables.B[2].playerId);
  assert.equal(bracket.QF2.p1, 'tugkan');
  assert.equal(bracket.QF3.p1, tables.B[0].playerId);
  assert.equal(bracket.QF3.p2, tables.A[2].playerId);
  assert.equal(bracket.QF4.p1, tables.A[1].playerId);
  assert.equal(bracket.QF4.p2, tables.B[1].playerId);

  // The seventh place is one of the two fourths, and the other one is out.
  const fourths = [tables.A[3].playerId, tables.B[3].playerId];
  assert.ok(fourths.includes(bracket.QF2.p2), `BEST4 was ${bracket.QF2.p2}`);
  const entrants = new Set(bracket.QF1 && Object.values(bracket)
    .filter((m) => m.id.startsWith('QF')).flatMap((m) => [m.p1, m.p2]));
  const excluded = fourths.find((id) => id !== bracket.QF2.p2);
  assert.equal(entrants.has(excluded), false, `${excluded} should have missed out`);
});

test('nobody below fourth place reaches the bracket', () => {
  // Deliberately a literal 4 rather than QUALIFY_PER_GROUP + 1: deriving the
  // bound from the same constant under test would make this unable to notice
  // that constant being wrong, which is exactly the bug it should catch.
  const results = completeAllGroups();
  const tables = tablesFrom(results);
  const bracket = resolve(tables, fixtures, results);
  const entrants = new Set(
    bracket.filter((m) => m.id.startsWith('QF')).flatMap((m) => [m.p1, m.p2]),
  );
  for (const table of Object.values(tables)) {
    for (const row of table.filter((r) => r.position > 4)) {
      assert.equal(entrants.has(row.playerId), false, `${row.playerId} finished ${row.position}`);
    }
  }
});

test('exactly three per group qualify outright', () => {
  // Pins the constant against the bracket definition, which names A1-A3/B1-B3.
  assert.equal(QUALIFY_PER_GROUP, 3);
});

test('the eight entrants are the seven qualifiers plus the CEO, all distinct', () => {
  const results = completeAllGroups();
  const bracket = resolve(tablesFrom(results), fixtures, results);
  const entrants = bracket
    .filter((m) => m.id.startsWith('QF'))
    .flatMap((m) => [m.p1, m.p2]);
  assert.equal(entrants.length, 8);
  assert.equal(new Set(entrants).size, 8, 'a player must not appear twice');
  assert.ok(entrants.includes('tugkan'));
});

test('semi-finals wait for quarter-final results', () => {
  const results = completeAllGroups();
  const bracket = byId(resolve(tablesFrom(results), fixtures, results));
  assert.equal(bracket.SF1.p1, null);
  assert.equal(bracket.SF2.p1, null);
  assert.equal(bracket.FINAL.p1, null);
  assert.equal(bracket.THIRD.p1, null);
});

test('quarter-final winners advance to the semi-finals', () => {
  const groupResults = completeAllGroups();
  const tables = tablesFrom(groupResults);
  const seeded = byId(resolve(tables, fixtures, groupResults));

  const results = [...groupResults,
    { fixtureId: 'QF1', p1Games: 2, p2Games: 1 },   // QF1 p1 wins
    { fixtureId: 'QF2', p1Games: 1, p2Games: 2 },   // QF2 p2 wins
    { fixtureId: 'QF3', p1Games: 2, p2Games: 0 },   // QF3 p1 wins
    { fixtureId: 'QF4', p1Games: 0, p2Games: 2 },   // QF4 p2 wins
  ];
  const bracket = byId(resolve(tables, fixtures, results));
  assert.deepEqual([bracket.SF1.p1, bracket.SF1.p2], [seeded.QF1.p1, seeded.QF2.p2]);
  assert.deepEqual([bracket.SF2.p1, bracket.SF2.p2], [seeded.QF3.p1, seeded.QF4.p2]);
});

test('the final and third place resolve two rounds deep', () => {
  const groupResults = completeAllGroups();
  const tables = tablesFrom(groupResults);
  const withQfs = [...groupResults,
    { fixtureId: 'QF1', p1Games: 2, p2Games: 1 },
    { fixtureId: 'QF2', p1Games: 2, p2Games: 1 },
    { fixtureId: 'QF3', p1Games: 2, p2Games: 1 },
    { fixtureId: 'QF4', p1Games: 2, p2Games: 1 },
  ];
  const semis = byId(resolve(tables, fixtures, withQfs));

  const results = [...withQfs,
    { fixtureId: 'SF1', p1Games: 2, p2Games: 1 },   // SF1 p1 wins
    { fixtureId: 'SF2', p1Games: 1, p2Games: 2 },   // SF2 p2 wins
  ];
  const bracket = byId(resolve(tables, fixtures, results));
  assert.deepEqual([bracket.FINAL.p1, bracket.FINAL.p2], [semis.SF1.p1, semis.SF2.p2]);
  assert.deepEqual([bracket.THIRD.p1, bracket.THIRD.p2], [semis.SF1.p2, semis.SF2.p1]);
});

test('a played playoff match carries its result', () => {
  const results = [...completeAllGroups(), { fixtureId: 'QF1', p1Games: 2, p2Games: 0 }];
  const bracket = byId(resolve(tablesFrom(results), fixtures, results));
  assert.deepEqual(bracket.QF1.result, { fixtureId: 'QF1', p1Games: 2, p2Games: 0 });
});

// --- the cross-group fourth place, in isolation ---

const row = (playerId, points, gameDiff, gamesWon) => ({ playerId, points, gameDiff, gamesWon });
/** A table whose only interesting row is the fourth one. */
const tableWith = (prefix, fourth) => [
  row(`${prefix}-1st`, 99, 99, 99),
  row(`${prefix}-2nd`, 98, 98, 98),
  row(`${prefix}-3rd`, 97, 97, 97),
  fourth,
];

test('the fourth place with more points takes the slot', () => {
  const tables = {
    A: tableWith('a', row('a4', 9, -2, 20)),
    B: tableWith('b', row('b4', 12, -8, 14)),
  };
  assert.equal(bestFourthPlayerId(tables, SEED), 'b4');
});

test('level on points, game difference decides', () => {
  const tables = {
    A: tableWith('a', row('a4', 9, 3, 14)),
    B: tableWith('b', row('b4', 9, -1, 30)),
  };
  assert.equal(bestFourthPlayerId(tables, SEED), 'a4');
});

test('level on points and game difference, games won decides', () => {
  const tables = {
    A: tableWith('a', row('a4', 9, 0, 15)),
    B: tableWith('b', row('b4', 9, 0, 18)),
  };
  assert.equal(bestFourthPlayerId(tables, SEED), 'b4');
});

test('a dead heat is broken by the seeded draw, not by group order', () => {
  // The order-independence property the group tables also hold: which group is
  // iterated first must not decide who goes through.
  const a4 = row('a4', 9, 0, 15);
  const b4 = row('b4', 9, 0, 15);
  const forwards = { A: tableWith('a', a4), B: tableWith('b', b4) };
  const backwards = { B: tableWith('b', b4), A: tableWith('a', a4) };

  const winner = bestFourthPlayerId(forwards, SEED);
  assert.ok(['a4', 'b4'].includes(winner));
  assert.equal(bestFourthPlayerId(backwards, SEED), winner);
  assert.equal(bestFourthPlayerId(forwards, SEED), winner, 'and it is stable across calls');
});

test('with no seed it still answers deterministically', () => {
  const tables = {
    A: tableWith('a', row('a4', 9, 0, 15)),
    B: tableWith('b', row('b4', 9, 0, 15)),
  };
  for (const seed of [undefined, null, NaN, 'nope']) {
    assert.equal(bestFourthPlayerId(tables, seed), 'a4', String(seed));
  }
});

test('a group with no fourth place leaves the slot empty', () => {
  const three = [row('x1', 9, 0, 9), row('x2', 6, 0, 6), row('x3', 3, 0, 3)];
  assert.equal(bestFourthPlayerId({ A: three, B: tableWith('b', row('b4', 9, 0, 9)) }, SEED), null);
  assert.equal(bestFourthPlayerId({ A: three, B: three }, SEED), null);
  assert.equal(bestFourthPlayerId({}, SEED), null);
  assert.equal(bestFourthPlayerId({ A: [] }, SEED), null);
});

test('a semi-final result with unresolved players does not resolve downstream', () => {
  // A stray SF result before the groups finish must not invent a finalist.
  const results = [{ fixtureId: 'SF1', p1Games: 2, p2Games: 0 }];
  const bracket = byId(resolve(tablesFrom(results), fixtures, results));
  assert.equal(bracket.FINAL.p1, null);
});

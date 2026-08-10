import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accumulate, computeTable } from '../lib/standings.js';
import { generateGroupFixtures } from '../lib/schedule.js';

const RULES = { pointsWin: 3, pointsLoss: 0 };
const SEED = 4;

/** Two fixtures per pair, so results can be attached by fixture id. */
const fixtures = generateGroupFixtures('A', ['a', 'b', 'c', 'd']);
const find = (p1, p2) => fixtures.find((f) => f.p1 === p1 && f.p2 === p2).id;
const beat = (winner, loser, loserGames = 1) => {
  const forward = fixtures.find((f) => f.p1 === winner && f.p2 === loser);
  return { fixtureId: forward.id, p1Games: 3, p2Games: loserGames };
};

test('an empty group produces a full table of zeroes', () => {
  const table = computeTable(['a', 'b', 'c', 'd'], fixtures, [], RULES, SEED);
  assert.equal(table.length, 4);
  for (const row of table) {
    assert.equal(row.played, 0);
    assert.equal(row.points, 0);
    assert.equal(row.gameDiff, 0);
  }
  assert.deepEqual(table.map((r) => r.position), [1, 2, 3, 4]);
});

test('a win awards three points and a loss none', () => {
  const rows = accumulate(['a', 'b'], fixtures, [beat('a', 'b', 1)], RULES);
  assert.equal(rows.get('a').points, 3);
  assert.equal(rows.get('a').won, 1);
  assert.equal(rows.get('b').points, 0);
  assert.equal(rows.get('b').lost, 1);
});

test('games won and lost accumulate from both sides of a fixture', () => {
  const rows = accumulate(['a', 'b'], fixtures, [beat('a', 'b', 2)], RULES);
  assert.equal(rows.get('a').gamesWon, 3);
  assert.equal(rows.get('a').gamesLost, 2);
  assert.equal(rows.get('a').gameDiff, 1);
  assert.equal(rows.get('b').gameDiff, -1);
});

test('results for unknown fixtures are ignored', () => {
  const rows = accumulate(['a', 'b'], fixtures, [
    { fixtureId: 'NOPE-R1-M1', p1Games: 3, p2Games: 0 },
  ], RULES);
  assert.equal(rows.get('a').played, 0);
});

test('players are ordered by points descending', () => {
  const table = computeTable(['a', 'b', 'c', 'd'], fixtures, [
    beat('a', 'b'), beat('a', 'c'), beat('b', 'c'),
  ], RULES, SEED);
  assert.deepEqual(table.map((r) => r.playerId), ['a', 'b', 'd', 'c']);
});

test('head-to-head breaks a tie on points', () => {
  // a and b both win once; b beat a, so b places first.
  const table = computeTable(['a', 'b', 'c', 'd'], fixtures, [
    { fixtureId: find('b', 'a'), p1Games: 3, p2Games: 0 },
    beat('a', 'c'),
  ], RULES, SEED);
  const order = table.map((r) => r.playerId);
  assert.ok(order.indexOf('b') < order.indexOf('a'), order.join(','));
});

test('game difference breaks a tie when head-to-head is level', () => {
  // a and b each beat c and d; they have not met. a wins by more games.
  const table = computeTable(['a', 'b', 'c', 'd'], fixtures, [
    { fixtureId: find('a', 'c'), p1Games: 3, p2Games: 0 },
    { fixtureId: find('a', 'd'), p1Games: 3, p2Games: 0 },
    { fixtureId: find('b', 'c'), p1Games: 3, p2Games: 2 },
    { fixtureId: find('b', 'd'), p1Games: 3, p2Games: 2 },
  ], RULES, SEED);
  const order = table.map((r) => r.playerId);
  assert.ok(order.indexOf('a') < order.indexOf('b'), order.join(','));
});

test('three-way ties are ordered by the mini-table among themselves', () => {
  // a beat b, b beat c, c beat a — all on 3 points. Head-to-head is level
  // at 3 each, so overall game difference decides.
  const table = computeTable(['a', 'b', 'c', 'd'], fixtures, [
    { fixtureId: find('a', 'b'), p1Games: 3, p2Games: 2 },
    { fixtureId: find('b', 'c'), p1Games: 3, p2Games: 1 },
    { fixtureId: find('c', 'a'), p1Games: 3, p2Games: 0 },
  ], RULES, SEED);
  const top = table.slice(0, 3).map((r) => r.playerId).sort();
  assert.deepEqual(top, ['a', 'b', 'c']);
  const order = table.map((r) => r.playerId);
  assert.ok(order.indexOf('c') < order.indexOf('a'), order.join(','));
});

test('ordering is deterministic when every tiebreak is level', () => {
  const args = [['a', 'b', 'c', 'd'], fixtures, [], RULES, SEED];
  assert.deepEqual(
    computeTable(...args).map((r) => r.playerId),
    computeTable(...args).map((r) => r.playerId),
  );
});

test('positions are sequential from one', () => {
  const table = computeTable(['a', 'b', 'c', 'd'], fixtures, [beat('a', 'b')], RULES, SEED);
  assert.deepEqual(table.map((r) => r.position), [1, 2, 3, 4]);
});

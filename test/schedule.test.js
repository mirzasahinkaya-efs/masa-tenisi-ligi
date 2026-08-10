import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleRounds, generateGroupFixtures } from '../lib/schedule.js';

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];
const FIVE = ['a', 'b', 'c', 'd', 'e'];

const pairKey = (x, y) => [x, y].sort().join('|');

test('six players give five rounds of three matches', () => {
  const rounds = circleRounds(SIX);
  assert.equal(rounds.length, 5);
  for (const round of rounds) assert.equal(round.length, 3);
});

test('five players give five rounds of two matches, one player idle', () => {
  const rounds = circleRounds(FIVE);
  assert.equal(rounds.length, 5);
  for (const round of rounds) assert.equal(round.length, 2);
});

test('the bye rotates so each of five players sits out exactly once', () => {
  const byes = circleRounds(FIVE).map((round) => {
    const playing = new Set(round.flat());
    return FIVE.filter((id) => !playing.has(id));
  });
  assert.deepEqual(byes.map((b) => b.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(byes.flat().sort(), [...FIVE].sort());
});

test('a single round-robin pairs every player with every other exactly once', () => {
  for (const ids of [SIX, FIVE]) {
    const seen = circleRounds(ids).flat().map(([x, y]) => pairKey(x, y));
    const expected = (ids.length * (ids.length - 1)) / 2;
    assert.equal(seen.length, expected);
    assert.equal(new Set(seen).size, expected);
  }
});

test('nobody is scheduled twice in the same round', () => {
  for (const ids of [SIX, FIVE]) {
    for (const round of circleRounds(ids)) {
      const players = round.flat();
      assert.equal(new Set(players).size, players.length);
    }
  }
});

test('a group of six yields thirty fixtures across ten rounds', () => {
  const fixtures = generateGroupFixtures('A', SIX);
  assert.equal(fixtures.length, 30);
  assert.deepEqual(
    [...new Set(fixtures.map((f) => f.round))].sort((x, y) => x - y),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test('a group of five yields twenty fixtures across ten rounds', () => {
  const fixtures = generateGroupFixtures('B', FIVE);
  assert.equal(fixtures.length, 20);
  assert.deepEqual(
    [...new Set(fixtures.map((f) => f.round))].sort((x, y) => x - y),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test('every pair meets exactly twice, once in each order', () => {
  for (const ids of [SIX, FIVE]) {
    const fixtures = generateGroupFixtures('A', ids);
    const counts = new Map();
    const ordered = new Set();
    for (const f of fixtures) {
      const key = pairKey(f.p1, f.p2);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      ordered.add(`${f.p1}>${f.p2}`);
    }
    for (const [key, count] of counts) assert.equal(count, 2, key);
    assert.equal(ordered.size, ids.length * (ids.length - 1));
  }
});

test('fixture ids are unique and follow the group-round-match form', () => {
  const fixtures = generateGroupFixtures('A', SIX);
  const ids = fixtures.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of fixtures) assert.match(f.id, /^A-R\d{1,2}-M\d$/);
});

test('every fixture carries its stage and group', () => {
  for (const f of generateGroupFixtures('B', FIVE)) {
    assert.equal(f.stage, 'group');
    assert.equal(f.group, 'B');
  }
});

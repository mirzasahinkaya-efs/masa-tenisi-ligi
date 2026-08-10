import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededShuffle } from '../lib/random.js';
import { drawGroups } from '../lib/draw.js';

const ELEVEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];

test('the same seed always produces the same groups', () => {
  const first = drawGroups(ELEVEN, 20260810);
  const second = drawGroups(ELEVEN, 20260810);
  assert.deepEqual(first, second);
});

test('a different seed produces a different arrangement', () => {
  const a = drawGroups(ELEVEN, 20260810);
  const b = drawGroups(ELEVEN, 99999999);
  assert.notDeepEqual(a, b);
});

test('groups are sized six and five', () => {
  const { A, B } = drawGroups(ELEVEN, 20260810);
  assert.equal(A.length, 6);
  assert.equal(B.length, 5);
});

test('every player is placed exactly once', () => {
  const { A, B } = drawGroups(ELEVEN, 20260810);
  assert.deepEqual([...A, ...B].sort(), [...ELEVEN].sort());
});

test('each group is returned in alphabetical order', () => {
  const { A, B } = drawGroups(ELEVEN, 20260810);
  assert.deepEqual(A, [...A].sort());
  assert.deepEqual(B, [...B].sort());
});

test('rejects a roster that does not match the group sizes', () => {
  assert.throws(() => drawGroups(['a', 'b'], 1, { A: 6, B: 5 }), /2 players.*11/);
});

test('group sizes follow the roster size', () => {
  const ten = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const { A, B } = drawGroups(ten, 20260810);
  assert.equal(A.length, 5);
  assert.equal(B.length, 5);
  const twelve = [...ten, 'k', 'l'];
  assert.equal(drawGroups(twelve, 20260810).A.length, 6);
  assert.equal(drawGroups(twelve, 20260810).B.length, 6);
});

test('shuffling preserves every member', () => {
  const shuffled = seededShuffle(ELEVEN, 7);
  assert.deepEqual([...shuffled].sort(), [...ELEVEN].sort());
  assert.notEqual(shuffled.join(), ELEVEN.join());
});

test('shuffling does not mutate its input', () => {
  const input = [...ELEVEN];
  seededShuffle(input, 7);
  assert.deepEqual(input, ELEVEN);
});

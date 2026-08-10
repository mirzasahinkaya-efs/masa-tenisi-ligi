import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScore } from '../lib/validate.js';

test('accepts every legal best-of-five score', () => {
  for (const [text, p1Games, p2Games] of [
    ['3-0', 3, 0], ['3-1', 3, 1], ['3-2', 3, 2],
    ['0-3', 0, 3], ['1-3', 1, 3], ['2-3', 2, 3],
  ]) {
    assert.deepEqual(parseScore(text), { ok: true, p1Games, p2Games }, text);
  }
});

test('tolerates spacing, en dashes and colons', () => {
  for (const text of ['3 - 1', '3–1', '3:1']) {
    assert.deepEqual(parseScore(text), { ok: true, p1Games: 3, p2Games: 1 }, text);
  }
});

test('rejects scores that cannot happen in a best-of-five', () => {
  for (const text of ['3-3', '2-1', '4-0', '5-2', '0-0', '2-2']) {
    assert.deepEqual(parseScore(text), { ok: false, error: 'ILLEGAL' }, text);
  }
});

test('rejects unparseable input', () => {
  for (const text of ['abc', '-1-3', '3', '', '3-', undefined, null]) {
    assert.deepEqual(parseScore(text), { ok: false, error: 'FORMAT' }, String(text));
  }
});

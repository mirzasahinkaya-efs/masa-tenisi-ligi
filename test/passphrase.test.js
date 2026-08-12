import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passphraseMatches } from '../lib/passphrase.js';

const REAL = 'kırmızı-raket-2026';

test('the exact passphrase matches', async () => {
  assert.equal(await passphraseMatches(REAL, REAL), true);
});

test('anything other than the exact passphrase does not match', async () => {
  for (const guess of [
    'kırmızı-raket-2025', 'kırmızı-raket', 'kırmızı-raket-2026 ', ' kırmızı-raket-2026',
    'KIRMIZI-RAKET-2026', 'kirmizi-raket-2026', REAL + 'x', '',
  ]) {
    assert.equal(await passphraseMatches(guess, REAL), false, JSON.stringify(guess));
  }
});

test('an unset passphrase cannot be guessed by submitting nothing', async () => {
  // The endpoint refuses a missing secret before reaching here, but a match on
  // '' would turn any future misconfiguration into an open door.
  for (const expected of ['', undefined, null]) {
    for (const supplied of ['', undefined, null, 'anything']) {
      assert.equal(await passphraseMatches(supplied, expected), false);
    }
  }
});

test('non-string input is refused rather than coerced', async () => {
  for (const supplied of [0, 1, {}, [], true, ['kırmızı-raket-2026']]) {
    assert.equal(await passphraseMatches(supplied, REAL), false, JSON.stringify(supplied));
  }
});

test('an object that stringifies to the passphrase does not match', async () => {
  assert.equal(await passphraseMatches({ toString: () => REAL }, REAL), false);
});

test('a multi-byte passphrase round-trips', async () => {
  const unicode = 'Şahinkaya-çğıöşü-🏓';
  assert.equal(await passphraseMatches(unicode, unicode), true);
  assert.equal(await passphraseMatches('Sahinkaya-cgiosu-🏓', unicode), false);
});

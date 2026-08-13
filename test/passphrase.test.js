import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passphraseMatches } from '../lib/passphrase.js';

const REAL = 'kırmızı-raket-2026';

test('the exact passphrase matches', async () => {
  assert.equal(await passphraseMatches(REAL, REAL), true);
});

test('anything other than the exact passphrase does not match', async () => {
  for (const guess of [
    'kırmızı-raket-2025', 'kırmızı-raket',
    'KIRMIZI-RAKET-2026', 'kirmizi-raket-2026', REAL + 'x', '',
  ]) {
    assert.equal(await passphraseMatches(guess, REAL), false, JSON.stringify(guess));
  }
});

test('surrounding whitespace is ignored on either side', async () => {
  // The case that made this necessary: `console.log | pbcopy` leaves a trailing
  // newline on the clipboard, so the SECRET ends up with one while the browser
  // form — a single-line input, which drops pasted newlines — sends it without.
  // Neither end can see the difference, so it has to not matter.
  for (const stored of [`${REAL}\n`, `${REAL}\r\n`, ` ${REAL} `, `\t${REAL}`]) {
    assert.equal(await passphraseMatches(REAL, stored), true, `stored ${JSON.stringify(stored)}`);
  }
  for (const guess of [`${REAL}\n`, ` ${REAL}`, `${REAL}  `]) {
    assert.equal(await passphraseMatches(guess, REAL), true, `sent ${JSON.stringify(guess)}`);
  }
});

test('whitespace inside the passphrase is still significant', async () => {
  // Trimming the ends must not turn into ignoring whitespace generally.
  const spaced = 'kırmızı raket 2026';
  assert.equal(await passphraseMatches('kırmızıraket2026', spaced), false);
  assert.equal(await passphraseMatches('kırmızı  raket 2026', spaced), false);
  assert.equal(await passphraseMatches(` ${spaced} `, spaced), true);
});

test('a whitespace-only secret cannot be guessed with whitespace', async () => {
  for (const secret of [' ', '\n', '\t\t', '  \r\n  ']) {
    for (const guess of ['', ' ', '\n', secret, 'anything']) {
      assert.equal(await passphraseMatches(guess, secret), false,
        `${JSON.stringify(guess)} vs ${JSON.stringify(secret)}`);
    }
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

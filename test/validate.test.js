import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  gamesToWinFor, matchFormatLabel, maxGamesToWin, parseScore,
} from '../lib/validate.js';

const BEST_OF_3 = { gamesToWin: 2 };
const BEST_OF_5 = { gamesToWin: 3 };

test('accepts every legal best-of-three score', () => {
  for (const [text, p1Games, p2Games] of [
    ['2-0', 2, 0], ['2-1', 2, 1],
    ['0-2', 0, 2], ['1-2', 1, 2],
  ]) {
    assert.deepEqual(parseScore(text, BEST_OF_3), { ok: true, p1Games, p2Games }, text);
  }
});

test('tolerates spacing, en dashes and colons', () => {
  for (const text of ['2 - 1', '2–1', '2:1', ' 2-1 ']) {
    assert.deepEqual(parseScore(text, BEST_OF_3), { ok: true, p1Games: 2, p2Games: 1 }, text);
  }
});

test('rejects scores that cannot happen in a best-of-three', () => {
  // '3-1' is here on purpose: it was legal under the old best-of-five format, so
  // it is the score most likely to be entered out of habit.
  for (const text of ['3-1', '3-0', '3-2', '2-2', '1-1', '0-0', '4-0', '2-3']) {
    assert.deepEqual(parseScore(text, BEST_OF_3), { ok: false, error: 'ILLEGAL' }, text);
  }
});

test('the same parser still handles best-of-five when told to', () => {
  // The rule is a parameter, not a fact about this function.
  for (const text of ['3-0', '3-1', '3-2', '1-3']) {
    assert.equal(parseScore(text, BEST_OF_5).ok, true, text);
  }
  assert.deepEqual(parseScore('2-1', BEST_OF_5), { ok: false, error: 'ILLEGAL' });
  assert.deepEqual(parseScore('2-1', BEST_OF_3), { ok: true, p1Games: 2, p2Games: 1 });
});

test('without the rule nothing is judged, and it is not called a bad score', () => {
  // A missing rule is a configuration fault. Reporting it as ILLEGAL would send
  // an operator hunting for a typo in a score that was fine.
  for (const options of [undefined, {}, { gamesToWin: 0 }, { gamesToWin: -1 },
    { gamesToWin: 2.5 }, { gamesToWin: '2' }, { gamesToWin: null }]) {
    assert.deepEqual(
      parseScore('2-1', options), { ok: false, error: 'NO_RULE' }, JSON.stringify(options),
    );
  }
  // Even a well-formed legal-looking score gets no pass without a rule.
  assert.deepEqual(parseScore('2-0'), { ok: false, error: 'NO_RULE' });
});

test('rejects unparseable input', () => {
  for (const text of ['abc', '-1-2', '2', '', '2-', undefined, null]) {
    assert.deepEqual(parseScore(text, BEST_OF_3), { ok: false, error: 'FORMAT' }, String(text));
  }
});

test('the format label describes the rule it is given', () => {
  assert.equal(matchFormatLabel(2), 'best-of-3');
  assert.equal(matchFormatLabel(3), 'best-of-5');
});

test('the rule is looked up by stage, and an unknown stage gets no answer', () => {
  const rules = { gamesToWin: { group: 2, playoff: 3 } };
  assert.equal(gamesToWinFor(rules, 'group'), 2);
  assert.equal(gamesToWinFor(rules, 'playoff'), 3);
  // No fallback on purpose: guessing here would validate a playoff result
  // against the group rule, which is the bug this shape exists to prevent.
  for (const stage of ['final', '', undefined, 'GROUP']) {
    assert.equal(gamesToWinFor(rules, stage), undefined, String(stage));
  }
  assert.equal(gamesToWinFor(undefined, 'group'), undefined);
  assert.equal(gamesToWinFor({}, 'group'), undefined);
});

test('the widest format is what the form offers', () => {
  assert.equal(maxGamesToWin({ gamesToWin: { group: 2, playoff: 3 } }), 3);
  assert.equal(maxGamesToWin({ gamesToWin: { group: 2 } }), 2);
  assert.equal(maxGamesToWin({ gamesToWin: {} }), 0);
  assert.equal(maxGamesToWin({}), 0);
  assert.equal(maxGamesToWin(undefined), 0);
});

test('the league file and its labels agree with each other', async () => {
  // Two fields describing one rule can drift; this is the only thing stopping
  // league.json claiming best-of-5 while every path enforces best-of-3.
  const league = JSON.parse(
    await readFile(new URL('../data/league.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(league.rules.gamesToWin).sort(), ['group', 'playoff']);
  assert.equal(league.rules.gamesToWin.group, 2);
  assert.equal(league.rules.gamesToWin.playoff, 3);
  for (const [stage, games] of Object.entries(league.rules.gamesToWin)) {
    assert.equal(league.rules.matchFormat[stage], matchFormatLabel(games), stage);
  }
});

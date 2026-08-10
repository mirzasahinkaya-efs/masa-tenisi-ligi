import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROSTER } from '../scripts/roster.js';
import { parseScore } from '../lib/validate.js';

const league = JSON.parse(
  await readFile(new URL('../data/league.json', import.meta.url), 'utf8'),
);

test('all eleven players are present with unique ids and Slack ids', () => {
  assert.equal(league.players.length, 11);
  assert.equal(new Set(league.players.map((p) => p.id)).size, 11);
  assert.equal(new Set(league.players.map((p) => p.slackId)).size, 11);
  assert.deepEqual(
    league.players.map((p) => p.id).sort(),
    ROSTER.map((p) => p.id).sort(),
  );
});

test('short names are unique, so the three Emres are distinguishable', () => {
  assert.equal(new Set(league.players.map((p) => p.short)).size, 11);
});

test('groups hold six and five players and cover the roster once', () => {
  assert.equal(league.groups.A.length, 6);
  assert.equal(league.groups.B.length, 5);
  assert.deepEqual(
    [...league.groups.A, ...league.groups.B].sort(),
    league.players.map((p) => p.id).sort(),
  );
});

test('the group stage has fifty fixtures over ten rounds', () => {
  assert.equal(league.fixtures.length, 50);
  assert.equal(league.fixtures.filter((f) => f.group === 'A').length, 30);
  assert.equal(league.fixtures.filter((f) => f.group === 'B').length, 20);
  assert.deepEqual(
    [...new Set(league.fixtures.map((f) => f.round))].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test('every round holds five matches across the two groups', () => {
  for (let round = 1; round <= 10; round += 1) {
    const inRound = league.fixtures.filter((f) => f.round === round);
    assert.equal(inRound.length, 5, `round ${round}`);
  }
});

test('fixtures only pair players from the same group', () => {
  for (const fixture of league.fixtures) {
    const group = league.groups[fixture.group];
    assert.ok(group.includes(fixture.p1), fixture.id);
    assert.ok(group.includes(fixture.p2), fixture.id);
  }
});

test('with four playoff matches the season totals fifty-four', () => {
  assert.equal(league.playoffFixtures.length, 4);
  assert.equal(league.fixtures.length + league.playoffFixtures.length, 54);
});

test('ten rounds run Monday to Friday from the season start', () => {
  assert.equal(league.rounds.length, 10);
  assert.equal(league.rounds[0].opensAt, '2026-08-10');
  assert.equal(league.rounds[0].deadline, '2026-08-14');
  assert.equal(league.rounds[9].opensAt, '2026-10-12');
  assert.equal(league.rounds[9].deadline, '2026-10-16');
});

test('the committed draw seed is the season seed', () => {
  assert.equal(league.season.drawSeed, 20260810);
});

test('every result names a known fixture exactly once with a legal score', () => {
  const known = new Set([...league.fixtures, ...league.playoffFixtures].map((f) => f.id));
  const seen = new Set();

  for (const result of league.results) {
    assert.ok(known.has(result.fixtureId), `unknown fixture: ${result.fixtureId}`);
    assert.equal(seen.has(result.fixtureId), false, `duplicate result: ${result.fixtureId}`);
    seen.add(result.fixtureId);

    const parsed = parseScore(`${result.p1Games}-${result.p2Games}`);
    assert.equal(parsed.ok, true, `illegal score for ${result.fixtureId}`);
  }

  assert.ok(league.results.length <= known.size, 'more results than fixtures');
});

test('no derived standings are stored anywhere in the file', () => {
  for (const key of ['standings', 'table', 'positions', 'points']) {
    assert.equal(key in league, false, `league.json must not store "${key}"`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScore } from '../lib/validate.js';

const league = JSON.parse(
  await readFile(new URL('../data/league.json', import.meta.url), 'utf8'),
);

test('players have unique ids, Slack ids and short names', () => {
  const count = league.players.length;
  assert.ok(count >= 4, 'a league needs at least four players');
  assert.equal(new Set(league.players.map((p) => p.id)).size, count);
  assert.equal(new Set(league.players.map((p) => p.slackId)).size, count);
  assert.equal(new Set(league.players.map((p) => p.short)).size, count);
});

test('the two groups partition the group-stage players and are near-equal in size', () => {
  const groupStage = league.players.filter((player) => player.groupStage !== false);
  assert.deepEqual(
    [...league.groups.A, ...league.groups.B].sort(),
    groupStage.map((player) => player.id).sort(),
  );
  assert.ok(Math.abs(league.groups.A.length - league.groups.B.length) <= 1);
});

test('every fixed playoff entrant is a real player who plays no group stage', () => {
  const fixed = league.playoffFixtures
    .flatMap((fixture) => [fixture.slotP1, fixture.slotP2])
    .filter((slot) => slot.startsWith('@'))
    .map((slot) => slot.slice(1));
  assert.ok(fixed.length > 0, 'the bracket should name at least one fixed entrant');
  for (const id of fixed) {
    const player = league.players.find((p) => p.id === id);
    assert.ok(player, `no such player: ${id}`);
    assert.equal(player.groupStage, false, `${id} must not also play the group stage`);
    assert.equal([...league.groups.A, ...league.groups.B].includes(id), false);
  }
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

test('with eight playoff matches the season totals fifty-eight', () => {
  assert.equal(league.playoffFixtures.length, 8);
  assert.equal(league.fixtures.length + league.playoffFixtures.length, 58);
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

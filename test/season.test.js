import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScore } from '../lib/validate.js';
import { ROSTER, SEASON, RULES } from '../scripts/roster.js';

const league = JSON.parse(
  await readFile(new URL('../data/league.json', import.meta.url), 'utf8'),
);

test('the committed league file has not drifted from the roster it was generated from', () => {
  // scripts/roster.js is only the SOURCE; data/league.json is what ships and what
  // every runtime path reads. Editing the roster without re-running `npm run
  // generate` leaves the two disagreeing, and nothing else would notice.
  assert.deepEqual(league.rules, RULES);
  assert.deepEqual(
    league.players.map((p) => p.id).sort(),
    ROSTER.map((p) => p.id).sort(),
  );
  assert.equal(league.season.drawSeed, SEASON.drawSeed);
  assert.equal(league.season.startDate, SEASON.startDate);
  for (const source of ROSTER) {
    const shipped = league.players.find((p) => p.id === source.id);
    assert.equal(shipped.short, source.short, source.id);
    assert.equal(shipped.slackId, source.slackId, source.id);
    assert.equal(shipped.groupStage, source.groupStage, source.id);
  }
});

test('players have unique ids and short names', () => {
  const count = league.players.length;
  assert.ok(count >= 4, 'a league needs at least four players');
  assert.equal(new Set(league.players.map((p) => p.id)).size, count);
  assert.equal(new Set(league.players.map((p) => p.short)).size, count);
});

test('Slack ids are unique among the players who have one', () => {
  // Not every player is in the tournament channel, so a missing Slack id is
  // legitimate. Counting undefined as a value would make this pass only while
  // exactly one player lacked one, and fail the moment a second joined.
  const slackIds = league.players.map((p) => p.slackId).filter(Boolean);
  assert.equal(new Set(slackIds).size, slackIds.length);
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

test('the group stage has sixty fixtures over ten rounds', () => {
  assert.equal(league.fixtures.length, 60);
  assert.equal(league.fixtures.filter((f) => f.group === 'A').length, 30);
  assert.equal(league.fixtures.filter((f) => f.group === 'B').length, 30);
  assert.deepEqual(
    [...new Set(league.fixtures.map((f) => f.round))].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test('every pair in a group meets exactly twice, in both orientations', () => {
  // The invariant the fixture count above is only a proxy for.
  for (const [name, members] of Object.entries(league.groups)) {
    const own = league.fixtures.filter((f) => f.group === name);
    assert.equal(own.length, members.length * (members.length - 1), name);

    const seen = new Map();
    for (const fixture of own) {
      const pair = [fixture.p1, fixture.p2].sort().join('|');
      seen.set(pair, [...(seen.get(pair) ?? []), `${fixture.p1}>${fixture.p2}`]);
    }
    assert.equal(seen.size, (members.length * (members.length - 1)) / 2, `${name} pair count`);
    for (const [pair, orientations] of seen) {
      assert.equal(orientations.length, 2, `${pair} should meet twice`);
      assert.equal(new Set(orientations).size, 2, `${pair} meets twice in the same orientation`);
    }
  }
});

test('every round holds six matches across the two groups', () => {
  for (let round = 1; round <= 10; round += 1) {
    const inRound = league.fixtures.filter((f) => f.round === round);
    assert.equal(inRound.length, 6, `round ${round}`);
  }
});

test('nobody is scheduled twice in the same round', () => {
  for (let round = 1; round <= 10; round += 1) {
    const players = league.fixtures
      .filter((f) => f.round === round)
      .flatMap((f) => [f.p1, f.p2]);
    assert.equal(new Set(players).size, players.length, `round ${round} double-books someone`);
  }
});

test('fixtures only pair players from the same group', () => {
  for (const fixture of league.fixtures) {
    const group = league.groups[fixture.group];
    assert.ok(group.includes(fixture.p1), fixture.id);
    assert.ok(group.includes(fixture.p2), fixture.id);
  }
});

test('with eight playoff matches the season totals sixty-eight', () => {
  assert.equal(league.playoffFixtures.length, 8);
  assert.equal(league.fixtures.length + league.playoffFixtures.length, 68);
});

test('the bracket names only slots the groups can actually fill', () => {
  const sizes = Object.fromEntries(
    Object.entries(league.groups).map(([name, ids]) => [name, ids.length]),
  );
  for (const slot of league.playoffFixtures.flatMap((f) => [f.slotP1, f.slotP2])) {
    const group = /^([AB])([1-9])$/.exec(slot);
    if (!group) continue;
    const [, name, position] = group;
    assert.ok(Number(position) <= sizes[name],
      `${slot} needs group ${name} to have ${position} players, it has ${sizes[name]}`);
  }
});

test('ten rounds run Monday to Friday, a week apart, from the season start', () => {
  // Derived from SEASON.startDate rather than hardcoded, so moving the season
  // does not mean editing four dates here — the shape is what matters, and the
  // drift test above already pins the start date itself to the roster.
  const DAY = 24 * 60 * 60 * 1000;
  const day = (iso) => new Date(`${iso}T00:00:00Z`);

  assert.equal(league.rounds.length, 10);
  assert.equal(league.rounds[0].opensAt, SEASON.startDate);

  league.rounds.forEach((round, index) => {
    assert.equal(round.n, index + 1);
    assert.equal(day(round.opensAt).getUTCDay(), 1, `round ${round.n} must open on a Monday`);
    assert.equal(day(round.deadline).getUTCDay(), 5, `round ${round.n} must close on a Friday`);
    assert.equal(
      (day(round.deadline) - day(round.opensAt)) / DAY, 4, `round ${round.n} spans Mon-Fri`,
    );
    if (index > 0) {
      assert.equal(
        (day(round.opensAt) - day(league.rounds[index - 1].opensAt)) / DAY, 7,
        `round ${round.n} starts a week after round ${index}`,
      );
    }
  });
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

    const parsed = parseScore(`${result.p1Games}-${result.p2Games}`, {
      gamesToWin: league.rules.gamesToWin,
    });
    assert.equal(parsed.ok, true, `illegal score for ${result.fixtureId}`);
  }

  assert.ok(league.results.length <= known.size, 'more results than fixtures');
});

test('the league rule is one that actually judges scores', () => {
  // The loop above is dormant while no results are recorded, so on its own it
  // would keep passing even if the rule it validates against were unusable.
  // These two assertions are what make the check above mean something today.
  const { gamesToWin } = league.rules;
  assert.equal(parseScore(`${gamesToWin}-0`, { gamesToWin }).ok, true);
  assert.equal(parseScore(`${gamesToWin}-${gamesToWin}`, { gamesToWin }).ok, false);
});

test('no derived standings are stored anywhere in the file', () => {
  for (const key of ['standings', 'table', 'positions', 'points']) {
    assert.equal(key in league, false, `league.json must not store "${key}"`);
  }
});

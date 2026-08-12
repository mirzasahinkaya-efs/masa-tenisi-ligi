import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleResultPost } from '../functions/api/results.js';
import { signToken } from '../lib/session.js';
import { SESSION_COOKIE } from '../functions/_shared/http.js';

const NOW = 1_786_000_000;
const env = { SESSION_SECRET: 'session-secret', GITHUB_TOKEN: 't', GITHUB_REPO: 'o/r' };
const base = JSON.parse(await readFile(new URL('../data/league.json', import.meta.url), 'utf8'));

const session = (slackId) => signToken({ sub: slackId }, env.SESSION_SECRET, {
  expiresInSeconds: 3600, nowSeconds: NOW,
});

const post = async (body, slackId) => new Request('https://league.test/api/results', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(slackId ? { cookie: `${SESSION_COOKIE}=${await session(slackId)}` } : {}),
  },
  body: JSON.stringify(body),
});

function fakeStore(league = structuredClone(base)) {
  const state = { league, commits: [] };
  return {
    state,
    store: {
      read: async () => ({ league: state.league, sha: 's' }),
      // Mirrors the real store's contract: a mutation that throws becomes a
      // REJECTED result rather than an exception escaping update().
      update: async (mutate) => {
        let next;
        try {
          next = mutate(state.league);
        } catch (error) {
          return { ok: false, error: 'REJECTED', reason: error.message };
        }
        state.league = next.league;
        state.commits.push(next.message);
        return { ok: true, league: next.league };
      },
    },
  };
}

const slackOf = (id) => base.players.find((p) => p.id === id).slackId;
const deps = (fake) => ({ nowSeconds: () => NOW, makeStore: () => fake.store, notify: async () => {} });

test('a player records their own match and it is committed', async () => {
  const fake = fakeStore();
  const mirzaOpponent = base.fixtures.find(
    (f) => f.p1 === 'mirza' || f.p2 === 'mirza',
  );
  const opponentId = mirzaOpponent.p1 === 'mirza' ? mirzaOpponent.p2 : mirzaOpponent.p1;

  const response = await handleResultPost(
    await post({ opponentId, myGames: 3, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(response.status, 200);
  assert.equal(fake.state.league.results.length, 1);
  assert.equal(fake.state.commits.length, 1);
});

test('the reporter comes from the session, not the request body', async () => {
  const fake = fakeStore();
  const fixture = base.fixtures.find((f) => f.p1 === 'mirza' || f.p2 === 'mirza');
  const opponentId = fixture.p1 === 'mirza' ? fixture.p2 : fixture.p1;

  // A body claiming to be someone else must not change who is credited.
  const response = await handleResultPost(
    await post({ opponentId, myGames: 3, theirGames: 0, reporterId: opponentId }, slackOf('mirza')),
    env, deps(fake),
  );
  assert.equal(response.status, 200);
  const stored = fake.state.league.results[0];
  const target = base.fixtures.find((f) => f.id === stored.fixtureId);
  const mirzaGames = target.p1 === 'mirza' ? stored.p1Games : stored.p2Games;
  assert.equal(mirzaGames, 3, 'the session holder must be credited with 3 games');
});

test('an unauthenticated request is refused', async () => {
  const fake = fakeStore();
  const response = await handleResultPost(
    await post({ opponentId: 'tolga', myGames: 3, theirGames: 1 }, null), env, deps(fake),
  );
  assert.equal(response.status, 401);
  assert.equal(fake.state.commits.length, 0);
});

test('a signed-in non-player is refused', async () => {
  const fake = fakeStore();
  const response = await handleResultPost(
    await post({ opponentId: 'tolga', myGames: 3, theirGames: 1 }, 'U0STRANGER'), env, deps(fake),
  );
  assert.equal(response.status, 403);
  assert.equal(fake.state.commits.length, 0);
});

test('an illegal score is refused before anything is written', async () => {
  const fake = fakeStore();
  const fixture = base.fixtures.find((f) => f.p1 === 'mirza' || f.p2 === 'mirza');
  const opponentId = fixture.p1 === 'mirza' ? fixture.p2 : fixture.p1;
  const response = await handleResultPost(
    await post({ opponentId, myGames: 4, theirGames: 2 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(response.status, 400);
  assert.equal(fake.state.commits.length, 0);
});

test('two players who never meet are refused', async () => {
  const fake = fakeStore();
  const other = base.groups.A.includes('mirza') ? base.groups.B[0] : base.groups.A[0];
  const response = await handleResultPost(
    await post({ opponentId: other, myGames: 3, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(response.status, 409);
  assert.equal(fake.state.commits.length, 0);
});

test('reporting yourself as the opponent is refused', async () => {
  const fake = fakeStore();
  const response = await handleResultPost(
    await post({ opponentId: 'mirza', myGames: 3, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(response.status, 400);
  assert.equal(fake.state.commits.length, 0);
});

test('once both meetings are recorded a further submission is refused', async () => {
  const fake = fakeStore();
  const fixture = base.fixtures.find((f) => f.p1 === 'mirza' || f.p2 === 'mirza');
  const opponentId = fixture.p1 === 'mirza' ? fixture.p2 : fixture.p1;
  const body = { opponentId, myGames: 3, theirGames: 1 };

  for (let i = 0; i < 2; i += 1) {
    const ok = await handleResultPost(await post(body, slackOf('mirza')), env, deps(fake));
    assert.equal(ok.status, 200, `submission ${i + 1}`);
  }
  const third = await handleResultPost(await post(body, slackOf('mirza')), env, deps(fake));
  assert.equal(third.status, 409);
  assert.equal(fake.state.league.results.length, 2);
});

test('no derived standings are ever written into the league file', async () => {
  const fake = fakeStore();
  const fixture = base.fixtures.find((f) => f.p1 === 'mirza' || f.p2 === 'mirza');
  const opponentId = fixture.p1 === 'mirza' ? fixture.p2 : fixture.p1;
  await handleResultPost(
    await post({ opponentId, myGames: 3, theirGames: 2 }, slackOf('mirza')), env, deps(fake),
  );
  for (const key of ['standings', 'table', 'positions', 'points']) {
    assert.equal(key in fake.state.league, false, key);
  }
});

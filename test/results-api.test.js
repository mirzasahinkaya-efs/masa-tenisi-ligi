import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleResultPost } from '../functions/api/results.js';
import { computeTable } from '../lib/standings.js';
import { bestFourthPlayerId } from '../lib/bracket.js';
import { signToken } from '../lib/session.js';
import { SESSION_COOKIE } from '../functions/_shared/http.js';

const NOW = 1_786_000_000;
const env = { SESSION_SECRET: 'session-secret', GITHUB_TOKEN: 't', GITHUB_REPO: 'o/r' };
const league0 = JSON.parse(
  await readFile(new URL('../data/league.json', import.meta.url), 'utf8'),
);
/*
 * The real roster, fixtures and rules — but deliberately NO results.
 *
 * These tests count what a submission adds, so they must not depend on how many
 * results the live league happens to hold. Coupling to that is worse than
 * brittle: recording a match would fail CI, CI failing skips the deploy, and the
 * deploy is what publishes the match. Seed results explicitly where a test needs
 * them (the race tests below do).
 */
const base = { ...league0, results: [] };

const session = (slackId) => signToken(
  { t: 'session', k: 'slack', sub: slackId }, env.SESSION_SECRET,
  { expiresInSeconds: 3600, nowSeconds: NOW },
);

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

// The passphrase route is the one that can actually be deployed, so it needs
// its own end-to-end coverage here: a session minted by /api/passphrase names
// the player by roster id, and results.js resolves that through a different
// branch of playerForSubject than the Slack route uses.
const passphraseSession = (playerId) => signToken(
  { t: 'session', k: 'player', sub: playerId }, env.SESSION_SECRET,
  { expiresInSeconds: 3600, nowSeconds: NOW },
);

const postAs = async (body, token) => new Request('https://league.test/api/results', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
  },
  body: JSON.stringify(body),
});

test('a passphrase session records a result, credited to that player', async () => {
  const fake = fakeStore();
  const fixture = base.fixtures.find((f) => f.p1 === 'mirza' || f.p2 === 'mirza');
  const opponentId = fixture.p1 === 'mirza' ? fixture.p2 : fixture.p1;

  const response = await handleResultPost(
    await postAs({ opponentId, myGames: 2, theirGames: 1 }, await passphraseSession('mirza')),
    env, deps(fake),
  );
  assert.equal(response.status, 200);
  assert.equal(fake.state.league.results.length, 1);

  const stored = fake.state.league.results[0];
  const target = base.fixtures.find((f) => f.id === stored.fixtureId);
  const mirzaGames = target.p1 === 'mirza' ? stored.p1Games : stored.p2Games;
  assert.equal(mirzaGames, 2, 'the session holder must be credited with 2 games');
  assert.equal(stored.reportedBy, 'player:mirza');
});

test('a Slack-signed result is provenanced apart from a passphrase one', async () => {
  // The two routes prove different things, so the stored field has to say
  // which one was used rather than naming a player as if both were equal.
  const fake = fakeStore();
  const fixture = base.fixtures.find((f) => f.p1 === 'mirza' || f.p2 === 'mirza');
  const opponentId = fixture.p1 === 'mirza' ? fixture.p2 : fixture.p1;

  await handleResultPost(
    await post({ opponentId, myGames: 2, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(fake.state.league.results[0].reportedBy, 'slack:mirza');
});

test('being an admin does not let a passphrase session invent a pairing', async () => {
  // mirza is a season admin. The opponent is chosen from the OTHER group on
  // purpose: an earlier version of this test picked "the first fixture mirza is
  // not in", which silently became a fixture mirza WAS in the moment the draw
  // moved him, and passed for the wrong reason.
  const fake = fakeStore();
  const mine = Object.entries(base.groups).find(([, ids]) => ids.includes('mirza'))[0];
  const theirs = Object.entries(base.groups).find(([name]) => name !== mine)[1];
  assert.equal(theirs.includes('mirza'), false, 'premise: the opponent is cross-group');

  const response = await handleResultPost(
    await postAs(
      { opponentId: theirs[0], myGames: 2, theirGames: 1 }, await passphraseSession('mirza'),
    ),
    env, deps(fake),
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /different groups/);
  assert.equal(fake.state.league.results.length, 0);
});

test('a legacy session with no subject kind authorises nobody', async () => {
  const fake = fakeStore();
  const legacy = await signToken(
    { t: 'session', sub: slackOf('mirza') }, env.SESSION_SECRET,
    { expiresInSeconds: 3600, nowSeconds: NOW },
  );
  const response = await handleResultPost(
    await postAs({ opponentId: 'tolga', myGames: 2, theirGames: 1 }, legacy), env, deps(fake),
  );
  assert.equal(response.status, 403);
  assert.equal(fake.state.league.results.length, 0);
});

test('a player records their own match and it is committed', async () => {
  const fake = fakeStore();
  const mirzaOpponent = base.fixtures.find(
    (f) => f.p1 === 'mirza' || f.p2 === 'mirza',
  );
  const opponentId = mirzaOpponent.p1 === 'mirza' ? mirzaOpponent.p2 : mirzaOpponent.p1;

  const response = await handleResultPost(
    await post({ opponentId, myGames: 2, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
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
    await post({ opponentId, myGames: 2, theirGames: 0, reporterId: opponentId }, slackOf('mirza')),
    env, deps(fake),
  );
  assert.equal(response.status, 200);
  const stored = fake.state.league.results[0];
  const target = base.fixtures.find((f) => f.id === stored.fixtureId);
  const mirzaGames = target.p1 === 'mirza' ? stored.p1Games : stored.p2Games;
  assert.equal(mirzaGames, 2, 'the session holder must be credited with 2 games');
});

test('an unauthenticated request is refused', async () => {
  const fake = fakeStore();
  const response = await handleResultPost(
    await post({ opponentId: 'tolga', myGames: 2, theirGames: 1 }, null), env, deps(fake),
  );
  assert.equal(response.status, 401);
  assert.equal(fake.state.commits.length, 0);
});

test('a signed-in non-player is refused', async () => {
  const fake = fakeStore();
  const response = await handleResultPost(
    await post({ opponentId: 'tolga', myGames: 2, theirGames: 1 }, 'U0STRANGER'), env, deps(fake),
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
    await post({ opponentId: other, myGames: 2, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(response.status, 409);
  assert.equal(fake.state.commits.length, 0);
});

test('reporting yourself as the opponent is refused', async () => {
  const fake = fakeStore();
  const response = await handleResultPost(
    await post({ opponentId: 'mirza', myGames: 2, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(response.status, 400);
  assert.equal(fake.state.commits.length, 0);
});

test('once both meetings are recorded a further submission is refused', async () => {
  const fake = fakeStore();
  const fixture = base.fixtures.find((f) => f.p1 === 'mirza' || f.p2 === 'mirza');
  const opponentId = fixture.p1 === 'mirza' ? fixture.p2 : fixture.p1;
  const body = { opponentId, myGames: 2, theirGames: 1 };

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
    await post({ opponentId, myGames: 2, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  for (const key of ['standings', 'table', 'positions', 'points']) {
    assert.equal(key in fake.state.league, false, key);
  }
});

test('a body that is valid JSON but not an object is refused', async () => {
  const fake = fakeStore();
  for (const raw of ['null', '"a string"', '42', '[]', 'true']) {
    const request = new Request('https://league.test/api/results', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${await session(slackOf('mirza'))}` },
      body: raw,
    });
    const response = await handleResultPost(request, env, deps(fake));
    assert.equal(response.status, 400, `body ${raw}`);
  }
  assert.equal(fake.state.commits.length, 0);
});

// --- the two stages are played to different lengths ---

/** Every group fixture decided in favour of whoever sorts first. */
const groupsFinished = (league) => league.fixtures.map((f) => ({
  fixtureId: f.id,
  p1Games: f.p1 < f.p2 ? 2 : 0,
  p2Games: f.p1 < f.p2 ? 0 : 2,
  reportedBy: 'seed',
  reportedAt: '2026-10-23T00:00:00Z',
}));

test('a playoff result is judged as best-of-five, not by the group rule', async () => {
  // The API's playoff path is reachable: handleResultPost takes whatever
  // opponentId it is given, so a quarter-final can be filed even though the web
  // form's dropdown only ever offers same-group opponents.
  const league = structuredClone(base);
  league.results = groupsFinished(league);
  const tables = Object.fromEntries(Object.entries(league.groups).map(([name, ids]) => [
    name, computeTable(ids, league.fixtures, league.results, league.rules, league.season.drawSeed),
  ]));
  const opponentId = bestFourthPlayerId(tables, league.season.drawSeed);

  const send = async (myGames, theirGames) => {
    const fake = fakeStore(structuredClone(league));
    const response = await handleResultPost(
      await postAs({ opponentId, myGames, theirGames }, await passphraseSession('tugkan')),
      env, deps(fake),
    );
    return { response, fake };
  };

  // 2-1 wins a group match but cannot win a playoff one.
  const short = await send(2, 1);
  assert.equal(short.response.status, 400);
  assert.match((await short.response.json()).error, /best-of-5/);
  assert.equal(short.fake.state.commits.length, 0);

  const proper = await send(3, 1);
  assert.equal(proper.response.status, 200, JSON.stringify(await proper.response.json()));
  const stored = proper.fake.state.league.results.at(-1);
  assert.equal(stored.fixtureId, 'QF2');
  assert.deepEqual([stored.p1Games, stored.p2Games].sort(), [1, 3]);
});

test('a group result is still judged as best-of-three', async () => {
  // The playoff rule must not leak backwards onto group fixtures.
  const league = structuredClone(base);
  const pair = league.fixtures.filter((f) => [f.p1, f.p2].includes('mirza'));
  const opponentId = pair[0].p1 === 'mirza' ? pair[0].p2 : pair[0].p1;

  const fake = fakeStore(structuredClone(league));
  const response = await handleResultPost(
    await post({ opponentId, myGames: 3, theirGames: 1 }, slackOf('mirza')), env, deps(fake),
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /best-of-3/);
});

test('a fixture that changes stage under a race is refused, not stored', async () => {
  /*
   * The narrow window the stage guard exists for. A2 and A3 share a group AND
   * meet again in SF2 (W-QF3 v W-QF4, which A3 and A2 win below), so:
   *
   *   outer read  -> their second group meeting is open       -> best-of-3
   *   in the gap  -> someone records it, finishing the groups -> SF2 resolves
   *   inner read  -> their next open fixture is SF2           -> best-of-5
   *
   * The 2-1 approved against the group rule is not legal for SF2, so it must be
   * refused rather than written to a fixture that could not have produced it.
   */
  const league = structuredClone(base);
  const finished = groupsFinished(league);
  const tableA = computeTable(
    league.groups.A, league.fixtures, finished, league.rules, league.season.drawSeed,
  );
  const [a2, a3] = [tableA[1].playerId, tableA[2].playerId];

  const between = league.fixtures.filter(
    (f) => [f.p1, f.p2].sort().join() === [a2, a3].sort().join(),
  );
  assert.equal(between.length, 2, 'premise: they meet twice in the group');

  // Everything finished EXCEPT their second meeting, so the outer lookup still
  // finds a group fixture.
  const held = between[1];
  league.results = finished.filter((r) => r.fixtureId !== held.id);

  const store = {
    read: async () => ({ league: structuredClone(league), sha: 's' }),
    update: async (mutate) => {
      const raced = structuredClone(league);
      raced.results.push(finished.find((r) => r.fixtureId === held.id));
      // QF3 and QF4 decided so A3 and A2 advance, which pairs them in SF2.
      raced.results.push(
        { fixtureId: 'QF3', p1Games: 0, p2Games: 3, reportedBy: 'seed', reportedAt: 'x' },
        { fixtureId: 'QF4', p1Games: 3, p2Games: 0, reportedBy: 'seed', reportedAt: 'x' },
      );
      try {
        mutate(raced);
      } catch (error) {
        return { ok: false, error: 'REJECTED', reason: error.message };
      }
      return { ok: true, league: raced };
    },
  };

  const response = await handleResultPost(
    await postAs({ opponentId: a3, myGames: 2, theirGames: 1 }, await passphraseSession(a2)),
    env, { nowSeconds: () => NOW, makeStore: () => store },
  );
  assert.equal(response.status, 409);
});

test('a match recorded by someone else in the gap is refused, not double-recorded', async () => {
  const league = structuredClone(base);
  const pair = league.fixtures.filter((f) => [f.p1, f.p2].includes('mirza'));
  const first = pair[0];
  const opponentId = first.p1 === 'mirza' ? first.p2 : first.p1;
  const both = league.fixtures.filter(
    (f) => [f.p1, f.p2].sort().join() === ['mirza', opponentId].sort().join(),
  );
  // Close the SECOND meeting up front so only `first` is open. Without this the
  // retry would legitimately fall through to the other fixture and succeed.
  const second = both.find((f) => f.id !== first.id);
  league.results.push({ fixtureId: second.id, p1Games: 2, p2Games: 0, reportedBy: 'seed', reportedAt: '2026-08-01T00:00:00Z' });

  let reads = 0;
  const store = {
    read: async () => ({ league: structuredClone(league), sha: 's' }),
    update: async (mutate) => {
      // The mutation sees a league in which `first` has ALREADY been recorded
      // by someone else, which is what the inner re-check must catch.
      const raced = structuredClone(league);
      raced.results.push({ fixtureId: first.id, p1Games: 2, p2Games: 1, reportedBy: 'other', reportedAt: '2026-08-02T00:00:00Z' });
      reads += 1;
      try {
        mutate(raced);
      } catch (error) {
        return { ok: false, error: 'REJECTED', reason: error.message };
      }
      return { ok: true, league: raced };
    },
  };

  const request = await post({ opponentId, myGames: 2, theirGames: 1 }, slackOf('mirza'));
  const response = await handleResultPost(request, env, { nowSeconds: () => NOW, makeStore: () => store });
  assert.equal(response.status, 409);
  assert.equal(reads, 1);
});

test('under a race, the response names the fixture actually committed, not the stale one', async () => {
  const league = structuredClone(base);
  const pair = league.fixtures.filter((f) => [f.p1, f.p2].includes('mirza'));
  const first = pair[0];
  const opponentId = first.p1 === 'mirza' ? first.p2 : first.p1;
  const both = league.fixtures.filter(
    (f) => [f.p1, f.p2].sort().join() === ['mirza', opponentId].sort().join(),
  );
  const second = both.find((f) => f.id !== first.id);

  let committedResult;
  const store = {
    read: async () => ({ league: structuredClone(league), sha: 's' }),
    update: async (mutate) => {
      // Between the pre-read (which sees `first` as open, same as the outer
      // findOpenFixture call) and this mutation, someone else records `first`,
      // so the fresh findOpenFixture inside the mutation resolves to `second`.
      // The response must name `second`, not the `first` the pre-read saw.
      const raced = structuredClone(league);
      raced.results.push({ fixtureId: first.id, p1Games: 2, p2Games: 1, reportedBy: 'other', reportedAt: '2026-08-02T00:00:00Z' });
      const next = mutate(raced);
      committedResult = next.league.results.at(-1);
      return { ok: true, league: next.league };
    },
  };

  const request = await post({ opponentId, myGames: 2, theirGames: 1 }, slackOf('mirza'));
  const response = await handleResultPost(request, env, { nowSeconds: () => NOW, makeStore: () => store });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.fixtureId, second.id);
  assert.equal(committedResult.fixtureId, second.id);
});

test('a store read failure returns 502 rather than throwing', async () => {
  const failing = { read: async () => { throw Object.assign(new Error('boom'), { status: 401 }); } };
  const response = await handleResultPost(
    await post({ opponentId: 'tolga', myGames: 2, theirGames: 1 }, slackOf('mirza')),
    env, { nowSeconds: () => NOW, makeStore: () => failing },
  );
  assert.equal(response.status, 502);
});

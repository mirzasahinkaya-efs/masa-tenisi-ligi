import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../functions/_shared/store.js';

const encode = (value) => btoa(JSON.stringify(value));

function fakeGitHub({ league, failCommits = 0, injectOnConflict = null }) {
  const state = { league, sha: 'sha-1' };
  const calls = [];
  let forced = 0;
  const bump = () => { state.sha = `sha-${Number(state.sha.split('-')[1]) + 1}`; };

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if ((options.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ content: encode(state.league), sha: state.sha }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    if (forced < failCommits) {
      forced += 1;
      // Simulate a competing writer landing between our read and our commit.
      if (injectOnConflict) { state.league = injectOnConflict(state.league); bump(); }
      return new Response('{}', { status: 409 });
    }
    if (body.sha !== state.sha) return new Response('{}', { status: 409 });
    state.league = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(body.content), (character) => character.charCodeAt(0)),
    ));
    bump();
    return new Response(JSON.stringify({ commit: { sha: state.sha } }), { status: 200 });
  };
  return { fetchImpl, calls, state };
}

const league = () => ({ season: { drawSeed: 1 }, players: [], results: [] });

test('read decodes the league and returns the blob sha', async () => {
  const github = fakeGitHub({ league: league() });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl: github.fetchImpl });
  const { league: read, sha } = await store.read();
  assert.deepEqual(read, league());
  assert.equal(sha, 'sha-1');
});

test('the token is sent as a bearer credential and never in the URL', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url: String(url), auth: options.headers.authorization });
    return new Response(JSON.stringify({ content: encode(league()), sha: 's' }), { status: 200 });
  };
  const store = createStore({ token: 'secret-token', repo: 'o/r', fetchImpl });
  await store.read();
  assert.equal(seen[0].auth, 'Bearer secret-token');
  assert.ok(!seen[0].url.includes('secret-token'), 'token must not appear in the URL');
});

test('a stale sha surfaces as CONFLICT rather than a silent overwrite', async () => {
  const github = fakeGitHub({ league: league() });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl: github.fetchImpl });
  const result = await store.commit(league(), 'msg', 'sha-stale');
  assert.deepEqual(result, { ok: false, error: 'CONFLICT', status: 409 });
});

test('update retries a conflict and eventually succeeds', async () => {
  const github = fakeGitHub({ league: league(), failCommits: 2 });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl: github.fetchImpl });
  const result = await store.update(
    (current) => ({ league: { ...current, touched: true }, message: 'touch' }),
    { attempts: 3 },
  );
  assert.equal(result.ok, true);
  assert.equal(github.calls.filter((c) => c.method === 'PUT').length, 3);
});

test('update gives up after the attempt budget and reports CONFLICT', async () => {
  const github = fakeGitHub({ league: league(), failCommits: 99 });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl: github.fetchImpl });
  const result = await store.update(
    (current) => ({ league: current, message: 'x' }), { attempts: 2 },
  );
  assert.deepEqual(result, { ok: false, error: 'CONFLICT' });
  assert.equal(github.calls.filter((c) => c.method === 'PUT').length, 2);
});

test('update re-reads before each retry so the mutation sees fresh data', async () => {
  const github = fakeGitHub({ league: league(), failCommits: 1 });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl: github.fetchImpl });
  await store.update((current) => ({ league: current, message: 'x' }), { attempts: 3 });
  assert.equal(github.calls.filter((c) => c.method === 'GET').length, 2);
});

test('a mutation that throws aborts without committing', async () => {
  const github = fakeGitHub({ league: league() });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl: github.fetchImpl });
  const result = await store.update(() => { throw new Error('nope'); }, { attempts: 3 });
  assert.equal(result.ok, false);
  assert.equal(github.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('a retry re-applies the mutation to freshly read data, not a stale copy', async () => {
  const github = fakeGitHub({
    league: { results: [] },
    failCommits: 1,
    injectOnConflict: (current) => ({ ...current, results: [...current.results, { who: 'other' }] }),
  });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl: github.fetchImpl });

  const result = await store.update(
    (current) => ({ league: { ...current, results: [...current.results, { who: 'mine' }] }, message: 'mine' }),
    { attempts: 3 },
  );

  assert.equal(result.ok, true);
  // Had the retry reused the stale league, 'other' would have been overwritten.
  assert.deepEqual(github.state.league.results, [{ who: 'other' }, { who: 'mine' }]);
});

test('a read failure is reported, not thrown', async () => {
  const fetchImpl = async () => new Response('{}', { status: 401 });
  const store = createStore({ token: 't', repo: 'o/r', fetchImpl });
  const result = await store.update((current) => ({ league: current, message: 'x' }), { attempts: 3 });
  assert.deepEqual(result, { ok: false, error: 'READ_FAILED', status: 401 });
});

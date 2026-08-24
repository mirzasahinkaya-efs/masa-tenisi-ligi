import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleLeagueGet } from '../functions/api/league.js';

const league = JSON.parse(await readFile(new URL('../data/league.json', import.meta.url), 'utf8'));
const env = { GITHUB_TOKEN: 'github-token-fixture-Qw4', GITHUB_REPO: 'o/r' };
const reading = (impl) => ({ makeStore: () => ({ read: impl }) });

test('the live endpoint serves the league it reads from the repository', async () => {
  const response = await handleLeagueGet(env, reading(async () => ({ league, sha: 's' })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.players.length, league.players.length);
  assert.deepEqual(body.rules.gamesToWin, league.rules.gamesToWin);
});

test('it is cacheable, unlike every other endpoint', async () => {
  // json() defaults to no-store because the other endpoints are per-session.
  // This one is public and would otherwise spend a GitHub API call per page
  // load, so it has to override that default — and a regression to no-store
  // would be invisible except as rate-limit pressure.
  const response = await handleLeagueGet(env, reading(async () => ({ league, sha: 's' })));
  const cache = response.headers.get('cache-control');
  assert.match(cache, /s-maxage=\d+/);
  assert.equal(cache.includes('no-store'), false, cache);
});

test('an unconfigured deployment says so instead of serving nothing', async () => {
  // The client falls back to the committed file, so this must not look like a
  // league with no players — it must be a status the loader treats as a miss.
  let reads = 0;
  const counting = reading(async () => { reads += 1; return { league, sha: 's' }; });
  for (const broken of [
    {}, { GITHUB_TOKEN: 't' }, { GITHUB_REPO: 'o/r' },
    { ...env, GITHUB_TOKEN: '' }, { ...env, GITHUB_REPO: '' },
  ]) {
    const response = await handleLeagueGet(broken, counting);
    assert.equal(response.status, 503, JSON.stringify(Object.keys(broken)));
  }
  assert.equal(reads, 0, 'an unconfigured endpoint must not call out at all');
});

test('an unreachable repository is a 502, not a broken league', async () => {
  const response = await handleLeagueGet(env, reading(async () => {
    const error = new Error('Reading data/league.json failed with 404');
    error.status = 404;
    throw error;
  }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(Array.isArray(body.players), false, 'must not resemble a league');
});

test('no response ever carries the token', async () => {
  for (const deps of [
    reading(async () => ({ league, sha: 's' })),
    reading(async () => { throw new Error(`failed for ${env.GITHUB_TOKEN}`); }),
  ]) {
    const response = await handleLeagueGet(env, deps);
    const text = `${await response.text()}\n${[...response.headers].join('\n')}`;
    assert.equal(text.includes(env.GITHUB_TOKEN), false, text.slice(0, 200));
  }
});

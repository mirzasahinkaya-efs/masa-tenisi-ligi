import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizeUrl, handleCallback } from '../functions/api/callback.js';
import { handleMe, onRequestGet as me } from '../functions/api/me.js';
import { onRequestGet as logout } from '../functions/api/logout.js';
import { signToken } from '../lib/session.js';
import { SESSION_COOKIE } from '../functions/_shared/http.js';

const NOW = 1_786_000_000;
const env = {
  SLACK_CLIENT_ID: 'cid',
  SLACK_CLIENT_SECRET: 'csecret',
  SLACK_TEAM_ID: 'T0EFSORA',
  SESSION_SECRET: 'session-secret',
  ALLOWED_EMAIL_DOMAIN: 'efsora.com',
};

const league = {
  season: { admins: [] },
  players: [{ id: 'mirza', short: 'Mirza Ş.', slackId: 'U0AT8HQ7C9K' }],
};

/** A minimal JWT: these tests never verify its signature, only its claims. */
const idToken = (claims) => {
  const part = (value) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
};

const deps = (claims, { readLeague = async () => league } = {}) => ({
  nowSeconds: () => NOW,
  readLeague,
  exchangeCode: async () => ({ ok: true, idToken: idToken(claims) }),
});

const callbackRequest = async (state) => new Request(
  `https://league.test/api/callback?code=abc&state=${encodeURIComponent(state)}`,
);

const validState = () => signToken({ n: 'nonce' }, env.SESSION_SECRET, {
  expiresInSeconds: 600, nowSeconds: NOW,
});

test('the authorize url pins the workspace, scopes and state', () => {
  const url = new URL(buildAuthorizeUrl(env, 'state-value', 'https://league.test/api/callback'));
  assert.equal(url.origin + url.pathname, 'https://slack.com/openid/connect/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('team'), 'T0EFSORA');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['email', 'openid', 'profile']);
  assert.ok(!url.search.includes('csecret'), 'the client secret must never be in a redirect');
});

test('a valid callback sets an HttpOnly session cookie and redirects', async () => {
  const response = await handleCallback(
    await callbackRequest(await validState()), env,
    deps({ sub: 'U0AT8HQ7C9K', email: 'mirza.sahinkaya@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  assert.equal(response.status, 302);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`), cookie);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(flag), cookie);
});

test('a missing or unsigned state is refused', async () => {
  for (const state of ['', 'forged', 'a.b']) {
    const response = await handleCallback(
      await callbackRequest(state), env,
      deps({ sub: 'U0AT8HQ7C9K', email: 'a@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
    );
    assert.equal(response.status, 403, `state ${state}`);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('an identity from another workspace is refused even with an efsora address', async () => {
  const response = await handleCallback(
    await callbackRequest(await validState()), env,
    deps({ sub: 'U0X', email: 'someone@efsora.com', 'https://slack.com/team_id': 'T0SOMEWHERE' }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('an outside email domain is refused', async () => {
  const response = await handleCallback(
    await callbackRequest(await validState()), env,
    deps({ sub: 'U0X', email: 'someone@gmail.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  assert.equal(response.status, 403);
});

test('a valid Efsora identity who is not a player still signs in', async () => {
  // They can browse; authorisation to submit is enforced separately.
  const response = await handleCallback(
    await callbackRequest(await validState()), env,
    deps({ sub: 'U0COLLEAGUE', email: 'someone@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  assert.equal(response.status, 302);
  assert.ok(response.headers.get('set-cookie'));
});

test('no error response leaks a secret', async () => {
  const response = await handleCallback(
    await callbackRequest('forged'), env,
    deps({ sub: 'U0X', email: 'a@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  const body = await response.text();
  for (const secret of [env.SLACK_CLIENT_SECRET, env.SESSION_SECRET]) {
    assert.ok(!body.includes(secret), 'a secret appeared in a response body');
  }
});

test('me reports a signed-out caller without touching the store', async () => {
  const request = new Request('https://league.test/api/me');
  const response = await me({ request, env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedIn: false, player: null });
});

test('me resolves a signed-in caller to their player', async () => {
  const token = await signToken({ sub: 'U0AT8HQ7C9K' }, env.SESSION_SECRET, {
    expiresInSeconds: 3600, nowSeconds: Math.floor(Date.now() / 1000),
  });
  const request = new Request('https://league.test/api/me', {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  const storeDeps = { makeStore: () => ({ read: async () => ({ league, sha: 's' }) }) };
  const response = await handleMe(request, { ...env, GITHUB_TOKEN: 't', GITHUB_REPO: 'o/r' }, storeDeps);
  const body = await response.json();
  assert.equal(body.signedIn, true);
  assert.equal(body.player.id, 'mirza');
});

test('me reports the roster as unavailable rather than rejecting', async () => {
  const token = await signToken({ sub: 'U0AT8HQ7C9K' }, env.SESSION_SECRET, {
    expiresInSeconds: 3600, nowSeconds: Math.floor(Date.now() / 1000),
  });
  const request = new Request('https://league.test/api/me', {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  const failing = { makeStore: () => ({ read: async () => { throw new Error('boom'); } }) };
  const response = await handleMe(request, env, failing);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { signedIn: true, player: null, rosterUnavailable: true });
});

test('logout clears the cookie and redirects home', async () => {
  const response = await logout();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) {
    assert.ok(cookie.includes(flag), `${flag} missing from: ${cookie}`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizeUrl, handleCallback } from '../functions/api/callback.js';
import { handleMe, onRequestGet as me } from '../functions/api/me.js';
import { onRequestGet as logout } from '../functions/api/logout.js';
import { onRequestGet as login } from '../functions/api/login.js';
import { signToken, verifyToken } from '../lib/session.js';
import { SESSION_COOKIE, LOGIN_STATE_COOKIE } from '../functions/_shared/http.js';

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

const callbackRequest = async (state, { cookie } = {}) => new Request(
  `https://league.test/api/callback?code=abc&state=${encodeURIComponent(state)}`,
  cookie ? { headers: { cookie } } : undefined,
);

const validState = () => signToken({ t: 'login', n: 'nonce' }, env.SESSION_SECRET, {
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
    await callbackRequest(await validState(), { cookie: `${LOGIN_STATE_COOKIE}=nonce` }), env,
    deps({ sub: 'U0AT8HQ7C9K', email: 'mirza.sahinkaya@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  assert.equal(response.status, 302);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`), cookie);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(flag), cookie);
});

test('the callback marks its session as holding a Slack subject', async () => {
  // Nothing else observes what the callback actually emits — the /api/me tests
  // below hand-mint their own tokens — so without this the dormant route could
  // stop stamping the kind and every Slack sign-in would silently resolve to
  // "not a player".
  const response = await handleCallback(
    await callbackRequest(await validState(), { cookie: `${LOGIN_STATE_COOKIE}=nonce` }), env,
    deps({ sub: 'U0AT8HQ7C9K', email: 'a@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  const setCookies = [...response.headers].filter(([name]) => name === 'set-cookie');
  const session = setCookies.map(([, value]) => value)
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  const token = session.slice(`${SESSION_COOKIE}=`.length).split(';')[0];

  const verified = await verifyToken(token, env.SESSION_SECRET, {
    nowSeconds: NOW, expectType: 'session',
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.k, 'slack');
  assert.equal(verified.payload.sub, 'U0AT8HQ7C9K');
});

test('the cookie the callback sets is one /api/me resolves to that player', async () => {
  const response = await handleCallback(
    await callbackRequest(await validState(), { cookie: `${LOGIN_STATE_COOKIE}=nonce` }), env,
    deps({ sub: 'U0AT8HQ7C9K', email: 'a@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  const cookie = [...response.headers]
    .filter(([name]) => name === 'set-cookie')
    .map(([, value]) => value)
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
    .split(';')[0];

  const resolved = await handleMe(
    new Request('https://league.test/api/me', { headers: { cookie } }),
    env,
    { nowSeconds: () => NOW, makeStore: () => ({ read: async () => ({ league, sha: 's' }) }) },
  );
  assert.deepEqual(await resolved.json(), {
    signedIn: true, player: { id: 'mirza', short: 'Mirza Ş.' },
  });
});

test('login refuses rather than redirecting to Slack when unconfigured', async () => {
  // Otherwise "dormant" is only nominal: it would 302 to Slack with
  // client_id=undefined and dead-end on Slack's error page, reading as our bug.
  for (const broken of [
    { SESSION_SECRET: 's' },
    { ...env, SLACK_CLIENT_ID: undefined },
    { ...env, SLACK_TEAM_ID: undefined },
  ]) {
    const response = await login({
      request: new Request('https://league.test/api/login'), env: broken,
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
  }
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
    await callbackRequest(await validState(), { cookie: `${LOGIN_STATE_COOKIE}=nonce` }), env,
    deps({ sub: 'U0X', email: 'someone@efsora.com', 'https://slack.com/team_id': 'T0SOMEWHERE' }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('an outside email domain is refused', async () => {
  const response = await handleCallback(
    await callbackRequest(await validState(), { cookie: `${LOGIN_STATE_COOKIE}=nonce` }), env,
    deps({ sub: 'U0X', email: 'someone@gmail.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  assert.equal(response.status, 403);
});

test('a valid Efsora identity who is not a player still signs in', async () => {
  // They can browse; authorisation to submit is enforced separately.
  const response = await handleCallback(
    await callbackRequest(await validState(), { cookie: `${LOGIN_STATE_COOKIE}=nonce` }), env,
    deps({ sub: 'U0COLLEAGUE', email: 'someone@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  assert.equal(response.status, 302);
  assert.ok(response.headers.get('set-cookie'));
});

test('a callback with a valid identity but a misconfigured deployment returns 503, not 403', async () => {
  const misconfigured = { ...env, SLACK_TEAM_ID: undefined };
  const response = await handleCallback(
    await callbackRequest(await validState(), { cookie: `${LOGIN_STATE_COOKIE}=nonce` }), misconfigured,
    deps({ sub: 'U0AT8HQ7C9K', email: 'mirza.sahinkaya@efsora.com', 'https://slack.com/team_id': 'T0EFSORA' }),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
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
  const token = await signToken({ t: 'session', k: 'slack', sub: 'U0AT8HQ7C9K' }, env.SESSION_SECRET, {
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
  const token = await signToken({ t: 'session', k: 'slack', sub: 'U0AT8HQ7C9K' }, env.SESSION_SECRET, {
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

test('me reports a signed-in colleague who is not a player', async () => {
  const token = await signToken({ t: 'session', k: 'slack', sub: 'U0COLLEAGUE' }, env.SESSION_SECRET, {
    expiresInSeconds: 3600, nowSeconds: Math.floor(Date.now() / 1000),
  });
  const request = new Request('https://league.test/api/me', {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  const response = await handleMe(request, env, { makeStore: () => ({ read: async () => ({ league, sha: 's' }) }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedIn: true, player: null });
});

test('a callback state without its matching browser cookie is refused', async () => {
  // The login-CSRF case: a valid, correctly signed state captured from someone
  // else's sign-in, replayed in a browser that never visited /api/login.
  const state = await signToken({ t: 'login', n: 'nonce-abc' }, env.SESSION_SECRET, {
    expiresInSeconds: 600, nowSeconds: NOW,
  });
  const request = new Request(`https://league.test/api/callback?code=abc&state=${encodeURIComponent(state)}`);
  const response = await handleCallback(request, env, deps({
    sub: 'U0ATTACKER', email: 'attacker@efsora.com', 'https://slack.com/team_id': 'T0EFSORA',
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('a callback state with a mismatched browser cookie is refused', async () => {
  const state = await signToken({ t: 'login', n: 'nonce-abc' }, env.SESSION_SECRET, {
    expiresInSeconds: 600, nowSeconds: NOW,
  });
  const request = new Request(`https://league.test/api/callback?code=abc&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `${LOGIN_STATE_COOKIE}=a-different-nonce` },
  });
  const response = await handleCallback(request, env, deps({
    sub: 'U0AT8HQ7C9K', email: 'a@efsora.com', 'https://slack.com/team_id': 'T0EFSORA',
  }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('an OAuth state token cannot be used as a session cookie', async () => {
  // The exact attack: mint a state at /api/login, present it as league_session.
  const state = await signToken({ t: 'login', n: 'nonce' }, env.SESSION_SECRET, {
    expiresInSeconds: 600, nowSeconds: Math.floor(Date.now() / 1000),
  });
  const request = new Request('https://league.test/api/me', {
    headers: { cookie: `${SESSION_COOKIE}=${state}` },
  });
  const response = await handleMe(request, env, { makeStore: () => ({ read: async () => ({ league, sha: 's' }) }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedIn: false, player: null });
});

test('login issues a state whose nonce matches the cookie it sets', async () => {
  const response = await login({ request: new Request('https://league.test/api/login'), env });
  assert.equal(response.status, 302);

  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://slack.com/openid/connect/authorize');

  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie.startsWith(`${LOGIN_STATE_COOKIE}=`), cookie);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
    assert.ok(cookie.includes(flag), `${flag} missing from: ${cookie}`);
  }

  // The binding that makes the CSRF defence work: the cookie value must be the
  // same nonce that is signed inside the state.
  const nonce = cookie.slice(`${LOGIN_STATE_COOKIE}=`.length).split(';')[0];
  const state = location.searchParams.get('state');
  const verified = await verifyToken(state, env.SESSION_SECRET, {
    nowSeconds: Math.floor(Date.now() / 1000), expectType: 'login',
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.n, nonce);
});

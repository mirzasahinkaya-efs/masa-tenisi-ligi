import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handlePassphrasePost, clientBucket } from '../functions/api/passphrase.js';
import { handleMe } from '../functions/api/me.js';
import { verifyToken } from '../lib/session.js';
import { SESSION_COOKIE } from '../functions/_shared/http.js';

const NOW = 1_786_000_000;
const PASSPHRASE = 'kırmızı-raket-2026';
const league = JSON.parse(await readFile(new URL('../data/league.json', import.meta.url), 'utf8'));

// Deliberately long and distinctive: a one-character fixture like 't' appears
// by chance in words such as "true", which would make the no-secret-in-a-body
// assertion below impossible to pass rather than meaningful.
const env = {
  SESSION_SECRET: 'session-secret-fixture-Zx9',
  LEAGUE_PASSPHRASE: PASSPHRASE,
  GITHUB_TOKEN: 'github-token-fixture-Qw4',
  GITHUB_REPO: 'o/r',
};

/** Counts reads so the tests can prove the store is not touched when it must not be. */
function countingStore({ fail = false } = {}) {
  const state = { reads: 0 };
  return {
    state,
    deps: {
      nowSeconds: () => NOW,
      makeStore: () => ({
        read: async () => {
          state.reads += 1;
          if (fail) throw new Error('boom');
          return { league, sha: 's' };
        },
      }),
    },
  };
}

const post = (body, { ip } = {}) => new Request('https://league.test/api/passphrase', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(ip ? { 'cf-connecting-ip': ip } : {}),
  },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const cookieOf = (response) => response.headers.get('set-cookie');

function fakeKV() {
  const map = new Map();
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => { map.set(key, value); },
    delete: async (key) => { map.delete(key); },
  };
}

test('the right passphrase and a real player mint a session', async () => {
  const { deps } = countingStore();
  const response = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'tolga' }), env, deps,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, player: { id: 'tolga', short: 'Tolga E.' } });

  const cookie = cookieOf(response);
  assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`), cookie);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
    assert.ok(cookie.includes(flag), `${flag} missing from: ${cookie}`);
  }
});

test('the minted token names the player by roster id, under the player kind', async () => {
  const { deps } = countingStore();
  const response = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'defne' }), env, deps,
  );
  const token = cookieOf(response).slice(`${SESSION_COOKIE}=`.length).split(';')[0];
  const verified = await verifyToken(token, env.SESSION_SECRET, {
    nowSeconds: NOW, expectType: 'session',
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.k, 'player');
  assert.equal(verified.payload.sub, 'defne');
});

test('the minted token is not accepted as a login state', async () => {
  // Both kinds are signed with the same secret, so only the type claim
  // separates them. A session presented mid-OAuth must not verify.
  const { deps } = countingStore();
  const response = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'defne' }), env, deps,
  );
  const token = cookieOf(response).slice(`${SESSION_COOKIE}=`.length).split(';')[0];
  const asState = await verifyToken(token, env.SESSION_SECRET, {
    nowSeconds: NOW, expectType: 'login',
  });
  assert.deepEqual(asState, { ok: false, error: 'WRONG_TYPE' });
});

test('the cookie it sets is one /api/me resolves to that player', async () => {
  const { deps } = countingStore();
  const signIn = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'mirza' }), env, deps,
  );
  const cookie = cookieOf(signIn).split(';')[0];

  // nowSeconds is passed explicitly: the token is minted at the fixed fake NOW,
  // so letting handleMe read the real clock would make this test start failing
  // once wall-clock time passed NOW plus the session TTL.
  const me = await handleMe(
    new Request('https://league.test/api/me', { headers: { cookie } }),
    env,
    { nowSeconds: () => NOW, makeStore: () => ({ read: async () => ({ league, sha: 's' }) }) },
  );
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { signedIn: true, player: { id: 'mirza', short: 'Mirza Ş.' } });
});

test('a wrong passphrase is refused without a cookie or a store read', async () => {
  const { state, deps } = countingStore();
  const response = await handlePassphrasePost(
    post({ passphrase: 'not-it', playerId: 'tolga' }), env, deps,
  );
  assert.equal(response.status, 403);
  assert.equal(cookieOf(response), null);
  assert.equal(state.reads, 0, 'an unauthenticated caller must not make us call GitHub');
});

test('a missing passphrase field is refused', async () => {
  const { deps } = countingStore();
  for (const body of [{ playerId: 'tolga' }, { passphrase: '', playerId: 'tolga' }]) {
    const response = await handlePassphrasePost(post(body), env, deps);
    assert.equal(response.status, 403, JSON.stringify(body));
    assert.equal(cookieOf(response), null);
  }
});

test('an unset passphrase is a misconfiguration, not a refusal', async () => {
  const { state, deps } = countingStore();
  for (const broken of [
    { ...env, LEAGUE_PASSPHRASE: undefined },
    { ...env, LEAGUE_PASSPHRASE: '' },
    { ...env, SESSION_SECRET: undefined },
  ]) {
    const response = await handlePassphrasePost(
      post({ passphrase: PASSPHRASE, playerId: 'tolga' }), broken, deps,
    );
    assert.equal(response.status, 503);
    assert.equal(cookieOf(response), null);
  }
  assert.equal(state.reads, 0);
});

test('the right passphrase with an unknown player mints nothing', async () => {
  const { deps } = countingStore();
  for (const playerId of [undefined, '', 'nobody', 'U09LQ3PF6LC', 0, [], {}]) {
    const response = await handlePassphrasePost(
      post({ passphrase: PASSPHRASE, playerId }), env, deps,
    );
    assert.equal(response.status, 400, JSON.stringify(playerId));
    assert.equal(cookieOf(response), null);
  }
});

test('a Slack id is not accepted where a roster id belongs', async () => {
  // Tolga's Slack id. Accepting it would mean the two subject kinds are
  // interchangeable, which is exactly what the kind claim prevents.
  const { deps } = countingStore();
  const response = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'U09LQ3PF6LC' }), env, deps,
  );
  assert.equal(response.status, 400);
});

test('a body that is not a JSON object is refused', async () => {
  const { deps } = countingStore();
  for (const body of ['not json', '[]', 'null', '"a"', '3', 'true']) {
    const response = await handlePassphrasePost(post(body), env, deps);
    assert.equal(response.status, 400, body);
    assert.equal(cookieOf(response), null);
  }
});

test('an unreachable store is a 502, after the passphrase has been accepted', async () => {
  const { state, deps } = countingStore({ fail: true });
  const response = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'tolga' }), env, deps,
  );
  assert.equal(response.status, 502);
  assert.equal(cookieOf(response), null);
  assert.equal(state.reads, 1);
});

test('no response ever carries a secret', async () => {
  const { deps } = countingStore();
  for (const body of [
    { passphrase: PASSPHRASE, playerId: 'tolga' },
    { passphrase: 'wrong', playerId: 'tolga' },
    { passphrase: PASSPHRASE, playerId: 'nobody' },
  ]) {
    const response = await handlePassphrasePost(post(body), env, deps);
    // Headers as well as the body: the credential-derived material is in
    // Set-Cookie, so checking only the body would miss the likelier leak.
    const headers = [...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n');
    const text = `${await response.text()}\n${headers}`;
    for (const secret of [env.SESSION_SECRET, env.LEAGUE_PASSPHRASE, env.GITHUB_TOKEN]) {
      assert.ok(!text.includes(secret), `a secret appeared in a response: ${text}`);
    }
  }
});

test('repeated wrong guesses from one address are braked', async () => {
  const { deps } = countingStore();
  const LOGIN_KV = fakeKV();
  const guess = () => handlePassphrasePost(
    post({ passphrase: 'wrong', playerId: 'tolga' }, { ip: '198.51.100.7' }),
    { ...env, LOGIN_KV }, deps,
  );

  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await guess()).status, 403, `attempt ${attempt + 1}`);
  }
  assert.equal((await guess()).status, 429, 'the eleventh guess should be braked');

  // A different address is unaffected.
  const other = await handlePassphrasePost(
    post({ passphrase: 'wrong', playerId: 'tolga' }, { ip: '203.0.113.9' }),
    { ...env, LOGIN_KV }, deps,
  );
  assert.equal(other.status, 403);
});

test('a successful sign-in clears the attempt count', async () => {
  const { deps } = countingStore();
  const LOGIN_KV = fakeKV();
  const withKv = { ...env, LOGIN_KV };
  const ip = { ip: '198.51.100.8' };

  for (let attempt = 0; attempt < 9; attempt += 1) {
    await handlePassphrasePost(post({ passphrase: 'wrong', playerId: 'tolga' }, ip), withKv, deps);
  }
  const ok = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'tolga' }, ip), withKv, deps,
  );
  assert.equal(ok.status, 200);

  // Their own counter is forgiven; the global one is not. Clearing the global
  // counter on any success would let a guessing run top its budget back up
  // every time a colleague happened to sign in.
  assert.equal(LOGIN_KV.map.get('passphrase-attempts:198.51.100.8'), undefined);
  assert.equal(Number(LOGIN_KV.map.get('passphrase-attempts:global')), 10);

  const after = await handlePassphrasePost(
    post({ passphrase: 'wrong', playerId: 'tolga' }, ip), withKv, deps,
  );
  assert.equal(after.status, 403, 'not braked, because their own count was cleared');
});

test('the global ceiling catches a caller rotating addresses', async () => {
  const { deps } = countingStore();
  const LOGIN_KV = fakeKV();
  const withKv = { ...env, LOGIN_KV };

  // Never more than 9 guesses from one address, so the per-client brake never
  // fires. Without a global counter this would be unlimited.
  let braked = 0;
  for (let attempt = 0; attempt < 70; attempt += 1) {
    const response = await handlePassphrasePost(
      post({ passphrase: 'wrong', playerId: 'tolga' }, { ip: `198.51.100.${attempt % 200}` }),
      withKv, deps,
    );
    if (response.status === 429) braked += 1;
  }
  assert.ok(braked > 0, 'rotating addresses should still hit the global ceiling');
});

test('every way of writing one /64 lands in the same bucket', () => {
  // The compressed form is canonical and is what Cloudflare sends, so slicing
  // without expanding the '::' run would give one subscriber several buckets.
  const same = [
    '2001:db8::1',
    '2001:db8::2',
    '2001:0db8:0000:0000:0000:0000:0000:0003',
    '2001:db8:0:0:aaaa::1',
    '2001:db8::ffff:1',
    '2001:DB8::1',
    '2001:db8::1%eth0',
  ].map(clientBucket);
  assert.equal(new Set(same).size, 1, `expected one bucket, got ${JSON.stringify(same)}`);
});

test('a different /64 is a different bucket, and IPv4 is counted whole', () => {
  assert.notEqual(clientBucket('2001:db8:1:2::1'), clientBucket('2001:db8:3:4::1'));
  assert.equal(clientBucket('198.51.100.7'), '198.51.100.7');
  assert.notEqual(clientBucket('198.51.100.7'), clientBucket('198.51.100.8'));
});

test('an IPv6 caller cannot rotate freely inside its own /64', async () => {
  const { deps } = countingStore();
  const LOGIN_KV = fakeKV();
  const withKv = { ...env, LOGIN_KV };

  const guess = (suffix) => handlePassphrasePost(
    post({ passphrase: 'wrong', playerId: 'tolga' }, { ip: `2001:db8:1:2:${suffix}::1` }),
    withKv, deps,
  );

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await guess(attempt);
  }
  // A fresh address, same /64 — the subscriber, so the same bucket.
  assert.equal((await guess('ffff')).status, 429);
});

test('a request that did not arrive through Cloudflare is still counted', async () => {
  // No cf-connecting-ip means no trustworthy client key. Skipping the brake
  // entirely there would be a free unlimited guessing channel.
  const { deps } = countingStore();
  const LOGIN_KV = fakeKV();
  const withKv = { ...env, LOGIN_KV };

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await handlePassphrasePost(post({ passphrase: 'wrong', playerId: 'tolga' }), withKv, deps);
  }
  const response = await handlePassphrasePost(
    post({ passphrase: 'wrong', playerId: 'tolga' }), withKv, deps,
  );
  assert.equal(response.status, 429);
});

test('the brake fails open rather than locking the league out', async () => {
  const { deps } = countingStore();
  const broken = {
    get: async () => { throw new Error('kv down'); },
    put: async () => { throw new Error('kv down'); },
    delete: async () => { throw new Error('kv down'); },
  };
  const response = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'tolga' }, { ip: '198.51.100.9' }),
    { ...env, LOGIN_KV: broken }, deps,
  );
  assert.equal(response.status, 200);
});

test('with no KV bound at all, sign-in still works', async () => {
  const { deps } = countingStore();
  const response = await handlePassphrasePost(
    post({ passphrase: PASSPHRASE, playerId: 'tolga' }, { ip: '198.51.100.10' }), env, deps,
  );
  assert.equal(response.status, 200);
});

test('the store credentials are reported separately from the sign-in secrets', async () => {
  // Two different faults with two different fixes: "sign-in is not configured"
  // means LEAGUE_PASSPHRASE/SESSION_SECRET, "the store is not configured" means
  // GITHUB_TOKEN/GITHUB_REPO. One message for both would name the wrong variable.
  const body = { passphrase: PASSPHRASE, playerId: 'tolga' };

  const noStore = await handlePassphrasePost(post(body), {
    SESSION_SECRET: env.SESSION_SECRET, LEAGUE_PASSPHRASE: PASSPHRASE,
  }, { nowSeconds: () => NOW });
  assert.equal(noStore.status, 503);
  assert.match((await noStore.json()).error, /store is not configured/);

  const noSignIn = await handlePassphrasePost(post(body), {
    GITHUB_TOKEN: 't', GITHUB_REPO: 'o/r',
  }, { nowSeconds: () => NOW });
  assert.equal(noSignIn.status, 503);
  assert.match((await noSignIn.json()).error, /Sign-in is not configured/);
});

test('a wrong passphrase is still a refusal, not a configuration report', async () => {
  // The store guard sits AFTER the passphrase check on purpose: an anonymous
  // caller should not be able to probe the deployment's configuration.
  const response = await handlePassphrasePost(
    post({ passphrase: 'wrong', playerId: 'tolga' }),
    { SESSION_SECRET: env.SESSION_SECRET, LEAGUE_PASSPHRASE: PASSPHRASE },
    { nowSeconds: () => NOW },
  );
  assert.equal(response.status, 403);
});

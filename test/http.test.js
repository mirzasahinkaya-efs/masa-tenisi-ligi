import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  json, readCookie, sessionCookie, clearedCookie, SESSION_COOKIE,
} from '../functions/_shared/http.js';

const withCookies = (value) => new Request('https://example.test/', {
  headers: value === null ? {} : { cookie: value },
});

test('json responses carry the status and content type', async () => {
  const response = json({ hello: 'world' }, { status: 201 });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { hello: 'world' });
});

test('json responses are never stored', async () => {
  // /api/me decides which account state renders, so a cached copy would show a
  // stale signed-out page after a sign-in reloads the page.
  assert.equal(json({}).headers.get('cache-control'), 'no-store');
  assert.equal(json({}, { status: 503 }).headers.get('cache-control'), 'no-store');
});

test('an explicit header still wins over the defaults', () => {
  const response = json({}, { headers: { 'cache-control': 'max-age=60' } });
  assert.equal(response.headers.get('cache-control'), 'max-age=60');
});

test('a named cookie is read out of the header', () => {
  assert.equal(readCookie(withCookies(`a=1; ${SESSION_COOKIE}=abc; b=2`), SESSION_COOKIE), 'abc');
});

test('a missing cookie or header reads as null', () => {
  assert.equal(readCookie(withCookies('a=1'), SESSION_COOKIE), null);
  assert.equal(readCookie(withCookies(null), SESSION_COOKIE), null);
});

test('a cookie name that is a prefix of another is not confused for it', () => {
  assert.equal(readCookie(withCookies(`${SESSION_COOKIE}_backup=nope`), SESSION_COOKIE), null);
});

test('the session cookie carries every hardening flag', () => {
  const header = sessionCookie('token-value', { maxAgeSeconds: 3600 });
  assert.match(header, new RegExp(`^${SESSION_COOKIE}=token-value;`));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=3600']) {
    assert.ok(header.includes(flag), `${flag} missing from: ${header}`);
  }
});

test('clearing the cookie expires it and matches the cookie it must overwrite', () => {
  const header = clearedCookie();
  assert.ok(header.startsWith(`${SESSION_COOKIE}=;`), header);
  // Path must match what sessionCookie set, or the browser will not overwrite
  // the live cookie and logout silently leaves the session intact.
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) {
    assert.ok(header.includes(flag), `${flag} missing from: ${header}`);
  }
});

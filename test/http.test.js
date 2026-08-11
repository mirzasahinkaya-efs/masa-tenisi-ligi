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

test('a named cookie is read out of the header', () => {
  assert.equal(readCookie(withCookies('a=1; league_session=abc; b=2'), SESSION_COOKIE), 'abc');
});

test('a missing cookie or header reads as null', () => {
  assert.equal(readCookie(withCookies('a=1'), SESSION_COOKIE), null);
  assert.equal(readCookie(withCookies(null), SESSION_COOKIE), null);
});

test('a cookie name that is a prefix of another is not confused for it', () => {
  assert.equal(readCookie(withCookies('league_session_backup=nope'), SESSION_COOKIE), null);
});

test('the session cookie carries every hardening flag', () => {
  const header = sessionCookie('token-value', { maxAgeSeconds: 3600 });
  assert.match(header, /^league_session=token-value;/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=3600']) {
    assert.ok(header.includes(flag), `${flag} missing from: ${header}`);
  }
});

test('clearing the cookie expires it immediately', () => {
  const header = clearedCookie();
  assert.ok(header.includes('Max-Age=0'), header);
  assert.ok(header.includes('HttpOnly'), header);
});

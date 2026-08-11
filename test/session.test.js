import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../lib/session.js';

const SECRET = 'test-secret-value';
const NOW = 1_786_000_000;

test('a freshly signed token verifies and returns its payload', async () => {
  const token = await signToken({ sub: 'U0AT8HQ7C9K' }, SECRET, {
    expiresInSeconds: 60, nowSeconds: NOW,
  });
  const result = await verifyToken(token, SECRET, { nowSeconds: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.payload.sub, 'U0AT8HQ7C9K');
});

test('a token signed with a different secret is rejected', async () => {
  const token = await signToken({ sub: 'x' }, SECRET, { expiresInSeconds: 60, nowSeconds: NOW });
  const result = await verifyToken(token, 'other-secret', { nowSeconds: NOW });
  assert.deepEqual(result, { ok: false, error: 'BAD_SIGNATURE' });
});

test('a tampered payload is rejected', async () => {
  const token = await signToken({ sub: 'alice' }, SECRET, { expiresInSeconds: 60, nowSeconds: NOW });
  const [, signature] = token.split('.');
  const forged = `${btoa(JSON.stringify({ sub: 'bob', exp: NOW + 60 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${signature}`;
  const result = await verifyToken(forged, SECRET, { nowSeconds: NOW });
  assert.deepEqual(result, { ok: false, error: 'BAD_SIGNATURE' });
});

test('an expired token is rejected', async () => {
  const token = await signToken({ sub: 'x' }, SECRET, { expiresInSeconds: 60, nowSeconds: NOW });
  const result = await verifyToken(token, SECRET, { nowSeconds: NOW + 61 });
  assert.deepEqual(result, { ok: false, error: 'EXPIRED' });
});

test('a token still valid one second before expiry is accepted', async () => {
  const token = await signToken({ sub: 'x' }, SECRET, { expiresInSeconds: 60, nowSeconds: NOW });
  const result = await verifyToken(token, SECRET, { nowSeconds: NOW + 59 });
  assert.equal(result.ok, true);
});

test('garbage input is rejected without throwing', async () => {
  for (const bad of ['', 'nope', 'a.b.c', undefined, null]) {
    const result = await verifyToken(bad, SECRET, { nowSeconds: NOW });
    assert.equal(result.ok, false, String(bad));
    assert.ok(['MALFORMED', 'BAD_SIGNATURE'].includes(result.error), `${bad} -> ${result.error}`);
  }
});

test('a well-formed but unsigned token fails on the signature, not the parse', async () => {
  // Pins the verify-before-parse ordering. 'not-base64' decodes as valid
  // base64, so a parse-first implementation would report MALFORMED here.
  // Only a verify-first implementation reaches BAD_SIGNATURE.
  const result = await verifyToken('not-base64.also-not', SECRET, { nowSeconds: NOW });
  assert.deepEqual(result, { ok: false, error: 'BAD_SIGNATURE' });
});

test('a payload with Turkish characters round-trips intact', async () => {
  const payload = { sub: 'U0AT8HQ7C9K', short: 'Tuğberk G.', note: 'Şahinkaya çğıöşü' };
  const token = await signToken(payload, SECRET, { expiresInSeconds: 60, nowSeconds: NOW });
  const result = await verifyToken(token, SECRET, { nowSeconds: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.payload.short, 'Tuğberk G.');
  assert.equal(result.payload.note, 'Şahinkaya çğıöşü');
});

test('the signature is not a plain hash of the payload', async () => {
  // Guards against someone "simplifying" the HMAC away into a digest, which
  // would let anyone forge a token.
  const token = await signToken({ sub: 'x' }, SECRET, { expiresInSeconds: 60, nowSeconds: NOW });
  const [payload, signature] = token.split('.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.notEqual(signature, hex);
});

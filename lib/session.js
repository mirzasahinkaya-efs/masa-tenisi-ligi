const encoder = new TextEncoder();

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Compares two strings without leaking their difference through timing. */
function equalConstantTime(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function signToken(payload, secret, { expiresInSeconds, nowSeconds }) {
  const body = { ...payload, exp: nowSeconds + expiresInSeconds };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(body)));
  return `${encoded}.${toBase64Url(await hmac(encoded, secret))}`;
}

export async function verifyToken(token, secret, { nowSeconds, expectType } = {}) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'MALFORMED' };

  const [encoded, signature] = parts;
  const expected = toBase64Url(await hmac(encoded, secret));
  if (!equalConstantTime(expected, signature)) return { ok: false, error: 'BAD_SIGNATURE' };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch {
    return { ok: false, error: 'MALFORMED' };
  }

  if (typeof payload.exp !== 'number' || nowSeconds >= payload.exp) {
    return { ok: false, error: 'EXPIRED' };
  }
  // Both token kinds are signed with the same secret, so the type claim is what
  // stops an OAuth state token being presented as a session cookie.
  if (expectType && payload.t !== expectType) {
    return { ok: false, error: 'WRONG_TYPE' };
  }
  return { ok: true, payload };
}

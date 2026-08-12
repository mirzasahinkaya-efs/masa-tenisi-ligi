// The __Host- prefix makes the browser refuse the cookie unless it is Secure,
// Path=/ and has no Domain — which means a sibling subdomain cannot set or
// overwrite it. Both cookies already meet those conditions.
export const SESSION_COOKIE = '__Host-league_session';

export function json(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // /api/me decides which of the account panel's states renders, so a
      // stored copy would show a stale signed-out page after a sign-in
      // reloads. None of these responses is ever worth caching.
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function sessionCookie(value, { maxAgeSeconds }) {
  // `value` is interpolated unescaped. Safe because its only producer is
  // signToken(), whose output alphabet is base64url plus '.', so it can never
  // contain ';', ',' or a newline that would inject an attribute or split the
  // header. Any new caller must preserve that invariant.
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearedCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export const LOGIN_STATE_COOKIE = '__Host-login_state';

export function loginStateCookie(value, { maxAgeSeconds }) {
  return `${LOGIN_STATE_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearedLoginStateCookie() {
  return `${LOGIN_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

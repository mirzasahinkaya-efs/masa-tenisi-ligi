import { signToken, verifyToken } from '../../lib/session.js';
import { checkIdentity } from '../../lib/auth.js';
import {
  json, readCookie, sessionCookie, LOGIN_STATE_COOKIE, clearedLoginStateCookie,
} from '../_shared/http.js';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function buildAuthorizeUrl(env, state, redirectUri) {
  const url = new URL('https://slack.com/openid/connect/authorize');
  url.searchParams.set('client_id', env.SLACK_CLIENT_ID);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  // Pinning the workspace here is a convenience; the callback re-checks it,
  // because a redirect parameter is not a security control.
  url.searchParams.set('team', env.SLACK_TEAM_ID);
  return url.toString();
}

/** Claims only — the token came from an authenticated server-side exchange. */
function readClaims(idToken) {
  const [, payload] = String(idToken).split('.');
  if (!payload) return null;
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(payload.length / 4) * 4, '=');
  try {
    return JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    ));
  } catch {
    return null;
  }
}

async function exchangeCodeWithSlack(env, code, redirectUri) {
  const response = await fetch('https://slack.com/api/openid.connect.token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !body.id_token) return { ok: false };
  return { ok: true, idToken: body.id_token };
}

export async function handleCallback(request, env, deps = {}) {
  const nowSeconds = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const stateCheck = await verifyToken(state, env.SESSION_SECRET, { nowSeconds, expectType: 'login' });
  if (!code || !stateCheck.ok) {
    return json({ error: 'Sign-in could not be verified. Please start again.' }, { status: 403 });
  }

  // A signed, unexpired state alone does not prove this is the browser that
  // began the sign-in: /api/login is public, so anyone can mint one. Binding
  // it to a same-browser cookie stops a captured callback URL from being
  // replayed in someone else's browser to steal their session as the
  // original member's identity (login CSRF). Same message as the state
  // check above, so a caller cannot tell which of the two failed.
  const boundNonce = readCookie(request, LOGIN_STATE_COOKIE);
  if (!boundNonce || boundNonce !== stateCheck.payload.n) {
    return json({ error: 'Sign-in could not be verified. Please start again.' }, { status: 403 });
  }

  const redirectUri = new URL('/api/callback', url.origin).toString();
  const exchange = await (deps.exchangeCode ?? exchangeCodeWithSlack)(env, code, redirectUri);
  if (!exchange.ok) return json({ error: 'Slack sign-in failed.' }, { status: 403 });

  const claims = readClaims(exchange.idToken);
  if (!claims) return json({ error: 'Slack sign-in failed.' }, { status: 403 });

  const identity = checkIdentity(
    { teamId: claims['https://slack.com/team_id'], email: claims.email },
    { allowedTeamId: env.SLACK_TEAM_ID, allowedEmailDomain: env.ALLOWED_EMAIL_DOMAIN },
  );
  if (!identity.ok) {
    if (identity.error === 'MISCONFIGURED') {
      return json({ error: 'Sign-in is not configured. Please tell an admin.' }, { status: 503 });
    }
    return json({ error: 'Only Efsora Slack accounts can sign in.' }, { status: 403 });
  }

  const token = await signToken({ t: 'session', sub: claims.sub }, env.SESSION_SECRET, {
    expiresInSeconds: SESSION_TTL_SECONDS, nowSeconds,
  });
  // Two Set-Cookie headers: a plain object literal cannot hold duplicate
  // keys, so Headers#append is required to send both.
  const headers = new Headers({ location: '/' });
  headers.append('set-cookie', sessionCookie(token, { maxAgeSeconds: SESSION_TTL_SECONDS }));
  headers.append('set-cookie', clearedLoginStateCookie());
  return new Response(null, { status: 302, headers });
}

export const onRequestGet = ({ request, env }) => handleCallback(request, env);

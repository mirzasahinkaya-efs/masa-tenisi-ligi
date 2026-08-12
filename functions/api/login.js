import { signToken } from '../../lib/session.js';
import { buildAuthorizeUrl } from './callback.js';
import { json, loginStateCookie } from '../_shared/http.js';

const STATE_TTL_SECONDS = 600;

export async function handleLogin(request, env) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Without this the route is only nominally dormant: it would happily
  // redirect to Slack with `client_id=undefined` and dead-end on Slack's own
  // error page, which reads as our bug. Refusing up front makes an
  // unconfigured deployment say so.
  if (!env.SLACK_CLIENT_ID || !env.SLACK_TEAM_ID || !env.SESSION_SECRET) {
    return json({ error: 'Slack sign-in is not configured on this deployment.' }, { status: 503 });
  }

  // The state is a signed, short-lived token rather than a random value in a
  // store: it proves the callback began at our own /api/login without needing
  // server-side state.
  const nonce = crypto.randomUUID();
  const state = await signToken({ t: 'login', n: nonce }, env.SESSION_SECRET, {
    expiresInSeconds: STATE_TTL_SECONDS, nowSeconds,
  });
  const redirectUri = new URL('/api/callback', new URL(request.url).origin).toString();
  return new Response(null, {
    status: 302,
    headers: {
      location: buildAuthorizeUrl(env, state, redirectUri),
      // Binds the state to THIS browser. A captured callback URL replayed in
      // anyone else's browser has no matching cookie and is refused.
      'set-cookie': loginStateCookie(nonce, { maxAgeSeconds: STATE_TTL_SECONDS }),
    },
  });
}

export const onRequestGet = ({ request, env }) => handleLogin(request, env);

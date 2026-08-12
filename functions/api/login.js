import { signToken } from '../../lib/session.js';
import { buildAuthorizeUrl } from './callback.js';
import { loginStateCookie } from '../_shared/http.js';

const STATE_TTL_SECONDS = 600;

export async function onRequestGet({ request, env }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // The state is a signed, short-lived token rather than a random value in a
  // store: it proves the callback began at our own /api/login without needing
  // server-side state.
  const nonce = crypto.randomUUID();
  const state = await signToken({ n: nonce }, env.SESSION_SECRET, {
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

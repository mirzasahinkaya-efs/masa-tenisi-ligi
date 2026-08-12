import { signToken } from '../../lib/session.js';
import { buildAuthorizeUrl } from './callback.js';

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
  return Response.redirect(buildAuthorizeUrl(env, state, redirectUri), 302);
}

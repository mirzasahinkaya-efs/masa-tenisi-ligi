import { verifyToken } from '../../lib/session.js';
import { playerForSlackId } from '../../lib/auth.js';
import { createStore } from '../_shared/store.js';
import { json, readCookie, SESSION_COOKIE } from '../_shared/http.js';

export async function onRequestGet({ request, env }) {
  const token = readCookie(request, SESSION_COOKIE);
  const session = await verifyToken(token, env.SESSION_SECRET, {
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!session.ok) return json({ signedIn: false, player: null });

  const store = createStore({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO });
  const { league } = await store.read();
  const player = playerForSlackId(league, session.payload.sub);
  return json({
    signedIn: true,
    player: player ? { id: player.id, short: player.short } : null,
  });
}

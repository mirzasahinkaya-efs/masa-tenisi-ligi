import { verifyToken } from '../../lib/session.js';
import { playerForSlackId } from '../../lib/auth.js';
import { createStore } from '../_shared/store.js';
import { json, readCookie, SESSION_COOKIE } from '../_shared/http.js';

export async function handleMe(request, env, deps = {}) {
  const token = readCookie(request, SESSION_COOKIE);
  const session = await verifyToken(token, env.SESSION_SECRET, {
    nowSeconds: Math.floor(Date.now() / 1000), expectType: 'session',
  });
  if (!session.ok) return json({ signedIn: false, player: null });

  const store = (deps.makeStore ?? createStore)({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO });

  let league;
  try {
    ({ league } = await store.read());
  } catch {
    // The session is valid but the roster is unreachable. Do not claim the
    // caller is signed out, and do not claim they are not a player — both
    // would be wrong. A 503 lets the page fall back to read-only.
    return json({ signedIn: true, player: null, rosterUnavailable: true }, { status: 503 });
  }

  const player = playerForSlackId(league, session.payload.sub);
  return json({
    signedIn: true,
    player: player ? { id: player.id, short: player.short } : null,
  });
}

export const onRequestGet = ({ request, env }) => handleMe(request, env);

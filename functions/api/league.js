import { createStore, storeConfigured } from '../_shared/store.js';
import { json } from '../_shared/http.js';

/**
 * The league, read live from the repository instead of served as a build
 * artifact.
 *
 * `data/league.json` is a static file, so a recorded result is invisible until
 * the site redeploys — about a minute of CI. This reads the same file through
 * the API the writer already uses, so a result shows up as soon as it is
 * committed.
 *
 * Cached briefly at the edge rather than not at all: every page load would
 * otherwise spend a GitHub API call, and ten seconds of staleness is invisible
 * next to a redeploy. `json()` defaults to no-store, so this overrides it.
 */
export async function handleLeagueGet(env, deps = {}) {
  // An unconfigured deployment is a configuration fault, not an empty league —
  // and the client falls back to the static file either way.
  if (!storeConfigured(env)) {
    return json({ error: 'Live league data is not configured.' }, { status: 503 });
  }

  const store = (deps.makeStore ?? (() => createStore({
    token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO,
  })))();

  let league;
  try {
    ({ league } = await store.read());
  } catch {
    return json({ error: 'Could not reach the league data.' }, { status: 502 });
  }

  return json(league, {
    headers: { 'cache-control': 'public, s-maxage=10, stale-while-revalidate=30' },
  });
}

export const onRequestGet = ({ env }) => handleLeagueGet(env);

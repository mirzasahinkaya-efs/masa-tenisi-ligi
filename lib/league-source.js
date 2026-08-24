/**
 * Loads the league, preferring live data over the build artifact.
 *
 * Two sources, because the site is served from more than one host:
 *
 *   live    an endpoint that reads the repository on request, so a recorded
 *           result appears at once. Only exists where /api/* runs.
 *   static  data/league.json as deployed. Always present, but frozen at the
 *           last build — about a minute behind on a host with an API, and the
 *           only source at all on a static host.
 *
 * Falls back on ANY live failure: a 404 where no API is deployed, a 503 where
 * it is deployed but unconfigured, a 502 when the repository is unreachable, a
 * body that is not JSON, or a network error.
 *
 * The shape check is the load-bearing part. A static host serves its own HTML
 * for an unknown path, and some answer 200 while doing it — so "the request
 * succeeded" is not evidence the body is a league. Anything without a players
 * array is treated as a miss rather than parsed into a broken page.
 */
export const LIVE_PATH = './api/league';
export const STATIC_PATH = './data/league.json';

export async function loadLeague(
  fetchImpl, { livePath = LIVE_PATH, staticPath = STATIC_PATH } = {},
) {
  if (livePath) {
    try {
      const response = await fetchImpl(livePath, { cache: 'no-store' });
      if (response.ok) {
        const body = await response.json();
        if (isLeague(body)) return { league: body, source: 'live' };
      }
    } catch {
      // Unreachable, or a body that would not parse. The static file is next.
    }
  }

  const response = await fetchImpl(staticPath, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const league = await response.json();
  if (!isLeague(league)) throw new Error('league data is missing its players');
  return { league, source: 'static' };
}

/** The minimum every renderer needs before it can draw anything at all. */
function isLeague(value) {
  return Boolean(value)
    && Array.isArray(value.players)
    && Array.isArray(value.fixtures)
    && Array.isArray(value.results)
    && isGroupMap(value.groups);
}

/**
 * A map of group name to member ids. Checked properly rather than for
 * truthiness: callers do `Object.values(groups).find((ids) => ids.includes(id))`,
 * and a plain string is truthy while `Object.values('no')` yields `['n', 'o']` —
 * which would search characters for a player and quietly find nobody.
 */
function isGroupMap(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const groups = Object.values(value);
  return groups.length > 0 && groups.every(Array.isArray);
}

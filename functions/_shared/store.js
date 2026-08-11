const API = 'https://api.github.com';

/** Chunked so a large file cannot blow the argument limit of a spread call. */
function toBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * Reads and writes data/league.json through the GitHub Contents API. Writes
 * carry the blob sha they were based on, so two players submitting at the same
 * moment produce a 409 that is retried rather than one silently overwriting
 * the other.
 */
export function createStore({
  token, repo, branch = 'main', path = 'data/league.json', fetchImpl = fetch,
}) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'masa-tenisi-ligi',
    'x-github-api-version': '2022-11-28',
  };

  async function read() {
    const url = `${API}/repos/${repo}/contents/${path}?ref=${branch}`;
    const response = await fetchImpl(url, { headers, cf: { cacheTtl: 0 } });
    if (!response.ok) {
      const error = new Error(`Reading ${path} failed with ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const body = await response.json();
    const text = new TextDecoder().decode(
      Uint8Array.from(atob(body.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
    );
    return { league: JSON.parse(text), sha: body.sha };
  }

  async function commit(league, message, sha) {
    const content = toBase64(new TextEncoder().encode(`${JSON.stringify(league, null, 2)}\n`));
    const response = await fetchImpl(`${API}/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message, content, sha, branch }),
    });
    if (response.status === 409) return { ok: false, error: 'CONFLICT', status: 409 };
    if (!response.ok) return { ok: false, error: 'FAILED', status: response.status };
    return { ok: true };
  }

  async function update(mutate, { attempts = 3 } = {}) {
    let last = { ok: false, error: 'CONFLICT' };
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let current;
      try {
        current = await read();
      } catch (error) {
        // read() throws on a non-OK response. update()'s contract promises a
        // result object, so a GitHub failure must not escape as a rejection.
        return { ok: false, error: 'READ_FAILED', status: error.status };
      }

      let next;
      try {
        next = mutate(current.league);
      } catch (error) {
        return { ok: false, error: 'REJECTED', reason: error.message };
      }

      const result = await commit(next.league, next.message, current.sha);
      if (result.ok) return { ok: true, league: next.league };
      if (result.error !== 'CONFLICT') return result;
      last = { ok: false, error: 'CONFLICT' };
    }
    return last;
  }

  return { read, commit, update };
}

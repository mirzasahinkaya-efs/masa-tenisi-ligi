import { signToken } from '../../lib/session.js';
import { passphraseMatches } from '../../lib/passphrase.js';
import { playerById } from '../../lib/auth.js';
import { createStore, storeConfigured } from '../_shared/store.js';
import { json, sessionCookie } from '../_shared/http.js';

// Shorter than the Slack route's 30 days: a shared passphrase is a materially
// weaker credential, and rotating it does not end sessions already issued.
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
const MAX_ATTEMPTS_PER_CLIENT = 10;
const MAX_ATTEMPTS_GLOBAL = 60;
const ATTEMPT_WINDOW_SECONDS = 600;

/**
 * Groups an address into the bucket the brake counts against. A single IPv6
 * client is routinely handed a whole /64, so counting the full address would
 * let it rotate through addresses for free; the first four hextets identify the
 * subscriber. IPv4 is counted whole.
 *
 * The `::` run has to be expanded before slicing, because the compressed form is
 * the canonical one and the one Cloudflare sends. Slicing `2001:db8::1` and
 * `2001:db8::2` unexpanded yields two different buckets for one subscriber —
 * exactly the rotation this exists to stop.
 */
export function clientBucket(ip) {
  if (typeof ip !== 'string' || !ip.includes(':')) return String(ip);

  const address = ip.toLowerCase().split('%')[0];
  const [head, tail] = address.split('::');
  let hextets;
  if (tail === undefined) {
    hextets = address.split(':');
  } else {
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const gap = Math.max(8 - left.length - right.length, 0);
    hextets = [...left, ...Array(gap).fill('0'), ...right];
  }
  return hextets.slice(0, 4).map((hextet) => hextet.padStart(4, '0')).join(':');
}

/**
 * A best-effort brute-force brake. One shared passphrase on a public URL is
 * guessable at machine speed without something slowing the guesses down.
 *
 * Two counters, because either alone has a hole. Per-client alone is defeated
 * by rotating addresses; global alone lets one noisy client lock out the
 * league. The global ceiling is set well above what a dozen people mistyping
 * could reach in ten minutes.
 *
 * It fails OPEN on purpose. A KV outage must not lock the whole league out of
 * reporting scores, and the cost of a missed brake is a wrong table-tennis
 * result that git history makes trivial to spot and revert. Read-then-write is
 * also not atomic, so parallel guesses undercount — it is a brake, not a quota.
 */
async function overAttemptLimit(request, env) {
  if (!env.LOGIN_KV) return { limited: false };

  // Set by Cloudflare on the way in, so a caller cannot forge it. If it is
  // absent the request did not arrive through Cloudflare, so there is no
  // trustworthy client key — fall back to counting it globally only, rather
  // than skipping the brake altogether.
  const ip = request.headers.get('cf-connecting-ip');
  const clientKey = ip ? `passphrase-attempts:${clientBucket(ip)}` : null;
  const keys = [['passphrase-attempts:global', MAX_ATTEMPTS_GLOBAL]];
  if (clientKey) keys.unshift([clientKey, MAX_ATTEMPTS_PER_CLIENT]);

  try {
    const counts = await Promise.all(keys.map(([key]) => env.LOGIN_KV.get(key)));
    if (counts.some((count, index) => (Number(count) || 0) >= keys[index][1])) {
      return { limited: true };
    }
    await Promise.all(keys.map(([key], index) => env.LOGIN_KV.put(
      key, String((Number(counts[index]) || 0) + 1), { expirationTtl: ATTEMPT_WINDOW_SECONDS },
    )));
    return {
      limited: false,
      // Only the caller's own counter is forgiven. Clearing the global one on
      // any success would let a guessing run top its budget back up every time
      // a colleague happened to sign in.
      clear: clientKey ? () => env.LOGIN_KV.delete(clientKey).catch(() => {}) : null,
    };
  } catch {
    return { limited: false };
  }
}

export async function handlePassphrasePost(request, env, deps = {}) {
  const nowSeconds = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();

  // An unset passphrase or signing secret is a deployment fault, not a refused
  // sign-in, and must not read as "wrong passphrase" to whoever is debugging it.
  if (!env.LEAGUE_PASSPHRASE || !env.SESSION_SECRET) {
    return json({ error: 'Sign-in is not configured. Please tell an admin.' }, { status: 503 });
  }

  // The brake runs before the body is read, so a flood of malformed requests
  // is counted rather than being a free way to avoid counting.
  const limit = await overAttemptLimit(request, env);
  if (limit.limited) {
    // The only line that writes to the log. Without it a guessing run against a
    // public URL is completely invisible — the brake is silent and fails open,
    // so nothing else would ever notice. Deliberately carries no request data:
    // no address, no submitted value, nothing derived from either.
    console.warn('passphrase sign-in braked: attempt limit reached');
    return json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'Expected a JSON object.' }, { status: 400 });
  }

  // Checked before the roster is fetched: an unauthenticated caller should not
  // be able to make us call GitHub, nor learn from the response whether the
  // league data is reachable.
  if (!await passphraseMatches(body.passphrase, env.LEAGUE_PASSPHRASE)) {
    return json({ error: 'That passphrase is not right.' }, { status: 403 });
  }

  if (!deps.makeStore && !storeConfigured(env)) {
    return json({ error: 'The league data store is not configured. Please tell an admin.' }, { status: 503 });
  }

  const store = (deps.makeStore ?? (() => createStore({
    token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO,
  })))();

  let league;
  try {
    ({ league } = await store.read());
  } catch {
    return json({ error: 'Could not reach the league data. Please try again.' }, { status: 502 });
  }

  const player = playerById(league, body.playerId);
  if (!player) {
    return json({ error: 'Please pick your name from the list.' }, { status: 400 });
  }

  // `k: 'player'` records that the subject is a roster id proven by passphrase,
  // not a Slack identity. playerForSubject refuses to resolve it any other way.
  const token = await signToken(
    { t: 'session', k: 'player', sub: player.id },
    env.SESSION_SECRET,
    { expiresInSeconds: SESSION_TTL_SECONDS, nowSeconds },
  );

  if (limit.clear) await limit.clear();

  return json(
    { ok: true, player: { id: player.id, short: player.short } },
    { headers: { 'set-cookie': sessionCookie(token, { maxAgeSeconds: SESSION_TTL_SECONDS }) } },
  );
}

export const onRequestPost = ({ request, env }) => handlePassphrasePost(request, env);

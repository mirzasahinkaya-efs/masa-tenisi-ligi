const encoder = new TextEncoder();

const digest = async (value) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

/**
 * Compares by digest rather than character by character. Two digests are always
 * the same length, so unlike a direct string comparison this cannot exit early
 * and leaks nothing about how long the real passphrase is.
 *
 * An empty expected value is never a match: an unset secret must not turn into
 * a passphrase that anybody can guess by submitting nothing.
 */
export async function passphraseMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;

  // Both sides are trimmed. No passphrase is meant to begin or end with
  // whitespace, and the ordinary way a stored one acquires a trailing newline is
  // an operator piping `console.log` into the clipboard. That then fails forever
  // against the web form, because a single-line password input drops newlines
  // from a paste — so the two values differ by a character neither end can see.
  // Refusing to trim buys no security and costs an undiagnosable refusal.
  const candidate = supplied.trim();
  const secret = expected.trim();
  // An unset or whitespace-only secret must not become one anybody can guess by
  // submitting a space.
  if (candidate === '' || secret === '') return false;

  const [a, b] = await Promise.all([digest(candidate), digest(secret)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

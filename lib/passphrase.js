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
  if (supplied === '' || expected === '') return false;

  const [a, b] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

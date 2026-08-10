import { seededShuffle } from './random.js';

/** Splits a roster as evenly as possible, with the larger half in group A. */
export function defaultSizes(count) {
  return { A: Math.ceil(count / 2), B: Math.floor(count / 2) };
}

/**
 * Splits the roster into groups. The seed is committed to the repo so the
 * draw can be reproduced and checked by anyone.
 */
export function drawGroups(playerIds, seed, sizes = defaultSizes(playerIds.length)) {
  const expected = Object.values(sizes).reduce((total, size) => total + size, 0);
  if (playerIds.length !== expected) {
    throw new Error(
      `Roster has ${playerIds.length} players but group sizes total ${expected}`,
    );
  }

  const shuffled = seededShuffle(playerIds, seed);
  const groups = {};
  let cursor = 0;
  for (const [name, size] of Object.entries(sizes)) {
    groups[name] = shuffled.slice(cursor, cursor + size).sort();
    cursor += size;
  }
  return groups;
}

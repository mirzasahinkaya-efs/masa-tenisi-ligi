import { seededShuffle } from './random.js';

/*
 * Eight-entrant bracket. The top three of each group qualify outright, the
 * better of the two fourth-placed players takes the seventh place, and the CEO
 * joins as an eighth who plays no group stage.
 *
 * The pairings are chosen so that:
 *
 *  - No quarter-final can be a rematch. Every group slot faces a slot from the
 *    other group, and BEST4 — which could come from either group — is given the
 *    CEO, the one entrant who belongs to no group at all.
 *  - The two group winners are in opposite halves, so they can only meet in the
 *    final. A1 is with the CEO/BEST4 tie and so has the softer semi-final route;
 *    which players are in A rather than B was set by the public seeded draw, so
 *    that advantage is arbitrary rather than awarded.
 *
 * Frozen at both levels: this constant is shared module state imported by the
 * site and by the API, so an in-place edit in one consumer would corrupt
 * seeding in the other.
 */
export const PLAYOFF_FIXTURES = Object.freeze([
  Object.freeze({ id: 'QF1', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 1', slotP1: 'A1', slotP2: 'B3' }),
  Object.freeze({ id: 'QF2', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 2', slotP1: '@tugkan', slotP2: 'BEST4' }),
  Object.freeze({ id: 'QF3', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 3', slotP1: 'B1', slotP2: 'A3' }),
  Object.freeze({ id: 'QF4', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 4', slotP1: 'A2', slotP2: 'B2' }),
  Object.freeze({ id: 'SF1', stage: 'playoff', phase: 'Semi-finals', label: 'Semi-final 1', slotP1: 'W-QF1', slotP2: 'W-QF2' }),
  Object.freeze({ id: 'SF2', stage: 'playoff', phase: 'Semi-finals', label: 'Semi-final 2', slotP1: 'W-QF3', slotP2: 'W-QF4' }),
  Object.freeze({ id: 'FINAL', stage: 'playoff', phase: 'Final', label: 'Final', slotP1: 'W-SF1', slotP2: 'W-SF2' }),
  Object.freeze({ id: 'THIRD', stage: 'playoff', phase: 'Final', label: 'Third place', slotP1: 'L-SF1', slotP2: 'L-SF2' }),
]);

/** `W-QF3` / `L-SF1` — the winner or loser of an earlier playoff match. */
const MATCH_SLOT = /^([WL])-(QF[1-4]|SF[12])$/;
/** `A1` … `B3` — a finishing position in a group table. */
const GROUP_SLOT = /^([AB])([1-9])$/;
/** `@tugkan` — a fixed entrant who plays no group stage. */
const FIXED_SLOT = /^@(.+)$/;
/** `BEST4` — the better fourth place, compared across both groups. */
const BEST_FOURTH_SLOT = 'BEST4';

/** How many of each group qualify without needing the cross-group comparison. */
export const QUALIFY_PER_GROUP = 3;

/**
 * The stronger of the groups' fourth-placed players.
 *
 * They are in different groups, so they never met and head-to-head — the group
 * table's first tiebreak — simply does not exist here. What remains is points,
 * then game difference, then games won, then a seeded draw over the whole field.
 *
 * Expects `computeTable` output: fourth place is read by index, so an unsorted
 * table would quietly yield the wrong row.
 *
 * Returns null unless at least two groups actually have a fourth place. This is
 * deliberately not gated on the groups being finished: the site shows the
 * provisional holder of the slot all season, while resolveBracket only consults
 * it once every group is complete.
 */
export function bestFourthPlayerId(tables, drawSeed) {
  const fourths = Object.values(tables)
    .map((table) => table[QUALIFY_PER_GROUP])
    .filter(Boolean);
  if (fourths.length < 2) return null;

  // Drawn over every player in the tables, not just the two candidates. A
  // two-element shuffle is a single swap, so for roughly half of all seeds —
  // including this league's — it is the identity, and a dead heat would come
  // down to whose id sorts first while the docs claimed a seeded draw. Taking
  // positions from the whole field makes that last tiebreak genuinely
  // seed-derived.
  //
  // Sorted before shuffling so the draw is a function of the id SET and the
  // seed alone, never of which group a caller happened to pass first.
  const field = Object.values(tables).flat().map((row) => row.playerId).sort();
  // mulberry32 does `seed >>> 0`, which turns undefined, null, NaN and a string
  // all into 0 — so a missing seed would still shuffle, just from a seed nobody
  // chose. Falling back to id order instead keeps the rule one a reader can
  // state out loud.
  const order = new Map(
    (Number.isFinite(drawSeed) ? seededShuffle(field, drawSeed) : field)
      .map((id, index) => [id, index]),
  );

  const [best] = [...fourths].sort((a, b) => (
    b.points - a.points
    || b.gameDiff - a.gameDiff
    || b.gamesWon - a.gamesWon
    || order.get(a.playerId) - order.get(b.playerId)
  ));
  return best.playerId;
}

/** True once every group fixture for this group has a recorded result. */
export function isGroupComplete(groupName, fixtures, results) {
  const played = new Set(results.map((r) => r.fixtureId));
  const own = fixtures.filter((f) => f.stage === 'group' && f.group === groupName);
  // An empty set must not count as complete: [].every() is true, which would
  // let a caller passing the wrong fixtures publish fabricated qualifiers.
  return own.length > 0 && own.every((f) => played.has(f.id));
}

/**
 * Fills in whichever bracket slots are decided. Unresolved slots come back as
 * null so the site can show the placeholder instead.
 */
export function resolveBracket(tables, fixtures, results, { drawSeed } = {}) {
  const qualified = new Map();
  let completeGroups = 0;
  for (const [groupName, table] of Object.entries(tables)) {
    if (!isGroupComplete(groupName, fixtures, results)) continue;
    completeGroups += 1;
    table.forEach((row, index) => qualified.set(`${groupName}${index + 1}`, row.playerId));
  }

  // The cross-group slot needs EVERY group finished, not just one: a fourth
  // place cannot be measured against a group that is still playing.
  const bestFourth = completeGroups === Object.keys(tables).length
    ? bestFourthPlayerId(tables, drawSeed)
    : null;

  const resultsByFixture = new Map(results.map((r) => [r.fixtureId, r]));

  const resolveSlot = (slot, depth = 0) => {
    // The bracket is three matches deep; the guard is a cheap backstop against
    // a future definition that accidentally referred to itself.
    if (depth > PLAYOFF_FIXTURES.length) return null;

    const fixed = FIXED_SLOT.exec(slot);
    if (fixed) return fixed[1];

    if (slot === BEST_FOURTH_SLOT) return bestFourth;

    if (qualified.has(slot)) return qualified.get(slot);
    if (GROUP_SLOT.test(slot)) return null;

    const match = MATCH_SLOT.exec(slot);
    if (!match) return null;

    const [, which, matchId] = match;
    const result = resultsByFixture.get(matchId);
    if (!result) return null;

    const source = PLAYOFF_FIXTURES.find((f) => f.id === matchId);
    const p1 = resolveSlot(source.slotP1, depth + 1);
    const p2 = resolveSlot(source.slotP2, depth + 1);
    if (!p1 || !p2) return null;

    const p1Won = result.p1Games > result.p2Games;
    if (which === 'W') return p1Won ? p1 : p2;
    return p1Won ? p2 : p1;
  };

  return PLAYOFF_FIXTURES.map((fixture) => ({
    ...fixture,
    p1: resolveSlot(fixture.slotP1),
    p2: resolveSlot(fixture.slotP2),
    result: resultsByFixture.get(fixture.id) ?? null,
  }));
}

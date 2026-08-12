/*
 * Eight-entrant bracket: the top four of Group A and the top three of Group B
 * qualify, and the CEO joins as an unseeded eighth who plays no group stage.
 * Seeding is A1 > B1 > A2 > B2 > A3 > B3 > A4 with the CEO at 8, arranged
 * 1v8 / 4v5 / 3v6 / 2v7 so no quarter-final pairs two players from one group.
 *
 * Frozen at both levels: this constant is shared module state imported by the
 * site and by the API, so an in-place edit in one consumer would corrupt
 * seeding in the other.
 */
export const PLAYOFF_FIXTURES = Object.freeze([
  Object.freeze({ id: 'QF1', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 1', slotP1: 'A1', slotP2: '@tugkan' }),
  Object.freeze({ id: 'QF2', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 2', slotP1: 'B2', slotP2: 'A3' }),
  Object.freeze({ id: 'QF3', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 3', slotP1: 'A2', slotP2: 'B3' }),
  Object.freeze({ id: 'QF4', stage: 'playoff', phase: 'Quarter-finals', label: 'Quarter-final 4', slotP1: 'B1', slotP2: 'A4' }),
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
export function resolveBracket(tables, fixtures, results) {
  const qualified = new Map();
  for (const [groupName, table] of Object.entries(tables)) {
    if (!isGroupComplete(groupName, fixtures, results)) continue;
    table.forEach((row, index) => qualified.set(`${groupName}${index + 1}`, row.playerId));
  }

  const resultsByFixture = new Map(results.map((r) => [r.fixtureId, r]));

  const resolveSlot = (slot, depth = 0) => {
    // The bracket is three matches deep; the guard is a cheap backstop against
    // a future definition that accidentally referred to itself.
    if (depth > PLAYOFF_FIXTURES.length) return null;

    const fixed = FIXED_SLOT.exec(slot);
    if (fixed) return fixed[1];

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

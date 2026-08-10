export const PLAYOFF_FIXTURES = Object.freeze([
  { id: 'SF1', stage: 'playoff', label: 'Semifinal 1', slotP1: 'A1', slotP2: 'B2' },
  { id: 'SF2', stage: 'playoff', label: 'Semifinal 2', slotP1: 'B1', slotP2: 'A2' },
  { id: 'FINAL', stage: 'playoff', label: 'Final', slotP1: 'W-SF1', slotP2: 'W-SF2' },
  { id: 'THIRD', stage: 'playoff', label: 'Third place', slotP1: 'L-SF1', slotP2: 'L-SF2' },
]);

const SEMI_SLOT = /^([WL])-(SF[12])$/;

/** True once every group fixture for this group has a recorded result. */
export function isGroupComplete(groupName, fixtures, results) {
  const played = new Set(results.map((r) => r.fixtureId));
  return fixtures
    .filter((f) => f.stage === 'group' && f.group === groupName)
    .every((f) => played.has(f.id));
}

/**
 * Fills in whichever bracket slots are decided. Unresolved slots come back
 * as null so the site can show the placeholder ("A1", "W-SF1") instead.
 */
export function resolveBracket(tables, fixtures, results) {
  const qualified = new Map();
  for (const [groupName, table] of Object.entries(tables)) {
    if (!isGroupComplete(groupName, fixtures, results)) continue;
    if (table.length >= 1) qualified.set(`${groupName}1`, table[0].playerId);
    if (table.length >= 2) qualified.set(`${groupName}2`, table[1].playerId);
  }

  const resultsByFixture = new Map(results.map((r) => [r.fixtureId, r]));

  const resolveSlot = (slot) => {
    if (qualified.has(slot)) return qualified.get(slot);

    const match = SEMI_SLOT.exec(slot);
    if (!match) return null;

    const [, which, semiId] = match;
    const result = resultsByFixture.get(semiId);
    if (!result) return null;

    const semi = PLAYOFF_FIXTURES.find((f) => f.id === semiId);
    const p1 = resolveSlot(semi.slotP1);
    const p2 = resolveSlot(semi.slotP2);
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

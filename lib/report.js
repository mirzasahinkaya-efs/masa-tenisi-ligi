import { computeTable } from './standings.js';
import { resolveBracket } from './bracket.js';

/**
 * Finds the player a human meant by a short, imprecise query. Tiers are
 * tried in order and the search stops at the first tier that matches
 * anything at all — a single match there wins outright, several matches
 * there are ambiguous, and we never fall through to a looser tier just
 * because it might have produced a unique hit.
 */
export function resolvePlayer(league, query) {
  const raw = String(query ?? '');
  const lower = raw.toLowerCase();

  const tiers = [
    (player) => player.id === raw,
    (player) => player.id.toLowerCase().startsWith(lower),
    (player) => player.short.toLowerCase().includes(lower) || player.name.toLowerCase().includes(lower),
  ];

  for (const matches of tiers) {
    const found = league.players.filter(matches);
    if (found.length === 1) return { ok: true, id: found[0].id };
    if (found.length > 1) {
      return { ok: false, error: 'AMBIGUOUS', candidates: found.map((player) => player.id) };
    }
  }

  return { ok: false, error: 'NOT_FOUND', candidates: [] };
}

/**
 * Every fixture a result could currently be recorded against: all group
 * fixtures, plus playoff fixtures whose slots have resolved to two real
 * players. A playoff fixture with an unresolved slot (still "A1", "W-SF1",
 * etc.) cannot receive a result yet, so it is left out entirely rather than
 * exposed with a null p1/p2.
 */
export function playableFixtures(league) {
  const groupFixtures = league.fixtures.map((fixture) => ({
    id: fixture.id,
    stage: fixture.stage,
    round: fixture.round,
    p1: fixture.p1,
    p2: fixture.p2,
  }));

  const tables = Object.fromEntries(
    Object.entries(league.groups).map(([groupName, playerIds]) => [
      groupName,
      computeTable(playerIds, league.fixtures, league.results, league.rules, league.season.drawSeed),
    ]),
  );

  const bracket = resolveBracket(tables, league.fixtures, league.results);
  const playoffFixtures = bracket
    .filter((match) => match.p1 !== null && match.p2 !== null)
    .map((match) => ({ id: match.id, stage: 'playoff', round: null, p1: match.p1, p2: match.p2 }));

  return [...groupFixtures, ...playoffFixtures];
}

/**
 * The one fixture between two players that still needs a result. Group
 * fixtures sort before playoff fixtures (`round: null` is treated as
 * infinitely late) so a group match is always offered before a later
 * playoff meeting between the same pair.
 */
export function findOpenFixture(league, idA, idB) {
  const between = playableFixtures(league).filter(
    (fixture) => (fixture.p1 === idA && fixture.p2 === idB) || (fixture.p1 === idB && fixture.p2 === idA),
  );

  if (between.length === 0) {
    return { ok: false, error: 'NO_PAIRING', played: [] };
  }

  const resultsByFixture = new Map(league.results.map((result) => [result.fixtureId, result]));
  const unplayed = between.filter((fixture) => !resultsByFixture.has(fixture.id));

  if (unplayed.length === 0) {
    const played = between.map((fixture) => {
      const result = resultsByFixture.get(fixture.id);
      return {
        fixtureId: fixture.id,
        p1: fixture.p1,
        p2: fixture.p2,
        p1Games: result.p1Games,
        p2Games: result.p2Games,
      };
    });
    return { ok: false, error: 'ALL_PLAYED', played };
  }

  const roundKey = (fixture) => (fixture.round === null ? Infinity : fixture.round);
  unplayed.sort((a, b) => roundKey(a) - roundKey(b));

  return { ok: true, fixture: unplayed[0] };
}

/**
 * Places a reporter's own game count on their own side of the fixture. This
 * is the guard against the exact hazard the CLI exists for: the same "I won
 * 3-1" input must land as {3,1} when the reporter is p1 and {1,3} when the
 * reporter is p2 of that particular fixture — never the same shape twice.
 */
export function orientResult(fixture, reporterId, reporterGames, opponentGames) {
  if (fixture.p1 === reporterId) {
    return { p1Games: reporterGames, p2Games: opponentGames };
  }
  if (fixture.p2 === reporterId) {
    return { p1Games: opponentGames, p2Games: reporterGames };
  }
  throw new Error(`Player "${reporterId}" is not part of fixture ${fixture.id}`);
}

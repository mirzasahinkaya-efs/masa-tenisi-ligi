import { seededShuffle } from './random.js';

function blankRow(playerId) {
  return {
    playerId,
    played: 0,
    won: 0,
    lost: 0,
    gamesWon: 0,
    gamesLost: 0,
    gameDiff: 0,
    points: 0,
  };
}

/**
 * Tallies the given fixtures for the given players. Fixtures without a
 * result, and results naming players outside `playerIds`, are skipped —
 * which is what makes this reusable for head-to-head mini-tables.
 */
export function accumulate(playerIds, fixtures, results, rules) {
  const rows = new Map(playerIds.map((id) => [id, blankRow(id)]));
  const resultsByFixture = new Map(results.map((r) => [r.fixtureId, r]));

  for (const fixture of fixtures) {
    const result = resultsByFixture.get(fixture.id);
    if (!result) continue;

    const p1 = rows.get(fixture.p1);
    const p2 = rows.get(fixture.p2);
    if (!p1 || !p2) continue;

    p1.played += 1;
    p2.played += 1;
    p1.gamesWon += result.p1Games;
    p1.gamesLost += result.p2Games;
    p2.gamesWon += result.p2Games;
    p2.gamesLost += result.p1Games;

    const winner = result.p1Games > result.p2Games ? p1 : p2;
    const loser = winner === p1 ? p2 : p1;
    winner.won += 1;
    winner.points += rules.pointsWin;
    loser.lost += 1;
    loser.points += rules.pointsLoss;
  }

  for (const row of rows.values()) {
    row.gameDiff = row.gamesWon - row.gamesLost;
  }
  return rows;
}

/**
 * Orders a group. Tiebreaks, in order: head-to-head points among the tied
 * players, overall game difference, overall games won, then a seeded draw
 * so the result is stable rather than arbitrary.
 */
export function computeTable(playerIds, fixtures, results, rules, drawSeed) {
  const rows = accumulate(playerIds, fixtures, results, rules);
  const drawOrder = new Map(
    seededShuffle(playerIds, drawSeed).map((id, index) => [id, index]),
  );

  const ordered = [...rows.values()].sort((a, b) => b.points - a.points);
  const settled = [];

  let start = 0;
  while (start < ordered.length) {
    let end = start;
    while (end + 1 < ordered.length && ordered[end + 1].points === ordered[start].points) {
      end += 1;
    }
    const tied = ordered.slice(start, end + 1);

    if (tied.length > 1) {
      const tiedIds = tied.map((row) => row.playerId);
      const tiedSet = new Set(tiedIds);
      const among = fixtures.filter((f) => tiedSet.has(f.p1) && tiedSet.has(f.p2));
      const mini = accumulate(tiedIds, among, results, rules);

      tied.sort((a, b) => (
        mini.get(b.playerId).points - mini.get(a.playerId).points
        || b.gameDiff - a.gameDiff
        || b.gamesWon - a.gamesWon
        || drawOrder.get(a.playerId) - drawOrder.get(b.playerId)
      ));
    }

    settled.push(...tied);
    start = end + 1;
  }

  return settled.map((row, index) => ({ ...row, position: index + 1 }));
}

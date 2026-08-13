const SCORE_PATTERN = /^(\d{1,2})\s*[-–:]\s*(\d{1,2})$/;

/** "best-of-3" for a first-to-2 match: the loser can take every game but one. */
export const matchFormatLabel = (gamesToWin) => `best-of-${gamesToWin * 2 - 1}`;

/**
 * Parses a reported score such as "2-1" and checks it could actually happen:
 * the winner takes exactly `gamesToWin` games and the loser fewer.
 *
 * `gamesToWin` is required, and deliberately has no default. It is a league rule
 * that lives in `league.rules`, so a default here would be a second, silent
 * definition of the match format — and a caller that forgot to pass it would
 * quietly validate against the wrong one for a whole season. Missing it is a
 * configuration fault (`NO_RULE`), not a bad score.
 */
export function parseScore(text, { gamesToWin } = {}) {
  if (!Number.isInteger(gamesToWin) || gamesToWin < 1) return { ok: false, error: 'NO_RULE' };

  const match = SCORE_PATTERN.exec(String(text ?? '').trim());
  if (!match) return { ok: false, error: 'FORMAT' };

  const p1Games = Number(match[1]);
  const p2Games = Number(match[2]);
  const winnerGames = Math.max(p1Games, p2Games);
  const loserGames = Math.min(p1Games, p2Games);

  if (winnerGames !== gamesToWin || loserGames >= gamesToWin) {
    return { ok: false, error: 'ILLEGAL' };
  }
  return { ok: true, p1Games, p2Games };
}

const SCORE_PATTERN = /^(\d{1,2})\s*[-–:]\s*(\d{1,2})$/;

/**
 * Parses a reported score such as "3-1" and checks it could actually
 * happen in a best-of-five match: the winner takes exactly `gamesToWin`
 * games and the loser fewer.
 */
export function parseScore(text, { gamesToWin = 3 } = {}) {
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

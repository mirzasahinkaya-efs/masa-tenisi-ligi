/**
 * Both gates are checked here, server-side only. The workspace check is the
 * load-bearing one: without it any Slack account anywhere could sign in, since
 * the email domain alone is attacker-chosen on a foreign workspace.
 */
export function checkIdentity({ teamId, email } = {}, { allowedTeamId, allowedEmailDomain } = {}) {
  if (!teamId || !email) return { ok: false, error: 'MISSING' };
  // A missing policy must refuse rather than compare against undefined.
  if (!allowedTeamId || !allowedEmailDomain) return { ok: false, error: 'MISSING' };
  if (teamId !== allowedTeamId) return { ok: false, error: 'WRONG_WORKSPACE' };

  // Compare the part after the FINAL "@" so "efsora.com@gmail.com" and
  // "a@efsora.com.evil.test" cannot pass as the real domain.
  const domain = String(email).toLowerCase().split('@').pop();
  if (domain !== String(allowedEmailDomain).toLowerCase()) {
    return { ok: false, error: 'WRONG_DOMAIN' };
  }
  return { ok: true };
}

export function playerForSlackId(league, slackId) {
  // An absent identity must never match a roster entry that has no slackId
  // yet: undefined === undefined would otherwise authorise a caller with no
  // identity at all.
  if (!slackId) return null;
  return league.players.find((player) => player.slackId === slackId) ?? null;
}

export function isAdmin(league, slackId) {
  return (league.season?.admins ?? []).includes(slackId);
}

export function canReport(league, slackId, fixture) {
  const player = playerForSlackId(league, slackId);
  if (!player) return { ok: false, error: 'NOT_A_PLAYER' };
  if (fixture.p1 !== player.id && fixture.p2 !== player.id && !isAdmin(league, slackId)) {
    return { ok: false, error: 'NOT_A_PARTICIPANT' };
  }
  return { ok: true, playerId: player.id };
}

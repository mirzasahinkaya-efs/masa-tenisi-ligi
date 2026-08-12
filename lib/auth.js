/**
 * Both gates are checked here, server-side only. The workspace check is the
 * load-bearing one: without it any Slack account anywhere could sign in, since
 * the email domain alone is attacker-chosen on a foreign workspace.
 */
export function checkIdentity({ teamId, email } = {}, { allowedTeamId, allowedEmailDomain } = {}) {
  if (!teamId || !email) return { ok: false, error: 'MISSING' };
  // Distinct from MISSING: this is a server misconfiguration (an unset
  // environment variable), not a bad sign-in attempt. An operator reading a log
  // or a response must be able to tell those apart.
  if (!allowedTeamId || !allowedEmailDomain) return { ok: false, error: 'MISCONFIGURED' };
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

export function playerById(league, playerId) {
  if (!playerId) return null;
  return league.players.find((player) => player.id === playerId) ?? null;
}

/**
 * A session records which kind of subject it holds, because the two sign-in
 * routes prove different things: Slack proves a workspace identity, a shared
 * passphrase proves only that the caller knew the passphrase and then said who
 * they are. Dispatching on the kind is what stops one being read as the other —
 * without it a player id could match a slackId field, or the reverse.
 *
 * An unknown or absent kind resolves to null rather than guessing, so a token
 * predating this field cannot authorise anyone.
 */
export function playerForSubject(league, payload) {
  const { k: kind, sub } = payload ?? {};
  if (kind === 'slack') return playerForSlackId(league, sub);
  if (kind === 'player') return playerById(league, sub);
  return null;
}

/**
 * Admin authority requires a verified identity, so only a Slack subject can
 * hold it. The shared passphrase proves group membership and nothing more —
 * granting admin on it would make "knows the passphrase posted in the channel"
 * mean "may correct anyone's result", which is not a trade anyone agreed to.
 */
export function isAdmin(league, player, kind) {
  if (kind !== 'slack') return false;
  // season.admins holds Slack ids, so an unlinked roster entry has nothing to
  // match on. Without this an admins list containing undefined would match.
  if (!player?.slackId) return false;
  return (league.season?.admins ?? []).includes(player.slackId);
}

export function canReport(league, player, fixture, { kind } = {}) {
  if (!player) return { ok: false, error: 'NOT_A_PLAYER' };
  if (fixture.p1 !== player.id && fixture.p2 !== player.id && !isAdmin(league, player, kind)) {
    return { ok: false, error: 'NOT_A_PARTICIPANT' };
  }
  return { ok: true, playerId: player.id };
}

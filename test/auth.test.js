import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkIdentity, playerForSlackId, playerById, playerForSubject, isAdmin, canReport,
} from '../lib/auth.js';

const POLICY = { allowedTeamId: 'T0EFSORA', allowedEmailDomain: 'efsora.com' };

const league = {
  season: { admins: ['U0AT8HQ7C9K'] },
  players: [
    { id: 'mirza', short: 'Mirza Ş.', slackId: 'U0AT8HQ7C9K' },
    { id: 'tolga', short: 'Tolga E.', slackId: 'U09LQ3PF6LC' },
    { id: 'defne', short: 'Defne G.', slackId: 'U0AFYKZMJEN' },
  ],
};

test('an Efsora identity in the right workspace is allowed', () => {
  assert.deepEqual(
    checkIdentity({ teamId: 'T0EFSORA', email: 'mirza.sahinkaya@efsora.com' }, POLICY),
    { ok: true },
  );
});

test('the right domain in the wrong workspace is refused', () => {
  assert.deepEqual(
    checkIdentity({ teamId: 'T0OTHER', email: 'someone@efsora.com' }, POLICY),
    { ok: false, error: 'WRONG_WORKSPACE' },
  );
});

test('the right workspace with an outside domain is refused', () => {
  assert.deepEqual(
    checkIdentity({ teamId: 'T0EFSORA', email: 'someone@gmail.com' }, POLICY),
    { ok: false, error: 'WRONG_DOMAIN' },
  );
});

test('a lookalike domain does not pass as the real one', () => {
  for (const email of [
    'a@notefsora.com', 'a@efsora.com.evil.test', 'a@efsora.co', 'efsora.com@gmail.com',
  ]) {
    assert.deepEqual(
      checkIdentity({ teamId: 'T0EFSORA', email }, POLICY),
      { ok: false, error: 'WRONG_DOMAIN' }, email,
    );
  }
});

test('domain matching ignores case', () => {
  assert.deepEqual(
    checkIdentity({ teamId: 'T0EFSORA', email: 'Someone@EFSORA.COM' }, POLICY),
    { ok: true },
  );
});

test('a missing team or email is refused', () => {
  for (const identity of [
    {}, { teamId: 'T0EFSORA' }, { email: 'a@efsora.com' },
    { teamId: '', email: '' }, { teamId: null, email: null },
  ]) {
    assert.deepEqual(checkIdentity(identity, POLICY), { ok: false, error: 'MISSING' });
  }
});

test('a Slack id maps to its player, and an unknown one to null', () => {
  assert.equal(playerForSlackId(league, 'U09LQ3PF6LC').id, 'tolga');
  assert.equal(playerForSlackId(league, 'U0NOBODY'), null);
});

const playerNamed = (id) => league.players.find((player) => player.id === id);

test('a roster id maps to its player, and an unknown one to null', () => {
  assert.equal(playerById(league, 'defne').slackId, 'U0AFYKZMJEN');
  assert.equal(playerById(league, 'nobody'), null);
  assert.equal(playerById(league, undefined), null);
  assert.equal(playerById(league, ''), null);
});

test('a session subject resolves through its own kind', () => {
  assert.equal(playerForSubject(league, { k: 'slack', sub: 'U09LQ3PF6LC' }).id, 'tolga');
  assert.equal(playerForSubject(league, { k: 'player', sub: 'tolga' }).id, 'tolga');
});

test('a subject presented under the wrong kind resolves to nobody', () => {
  // The load-bearing case. A passphrase session names you with a roster id, a
  // Slack session with a Slack id. Resolving either against the other field
  // would let one route's subject authorise on the other.
  assert.equal(playerForSubject(league, { k: 'player', sub: 'U09LQ3PF6LC' }), null);
  assert.equal(playerForSubject(league, { k: 'slack', sub: 'tolga' }), null);
});

test('a subject with no usable kind is refused', () => {
  for (const payload of [
    undefined, null, {}, { sub: 'tolga' }, { sub: 'U09LQ3PF6LC' },
    { k: '', sub: 'tolga' }, { k: 'admin', sub: 'tolga' }, { k: 'player' }, { k: 'slack' },
  ]) {
    assert.equal(playerForSubject(league, payload), null, JSON.stringify(payload));
  }
});

test('admins are recognised from the season config', () => {
  assert.equal(isAdmin(league, playerNamed('mirza'), 'slack'), true);
  assert.equal(isAdmin(league, playerNamed('tolga'), 'slack'), false);
});

test('a shared passphrase never confers admin, even to a real admin', () => {
  // The whole point of the kind gate. mirza IS an admin, and signing in with
  // the shared passphrase must still not grant it — otherwise knowing the
  // passphrase posted in the channel would mean holding admin authority.
  const mirza = playerNamed('mirza');
  assert.equal(isAdmin(league, mirza, 'player'), false);
  assert.equal(isAdmin(league, mirza, undefined), false);
  assert.equal(isAdmin(league, mirza, ''), false);
  assert.equal(isAdmin(league, mirza, 'admin'), false);

  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(
    canReport(league, mirza, fixture, { kind: 'player' }),
    { ok: false, error: 'NOT_A_PARTICIPANT' },
  );
  assert.deepEqual(
    canReport(league, mirza, fixture, { kind: 'slack' }), { ok: true, playerId: 'mirza' },
  );
});

test('a player with no Slack id is never an admin', () => {
  // season.admins holds Slack ids, so an unlinked roster entry has nothing to
  // match on. Without the guard an admins list containing undefined would match.
  const unlinked = { id: 'unlinked', short: 'Unlinked' };
  assert.equal(isAdmin(league, unlinked, 'slack'), false);
  assert.equal(isAdmin({ ...league, season: { admins: [undefined] } }, unlinked, 'slack'), false);
  assert.equal(isAdmin(league, null, 'slack'), false);
});

test('a participant may report their own fixture', () => {
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(
    canReport(league, playerNamed('tolga'), fixture), { ok: true, playerId: 'tolga' },
  );
});

test('a player may not report a fixture they are not in', () => {
  // Admin rights are stripped here on purpose: the base league makes mirza an
  // admin (needed by the isAdmin test), and admin privilege would otherwise
  // mask the rule this test exists to pin.
  const noAdmins = { ...league, season: { admins: [] } };
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(
    canReport(noAdmins, playerNamed('mirza'), fixture),
    { ok: false, error: 'NOT_A_PARTICIPANT' },
  );
});

test('an admin may report a fixture they are not in', () => {
  const withAdmin = { ...league, season: { admins: ['U0AFYKZMJEN'] } };
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'mirza' };
  assert.deepEqual(
    canReport(withAdmin, playerNamed('defne'), fixture, { kind: 'slack' }),
    { ok: true, playerId: 'defne' },
  );
});

test('someone signed in but not on the roster cannot report', () => {
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(canReport(league, null, fixture), { ok: false, error: 'NOT_A_PLAYER' });
});

test('a participant who is p2 may report their own fixture', () => {
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(
    canReport(league, playerNamed('defne'), fixture), { ok: true, playerId: 'defne' },
  );
});

test('an absent Slack identity is never matched to an unlinked player', () => {
  const withUnlinked = {
    ...league,
    players: [...league.players, { id: 'unlinked', short: 'Unlinked' }],
  };
  assert.equal(playerForSlackId(withUnlinked, undefined), null);
  assert.equal(playerForSlackId(withUnlinked, null), null);
  assert.equal(playerForSlackId(withUnlinked, ''), null);
  assert.equal(playerForSubject(withUnlinked, { k: 'slack' }), null);
});

test('a missing policy refuses rather than throwing', () => {
  assert.deepEqual(
    checkIdentity({ teamId: 'T0EFSORA', email: 'a@efsora.com' }),
    { ok: false, error: 'MISCONFIGURED' },
  );
  assert.deepEqual(
    checkIdentity({ teamId: 'T0EFSORA', email: 'a@efsora.com' }, {}),
    { ok: false, error: 'MISCONFIGURED' },
  );
});

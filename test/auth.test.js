import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIdentity, playerForSlackId, isAdmin, canReport } from '../lib/auth.js';

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

test('admins are recognised from the season config', () => {
  assert.equal(isAdmin(league, 'U0AT8HQ7C9K'), true);
  assert.equal(isAdmin(league, 'U09LQ3PF6LC'), false);
});

test('a participant may report their own fixture', () => {
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(canReport(league, 'U09LQ3PF6LC', fixture), { ok: true, playerId: 'tolga' });
});

test('a player may not report a fixture they are not in', () => {
  // Admin rights are stripped here on purpose: the base league makes
  // U0AT8HQ7C9K an admin (needed by the isAdmin test), and admin privilege
  // would otherwise mask the rule this test exists to pin.
  const noAdmins = { ...league, season: { admins: [] } };
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(
    canReport(noAdmins, 'U0AT8HQ7C9K', fixture),
    { ok: false, error: 'NOT_A_PARTICIPANT' },
  );
});

test('an admin may report a fixture they are not in', () => {
  const withAdmin = { ...league, season: { admins: ['U0AFYKZMJEN'] } };
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'mirza' };
  assert.deepEqual(canReport(withAdmin, 'U0AFYKZMJEN', fixture), { ok: true, playerId: 'defne' });
});

test('someone signed in but not on the roster cannot report', () => {
  const fixture = { id: 'A-R1-M1', p1: 'tolga', p2: 'defne' };
  assert.deepEqual(
    canReport(league, 'U0STRANGER', fixture),
    { ok: false, error: 'NOT_A_PLAYER' },
  );
});

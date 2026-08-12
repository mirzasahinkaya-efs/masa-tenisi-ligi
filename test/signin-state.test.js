import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSigninState, panelUsable } from '../lib/signin-state.js';

const signedInAs = { apiAvailable: true, rosterUnavailable: false, signedIn: true };

test('a host with no api offers nothing', () => {
  assert.equal(chooseSigninState({ apiAvailable: false }), 'read-only');
  // Even a valid-looking session cannot change it: without an API there is
  // nothing behind the form.
  assert.equal(
    chooseSigninState({ apiAvailable: false, signedIn: true, hasPlayer: true, reportable: 5 }),
    'read-only',
  );
});

test('an unreachable roster is reported as such, not as signed out', () => {
  assert.equal(
    chooseSigninState({ apiAvailable: true, rosterUnavailable: true, signedIn: true }),
    'unavailable',
  );
  // The distinction that matters: the session may well be valid, so claiming
  // "not signed in" or "not a player" here would be a lie.
  assert.equal(
    chooseSigninState({ apiAvailable: true, rosterUnavailable: true, signedIn: false }),
    'unavailable',
  );
});

test('nobody signed in gets the sign-in form', () => {
  assert.equal(
    chooseSigninState({ apiAvailable: true, rosterUnavailable: false, signedIn: false }),
    'sign-in',
  );
});

test('a session whose subject is not on the roster is told so', () => {
  assert.equal(chooseSigninState({ ...signedInAs, hasPlayer: false }), 'not-a-player');
});

test('a player with matches to report gets the form', () => {
  assert.equal(chooseSigninState({ ...signedInAs, hasPlayer: true, reportable: 5 }), 'report');
});

test('a player with no group matches is not offered a form they cannot use', () => {
  // The CEO joins at the quarter-final, so has no group fixtures. Rendering the
  // form would mean an empty opponent list and a submit that cannot succeed.
  assert.equal(chooseSigninState({ ...signedInAs, hasPlayer: true, reportable: 0 }), 'no-fixtures');
  assert.equal(
    chooseSigninState({ ...signedInAs, hasPlayer: true, reportable: undefined }), 'no-fixtures',
  );
});

test('every state is reachable and each one is distinct', () => {
  const reached = new Set([
    chooseSigninState({ apiAvailable: false }),
    chooseSigninState({ apiAvailable: true, rosterUnavailable: true }),
    chooseSigninState({ apiAvailable: true, signedIn: false }),
    chooseSigninState({ ...signedInAs, hasPlayer: false }),
    chooseSigninState({ ...signedInAs, hasPlayer: true, reportable: 0 }),
    chooseSigninState({ ...signedInAs, hasPlayer: true, reportable: 1 }),
  ]);
  assert.deepEqual([...reached].sort(), [
    'no-fixtures', 'not-a-player', 'read-only', 'report', 'sign-in', 'unavailable',
  ]);
});

test('called with nothing at all it refuses rather than throwing', () => {
  // A fetch that failed before any flag was assigned must not crash the page.
  assert.equal(chooseSigninState(), 'read-only');
  assert.equal(chooseSigninState({}), 'read-only');
});

test('the nav link is offered only where the panel actually opens', () => {
  for (const state of ['sign-in', 'report', 'no-fixtures']) {
    assert.equal(panelUsable(state), true, state);
  }
  // These three leave the panel hidden, so a jump-to-Record link would be a
  // control that visibly does nothing.
  for (const state of ['read-only', 'unavailable', 'not-a-player']) {
    assert.equal(panelUsable(state), false, state);
  }
});

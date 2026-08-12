/**
 * Which of the account panel's states to render. Extracted from the page so it
 * can be tested without a DOM: it is the most intricate decision in the front
 * end, and every branch of it makes a claim to the reader that has to be true.
 *
 *   read-only     no /api/* on this host at all, so offer nothing
 *   unavailable   the API answered but could not reach the roster
 *   sign-in       nobody signed in
 *   not-a-player  a valid session whose subject is not on the roster
 *   no-fixtures   on the roster, but with no group matches to report
 *   report        on the roster with matches to report
 *
 * `reportable` tells the two roster states apart. Passing it as a count keeps
 * this function free of any knowledge of how fixtures are shaped.
 */
export function chooseSigninState({
  apiAvailable, rosterUnavailable, signedIn, hasPlayer, reportable,
} = {}) {
  if (!apiAvailable) return 'read-only';
  if (rosterUnavailable) return 'unavailable';
  if (!signedIn) return 'sign-in';
  if (!hasPlayer) return 'not-a-player';
  return reportable > 0 ? 'report' : 'no-fixtures';
}

/**
 * Whether the state can actually show something inside the Record panel. The
 * jump-to-Record nav link is hidden whenever this is false, so the link never
 * points at a panel that stays hidden.
 */
export function panelUsable(state) {
  return state === 'sign-in' || state === 'report' || state === 'no-fixtures';
}

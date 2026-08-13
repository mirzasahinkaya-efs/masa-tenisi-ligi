import { chooseSigninState, panelUsable } from './lib/signin-state.js';
import { maxGamesToWin } from './lib/validate.js';

const league = await fetch('./data/league.json', { cache: 'no-store' }).then((r) => r.json());
const nameOf = new Map(league.players.map((player) => [player.id, player.short]));

const account = document.getElementById('account');
const section = document.getElementById('report');
const form = document.getElementById('report-form');
const status = document.getElementById('report-status');
const opponent = document.getElementById('report-opponent');

const signinForm = document.getElementById('signin-form');
const signinNote = document.getElementById('signin-note');
const signinStatus = document.getElementById('signin-status');
const signinPlayer = document.getElementById('signin-player');
const signinPassphrase = document.getElementById('signin-passphrase');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

/**
 * Options 0..the longest format any stage uses, read from the league rather than
 * hardcoded. The form cannot know which fixture a submission will land on until
 * the API resolves it, and the group stage and playoffs are played to different
 * lengths — so offering the widest range keeps a legal score from being
 * unselectable, and the API remains the one authority on what is legal.
 */
function fillGames(id) {
  const most = maxGamesToWin(league.rules);
  document.getElementById(id).innerHTML = Array.from({ length: most + 1 }, (_, n) => n)
    .map((n) => `<option value="${n}">${n}</option>`).join('');
}

/** Only the opponents this player actually has fixtures against. */
function opponentsFor(playerId) {
  const group = Object.values(league.groups).find((ids) => ids.includes(playerId)) ?? [];
  return group.filter((id) => id !== playerId);
}

/** How many of this pair's two meetings already have a result. */
function recordedMeetings(playerId, opponentId) {
  const ids = new Set(league.results.map((result) => result.fixtureId));
  return league.fixtures
    .filter((f) => [f.p1, f.p2].sort().join() === [playerId, opponentId].sort().join())
    .filter((f) => ids.has(f.id))
    .length;
}

let me = { signedIn: false, player: null };
let rosterUnavailable = false;
let apiAvailable = true;
try {
  const response = await fetch('./api/me', { credentials: 'same-origin' });
  const body = await response.json();
  if (response.ok) {
    me = body;
  } else {
    // A real API answered (its body parsed as JSON) but with a non-OK
    // status — e.g. the 503 rosterUnavailable shape. The session may still
    // be valid, so this must not be read as "signed out" or "not a player";
    // either would be a lie. Show a neutral message and keep the form hidden.
    rosterUnavailable = true;
  }
} catch {
  // Either the request failed outright, or the body wasn't JSON at all — e.g. a
  // static host's HTML 404 when no API is deployed. Showing a sign-in form here
  // would be a dead end, so suppress the affordance entirely rather than
  // advertising a feature this host cannot serve.
  apiAvailable = false;
}

function showSignIn() {
  section.hidden = false;
  signinNote.hidden = false;
  signinForm.hidden = false;

  // Everyone on the roster, including the CEO, who joins at the quarter-final.
  signinPlayer.innerHTML = league.players
    .map((player) => `<option value="${esc(player.id)}">${esc(player.short)}</option>`)
    .join('');

  signinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = signinForm.querySelector('button');
    button.disabled = true;
    signinStatus.textContent = 'Checking…';

    try {
      const response = await fetch('./api/passphrase', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerId: signinPlayer.value,
          passphrase: signinPassphrase.value,
        }),
      });
      const body = await response.json().catch(() => ({}));
      // `body.ok`, not just `response.ok`: when no Function matches the method,
      // Cloudflare Pages falls through to the static assets and answers 200 with
      // the page's own HTML. Reloading on that would drop the user back on this
      // form with no cookie and no explanation, over and over.
      if (response.ok && body.ok) {
        // Reload rather than swap the forms in place: the session cookie is
        // now set, so a fresh load renders the signed-in state through the
        // same path as any normal visit.
        location.reload();
        return;
      }
      signinStatus.textContent = body.error
        ?? (response.ok ? 'Sign-in is unavailable just now.' : 'Could not sign in.');
      signinPassphrase.value = '';
      button.disabled = false;
    } catch {
      signinStatus.textContent = 'Could not reach the server. Please try again.';
      button.disabled = false;
    }
  });
}

/** Kept visible alongside the form, not only before sign-in. */
function shortenNote() {
  signinNote.textContent = 'The passphrase is shared, so please only submit your own matches.';
  signinNote.hidden = false;
}

function showReportForm(player) {
  section.hidden = false;
  shortenNote();
  form.hidden = false;
  fillGames('report-mine');
  fillGames('report-theirs');
  opponent.innerHTML = opponentsFor(player.id)
    .map((id) => {
      const done = recordedMeetings(player.id, id);
      const suffix = done ? ` — ${done} of 2 recorded` : '';
      return `<option value="${esc(id)}">${esc(nameOf.get(id))}${esc(suffix)}</option>`;
    }).join('');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Saving…';

    try {
      const response = await fetch('./api/results', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          opponentId: opponent.value,
          myGames: Number(document.getElementById('report-mine').value),
          theirGames: Number(document.getElementById('report-theirs').value),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const which = body.meeting && body.meetingsTotal
          ? ` — meeting ${body.meeting} of ${body.meetingsTotal}`
          : '';
        const round = body.round ? `Round ${body.round}` : 'Recorded';
        status.textContent = `${round}${which}. The table updates in about a minute.`;
      } else {
        status.textContent = body.error ?? 'Could not save the result.';
        button.disabled = false;
      }
    } catch {
      status.textContent = 'Could not reach the server. Please try again.';
      button.disabled = false;
    }
  });
}

const signOut = ' <a class="account__action" href="./api/logout">Sign out</a>';

const state = chooseSigninState({
  apiAvailable,
  rosterUnavailable,
  signedIn: me.signedIn,
  hasPlayer: Boolean(me.player),
  reportable: me.player ? opponentsFor(me.player.id).length : 0,
});

// The nav link jumps to the Record panel, so it has to go whenever the panel
// will not open — otherwise it is a link that visibly does nothing.
if (!panelUsable(state)) document.getElementById('nav-report')?.setAttribute('hidden', '');

if (state === 'read-only') {
  // No /api/* on this host, so offer nothing rather than a dead form.
  account.innerHTML = '';
} else if (state === 'unavailable') {
  account.innerHTML = '<span class="account__note">Sign-in unavailable just now</span>' + signOut;
} else if (state === 'sign-in') {
  account.innerHTML = '<a class="account__action" href="#report">Sign in</a>';
  showSignIn();
} else if (state === 'not-a-player') {
  account.innerHTML = '<span class="account__note">Signed in · not on the roster</span>'
    + signOut;
} else if (state === 'no-fixtures') {
  // A roster entry with no group fixtures — the CEO, who joins at the
  // quarter-final. Playoff results are recorded from a checkout.
  account.innerHTML = `<span class="account__note">${esc(me.player.short)}</span>` + signOut;
  section.hidden = false;
  status.textContent = 'You have no group matches. Playoff results are recorded by an admin.';
} else {
  account.innerHTML = `<span class="account__note">${esc(me.player.short)}</span>` + signOut;
  showReportForm(me.player);
}

const league = await fetch('./data/league.json', { cache: 'no-store' }).then((r) => r.json());
const nameOf = new Map(league.players.map((player) => [player.id, player.short]));

const account = document.getElementById('account');
const section = document.getElementById('report');
const form = document.getElementById('report-form');
const status = document.getElementById('report-status');
const opponent = document.getElementById('report-opponent');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function fillGames(id) {
  document.getElementById(id).innerHTML = [0, 1, 2, 3]
    .map((n) => `<option value="${n}">${n}</option>`).join('');
}

/** Only the opponents this player actually has fixtures against. */
function opponentsFor(playerId) {
  const group = Object.values(league.groups).find((ids) => ids.includes(playerId)) ?? [];
  return group.filter((id) => id !== playerId);
}

let me = { signedIn: false, player: null };
let rosterUnavailable = false;
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
  // Either the request failed outright, or the body wasn't JSON at all —
  // e.g. a static host's HTML 404 page when no API is deployed yet, which is
  // exactly what happens on the current GitHub Pages host. Either way there
  // is no usable signal, so the page falls back to its read-only default.
}

if (rosterUnavailable) {
  account.innerHTML = '<span class="account__note">Sign-in unavailable just now</span>'
    + ' <a class="account__action" href="./api/logout">Sign out</a>';
} else if (!me.signedIn) {
  account.innerHTML = '<a class="account__action" href="./api/login">Sign in with Slack</a>';
} else if (!me.player) {
  account.innerHTML = '<span class="account__note">Signed in · not a player</span>'
    + ' <a class="account__action" href="./api/logout">Sign out</a>';
} else {
  account.innerHTML = `<span class="account__note">${esc(me.player.short)}</span>`
    + ' <a class="account__action" href="./api/logout">Sign out</a>';

  section.hidden = false;
  fillGames('report-mine');
  fillGames('report-theirs');
  opponent.innerHTML = opponentsFor(me.player.id)
    .map((id) => `<option value="${esc(id)}">${esc(nameOf.get(id))}</option>`).join('');

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
        status.textContent = 'Recorded. The table updates in about a minute.';
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

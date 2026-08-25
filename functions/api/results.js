import { verifyToken } from '../../lib/session.js';
import { canReport, isAdmin, playerForSubject } from '../../lib/auth.js';
import {
  findOpenFixture, findRecordedFixture, orientResult, playableFixtures,
} from '../../lib/report.js';
import { gamesToWinFor, matchFormatLabel, parseScore } from '../../lib/validate.js';
import { createStore, storeConfigured } from '../_shared/store.js';
import { json, readCookie, SESSION_COOKIE } from '../_shared/http.js';

const MISCONFIGURED = 'The league data store is not configured. Please tell an admin.';

/**
 * Verifies the session before anything else is looked at, so an unauthenticated
 * caller learns nothing about the body, the roster or the deployment.
 */
async function openSession(request, env, deps) {
  const nowSeconds = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const session = await verifyToken(
    readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, { nowSeconds, expectType: 'session' },
  );
  if (!session.ok) {
    return { ok: false, response: json({ error: 'Please sign in first.' }, { status: 401 }) };
  }
  return { ok: true, session, nowSeconds };
}

/** Reads a JSON object body, refusing anything that is not one. */
async function readObjectBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: json({ error: 'Expected a JSON body.' }, { status: 400 }) };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, response: json({ error: 'Expected a JSON object.' }, { status: 400 }) };
  }
  return { ok: true, body };
}

/**
 * Opens the store and resolves the caller to a roster player.
 *
 * Shared by create, edit and delete so all three read the league the same way
 * and resolve the caller through the same subject-kind rule.
 */
async function openStore(env, deps, session) {
  if (!deps.makeStore && !storeConfigured(env)) {
    return { ok: false, response: json({ error: MISCONFIGURED }, { status: 503 }) };
  }
  const store = (deps.makeStore ?? (() => createStore({
    token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO,
  })))();

  let league;
  try {
    ({ league } = await store.read());
  } catch {
    // read() throws on a non-OK response. Return the 502 these handlers intend
    // for store failures rather than raising into a 500 HTML page.
    return {
      ok: false,
      response: json(
        { error: 'Could not reach the league data. Please try again.' }, { status: 502 },
      ),
    };
  }

  const reporter = playerForSubject(league, session.payload);
  if (!reporter) {
    return {
      ok: false,
      response: json({ error: 'You are not on the league roster.' }, { status: 403 }),
    };
  }
  return { ok: true, store, league, reporter };
}

/** The score a stage allows, or the response explaining why it does not. */
function checkScore(league, stage, myGames, theirGames) {
  const gamesToWin = gamesToWinFor(league.rules, stage);
  const score = parseScore(`${myGames}-${theirGames}`, { gamesToWin });
  if (score.ok) return { ok: true, score };

  if (score.error === 'NO_RULE') {
    return {
      ok: false,
      response: json({
        error: `The league rules say nothing about ${stage} matches. Please tell an admin.`,
      }, { status: 503 }),
    };
  }
  return {
    ok: false,
    response: json({
      error: score.error === 'FORMAT'
        ? 'Scores must be whole numbers, for example 2 and 1.'
        : `A ${matchFormatLabel(gamesToWin)} match ends when the winner has exactly `
          + `${gamesToWin} games.`,
    }, { status: 400 }),
  };
}

export async function handleResultPost(request, env, deps = {}) {
  const opened = await openSession(request, env, deps);
  if (!opened.ok) return opened.response;
  const { session, nowSeconds } = opened;

  const parsed = await readObjectBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const storeOpen = await openStore(env, deps, session);
  if (!storeOpen.ok) return storeOpen.response;
  const { store, league, reporter } = storeOpen;
  if (body.opponentId === reporter.id) {
    return json({ error: 'Pick an opponent other than yourself.' }, { status: 400 });
  }
  if (!league.players.some((player) => player.id === body.opponentId)) {
    return json({ error: 'Unknown opponent.' }, { status: 400 });
  }

  const open = findOpenFixture(league, reporter.id, body.opponentId);
  if (!open.ok) {
    return json({
      error: open.error === 'NO_PAIRING'
        ? 'You are in different groups and never meet.'
        : 'Both of your matches are already recorded. Ask an admin to correct one.',
    }, { status: 409 });
  }

  // Defence in depth rather than a live gate: findOpenFixture is always called
  // with the session holder as one leg, so the fixture it returns always
  // contains them and this check cannot currently fail. It stays so that a
  // future change to the request shape cannot silently remove authorisation.
  // Admins correct results with `npm run score -- ... --fix`, not through here.
  const permission = canReport(league, reporter, open.fixture, { kind: session.payload.k });
  if (!permission.ok) {
    return json({ error: 'You can only record your own matches.' }, { status: 403 });
  }

  // The score can only be judged now: the group stage and the playoffs are played
  // to different lengths, so the legal scores depend on which fixture this is.
  const stage = open.fixture.stage;
  const checked = checkScore(league, stage, body.myGames, body.theirGames);
  if (!checked.ok) return checked.response;
  const { score } = checked;

  let committedFixtureId;
  let committedRound;
  let meetingIndex;

  const committed = await store.update((current) => {
    const fresh = findOpenFixture(current, reporter.id, body.opponentId);
    if (!fresh.ok) throw new Error('ALREADY_RECORDED');
    // The score above was judged against `stage`. If the pair's next open fixture
    // changed stage while we were reading — someone else filing both of their
    // group meetings promotes the pair to their playoff match, which is played to
    // a different length — then the score we approved is not one this fixture
    // allows. Refuse rather than store a result that could not have happened.
    if (fresh.fixture.stage !== stage) throw new Error('STAGE_CHANGED');

    const bothFixtureIds = playableFixtures(current)
      .filter((f) => [f.p1, f.p2].sort().join() === [reporter.id, body.opponentId].sort().join())
      .map((f) => f.id);

    committedFixtureId = fresh.fixture.id;
    committedRound = fresh.fixture.round;
    meetingIndex = current.results.filter((r) => bothFixtureIds.includes(r.fixtureId)).length + 1;

    const oriented = orientResult(fresh.fixture, reporter.id, score.p1Games, score.p2Games);
    const results = [...current.results, {
      fixtureId: fresh.fixture.id,
      ...oriented,
      // Namespaced by how the submitter was identified, because the two
      // routes prove different things: `slack:` is a verified identity,
      // `player:` is self-asserted behind a shared passphrase. A bare name
      // would read as attribution the passphrase route cannot support. The
      // CLI writes 'cli'.
      reportedBy: `${session.payload.k}:${reporter.id}`,
      reportedAt: new Date(nowSeconds * 1000).toISOString(),
    }];
    return {
      league: { ...current, results },
      message: `Record ${fresh.fixture.id}: ${reporter.short} ${score.p1Games}-${score.p2Games} vs ${body.opponentId}`,
    };
  });

  if (!committed.ok) {
    const status = committed.error === 'REJECTED' ? 409 : 502;
    return json({ error: 'Could not save the result. Please try again.' }, { status });
  }
  return json({
    ok: true,
    fixtureId: committedFixtureId,
    round: committedRound,
    meeting: meetingIndex,
    meetingsTotal: 2,
  });
}

/**
 * Corrects a recorded score.
 *
 * The rule is the one the league chose: a player may fix a match they took part
 * in. The shared passphrase proves membership rather than identity, so "their
 * own" means "the name they signed in as" — anyone holding the passphrase could
 * sign in as someone else and edit their results. That is accepted, and every
 * change is a commit, so the git log is the accountability.
 */
export async function handleResultPatch(request, env, deps = {}) {
  const opened = await openSession(request, env, deps);
  if (!opened.ok) return opened.response;
  const { session, nowSeconds } = opened;

  const parsed = await readObjectBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const storeOpen = await openStore(env, deps, session);
  if (!storeOpen.ok) return storeOpen.response;
  const { store, league, reporter } = storeOpen;

  const found = findRecordedFixture(league, body.fixtureId);
  if (!found.ok) return notFoundResponse(found.error);

  /*
   * One check, not two. A score arrives as "my games" and "their games", which
   * only means anything for someone in the fixture — so participation is the
   * requirement, and it is strictly stronger than canReport here: the only case
   * where they differ is an admin, whom canReport admits and who still has no
   * side of the fixture to be oriented against. Running both would leave two
   * gates where either alone suffices, so removing one would go unnoticed.
   *
   * DELETE keeps canReport, where an admin genuinely can act on someone else's
   * result because nothing needs orienting.
   */
  if (found.fixture.p1 !== reporter.id && found.fixture.p2 !== reporter.id) {
    return json({
      error: isAdmin(league, reporter, session.payload.k)
        ? "Correct someone else's match from a checkout with --fix."
        : 'You can only correct your own matches.',
    }, { status: 403 });
  }

  const checked = checkScore(league, found.fixture.stage, body.myGames, body.theirGames);
  if (!checked.ok) return checked.response;
  const { score } = checked;

  const oriented = orientResult(found.fixture, reporter.id, score.p1Games, score.p2Games);
  const before = `${found.result.p1Games}-${found.result.p2Games}`;

  const committed = await store.update((current) => {
    // Re-checked against freshly read data: the result may have been removed or
    // already corrected while this request was in flight.
    const fresh = findRecordedFixture(current, body.fixtureId);
    if (!fresh.ok) throw new Error('GONE');

    const results = current.results.map((entry) => (
      entry.fixtureId === body.fixtureId
        ? {
          ...entry,
          ...oriented,
          // Who last asserted this score, not who first recorded it — the git
          // log holds the original.
          reportedBy: `${session.payload.k}:${reporter.id}`,
          reportedAt: new Date(nowSeconds * 1000).toISOString(),
        }
        : entry
    ));
    return {
      league: { ...current, results },
      message: `Correct ${found.fixture.id}: ${reporter.short} `
        + `${score.p1Games}-${score.p2Games}, was ${before}`,
    };
  });

  if (!committed.ok) {
    const status = committed.error === 'REJECTED' ? 409 : 502;
    return json({ error: 'Could not save the correction. Please try again.' }, { status });
  }
  return json({
    ok: true, fixtureId: found.fixture.id, round: found.fixture.round, corrected: true,
  });
}

/**
 * Removes a recorded result, leaving the fixture open to be recorded again.
 *
 * The fixture id comes from the query string rather than a body: a DELETE body
 * is legal but not every intermediary forwards one, and there is nothing else to
 * send.
 */
export async function handleResultDelete(request, env, deps = {}) {
  const opened = await openSession(request, env, deps);
  if (!opened.ok) return opened.response;
  const { session } = opened;

  const fixtureId = new URL(request.url).searchParams.get('fixtureId');

  const storeOpen = await openStore(env, deps, session);
  if (!storeOpen.ok) return storeOpen.response;
  const { store, league, reporter } = storeOpen;

  const found = findRecordedFixture(league, fixtureId);
  if (!found.ok) return notFoundResponse(found.error);

  const permission = canReport(league, reporter, found.fixture, { kind: session.payload.k });
  if (!permission.ok) {
    return json({ error: 'You can only remove your own matches.' }, { status: 403 });
  }

  const score = `${found.result.p1Games}-${found.result.p2Games}`;

  const committed = await store.update((current) => {
    // Someone else removing it first is not an error worth failing over, but it
    // must not be reported as though this request did the removing.
    const fresh = findRecordedFixture(current, fixtureId);
    if (!fresh.ok) throw new Error('GONE');

    return {
      league: {
        ...current,
        results: current.results.filter((entry) => entry.fixtureId !== fixtureId),
      },
      message: `Remove ${found.fixture.id}: was ${score}, by ${reporter.short}`,
    };
  });

  if (!committed.ok) {
    const status = committed.error === 'REJECTED' ? 409 : 502;
    return json({ error: 'Could not remove the result. Please try again.' }, { status });
  }
  return json({ ok: true, fixtureId: found.fixture.id, removed: true });
}

/** One wording for each way a fixture can fail to be editable. */
function notFoundResponse(error) {
  if (error === 'NOT_RECORDED') {
    return json({ error: 'That match has no result to change.' }, { status: 404 });
  }
  return json({ error: 'No such match in this season.' }, { status: 404 });
}

export const onRequestPost = ({ request, env }) => handleResultPost(request, env);
export const onRequestPatch = ({ request, env }) => handleResultPatch(request, env);
export const onRequestDelete = ({ request, env }) => handleResultDelete(request, env);

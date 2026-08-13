import { verifyToken } from '../../lib/session.js';
import { canReport, playerForSubject } from '../../lib/auth.js';
import { findOpenFixture, orientResult, playableFixtures } from '../../lib/report.js';
import { gamesToWinFor, matchFormatLabel, parseScore } from '../../lib/validate.js';
import { createStore } from '../_shared/store.js';
import { json, readCookie, SESSION_COOKIE } from '../_shared/http.js';

export async function handleResultPost(request, env, deps = {}) {
  const nowSeconds = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();

  const session = await verifyToken(
    readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, { nowSeconds, expectType: 'session' },
  );
  if (!session.ok) return json({ error: 'Please sign in first.' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'Expected a JSON object.' }, { status: 400 });
  }

  const store = (deps.makeStore ?? (() => createStore({
    token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO,
  })))();

  let league;
  try {
    ({ league } = await store.read());
  } catch (error) {
    // read() throws on a non-OK response. Return the 502 this handler already
    // intends for store failures rather than raising into a 500 HTML page.
    return json({ error: 'Could not reach the league data. Please try again.' }, { status: 502 });
  }

  const reporter = playerForSubject(league, session.payload);
  if (!reporter) {
    return json({ error: 'You are not on the league roster.' }, { status: 403 });
  }
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
  const gamesToWin = gamesToWinFor(league.rules, stage);
  const score = parseScore(`${body.myGames}-${body.theirGames}`, { gamesToWin });
  if (!score.ok) {
    if (score.error === 'NO_RULE') {
      return json({
        error: `The league rules say nothing about ${stage} matches. Please tell an admin.`,
      }, { status: 503 });
    }
    return json({
      error: score.error === 'FORMAT'
        ? 'Scores must be whole numbers, for example 2 and 1.'
        : `A ${matchFormatLabel(gamesToWin)} match ends when the winner has exactly `
          + `${gamesToWin} games.`,
    }, { status: 400 });
  }

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

export const onRequestPost = ({ request, env }) => handleResultPost(request, env);

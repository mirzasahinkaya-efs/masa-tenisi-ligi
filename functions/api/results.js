import { verifyToken } from '../../lib/session.js';
import { canReport, playerForSlackId } from '../../lib/auth.js';
import { findOpenFixture, orientResult } from '../../lib/report.js';
import { parseScore } from '../../lib/validate.js';
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

  const score = parseScore(`${body.myGames}-${body.theirGames}`);
  if (!score.ok) {
    return json({
      error: score.error === 'FORMAT'
        ? 'Scores must be whole numbers, for example 3 and 1.'
        : 'A best-of-five match ends when the winner has exactly 3 games.',
    }, { status: 400 });
  }

  const store = (deps.makeStore ?? (() => createStore({
    token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO,
  })))();

  const { league } = await store.read();

  const reporter = playerForSlackId(league, session.payload.sub);
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
  const permission = canReport(league, session.payload.sub, open.fixture);
  if (!permission.ok) {
    return json({ error: 'You can only record your own matches.' }, { status: 403 });
  }

  const committed = await store.update((current) => {
    const fresh = findOpenFixture(current, reporter.id, body.opponentId);
    if (!fresh.ok) throw new Error('ALREADY_RECORDED');

    const oriented = orientResult(fresh.fixture, reporter.id, score.p1Games, score.p2Games);
    const results = [...current.results, {
      fixtureId: fresh.fixture.id,
      ...oriented,
      reportedBy: session.payload.sub,
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
  return json({ ok: true, fixtureId: open.fixture.id });
}

export const onRequestPost = ({ request, env }) => handleResultPost(request, env);

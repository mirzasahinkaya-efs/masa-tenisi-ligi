import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLeague, LIVE_PATH, STATIC_PATH } from '../lib/league-source.js';

const LEAGUE = { players: [{ id: 'a' }], fixtures: [], results: [], groups: { A: ['a'] } };
const PATHS = { livePath: './api/league', staticPath: './data/league.json' };

/** Records which paths were asked for, so "did it even try" is observable. */
function fakeFetch(responders) {
  const asked = [];
  const fetchImpl = async (path) => {
    asked.push(path);
    const responder = responders[path];
    if (!responder) throw new Error(`unexpected fetch: ${path}`);
    return responder();
  };
  return { asked, fetchImpl };
}

const ok = (body) => () => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const status = (code) => () => new Response('{"error":"nope"}', { status: code });
const html = (code = 200) => () => new Response(
  '<!doctype html><html><body>Not found</body></html>',
  { status: code, headers: { 'content-type': 'text/html' } },
);
const boom = () => () => { throw new TypeError('Failed to fetch'); };

test('live data is used when the endpoint answers with a league', async () => {
  const { asked, fetchImpl } = fakeFetch({
    './api/league': ok(LEAGUE),
    './data/league.json': ok({ ...LEAGUE, players: [] }),
  });
  const { league, source } = await loadLeague(fetchImpl, PATHS);
  assert.equal(source, 'live');
  assert.deepEqual(league, LEAGUE);
  assert.deepEqual(asked, ['./api/league'], 'the static file must not be fetched as well');
});

test('a host with no API falls back to the deployed file', async () => {
  // GitHub Pages answers an unknown path with its own 404 page.
  const { asked, fetchImpl } = fakeFetch({
    './api/league': html(404),
    './data/league.json': ok(LEAGUE),
  });
  const { league, source } = await loadLeague(fetchImpl, PATHS);
  assert.equal(source, 'static');
  assert.deepEqual(league, LEAGUE);
  assert.deepEqual(asked, ['./api/league', './data/league.json']);
});

test('an HTML page served with 200 is not mistaken for a league', async () => {
  // The load-bearing case: some static hosts answer 200 for an unknown path.
  // "The request succeeded" is not evidence the body is a league.
  const { fetchImpl } = fakeFetch({
    './api/league': html(200),
    './data/league.json': ok(LEAGUE),
  });
  const { source } = await loadLeague(fetchImpl, PATHS);
  assert.equal(source, 'static');
});

test('a 200 body that parses but is not a league is refused', async () => {
  for (const body of [{}, null, [], 'a string', 42, true]) {
    const { fetchImpl } = fakeFetch({
      './api/league': ok(body),
      './data/league.json': ok(LEAGUE),
    });
    const { source } = await loadLeague(fetchImpl, PATHS);
    assert.equal(source, 'static', JSON.stringify(body));
  }
});

test('each required field is checked on its own, not as a group', async () => {
  // Corrupt exactly one field at a time. A body that fails several checks at
  // once cannot tell you which check is doing the work — so dropping any single
  // one of them would go unnoticed.
  for (const field of ['players', 'fixtures', 'results', 'groups']) {
    for (const bad of [undefined, null, 'no', 42]) {
      const body = { ...LEAGUE, [field]: bad };
      const { fetchImpl } = fakeFetch({
        './api/league': ok(body),
        './data/league.json': ok(LEAGUE),
      });
      const { source } = await loadLeague(fetchImpl, PATHS);
      assert.equal(source, 'static', `${field} = ${JSON.stringify(bad)}`);
    }
  }
  // And the complete shape is accepted, so the checks are not simply refusing
  // everything.
  const { fetchImpl } = fakeFetch({ './api/league': ok(LEAGUE) });
  assert.equal((await loadLeague(fetchImpl, PATHS)).source, 'live');
});

test('a groups map has to be a map of arrays, not merely an object', async () => {
  // Callers do Object.values(groups).find((ids) => ids.includes(id)). An empty
  // map means nobody is in a group, and a map of non-arrays would throw on
  // .includes — neither is a league worth rendering.
  for (const groups of [{}, { A: 'ab' }, { A: ['a'], B: 'b' }, { A: null }, { A: 7 }]) {
    const { fetchImpl } = fakeFetch({
      './api/league': ok({ ...LEAGUE, groups }),
      './data/league.json': ok(LEAGUE),
    });
    const { source } = await loadLeague(fetchImpl, PATHS);
    assert.equal(source, 'static', JSON.stringify(groups));
  }
  // A single group is still a league — the check must not demand two.
  const { fetchImpl } = fakeFetch({ './api/league': ok({ ...LEAGUE, groups: { A: ['a'] } }) });
  assert.equal((await loadLeague(fetchImpl, PATHS)).source, 'live');
});

test('every live failure mode falls back rather than breaking the page', async () => {
  for (const [label, responder] of [
    ['503 unconfigured', status(503)],
    ['502 repository unreachable', status(502)],
    ['500', status(500)],
    ['network error', boom()],
  ]) {
    const { fetchImpl } = fakeFetch({
      './api/league': responder,
      './data/league.json': ok(LEAGUE),
    });
    const { source } = await loadLeague(fetchImpl, PATHS);
    assert.equal(source, 'static', label);
  }
});

test('with the live path switched off it goes straight to the file', async () => {
  const { asked, fetchImpl } = fakeFetch({ './data/league.json': ok(LEAGUE) });
  const { source } = await loadLeague(fetchImpl, {
    livePath: null, staticPath: './data/league.json',
  });
  assert.equal(source, 'static');
  assert.deepEqual(asked, ['./data/league.json']);
});

test('when both sources fail the error surfaces instead of a blank page', async () => {
  const { fetchImpl } = fakeFetch({
    './api/league': status(502),
    './data/league.json': status(404),
  });
  await assert.rejects(() => loadLeague(fetchImpl, PATHS), /HTTP 404/);
});

test('an unusable static file is an error, not a half-rendered page', async () => {
  const { fetchImpl } = fakeFetch({
    './api/league': status(404),
    './data/league.json': ok({ players: [] }),
  });
  await assert.rejects(() => loadLeague(fetchImpl, PATHS), /missing its players/);
});

test('the defaults match the paths the site actually serves', async () => {
  // Callers rely on these rather than repeating the URL layout, so a change here
  // silently changes what every page fetches.
  const { asked, fetchImpl } = fakeFetch({
    './api/league': ok(LEAGUE),
    './data/league.json': ok(LEAGUE),
  });
  await loadLeague(fetchImpl);
  assert.deepEqual(asked, ['./api/league']);
  assert.equal(LIVE_PATH, './api/league');
  assert.equal(STATIC_PATH, './data/league.json');
});

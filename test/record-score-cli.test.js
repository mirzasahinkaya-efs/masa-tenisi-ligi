import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeTable } from '../lib/standings.js';
import { bestFourthPlayerId } from '../lib/bracket.js';

const repo = new URL('..', import.meta.url);

/*
 * The CLI is the only way to record a playoff result, so it is worth exercising
 * as a process rather than by importing it — it reads argv and writes files at
 * module load, and it resolves data/league.json relative to its own location, so
 * a scratch copy of the tree is the only way to hand it a finished season.
 */
async function scratchLeague() {
  const dir = await mkdtemp(join(tmpdir(), 'league-cli-'));
  for (const entry of ['package.json', 'lib', 'scripts', 'data']) {
    await cp(new URL(entry, repo), join(dir, entry), { recursive: true });
  }

  const path = join(dir, 'data', 'league.json');
  const league = JSON.parse(await readFile(path, 'utf8'));
  // Decide every group match in favour of whoever sorts first, so both groups
  // finish and the bracket resolves.
  league.results = league.fixtures.map((fixture) => ({
    fixtureId: fixture.id,
    p1Games: fixture.p1 < fixture.p2 ? 2 : 0,
    p2Games: fixture.p1 < fixture.p2 ? 0 : 2,
    reportedBy: 'cli',
    reportedAt: '2026-10-16T00:00:00.000Z',
  }));
  await writeFile(path, `${JSON.stringify(league, null, 2)}\n`, 'utf8');

  const tables = Object.fromEntries(Object.entries(league.groups).map(([name, ids]) => [
    name, computeTable(ids, league.fixtures, league.results, league.rules, league.season.drawSeed),
  ]));
  return { dir, league, bestFourth: bestFourthPlayerId(tables, league.season.drawSeed) };
}

const score = (dir, args) => execFileSync(
  process.execPath, ['scripts/record-score.js', ...args],
  { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

test('the CLI records the CEO\'s quarter-final without crashing on the way out', async () => {
  // He plays no group stage, so he has no standings row to print. The result
  // used to be written and the script then threw, which left the operator with
  // a stack trace instead of the commit hint.
  const { dir, bestFourth } = await scratchLeague();
  const out = score(dir, ['tugkan', bestFourth, '2-1', '--dry-run']);
  assert.match(out, /QF2/);
  assert.match(out, /playoff/);
  assert.equal(out.includes('TypeError'), false, out);
});

test('a CEO result actually lands in the file, and only once', async () => {
  const { dir, bestFourth } = await scratchLeague();
  score(dir, ['tugkan', bestFourth, '2-1']);

  const league = JSON.parse(await readFile(join(dir, 'data', 'league.json'), 'utf8'));
  const qf2 = league.results.filter((r) => r.fixtureId === 'QF2');
  assert.equal(qf2.length, 1);
  // Stored positionally against the fixture, so the CEO's three games belong to
  // whichever slot he occupies.
  assert.deepEqual([qf2[0].p1Games, qf2[0].p2Games], [2, 1]);
});

test('a group match still prints both players\' standings rows', async () => {
  // The guard must not have silenced the normal path.
  const { dir, league } = await scratchLeague();
  const [first, second] = league.groups.A;
  const out = score(dir, [first, second, '2-0', '--fix', '--dry-run']);
  for (const id of [first, second]) {
    const player = league.players.find((p) => p.id === id);
    assert.ok(out.includes(player.short), `${player.short} missing from:\n${out}`);
  }
});

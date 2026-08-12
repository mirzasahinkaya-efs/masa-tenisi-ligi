import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { drawGroups } from '../lib/draw.js';
import { generateGroupFixtures } from '../lib/schedule.js';
import { PLAYOFF_FIXTURES } from '../lib/bracket.js';
import { ROSTER, SEASON, RULES } from './roster.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Round n opens on the nth Monday and closes that Friday. */
function buildRounds(startDate, count) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const iso = (date) => date.toISOString().slice(0, 10);
  return Array.from({ length: count }, (_, index) => ({
    n: index + 1,
    opensAt: iso(new Date(start.getTime() + index * 7 * DAY_MS)),
    deadline: iso(new Date(start.getTime() + (index * 7 + 4) * DAY_MS)),
  }));
}

const groupStagePlayers = ROSTER.filter((player) => player.groupStage !== false);
const playerIds = groupStagePlayers.map((player) => player.id);
const groups = drawGroups(playerIds, SEASON.drawSeed);

const fixtures = [
  ...generateGroupFixtures('A', groups.A),
  ...generateGroupFixtures('B', groups.B),
];

const roundCount = Math.max(...fixtures.map((fixture) => fixture.round));

const league = {
  season: { ...SEASON, drawLocked: false },
  rules: RULES,
  players: ROSTER.map((player) => ({ ...player, status: 'provisional' })),
  groups,
  rounds: buildRounds(SEASON.startDate, roundCount),
  fixtures,
  playoffFixtures: PLAYOFF_FIXTURES.map((fixture) => ({ ...fixture })),
  results: [],
};

// Refuse to destroy a season in progress. A regenerated draw also produces
// different fixture ids, so recorded results could not simply be pasted back.
const target = new URL('../data/league.json', import.meta.url);
if (!process.argv.includes('--force')) {
  try {
    const existing = JSON.parse(await readFile(target, 'utf8'));
    if (existing.results?.length || existing.season?.drawLocked) {
      console.error(
        `Refusing to overwrite data/league.json: ${existing.results?.length ?? 0} `
        + `result(s) recorded, drawLocked=${existing.season?.drawLocked}. `
        + 'Re-run with --force if you really mean to discard the season.',
      );
      process.exit(1);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(
  target,
  `${JSON.stringify(league, null, 2)}\n`,
  'utf8',
);

console.log(
  `Wrote data/league.json — groups A:${groups.A.length} B:${groups.B.length}, `
  + `${fixtures.length} group fixtures over ${roundCount} rounds, `
  + `${fixtures.length + league.playoffFixtures.length} matches total`,
);

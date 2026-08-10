# Efsora Table Tennis League

Standings, fixtures and playoff bracket for the office league.
Live: https://efsora.github.io/masa-tenisi-ligi/

## Format

Eleven players in two groups (A: 6, B: 5), double round-robin inside each
group, top two from each group into a four-team playoff. 54 matches total.

Best of 5 games to 11. Win 3 points, loss 0. Tiebreaks: head-to-head, then
game difference, then games won, then a seeded draw.

## How it works

`data/league.json` holds the roster, groups, fixtures and results — and
nothing else. Every table, position and bracket slot is computed from those
results at render time by the pure modules in `lib/`, so stored data can
never contradict a displayed table.

## Commands

    npm test         # run the league logic tests
    npm run generate # regenerate data/league.json via scripts/generate-season.js

Regenerating discards recorded results. Only do it before the season starts.

## Local preview

    python3 -m http.server 8000

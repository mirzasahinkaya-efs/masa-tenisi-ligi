# Efsora Table Tennis League

Standings, fixtures and playoff bracket for the office league.
Live: https://mirzasahinkaya-efs.github.io/masa-tenisi-ligi/

Intended to move to the `efsora` org once an owner can accept a repository
transfer; GitHub redirects the old URL, so links shared before the move keep
working.

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

Regenerating refuses to run once results are recorded or the draw is locked.
Pass `--force` only if you really mean to discard the season — a regenerated
draw also produces different fixture ids, so old results cannot be pasted back.

## Recording a result

Two ways to record a result, and they write to the same place (`data/league.json`):

- **On the site.** Sign in with Slack, then use the Record panel to submit a
  result for one of your own unplayed group fixtures. The web form is
  self-service — it only lets you report matches you played in. Playoff
  fixtures are cross-group, so they are not offered here; record those from a
  checkout instead.
- **From a checkout.**

      npm run score -- <playerA> <playerB> <aGames>-<bGames>

  The score is always from `playerA`'s point of view, e.g. `npm run score --
  defne tolga 3-1` records Defne winning 3 games to 1. Add `--fix` to overwrite
  when both meetings between the two players are already recorded (add
  `--dry-run` to preview either case without writing).

Admin corrections — fixing a result after the fact — go through the CLI with
`--fix`, not the web form. The web form has no path for correcting someone
else's match or a match you've already reported; that is intentional, since a
correction needs a human to notice the discrepancy rather than a second
self-service submission.

## Deployment

The site is currently served by GitHub Pages via
`.github/workflows/pages.yml`, which builds and deploys on every push to
`main`. A move to Cloudflare Pages is planned so that the static site and the
`/api/*` Functions share one origin — that's what lets the session use an
`HttpOnly` cookie instead of a token exposed to JavaScript.

The Slack sign-in and result-submission API (`functions/api/`) is **built and
tested but not deployed**. Cutover needs, in addition to hosting itself:

- a Cloudflare account and Pages project connected to this repository,
- a Slack app registered in the Efsora workspace with Sign in with Slack
  enabled, and
- a fine-grained GitHub token scoped to this repository with `contents:
  write`, so the API can commit results on the submitter's behalf.

Until that happens, the live URL above is the only deployment, and the
Record panel and Slack sign-in link will not work there.

## Local preview

    python3 -m http.server 8000

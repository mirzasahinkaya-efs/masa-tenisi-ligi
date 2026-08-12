# Efsora Table Tennis League

Standings, fixtures and playoff bracket for the office league.
Live: https://mirzasahinkaya-efs.github.io/masa-tenisi-ligi/

Intended to move to the `efsora` org once an owner can accept a repository
transfer; GitHub redirects the old URL, so links shared before the move keep
working.

## Format

Eleven players in two groups (A: 6, B: 5), double round-robin inside each
group, top four from Group A and top three from Group B advance, joined by
the CEO as an eighth entrant who plays no group stage, into quarter-finals,
semi-finals, final and third place. 58 matches total.

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

- **On the site.** Pick your name, enter the league passphrase from the Slack
  channel, then use the Record panel to submit a result for one of your own
  unplayed group fixtures. Playoff fixtures are cross-group, so they are not
  offered here; record those from a checkout instead.

  The passphrase is shared, so it proves that whoever is submitting is one of
  us — not which one of us. Anybody who has it could file a result under
  another player's name. That is a deliberate trade: it is the only sign-in the
  league can actually deploy today, since Slack app creation, company-domain
  DNS and email sender verification all need permissions we do not have.
  Every submission is a git commit, so a wrong one is visible and revertible.
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

`.github/workflows/pages.yml` runs the tests, then deploys to two hosts on
every push to `main`:

- **GitHub Pages** — the original URL. Static files only; it cannot run
  `/api/*`, so the page detects that and hides the Record panel entirely.
- **Cloudflare Pages** (`efsora-masa-tenisi-ligi.pages.dev`) — the same files
  *plus* the Functions, so sign-in and result submission work. One origin for
  both is what lets the session use an `HttpOnly` cookie rather than a token
  exposed to JavaScript.

The Cloudflare project is **direct upload**, not git-connected, because the
Pages GitHub App is not installed on the account — hence the `wrangler` step in
the workflow rather than a Cloudflare-side build.

That deploy step is **not optional** once results are submitted on the site:
`data/league.json` is served as a static asset, so a result the API commits to
the repository stays invisible until the site redeploys. That redeploy is what
the form means by "the table updates in about a minute".

The API needs these on the Cloudflare project:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | yes | Signs session cookies. Changing it signs everyone out. |
| `LEAGUE_PASSPHRASE` | yes | The shared passphrase. **Generate it, do not invent it** — see below. Rotating it does *not* end sessions already issued; change `SESSION_SECRET` too if that matters. |
| `GITHUB_TOKEN` | yes | Fine-grained, `contents: write`, scoped to this repository only. Lets the API commit results. |
| `GITHUB_REPO` | yes | `owner/name` of this repository. Already set — not a secret. |
| `LOGIN_KV` | no | KV namespace binding. Brakes guessing — 10 attempts per client per 10 minutes, 60 across the whole site. Already bound. Without it there is no brute-force limit at all. |

The three secrets are set with `wrangler`, never through a file in the repo:

    npx wrangler login
    npx wrangler pages secret put SESSION_SECRET --project-name efsora-masa-tenisi-ligi

It prompts for the value, so nothing lands in shell history. Generate the
random ones straight to the clipboard rather than printing them:

    node -e "console.log(crypto.randomUUID().slice(0,18))" | pbcopy

The passphrase's own entropy is the real control here, not the brake — the brake
deliberately fails open, and without `LOGIN_KV` it does not exist. So generate
the passphrase too; you only need to read it once, to paste into Slack.

Sessions from this route last 14 days, shorter than the Slack route's 30, since
the credential is weaker.

The deploy job additionally needs two **GitHub** repository secrets:
`CLOUDFLARE_API_TOKEN` (a token with the *Cloudflare Pages: Edit* permission)
and `CLOUDFLARE_ACCOUNT_ID`.

`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_TEAM_ID` and
`ALLOWED_EMAIL_DOMAIN` belong to the Slack sign-in route (`/api/login`,
`/api/callback`), which is complete and tested but cannot be deployed without
Efsora workspace admin rights. It is dormant, not dead: with those unset,
`/api/login` answers 503 rather than bouncing anyone to a broken Slack page,
and `/api/passphrase` works on its own.

Until the secrets are set, `/api/passphrase` answers 503 — a configuration
fault, deliberately distinct from a refused sign-in — and the page falls back to
read-only.

## Local preview

    python3 -m http.server 8000

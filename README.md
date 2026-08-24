# Efsora Table Tennis League

Standings, fixtures and playoff bracket for the office league.
Live: https://mirzasahinkaya-efs.github.io/masa-tenisi-ligi/

Intended to move to the `efsora` org once an owner can accept a repository
transfer; GitHub redirects the old URL, so links shared before the move keep
working.

## Format

Twelve players in two groups of six, double round-robin inside each group. The
top three of each group advance, and the better of the two fourth-placed players
takes a seventh place, joined by the CEO as an eighth entrant who plays no group
stage — into quarter-finals, semi-finals, final and third place. 68 matches
total.

Games are to 11. The **group stage is best of 3** — first to 2 games, so the only
possible scores are 2-0 and 2-1. The **playoffs are best of 5**: 3-0, 3-1, 3-2.
Win 3 points, loss 0. Tiebreaks: head-to-head, then game difference, then games
won, then a seeded draw.

The format lives in `rules.gamesToWin` in `data/league.json`, keyed by the stage
a fixture belongs to:

    "gamesToWin": { "group": 2, "playoff": 3 }

Nothing hardcodes it. Because the two stages differ, no score can be judged until
its fixture is known — so both the API and the CLI resolve the fixture first and
validate afterwards, and `gamesToWinFor` returns `undefined` for an unknown stage
rather than guessing. A missing rule is reported as `NO_RULE` (a configuration
fault) rather than as an illegal score.

The web form offers 0 to 3 games either way, since it cannot know which fixture a
submission will land on; the API is the authority and names the format in its
error.

The two fourth-placed players never met, so head-to-head cannot separate them:
that comparison is points, then game difference, then games won, then the same
seeded draw. The quarter-finals are arranged so that no pairing can be a rematch
— the cross-group qualifier is given the CEO, who belongs to no group — and so
that the two group winners can only meet in the final.

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

Results are recorded from a checkout:

    npm run score -- <playerA> <playerB> <aGames>-<bGames>
    git commit -am "Record ..." && git push

The score is always from `playerA`'s point of view, so `npm run score -- defne
tolga 2-1` records Defne winning two games to one. Group matches are best of 3
(`2-0`, `2-1`); playoff matches are best of 5 (`3-0`, `3-1`, `3-2`) — the script
reads the format from the fixture it resolves, so it will tell you which applies.
Names match loosely: `def`, `defne` or `olga` all resolve, while `emre` is refused
as ambiguous.

Add `--dry-run` to preview without writing, and `--fix` to overwrite when both
meetings between two players are already recorded.

**The push is what publishes it.** A commit that is not pushed changes nothing on
the site.

Players can also record their own results on the site: pick your name, enter the
shared passphrase, submit a score for a match you played. That needs a host that
runs `/api/*` — see [Deployment](#deployment) for which one, and why there is
more than one.

Corrections go through `--fix` and were never in the web form: a correction needs
a human to notice the discrepancy rather than a second self-service submission.
Playoff results are cross-group, so the form never offers them either.

## Deployment

`.github/workflows/pages.yml` runs the tests, then deploys to GitHub Pages and
Cloudflare Pages. Vercel deploys itself from its own git integration, with
`npm test` as its build command so a failing test blocks it too.

| Host | Serves | Reachability |
| --- | --- | --- |
| Vercel | static site **plus** `/api/*` — sign-in, self-service results, live league data | reachable on Turkish networks |
| `mirzasahinkaya-efs.github.io/masa-tenisi-ligi` | static site only | works everywhere tested |
| `efsora-masa-tenisi-ligi.pages.dev` | static site plus `/api/*` | blocked on some Turkish networks |

Three hosts is two more than anyone wants. Cloudflare is kept only until Vercel
is confirmed reachable by everyone who needs it — a player *did* record a result
through the Cloudflare site, so retiring it before Vercel is proven would remove
a route somebody was using. Retire it after that, and keep GitHub Pages as the
static fallback.

### One implementation, two adapters

The handlers in `functions/api/` are Web-standard — `(Request, env) => Response`
— which is the whole reason the port was small. Each host gets a one-line
adapter and nothing else:

    functions/api/me.js   export const onRequestGet = ({ request, env }) => handleMe(request, env);
    api/me.js             export const GET = (request) => handleMe(request, process.env);

`api/` is Vercel's convention and runs on its Node.js runtime, which supports
Web handlers natively — no runtime config needed, only `"type": "module"`, which
`package.json` already has. `process.env` appears in `api/` only; `lib/` and
`functions/` stay portable and are checked for that.

### Live league data

`data/league.json` is a static asset on every host, so a recorded result is
invisible there until the site redeploys. `GET /api/league` reads the same file
from the repository on request, so a result appears at once.

`lib/league-source.js` tries the live endpoint and falls back to the committed
file on any failure — a 404 where no API is deployed, a 503 where it is deployed
but unconfigured, a 502 when the repository is unreachable, or a body that is
not a league. That last check is load-bearing: a static host answers an unknown
path with its own HTML, sometimes with a 200, so a successful request is not
evidence the body is league data.

The endpoint is cached at the edge for ten seconds. Without that, every page
load would spend a GitHub API call; with it, ten seconds of staleness replaces a
minute of CI. It is the only endpoint that is cacheable at all — `json()`
defaults to `no-store` because everything else is per-session.

### The pages.dev block

`*.pages.dev` is unreachable from some Turkish networks. Measured 2026-08-13 on
Turkcell fixed line and confirmed on mobile data: DNS for the whole wildcard is
sinkholed to a Superonline address, and pinning the real Cloudflare IP still
dies before TLS — so the filter keys on the hostname, not the IP or DNS. A VPN
gets through, and at least one player reached it without one.

- blocked: `pages.dev`, `workers.dev`, `trycloudflare.com`, `netlify.app`, `fly.dev`
- reachable: `github.io`, `vercel.app`, `deno.dev`, `onrender.com`, `web.app`

Not a block on Cloudflare (`cloudflare.com` is fine) nor on free hosting (half
the list works) — a list of specific hosting wildcards. To test any wildcard
without owning a site there, request `https://does-not-exist.<wildcard>/`: an
unblocked one completes TLS and answers 404, a blocked one never starts TLS.

### What the API needs

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | yes | Signs session cookies. Changing it signs everyone out. |
| `LEAGUE_PASSPHRASE` | yes | The shared passphrase. **Generate it, do not invent it.** Rotating it does *not* end sessions already issued; change `SESSION_SECRET` too if that matters. |
| `GITHUB_TOKEN` | yes | Fine-grained, `contents: write`, scoped to this repository only. Lets the API commit results. |
| `GITHUB_REPO` | yes | `owner/name` of this repository. Not a secret. |
| `LOGIN_KV` | no | KV namespace binding. Brakes guessing — 10 attempts per client per 10 minutes, 60 across the whole site. Without it there is no brute-force limit at all. |

On Vercel these are project environment variables; on Cloudflare they are set
with `wrangler`. Never through a file in the repo:

    npx wrangler login
    npx wrangler pages secret put SESSION_SECRET --project-name efsora-masa-tenisi-ligi

It prompts for the value, so nothing lands in shell history. Generate the random
ones straight to the clipboard rather than printing them — and use
`process.stdout.write`, not `console.log`, which appends a newline that `pbcopy`
faithfully copies and a browser password field then strips:

    node -e "process.stdout.write(crypto.randomUUID().slice(0,18))" | pbcopy

The passphrase's own entropy is the real control, not the brake — the brake
deliberately fails open, and without `LOGIN_KV` it does not exist. Sessions from
this route last 14 days.

`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_TEAM_ID` and
`ALLOWED_EMAIL_DOMAIN` belong to the Slack sign-in route (`/api/login`,
`/api/callback`), which is complete and tested but cannot be deployed without
Efsora workspace admin rights. Dormant, not dead: with those unset `/api/login`
answers 503 rather than bouncing anyone to a broken Slack page.

## Local preview

    python3 -m http.server 8000

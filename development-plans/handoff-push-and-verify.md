# Handoff — push, validate CI, re-verify production

This is a short, mechanical follow-up to the Stages 2–6 run, written by a Claude session that
had no `git push` credentials and could not finish it. Read
[`AGENTS.md`](../AGENTS.md), [`handoff-remaining-checks.md`](handoff-remaining-checks.md), and
[`docs/production-deployment.md`](../docs/production-deployment.md) first — they explain the
full picture; this file only covers pushing what that session prepared, confirming CI, and
re-checking production.

**Scope check:** this does not touch Task B (the manual screen-reader review). That stays open
in `handoff-remaining-checks.md` regardless of what happens here — leave that file alone except
for the one edit step 4 below describes.

## 1. Orient and sanity-check what is about to be pushed

```sh
git fetch origin
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Expect six local commits ahead of `origin/main`, all from today, all touching only
`docs/*.md` and `development-plans/*.md` — no `worker/src`, `web/src`, or config changes. Read
each commit message; they describe: closing Stage 3, fixing the archived plan's cross-links, an
accessibility-tree walkthrough (Task B, not closed), a read-only Task D revalidation against
production, closing Task C (no Workers Builds on either Worker), and confirming the production
owner account directly with the owner. If the diff includes anything outside docs and plans, or
`origin/main` has moved since this was written, stop and reconcile rather than pushing blindly —
this file's author cannot see what changed after it was written.

## 2. Push

```sh
git push origin main
```

Nothing here needs a force push, a rebase, or `--no-verify`. If the push is rejected because
`origin/main` moved, fetch and merge or rebase normally; do not force.

## 3. Confirm CI on the pushed commit

The workflow is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): every push runs a
`checks` job (install, lint, typecheck, Workers-runtime tests, dependency audit, production
bundle dry run), and on the default branch a `deploy-test` job that deploys **`family-board-test`
only** and verifies its routing and health. See [`docs/ci.md`](../docs/ci.md).

If `gh` is authenticated, `gh run list --branch main -L 3` and `gh run view <id>` are the direct
route. If not, this repository's Actions metadata is readable unauthenticated — plain
`curl -s https://api.github.com/repos/yhaspel/goal-tracker/actions/runs?branch=main | head` and
the matching `.../jobs` endpoint return the run and job status without a token (job **log**
downloads do return 403 unauthenticated, but status does not). Either way, confirm both
`checks` and `deploy-test` report success for the commit just pushed, and record the run URL.

Nothing in this push changes application code, so there is nothing new to deploy — `deploy-test`
passing here is a regression check on the test Worker, not evidence about production. Production
has no CI-driven pipeline; it is deployed by hand, deliberately (see `production-deployment.md`).

## 4. Re-verify production, read-only

Repeat the exact checklist already run and recorded in `docs/production-deployment.md`'s
"Task D revalidation" section, against `https://family-board-production.yuval3000.workers.dev`,
using plain `curl` with no cookies:

- `GET /api/v1/health` — expect `200`, `schemaVersion: 4`, `Cache-Control: no-store`.
- `GET /api/v1/auth/bootstrap/status` — expect `{"bootstrapAvailable":false}`. **This is now
  correct, not a regression** — the owner confirmed on 2026-09-13 that they bootstrapped a real
  production owner account themselves. Do not treat this as a finding; do not investigate who
  the owner is or what is on the board.
- `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` with no cookies —
  expect `401`, generic `unauthenticated` body, no address named.
- `GET /api/v1/diagnostics/probe?nonce=<32 hex>` — expect `404`.
- `POST /api/v1/auth/bootstrap/prepare` with a wrong secret — expect `403`, then `429` with
  `Retry-After` on repeat.
- `POST /api/v1/auth/login` for a made-up address, correct `Origin` header — expect
  `401 invalid_credentials`, generic message. This is the one login attempt the checklist itself
  calls for; do not repeat it against other addresses or otherwise probe for which accounts
  exist.
- Same request, no `Origin` header — expect `403 forbidden`.
- `https://family-board-restore.yuval3000.workers.dev` — expect `404`.
- `curl` (no cookies) against `/board`, `/login`, `/register`, `/recover`, `/bootstrap`,
  `/account`, `/members` — expect `200` and the same SPA shell from each.

If every row still matches, append a short dated note to `docs/production-deployment.md`'s
"Task D revalidation" section: the commit hash just pushed, the CI run URL, and "still matches"
for each row. If anything differs, stop and record it as a real finding in the same place —
do not change application behaviour to make a check pass, and do not go further into
production to investigate (no Data Studio, no smoke script, no additional login attempts).

## Hard rules

- Never run `scripts/auth-smoke.ts`, `scripts/recovery-smoke.ts`, or `scripts/board-smoke.ts`
  against production.
- Never create an account, insert a row, or change anything through Cloudflare Data Studio on
  production's Durable Object.
- Never print `RECOVERY_DIGEST_KEY`, an operator reset token, or the contents of
  `.secrets.production.env`, `.secrets.smoke.json`, or `.secrets.test-recovery-key`.
- Never force-push, amend an existing commit, or skip hooks.
- A failing check is a real defect to report, not an obstacle to route around.

## When done

Report: the pushed commit range, the CI run URL and result, and the production
re-verification result (matches, or what didn't). Then delete this file — it will have been
carried out — and leave everything else (including `handoff-remaining-checks.md`'s open Task B)
exactly as it stands.

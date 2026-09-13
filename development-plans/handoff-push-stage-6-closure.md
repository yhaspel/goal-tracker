# Handoff — push and validate the Stage 6 / Task B closure

A short, mechanical follow-up, written by a Claude session bridged to this machine over
`device_bash` with no `git push` credentials of its own. It closed Stage 6 and Task B by owner
decision (see [`docs/stage-6-completion.md`](../docs/stage-6-completion.md)) and committed that
work as `7151a4b`, one commit ahead of `origin/main`. This file only covers pushing it,
confirming CI, and a light re-check of production; read the completion report first for the
substance of what closed and why.

## 0. This working tree has other, unrelated uncommitted changes — leave them alone

`git status` will very likely show uncommitted modifications to board and i18n files
(`web/src/board/*`, `web/src/i18n/*`, `web/src/components/ui.tsx`, `tests/web.ui.test.ts`, or
similar) that are **not part of this handoff**. They looked, at a glance, like in-progress fixes
for some of the residual findings `docs/stage-6-completion.md` records — but they were not
authored by the session that wrote this file, are not reviewed or tested here, and may still be
mid-edit. Do not `git add -A`, `git commit -a`, `git stash`, or otherwise sweep them into
anything you do here. Only ever `git add` the specific paths this file names. If those changes
are already gone or already committed by the time you read this, that's fine too — just don't
go looking for them or try to finish them as part of this push.

## 1. Orient and sanity-check what is about to be pushed

```sh
git fetch origin
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```

Expect exactly **one** commit, `7151a4b` ("Close Stage 6 and Task B by owner decision, not a
passed gate"), touching only `AGENTS.md`, `README.md`, `development-plans/README.md`,
`docs/production-deployment.md`, `docs/stages-2-6-execution-log.md`,
`docs/stage-6-completion.md` (new), and the two archived-plan renames — nothing under
`worker/src`, `web/src`, or config. If the diff includes anything else, or `origin/main` has
moved since this was written, stop and reconcile rather than pushing blindly.

## 2. Push

```sh
git push origin main
```

Nothing here needs a force push, a rebase, or `--no-verify`. If it's rejected because
`origin/main` moved, fetch and merge or rebase normally; do not force.

## 3. Confirm CI on the pushed commit

Per [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): every push runs `checks`
(install, lint, typecheck, Workers-runtime tests, dependency audit, production bundle dry run),
and on the default branch a `deploy-test` job that deploys **`family-board-test` only**. If `gh`
is authenticated, `gh run list --branch main -L 3` and `gh run view <id>`. If not, this
repository's Actions metadata is readable unauthenticated:
`curl -s https://api.github.com/repos/yhaspel/goal-tracker/actions/runs?branch=main | head` and
the matching `.../jobs` endpoint (job **log** downloads return 403 unauthenticated; status does
not). Confirm both jobs succeed for the commit just pushed and record the run URL. This push is
docs and plans only, so there is nothing new to deploy; `deploy-test` passing is a regression
check, not evidence about anything that changed.

## 4. A light re-check of production

This commit changes no application behavior, so a full re-run of the Task D checklist a third
time in one day is not required. A brief sanity check is still worth thirty seconds:

```sh
curl -s https://family-board-production.yuval3000.workers.dev/api/v1/health
curl -s https://family-board-production.yuval3000.workers.dev/api/v1/auth/bootstrap/status
```

Expect `schemaVersion: 4` / `Cache-Control: no-store`, and `{"bootstrapAvailable":false}` — the
owner's account still exists; that is correct, not a finding. If either differs, stop and record
it in `docs/production-deployment.md` as a real finding; do not investigate further (no Data
Studio, no smoke script, no additional login attempts).

## Hard rules

- Never run `scripts/auth-smoke.ts`, `scripts/recovery-smoke.ts`, or `scripts/board-smoke.ts`
  against production.
- Never create an account, insert a row, or change anything through Cloudflare Data Studio on
  production's Durable Object.
- Never print `RECOVERY_DIGEST_KEY`, an operator reset token, or the contents of
  `.secrets.production.env`, `.secrets.smoke.json`, or `.secrets.test-recovery-key`.
- Never force-push, amend an existing commit, or skip hooks.
- Never stage, commit, or discard the unrelated uncommitted changes described in section 0.

## When done

Report the pushed commit, the CI run URL and result, and the production check result. Then
delete this file — it will have been carried out — and leave everything else, including
whatever is or isn't still uncommitted in board/i18n files, exactly as you found it.

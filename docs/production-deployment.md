# Production deployment record

**Date:** 2026-09-13 (Asia/Jerusalem)
**Worker:** `family-board-production` → <https://family-board-production.yuval3000.workers.dev>
**Version:** `e1b889bd-e89e-45ec-98ce-fe19af832844`, deployed at 100%
**Commit:** `6d1538b`, CI [34751472649](https://github.com/yhaspel/goal-tracker/actions/runs/34751472649) — `checks: success`, `deploy-test: success`
**Deployed by:** `npm run deploy:prod`, manually, on the owner's explicit instruction

## Why this record exists

The plans sequence production behind Stage 7's backup, restore, and hardening gate, and the
Stages 2–6 execution prompt says not to deploy new application behaviour to production. The
owner was told that, asked for the deployment anyway, and that decision stands. This page
records what was deployed, what was deliberately not done, and which guarantees are therefore
not yet in place, so nobody later mistakes the current state for a completed release.

## What was deployed

The application as of commit `6d1538b`: the account API, credential rotation, the board API,
the React interface, and the English, Hebrew, and Russian dictionaries. The production bundle
is byte-identical in behaviour to the test one apart from its bindings — the same asset hash,
`index-UP1JWDx3.js`, is served by both.

On the first request the production Durable Object applied schema migrations 2, 3, and 4. That
is a forward-only change: redeploying older Worker code does **not** remove those tables.

## Secrets

All four were generated fresh for this environment and uploaded through stdin, so none reached
a command line or a shell history entry. Production shares no secret with test.

| Secret | Purpose |
| --- | --- |
| `BOOTSTRAP_SECRET` | Opens one-time owner creation |
| `RECOVERY_DIGEST_KEY` | Keys recovery-phrase digests and operator reset tokens |
| `CSRF_SECRET` | Signs the session-bound CSRF value |
| `RATE_LIMIT_KEY` | Pseudonymises rate-limit bucket keys |

**All four are escrowed at `.secrets.production.env`** (mode 0600, ignored by Git) on the
owner's machine. This was done at creation, because Cloudflare never shows a secret again and
the lost-phrase runbook is inoperable without `RECOVERY_DIGEST_KEY`. The test environment had
to learn that the hard way; see the [execution log](stages-2-6-execution-log.md).

**Move that file into real escrow, separately from any data backup.** A single laptop is not
an escrow. Replacing `RECOVERY_DIGEST_KEY` later invalidates every stored recovery phrase.

## Verified on the deployed Worker

| Check | Result |
| --- | --- |
| `python3 scripts/verify_stage_1.py <production> routing` | Passed: navigation routes serve the shell, unknown paths and unknown API paths return JSON 404, health carries `Cache-Control: no-store`, a wrong method returns 405 with `Allow` |
| Schema version | 4 |
| `GET /api/v1/board`, `GET /api/v1/members` | 401 — live and requiring a session |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":true}` — no owner exists |
| Diagnostic routes | 404; the strings are absent from the minified production bundle |
| `family-board-restore` | Still unexposed, 404, no public route |

## Deliberately not done

- **No owner account was created.** Bootstrap is still open. Nobody can sign in, and the board
  holds nothing but its three seeded columns.
- **No invitations, members, or cards exist.**
- **CI still deploys test only.** Production has no automatic pipeline; this deployment was
  manual and the next one must be too, until a separate production release workflow exists.

## Guarantees that are not yet in place

These are Stage 7's job and none of them is done. They are the reason the gate existed.

- **No backup, export, or restore.** There is no way to take a copy of production data and no
  proven way to put one back. Cloudflare's 30-day point-in-time recovery is not a substitute
  and has never been exercised for this object.
- **The lost-phrase operator rescue has never been proven against a deployed Worker.** It works
  end to end against a local Durable Object using the real runbook SQL, but the deployed
  rehearsal is still outstanding. Until it is done, assume that a person who loses both their
  password and their recovery phrase cannot be recovered.
- **No manual screen-reader review** has been performed in any locale.
- No production security-header review, dependency review, restore drill, or usage review.

See [`development-plans/handoff-remaining-checks.md`](../development-plans/handoff-remaining-checks.md)
for the two outstanding checks and
[`development-plans/stage-7-backup-hardening-release.md`](../development-plans/stage-7-backup-hardening-release.md)
for the rest.

## Creating the owner, when you are ready

Given the above, prefer waiting until backup and the deployed rescue rehearsal exist. When you
do proceed, open <https://family-board-production.yuval3000.workers.dev/bootstrap> and supply
the `BOOTSTRAP_SECRET` from the escrow file together with the owner's address and a new
password. Save the recovery phrase it shows before confirming — it is displayed once and is
not recoverable.

Bootstrap closes permanently once that commits. After it does, consider removing
`BOOTSTRAP_SECRET` from the deployment; the route already refuses a second owner from database
state, so the secret is no longer needed.

## Rollback

Redeploying an earlier Worker version restores earlier behaviour but **does not** undo the
schema migration, and must not be taken below Stage 2, which would remove allowed-list
enforcement. Do not reset or delete the production Durable Object namespace: after an owner
exists it holds the only copy of the household's data, and there is no backup to restore from.

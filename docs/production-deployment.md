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

## Task D revalidation, 2026-09-13 (later the same day)

`handoff-remaining-checks.md` Task D asks for a read-only re-check of the checklist above,
without touching production. Re-run this session, all via plain unauthenticated HTTP requests
with no cookies (no login attempt beyond the one generic-failure check the checklist itself
prescribes), except the last two rows:

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 4`, `Cache-Control: no-store` — matches |
| `GET /api/v1/auth/bootstrap/status` | **`{"bootstrapAvailable":false}`** — does **not** match the deployment-time row above (`true`). See the flag below |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` (no session) | All `401`, code `unauthenticated`, generic body, no address named — matches |
| `GET /api/v1/diagnostics/probe?nonce=<32 hex>` | `404` — matches |
| `POST /api/v1/auth/bootstrap/prepare`, wrong secret | `403`, then `429` with `Retry-After` on repeat — matches |
| `POST /api/v1/auth/login`, dummy address, correct `Origin` | `401 invalid_credentials`, generic message — matches |
| Same request, no `Origin` header | `403 forbidden` — matches |
| `https://family-board-restore.yuval3000.workers.dev` | `404` — matches |
| Browser: `/board`, `/login`, `/register`, `/recover`, `/bootstrap`, `/account`, `/members` | Each returns `200` and serves the same SPA shell (checked with plain `curl`, no cookies) — matches |
| Browser: `/board` as a guest redirects to `/login` | **Not verified.** That redirect is client-side routing, invisible to `curl`, and the only open browser tab to production this session unexpectedly already held a signed-in session rather than a guest one (see the flag below), so this could not be exercised safely |
| Browser: `localStorage`, `sessionStorage`, `document.cookie` | **Not verified**, for the same reason — the browser automation tool's own safety redaction also declines cookie/session-storage reads on a page it recognizes as holding a live session, and this session did not attempt to bypass that |
| Cloudflare dashboard | Production and test remain distinct Durable Object namespaces with distinct secret stores; production still has no Workers Builds connection — matches |

### Flag: bootstrap now reads closed, and a signed-in session exists

Two independent observations this session, both unexpected: `GET /api/v1/auth/bootstrap/status`
now returns `bootstrapAvailable:false` (confirmed twice, including once from a plain `curl` with
no cookies at all, which rules out any browser-session artifact), and a Chrome tab already open
to `/board` returned `200` from `/api/v1/board` and `/api/v1/auth/session` rather than the `401`
a guest gets. Reading `worker/src/routes/auth.ts` confirms `bootstrapAvailable` can only be
`false` once the bootstrap-confirm transaction has run, and that transaction creates the real
owner row in the same statement — there is no code path that lets the flag desync from reality.
Taken together, this looks like a production owner account now exists, most likely created
directly by the owner outside of this session, separately from anything either automated run
did.

This has been raised with the owner and is **not yet confirmed**. Until it is, treat the two
bullets under "Deliberately not done" below about no owner account and no user data as
unconfirmed rather than authoritative. It does not change anything else in this document: if an
owner and household data now exist in production, the cautions elsewhere in this repository
still apply in full — no backup exists, and the lost-phrase operator rescue has been proven only
against the **test** Worker (see the [Stage 3 completion report](stage-3-completion.md)), never
against production's own Durable Object and secrets.

## Deliberately not done

- **No owner account was created, as of this deployment.** Bootstrap was still open at that
  point, and the board held nothing but its three seeded columns. **This is now in question —
  see the "Task D revalidation" flag above, unconfirmed as of 2026-09-13.**
- **No invitations, members, or cards exist, as of this deployment** (same caveat).
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
for the one outstanding check and
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

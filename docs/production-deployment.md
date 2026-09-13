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

| Secret | Purpose | State |
| --- | --- | --- |
| `BOOTSTRAP_SECRET` | Opened one-time owner creation | **Deleted 2026-09-13**, after the owner account existed |
| `RECOVERY_DIGEST_KEY` | Keys recovery-phrase digests and operator reset tokens | Configured |
| `CSRF_SECRET` | Signs the session-bound CSRF value | Configured |
| `RATE_LIMIT_KEY` | Pseudonymises rate-limit bucket keys | Configured |

The three remaining secrets are escrowed at `.secrets.production.env` (mode 0600, ignored by
Git) on the owner's machine. Escrow happened at creation, because Cloudflare never shows a
secret again and the lost-phrase runbook is inoperable without `RECOVERY_DIGEST_KEY`. The test
environment had to learn that the hard way; see the [execution log](stages-2-6-execution-log.md).

**Move that file into real escrow, separately from any data backup.** A single laptop is not
an escrow. Replacing `RECOVERY_DIGEST_KEY` later invalidates every stored recovery phrase.

### `BOOTSTRAP_SECRET` was retired on 2026-09-13

Once the owner account existed, the secret had no remaining purpose: owner creation is closed
permanently by database state, not by the secret. It was deleted from the Worker at the owner's
request and removed from the escrow file, so no copy of it remains anywhere the project
controls.

Bootstrap now fails closed twice over, which was confirmed on the deployed Worker:
`GET /api/v1/auth/bootstrap/status` reports `bootstrapAvailable: false` because the state is
consumed, and `POST /api/v1/auth/bootstrap/prepare` answers `403` for **any** supplied value
because no secret is configured at all. Health, the board, and login were unaffected.

Restoring owner creation is not possible and is not meant to be: if the owner account is ever
lost, the route back is the lost-phrase operator rescue, not a second bootstrap.

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

### Re-verified after the documentation push, 2026-09-13

Commit `94a123e`, CI run
[34756958780](https://github.com/yhaspel/goal-tracker/actions/runs/34756958780) —
`checks: success`, `deploy-test: success`. That push changed documentation only; no application
code moved, and nothing was deployed to production.

The whole checklist above was re-run afterwards with plain unauthenticated `curl`. **Every row
still matches**, with two rows now reading differently for known reasons:

- `GET /api/v1/auth/bootstrap/status` returns `{"bootstrapAvailable":false}`, which is correct
  and expected — an owner exists.
- `POST /api/v1/auth/bootstrap/prepare` now answers `403` for **any** value, not only a wrong
  one, because `BOOTSTRAP_SECRET` has been deleted. Repeats reached `429` with a decreasing
  `Retry-After` (231s, 231s, 230s), so the per-address limit is working.

The 401 bodies were read in full and disclose nothing:
`{"error":{"code":"unauthenticated","message":"Sign in to continue."}}` from all three
protected routes, with no address named. The two rows left unverified above — the guest
redirect from `/board` and browser storage contents — remain unverified here, for the same
reason: checking them needs a browser holding no production session.

### Confirmed: a production owner account exists

Two independent observations this session, both unexpected: `GET /api/v1/auth/bootstrap/status`
returned `bootstrapAvailable:false` (confirmed twice, including once from a plain `curl` with no
cookies at all, which rules out any browser-session artifact), and a Chrome tab already open to
`/board` returned `200` from `/api/v1/board` and `/api/v1/auth/session` rather than the `401` a
guest gets. Reading `worker/src/routes/auth.ts` confirms `bootstrapAvailable` can only be
`false` once the bootstrap-confirm transaction has run, and that transaction creates the real
owner row in the same statement — there is no code path that lets the flag desync from reality.

**The owner confirmed it directly on 2026-09-13: they bootstrapped the production owner account
themselves**, outside of this session and separately from anything either automated run did. So
this is fact, not inference: production now holds a real owner account, and — because the owner
signed in on this machine to do it — a live session for it. Treat the two bullets under
"Deliberately not done" below as describing the state **at deployment**, now superseded; the
current state is in the new section right after this one.

None of the cautions elsewhere in this repository soften because of this — if anything they now
matter more, since they apply to a real account rather than a hypothetical one: no backup exists
for production, and the lost-phrase operator rescue has been proven only against the **test**
Worker (see the [Stage 3 completion report](stage-3-completion.md)), never against production's
own Durable Object and secrets. Concretely: if this owner's password and recovery phrase are
both lost right now, the account is not recoverable, and if the Durable Object were ever lost or
corrupted, there is nothing to restore it from.

## Deliberately not done

- **No owner account was created, at the moment of this deployment.** Bootstrap was open, and
  the board held nothing but its three seeded columns. **No longer current — the owner
  bootstrapped an account on 2026-09-13; see "Confirmed: a production owner account exists"
  above.**
- **No invitations, members, or cards existed, at the moment of this deployment** (same
  caveat — the owner may have added some since).
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
- **No manual screen-reader review** has been performed by this project's tooling in any locale
  — Stage 6 was closed by owner decision without it; see
  [`docs/stage-6-completion.md`](stage-6-completion.md). The owner reported on 2026-09-13 that
  the screen reader works, and the four defects the structural walkthrough had recorded are now
  fixed and deployed, but no review run by this project has ever produced that finding.
- No production security-header review, dependency review, restore drill, or usage review.

See [`docs/stage-6-completion.md`](stage-6-completion.md) for how Stage 6's screen-reader check
was closed and
[`development-plans/stage-7-backup-hardening-release.md`](../development-plans/stage-7-backup-hardening-release.md)
for the rest.

## The owner account, now that it exists

Bootstrap closed on 2026-09-13 when the owner created the account directly (see "Confirmed: a
production owner account exists" above), ahead of the original advice in this document to wait
for backup and a deployed rescue rehearsal first. That decision stands; this section is now
about what protects the account that exists, not about how to create one.

- **The recovery phrase shown at bootstrap is the only backup that exists for this account.**
  It was displayed exactly once. If it was not saved somewhere durable at the time, there is
  currently no way to regenerate it without already being signed in.
- **The lost-phrase operator rescue is unproven against production.** It has been exercised
  successfully, repeatedly, against the **test** Worker's own Durable Object (see the
  [Stage 3 completion report](stage-3-completion.md)), but never against production's. Until
  someone deliberately rehearses it there — which itself requires care, since it means
  generating and redeeming a real operator token against the live object — do not assume it
  will work the same way.
- **`BOOTSTRAP_SECRET` has been deleted** from the deployment, on 2026-09-13. See the Secrets
  section above. It was not load-bearing — the route already refused a second owner from
  database state alone — so removing it only closed residual exposure.
- Bootstrap cannot run again while this owner row exists, so there is no way to create a second
  owner by mistake.

## Rollback

Redeploying an earlier Worker version restores earlier behaviour but **does not** undo the
schema migration, and must not be taken below Stage 2, which would remove allowed-list
enforcement. Do not reset or delete the production Durable Object namespace: after an owner
exists it holds the only copy of the household's data, and there is no backup to restore from.

## Second production deployment, 2026-09-13 — the accessibility fixes

**Version:** `ff9c08c2-8b7e-4b89-8b16-3781e5ba0743`, deployed at 100%
**Commit:** `cec6c80`, CI [34758786464](https://github.com/yhaspel/goal-tracker/actions/runs/34758786464) — `checks: success`, `deploy-test: success`
**Deployed by:** `npm run deploy:prod`, manually, on the owner's explicit instruction

An intermediate deployment of `54e23a7` (version `865df723-d3f4-44c8-9c4e-ea7a93c2bd3c`, CI
[34758484173](https://github.com/yhaspel/goal-tracker/actions/runs/34758484173)) was superseded
about seven minutes later by `cec6c80`, which adds the target-size fix for the guest screens.

This deployment is **interface-only**. No route, no API contract, no migration: the production
Durable Object still reports `schemaVersion: 4`, unchanged from the first deployment, and no
production data was read, created, or modified. The bundle production serves is byte-identical
to the local build and to what CI deployed to test — `sha256 a60fcf87d76a3ef4` for
`index-B_sTXiOj.js` and `ca2965fe67383856` for `index-DBIBJqBn.css`, compared directly rather
than inferred from the filename hash.

What changed: the keyboard-drag announcements, the language-switcher confirmation locale,
`dir="auto"` on the card and column-name inputs, the drag overlay's duplicate DOM `id`, and two
minimum-target-size fixes. See the [Stage 6 completion report](stage-6-completion.md).

### Verified on the deployed Worker, read-only

Nothing below signs in. Production holds a real owner account whose credentials this session
does not have and did not seek.

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 4`, `Cache-Control: no-store` — unchanged by the deployment |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` (no session) | All `401 unauthenticated`, generic body, no address named |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":false}` — the owner still exists and bootstrap stays closed |
| `GET /api/v1/diagnostics/probe` | `404`; diagnostics remain absent from the production bundle |
| `family-board-restore` | `404`, still unexposed |
| SPA routes `/board /login /register /recover /account /members /bootstrap` | Each `200 text/html`; an unknown path is `404` |
| Served assets | Byte-identical to the local build, both hashes confirmed |
| New announcement strings present in the shipped bundle | All three locales — `Picked up` / `הורם` / `поднята`, and the cancel strings — found in the minified production JS |
| Old duplicated-`id` markup | Absent from the shipped bundle |

### The two rows that could never be verified before

Both earlier attempts recorded these as unverified because the only browser tab open to
production already held a live session. A browser context holding no production session at all
closes them:

| Check | Result |
| --- | --- |
| `/board` as a guest redirects to `/login` | **Verified.** Navigating to `/board` with no session lands on `/login` |
| Browser storage contents | **Verified.** `localStorage` and `sessionStorage` are both empty, and the only script-visible cookie is `kanban_locale`, the non-sensitive preference. The session cookie is `__Host-` and `HttpOnly`, so it is correctly invisible to script |

### Guest interface, all three locales, mobile

390 × 844 with touch emulation, across `/`, `/login`, `/register`, `/recover`, and `/bootstrap`
in English, Hebrew, and Russian: correct `lang` and `dir` in every case, no horizontal overflow,
and no interactive target under 24 × 24 CSS pixels apart from one link that is deliberately
inline in a sentence. The only console error is the `401` a guest's own session probe returns,
which is the expected behaviour.

The signed-in screens were exercised against a **local** Durable Object with a disposable owner
account, not against production — that is where the drag announcements, the locale-switch
confirmation, and the editor's text direction were checked. See the
[execution log](stages-2-6-execution-log.md).

### Rollback

Redeploying version `596488a7-b2d5-4415-801c-ecc6d3c49087` restores the interface as it was
before these fixes. It touches no schema and no data, so it is safe in a way the first
deployment's rollback was not — but it reintroduces the four accessibility defects.

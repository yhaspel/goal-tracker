# Stage 2 completion — users, invitations, and sessions

**Date:** 2026-09-13 (Asia/Jerusalem)
**Plan:** [archived Stage 2 plan](../development-plans/archived/stage-2-users-invitations-sessions.md)
**Decision:** **GO for Stage 3.** Every Stage 2 exit-gate condition was met on the deployed
Free test Worker. No production account, secret, or data was created.

## Tested version

| Item | Value |
| --- | --- |
| Implementation commit | `6c793c6` (`6c793c6b328882516655b385264c7afa1cf7a73c`) |
| Preceding candidate | `623d6cd`, then `3ef85f5` |
| CI run | [34745437619](https://github.com/yhaspel/goal-tracker/actions/runs/34745437619) — `checks: success`, `deploy-test: success` |
| Deployed version ID | `1a2b6aaa-381c-4e84-9672-ad67c660eff6`, reported by the `deploy-test` job and confirmed as the live version by `npx wrangler deployments list --env test` |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Deployed schema version | 2, confirmed by `python3 scripts/verify_stage_1.py <host> routing` |

The deployed version is established from the CI job that checked out the commit, the version ID
that job printed, and Cloudflare's own deployment list — not from the health response, which
carries no build identifier.

## Commands

```sh
npm ci
npm run lint
npm run typecheck
npm test          # 47 tests, 6 files, Cloudflare Workers runtime
npm run build
python3 scripts/verify_stage_1.py https://family-board-test.yuval3000.workers.dev routing
node scripts/auth-smoke.ts https://family-board-test.yuval3000.workers.dev < <bootstrap-secret-file>
```

## What was delivered

- **Migration version 2** in `worker/src/db/migrations.ts`: `app_state`, `users`,
  `allowed_emails`, `invitations`, `pending_registrations`, `recovery_credentials`,
  `sessions`, `rate_limits`. A partial unique index on `role = 'owner'` backs up the bootstrap
  transaction so a second owner row cannot exist. The migration is additive and re-runnable;
  `schema_migrations` remains the version record and no `PRAGMA user_version` is used.
- **Authentication primitives** in `worker/src/auth/`: `crypto.ts`, `email.ts`, `passwords.ts`,
  `phrases.ts`, `sessions.ts`, `csrf.ts`, `rate-limits.ts`, `authorize.ts`, plus the generated
  `wordlist.ts` and `common-passwords.ts`, each carrying its source URL, retrieval date,
  licence, and SHA-256 digest.
- **Routes** in `worker/src/routes/`: `auth.ts`, `allowed-emails.ts`, `invitations.ts`,
  `members.ts`, dispatched from `worker/src/household-do.ts`. `worker/src/http.ts` centralises
  body parsing, the exact same-origin check, and error mapping onto the shared envelope.
- **Front Worker**: an explicit API route allowlist, a 16 KiB auth body cap, and a JSON
  content-type check. An unknown `/api` path is refused at the edge and costs no Durable Object
  request.
- **Tests**: `tests/auth.integration.test.ts`, `tests/auth.concurrent.test.ts`,
  `tests/auth.security.test.ts`, with `tests/helpers/auth-client.ts`.
- **Operator tooling**: `scripts/auth-smoke.ts`.

## Acceptance evidence

`scripts/auth-smoke.ts` ran against the deployed test host and reported **37 of 37 checks
passed**, covering owner bootstrap and its permanent closure, the allowed-email list and its
revision guard, invitation issue and single use, six invited registrations, authorization
boundaries, removal and re-addition, and disclosure checks.

A second deployed run against the current version `1a2b6aaa` re-exercised the registration and
deactivation paths on the same household and reported **15 of 15 checks passed**: the owner
cannot deactivate themself; deactivating a member frees exactly one seat, revokes their
sessions, and blocks their login while the account row survives; the freed seat accepts a new
invited registration; a wrong phrase is refused; the removed address can no longer be invited.

| Exit-gate condition | Evidence |
| --- | --- |
| Owner bootstrap needs the configured secret and phrase confirmation; a second attempt fails | Deployed smoke; `tests/auth.integration.test.ts` |
| Two simultaneous bootstrap confirmations produce one owner | `tests/auth.concurrent.test.ts` |
| Missing or wrong bootstrap secret fails closed | Deployed smoke; integration and security tests |
| Only the owner reads or replaces the allowed list; stale revisions are refused with no write | Deployed smoke; concurrent replacement test |
| Malformed, duplicate, over-seven, or owner-omitting lists are refused | Integration tests |
| Seven-day single-use invitations; codes appear once | Deployed smoke; integration tests |
| Removed email revokes sessions, unused invitations, and pending registrations at once | Deployed smoke, across two devices |
| Re-adding an address restores login for a still-active account | Deployed smoke |
| Owner plus six members active; an eighth is refused | Deployed smoke; `tests/auth.concurrent.test.ts` proves one of two simultaneous confirmations for the last seat wins and the loser's invitation stays unconsumed |
| Deactivation frees a seat and revokes sessions; the owner cannot self-deactivate | Deployed seat-recycling run; integration tests |
| Identical passwords hash differently; wrong password and unknown email answer identically | `tests/auth.security.test.ts` |
| Rate limits answer 429 with `Retry-After` before scrypt runs | Security tests; the limit check precedes the derivation in `worker/src/routes/auth.ts` |
| Cookie is `__Host-` prefixed, Secure/HttpOnly/SameSite=Lax/Path=/, no `Domain`, bounded expiry | Observed live: `__Host-kanban_session=…; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`, with `Cache-Control: no-store` |
| A live session is refused on guest-only routes; wrong or missing CSRF or Origin is 403 | Deployed smoke; security tests |
| No plaintext credential in responses, SQL rows, or logs | `tests/auth.security.test.ts` dumps every application row and every emitted security event and asserts the absence of the password, phrase, pending token, session token, invitation code, and bootstrap secret; the deployed smoke repeats the response-side check |
| No mail dependency or email-reset endpoint | Deployed 404 for `/api/v1/auth/password-reset`; route-surface test; no mail package in `package.json` |

## Measured behaviour of the deployed Free runtime

Stage 1 could not observe live contention on the bounded key-derivation queue and left CPU and
queue-wait unquantified. Stage 2 measured the deployed test Worker directly and can now explain
that gap rather than leave it open.

| Probe | Result |
| --- | --- |
| 10 simultaneous `GET /api/v1/health` | 381 ms wall-clock for all ten, so the client parallelises requests correctly |
| 10 simultaneous failed logins | 2,321 ms total, all ten answered `401`, none refused |
| 12 simultaneous failed logins | 2,751 ms total, all twelve answered `401`, none refused |
| 8 simultaneous failed logins with 3 health reads injected at +416 ms | The health reads completed at +1,887 ms, when the login burst drained at +1,890 ms |

Health normally answers in well under 100 ms, so a health read delayed by roughly 1.5 seconds
shows the Durable Object was occupied for the entire burst. **Native scrypt blocks the Durable
Object for the duration of each derivation, so the runtime serialises work on the object before
the bounded queue can ever accumulate waiters.** The marginal cost is about 230 ms per
derivation once the pipeline is full; Stage 1's 555 ms p50 was a whole request round trip
including network.

Consequences recorded for later stages:

- The bounded one-active-plus-seven-waiting queue remains a correct memory safeguard and its
  exact capacity is still proven by the Workers-runtime test in `tests/scrypt.test.ts`, but it
  is **not** the active limiter under real HTTP load. The persistent per-email and per-IP rate
  limits are what actually bound attacker-driven derivation work.
- A burst of credential operations delays every other request to the same household, including
  Stage 4 board reads. Seven people produce at most a second or two of delay, which matches
  Stage 1's 1,569 ms seven-request burst, but Stage 7's usage review should keep watching it.
- Because of this, login performs no storage write before its derivation. An earlier version
  pruned expired rate-limit rows first; that write held the Durable Object's input gate and
  staggered delivery of concurrent sign-ins. Pruning now happens inside transactions that
  already write.

## Deviations from the plan as written

- `pending_registrations` carries a `language` column that the plan's table sketch does not
  list. The prepare request accepts `language` and the confirming transaction creates the user,
  so the chosen locale has to survive between the two calls. The plan permits column spellings
  to differ where the typed repository maps them exactly.
- Security events are emitted as one JSON line per event through `worker/src/security-log.ts`
  rather than a SQL table. The master plan's data model lists no events table, and a Durable
  Object has a 1 GB storage ceiling on Free. Only a timestamp, event name, outcome, opaque user
  id, and small counts are emitted; an allowed-list edit records counts, never addresses.
- The common-password denylist holds 19,852 entries: the first 20,000 entries of the
  twelve-or-more-character subset of a pinned frequency-ordered source, lower-cased and
  deduplicated. The full subset is 46,296 entries and would add roughly 349 KB gzipped for
  little extra coverage, since the twelve-code-point minimum already rejects shorter leaks.
- `scripts/verify_stage_1.py` no longer asserts schema version 1 literally. It reads
  `SCHEMA_VERSION` from the migration module and polls the deployed health route until that
  value appears. This also closed a real gap: on one push the check ran about a second after
  upload and passed against the previous version.

## Limitations

- All evidence comes from the isolated `test` Worker and disposable identities. No production
  owner, secret, or user data exists. `BOOTSTRAP_SECRET`, `RECOVERY_DIGEST_KEY`, `CSRF_SECRET`,
  and `RATE_LIMIT_KEY` are configured as test-only Cloudflare secrets; production values are
  provisioned and escrowed in Stage 7.
- Internal Durable Object CPU time and peak memory remain unquantified, for the reason Stage 1
  recorded: a deployed Worker freezes its timers between I/O. The wall-clock figures above bound
  the behaviour from the outside.
- The test household reached its seven active seats during the smoke run, so re-running the full
  bootstrap-and-six-registrations flow needs a reset disposable namespace. The seat-recycling
  run above is the repeatable path on an existing household.
- No browser, accessibility, or screen-reader check was performed. Stage 2 delivers API
  behaviour only; the settings interface arrives in Stage 5 and its localisation and
  accessibility validation in Stage 6.

## Rollback

A failed deploy rolls back to a compatible Worker version that still enforces the allowed list.
Deploying pre-Stage-2 code would restore access to removed members, so it is not a valid
rollback target once accounts exist. Migration version 2 is additive and is **not** reversed by
redeploying code; repair forward with a tested migration, or reset the disposable test namespace.
Never apply that reset to a production Durable Object. If a test bootstrap is left incomplete,
let its pending record expire and retry; once owner activation commits, bootstrap stays consumed.

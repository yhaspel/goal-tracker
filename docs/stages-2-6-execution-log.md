# Stages 2–6 execution log

Working record for the [autonomous Stages 2–6 execution prompt](../development-plans/execute-stages-2-through-6-autonomously.md).
A resumed session should read this file, that prompt, `AGENTS.md`, and the
[plan index](../development-plans/README.md) before touching code, then continue from the
verified evidence below rather than re-running finished work or assuming completion.

Timestamps are Asia/Jerusalem. No secret, password, recovery phrase, invitation code, session
token, or personal address appears in this file.

## Current position

| Field | Value |
| --- | --- |
| Current stage | 2 — users, invitations, and sessions |
| State | Implementation complete and locally verified; deployed test gate not yet run |
| Baseline commit | `c5aa9ab` (Stage 1 complete, CI `checks` and `deploy-test` both green) |
| Candidate commit | pending first Stage 2 push |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Next action | Push the Stage 2 candidate, confirm CI `deploy-test`, provision the four test secrets, run `scripts/auth-smoke.ts` against the deployed host |

## Environment facts confirmed at session start (2026-09-13)

- Node 25.2.1 / npm 11.12.1 match `.node-version` and `packageManager`.
- `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all passed on the
  untouched baseline before any edit.
- `npx wrangler whoami` reports account `Yuval3000@gmail.com's Account`
  (`5232edb7a284646f0ef958b239103ad0`) with `workers (write)` and `workers_scripts (write)`.
- `gh auth status` reports `yhaspel`, scopes include `repo`.
- Remote `origin` is `https://github.com/yhaspel/goal-tracker.git`; branch `main` is the default.
- CI run `34743659465` for `c5aa9ab` shows `checks: success` and `deploy-test: success`.

## Stage 2 progress

### Implemented

- Schema migration version 2: `app_state`, `users`, `allowed_emails`, `invitations`,
  `pending_registrations`, `recovery_credentials`, `sessions`, `rate_limits`, with a partial
  unique index that permits only one owner row.
- `worker/src/auth/`: `crypto.ts`, `email.ts`, `passwords.ts`, `phrases.ts`, `sessions.ts`,
  `csrf.ts`, `rate-limits.ts`, `authorize.ts`, plus the pinned `wordlist.ts` and
  `common-passwords.ts` generated files.
- `worker/src/routes/`: `auth.ts`, `allowed-emails.ts`, `invitations.ts`, `members.ts`, wired
  through `worker/src/household-do.ts`; shared parsing, Origin, and error mapping in
  `worker/src/http.ts`; coarse event logging in `worker/src/security-log.ts`.
- Front Worker: explicit API route allowlist, 16 KiB auth body cap, JSON content-type check.
- Tests: `tests/auth.integration.test.ts`, `tests/auth.concurrent.test.ts`,
  `tests/auth.security.test.ts`, with shared helpers in `tests/helpers/auth-client.ts`.
- `scripts/auth-smoke.ts` for the deployed test environment.

### Local evidence

- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npm test`: 47 tests across 6 files passed in the Workers runtime.
- `node scripts/auth-smoke.ts http://127.0.0.1:8787` against a clean `wrangler dev --env test`
  local Durable Object: 37 of 37 checks passed.

### Deviations and decisions recorded

- `pending_registrations` carries a `language` column that the Stage 2 table sketch does not
  list. The prepare request accepts `language` and the confirming transaction creates the
  user, so the chosen locale has to survive between the two calls.
- Security events are emitted as one JSON line per event through the single
  `worker/src/security-log.ts` sink rather than a SQL table, because the master plan's data
  model does not include an events table and a Durable Object has a 1 GB storage ceiling.
  `eslint`'s `no-console` rule is disabled on that one line only.
- The common-password denylist is the first 20,000 entries of the 12-or-more-character subset
  of a pinned frequency-ordered source list. The full subset is 46,296 entries and would add
  about 349 KB gzipped to the Worker bundle for little extra coverage.
- The local smoke run initially failed because six members plus a reuse probe needed twelve
  registration prepares from one address, over the plan's ten-per-IP budget. The budget was
  left as specified and the script now probes invitation reuse once.

### Open risks

- Stage 1 left deployed CPU, queue-wait, and peak-memory values unmeasured, and never observed
  a live 503 from the bounded key-derivation queue. `scripts/auth-smoke.ts` fires nine
  simultaneous credential checks and reports how many were refused retryably. The local run
  observed 0 of 9, so the requests did not overlap; the deployed run is the one that matters.
- Stage 6 requires a manual screen-reader review in three locales. That needs a human operator
  with a screen reader and cannot be performed from this session.

## Stage 3–6 progress

Not started.

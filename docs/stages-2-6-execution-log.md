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
| Current stage | 3 — recovery and manual rescue |
| State | Stage 2 complete and archived; Stage 3 not started |
| Last verified commit | `6c793c6`, CI [34745437619](https://github.com/yhaspel/goal-tracker/actions/runs/34745437619), deployed version `1a2b6aaa-381c-4e84-9672-ad67c660eff6` |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Next action | Implement Stage 3 from [its plan](../development-plans/stage-3-recovery-manual-rescue.md): migration version 3, the three rotation flows, the operator token script, and the Data Studio runbook |

## Environment facts confirmed at session start (2026-09-13)

- Node 25.2.1 / npm 11.12.1 match `.node-version` and `packageManager`.
- `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all passed on the
  untouched baseline before any edit.
- `npx wrangler whoami` reports account `Yuval3000@gmail.com's Account`
  (`5232edb7a284646f0ef958b239103ad0`) with `workers (write)` and `workers_scripts (write)`.
- `gh auth status` reports `yhaspel`, scopes include `repo`.
- Remote `origin` is `https://github.com/yhaspel/goal-tracker.git`; branch `main` is the default.
- CI run `34743659465` for the Stage 1 baseline `c5aa9ab` showed `checks: success` and
  `deploy-test: success`.

## Standing operational notes

- **Deploy before acceptance.** Deployed acceptance must run against the final commit of a
  stage. Stage 2 ran its full flow one commit early and then needed a second deployed run to
  cover the difference. Land every code change for a stage first, let CI deploy it, then run
  the acceptance flow once.
- **The test household is a persistent fixture.** It holds a disposable owner and six members
  and its seven seats are full. Deactivating a member frees a seat but its user row and email
  are permanently unusable, so a full bootstrap-and-six-registrations run needs a reset
  disposable namespace. Identities live in `.secrets.smoke.json` (mode 0600, Git-ignored).
- **Test secrets are provisioned.** `BOOTSTRAP_SECRET`, `RECOVERY_DIGEST_KEY`, `CSRF_SECRET`,
  and `RATE_LIMIT_KEY` exist as Cloudflare secrets on `family-board-test`. Stage 3 reuses
  `RECOVERY_DIGEST_KEY` with a different domain prefix and needs no new secret.
- **Verify the deployed version, never infer it.** Take the commit from the CI run, the version
  id from the `deploy-test` job log, and confirm it against `npx wrangler deployments list
  --env test`. `npm run check:links` runs in CI, so a moved plan fails the build until every
  reference is repaired.

## Stage 2 — complete

Closed on 2026-09-13. Evidence, deviations, and rollback notes are in
[`docs/stage-2-completion.md`](stage-2-completion.md); the plan is archived at
[`development-plans/archived/stage-2-users-invitations-sessions.md`](../development-plans/archived/stage-2-users-invitations-sessions.md).

Headline evidence: `npm test` covers 47 tests in the Workers runtime;
`scripts/auth-smoke.ts` reported 37 of 37 checks against the deployed test Worker; a follow-up
deployed run covering registration, deactivation, and seat recycling on the current version
reported 15 of 15.

### Findings worth carrying forward

- **Key derivation blocks the Durable Object.** Eight simultaneous failed logins occupied the
  object for 1,890 ms, and health reads issued at +416 ms did not complete until +1,887 ms.
  Twelve simultaneous logins took 2,751 ms with none refused. The runtime therefore serialises
  work on the object before the bounded key-derivation queue can accumulate waiters. The queue
  stays as a memory safeguard with its capacity proven by the Workers-runtime test, but the
  persistent per-email and per-IP rate limits are the real bound on attacker-driven work. This
  explains the live 503 that Stage 1 could not observe; it is not an unresolved gap any more.
- **A credential burst delays everything else on the household.** Stage 4 board reads will
  queue behind a login burst. Acceptable at seven people; Stage 7's usage review should watch it.
- **Keep storage writes out of any path that precedes a derivation.** An early write holds the
  Durable Object's input gate and staggers concurrent delivery.
- The CI routing check now reads `SCHEMA_VERSION` from the migration module and polls until the
  deployed Worker reports it. Before that it passed against a version that had not finished
  propagating.

## Stages 3–6

Not started.

## Open risks

- Stage 6 requires a manual screen-reader review of representative desktop and mobile workflows
  in English, Hebrew, and Russian. That needs a human operator with a screen reader and cannot
  be performed from this session. Automated accessibility checks do not satisfy it, so unless a
  person runs it, Stage 6 cannot be declared complete and this execution prompt must not
  self-archive.
- Internal Durable Object CPU duration and peak memory stay unquantified, for the reason Stage 1
  recorded: a deployed Worker freezes its timers between I/O.

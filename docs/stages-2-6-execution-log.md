# Stages 2–6 execution log

Working record for the [autonomous Stages 2–6 execution prompt](../development-plans/execute-stages-2-through-6-autonomously.md).
A resumed session should read this file, that prompt, `AGENTS.md`, the
[plan index](../development-plans/README.md), and
[`handoff-remaining-checks.md`](../development-plans/handoff-remaining-checks.md) before
touching code, then continue from the verified evidence below rather than re-running finished
work or assuming completion.

Timestamps are Asia/Jerusalem. No secret, password, recovery phrase, invitation code, session
token, or personal address appears in this file.

## Where the run stands

| Stage | State |
| --- | --- |
| 2 — users, invitations, sessions | **Complete.** [Report](stage-2-completion.md), plan archived |
| 3 — recovery and manual rescue | Implemented and locally verified. **One check open:** the operator rescue has never been redeemed against the deployed Worker, because inserting the token needs Durable Object Data Studio |
| 4 — board API | **Complete.** [Report](stage-4-completion.md), plan archived |
| 5 — board and account UI | **Complete.** [Report](stage-5-completion.md), plan archived |
| 6 — localisation and accessibility | Implemented and locally verified. **One check open:** the manual screen-reader review in three locales |

| Field | Value |
| --- | --- |
| Head commit | `8f15347`, CI [34749414211](https://github.com/yhaspel/goal-tracker/actions/runs/34749414211) — `checks: success`, `deploy-test: success`, deployed version `c43e6ed1-6459-4fda-8fd1-c403af0166ce` |
| Commit acceptance ran against | `6aae5b6`, CI [34749133629](https://github.com/yhaspel/goal-tracker/actions/runs/34749133629), deployed version `0719da20-9c2c-4598-81a3-a74116c2306d`. `8f15347` changed only documents and one test, so the Worker bundle is unchanged between them |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Next action | The two checks in [`handoff-remaining-checks.md`](../development-plans/handoff-remaining-checks.md). The execution prompt must not self-archive until both pass |

## Local files this run left behind

All are Git-ignored, mode 0600, and hold disposable test material only. The handoff needs the
first two.

| File | Purpose |
| --- | --- |
| `.secrets.smoke.json` | Disposable identities for the deployed test household |
| `.secrets.test-recovery-key` | The test environment's escrowed `RECOVERY_DIGEST_KEY`, required by the lost-phrase runbook |
| `.secrets.bootstrap` | The test `BOOTSTRAP_SECRET`, needed only to bootstrap a reset namespace |
| `.dev.vars` | Four throwaway secrets for `npm run dev`; regenerate freely |

## Environment facts confirmed at session start (2026-09-13)

- Node 25.2.1 / npm 11.12.1 match `.node-version` and `packageManager`.
- `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all passed on the
  untouched baseline before any edit.
- `npx wrangler whoami` reports account `Yuval3000@gmail.com's Account`
  (`5232edb7a284646f0ef958b239103ad0`) with `workers (write)` and `workers_scripts (write)`.
- `gh auth status` reports `yhaspel`, scopes include `repo`.
- Remote `origin` is `https://github.com/yhaspel/goal-tracker.git`; branch `main` is the default.
- CI run `34743659465` for the Stage 1 baseline `c5aa9ab` showed both jobs green.

## Standing operational notes

- **Deploy before acceptance.** Deployed acceptance must run against a stage's final commit.
  Stage 2 ran its full flow one commit early and needed a second deployed run to cover the
  difference. Land every code change for a stage first, let CI deploy it, then run acceptance.
- **The test household is a persistent fixture.** One disposable owner and six members, seven
  seats full. Deactivating a member frees a seat but its user row and address are permanently
  unusable, so `scripts/board-smoke.ts` swaps the freed address for a fresh one and registers a
  replacement. A full bootstrap-and-six-registrations run needs a reset namespace. Identities
  live in `.secrets.smoke.json` (mode 0600, Git-ignored).
- **Test secrets are provisioned.** `BOOTSTRAP_SECRET`, `RECOVERY_DIGEST_KEY`, `CSRF_SECRET`,
  and `RATE_LIMIT_KEY` exist on `family-board-test`. `RECOVERY_DIGEST_KEY` is escrowed at
  `.secrets.test-recovery-key`; without it the lost-phrase runbook cannot be followed at all.
- **Rate limits bite during repeated smoke runs.** One `recovery-smoke.ts` run charges five
  recovery starts against the subject account and about eight against the calling address,
  against budgets of five and ten per fifteen minutes. A second run inside that window is
  refused with `429`. That is the limiter working, not a regression.
- **Verify the deployed version, never infer it.** Take the commit from the CI run, the version
  id from the `deploy-test` job log, and confirm it against `npx wrangler deployments status
  --env test`. `check:links` and `check:i18n` run in CI, so a moved plan or an untranslated
  string fails the build.

## Findings worth carrying into Stage 7

- **Key derivation blocks the Durable Object.** Eight simultaneous failed logins occupied the
  object for 1,890 ms, and health reads issued at +416 ms did not complete until +1,887 ms.
  Twelve simultaneous logins took 2,751 ms with none refused. The runtime serialises work on
  the object before the bounded key-derivation queue can accumulate waiters, which explains the
  live 503 Stage 1 could not observe. The queue stays as a memory safeguard; the persistent
  per-email and per-IP rate limits are the real bound on attacker-driven work. A credential
  burst also delays every other request to the same household, including board reads.
- **Keep storage writes out of any path that precedes a derivation.** An early write holds the
  object's input gate and staggers concurrent delivery.
- **Foreign keys are enforced by default** in the Durable Object runtime; no pragma needed.
- **Reorder write cost is proportional to displaced cards only**, bounded by source plus
  destination column size — at most 500 rows under the card cap. See the
  [Stage 4 report](stage-4-completion.md).
- **Escrow `RECOVERY_DIGEST_KEY` when it is provisioned.** It was first created without being
  kept, which made the rescue runbook inoperable and forced a rotation that invalidated every
  stored recovery phrase in the test environment. The README now documents this; Stage 7 must
  not repeat it for production.
- **A deployment can report 100% live while the edge still serves the old script.** On
  2026-09-13 at 08:15 UTC a Stage 4 deployment took roughly 25 minutes to take effect. The CI
  deploy, a manual `wrangler deploy`, `wrangler versions upload` plus
  `wrangler versions deploy <id>@100`, and `wrangler triggers deploy` all reported success
  while three independent probes — two of them front-Worker checks that never reach the
  Durable Object — showed the previous code, including from an unrelated network.
  `cloudflarestatus.com` showed no open incident. Later deployments propagated within seconds.
  `scripts/verify_stage_1.py` now polls slowly for the expected schema version, because a tight
  poll keeps the object warm and prevents the restart it is waiting for.
- **The same race has a second symptom: Static Assets and the Worker script do not always reach
  an edge together.** On `ad05035` the `deploy-test` job failed because the served index page
  named a hashed bundle that answered 404 about a second after upload. The site was correct
  minutes later and the hash matched a local build of that commit, so nothing was broken. The
  verifier now retries the index page and every asset it names as a pair. Treat a first-attempt
  asset or schema mismatch as propagation, not as a defect — but confirm it settles rather than
  assuming it will.

## Deviations from the plans, with reasons

- `pending_registrations` carries a `language` column the Stage 2 table sketch does not list;
  the prepare request accepts a locale and the confirming transaction creates the user.
- Security events go to one `console` sink rather than a SQL table: the master plan's data
  model has no events table and a Durable Object has a 1 GB ceiling.
- The common-password denylist is the first 20,000 entries of the twelve-or-more-character
  subset of a pinned frequency-ordered source. The full subset would add about 349 KB gzipped
  for little extra coverage.
- Credential rotation revokes sessions by setting `revoked_at` rather than deleting rows, as
  Stage 3 words it, so the project keeps one session model and an auditable trail.
- Stage 4's `validation_error` was reconciled to Stage 2's already-deployed `invalid_request`;
  the Stage 4 plan records this inline.
- The three seeded columns use fixed UUIDs, which are opaque and maximally stable.

## What was verified where

Deployed, against the isolated test Worker: `scripts/auth-smoke.ts` 37/37,
`scripts/recovery-smoke.ts` 23/23 with the operator leg skipped, `scripts/board-smoke.ts` 39/39
twice, `scripts/verify_stage_1.py routing`, a seat-recycling run 15/15, and a browser
walkthrough covering deep links, sign-in, a mixed-script card, deletion, all three locales at
desktop and mobile widths, and an empty browser storage check.

Locally, against a Durable Object running the same commit: 115 Workers-runtime tests, the
complete lost-phrase runbook including generation, insertion, redemption, reuse refusal,
revocation, and the audit query, and a browser walkthrough covering pointer drag, keyboard
drag, the explicit move controls, the owner settings screen, and a 320 CSS pixel viewport.

Not performed: any screen-reader session, any physical touch device, and the deployed operator
rescue. Nothing about those is claimed anywhere in this repository.

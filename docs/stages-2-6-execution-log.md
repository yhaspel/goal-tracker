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
| 3 — recovery and manual rescue | **Complete.** [Report](stage-3-completion.md), plan archived |
| 4 — board API | **Complete.** [Report](stage-4-completion.md), plan archived |
| 5 — board and account UI | **Complete.** [Report](stage-5-completion.md), plan archived |
| 6 — localisation and accessibility | Implemented and locally verified. **One check open:** the manual screen-reader review in three locales |

| Field | Value |
| --- | --- |
| Head commit | `e90b65a`, CI [34751848731](https://github.com/yhaspel/goal-tracker/actions/runs/34751848731) — `checks: success`, `deploy-test: success`, deployed version `86d659ef` |
| Commit acceptance ran against | `e90b65a` — the full local suite and `recovery-smoke.ts` (28/28, including the operator leg) both ran directly against this commit and its deployment on 2026-09-13 |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Next action | The one remaining check in [`handoff-remaining-checks.md`](../development-plans/handoff-remaining-checks.md): Stage 6's screen-reader review. The execution prompt must not self-archive until it passes |

## Production was deployed on 2026-09-13, ahead of the Stage 7 gate

The owner asked for the application to be published to production, was told why the plans
sequence that behind Stage 7's backup and restore work and that the lost-phrase rescue has
never been proven on a deployed Worker, and confirmed the request. It was deployed manually
from commit `6d1538b` as version `e1b889bd-e89e-45ec-98ce-fe19af832844`, with its own four
secrets escrowed at creation. At that moment no owner account existed. **The owner has since
bootstrapped a real owner account there directly, confirmed on 2026-09-13** — production now
holds real data, not none.

This departs from the execution prompt's instruction not to deploy new application behaviour to
production. It was a deliberate owner decision, not an oversight, and it does not change what
Stage 6 still owes. Task A has since proven the rescue mechanism correct against the deployed
**test** Worker ([report](stage-3-completion.md)), but that evidence does not carry over to
production's own Durable Object and secrets, so the caution below still holds there — now for a
real account rather than a hypothetical one.
[The production deployment record](production-deployment.md) is the authoritative description
of what is and is not in place there.

## Local files this run left behind

All are Git-ignored, mode 0600, and hold disposable test material only. The handoff needs the
first two.

| File | Purpose |
| --- | --- |
| `.secrets.smoke.json` | Disposable identities for the deployed test household |
| `.secrets.test-recovery-key` | The test environment's escrowed `RECOVERY_DIGEST_KEY`, required by the lost-phrase runbook |
| `.secrets.bootstrap` | The test `BOOTSTRAP_SECRET`, needed only to bootstrap a reset namespace |
| `.dev.vars` | Four throwaway secrets for `npm run dev`; regenerate freely |
| `.secrets.production.env` | **The production environment's four secrets.** Cloudflare will not show them again. Move this into real escrow, separately from any data backup |

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
- **Task C, checked 2026-09-13: neither Worker has a second deploy pipeline.** Both
  `family-board-test`'s and `family-board-production`'s dashboard Settings → Builds show no Git
  repository connected — just the unused GitHub/GitLab connect buttons, no repo, branch, or
  connected badge. Workers Builds is not silently double-deploying either Worker; the
  propagation-delay explanation above stands as the best one.

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
`scripts/recovery-smoke.ts` 23/23 with the operator leg skipped, then later **28/28 with the
operator leg redeemed and separately revoked** ([report](stage-3-completion.md)),
`scripts/board-smoke.ts` 39/39 twice, `scripts/verify_stage_1.py routing`, a seat-recycling run
15/15, and a browser walkthrough covering deep links, sign-in, a mixed-script card, deletion,
all three locales at desktop and mobile widths, and an empty browser storage check.

Locally, against a Durable Object running the same commit: 115 Workers-runtime tests, the
complete lost-phrase runbook including generation, insertion, redemption, reuse refusal,
revocation, and the audit query, and a browser walkthrough covering pointer drag, keyboard
drag, the explicit move controls, the owner settings screen, and a 320 CSS pixel viewport.

This session added one more layer, short of Task B's actual requirement: an interactive
walkthrough of the deployed test Worker driven through a Chrome browser extension, reading the
accessibility tree and raw ARIA/DOM state directly (structural queries and screenshots) rather
than listening with a screen reader. Desktop-only, English, Hebrew, and Russian: sign in, create
a mixed-script card, assign a member, save, move it with the explicit controls, move it again
with the keyboard drag, delete it, then repeat card creation and a structural check in the other
two locales. This is not a substitute for Task B and does not close it, but it surfaced concrete,
reproducible findings a real screen-reader pass should check first:

- **A mixed-script title's visual order can diverge from the typed order.** A card titled
  `Buy milk לחלב 2%` (English UI, left-to-right base direction) renders visually as
  "Buy milk 2% לחלב" — the Hebrew word and the trailing `2%` swap places under the plain Unicode
  bidi algorithm, with no directional isolation applied to the field. The same kind of content
  typed the other way round, `קנייה: 2% חלב Milk` (Hebrew UI, right-to-left base direction),
  rendered in the exact typed order with no reordering. Directly relevant to the Stage 6 plan's
  "read in the correct character order" question — the risk is specific to Latin/digit text
  trailing Hebrew inside an English-locale (left-to-right) field.
- **The language switcher's own confirmation lags one locale behind the selection.** Switching
  English to Hebrew announced "Language saved." in English; switching Hebrew to Russian
  announced "השפה נשמרה." in Hebrew. Every other action's live-region text (card saved, moved,
  deleted) updates to the newly selected locale immediately on that same action — only this one
  confirmation is stale by exactly one switch.
- **Keyboard drag gives no feedback between pick-up and drop.** Space correctly picks up a card
  (a properly `aria-hidden` drag-overlay clone appears; the original's Move-up/Move-down buttons
  become genuinely `disabled`, not just styled that way) and the arrow keys do move it — the
  card landed in the intended column on drop — but nothing announces the pick-up itself, and
  nothing indicates which column or position is targeted while arrow keys are pressed. The only
  confirmation is the final "moved to `<column>`, position `<n>`" announcement after dropping.
- Minor: the drag-overlay clone shares its DOM `id` with the original element (duplicate `id` is
  invalid HTML), though this has no accessibility-tree consequence since the clone carries
  `aria-hidden="true"`; this tool's own accessibility-tree dump does not appear to honor that
  attribute, which is why a direct DOM/ARIA query was needed to tell the two apart.

Not performed, still: any screen-reader session, any locale review on mobile, and any physical
touch device. Nothing about those is claimed anywhere in this repository.

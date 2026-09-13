# Handoff — the check that needs a person

You are continuing the [autonomous Stages 2–6 run](execute-stages-2-through-6-autonomously.md)
in the `yhaspel/goal-tracker` repository. Read that prompt, `AGENTS.md`, the
[plan index](README.md), and the [execution log](../docs/stages-2-6-execution-log.md) in full
before touching anything.

**Everything is implemented and pushed.** Stages 2, 3, 4, and 5 are complete and archived; see
the [Stage 3 completion report](../docs/stage-3-completion.md) for Task A's outcome. Stage 6 is
implemented, fully covered by tests, and verified locally, but is one check short of its exit
gate — a real screen reader, which the previous session did not have.

**Production now runs the application**, deployed by hand on 2026-09-13 at the owner's request,
ahead of the Stage 7 gate. It has no owner account and no user data, and no backup or restore
path exists. Read [the production deployment record](../docs/production-deployment.md) before
going anywhere near it. Task D below is its validation.

Do not change application behaviour to make a check pass. If a check fails, report the failure
and stop; that is a real defect, not an obstacle.

Throughout: **never point a smoke script at production.** All three refuse a hostname
containing `production`, but the rule matters more than the guard — they create accounts,
rotate credentials, and deactivate members.

## Before you start

```sh
cd <repo>
npm ci
npm run lint && npm run typecheck && npm run check:links && npm run check:i18n && npm test
git log --oneline -1        # expect the head that CI last deployed
gh run list --limit 1       # expect checks: success and deploy-test: success
```

Confirm the deployed test Worker is the current commit before trusting any live result:

```sh
python3 scripts/verify_stage_1.py https://family-board-test.yuval3000.workers.dev routing
npx wrangler deployments status --env test
```

A deployment normally reaches the edge within seconds. On 2026-09-13 one took roughly
25 minutes while Cloudflare's API already reported it live at 100%; the execution log records
the evidence. If you see that again, wait and re-probe rather than assuming the code is live.

Disposable identities for the test household are in `.secrets.smoke.json` (mode 0600, ignored
by Git). The environment's `RECOVERY_DIGEST_KEY` is escrowed in `.secrets.test-recovery-key`.
Neither file may be committed, printed, or pasted anywhere.

---

## Task A — done, 2026-09-13

The lost-phrase operator rescue was redeemed against the deployed test Worker, following
[`docs/operator-lost-phrase-reset.md`](../docs/operator-lost-phrase-reset.md) exactly, once for
a redemption and once for a revocation. `scripts/recovery-smoke.ts` reported **28 of 28 checks
passed**, including the full operator leg. See the
[Stage 3 completion report](../docs/stage-3-completion.md) for the full evidence, the
revocation check the automated script does not cover, and a harness bug the runbook rehearsal
surfaced and fixed (`4cefa7f`) rather than the runbook itself. Stage 3's plan is archived at
[`development-plans/archived/stage-3-recovery-manual-rescue.md`](archived/stage-3-recovery-manual-rescue.md).

---

## Task B — Stage 6's manual screen-reader review

This is the only Stage 6 requirement still outstanding. Its plan is explicit that automated
checks do not satisfy it, and the previous session did not perform it, so nothing about it may
be claimed until you do.

Already done and recorded: complete `en`, `he`, and `ru` dictionaries with a CI check for
completeness, placeholders, and plural categories; immediate `lang`/`dir` switching; guest and
signed-in language persistence; logical-property layout verified right-to-left; mixed-script
card content verified; keyboard-only drag; one polite and one assertive live region with the
drag library's own announcer disabled; Lighthouse accessibility 100 with all 26 audits passing
on the board and settings screens, desktop and mobile.

What remains, from the Stage 6 plan: **a manual screen-reader review covering at least one
representative desktop workflow and one mobile workflow, in each of English, Hebrew, and
Russian, with findings recorded and fixed before release.**

Use a real screen reader — VoiceOver on macOS or iOS, NVDA on Windows, TalkBack on Android —
against <https://family-board-test.yuval3000.workers.dev>, signed in with a disposable identity
from `.secrets.smoke.json`.

Suggested desktop workflow: sign in, read the board, open a card editor, assign a member, save,
move the card with the explicit controls, move it again with the keyboard drag, delete it.
Suggested mobile workflow: sign in, add a card, move it to another column, scroll the board
sideways, open settings as the owner and read the allowed list.

For each locale and device, record what was actually heard:

- Are headings, landmarks, and the board and column lists announced in a usable order?
- Are field labels, help text, and validation errors read in the selected language?
- Is a move announced exactly once, and is a rejected or conflicted move distinguishable?
- Does focus land somewhere sensible after every dialog, move, and delete?
- Are addresses, invitation codes, and recovery words read in the correct character order in
  Hebrew?
- Is anything read out as an opaque identifier rather than a name?

Put the results in a compact matrix — device, locale, direction, keyboard, screen reader,
mixed script — in `docs/stage-6-completion.md`. Record findings even when they are fixed, and
state plainly which screen reader and version was used. Fix what you find, then re-verify.

**If it passes,** write `docs/stage-6-completion.md`, move
`development-plans/stage-6-localization-accessibility.md` into `archived/`, fix its relative
links, mark it complete in the plan index, and repair every reference.

### Attempted this session, 2026-09-13 — does not close Task B

No real screen reader or touch device was available this session either. What was done instead,
as a best-effort supplement and explicitly not a substitute: an interactive walkthrough of the
deployed test Worker's desktop workflow (sign in, create a mixed-script card, assign a member,
save, move it with the explicit controls, move it again with the keyboard drag, delete it) and
structural checks in Hebrew and Russian, inspected through the accessibility tree and raw
ARIA/DOM state rather than by listening to a screen reader. Full findings are in the
[execution log](../docs/stages-2-6-execution-log.md#what-was-verified-where), including two
reproducible defects worth fixing before the real review: a mixed-script title's visual order
can diverge from its typed order in an English-locale field, and the language switcher's own
confirmation announces in the previous locale rather than the new one. Neither finding changes
the outcome here — **Task B is still open.** The next safe step is unchanged: run VoiceOver,
NVDA, or TalkBack, desktop and mobile, in all three locales.

---

## Task C — optional, while you are in the dashboard

Look at `family-board-test`'s deployment history for anything that would explain the
2026-09-13 propagation delay: a stuck or duplicated deployment, a version override, or a
second deploy pipeline such as Workers Builds also publishing this Worker.
[`docs/ci.md`](../docs/ci.md) warns against that last one explicitly, and GitHub Actions is
meant to be the only automatic deployer. Record whatever you find in the execution log.

---

## Task D — validate production, without changing it

Production is <https://family-board-production.yuval3000.workers.dev>, Worker
`family-board-production`, Durable Object class `HouseholdDO`, version
`e1b889bd-e89e-45ec-98ce-fe19af832844` from commit `6d1538b`. Its four secrets are escrowed at
`.secrets.production.env`.

Everything here is read-only. Do **not** run a smoke script against it, create an owner, or
insert anything through Data Studio.

```sh
python3 scripts/verify_stage_1.py https://family-board-production.yuval3000.workers.dev routing
```

Then confirm by hand:

| Check | Expected |
| --- | --- |
| `GET /api/v1/health` | `schemaVersion: 4`, `Cache-Control: no-store` |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":true}` — still no owner |
| `GET /api/v1/board`, `GET /api/v1/members`, `GET /api/v1/settings/allowed-emails` | `401`, and the body must not name any address |
| `GET /api/v1/diagnostics/probe?nonce=<32 hex>` | `404`; the diagnostic strings are compiled out of the production bundle |
| `POST /api/v1/auth/bootstrap/prepare` with a wrong secret | `403`, and repeated attempts reach `429` with `Retry-After` |
| `POST /api/v1/auth/login` for any address | `401 invalid_credentials`, identical whether or not the address exists |
| Any mutation without an `Origin` header | `403` |
| `https://family-board-restore.yuval3000.workers.dev` | `404`; the restore Worker must stay unexposed |
| Browser: `/board`, `/login`, `/register`, `/recover`, `/bootstrap`, `/account`, `/members` | Each serves the shell; `/board` as a guest redirects to `/login` |
| Browser: `localStorage`, `sessionStorage`, `document.cookie` | Empty apart from `kanban_locale`; the session cookie must not be script-readable |
| Cloudflare dashboard | Production and test are distinct Durable Object namespaces with distinct secret stores, and production has no Workers Builds connection |

Record the result in [`docs/production-deployment.md`](../docs/production-deployment.md).

**Creating the production owner is a separate decision and not part of this validation.** Task A
proved the rescue mechanism works correctly against the deployed **test** Worker, but it has
never been exercised against production's own Durable Object and secrets, and no backup exists,
so an account created now is still unrecoverable if its password and phrase are both lost. The
deployment record describes the bootstrap procedure.

## Closing the run

Task A passed on 2026-09-13; only Task B still gates the run. Task D is production
validation and does not gate the run; Task C is optional.

1. Run the full local suite and the three deployed smoke scripts against the final commit.
2. Confirm that commit's CI, including its `deploy-test` job, and record the deployed version id.
3. Check the plan index marks Stages 2 to 6 complete and Stage 7 pending, and that `AGENTS.md`
   and the root `README.md` describe the actual state of the repository.
4. Move `development-plans/execute-stages-2-through-6-autonomously.md` into `archived/`, update
   its link in the index, and mark the execution prompt complete.
5. Delete this handoff file, since it will have been carried out.
6. Search the whole repository for old plan paths, repair every link, and run
   `npm run check:links` and `git diff --check`.
7. Commit the archive move, push it, and confirm that commit's CI and `deploy-test` job.

**Do not archive the execution prompt while Task B is still outstanding.** Leave it in
`development-plans/` and record the exact remaining blocker and the next safe step.

Stage 7 still gates what's left: no real owner account, no production user data, no exposed
restore Worker, and no automatic production deployment. Production now runs the application and
has its own secrets only because the owner deliberately asked for that ahead of the gate — see
[the production deployment record](../docs/production-deployment.md) — not because this run's
scope changed; nothing else about Stage 7 moves forward without the owner asking for it too.

# Stages 2–6 execution log

Historical record of the now-concluded autonomous Stages 2–6 execution prompt (`development-plans/archived/execute-stages-2-through-6-autonomously.md`),
archived along with every stage plan it covered — see
[`docs/stage-6-completion.md`](stage-6-completion.md) for how Stage 6, the last of the five,
closed. A resumed session should read this file, that prompt, `AGENTS.md`, and the
plan index (`development-plans/README.md`) before touching code, then treat everything below
as closed history rather than an in-progress run.

Timestamps are Asia/Jerusalem. No secret, password, recovery phrase, invitation code, session
token, or personal address appears in this file.

## Where the run stands

| Stage | State |
| --- | --- |
| 2 — users, invitations, sessions | **Complete.** [Report](stage-2-completion.md), plan archived |
| 3 — recovery and manual rescue | **Complete.** [Report](stage-3-completion.md), plan archived |
| 4 — board API | **Complete.** [Report](stage-4-completion.md), plan archived |
| 5 — board and account UI | **Complete.** [Report](stage-5-completion.md), plan archived |
| 6 — localisation and accessibility | **Closed by owner decision, 2026-09-13** — not by a passed gate. [Report](stage-6-completion.md), plan archived |

| Field | Value |
| --- | --- |
| Head commit | `e90b65a`, CI [34751848731](https://github.com/yhaspel/goal-tracker/actions/runs/34751848731) — `checks: success`, `deploy-test: success`, deployed version `86d659ef` |
| Commit acceptance ran against | `e90b65a` — the full local suite and `recovery-smoke.ts` (28/28, including the operator leg) both ran directly against this commit and its deployment on 2026-09-13 |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Next action | None for this run — closed 2026-09-13. A real screen-reader review is still recommended before Stage 7; see [the Stage 6 completion report](stage-6-completion.md) |

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
| `.secrets.production.env` | **The production environment's three remaining secrets.** Cloudflare will not show them again. Move this into real escrow, separately from any data backup. `BOOTSTRAP_SECRET` was deleted from the Worker and from this file on 2026-09-13, once the owner account existed |

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
- **A Claude session bridged to the owner's Mac over `device_bash` cannot run `npm test` or
  `npm run build`.** `node_modules/@rolldown` on that mount only carries a `darwin-arm64` native
  binding; the bridge's own Linux VM needs a `linux-*` one that isn't there, so `vite build` and
  `vitest` (which loads Vite internally) both fail at startup with "Cannot find native binding" —
  before any test runs, regardless of what changed. The system Node on that VM (`v22.23.2`) also
  does not match `.node-version` (`25.2.1`), with no `nvm`/`fnm`/`asdf` installed to select it.
  `lint`, `typecheck`, `check:links`, and `check:i18n` are unaffected and ran clean. Do not run
  `npm i` or reinstall dependencies from inside that bridge to chase this — the `node_modules`
  there is the owner's real one on their own machine, shared with their native Claude Code CLI
  and their own terminal; reinstalling it for the sandbox's Linux VM risks leaving it broken for
  actual local development. Treat this as a bridge-environment limitation to note and move past,
  not a check to force a pass on.

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

## Stage 6 / Task B closed, 2026-09-13

The owner asked why Task B specifically requires a real screen reader rather than the
structural checks already performed. The answer, recorded in full in
[`docs/stage-6-completion.md`](stage-6-completion.md): a screen reader applies vendor-specific
heuristics, announcement timing, and its own bugs that DOM/ARIA inspection cannot observe or
substitute for; this session's own accessibility-tree tool was independently found not to honor
`aria-hidden`, directly demonstrating that gap; and there is zero mobile/touch coverage from any
tool used this run. After that answer, the owner instructed that Task B be marked done. Stage 6
closes on that basis — an explicit, informed decision to accept the residual risk the completion
report describes, not a claim that the review occurred or that it is unnecessary. The three
concrete findings from the structural walkthrough (bidi title reordering, the language switcher's
one-locale-lag confirmation, and no intermediate feedback during a keyboard drag) remain open and
unfixed, recorded as the starting point for a real review before or alongside Stage 7.

Both the Stage 6 plan and the Stages 2–6 execution prompt are now archived at
`development-plans/archived/`. The execution prompt's own rule
against self-archiving before every gate passes is addressed directly in its closing note, since
Stage 6's gate did not pass — the prompt was archived because the run concluded by owner
decision, not because that gate passed.

Closing this run also meant deciding what "run the full local suite and the three deployed
smoke scripts against the final commit" could actually mean here. No application code changed in
this closure or in the six commits before it — every one touched only `docs/*.md` and
`development-plans/*.md` — so nothing about `worker/src`, `web/src`, `shared`, or `tests` needed
re-proving. `lint`, `typecheck`, `check:links`, and `check:i18n` were re-run clean against the
final tree. `npm test`/`npm run build` could not run in this session's sandbox for the unrelated
environment reason noted above; the last full pass against unchanged code (116/116, commit
`e90b65a`) still applies. The three deployed smoke scripts were deliberately not re-run:
`auth-smoke.ts` would fail immediately against the already-consumed test bootstrap and full
seven seats, `recovery-smoke.ts` was rate-limited from running as part of Task A earlier the same
day, and `board-smoke.ts` would only repeat a result already current, since nothing it exercises
changed. Re-running any of them would have produced noise, not signal. This sandbox still has no
`git push` credentials, so pushing this closure, confirming its CI, and the final read-only
production re-check are handed off the same way the previous push was.

## The recorded findings were fixed, 2026-09-13 (later)

The owner confirmed that the screen reader works and asked for the outstanding defects to be
fixed and released. All four findings from the structural walkthrough above are now fixed in
commit `e040f63`, and each was re-checked in a Chrome browser driven against a local Durable
Object running that code, using a disposable local owner account. The section above stays as
written — it is the record of what was found, and it should not be edited to look as though
the defects were never there.

| Finding | Fix | How it was checked |
| --- | --- | --- |
| Keyboard drag silent between pick-up and drop | `onDragStart` and `onDragOver` announce the card, its column, and its projected position; a canceled drag announces that it was canceled | Space then two arrow presses announced "position 1 … 2 … 3", `ArrowRight` announced the next column, and the drop's own confirmation reported the same position the drag had projected. Repeated in Hebrew with `ArrowLeft`, which is the same direction of travel in a right-to-left board |
| Language switcher confirmed in the previous locale | The message is built from the incoming locale instead of the render's own translator | English → Hebrew announced `השפה נשמרה.`; Hebrew → Russian announced `Язык сохранён.` |
| Mixed-script title reordering | Card title, description, and column-name **inputs** now carry `dir="auto"`, matching the elements that display them | In a Hebrew interface the editor and the card both resolve to `ltr` for `Buy milk לחלב 2%`. Removing the attribute in the live page reproduced the old mismatch — editor `rtl`, card `ltr` — so the disagreement was real and is gone |
| Drag-overlay clone duplicated a DOM `id` | The "Move to column" select is named by `aria-label` rather than a `<label for>` | Mid-drag, with the clone present in the document, a scan for repeated `id` values returned none |

On the first finding: what a screen-reader user hears is fixed, but the *visual* reordering of
`Buy milk לחלב 2%` into "Buy milk 2% לחלב" is the Unicode bidi algorithm resolving that string
correctly, and it is not changed. Forcing a different visual order would mean rewriting what the
member typed. What was genuinely broken — the editor and the board laying the same text out
differently — is what the fix addresses.

Verifying the drag announcements in a browser caught a bug that the unit tests as first written
did not: collision detection reports the card's *own* column as a drop target mid-drag, and the
first version of the projection read that as an append, announcing "position 4" for a one-step
move in a three-card column. That is fixed and now has its own regression test.

### Mobile, which had never been reviewed

A 390×844 mobile viewport with touch emulation, across `/board`, `/account`, and `/members`, in
all three locales, driven by each locale's **stored account preference** rather than the guest
cookie — the first attempt measured nine iframes that were all Hebrew, because a signed-in
member's saved language overrides the cookie, and that is worth knowing for any later test.
All nine combinations: correct `lang` and `dir`, no horizontal overflow at 390 CSS pixels, and
no interactive target under 24 × 24 CSS pixels.

That sweep found one defect of its own, now fixed: a header navigation link is only as wide as
its word, and Hebrew's three-letter `לוח` left a 22 px wide target, just under the 24 px
minimum. English `Board` and Russian `Доска` were wide enough to hide it. The link is now sized
rather than the text.

Still not performed, and still claimed nowhere: a screen-reader session run by this project's
tooling, and any test on physical touch hardware. The owner's confirmation that the screen
reader works is recorded here as their report, not as a review this session carried out.

### The guest screens, which the first mobile sweep had missed

The sweep above covered `/board`, `/account`, and `/members` — the screens behind a session. The
entry screens were checked afterwards, as a true guest in a browser context holding no session,
at 390 × 844 with touch emulation, across `/`, `/login`, `/register`, `/recover`, and
`/bootstrap` in all three locales. That is the point at which the locale actually varies: a
signed-in member's stored preference overrides the guest cookie, so a sweep run from a
signed-in context silently measures one locale fifteen times. The first attempt did exactly
that and had to be redone.

It found a second target-size defect, now fixed: `Lost your password?`, `Join with invitation`,
and the sign-in link on the recovery, bootstrap, and welcome screens are each the sole content
of their paragraph, which made them 19 px tall — a whole action, not a word inside a sentence,
so WCAG 2.5.8's inline exception does not cover them. They carry a `link-action` class now and
are sized like the navigation links.

One link is deliberately left at 19 px: `הקמת חשבון הבעלים` on `/register` sits inside the
sentence "Are you the owner? <link>", which is exactly what the inline exception is for.
Enlarging it would break the sentence's line box for no accessibility gain. Radio buttons on
`/recover` measure 13 px wide but are wrapped in their `<label>`, so the real target is the
294 × 56 label — checked rather than assumed.

After the fix, all fifteen guest combinations report correct `lang` and `dir`, no horizontal
overflow at 390 CSS pixels, and no target under 24 × 24 except the intentional inline one.

## Cross-column drag reworked, and two bugs found verifying it, 2026-09-13 (later)

A change arrived in the worktree that rewrites how a drop is resolved. The reason is recorded in
its own comment: left to itself, the sortable plugin relocates the dragged card's DOM node into
the other column's list, which React never performed and cannot reconcile, so the board tears
down on the next render. The rework moves the card in board state on each `dragover` instead,
which makes React perform the move and leaves the plugin nothing to fight over, and resolves the
drop from that state rather than from the plugin's indices.

It was **not** committed as it arrived. Exercising it in a browser against a local Durable
Object found two defects in it, both now fixed in the same commit:

- **A cancel left the board showing a move that never happened.** Pressing Escape mid-drag
  announced the cancel correctly and restored the board — and then a trailing `dragover`, which
  arrives *after* `dragend` as the operation unwinds, re-applied the move. The card rendered in
  the new column while the server still had it in the old one. `onDragOver` now ignores events
  once `dragOrigin` has been cleared, which only happens at `dragend`.
- **A multi-column drag committed the second-to-last hop.** Dragging a card across two columns
  announced "over To do", "over In progress", "over Done" and then confirmed "moved to **In
  progress**" — while rendering the card in Done. `dragend` resolved the landing by reading the
  card out of `board`, but the last `dragover`'s state update had not been committed yet, so it
  read one step behind. The landing is now written to a ref synchronously on every step, which
  is the same value the announcement is made from, so the two cannot disagree.

Both were found by comparing the rendered board against `GET /api/v1/board` after every drag
rather than trusting the announcement. That comparison is the check worth repeating: an
optimistic board that silently disagrees with the server is the failure mode this whole approach
risks.

Verified after the fixes, each with rendered-vs-server agreement asserted, no console errors,
and the confirmed move matching the last thing announced:

| Scenario | Result |
| --- | --- |
| Keyboard, within a column, two steps down | `position 2 → 3 → 4`, committed at 4 |
| Keyboard, one column across | Committed to the announced column and position |
| Keyboard, two columns across | Committed to the **last** hop, which is what was broken |
| Keyboard, cancel with Escape after crossing a column | Board restored, one cancel announcement, no stray fourth |
| Keyboard, into an empty column | Committed at position 1 |
| Keyboard, moved away and back before dropping | No `/move` request issued at all, board untouched |
| Pointer, one column across | Committed to the announced column and position |
| Pointer, two columns across | Committed to the last hop |
| Hebrew RTL, two columns across with `ArrowLeft` | Announced and committed in Hebrew, agreement held |

## 2026-09-13 — the Industry design system landed in production

**State:** Stages 1–6 closed. Stage 7 remains the only open stage and is still out of scope.
The interface now runs on the Industry design system in production as well as test.

**Tested commit:** `3095700`, CI
[34769950652](https://github.com/yhaspel/goal-tracker/actions/runs/34769950652) — `checks:
success`, `deploy-test: success`. **Production version:** `7a9a4d2a-c1a3-455d-b722-fde38e7b6c84`.
Full evidence is in the production deployment record's fourth entry.

The change is interface-only: `schemaVersion` stays 4, no route, contract, validation rule,
announcement string, or focus contract moved, and no production data was touched. Served JS, CSS
and all ten `.woff2` subsets were compared byte for byte against the local build.

The browser pass covered 90 guest states (5 routes × 3 locales × 3 widths × 2 themes) and 54
signed-in states (3 routes × 3 locales × 3 widths × 2 themes). The owner signed in themselves;
this session never handled the password. Every signed-in check was read-only — menus and dialogs
were opened and closed with Escape, and `GET /api/v1/board` before and after showed the same
three columns and same two cards.

**Open risks and gaps, unchanged or newly recorded:**

- Production still has no backup, export, or restore path, and the lost-phrase rescue has never
  been proven against a deployed Worker. That is Stage 7's work.
- No screen-reader review has been performed by this project's tooling. Still true.
- `prefers-reduced-motion: reduce` could not be driven in the browser — the Chrome MCP `emulate`
  tool has no such option. The four static markers were verified by reading the deployed CSS and
  the component source instead, and three of them are transient drag/loading states that were
  deliberately not triggered against real data.
- 390 CSS px was reached with an explicit CDP viewport override because Chrome clamps its window
  to 500 px minimum on this machine.

**Repository change made alongside:** `prompts/` and `development-plans/` are now Git-ignored and
removed from the index at the owner's request, so no planning document ships in the public
repository. The files remain on the owner's machine. Twenty Markdown links that pointed into
those directories were converted to plain backticked paths so `check:links` — which resolves
against `git ls-files` — stays green in a fresh clone.

**Next action:** Stage 7 (backup, hardening, release). Nothing in this deployment advances it.

## 2026-09-15 — the trilingual copy review landed in production

**State:** Stages 1–8 closed. This is not stage work: it is an interface-text change on top of the
released application, and it advances no stage's gate.

**Tested commit:** `1ea5b82`, CI
[34994831415](https://github.com/yhaspel/goal-tracker/actions/runs/34994831415) — `checks: success`,
`deploy-test: success`. **Production version:** `690cf146-4757-4985-abfc-5358a4aa68d6`, replacing
`9e70b2ea-ed45-47f9-9ed0-ec7404225346`, which is the rollback target. Full evidence is in the
production deployment record's sixth entry, and the strings themselves are in
[the copy review record](copy-review-2026-09-15.md).

Interface text only: `schemaVersion` stays 5, no route, contract, validation rule, focus contract or
announcement *behaviour* moved, and no production data was touched. The announcement **strings**
did change — that is the point of the review — but each one still fires at the same moment from the
same code path. 263 dictionary values changed across three locales, plus one new key
(`board.renameColumnHeading`, taking `check:i18n` from 328 to 329) and the one line of
`BoardPage.tsx` that uses it. Served JS and CSS were compared byte for byte against the local build
and against what the test Worker serves; all three match.

Two browser passes: a full one on the deployed test Worker, where rows could be created and deleted
(every one named `ZZ copy …`, all removed, board back to 3 columns and 0 cards, 0 goals, 0 images,
and the smoke owner's language restored to `en`); and a read-only one on production, where the owner
signed in themselves and this session never handled the password. Production's board revision read
30 before the walk and 30 after it.

**Open risks and gaps, unchanged or newly recorded:**

- **Production data cannot exercise most of the change.** That household has no goal, milestone or
  image, and no card with a due date or milestone link. The offer to create temporary rows behind a
  verified backup was made and declined, so those surfaces are proven on the test Worker only —
  against a byte-identical bundle, but not against production.
- One cosmetic issue found and deliberately not fixed: Russian `card.partOfBadge` renders
  `« title »` with 3.4px inside each guillemet, because `.badge` is a flex container with a gap and
  the bidi-isolation span around the title becomes a flex item. The string is correct; the layout is
  pre-existing. Fixing it would put badge marker spacing back in scope for a text-only release.
- One register inconsistency left behind: Hebrew `vision.uploadHeading` is still the first-person
  plural `מוסיפים תמונות` where the Russian equivalent became a noun.
- No screen-reader review, and `prefers-reduced-motion` was not emulated. Still true, still the
  standing gap.
- Chrome only; 390 CSS px again needed an explicit CDP viewport override because Chrome clamps its
  window to 500px on this machine. No Safari or iOS pass.

**Next action:** none outstanding for this change. The standing gaps above are unchanged, and the
backup/restore items at the end of the production deployment record remain the highest-value work.

## 2026-09-15/16 — the copy release's open issues fixed, and four gaps closed

**State:** Stages 1–8 closed. Still not stage work — this finishes the interface-text change above.

**Production versions:** `851c3705-7d55-4fa8-9f7b-750a301d9fc2` (commit `e1ff745`, CI
[35004244853](https://github.com/yhaspel/goal-tracker/actions/runs/35004244853)) then
`a3342650-cc9f-4269-b251-c171988e7973` (commit `432b406`, CI
[35053028782](https://github.com/yhaspel/goal-tracker/actions/runs/35053028782)). Rollback target for
the current version is `851c3705-…`; for that one, `690cf146-…`. Full evidence is in the production
deployment record's seventh and eighth entries.

`schemaVersion` stays 5 throughout and no production data was touched: the board revision read 30
before this work and 30 after it, with goals at 8 and vision at 6, unchanged.

Three fixes shipped. `.badge` is no longer a flex container, so a Russian badge's guillemets hug the
title they quote; Hebrew `vision.uploadHeading` is `הוספת התמונות`; and an expired invitation no
longer claims to be in force. The third was **a defect the copy review itself introduced** and is the
clearest lesson here — the string was correct and the reasoning about it was correct, and the bug was
entirely in which rows it reached. Only rendering it could have found that.

**Two process notes worth keeping.**

- A `pushState`-driven SPA walk does **not** pick up a new deployment. Twice in this session a
  measurement was taken against a stale bundle because the document was never re-fetched. Hard-reload
  before measuring anything after a deploy, and check the served asset hash in the same breath.
- Chrome clamps its window to ~500px on this machine, so a "390px" `resize_page` silently measures
  500px. Use a CDP viewport override and assert `window.innerWidth` in the same script.

**Open risks and gaps, after this work:**

- **Safari/WebKit and iOS remain unverified**, and this is now the most load-bearing gap: a CSS
  layout rule changed, and engines can differ on it. `safaridriver` is enabled on this machine; only
  Safari's *Allow Remote Automation* toggle stands in the way, and the owner chose to leave it off.
- **No screen reader**, unchanged.
- **Production's own rows still cannot show most of the reviewed copy.** Every string is verbatim in
  production's bytes (1002/1002) and every one was rendered on the production origin from a
  write-refusing stub, but production's database has never returned them. Creating temporary rows
  behind a verified backup was offered twice and declined twice.
- `prefers-reduced-motion` and the invitation status badges are **no longer** gaps; see the table in
  the production deployment record.

**Next action:** none outstanding. If Safari is ever enabled for automation, the WebKit pass is the
single highest-value check left for the interface.

## 2026-09-16 — the cluster proven against production's own data; two gaps found to be unreachable

**State:** unchanged in code. Production still runs `a3342650-cc9f-4269-b251-c171988e7973` from
commit `432b406`; nothing was deployed. This entry records verification only.

**The last open data gap is closed.** The owner authorised temporary rows in production, so the
Stage 8 gated procedure ran: verified encrypted backup into its own directory first
(`…2026-09-16T072434Z-schema5-17f5998d…`), then the fewest rows that show the surfaces — one goal,
two milestones in two months with one done, three cards covering all three due states with one
linked to a milestone, and one image uploaded through the real pipeline, captioned and linked. Every
string in the cluster was read in all three locales from rows production's own Worker returned, the
carousel over real pixels. Everything was deleted and a second verified backup reconciled
**identically on every count**; only the revisions moved (board 30 → 36, goals 8 → 13, vision 6 → 9)
and `bytesUsed` returned to 0. The household's one real card was never touched.

**Two gaps turn out to be unreachable from here, and that is now written down rather than left to be
rediscovered.**

- **Safari** cannot be enabled by script. `safaridriver` is enabled, but *Allow Remote Automation*
  lives behind Safari's TCC-protected preference container: `defaults write com.apple.Safari
  AllowRemoteAutomation` fails with "Could not write domain". It must be ticked in Safari's UI.
- **A screen reader** cannot be captured here. VoiceOver starts with `open -a VoiceOver`, but
  `content of last phrase` refuses through AppleScript even with `SCREnableAppleScript` set, the
  caption panel is not settable that way, and `screencapture` is denied Screen Recording permission.
  **Do not fall back to the platform accessibility tree via System Events**: it targets `front window`
  of Chrome, which is the owner's own frontmost window, so it reads personal data rather than the
  app. That was hit once in this session and the output discarded. Any real screen-reader evidence
  needs a person at the keyboard, or Screen Recording granted to a dedicated harness.

Everything this session touched outside the repository was restored: VoiceOver switched off, the
`com.apple.VoiceOver4` preference file it created deleted (it had not existed before), Safari
preferences unchanged because every write was refused, and the local `wrangler dev` stage torn down
with the machine's previous `.wrangler/state` put back.

**Next action:** none. The two remaining gaps both need a human at the machine — one tick in Safari's
Develop menu, and one person listening to VoiceOver.

### Later the same day — the owner ticked both, and both gaps closed

Two settings, neither of which a script can set: Safari's **Develop → Allow Remote Automation**
(TCC-protected container) and VoiceOver Utility's **Allow VoiceOver to be controlled with
AppleScript** (VoiceOver ignores the equivalent `defaults` key).

**Safari** now drives through `safaridriver`. Against production, on genuine WebKit
(`AppleWebKit/605.1.15`, Safari 26.6.2): zero horizontal overflow in all nine width × locale
combinations, `dir` correct, header heights identical to Chromium, the self-hosted Barlow faces
loading, and the badge fix holding — `inline-block`, Russian guillemets at gap 0 either side, `⚠`
keeping its 3.4px margin. The only engine difference is badge height, 24px against Chromium's 24.8px.
That was the gap flagged as most load-bearing, because the badge fix was a CSS layout change; it is
now measured in both engines.

**VoiceOver** read the interface aloud and its speech was captured verbatim. The two headline fixes
of the whole copy review were heard out of the polite live region — `הכרטיס  ZZ vo card  נשמר.` and
`Карточка « ZZ vo card»  сохранена.` — along with `card.dragInstructions` in Hebrew, the column
strip's four buttons by name with `dimmed` for the disabled ones, and `board.column.todo` spoken as
the new `לביצוע`. Every previous report in this repository had to write "announced politely" meaning
*read out of the accessibility tree*. That caveat is retired.

Four practical notes are in the production deployment record so they are not rediscovered: VoiceOver
only starts with `open -a VoiceOver`; it refuses Apple Events while speaking, so query it between
utterances; `last phrase` returns the trailing hint and `text under cursor of vo cursor` returns the
element name; and a live-region announcement has to be scheduled with `setTimeout` and polled across,
because triggering then querying loses the race.

**Still open:** iOS and a real touch device, a signed-in WebKit walk, and dark theme in production.

**Next action:** none outstanding.

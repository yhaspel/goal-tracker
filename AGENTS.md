# Project guide for agents

## Purpose and current state

Build a private Kanban board for one household or working group, with one shared board and at most seven active users including the owner. The owner is the only admin and manages an allowed-email list; joining also requires an invitation. The planned release uses email/password accounts, one-time recovery phrases, manual lost-phrase rescue, English/Hebrew/Russian UI, and accessible drag-and-drop with explicit move controls. It sends no email and does not include goals, private boards, attachments, notifications, or AI features. The [master plan](development-plans/personal-business-goals-dashboard-master-plan.md) is the product and architecture source of truth.

Stages 1 through 5 are complete; Stage 3 closed on 2026-09-13 (see its [completion report](docs/stage-3-completion.md)). Stage 6 is implemented, tested, and verified locally, but is one check short of its exit gate — a manual screen-reader review; see [`development-plans/handoff-remaining-checks.md`](development-plans/handoff-remaining-checks.md).

The repository contains the whole first-release application apart from Stage 7: the React interface for every account and board workflow, the account API, credential rotation and the operator rescue runbook, the board API, and English, Hebrew, and Russian dictionaries. Schema migrations run through version 4. On 2026-09-13 the owner deployed this code to **production** as well, ahead of the planned Stage 7 gate; production has its own secrets and Durable Object namespace. The owner bootstrapped a real owner account there the same day, confirmed directly — production is **no longer empty**, and that account is unrecoverable if its password and recovery phrase are both lost, since production has no backup, export, or restore path, and the lost-phrase rescue has never been proven against a deployed Worker. Treat production as holding real data now, not a hypothetical, until Stage 7 closes. Read [the production deployment record](docs/production-deployment.md) before touching production, and the [Stage 1 feasibility report](docs/stage-1-feasibility.md) plus the [Stage 2](docs/stage-2-completion.md), [Stage 4](docs/stage-4-completion.md), and [Stage 5](docs/stage-5-completion.md) completion reports before changing authentication, the board, or the interface.

Stage 2 measured the deployed Free runtime and found that native scrypt blocks the Durable Object for the duration of each derivation, so the runtime serialises work on the object before the bounded key-derivation queue can accumulate waiters. That queue stays as a memory safeguard, and its exact capacity is proven by the Workers-runtime test, but the persistent per-email and per-IP rate limits are what actually bound attacker-driven derivation work. A burst of credential operations also delays every other request to the same household. Internal CPU duration and peak memory remain unquantified because a deployed Worker freezes its timers between I/O. Keep contention and usage checks in later stages.

## Plans and traceability

- Start at the [development-plan index](development-plans/README.md). Implement the numbered stages in order. Stage 3 closed on 2026-09-13; see its [completion report](docs/stage-3-completion.md). The remaining open work is the one check in [`handoff-remaining-checks.md`](development-plans/handoff-remaining-checks.md), which closes [Stage 6](development-plans/stage-6-localization-accessibility.md); each plan's own scope, contracts, acceptance tests, and exit gate control that work. Stage 7 stays out of scope until it closes.
- The [autonomous Stages 2–6 execution prompt](development-plans/execute-stages-2-through-6-autonomously.md) is the active handoff for that bounded run. Read it in full before implementation and again after a session restart or context compaction. It authorizes test-environment implementation and verification only; Stage 7 production initialization is outside its scope. The prompt archives itself only after every Stage 2–6 deployed exit gate passes; then update this link and the current-state text here.
- Completed stage plans live in [`development-plans/archived/`](development-plans/archived/). The [archived Stage 1 plan](development-plans/archived/stage-1-hosting-security-feasibility.md) remains available for decisions and acceptance criteria. When completing a later stage, move its plan into `archived/`, update the index and all references, and fix relative links within the moved plan.
- Record deployed evidence, limitations, and go/no-go decisions in `docs/`. Keep the stage plan and index statuses consistent with the evidence. Do not treat a local test as proof of behavior that a plan requires in the deployed Free runtime.
- The saved text in [`prompts/goal-settings-prompt.md`](prompts/goal-settings-prompt.md) is historical reference material, not a feature or integration requirement.

## Agent execution and handoff

`CLAUDE.md` imports this file so Claude Code loads the same project instructions as agents that read `AGENTS.md` directly. The execution prompt supplies the specific authorization and sequence for Stages 2–6; these standing rules do not authorize Stage 7 or production data changes. Claude CLI tool permissions and account authentication are separate from repository instructions. If a required live check cannot run, document the exact blocker and leave its stage and execution prompt unarchived.

Before editing, inspect the worktree and preserve unrelated changes. Use `development-plans/README.md` to find current plan paths; completed plans move. Follow the active stage's contracts and exit gate, reconcile any conflict with the master and dependent plans before implementing it, and keep API/schema changes synchronized across stages. Maintain `docs/stages-2-6-execution-log.md` during the handoff so a resumed session can identify the current stage, tested commit, deployed evidence, open risks, and next action without relying on chat history. Do not put credentials or personal data in the log.

For each stage, run the relevant local checks, commit candidate code, verify CI and the exact version deployed to the isolated test Worker, then run that stage's live acceptance checks. A passing local suite, CI `checks` job, or routing/health smoke alone does not satisfy a later stage's deployed gate. After the gate passes, record `docs/stage-N-completion.md` evidence, update the index and project-state documentation, archive the completed plan, and repair links. Keep a compatible rollback path that preserves allowed-email enforcement and any committed SQL migrations. Do not claim browser, accessibility, or screen-reader checks that were not performed.

## Repository map and local checks

| Path | Role |
| --- | --- |
| `README.md` | Project overview, local setup, commands, and deployment entry points |
| `CLAUDE.md` | Imports this guide into Claude Code's project context |
| `web/` | React/TypeScript/Vite application and generated Static Assets (`web/dist/`) |
| `web/src/api/` | Typed same-origin client and the one place `/api/v1` URLs are written down |
| `web/src/auth/`, `web/src/members/`, `web/src/board/` | Account, owner-settings, and board screens |
| `web/src/i18n/` | Typed translation keys, the `en`/`he`/`ru` dictionaries, and the locale mechanism |
| `scripts/check-i18n.ts` | Release check for dictionary completeness, placeholders, and plural categories |
| `worker/src/index.ts` | API-first routing, explicit API and SPA route allowlists, body and content-type bounds |
| `worker/src/household-do.ts` | Durable Object request dispatch, SQLite migration startup, and test-only diagnostics |
| `worker/src/http.ts` | Shared body parsing, exact same-origin check, and typed error mapping |
| `worker/src/db/migrations.ts` | Ordered `schema_migrations` SQL versions |
| `worker/src/db/account-repository.ts` | Typed synchronous SQL for accounts, seats, sessions, invitations, and the allowed list |
| `worker/src/auth/` | Passwords, phrases, sessions, CSRF, rate limits, authorization, and the bounded KDF queue |
| `worker/src/auth/wordlist.ts`, `common-passwords.ts` | Generated pinned lists with source, licence, and digest; verified by tests |
| `worker/src/routes/` | `/api/v1` handlers for auth, allowed emails, invitations, and members |
| `worker/src/security-log.ts` | The only sanctioned sink for coarse security events |
| `shared/api.ts` | Typed JSON success/error envelopes and canonical API response types |
| `tests/` | Cloudflare Workers runtime tests |
| `scripts/auth-smoke.ts` | Deployed account flow smoke test using disposable identities |
| `scripts/recovery-smoke.ts` | Deployed credential-rotation smoke test for the three recovery flows |
| `scripts/board-smoke.ts` | Deployed board smoke test: create, move, stale conflict, and membership cleanup |
| `worker/src/board/` | Board SQL access, ordering rules, validation, and the revision guard |
| `scripts/create-operator-reset-token.ts` | Trusted local generator for a lost-phrase rescue token and its SQL |
| `scripts/verify_stage_1.py` | Deployed routing, schema-version, and Stage 1 diagnostic checks |
| `docs/operator-lost-phrase-reset.md` | The Data Studio rescue runbook for a lost recovery phrase |
| `wrangler.jsonc` | Pinned Worker compatibility date and isolated Cloudflare environments |
| `docs/deployment.md` | Clean deployment, verification, and secret-cleanup procedure |
| `skills/deploy-to-cloudflare-workers/` | Portable Agent Skills guide for deploying other apps to Cloudflare Workers; use this project's runbooks for this app's exact release gates |
| `docs/stages-2-6-execution-log.md` | Running record for the active Stages 2–6 handoff |
| `.github/workflows/ci.yml`, `docs/ci.md` | GitHub checks and the gated test-deployment setup |

Use Node 25.2.1 and npm 11.12.1 (`.node-version` and `packageManager`). Dependencies and Wrangler are exact-pinned in `package-lock.json`. From the repository root, run `npm ci`, `npm run lint`, `npm run typecheck`, `npm run check:links`, `npm run check:i18n`, `npm test` (which builds the web app), and `npm run build` for changes that affect the app. `check:links` and `check:i18n` also run in CI, so a stage plan that moves to `archived/` fails the build until every reference is repaired, and a visible string added without Hebrew and Russian fails it too. Add focused Workers-runtime tests for changed routing, SQL, authentication, or KDF behavior; run the relevant deployed-test smoke checks required by the active stage plan.

Revise the root [`README.md`](README.md) whenever a change affects how someone installs, configures, runs, builds, tests, or deploys the project. Keep its prerequisites, commands, environment descriptions, and links accurate in the same change.

The GitHub Actions workflow runs checks on pushes and pull requests. After a passing default-branch push, it deploys the test Worker and runs a live smoke check; see [`docs/ci.md`](docs/ci.md) for its configuration and token rotation date. Do not assume a push has deployed anything unless the deploy job succeeded. Production deployment remains outside this automatic pipeline until Stage 7.

## Cloudflare and security boundaries

The app uses one Cloudflare Worker with Static Assets and one SQLite-backed Durable Object per environment. `production`, `test`, and `restore` have distinct Worker names, DO class namespaces, and secret stores. `restore` has no public route. The front Worker routes `/api` first, allows only explicit SPA paths, and gets the DO using the server-fixed name `household`; never derive an object name from a request. The DO owns SQL and all future authorization decisions. Use explicit, idempotent schema migrations and supported synchronous SQL transactions; do not perform async hashing inside a transaction or reset a production namespace to undo a migration.

The test Worker is `https://family-board-test.yuval3000.workers.dev` and production is `https://family-board-production.yuval3000.workers.dev`. Both now run the application; each has its own Worker name, Durable Object class namespace, and secret store, and they share no secret. The disposable test diagnostic secret was deleted after the Stage 1 feasibility checks, so those routes return 404 in test and are compiled out of the production bundle entirely; follow `docs/deployment.md` to provision a new test-only secret if those checks must be repeated. Production is published only by hand with `npm run deploy:prod`; CI never deploys it.

Stage 2 provisioned four disposable **test** secrets — `BOOTSTRAP_SECRET`, `RECOVERY_DIGEST_KEY`, `CSRF_SECRET`, and `RATE_LIMIT_KEY` — and the account routes fail closed with `503 unavailable` when any of the last three is missing. The test household now holds a disposable owner and six members; its seven seats are full, so re-running the full bootstrap flow needs a reset disposable namespace. Local development needs the same four values in a Git-ignored `.dev.vars`; see the root `README.md`.

Production has its own separate values, provisioned and escrowed on 2026-09-13. Its `BOOTSTRAP_SECRET` was deleted once the owner account existed, so owner creation there is closed both by database state and by the absence of a secret; the other three remain configured. See [the production deployment record](docs/production-deployment.md).

Keep secrets, passwords, recovery phrases, invitation codes, and session tokens out of source, logs, URLs, build output, and test snapshots. Use disposable identities in test. The owner already activated production ahead of Stage 7; do not assume that environment is disposable or that backup and restore are available. Read `docs/production-deployment.md` before further production work.

Preserve the benchmarked native `node:crypto` scrypt work factor (`N=16384,r=8,p=5`, fresh salt at least 16 bytes, 32-byte key) and the bounded KDF queue. Rebenchmark on the deployed Free test DO if the implementation or relevant runtime changes; do not lower the work factor to make a test pass. Preserve the shared JSON envelope, safe errors, method/size checks, and API-versus-asset routing as later stages add routes. Recheck Cloudflare Free terms before relying on quotas for a new stage or release.

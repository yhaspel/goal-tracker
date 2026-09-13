# Project guide for agents

## Purpose and current state

Build a private Kanban board for one household or working group, with one shared board and at most seven active users including the owner. The planned release uses invitation-only email/password accounts, one-time recovery phrases, manual lost-phrase rescue, English/Hebrew/Russian UI, and accessible drag-and-drop with explicit move controls. It sends no email and does not include goals, private boards, attachments, notifications, or AI features. The [master plan](development-plans/personal-business-goals-dashboard-master-plan.md) is the product and architecture source of truth.

Stage 1 is complete. The repository currently contains only the React shell, API/SQLite foundation, migrations, and diagnostic test code. There are **no account or board features and no real production users or data**. Read the [Stage 1 feasibility report](docs/stage-1-feasibility.md) before implementing authentication: its Cloudflare Free deployment and native scrypt gate passed. The exact ninth queue operation was tested in the Workers runtime but not observed as a live HTTP 503; CPU duration and peak memory were not measurable in the initial dashboard sample. Retain contention and usage checks in later stages.

## Plans and traceability

- Start at the [development-plan index](development-plans/README.md). Implement the numbered stages in order. Stage 2, [users, invitations, and sessions](development-plans/stage-2-users-invitations-sessions.md), is next; its own scope, contracts, acceptance tests, and exit gate control that work.
- Completed stage plans live in [`development-plans/archived/`](development-plans/archived/). The [archived Stage 1 plan](development-plans/archived/stage-1-hosting-security-feasibility.md) remains available for decisions and acceptance criteria. When completing a later stage, move its plan into `archived/`, update the index and all references, and fix relative links within the moved plan.
- Record deployed evidence, limitations, and go/no-go decisions in `docs/`. Keep the stage plan and index statuses consistent with the evidence. Do not treat a local test as proof of behavior that a plan requires in the deployed Free runtime.
- The saved text in [`prompts/goal-settings-prompt.md`](prompts/goal-settings-prompt.md) is historical reference material, not a feature or integration requirement.

## Repository map and local checks

| Path | Role |
| --- | --- |
| `web/` | React/TypeScript/Vite shell and generated Static Assets (`web/dist/`) |
| `worker/src/index.ts` | API-first routing, bounded request forwarding, and explicit SPA route allowlist |
| `worker/src/household-do.ts` | Durable Object API, SQLite migration startup, and test-only diagnostics |
| `worker/src/db/migrations.ts` | Ordered `schema_migrations` SQL versions |
| `worker/src/auth/kdf-queue.ts` | Native scrypt parameters and one-active/seven-waiting queue |
| `shared/api.ts` | Typed JSON success/error envelopes |
| `tests/` | Cloudflare Workers runtime tests |
| `wrangler.jsonc` | Pinned Worker compatibility date and isolated Cloudflare environments |
| `docs/deployment.md` | Clean deployment, verification, and secret-cleanup procedure |
| `.github/workflows/ci.yml`, `docs/ci.md` | GitHub checks and the gated test-deployment setup |

Use Node 25.2.1 and npm 11.12.1 (`.node-version` and `packageManager`). Dependencies and Wrangler are exact-pinned in `package-lock.json`. From the repository root, run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (which builds the web shell), and `npm run build` for changes that affect the app. Add focused Workers-runtime tests for changed routing, SQL, authentication, or KDF behavior; run the relevant deployed-test smoke checks required by the active stage plan.

The GitHub Actions workflow runs checks on pushes and pull requests. Its test deployment is disabled until GitHub Actions secrets and the enable variable are configured after the first push; see [`docs/ci.md`](docs/ci.md). Do not assume a push has deployed anything unless the deploy job succeeded. Production deployment remains outside this automatic pipeline until Stage 7.

## Cloudflare and security boundaries

The app uses one Cloudflare Worker with Static Assets and one SQLite-backed Durable Object per environment. `production`, `test`, and `restore` have distinct Worker names, DO class namespaces, and secret stores. `restore` has no public route. The front Worker routes `/api` first, allows only explicit SPA paths, and gets the DO using the server-fixed name `household`; never derive an object name from a request. The DO owns SQL and all future authorization decisions. Use explicit, idempotent schema migrations and supported synchronous SQL transactions; do not perform async hashing inside a transaction or reset a production namespace to undo a migration.

Stage 1 deployed a test Worker at `https://family-board-test.yuval3000.workers.dev` and an empty production shell at `https://family-board-production.yuval3000.workers.dev`. The disposable test diagnostic secret was deleted after feasibility checks. Follow `docs/deployment.md` to provision a new test-only secret if those checks must be repeated. Keep secrets, passwords, recovery phrases, invitation codes, and session tokens out of source, logs, URLs, build output, and test snapshots. Use disposable identities in test. Production owner activation and production-secret escrow wait until Stage 7's backup and restore procedures are proven.

Preserve the benchmarked native `node:crypto` scrypt work factor (`N=16384,r=8,p=5`, fresh salt at least 16 bytes, 32-byte key) and the bounded KDF queue. Rebenchmark on the deployed Free test DO if the implementation or relevant runtime changes; do not lower the work factor to make a test pass. Preserve the shared JSON envelope, safe errors, method/size checks, and API-versus-asset routing as later stages add routes. Recheck Cloudflare Free terms before relying on quotas for a new stage or release.

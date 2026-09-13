# Family board

A private, shared Kanban board for one household or small working group, planned for up to seven active users including the owner. The owner will manage an allowed-email list; joining will also require an invitation. The intended release has recovery phrases and an English, Hebrew, and Russian interface. The [master plan](development-plans/personal-business-goals-dashboard-master-plan.md) defines the product scope and architecture.

**Current status:** Stage 1 is complete. This repository runs a React placeholder shell and a Cloudflare Worker with an API, a SQLite-backed Durable Object, migrations, and test-only diagnostics. Accounts, invitations, and board features are not implemented yet. The [development-plan index](development-plans/README.md) tracks the stages; [Stage 2](development-plans/stage-2-users-invitations-sessions.md) is next. The [Stage 1 feasibility report](docs/stage-1-feasibility.md) records the hosting and security gate.

## Local setup

Install Git, Node.js **25.2.1**, and npm **11.12.1**. The Node version is pinned in [`.node-version`](.node-version), and npm is pinned in [`package.json`](package.json). If your Node version manager reads `.node-version`, use it to select Node 25.2.1. Install the pinned npm version if needed:

```sh
npm install --global npm@11.12.1
node --version
npm --version
```

Clone and run from the repository root:

```sh
git clone https://github.com/yhaspel/goal-tracker.git
cd goal-tracker
npm ci
npm run dev
```

Wrangler prints the local address, normally [http://localhost:8787](http://localhost:8787). The app currently displays a placeholder page. To check that the API and local Durable Object are working, open [http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health) or run:

```sh
curl --fail http://localhost:8787/api/v1/health
```

The response should contain `"status":"ok"`. `npm run dev` builds the web assets and starts Wrangler in the isolated `test` environment with local Durable Object storage. Local development and tests do not require a Cloudflare login or deployment credentials. Stop the server with Ctrl-C.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build the web shell and start the local Worker |
| `npm run build` | Build static web assets into `web/dist/` |
| `npm run lint` | Lint Worker, web, shared code, and tests |
| `npm run typecheck` | Type-check TypeScript |
| `npm test` | Build the web shell and run tests in the Cloudflare Workers runtime |

Run `npm run lint`, `npm run typecheck`, and `npm test` before submitting application changes. Dependencies are locked in `package-lock.json`; use `npm ci` for a clean install. `web/dist/` and local Wrangler state are generated and ignored by Git.

## Architecture and environments

The app is a Vite/React frontend (`web/`) served as Static Assets by one Cloudflare Worker (`worker/`). The Worker handles `/api` routes before assets. A single SQLite-backed Durable Object owns household data and migrations; shared API types live in `shared/`, and Workers-runtime tests live in `tests/`. [`wrangler.jsonc`](wrangler.jsonc) defines separate `test`, `production`, and `restore` Workers and Durable Object namespaces. The restore Worker has no public route.

The deployed [test shell](https://family-board-test.yuval3000.workers.dev) is used for stage work. The [production shell](https://family-board-production.yuval3000.workers.dev) has no accounts or real user data. Test-only diagnostic endpoints require a disposable secret and are currently disabled in the deployed test Worker. Do not put secrets, passwords, recovery phrases, or session tokens in source, logs, URLs, or snapshots.

## Host your own copy on Cloudflare

This repository uses **Cloudflare Workers**, Static Assets, and SQLite-backed Durable Objects. The URLs elsewhere in this repository belong to the original deployment. A new Cloudflare account gets its own Worker, storage namespaces, and `workers.dev` hostname; cloning the code does not copy any deployed data or credentials.

1. [Create a Cloudflare account](https://developers.cloudflare.com/workers/get-started/guide/) and enable its [`workers.dev` subdomain](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/). A custom domain is not required. Check the current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Objects Free-plan terms](https://developers.cloudflare.com/durable-objects/platform/pricing/) for your account before relying on this deployment.
2. Follow **Local setup** above in your clone or extracted download. In [`wrangler.jsonc`](wrangler.jsonc), replace the three environment `name` values (`family-board-test`, `family-board-production`, and `family-board-restore`) with distinct names for your account. Keep the `HOUSEHOLD` bindings, their matching Durable Object class names and `exports`, and the `test`/`production`/`restore` environment separation intact. Choose names before storing data; a later Worker or class rename is not a data migration. Keep `restore.workers_dev` set to `false`.
3. From the repository root, authenticate Wrangler with **your** Cloudflare account, confirm it appears in `whoami`, and deploy the test environment. If you belong to more than one account, select your own when Wrangler prompts. Wrangler is already installed by `npm ci`:

   ```sh
   npx wrangler login
   npx wrangler whoami
   npm run lint
   npm run typecheck
   npm test
   npx wrangler deploy --env test --dry-run --outdir /tmp/family-board-test-dry-run
   npm run deploy:test
   ```

   Check that the dry run binds `HOUSEHOLD` to `TestHouseholdDO` and includes `ASSETS`. Wrangler reports your test URL, in the form `https://<your-test-worker>.<your-subdomain>.workers.dev`. Substitute your actual URL in the routing check below; it uses Python 3's standard library:

   ```sh
   python3 scripts/verify_stage_1.py https://your-test-worker.your-subdomain.workers.dev routing
   ```

4. The [Stage 1 feasibility result](docs/stage-1-feasibility.md) applies to the original Cloudflare account. If you intend to follow this project's release plan, repeat the account-specific test gate using the [deployment runbook](docs/deployment.md). After that gate passes, `npm run deploy:prod` publishes the **current placeholder shell** under your separate production Worker; `npm run deploy:restore` creates the private restore Worker without a public route. Run the routing check against your production URL as well. Do not create real accounts or production data before the Stage 7 backup and restore gate.
5. If you fork the repository and want GitHub Actions to deploy your test Worker, change the original test URL in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) to **your** URL. Create a Cloudflare API token scoped to your account for Worker deployment, then add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets and set `CLOUDFLARE_TEST_DEPLOY_ENABLED=true` as a repository variable. Follow [Cloudflare's GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and [account ID guide](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/). Enable this only after the manual test deploy and URL check succeed. The workflow deploys test after passing checks on the default branch; it never deploys production. Use this GitHub Actions pipeline as the only automatic deployer for that Worker.

For repeatable manual deployment, diagnostic-secret handling, and cleanup, use [docs/deployment.md](docs/deployment.md). Its example hostnames are from the original account; replace them with your own. Keep API tokens and diagnostic secrets out of Git and use only disposable test identities.

## CI and deployment

[GitHub Actions](.github/workflows/ci.yml) runs locked installation, lint, type checks, Workers-runtime tests, dependency audit, and a production bundle dry run on pushes and pull requests. After checks pass on a default-branch push, its `deploy-test` job deploys the **test** Worker and checks live routing. Pull requests do not deploy. A passing checks job alone does not mean a deployment succeeded; verify the `deploy-test` job. **Production is not deployed automatically** and remains at the Stage 1 shell until the Stage 7 release gate.

See [CI configuration and credential maintenance](docs/ci.md) for the GitHub/Cloudflare setup and [the manual deployment runbook](docs/deployment.md) for reproducible deployment, verification, and diagnostic-secret cleanup. Cloudflare credentials are needed for manual remote deployments, not for local setup.

## Working on the project

Read the [development-plan index](development-plans/README.md) and the active stage plan before implementing features. Completed plans are retained in [`development-plans/archived/`](development-plans/archived/) for traceability. Stage decisions and deployed evidence live in `docs/`. Contributors and coding agents should also read [AGENTS.md](AGENTS.md), which records repository conventions, security boundaries, and required checks. Keep this README current when installation, run, build, or deployment behavior changes.

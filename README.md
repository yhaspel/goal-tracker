# Family board

A private, shared Kanban board for one household or small working group, planned for up to seven active users including the owner. The owner will manage an allowed-email list; joining will also require an invitation. The intended release has recovery phrases and an English, Hebrew, and Russian interface. The [master plan](development-plans/personal-business-goals-dashboard-master-plan.md) defines the product scope and architecture.

**Current status:** Stages 1 and 2 are complete. The Cloudflare Worker now serves the account API — owner bootstrap, the owner-managed allowed-email list, invitations, phrase-backed registration, sessions, and member deactivation — backed by a SQLite-backed Durable Object. The web page is still a placeholder: the interface for all of this arrives in Stage 5, and board features in Stage 4. The [development-plan index](development-plans/README.md) tracks the stages; [Stage 3](development-plans/stage-3-recovery-manual-rescue.md) is next. The [Stage 1 feasibility report](docs/stage-1-feasibility.md) records the hosting and security gate, and the [Stage 2 completion report](docs/stage-2-completion.md) records the deployed account evidence.

## Local setup

Install Git, Node.js **25.2.1**, and npm **11.12.1**. The Node version is pinned in [`.node-version`](.node-version), and npm is pinned in [`package.json`](package.json). If your Node version manager reads `.node-version`, use it to select Node 25.2.1. Install the pinned npm version if needed:

```sh
npm install --global npm@11.12.1
node --version
npm --version
```

Clone and install from the repository root:

```sh
git clone https://github.com/yhaspel/goal-tracker.git
cd goal-tracker
npm ci
```

The account API needs four local secrets. Create a throwaway `.dev.vars` file, which Git
ignores and Wrangler loads automatically for `npm run dev`:

```sh
umask 077
{
  echo "BOOTSTRAP_SECRET=$(openssl rand -hex 32)"
  echo "RECOVERY_DIGEST_KEY=$(openssl rand -hex 32)"
  echo "CSRF_SECRET=$(openssl rand -hex 32)"
  echo "RATE_LIMIT_KEY=$(openssl rand -hex 32)"
} > .dev.vars
```

`BOOTSTRAP_SECRET` opens one-time owner creation. `RECOVERY_DIGEST_KEY` keys recovery-phrase
digests, `CSRF_SECRET` signs the session-bound CSRF value, and `RATE_LIMIT_KEY` pseudonymises
rate-limit buckets. Without them the account routes answer `503 unavailable` rather than
falling back to a weaker derivation. Use values like these only locally; deployed
environments get their own separate Cloudflare secrets. `npm test` generates its own
disposable values and needs no `.dev.vars`.

```sh
npm run dev
```

Wrangler prints the local address, normally [http://localhost:8787](http://localhost:8787). The app currently displays a placeholder page while the Stage 5 interface is built; the account API is live. To check that the API and local Durable Object are working, open [http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health) or run:

```sh
curl --fail http://localhost:8787/api/v1/health
```

The response should contain `"status":"ok"`. `npm run dev` builds the web assets and starts Wrangler in the isolated `test` environment with local Durable Object storage. Local development and tests do not require a Cloudflare login or deployment credentials. Stop the server with Ctrl-C.

To exercise the whole account flow against that local server, pipe the same bootstrap secret
into the smoke script. It creates a disposable owner and six members, so run it against a
fresh local Durable Object (`rm -rf .wrangler/state`) and never against production:

```sh
grep '^BOOTSTRAP_SECRET=' .dev.vars | cut -d= -f2 | node scripts/auth-smoke.ts http://127.0.0.1:8787
```

The script writes the disposable identities it created to `.secrets.smoke.json` (mode 0600,
ignored by Git) so a later run can sign in again once bootstrap has been consumed.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build the web shell and start the local Worker |
| `npm run build` | Build static web assets into `web/dist/` |
| `npm run lint` | Lint Worker, web, shared, test, and script code |
| `npm run typecheck` | Type-check TypeScript |
| `npm run check:links` | Verify every relative Markdown link in the repository resolves |
| `npm test` | Build the web shell and run tests in the Cloudflare Workers runtime |

Run `npm run lint`, `npm run typecheck`, and `npm test` before submitting application changes, and `npm run check:links` when you move or rename a document. Dependencies are locked in `package-lock.json`; use `npm ci` for a clean install. `web/dist/` and local Wrangler state are generated and ignored by Git.

## Architecture and environments

The app is a Vite/React frontend (`web/`) served as Static Assets by one Cloudflare Worker (`worker/`). The Worker handles `/api` routes before assets. A single SQLite-backed Durable Object owns household data and migrations; shared API types live in `shared/`, and Workers-runtime tests live in `tests/`. [`wrangler.jsonc`](wrangler.jsonc) defines separate `test`, `production`, and `restore` Workers and Durable Object namespaces. The restore Worker has no public route.

The deployed [test Worker](https://family-board-test.yuval3000.workers.dev) is used for stage work and holds only disposable accounts. The [production shell](https://family-board-production.yuval3000.workers.dev) has no accounts or real user data and stays on the Stage 1 placeholder until the Stage 7 release gate. Test-only diagnostic endpoints require a disposable secret and are currently disabled in the deployed test Worker.

Each deployed environment keeps its own secrets. `BOOTSTRAP_SECRET` opens one-time owner creation, and `RECOVERY_DIGEST_KEY`, `CSRF_SECRET`, and `RATE_LIMIT_KEY` are required for the account routes to work at all — without them those routes answer `503 unavailable` rather than weakening a derivation. Do not put secrets, passwords, recovery phrases, invitation codes, or session tokens in source, logs, URLs, or snapshots.

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

   Check that the dry run binds `HOUSEHOLD` to `TestHouseholdDO` and includes `ASSETS`. Wrangler reports your test URL, in the form `https://<your-test-worker>.<your-subdomain>.workers.dev`. Substitute your actual URL in the routing check below; it uses Python 3's standard library and waits until the deployed Worker reports this checkout's schema version:

   ```sh
   python3 scripts/verify_stage_1.py https://your-test-worker.your-subdomain.workers.dev routing
   ```

   The account routes need their own secrets in each deployed environment. Generate fresh
   values per environment, pipe them in so they never reach a command line, and keep them out
   of Git:

   ```sh
   umask 077
   for name in BOOTSTRAP_SECRET RECOVERY_DIGEST_KEY CSRF_SECRET RATE_LIMIT_KEY; do
     openssl rand -hex 32 > .secrets.tmp
     npx wrangler secret put "$name" --env test < .secrets.tmp
   done
   rm -f .secrets.tmp
   ```

   Then exercise the whole account flow against your deployed test Worker, keeping the
   bootstrap value in a file so it stays off the command line. The flow creates a disposable
   owner and six members, so run it once against a fresh namespace:

   ```sh
   node scripts/auth-smoke.ts https://your-test-worker.your-subdomain.workers.dev < your-bootstrap-secret-file
   ```

4. The [Stage 1 feasibility result](docs/stage-1-feasibility.md) applies to the original Cloudflare account. If you intend to follow this project's release plan, repeat the account-specific test gate using the [deployment runbook](docs/deployment.md). After that gate passes, `npm run deploy:prod` publishes the **current placeholder shell** under your separate production Worker; `npm run deploy:restore` creates the private restore Worker without a public route. Run the routing check against your production URL as well. Do not create real accounts or production data before the Stage 7 backup and restore gate.
5. If you fork the repository and want GitHub Actions to deploy your test Worker, change the original test URL in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) to **your** URL. Create a Cloudflare API token scoped to your account for Worker deployment, then add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets and set `CLOUDFLARE_TEST_DEPLOY_ENABLED=true` as a repository variable. Follow [Cloudflare's GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and [account ID guide](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/). Enable this only after the manual test deploy and URL check succeed. The workflow deploys test after passing checks on the default branch; it never deploys production. Use this GitHub Actions pipeline as the only automatic deployer for that Worker.

For repeatable manual deployment, diagnostic-secret handling, and cleanup, use [docs/deployment.md](docs/deployment.md). Its example hostnames are from the original account; replace them with your own. Keep API tokens and diagnostic secrets out of Git and use only disposable test identities.

## CI and deployment

[GitHub Actions](.github/workflows/ci.yml) runs locked installation, lint, type checks, a Markdown link check, Workers-runtime tests, dependency audit, and a production bundle dry run on pushes and pull requests. After checks pass on a default-branch push, its `deploy-test` job deploys the **test** Worker and checks live routing. Pull requests do not deploy. A passing checks job alone does not mean a deployment succeeded; verify the `deploy-test` job. **Production is not deployed automatically** and remains at the Stage 1 shell until the Stage 7 release gate.

See [CI configuration and credential maintenance](docs/ci.md) for the GitHub/Cloudflare setup and [the manual deployment runbook](docs/deployment.md) for reproducible deployment, verification, and diagnostic-secret cleanup. Cloudflare credentials are needed for manual remote deployments, not for local setup.

## Operator procedures

If someone loses both their password and their recovery phrase, there is no email reset and no
self-service path. The owner verifies them offline and an operator with Cloudflare access
issues a one-time, 15-minute rescue token through Durable Object Data Studio. Follow
[the lost-phrase runbook](docs/operator-lost-phrase-reset.md); it uses
[`scripts/create-operator-reset-token.ts`](scripts/create-operator-reset-token.ts), which reads
the environment's recovery digest key from stdin and prints the SQL to run. The token itself is
shown once and never stored.

## Working on the project

Read the [development-plan index](development-plans/README.md) and the active stage plan before implementing features. Completed plans are retained in [`development-plans/archived/`](development-plans/archived/) for traceability. Stage decisions and deployed evidence live in `docs/`. Contributors and coding agents should also read [AGENTS.md](AGENTS.md), which records repository conventions, security boundaries, and required checks. Keep this README current when installation, run, build, or deployment behavior changes.

# Stage 1 deployment

Deploying a fresh copy in a different Cloudflare account? Start with [Host your own copy on Cloudflare](../README.md#host-your-own-copy-on-cloudflare) to configure your Worker names, account, and CI hostname. The URLs and evidence below describe the original account.

For GitHub checks and the gated test-deployment workflow, see [CI and Cloudflare deployment](ci.md). The procedure below remains the manual/reproducibility path.

The 2026-09-12–13 Free-plan deployment used the [test shell](https://family-board-test.yuval3000.workers.dev), the [production shell](https://family-board-production.yuval3000.workers.dev), and a private `family-board-restore` Worker with no public target. The live measurements and Stage 2 gate are in [the feasibility report](stage-1-feasibility.md). The temporary test diagnostic secret was deleted after verification, and `.secrets.test` was removed locally. Re-running diagnostics requires a new disposable test secret.

Use Node 25.2.1 and npm 11.12.1 (see `.node-version` and `packageManager`). From a clean checkout at the repository root:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx wrangler login
npx wrangler whoami
npx wrangler deploy --env test --dry-run --outdir /tmp/family-board-test-dry-run
npx wrangler deploy --env production --dry-run --outdir /tmp/family-board-production-dry-run
npx wrangler deploy --env restore --dry-run --outdir /tmp/family-board-restore-dry-run
```

Inspect each dry run's bindings and `index.js`. Test must bind `TestHouseholdDO`; production must bind `HouseholdDO`; restore must bind `RestoreHouseholdDO`. The production and restore `index.js` must have no `diagnostics/probe`, `diagnostics/scrypt`, or `X-Diagnostic-Secret` strings. The `diagnostic_probe` table name remains in all three because schema version 1 is identical. `npm run deploy:restore` creates its separate namespace without a public target: `workers_dev` is false and it has no route until Stage 7.

Create only the disposable **test** diagnostic secret. Never print it, pass it on a command line, commit it, or put it in `.dev.vars` for production. The local file is ignored by Git and has mode 0600.

```sh
umask 077
openssl rand -hex 32 > .secrets.test
npm run deploy:test
npx wrangler secret put TEST_DIAGNOSTIC_SECRET --env test < .secrets.test
```

The first test deploy may have no diagnostic secret; the routes return 404 until `secret put` completes its deploy. Record the `workers.dev` URL reported by Wrangler. Verify routing, write a probe, redeploy, and prove that a later request reads then removes it:

```sh
python3 scripts/verify_stage_1.py https://TEST_HOST.workers.dev routing
python3 scripts/verify_stage_1.py https://TEST_HOST.workers.dev probe-write
npm run deploy:test
python3 scripts/verify_stage_1.py https://TEST_HOST.workers.dev probe-read-remove
python3 scripts/verify_stage_1.py https://TEST_HOST.workers.dev benchmark
python3 scripts/verify_stage_1.py https://TEST_HOST.workers.dev cold-sample
```

For 20 confirmed cold sessions, run `npm run deploy:test` and then `python3 scripts/verify_stage_1.py https://TEST_HOST.workers.dev cold-sample` 20 times. The first sample establishes a baseline. Each later sample counts only when the secret-guarded diagnostic session marker differs from the previous session. Finish with `python3 scripts/verify_stage_1.py https://TEST_HOST.workers.dev cold-summary`; it requires 20 confirmed new sessions and p95 under five seconds. The marker is a random session tag, not the Durable Object ID, and is never exposed by `/api/v1/health`.

The benchmark generates a random test password in process memory, never prints it, and sends it only to the secret-guarded test diagnostic route. It returns p50/p95 request latency, DO operation time, queue wait, and the seven-request burst duration. Cloudflare does not expose precise per-operation peak memory to this route; use dashboard analytics for runtime CPU and memory failures.

After gathering evidence, disable the test diagnostic route by removing its test secret with `npx wrangler secret delete TEST_DIAGNOSTIC_SECRET --env test`. The source remains reusable, but an unguarded request is always 404. Keep `.secrets.test` only while repeating the feasibility check; remove it from the local machine when done.

Only if the [feasibility gate](stage-1-feasibility.md) passes, an empty production shell may be deployed with `npm run deploy:prod`. Verify it with `python3 scripts/verify_stage_1.py https://family-board-production.yuval3000.workers.dev routing`. No production account secret, owner, or user data is created in Stage 1. Production diagnostics are compiled out. `restore` stays unexposed. Each Wrangler environment has a distinct Worker name, Durable Object class namespace, variables, and secret store. The front Worker always derives `idFromName('household')` from its bound namespace; requests cannot choose an object name. Stage 7 must use Cloudflare's documented multi-deploy class transfer rather than changing a string in this config.

Rollback before accounts exist: redeploy the previous Worker version. Keep the feasibility report; avoid deleting any production Durable Object namespace after Stage 7 begins storing owner data.

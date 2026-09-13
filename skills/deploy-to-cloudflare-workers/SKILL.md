---
name: deploy-to-cloudflare-workers
description: Set up, deploy, or maintain a web app on Cloudflare Workers using Wrangler, Static Assets, optional APIs or Durable Objects, and optional GitHub CI. Use for Cloudflare Workers hosting, environment setup, release, or deployment automation; not for unrelated cloud providers.
---

# Deploy to Cloudflare Workers

Use this skill to take a repository from a working local build to a verified Cloudflare Workers deployment. Adapt the procedure to the app; a static site does not need a Durable Object, and an app with persistent data needs more than a successful asset upload. This skill is guidance, not authorization to use an account or change a live environment.

## Establish the target

1. Read the repository's instructions, package scripts, Wrangler configuration, CI workflow, deployment history, and current worktree. Identify the app's build output, server entry point, routes, storage, migrations, secrets, domains, and existing environments. Preserve unrelated changes.
2. Establish the intended Cloudflare account and exact target environment. Check current [Workers limits and pricing](https://developers.cloudflare.com/workers/platform/limits/) against the app's expected workload; verify that Workers plus [Static Assets](https://developers.cloudflare.com/workers/static-assets/) support the app before changing its architecture. Keep existing production data and Worker identities intact.
3. Prefer the project's pinned Wrangler. Use `wrangler whoami` to confirm the account; use `wrangler login` or an available Cloudflare connector only when authentication is needed. Never request a credential in chat or put a token in source, shell history, logs, or a URL.

## Prepare the deployment

4. Configure distinct test and production Workers when the app needs a release path. Check each environment's name, routes, Static Assets directory, bindings, vars, and secrets. Add Durable Objects, D1, KV, R2, or other resources only when the app actually uses them. A database namespace or class name can be a data identity; do not rename or delete one as a cosmetic change.
5. Keep non-secret configuration in Wrangler config and values such as API keys in Cloudflare secrets. Use ignored `.dev.vars` or `.env` files locally. Provision separate secret values per deployed environment, confirm required names exist, and retain recovery-critical keys in appropriate escrow before losing their only copy. A `wrangler secret put` changes a deployed Worker version, so include it in verification.
6. Run the repository's install, lint, typecheck, build, and meaningful tests. Run `wrangler deploy --dry-run --outdir <temporary-directory>` for each target environment; inspect the bundle, asset inclusion, bindings, Worker name, and any environment-specific code. Check that test-only diagnostics and credentials cannot reach production.

## Deploy and prove the result

7. Deploy the isolated test environment first. Verify the exact hostname, static assets, client routes, API behavior, authentication boundaries, and persistence or migration behavior relevant to this app. Use disposable test identities and data. Confirm the deployed version or asset hash corresponds to the tested commit; account for short propagation delays before calling an asset check a failure.
8. If Git-based CI is in scope, make checks run on pull requests and pushes, and let deployment run only after checks pass on the intended branch. Store a narrowly scoped Cloudflare API token and account ID in CI secrets. Give each Worker one automatic deployer; verify the deployment job separately from the checks job. See [CI guidance](references/github-actions.md).
9. Before a production release, inspect the project's release gate, data backup and restore path, forward-only migrations, compatible rollback version, and actual authorization for this target. Complete checks and a concrete release candidate first. Deploy only within the user's authorized scope; do not treat this skill or access to credentials as permission. After deployment, verify the live version, routes, security behavior, data access, and errors, then record what was deployed and what remains unverified.

For command patterns, environment and secret nuances, and storage-specific checks, read [Wrangler deployment notes](references/wrangler-deployment.md). Recheck the linked [Cloudflare documentation](https://developers.cloudflare.com/workers/) when syntax or platform limits may have changed.

## Report

State the account/environment, hostname, tested commit or version, local and CI results, live checks, and any blocked or deliberately deferred step. A passing build, successful `wrangler deploy`, and healthy application are three different claims; provide evidence for each one you make.

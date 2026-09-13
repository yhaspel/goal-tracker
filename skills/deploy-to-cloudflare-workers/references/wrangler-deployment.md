# Wrangler deployment notes

These are adaptable command patterns, not commands to run blindly. Prefer the repository's package manager, pinned Wrangler, scripts, and existing runbook. Use the [current Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/) for accepted fields.

## Worker and assets

- For a new app, decide whether a Worker with [Static Assets](https://developers.cloudflare.com/workers/static-assets/) is sufficient. Set `assets.directory` to the **built** frontend output, not its source directory. An API or server-rendered app also needs a `main` entry point and deliberate asset/API routing. Verify client-side deep links and unknown API paths separately; an SPA fallback returning 200 for every path can mask routing errors.
- Keep `compatibility_date`, framework settings, `nodejs_compat` when needed, and resource bindings in Wrangler config. Do not copy an example app's names, dates, hostnames, bindings, or secret names into a different app.
- Named environments are independently deployed Workers. Check the complete resolved configuration for each: environment-level bindings and vars may not inherit from the top level. Give test and production distinct Worker names and storage resources when isolation matters. Use a private restore Worker only if the application's recovery design calls for one.
- To create a SQLite-backed Durable Object on current Wrangler, define the `durable_objects.bindings` class and a matching `exports` entry with `type: "durable-object"` and `storage: "sqlite"`. Existing apps may use the legacy `migrations` array; follow [Cloudflare's class lifecycle documentation](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) before changing that mechanism. A Worker code rollback does not reverse database schema changes or restore deleted data.

## Local, dry-run, and deployed checks

```sh
npx wrangler whoami
npx wrangler dev --env test
npx wrangler deploy --env test --dry-run --outdir /tmp/worker-test-dry-run
npx wrangler deploy --env test
```

Adapt or omit `--env test` if the repository has no named test environment. Build assets before the dry run and deploy when the framework does not do so for you. Inspect the dry-run output and Wrangler's binding summary. Use the actual URL printed by Wrangler, not an assumed `workers.dev` address. For an initial public hostname, confirm the account's `workers.dev` subdomain or custom domain is configured.

Verify a representative set of routes, for example: `/`, a client-side deep link, one static asset, health or API endpoint, an unauthorized API request, an unknown API path, and a persistence read after a write in **test**. Add app-specific checks for storage, jobs, WebSockets, cache, and auth. For an asset hash or deployment propagation mismatch, retry briefly against the same intended hostname, then inspect the deployed version and CI logs; do not declare success solely from `wrangler deploy` exiting zero.

## Secrets and data

- Cloudflare's [secrets guide](https://developers.cloudflare.com/workers/configuration/secrets/) documents `npx wrangler secret put NAME --env test`; it deploys a new version immediately. Use its interactive prompt or stdin from a protected file or secret manager, and confirm the environment. Do not echo secret values into logs or commit `.dev.vars*`, `.env*`, or temporary secret files.
- If Wrangler config declares required secrets, establish them before the first code deploy or use Cloudflare's documented `--secrets-file` deployment path. Confirm the resulting version and remove temporary files after secure escrow where needed.
- A local `.dev.vars.<environment>` file, if present, overrides the generic `.dev.vars` file rather than merging it. Check the [current rules](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets) when troubleshooting a missing local secret.
- Check whether the app requires a one-time setup credential, persistent signing key, or external provider token. Provision only what the app needs. Back up a key whose loss would make user data or recovery impossible, separately from the data backup. Remove one-time setup secrets when the application's own lifecycle says they are retired.
- Before changing a production Durable Object or database schema, know the backup/restore method and the oldest compatible rollback code. Never reset a live namespace or assume redeploying earlier code undoes a migration.

# Family board

A private, shared Kanban board for one household or small working group, planned for up to seven active users including the owner. The owner will manage an allowed-email list; joining will also require an invitation. The intended release has recovery phrases and an English, Hebrew, and Russian interface. The master plan (`development-plans/personal-business-goals-dashboard-master-plan.md`) defines the product scope and architecture.

The **second release** adds three things the first deliberately left out, under an explicit scope change recorded in the master plan: an optional **due date** on every card, a **Goals** tab of yearly goals and monthly milestones that cards can be linked to, and a **Vision Board** tab of uploaded images shown as a gallery and a carousel. A due date is a calendar day, and whether something is overdue is decided in your own browser against your own local date. Goal progress counts milestones you have marked done, not cards sitting in a column called Done. Vision-board images are downscaled and re-encoded in the browser before upload — which also strips the GPS coordinates a phone photograph carries — and are stored in the same database as everything else, so they travel in the same backup. Nothing else changed: still no private boards, no notifications, no email, no attachments on a card, and still one shared board.

**Current status:** the first release is feature-complete, and the second release is built and proven on the isolated test Worker but **not in production**. The app has the shared board, cards and columns, invitations and accounts, recovery phrases with a manual operator rescue, and an English, Hebrew, and Russian interface. Stages 1 through 6 are closed; Stage 6 closed on 2026-09-13 by owner decision rather than a passed exit gate — its manual screen-reader review was never performed — see [the Stage 6 completion report](docs/stage-6-completion.md). The application is deployed to both the isolated test Worker and production. **Production runs the current code and has a real owner account**, created directly by the owner on 2026-09-13.

**Stage 8 — the second release — is built and proven on the test Worker, and is deliberately not in production.** Migration 5 is applied there and the deployed smoke checks pass; [the Stage 8 completion report](docs/stage-8-completion.md) records what was measured and what was not, including why the image byte caps ended up at 400 KB rather than the 1.4 MB the plan proposed. It waits on Stage 7, because production holds real data whose recovery path is not yet fully proven, and every Stage 8 feature adds rows that exist nowhere else.

**Stage 7 — backup, hardening, and release — is deployed but not closed.** The first encrypted production backup was taken on 2026-09-13 and restored into a throwaway deployed Worker, where the household re-exported byte-identically, so the recovery path is no longer theoretical. What is still missing is listed in **[the Stage 7 status record](docs/stage-7-status.md)** — read it before picking this up. The headline gaps: no successful sign-in on a restored household, no deployed lost-phrase rescue (the named exit-gate item), and the backup shares a laptop with the key that decrypts it. The operational checklist is in [the operator runbook](docs/operator-runbook.md#stage-7-release-checklist). Read [the production deployment record](docs/production-deployment.md) for the current state of production. The development-plan index (`development-plans/README.md`) tracks the stages, and `docs/` holds the per-stage evidence.

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

The account API needs four local secrets, and the operator backup routes need two more. Create a
throwaway `.dev.vars` file, which Git ignores and Wrangler loads automatically for `npm run dev`:

```sh
umask 077
{
  echo "BOOTSTRAP_SECRET=$(openssl rand -hex 32)"
  echo "RECOVERY_DIGEST_KEY=$(openssl rand -hex 32)"
  echo "CSRF_SECRET=$(openssl rand -hex 32)"
  echo "RATE_LIMIT_KEY=$(openssl rand -hex 32)"
  echo "BACKUP_OPERATOR_SECRET=$(openssl rand -hex 32)"
  echo "BACKUP_HOUSEHOLD_ID=goal-tracker-local"
} > .dev.vars
```

`BOOTSTRAP_SECRET` opens one-time owner creation. `RECOVERY_DIGEST_KEY` keys recovery-phrase
digests, `CSRF_SECRET` signs the session-bound CSRF value, and `RATE_LIMIT_KEY` pseudonymises
rate-limit buckets. Without them the account routes answer `503 unavailable` rather than
falling back to a weaker derivation. `BACKUP_OPERATOR_SECRET` authorises
`GET /api/v1/operator/export` and, in the `restore` environment only,
`POST /api/v1/operator/import`; `BACKUP_HOUSEHOLD_ID` names the household a backup belongs to, so
a restore target can refuse a copy from somewhere else. Both are only needed to rehearse
[`scripts/backup.ts`](scripts/backup.ts) locally; without them the operator routes answer `404`. Use values like these only locally; deployed
environments get their own separate Cloudflare secrets. `npm test` generates its own
disposable values and needs no `.dev.vars`.

To create the first account, open `/bootstrap` on your local board and enter the
`BOOTSTRAP_SECRET` from `.dev.vars` with the owner's email and a new password. The owner
does **not** need an invitation code. After confirming the recovery phrase, the owner
is signed in. Open **Settings**: add each member's email to the allowed list, create an invitation for
that address, and share its one-time code directly. The app sends no email. Each member
uses **Join with an invitation** (`/register`) with that code and the same email address.
The owner setup page closes after the first owner account is created.

```sh
npm run dev
```

Wrangler prints the local address, normally [http://localhost:8787](http://localhost:8787). With no owner yet, the page offers to set one up. To check that the API and local Durable Object are working, open [http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health) or run:

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
| `npm run check:i18n` | Verify the English, Hebrew, and Russian dictionaries are complete and consistent |
| `npm test` | Build the web shell and run tests in the Cloudflare Workers runtime |

Run `npm run lint`, `npm run typecheck`, and `npm test` before submitting application changes, and `npm run check:links` when you move or rename a document. Dependencies are locked in `package-lock.json`; use `npm ci` for a clean install. `web/dist/` and local Wrangler state are generated and ignored by Git.

## Architecture and environments

The app is a Vite/React frontend (`web/`) served as Static Assets by one Cloudflare Worker (`worker/`). The Worker handles `/api` routes before assets and serves `index.html` only for an explicit list of client-side paths, which `tests/web.ui.test.ts` compares against the router's own list. A single SQLite-backed Durable Object owns household data and migrations; shared API types live in `shared/`, and Workers-runtime tests live in `tests/`. [`wrangler.jsonc`](wrangler.jsonc) defines separate `test`, `production`, and `restore` Workers and Durable Object namespaces. The restore Worker has no public route.

The interface self-hosts its typefaces: `web/public/fonts/` holds ten Barlow and Barlow Condensed `.woff2` subsets (latin and latin-ext), which Vite copies verbatim into `web/dist/fonts/` and the stylesheet requests from same-origin `/fonts/`. Nothing is fetched from `fonts.googleapis.com` or `fonts.gstatic.com`, so the app needs no third-party origin at runtime. Neither family publishes a Cyrillic cut, so Russian falls through to the platform UI face exactly as Hebrew does.

The app installs as a Chrome app: Chrome and other Chromium browsers offer it from the install button in the address bar or from their menu, Chrome on Android offers it from its menu, and on an iPhone Safari's **Add to Home Screen** does the same job. The installed window opens on the board, or on sign-in for a guest, and it still needs a connection: there is no service worker and no offline mode. [`web/public/manifest.webmanifest`](web/public/manifest.webmanifest) describes the app, and the icons in `web/public/icons/` are cut from the app mark. [AGENTS.md](AGENTS.md) records why a service worker, if one is ever added, must never cache.

Card dragging uses the pinned [`@dnd-kit/react`](https://dndkit.com/react/guides/sensors/) 0.5.0 for pointer, touch, and keyboard input. Every card also carries explicit **Move up**, **Move down**, and **Move to column** controls, so nothing on the board needs a drag.

The interface is available in English, Hebrew, and Russian. Hebrew renders right to left, while email addresses, invitation codes, reset codes, and recovery words stay left to right inside their own isolated spans. A guest's choice lives in a non-sensitive `kanban_locale` cookie; a signed-in member's choice is stored on their account and takes precedence at the next sign-in. `npm run check:i18n` fails the build if any locale is missing a key, drops an interpolation placeholder, or lacks a plural form its language requires.

The deployed [test Worker](https://family-board-test.yuval3000.workers.dev) is used for stage work and holds only disposable accounts. [Production](https://family-board-production.yuval3000.workers.dev) runs the same code, deployed manually on 2026-09-13, with its own Durable Object namespace and its own secrets; the owner bootstrapped a real owner account there the same day, so owner setup is now closed and production holds real data. Test-only diagnostic endpoints require a disposable secret, are disabled in the deployed test Worker, and are compiled out of the production bundle entirely. See [the production deployment record](docs/production-deployment.md) for what is and is not in place there.

Each deployed environment keeps its own secrets. `BOOTSTRAP_SECRET` opens one-time owner creation, and `RECOVERY_DIGEST_KEY`, `CSRF_SECRET`, and `RATE_LIMIT_KEY` are required for the account routes to work at all — without them those routes answer `503 unavailable` rather than weakening a derivation. `BACKUP_OPERATOR_SECRET` authorises the operator backup routes and is different in every environment. Do not put secrets, passwords, recovery phrases, invitation codes, or session tokens in source, logs, URLs, or snapshots.

The backup import route exists **only in the `restore` build**. `__ENABLE_RESTORE_IMPORT__` is a build-time `define` that is true for `restore` and false everywhere else, so the route's path, handler and SQL are absent from the production and test bundles rather than merely unreachable — CI fails if those strings ever appear in the production dry run. Export is available in every environment because a drill needs a source, and it is gated by the bearer secret alone: it never accepts a session cookie, and an unauthorised call gets the same `404` an unknown path gets.

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and HSTS; the SPA shell and static assets also carry a `Content-Security-Policy` of `default-src 'none'` with `'self'` for script, style, font, image, connect and the web app manifest, `frame-ancestors 'none'` and `object-src 'none'`. `style-src` additionally allows `'unsafe-inline'`, which React and the board's drag projection require because they set `style=` attributes; there is no inline script and no `eval` anywhere in the bundle. The SPA shell is served `no-store` on every route, since the same `index.html` serves registration and recovery; hashed assets and fonts keep their own caching.

Every `/api` response is `no-store` with one deliberate exception: `GET /api/v1/vision/images/:id/content` answers with a strong `ETag` and `Cache-Control: private, max-age=31536000, immutable`. An image's bytes never change for the life of its id — no route replaces them and a deleted id is never reused — and `private` keeps every shared cache out, so no cache can serve one member's image to anyone else. Without it a sixty-tile gallery would cost sixty Durable Object requests on every view. The session is re-checked **before** the `If-None-Match` comparison, so a member whose access has ended gets `401`, never a `304`.

Vision-board images are stored as BLOBs in the same Durable Object, under explicit caps: 400 KB per image, 100 KB per thumbnail, 60 images, and a 64 MiB total budget tracked in `vision_state.bytes_used`. The two byte caps were set by measuring the front Worker's CPU against the Free plan's 10 ms per-request limit on the deployed test Worker, not chosen in advance — see [the Stage 8 completion report](docs/stage-8-completion.md). Uploads are rate-limited per account and per IP. The browser downscales and re-encodes every image before sending it, which also strips EXIF — including the GPS coordinates a phone photograph records. SVG is not an accepted type in any form: it is a script-bearing document, and serving one from the app's own origin would be an XSS vector no header reliably closes.

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
   # Keep this until you create the first owner in this test environment.
   openssl rand -hex 32 > .secrets.bootstrap-secret
   npx wrangler secret put BOOTSTRAP_SECRET --env test < .secrets.bootstrap-secret

   # Keep this one. Cloudflare cannot show a secret again, and the lost-phrase rescue
   # runbook needs it. Move it to your separate secret escrow before you delete the file.
   openssl rand -hex 32 > .secrets.recovery-digest-key
   npx wrangler secret put RECOVERY_DIGEST_KEY --env test < .secrets.recovery-digest-key

   for name in CSRF_SECRET RATE_LIMIT_KEY; do
     openssl rand -hex 32 > .secrets.tmp
     npx wrangler secret put "$name" --env test < .secrets.tmp
   done
   rm -f .secrets.tmp
   ```

   **Escrow `RECOVERY_DIGEST_KEY` when you create it**, separately from any data backup. It
   signs recovery-phrase digests and operator rescue tokens, so
   [the lost-phrase runbook](docs/operator-lost-phrase-reset.md) cannot be followed without it.
   Replacing it invalidates every stored phrase: each member then has to regenerate a phrase
   from a signed-in session, and anyone who cannot sign in needs an operator rescue.

   Then exercise the whole account flow against your deployed test Worker, keeping the
   bootstrap value in `.secrets.bootstrap-secret` so it stays off the command line. The
   flow creates a disposable owner and six members, so run it once against a fresh namespace:

   ```sh
   node scripts/auth-smoke.ts https://your-test-worker.your-subdomain.workers.dev < .secrets.bootstrap-secret
   ```

   The smoke script consumes first-owner setup. For a group you create yourself, skip
   the smoke script and open `/bootstrap` on that environment's URL with the same
   setup secret. Then add allowed emails and create invitations in owner **Settings**.
   Do not reuse the test secret for production; production owner activation waits for
   the Stage 7 backup and restore gate.

   Once that household exists, the other smoke scripts reuse it from the same
   `.secrets.smoke.json` and each leaves the environment as it found it:

   ```sh
   node scripts/board-smoke.ts   https://your-test-worker.your-subdomain.workers.dev
   node scripts/recovery-smoke.ts https://your-test-worker.your-subdomain.workers.dev < .secrets.test-recovery-key
   node scripts/goals-smoke.ts   https://your-test-worker.your-subdomain.workers.dev
   node scripts/vision-smoke.ts  https://your-test-worker.your-subdomain.workers.dev
   ```

   All four refuse a hostname containing `production`.

4. The [Stage 1 feasibility result](docs/stage-1-feasibility.md) applies to the original Cloudflare account. If you intend to follow this project's release plan, repeat the account-specific test gate using the [deployment runbook](docs/deployment.md). After that gate passes, `npm run deploy:prod` publishes the app under your separate production Worker, which needs its own four secrets — **escrow `RECOVERY_DIGEST_KEY` when you create it**, because Cloudflare never shows it again and the lost-phrase rescue is impossible without it. `npm run deploy:restore` creates the private restore Worker without a public route. Run the routing check against your production URL as well. Stage 7's backup and restore path now exists and has been exercised end to end against deployed Workers, but it is operator-driven: nothing backs up on a schedule, so a new deployment is only as recoverable as the last copy someone took. See [the Stage 7 status record](docs/stage-7-status.md).
5. If you fork the repository and want GitHub Actions to deploy your test Worker, change the original test URL in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) to **your** URL. Create a Cloudflare API token scoped to your account for Worker deployment, then add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets and set `CLOUDFLARE_TEST_DEPLOY_ENABLED=true` as a repository variable. Follow [Cloudflare's GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and [account ID guide](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/). Enable this only after the manual test deploy and URL check succeed. The workflow deploys test after passing checks on the default branch; it never deploys production. Use this GitHub Actions pipeline as the only automatic deployer for that Worker.

For repeatable manual deployment, diagnostic-secret handling, and cleanup, use [docs/deployment.md](docs/deployment.md). Its example hostnames are from the original account; replace them with your own. Keep API tokens and diagnostic secrets out of Git and use only disposable test identities.

## CI and deployment

[GitHub Actions](.github/workflows/ci.yml) runs locked installation, lint, type checks, a Markdown link check, a dictionary check, Workers-runtime tests, dependency audit, and a production bundle dry run on pushes and pull requests. After checks pass on a default-branch push, its `deploy-test` job deploys the **test** Worker and checks live routing. Pull requests do not deploy. A passing checks job alone does not mean a deployment succeeded; verify the `deploy-test` job. **Production is never deployed automatically** — it is published by hand with `npm run deploy:prod`, so every production release is a deliberate act.

See [CI configuration and credential maintenance](docs/ci.md) for the GitHub/Cloudflare setup and [the manual deployment runbook](docs/deployment.md) for reproducible deployment, verification, and diagnostic-secret cleanup. Cloudflare credentials are needed for manual remote deployments, not for local setup.

## Operator procedures

[**The operator runbook**](docs/operator-runbook.md) is the single page for keeping this deployment
recoverable: secret and key escrow, the weekly encrypted backup and its retention, the monthly
isolated restore drill, Cloudflare point-in-time recovery, the Free-plan quota review, incident
response, and production replacement. It also carries the Stage 7 release checklist, which records
exactly which deployed steps are still outstanding.

The backup tool is [`scripts/backup.ts`](scripts/backup.ts). The operator secret arrives on stdin
so it never reaches a command line; the AES-256-GCM key is named by path and must be a 0600 file
outside the backup directory:

```sh
node scripts/backup.ts create  <base-url> --out-dir <dir> --key-file <file> < operator-secret-file
node scripts/backup.ts verify  --out-dir <dir> --key-file <file>
node scripts/backup.ts list    --out-dir <dir>
node scripts/backup.ts restore <base-url> --out-dir <dir> --key-file <file> --file <name>
```

`create` downloads the export, verifies its digest, encrypts it, writes it through a 0600
temporary file and an atomic rename, decrypts the stored file to verify it, and only then prunes to
four weekly and three monthly copies. `restore` refuses any host whose name contains `production`.

If someone loses both their password and their recovery phrase, there is no email reset and no
self-service path. The owner verifies them offline and an operator with Cloudflare access
issues a one-time, 15-minute rescue token through Durable Object Data Studio. Follow
[the lost-phrase runbook](docs/operator-lost-phrase-reset.md); it uses
[`scripts/create-operator-reset-token.ts`](scripts/create-operator-reset-token.ts), which reads
the environment's recovery digest key from stdin and prints the SQL to run. The token itself is
shown once and never stored.

## Working on the project

Read the development-plan index (`development-plans/README.md`) and the active stage plan before implementing features. Completed plans are retained in `development-plans/archived/` for traceability. `development-plans/` and `prompts/` are Git-ignored, so they are not part of a clone — planning material stays on the owner's machine, and the paths above are named in plain text rather than linked. Stage decisions and deployed evidence live in `docs/`, which is tracked. Reviews of the shipped interface — accessibility and design — live in `reviews/`, also tracked, with the evidence behind each finding. Contributors and coding agents should also read [AGENTS.md](AGENTS.md), which records repository conventions, security boundaries, and required checks. Keep this README current when installation, run, build, or deployment behavior changes.

The portable [Cloudflare Workers deployment skill](skills/deploy-to-cloudflare-workers/SKILL.md) captures the reusable process used here. It is intentionally app-independent; this repository's `AGENTS.md`, plans, and deployment records still control releases of this app. To use the skill across projects, copy its folder into `~/.agents/skills/` for Codex and ChatGPT desktop, or `~/.claude/skills/` for Claude Code. Other agents that support the [Agent Skills format](https://agentskills.io/specification) can load the same folder from their configured skill location.

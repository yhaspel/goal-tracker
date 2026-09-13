# Operator runbook

Everything one person has to do to keep this deployment recoverable, and everything they have to
do when it is not. It is written to be followed by someone who has the escrowed secrets and
nothing else — no chat history, no memory of how it was built.

Companion documents: [deployment](deployment.md) for publishing a Worker,
[the lost-phrase rescue](operator-lost-phrase-reset.md) for a locked-out account,
[the production deployment record](production-deployment.md) for what production actually holds,
[the Stage 7 status record](stage-7-status.md) for what is still outstanding and in what order,
and [CI](ci.md) for what the pipeline does and does not deploy.

**Read this first.** Production has held real data since 2026-09-13. The first encrypted backup was
taken and verified the same day, and restored into a throwaway deployed Worker the same day, where
it re-exported byte-identically to the copy on disk. So the recovery path is no longer theoretical.

Two caveats survive that, and both matter. **The copy and the AES key that reads it sit on one
laptop**, so the pair is a second copy of the data but not a second place to keep it. And **nobody
has signed in to a restored household on a deployed Worker** — the hash is one-way, so proving that
needs whoever holds an account's password.

## What exists, and what is still unproven

| Capability | State |
| --- | --- |
| Operator export (`GET /api/v1/operator/export`) | Implemented in all three environments, bearer-authenticated |
| Restore import (`POST /api/v1/operator/import`) | Implemented in the `restore` build only; absent from the production and test bundles, and CI fails if it ever appears in production's |
| Encrypted local backup, retention, verification, restore (`scripts/backup.ts`) | Implemented; proven end to end against local `wrangler dev` Workers, including sign-in on the restored household |
| Security headers, CSP, shell `no-store` | Implemented and covered by `tests/routing.test.ts` |
| **The same round trip against the deployed Free Workers** | **Done 2026-09-13.** Export, encrypt, decrypt and import all ran against deployed Workers; the restored household re-exported byte-identically. A successful sign-in is still unproven — see the drill record |
| **A verified production backup** | **Taken 2026-09-13** — `goal-tracker-production-2026-09-13-schema4-1f0ac18e.backup.enc`, verified by decrypting it back off the disk. It and its key live on one laptop, so the copy is real but not yet redundant |
| Cloudflare point-in-time recovery on the Free plan | **Unverified.** See its section below |

## Configuration this stage adds

| Name | Kind | Where |
| --- | --- | --- |
| `BACKUP_OPERATOR_SECRET` | Cloudflare secret, 32 random bytes, **different in every environment** | `production`, `test`, and each drill `restore` Worker |
| `BACKUP_HOUSEHOLD_ID` | Trusted configuration, not a secret | `vars` in `wrangler.jsonc` for `production` (`goal-tracker-production`) and `test` (`goal-tracker-test`); set per drill on `restore` with `wrangler secret put` |

Both operator routes fail closed when either is missing. A missing value, a wrong secret, a
rate-limited caller and a plain-HTTP request all answer with the **same JSON 404** an unknown path
gets, so a visitor cannot learn that the route exists. When a `404` is unexpected, read the reason
from the Worker's own log rather than guessing:

```sh
npx wrangler tail --env production --format pretty
# look for {"event":"operator.backup.export","outcome":"denied","reason":"..."}
```

`reason` is one of `insecure_transport`, `operator_backup_not_configured`, `rate_limited`, or
`bad_operator_secret`. No secret material is ever logged.

Provision a secret without letting it reach a shell history entry:

```sh
umask 077
openssl rand -hex 32 | tr -d '\n' > .secrets.backup-operator.production
npx wrangler secret put BACKUP_OPERATOR_SECRET --env production < .secrets.backup-operator.production
```

The `tr -d '\n'` is not cosmetic. `authorize()` compares `ctx.env.BACKUP_OPERATOR_SECRET` verbatim
and the bearer pattern is `Bearer\s+(\S+)`, so a trailing newline becomes part of the stored secret
and **no caller can ever match it**. The failure is silent and indistinguishable from a wrong
secret: the route answers the same `404` it gives everyone, and `wrangler tail` reports
`bad_operator_secret`. After provisioning, prove the credential once without reading the data:

```sh
{ printf 'header = "Authorization: Bearer '; cat .secrets.backup-operator.production; printf '"\n'; } \
  | curl --config - -sS -o /dev/null -w '%{http_code} %{size_download}\n' \
      https://family-board-production.yuval3000.workers.dev/api/v1/operator/export
```

`200` and a non-zero byte count is the proof. Piping the secret through `--config` keeps it out of
`curl`'s argument list, where `ps` would show it.

## Secret and key escrow

Escrow these **separately from the encrypted backup files**. A laptop holding both the copies and
the key is not an encrypted backup; it is one theft away from being a plaintext one.

| Value | Why it must survive | Consequence of losing it |
| --- | --- | --- |
| The AES-256 backup key (`--key-file`) | Decrypts every stored copy | Every backup becomes permanently unreadable |
| `RECOVERY_DIGEST_KEY` | Keys every recovery-phrase and operator-token digest | Every recovery phrase in a restored household stops verifying; the lost-phrase rescue becomes inoperable |
| `CSRF_SECRET` | Signs the session-bound CSRF value | Only live sessions break; a new value is safe to generate |
| `RATE_LIMIT_KEY` | Pseudonymises rate-limit buckets | Existing counters reset; a new value is safe to generate |
| `BACKUP_OPERATOR_SECRET` | Authorises export and import | Generate a new one and `wrangler secret put` it; nothing is lost |

Only the first two are unrecoverable. **Replacing `RECOVERY_DIGEST_KEY` invalidates every stored
recovery phrase**, so a restore into a household whose digest key is gone can restore the data but
cannot restore self-service recovery — every account then needs the operator rescue and a new
phrase.

Production's `RECOVERY_DIGEST_KEY`, `CSRF_SECRET` and `RATE_LIMIT_KEY` are currently in
`.secrets.production.env` (mode 0600) on the owner's machine, which
[the production deployment record](production-deployment.md) already flags as not an escrow.
Moving them into a real one — a password manager, a sealed envelope, a second machine — is part of
closing this stage.

## Weekly backup

Once a week, from a machine that holds the key file and the operator secret file:

```sh
node scripts/backup.ts create https://family-board-production.yuval3000.workers.dev \
  --out-dir ~/goal-tracker-backups \
  --key-file ~/.goal-tracker/backup.key \
  < ~/.goal-tracker/backup-operator.secret
```

What it does, in order: downloads the export over HTTPS; re-canonicalises the payload and
recomputes its SHA-256 to check the digest the Worker sent; **fetches every vision image the
envelope lists, one request each, checking each payload against the digest the envelope
recorded**; re-reads the envelope and refuses the whole attempt if the vision revision moved while
the images were being fetched; encrypts envelope and images together with AES-256-GCM under a
random 96-bit nonce, with the copy's metadata authenticated as additional data; writes a mode-0600
temporary file, `fsync`s it and renames it into place; **re-reads the file from disk, decrypts it,
re-verifies the digest and checks every image byte against its recorded digest**; and only then
prunes. There is never an unencrypted temporary file and never a moment when pruning has happened
but the new copy has not been verified.

### Why a backup can restart itself

Since Stage 8 a backup is two phases — one envelope, then one request per image — and those are no
longer a single SQLite snapshot. If a member deletes an image while the backup is running, or adds
one, the tool says so and starts again from a fresh envelope, up to three times. A backup is
declared successful only when the envelope and every byte come from the same vision revision.

That is the point: without it, one member deleting one image during the backup window would fail
every subsequent backup, and the household would quietly age on an old copy. If all three attempts
lose the race, nothing is written, **nothing is pruned**, and the command exits non-zero. Run it
again when the vision board is quiet.

### What a copy now holds

The stored archive format moved from `goal-tracker-backup-v1` to `v2`, because image bytes do not
fit inside the envelope. **Copies taken before Stage 8 are still readable** — `verify` and
`restore` accept both, and a `v1` copy simply has no images, which is correct, because it predates
them. Do not delete the older copies on the strength of the new format.

**A household that fails its own integrity checks prunes nothing at all.** The copy is still
written and still verified — a data anomaly must not cost you a backup — but retention pins the
newest copy without knowing whether a restore would accept it, so pruning on that run would keep
the unusable copy and delete a clean older one. The command reports the issues and exits non-zero
with every existing copy untouched.

Both inputs are protected on purpose. The operator secret comes in on **stdin**, so it never
appears in a command line, a process list or a shell history entry. The key file is named by path
and is refused unless it is a regular file with mode 0600 and lives **outside** the backup
directory.

Create them once:

```sh
umask 077
mkdir -p ~/.goal-tracker ~/goal-tracker-backups
openssl rand -hex 32 > ~/.goal-tracker/backup.key          # then escrow this, separately
cp .secrets.backup-operator.production ~/.goal-tracker/backup-operator.secret
chmod 600 ~/.goal-tracker/* && chmod 700 ~/goal-tracker-backups
```

**If the machine was off on backup day, run a catch-up backup the moment it is on.** A skipped week
is a week whose data exists in one place. Pruning is driven by the dates of the copies that exist,
not by a calendar, so a late backup is never worse than no backup.

`create` exits non-zero, *after* the copy is safely written and verified, when the household failed
its own integrity checks. That is deliberate: a household with a data anomaly still gets a backup,
but a restore will refuse that copy, so the anomaly has to be fixed at the source and another
backup taken. The issues are printed in full.

### Retention

Four weekly and three monthly copies. Weekly is the newest copy of each of the four most recent ISO
weeks; monthly is the **oldest** copy of each of the three most recent calendar months, so a
month's representative is fixed when the month's first backup lands rather than drifting all month.
Pruning only ever considers files this tool wrote — the name has to match
`<household>-<YYYY-MM-DD>-schema<N>-<8 hex>.backup.enc` exactly — so anything else in the directory
is left strictly alone. The copy just written is never pruned by its own run.

```sh
node scripts/backup.ts list   --out-dir ~/goal-tracker-backups
node scripts/backup.ts verify --out-dir ~/goal-tracker-backups --key-file ~/.goal-tracker/backup.key
```

`verify` decrypts every stored copy with the escrowed key and re-checks its digest, its integrity
block, and that every image its own envelope lists is present in the archive with the right
digest. Run it monthly, and run it any time the key or the machine changes. **An empty backup
directory is reported as a failure, not as a quiet success.**

**Disk.** Seven retained copies each carry up to the 64 MiB image budget, and base64 inflates that
by a third, so the worst case is roughly **7 × 86 MB ≈ 600 MB** in the backup directory, plus the
household's text. Check there is a gigabyte free before the first backup after a large upload
session; a `create` that cannot write leaves every existing copy untouched, but a directory that
fills up silently is how a household ends up with one copy again.

## Monthly restore drill

The drill proves the whole path — decrypt, import, sign in — against a real Cloudflare object, in
an environment that can be thrown away. Never into production, and never into a namespace that has
already been imported into.

1. **Provision a fresh drill Worker.** Copy the `restore` environment in `wrangler.jsonc` to a new
   name. This block is the one that was actually used on 2026-09-13; add it under `env`, deploy,
   and delete it from the file again at step 6:

   ```jsonc
   "restore-drill-2026-09": {
     "name": "family-board-restore-2026-09",
     "workers_dev": true,
     "minify": true,
     "define": { "__ENABLE_DIAGNOSTICS__": "false", "__ENABLE_RESTORE_IMPORT__": "true" },
     "durable_objects": { "bindings": [{ "name": "HOUSEHOLD", "class_name": "RestoreHouseholdDO" }] },
     "exports": { "RestoreHouseholdDO": { "type": "durable-object", "storage": "sqlite" } },
     "vars": { "DEPLOYMENT_ENV": "restore" }
   }
   ```

   ```sh
   npm run build && npx wrangler deploy --env restore-drill-YYYY-MM
   ```

   **Reuse the class name; do not invent one.** A Durable Object namespace is identified by the
   pair (script name, class name), so `RestoreHouseholdDO` on `family-board-restore-2026-09` is a
   different and empty namespace from the same class on `family-board-restore`. The distinct
   *Worker* name is what isolates the storage. Inventing a class name instead would require adding
   it to the `export { … }` line in `worker/src/index.ts`, which means a throwaway source change
   on `main` for a Worker you are about to delete.

   `DEPLOYMENT_ENV` must stay `"restore"`. The import handler refuses outright when it reads
   `production`, and that second lock is worth keeping armed.

   **The drill Worker needs `workers_dev: true`, and the standing `restore` environment does
   not have it.** Step 3 imports over HTTPS, so the target must have a hostname; with
   `workers_dev: false` and no `routes`, `family-board-restore` has none and there is nothing to
   POST to. Set `workers_dev: true` on the *dated drill* environment only, and leave the standing
   `restore` entry alone — its lack of a public route is the reason an idle restore Worker is not
   an attack surface.

   That also means the drill Worker **is** publicly reachable for as long as it exists. It answers
   only to the bearer secret and refuses everything else with the usual `404`, but combined with
   step 2 it holds production-equivalent credential material on a public hostname. Keep the window
   short, and treat step 6 as part of the same sitting rather than a follow-up.

   `family-board-restore` currently runs the pre-Stage-7 build published 2026-09-12, which has no
   import route at all. Any drill has to deploy current code first, or the import answers `404`
   and looks like a bad secret.
2. **Configure it for one source.** The restore build has no `BACKUP_HOUSEHOLD_ID` in tracked
   configuration, so set it to the household the copy belongs to. Five secrets, all newline-free
   — `BACKUP_HOUSEHOLD_ID` is compared for exact equality against the payload's `householdId`, and
   a stored newline makes it silently unequal:

   ```sh
   umask 077
   printf 'goal-tracker-production'        > .secrets.drill-household
   openssl rand -hex 32 | tr -d '\n'       > .secrets.drill-operator
   openssl rand -hex 32 | tr -d '\n'       > .secrets.drill-csrf
   openssl rand -hex 32 | tr -d '\n'       > .secrets.drill-rate-limit
   openssl rand -hex 32 | tr -d '\n'       > .secrets.drill-digest-key
   chmod 600 .secrets.drill-*

   E=restore-drill-YYYY-MM
   npx wrangler secret put BACKUP_HOUSEHOLD_ID     --env $E < .secrets.drill-household
   npx wrangler secret put BACKUP_OPERATOR_SECRET  --env $E < .secrets.drill-operator
   npx wrangler secret put RECOVERY_DIGEST_KEY     --env $E < .secrets.drill-digest-key
   npx wrangler secret put CSRF_SECRET             --env $E < .secrets.drill-csrf
   npx wrangler secret put RATE_LIMIT_KEY          --env $E < .secrets.drill-rate-limit
   ```

   Do **not** set `BOOTSTRAP_SECRET`. A restored household already has its owner, and the import
   restores `bootstrap_consumed`, so owner creation is closed on the drill Worker by database state.

   **`RECOVERY_DIGEST_KEY` is a fresh throwaway here, not production's.** The runbook previously
   said to take production's from escrow "so phrase verification can be checked". That trade is a
   bad one in the common case: phrase verification cannot be checked without someone's *actual*
   recovery phrase, so unless you are holding one, production's key buys nothing testable while
   putting production-equivalent credential material on a public hostname. Phrase digests restore
   as opaque strings either way, so a throwaway key changes nothing about the round trip — it only
   means `/api/v1/recovery/phrase/*` on the drill Worker will not verify a real phrase. If you
   *are* rehearsing the phrase flow with a real phrase in hand, use
   `.secrets.production-digest-key` instead, and treat step 6 as urgent rather than merely
   required.

3. **Import a recent copy.**

   ```sh
   node scripts/backup.ts restore https://<drill-worker-host> \
     --out-dir ~/goal-tracker-backups \
     --key-file ~/.goal-tracker/backup.key \
     --file <household>-<date>-schema4-<suffix>.backup.enc \
     < .secrets.drill-operator
   ```

   The operator secret on stdin is the **drill Worker's**, not production's. The tool refuses
   outright to import into a host whose name contains `production`, and a dated drill name such as
   `family-board-restore-2026-09` passes that check.

   Before importing, confirm the target is pristine: `GET /api/v1/auth/bootstrap/status` on a
   fresh object answers `{"bootstrapAvailable":true}`, because no owner exists yet.

   **Since Stage 8 this is two phases, and the second one is resumable.** The envelope goes first
   and leaves the restore marker `in_progress`; then one request per vision image; then
   `/api/v1/operator/import/complete`, which checks that every listed image landed, recomputes the
   image budget from the rows that are actually stored, refuses to finish if that disagrees with
   what the backup recorded, and only then marks the restore complete. The tool drives all three.

   If the image phase fails part-way — a dropped connection, a laptop closing — **run exactly the
   same command again.** It reads `/api/v1/operator/import/status` first, sees a marker for this
   same copy, skips the envelope, and resends only the images that are missing. That is why a
   failed image no longer costs a fresh namespace and a 64 MiB restore from the start. Two things
   it will refuse rather than guess at: a marker for a *different* backup, and a marker that is
   already `complete`. Both need a fresh drill Worker.

   A partly-restored gallery is never mistaken for a whole one: an image appears in
   `vision_images` only once its real bytes have arrived and matched the digest the envelope
   recorded, and `vision_state.bytes_used` stays at zero until `complete` recomputes it.

4. **Validate the restored household.** Counts and board revision come back in the import response.
   Then, against the drill Worker:

   **Re-export and compare, which is the strongest check and needs nobody's password.** Call
   `GET /api/v1/operator/export` on the drill Worker with its bearer, and compare the payload
   field by field against the backup's decrypted payload. Everything except `createdAt` — which is
   the new export's own timestamp — must be **identical**, including password hashes, recovery
   digests, card ids, positions, due dates, milestone links, goal and milestone rows, every vision
   image's two digests, `visionState.bytesUsed`, and all three revisions. If
   `export(import(backup))` reproduces `backup` byte for byte, the restore is faithful and nothing
   was silently dropped or coerced.

   For the image bytes themselves, `GET /api/v1/operator/export/images/:id` on the drill Worker
   returns the same base64 the archive holds; spot-check a few, or all of them if the gallery is
   small. The re-export above compares digests, so a mismatch would already have shown up there.

   Then confirm the refusals: a second import answers `409 restore_target_not_pristine`;
   `bootstrap/status` now answers `false`, because `bootstrap_consumed` came back with the
   household; `/api/v1/board` and `/api/v1/members` answer `401`, because no session survived; a
   real account address with a wrong password answers `401 invalid_credentials` rather than a
   `500`, which is what proves the stored scrypt record was parsed and re-derived against rather
   than restored corrupt; and an address that is not in the household answers the same generic
   `401`.

   **A successful sign-in needs a real password and is the one part of this that cannot be
   automated.** The hash is one-way, so a drill run by anyone who does not hold an account's
   password proves everything above and stops short of the login itself. Record which of the two
   you did.
5. **Record it.** Date, copy used, source household, counts, what was checked, and anything that
   did not match. A drill nobody wrote down did not happen.
6. **Destroy the drill Worker and its namespace.** Delete the whole Worker, which takes its Durable
   Object namespaces and its public hostname with it:

   ```sh
   npx wrangler delete --env restore-drill-YYYY-MM --dry-run   # confirm the target first
   npx wrangler delete --env restore-drill-YYYY-MM
   ```

   **Read the Worker name twice before running it, and never issue it against
   `family-board-production` or `family-board-test`.** Confirm afterwards that the drill hostname
   answers Cloudflare's `1042` and that production's `/api/v1/health` is untouched.

   This project's `exports` map does **not** accept a `deleted` tombstone — `wrangler` rejects the
   config with *"exports.&lt;Class&gt;.type must be `durable-object` or `worker`"*. Tombstones belong to
   the older `migrations` array (`deleted_classes`), which this configuration does not use, so
   deleting the Worker is the mechanism here.
   [Class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

## Cloudflare point-in-time recovery

SQLite-backed Durable Objects keep a 30-day change log, and
`storage.getCurrentBookmark()`, `storage.getBookmarkForTime()` and
`storage.onNextSessionRestoreBookmark()` restore the object's whole contents to a bookmark.
[SQLite storage and point-in-time recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

Two limits matter here, and neither is a detail:

- **It is not available in local development**, because the change log is not kept locally.
- **The Durable Objects pricing page does not list it among the Free plan's features.** Treat it as
  *unverified on this account* until someone has actually obtained a bookmark from a deployed
  object. Until then it is not a recovery plan; the encrypted local copies are.

If it does work, it recovers from a bad deployment or a bad write, not from a lost namespace, and
it rolls the object **backwards** — every write since the bookmark is gone. Take a fresh encrypted
backup first so the newer writes still exist somewhere, then choose a bookmark from before the
damage, then restore. Never use it to undo a migration.

## Free-plan quota review

Check quarterly, and before any change that adds rows or routes. Cloudflare's current published
Free limits, checked 2026-09-13:

| Limit | Free |
| --- | --- |
| Worker requests | 100,000 / day |
| Front Worker CPU | 10 ms / request |
| Durable Object requests | 100,000 / day |
| Durable Object duration | 13,000 GB-s / day |
| SQL rows read | 5 million / day |
| SQL rows written | 100,000 / day |
| Stored data | 5 GB total, 1 GB per SQLite object |
| Durable Object CPU | 30 s / request (default) |
| Max SQL row | 2 MB |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
Exceeding a Free limit makes further operations of that type fail; it does not silently convert the
account to paid. Confirm in the dashboard that no automatic paid conversion is enabled.

A maximum-size household — the Stage 4 caps of 500 cards and 20 columns, with 4,000-code-point
descriptions — is roughly 8.4 MB of card text before JSON overhead, which is why the export is
bounded at 16 MiB and the import body limit matches. One weekly export reads the whole household
once; at four backups a month that is nothing against the daily row-read allowance.

## Incident response

1. **Stop writing.** If data is being damaged, the first move is to stop adding to the damage. There
   is no maintenance mode; in practice this means telling the household to stop and, if necessary,
   redeploying a previous Worker version.
2. **Preserve the object.** Do not reset, delete or re-migrate the production namespace. It is the
   only copy of anything written since the last backup.
3. **Take a backup anyway.** Even a household that fails its integrity checks produces a copy, and
   that copy is evidence.
4. **Decide the recovery path.** A bad deployment with intact data is a version redeploy. Damaged
   data within 30 days may be a point-in-time recovery, if it is available on this plan. A lost or
   corrupted namespace is a validated restore into a fresh namespace, followed by the production
   replacement below.
5. **Never import into production as a rollback.** The production build has no import route at all,
   and that is deliberate.

## Production replacement

Only when production's own object cannot be repaired. This is a maintenance action with an
audience, not a command.

1. Pause writes and take a fresh encrypted backup of whatever production still holds.
2. Import that copy into a **new** isolated restore namespace and validate it exactly as the drill
   does, including sign-in.
3. Transfer the validated class to production using Cloudflare's documented four-deploy `exports`
   transfer. The restored class alias must be one production has never provisioned:
   1. the source Worker deploys the class as a live `exports` entry;
   2. production deploys `{"state": "expecting-transfer", "storage": "sqlite", "transfer_from":
      "<source worker>"}` for that class, **without** a `durable_objects.bindings` entry;
   3. the source deploys `{"state": "transferred", "transferred_to": "family-board-production"}`,
      at which point Cloudflare matches the pending transfer and atomically reassigns the
      namespace;
   4. production deploys the binding plus a plain live `exports` entry.

   Both Workers must be in the same account, and a target Worker can hold only one pending
   phase-1 hint per class at a time.
   [Class transfer procedure](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
4. Keep the server-fixed object name `household`; nothing in the code chooses another.
5. Remove or disable the source import Worker.
6. Smoke-test production, then reopen writes.
7. Keep the old production class and namespace **unbound and intact** until the new one has been
   in use long enough to trust.

Rehearse the whole transfer on two disposable Workers before recording it as operable. Never add an
import route to the live production Worker.

## Accounts, invitations, and the allowed list

The allowed-email list is the access control; the invitation is only the way in. Both are the
owner's, and the order matters.

- Add an address to the allowed list **before** issuing its invitation. The list holds 1 to 7
  addresses and must always contain the owner's.
- Share an invitation code through a channel where you have verified who is on the other end — in
  person, or a voice call you initiated. The system sends no email, by design.
- **Removing an address ends access immediately on every device** and clears that person's card
  assignments, but it does **not** free their seat. The account row and its seat survive.
- **Deactivating a member frees the seat** and is irreversible for that account.
- Seven active users including the owner. An eighth is refused inside the activating transaction.

## Lost recovery phrase

Follow [the lost-phrase rescue runbook](operator-lost-phrase-reset.md) exactly. It already carries
what this stage requires of it: offline identity verification before anything is generated;
`scripts/create-operator-reset-token.ts` run locally with `RECOVERY_DIGEST_KEY` on stdin; only a
digest, user id, epoch and expiry inserted, never the token; the one-time token delivered through
the verified channel; redemption observed, with every old session, the old password and the old
phrase invalidated and a new phrase confirmed; and an audit note that records the token's row id
but never the token. There is no manual plaintext password change in the database, and there is no
email reset path.

It has been proven repeatedly against the **test** Worker and has never been run against
production. Rehearsing it there is on the release checklist below.

## Stage 7 release checklist

Done in this change, and verifiable without Cloudflare:

- [x] Export, import, envelope, canonical serializer, integrity rules, restore marker
- [x] `scripts/backup.ts` create / verify / list / restore, with retention
- [x] Security headers, CSP, shell `no-store`, operator-route isolation
- [x] `npm run lint`, `npm run typecheck`, `npm run check:links`, `npm run check:i18n`, `npm test`
- [x] CI proves the import route is absent from the production bundle and present in the restore one
- [x] Full local round trip against `wrangler dev`: export → encrypt → decrypt → import → sign in

Done on the deployed production Worker, 2026-09-13, on the owner's explicit instruction — see
[the production deployment record](production-deployment.md):

- [x] Deploy Stage 7 to production (code `37752249-68a9-48d3-bc3d-2895bc0f8bc2`, now serving as
      `5d099a34-3480-4fc5-89cb-ec779a94ea39` after the secret change re-versioned it; no migration,
      so the rollback is a version redeploy), provision `BACKUP_OPERATOR_SECRET` there, and
      confirm `BACKUP_HOUSEHOLD_ID` (`goal-tracker-production`, read from the deploy output)

The export route was proven to authenticate once, with the response body discarded unread. That is
proof of a working credential, not a backup.

Outstanding, and each needs the deployed Free runtime:

- [ ] Provision `BACKUP_OPERATOR_SECRET` in `test`, then run the whole round trip against the
      deployed test Worker with disposable accounts
- [ ] Measure a maximum-size export — 500 cards, 20 columns, 4,000-code-point multilingual
      descriptions — and record response bytes, export time, import time, SQL rows and DO duration
      against the Free limits above
- [ ] Rehearse the lost-phrase rescue against a deployed Worker
- [x] Take and verify the **first encrypted production backup** — done 2026-09-13,
      `goal-tracker-production-2026-09-13-schema4-1f0ac18e.backup.enc`, schema 4, board revision 19,
      digest `d56aa774755679e1…`. Verified by decrypting it back off the disk, and separately
      confirmed to carry the owner's password hash, the recovery digest and the allowed list.
      **It shares a laptop with its own key, so it is a second copy and not yet a redundant one.**
- [x] Run one full drill that restores that production copy into a fresh isolated namespace, then
      destroy it — done 2026-09-13 on `family-board-restore-2026-09`, deleted in the same sitting.
      The restored household re-exported byte-identically to the backup. **A successful sign-in was
      not performed**: this session did not hold the owner's password, and the hash is one-way. See
      [the production deployment record](production-deployment.md).
- [ ] Move the escrowed secrets off the single laptop
- [ ] Confirm whether point-in-time recovery is available on this Free account
- [ ] Record the release version, schema version, measurements and terms checked in
      `docs/stage-7-completion.md`, and only then archive the stage plan

Until every box above is ticked, Stage 7 is not closed. Production **is** backed up as of
2026-09-13, and that copy has been restored into a deployed Worker — but the boxes that remain are
what stand between "a backup exists" and "recovery is proven and survives this laptop".
[The Stage 7 status record](stage-7-status.md) explains each one and suggests an order.

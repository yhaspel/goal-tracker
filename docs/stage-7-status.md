# Stage 7 status — backup, hardening, and release

**Date:** 2026-09-13 (Asia/Jerusalem)
**Plan:** `development-plans/stage-7-backup-hardening-release.md` — **not archived**
**Code:** commit `9c10e19`, CI
[34775711046](https://github.com/yhaspel/goal-tracker/actions/runs/34775711046)
**Production:** version `5d099a34-3480-4fc5-89cb-ec779a94ea39` (code upload
`37752249-68a9-48d3-bc3d-2895bc0f8bc2`, re-versioned by the secret change)

**Stage 7 is not closed.** This is a status record, not a completion report — there is deliberately
no `docs/stage-7-completion.md`, because the plan's release checklist says to write one *"and only
then archive the stage plan"*, and the gate has not passed. The plan stays in
`development-plans/` where an unfinished stage belongs.

Its exit gate reads: *"Stage 7 is complete only after the actual Free deployment passes the entire
master plan's exit criteria, including manual lost-phrase rescue and a restore from an encrypted
copy."* The restore from an encrypted copy **was** done against a deployed Worker. The **manual
lost-phrase rescue was not**, and neither was a successful sign-in on a restored household.

This document exists so that work can be picked up later without reconstructing it from chat
history: what is done and proven, what is not, and what to do next.

## What is done and proven

### Code and tests

The backup envelope with a canonical serializer (sorted keys, no insignificant whitespace) and a
SHA-256 taken over the canonical payload and nothing else; household integrity rules; a coherent
synchronous export; a pristine-target import; the bearer-authenticated operator routes; the
encrypted local backup CLI with retention; and the security headers. **14 test files, 150 tests**,
all passing, against a pre-Stage-7 baseline of 12 and 125. `lint`, `typecheck`, `check:links`,
`check:i18n` and `npm audit --audit-level=moderate` (0 vulnerabilities) all clean.

Schema stays at **version 4**. Stage 7 adds no migration: the restore-only `restore_import_marker`
table is created by the import handler, so production never grew a table it must not have and every
schema-4 backup stays compatible with its restore target.

### Isolation of the import route, proven three ways

The import route lives only in the restore build, via the build-time `__ENABLE_RESTORE_IMPORT__`
define rather than a runtime branch.

| Proof | Result |
| --- | --- |
| Local `--dry-run` bundle greps, against `index.js` and not the sourcemap | `operator/import` and `restore_import_marker` absent from production; `operator/export` present; `operator/import` present in restore |
| CI, as four named steps in the `checks` job | All pass, and the build fails if the route ever appears in production's bundle or vanishes from restore's |
| `POST /api/v1/operator/import` against the **deployed** production and test Workers | `404` on both — absent from the running Workers, not merely from the bundle |

### Deployed to production

Deployed by hand on the owner's explicit instruction. No migration, no asset change (Stage 7
touches nothing under `web/src`), no production data created, modified or deleted. Verified
read-only afterwards: `no-store` on all eight SPA routes; the `default-src 'none'` CSP with
`frame-ancestors 'none'`, `X-Frame-Options: DENY`, COOP and CORP on documents and assets; `nosniff`,
`Referrer-Policy: no-referrer` and `Strict-Transport-Security: max-age=31536000` on every response;
assets correctly **not** `no-store`; and `operator/export` answering an identical `404` to a missing
and a wrong bearer. Full tables in [the production deployment record](production-deployment.md).

`BACKUP_OPERATOR_SECRET` was provisioned in production and proven to authenticate once, with the
response body discarded unread.

### The first production backup, and a real restore

`goal-tracker-production-2026-09-13-schema4-1f0ac18e.backup.enc` — schema 4, board revision 19,
digest `d56aa774755679e1…`, taken `2026-09-13T19:25:43.293Z`. Verified by decrypting it back off the
disk, confirmed to be genuine ciphertext, and confirmed to carry the owner's password hash with its
own scrypt parameters and salt, the recovery digest bound to that user, and the allowed-email list.

It was then **restored into a deployed Cloudflare Worker** (`family-board-restore-2026-09`,
created and destroyed in the same sitting) and the restored household **re-exported
byte-identically** to the copy on disk — every field but the new export's own `createdAt`, down to
the same 2,318 bytes. The refusals behaved too: `409 restore_target_not_pristine` on a second
import, bootstrap closed, no session survived, and a wrong password against the real owner address
answering `401` rather than `500`, which is what shows the stored scrypt record was parsed and
re-derived against rather than restored corrupt.

That satisfies the plan's *"restore from an encrypted copy"* criterion against a real deployed
object. It is the single strongest piece of evidence this stage has produced.

### Defects found and fixed

- **`create()` pruned before it checked integrity.** A run producing a copy `importBackup` would
  refuse still deleted an older clean one, because retention pins the newest copy without knowing
  whether a restore would accept it. Repeated weekly, every retained copy but the month's oldest
  ends up unrestorable. The gate now runs first and a failed household prunes nothing.
  `tests/backup-retention.test.ts` pins the mechanism.
- **A trailing newline in `BACKUP_OPERATOR_SECRET` would have broken it silently.** `authorize()`
  compares the value verbatim and the bearer pattern is `Bearer\s+(\S+)`, so a stored newline makes
  every caller wrong while the route answers the same `404` it gives everyone. The runbook's
  provisioning snippet used a plain `>` redirect; it now strips the newline and explains why.
- **The restore drill could not be run as written.** It said to keep `workers_dev: false` while
  importing over HTTPS, but the standing `restore` Worker has no hostname and no routes, so there
  was nothing to POST to.
- **The drill's teardown instruction was wrong.** It named a `deleted` tombstone in the `exports`
  map, which `wrangler` rejects; tombstones belong to the older `migrations`/`deleted_classes`
  syntax this configuration does not use. Deleting the Worker is the mechanism.

The first two came from an adversarial audit that raised thirteen findings, twelve of which did not
survive two independent refuters. The last two were found by following the runbook.

## What is not done — why the stage is still open

| Gate item | State |
| --- | --- |
| **Manual lost-phrase rescue against a deployed Worker** | **Not done.** Named explicitly in the exit gate. The rescue runbook exists and the local token generator works, but the flow has never been exercised end to end on a deployed object |
| **A successful sign-in on a restored household** | **Not done.** The hash is one-way, so this needs whoever holds an account's password. The drill proved the credential survived intact and that verification runs against it, not that a correct password completes a login |
| **Recovery-phrase verification on a restored object** | **Not done.** Needs a real phrase, and the drill deliberately used a throwaway `RECOVERY_DIGEST_KEY` rather than putting production's on a public hostname for a check it could not perform |
| **Maximum-size export measurement** | **Not done.** 500 cards, 20 columns, 4,000-code-point multilingual descriptions, measured against the Free limits for response bytes, export and import time, SQL rows and DO duration |
| **`BACKUP_OPERATOR_SECRET` in `test`, and the round trip there** | **Not done.** The production round trip was done instead, which is stronger evidence about the copy that matters but leaves test unexercised |
| **Secrets and the backup key moved off the single laptop** | **Not done.** See the risk below |
| **Point-in-time recovery on the Free plan** | **Unverified.** The Durable Objects pricing page does not list it among Free features. Until someone obtains a bookmark from a deployed object it is not a recovery plan; the encrypted copies are |
| **A weekly backup cadence** | **Not established.** Exactly one backup exists. The runbook documents the weekly command; nothing runs it on a schedule |

## The largest remaining risk, which is not a code defect

**The encrypted copy and the AES key that decrypts it are on the same laptop**, along with
`.secrets.production.env`, which holds production's `RECOVERY_DIGEST_KEY`, `CSRF_SECRET` and
`RATE_LIMIT_KEY`. That pair is a second copy of the data but not a second *place*. If the machine
is the disaster, the backup dies with it and the recovery-phrase digests become unverifiable.

Of the escrowed values, only two are unrecoverable: the AES backup key and `RECOVERY_DIGEST_KEY`.
Losing the first makes every stored copy permanently unreadable. Losing the second stops every
recovery phrase in a restored household from verifying, which leaves the operator rescue as the
only route back — for every account at once.

Carrying the `.enc` file and the key to a second location and running
`node scripts/backup.ts verify` there would settle the data half in a few minutes.

## A trap with a long fuse — **defused on 2026-09-14**

> The import demands exact schema equality — `409 schema_mismatch` — and there is **no upgrade path
> for an old payload**. Every stored copy today is schema 4, restorable by any build from `9c10e19`
> onward while `SCHEMA_VERSION` is still 4.
>
> The moment a migration 5 lands, those copies can only be restored by checking out a schema-4 commit
> first, and nothing in the filename, the envelope or the backup directory records which commit that
> is. Whoever lands migration 5 should either add a payload upgrade path or write the pin down beside
> the copies.

That warning was correct, and the fuse burned. Migration 5 landed with Stage 8 **without** the
upgrade path, so for a short window the only backup of production genuinely could not be restored by
the build that was about to be deployed. It was caught by the Stage 8 production pre-flight on
2026-09-14, before any deploy, and fixed: the import now accepts schema
`MIN_IMPORTABLE_SCHEMA_VERSION` (4) through the target's own, and refuses only newer. The schema-4
copies restore into a schema-5 build directly, proven against a deployed drill Worker.

The text above is left standing rather than rewritten, because it is the clearest evidence in this
repository that writing a hazard down works: the note is what made the defect findable, and the
failure was not the warning but landing the migration without reading it.

Two things it did not anticipate, both now handled:

- **The backup CLI had the mirror of the same bug.** It required the Worker to emit the tool's own
  format version, so once the tool moved to format 2 it refused to back up any deployment still
  running format 1 — production included. A tool that cannot back up the deployment you are about
  to upgrade is worse than the import bug, because it fails *before* there is a copy.
- **A rolled-back Worker writes a coherent-looking, silently empty backup.** `migrate()` reports
  `MAX(version)` from `schema_migrations`, which does not fall when the code does, so old code on a
  newer database emits the old format beside the new schema — a copy missing every row that code
  cannot see, which would import as a clean success. That pairing is now refused at parse time.

## Follow-up

The operational home for this work is the Stage 7 release checklist in
[the operator runbook](operator-runbook.md#stage-7-release-checklist); its boxes are deliberately
left open. Suggested order, most valuable per unit of effort first:

1. **Move the backup key and `.secrets.production.env` off the laptop**, separately from the
   copies. Largest risk, smallest effort, needs no deployment and no drill.
2. **Verify a copy from a second machine** — `node scripts/backup.ts verify` there. Proves the
   off-machine path end to end rather than assuming it.
3. **Finish the drill's last step on the next run.** Stand the drill Worker up again, sign in to the
   restored household with a real password, and exercise `/api/v1/recovery/phrase/start` with a
   real phrase and production's digest key. One sitting closes both functional gaps.
4. **Rehearse the lost-phrase rescue** against that same drill Worker. This is the named exit-gate
   item, and doing it in the same sitting as 3 reuses the whole setup.
5. **Establish the weekly backup cadence**, or decide explicitly that backups stay manual and write
   that down.
6. **Measure a maximum-size export** before the household grows enough for it to matter.
7. **Confirm point-in-time recovery** on this Free account, and record the answer either way.

Items 3 and 4 together are what would let Stage 7's gate actually pass. When it does, write
`docs/stage-7-completion.md`, tick the checklist, move
`development-plans/stage-7-backup-hardening-release.md` into `development-plans/archived/`, and
repair the references.

Until then the standing rule holds: **Stage 8 must not reach production before Stage 7's gate
passes.**

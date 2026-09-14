# Stage 7 — backup, hardening, and release

**Date closed:** 2026-09-14 (Asia/Jerusalem)
**Closed by:** owner decision, on an attestation — **not** by every gate item being independently proven. Read "What rests on the owner's attestation" before relying on this.
**Plan:** `development-plans/stage-7-backup-hardening-release.md` → archived on closing
**Predecessor record:** [the Stage 7 status record](stage-7-status.md), which stays for the history it holds

Stage 7's exit gate reads: *"Stage 7 is complete only after the actual Free deployment passes the
entire master plan's exit criteria, including manual lost-phrase rescue and a restore from an
encrypted copy."*

Of its two named items, **one is proven with deployed evidence and one is not.** This document says
which is which, so that nobody later reads "closed" as "all of it was checked".

This mirrors how Stage 6 was closed: by an explicit owner decision with the residual risk named,
rather than by the gate passing on its own terms. See [the Stage 6 completion report](stage-6-completion.md).

## Proven, with deployed evidence

### Restore from an encrypted copy — twice, and the second time across a schema change

**2026-09-13.** `goal-tracker-production-2026-09-13-schema4-1f0ac18e.backup.enc` was restored into
a deployed Cloudflare Worker (`family-board-restore-2026-09`, created and destroyed in one sitting)
and the restored household re-exported **byte-identically** — every field but the new export's own
`createdAt`, down to the same 2,318 bytes. Recorded in [the production deployment record](production-deployment.md).

**2026-09-14.** A fresh copy, `goal-tracker-production-2026-09-14-schema4-f18da17f.backup.enc`
(schema 4, board revision 19), was restored into a deployed **Stage 8** drill Worker — that is,
**across the migration-5 schema change** — and validated field by field by script rather than by
eye: **22 of 22 checks**, including

- every user identical, **password hash included**;
- every recovery digest identical;
- the allowed-email list, invitations and columns identical;
- every card identical once the two new columns are set aside, and both of those `null`;
- `boardState.revision` 19 preserved;
- the restored household passing its own integrity rules;
- no session surviving; bootstrap closed; `/board` and `/members` `401`;
- a wrong password against the real owner address answering `401`, not `500` — which is what shows
  the stored scrypt record was parsed and re-derived against rather than restored corrupt.

Both drill Workers were destroyed in the same sitting, and their hostnames verified to answer `404`.

### The other deployed recovery flows

`scripts/recovery-smoke.ts` against the deployed test Worker: **23 of 24**, covering self-service
phrase recovery, the signed-in credential change, session revocation on rotation, replay refusal,
and the refusals (foreign origin, unknown address, no email-reset endpoint). The one failure was an
operator error in invoking the script — the recovery digest key was piped where the script expects
a raw operator reset token, and the API correctly refused an invalid token.

### Everything the status record already proved

Import-route isolation proven three ways; the security headers; `BACKUP_OPERATOR_SECRET` in
production; the encrypted CLI with retention; and the four defects found and fixed during Stage 7.
All still stands — see [the status record](stage-7-status.md).

## What rests on the owner's attestation

**The manual lost-phrase rescue against a deployed Worker has not been independently verified, and
was not verified while closing this stage.** It is the item the exit gate names by name.

On 2026-09-14 the owner stated: *"I've already checked the account recovery process and it works."*
Stage 7 is closed on that statement.

Two things must be said plainly about it:

1. **This codebase has three distinct recovery flows**, and the sentence does not say which was
   checked: self-service phrase recovery (`/recover` with a saved 12-word phrase), the signed-in
   credential change (`/account`), and the **operator lost-phrase rescue** — a token an operator
   inserts by hand through Durable Object Data Studio after verifying the person offline, which is
   the flow the gate names. The first two are covered by the deployed smoke evidence above. The
   third is not.
2. **It could not have been verified by this session.** The operator rescue requires inserting a
   row into a deployed Durable Object through the Cloudflare dashboard's Data Studio, which is a
   manual browser action. The mechanism is covered by Workers-runtime tests (`tests/recovery.test.ts`
   with the `insertOperatorToken` helper, which inserts exactly the SQL
   [the rescue runbook](operator-lost-phrase-reset.md) tells an operator to paste), and the local
   token generator works — but that is mechanism proof, not a deployed rehearsal.

**If the owner's check was of self-service phrase recovery rather than the operator rescue, then
the named gate item remains unproven and this closure rests on less than it appears to.** Anyone
picking this up should establish which was meant before treating the operator rescue as exercised.

## Still not done, and not covered by the attestation either

Closing the stage does not make these true. Carried forward from
[the status record](stage-7-status.md):

| Item | State |
| --- | --- |
| A successful sign-in on a restored household | **Not done.** The hash is one-way, so it needs whoever holds a real password. The drill proved the credential survived byte-identically and that verification runs against it |
| Recovery-phrase verification on a restored object | **Not done.** Needs a real phrase and production's digest key on a drill Worker |
| **Secrets and the backup key off the single laptop** | **Not done.** The largest remaining risk, and the smallest effort — see below |
| Maximum-size export measurement | **Not done** for Stage 7's shape; Stage 8 measured its own caps, recorded in [the Stage 8 completion report](stage-8-completion.md) |
| `BACKUP_OPERATOR_SECRET` in `test`, and a round trip there | **Not done.** Every operator route on test still answers `404`, verified 2026-09-14 |
| Point-in-time recovery on the Free plan | **Unverified.** Not listed among Free features; the encrypted copies are the recovery plan |
| A weekly backup cadence | **Not established.** There are now two copies rather than one, both taken by hand. Nothing runs on a schedule |

### The largest remaining risk is unchanged

**The encrypted copies and the AES key that decrypts them are on the same laptop**, along with
`.secrets.production.env`. That is a second copy of the data but not a second *place*. Of the
escrowed values only two are unrecoverable: the AES backup key, whose loss makes every stored copy
permanently unreadable, and `RECOVERY_DIGEST_KEY`, whose loss stops every recovery phrase in a
restored household from verifying — leaving the operator rescue as the only route back, for every
account at once.

Carrying a `.enc` file and the key to a second location and running `node scripts/backup.ts verify`
there would settle the data half in a few minutes. **It is still the highest-value unfinished work
in this project.**

## Defects found while closing

Two were found by walking the deploy sequence rather than reasoning about it, and both would have
left production with no working recovery path. A third came from an adversarial audit.

1. **The importer demanded exact schema equality**, so the only backup of production — schema 4,
   written by the build that was live — could not be restored into schema-5 code. Verified, not
   inferred: `409 schema_mismatch`. [The status record](stage-7-status.md) predicted this exactly
   and asked whoever landed migration 5 to add an upgrade path; migration 5 landed without one.
2. **The backup CLI refused to back up production**, because it required the Worker to emit the
   tool's own format version. The whole reason to back up before an upgrade is that the deployment
   has not been upgraded yet. Together with (1), a deploy that day would have had no fresh backup
   and an unreadable old one.
3. **A rolled-back Worker writes a coherent-looking, silently empty backup.** `migrate()` reports
   `MAX(version)` from `schema_migrations`, which does not fall when the code does, so old code on a
   newer database emits the old format beside the new schema — missing every row that code cannot
   read — and it would have imported as a clean success while retention pruned the good copies.

All three are fixed and pinned by `tests/production-restore-path.test.ts`. Details in
[the Stage 8 completion report](stage-8-completion.md).

## Follow-up, in the order worth doing it

1. **Move the backup key and `.secrets.production.env` off the laptop**, separately from the copies.
2. **Verify a copy from a second machine.**
3. **Establish which recovery flow the 2026-09-14 attestation covered**, and rehearse the operator
   lost-phrase rescue against a drill Worker if it was not that one.
4. **Sign in to a restored household** with a real password, and exercise phrase recovery there with
   production's digest key — one sitting closes both.
5. **Establish a weekly backup cadence**, or decide explicitly that backups stay manual and write
   that down.
6. **Confirm point-in-time recovery** on this Free account, and record the answer either way.

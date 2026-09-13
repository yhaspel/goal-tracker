# Stage 3 completion — recovery and manual rescue

**Date:** 2026-09-13 (Asia/Jerusalem)
**Plan:** [archived Stage 3 plan](../development-plans/archived/stage-3-recovery-manual-rescue.md)
**Decision:** **Complete.** Stage 3's exit gate passed on the deployed Free test Worker,
including the one check that needed a Cloudflare-account operator: the lost-phrase rescue
redeemed against the actual deployed Durable Object through Data Studio. No production
account, secret, or data was created.

## Tested version

| Item | Value |
| --- | --- |
| Recovery API implementation commit | `c9c56db` (`c9c56db03abcb3b0092f25c92d5fc706fdb17862`) |
| Smoke-script fix commit | `4cefa7f` — pointed the operator-rescue leg at `members[3]`, an identity none of the script's own earlier steps rotate |
| Commit the gate was last confirmed against | `e90b65a` |
| CI run | [34751848731](https://github.com/yhaspel/goal-tracker/actions/runs/34751848731) — `checks: success`, `deploy-test: success` |
| Deployed version ID | `86d659ef`, confirmed live at 100% traffic in the Cloudflare dashboard |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Deployed schema version | 4, confirmed by `python3 scripts/verify_stage_1.py <host> routing` |

## Commands

```sh
npm ci && npm run lint && npm run typecheck && npm run check:links && npm run check:i18n && npm test
python3 scripts/verify_stage_1.py https://family-board-test.yuval3000.workers.dev routing
umask 077
node scripts/create-operator-reset-token.ts \
  --user-id <id> --epoch <credential_epoch> \
  --operator "stage-3-gate" --reason "deployed runbook rehearsal" \
  < .secrets.test-recovery-key
node scripts/recovery-smoke.ts https://family-board-test.yuval3000.workers.dev < <token-file>
```

All five checks above were re-run clean against commit `e90b65a` in this session: lint,
typecheck, `check:links`, `check:i18n`, and the full suite at **116 of 116 tests passed**
across 12 files.

## What was delivered this session

Stage 3's implementation, migration, routes, and local test coverage were already complete and
unchanged; nothing in `worker/src` was touched. This session closed the one exit-gate check
that needed a Cloudflare-account operator and a real dashboard session:

- Followed [`docs/operator-lost-phrase-reset.md`](../docs/operator-lost-phrase-reset.md)
  exactly, end to end, against the deployed `family-board-test` Durable Object — once for a
  successful redemption and once for a revocation.
- Looked up `members[3]` (an identity none of the other smoke scripts touch) in Data Studio,
  generated a token locally with the environment's escrowed `RECOVERY_DIGEST_KEY`, and inserted
  the generated `INSERT`, confirming exactly one row with the generated `SELECT` — exactly as
  the runbook specifies. The raw token was written straight to a mode-600 file by a redaction
  step and never appeared in any visible output; it was used once and deleted.
- Redeemed it inside the 15-minute window with `scripts/recovery-smoke.ts`, which reported
  **28 of 28 checks passed**: the saved-phrase and signed-in flows, plus — for the first time
  against a deployed Worker — the full operator leg (the token starts a rescue, the rescue
  commits, the pre-rescue password fails, the rescued password works, the consumed token cannot
  be reused).
- Confirmed the redeemed row's audit trail with the runbook's step-7 query: `consumed_at` set,
  `expected_credential_epoch` unchanged at `1`.
- Went beyond the automated script to close a gap it does not cover: generated a second token
  (epoch `2`, after the first redemption had advanced it), revoked it with the runbook's step-6
  `DELETE … WHERE consumed_at IS NULL`, confirmed the row was gone, and confirmed a direct
  redemption attempt against the now-revoked token was refused `403 recovery_failed` — the same
  generic refusal a consumed or unknown token gets, so a caller learns nothing from the
  difference. The originally redeemed row's `consumed_at` was unaffected by this second check.

## Finding: the smoke script's own operator leg was miscoded

Before generating any live token, reading `scripts/recovery-smoke.ts` showed its operator-rescue
step reused `subject` (`members[1]`) — the identity the script's own earlier steps (phrase
regeneration, password change, saved-phrase recovery) rotate three times. A token generated
against that identity's epoch before the run would already be stale by the time the operator
step executed, so the leg would fail regardless of whether the deployed rescue flow itself
worked: a false negative baked into the harness, not a product defect. `docs/operator-lost-phrase-reset.md`
and `worker/src` were both already correct. A fix — a separate, untouched
`operatorSubject = members[3]` — was written and verified locally, then found already committed
(`4cefa7f`) before it was needed live; two independent readings of the same code reached the
same fix. The committed version is what ran and passed.

## Acceptance evidence

| Exit-gate condition | Evidence |
| --- | --- |
| Saved-phrase recovery rotates password and phrase, revokes sessions, requires a fresh login | `tests/recovery.test.ts` (local); deployed smoke this session, 28/28 |
| Signed-in password change and phrase-only regeneration behave per contract | `tests/recovery.test.ts` (local); deployed smoke this session |
| A correctly inserted operator token works once and expires in 15 minutes | Deployed this session: generated, inserted, redeemed inside the window, reuse refused |
| Wrong, expired, and wrong-user tokens cannot start or complete a reset | `tests/recovery.test.ts` (local only) |
| A **consumed** token cannot be redeemed again | Deployed this session, live: `403 recovery_failed` |
| A **revoked** token (runbook step 6) cannot be redeemed | Deployed this session, live, for the first time: `DELETE` then `403 recovery_failed` on redemption attempt — previously only the equivalent never-inserted-token case had been exercised locally |
| Two concurrent confirmations of one token yield exactly one success | `tests/recovery.test.ts` (local only, see Limitations) |
| Removing a member's email revokes pending rotations and unused operator tokens | `tests/recovery.test.ts` (local only, see Limitations) |
| Operator can follow the documented SQL rescue without reading or changing plaintext credentials | Confirmed live: only the token's HMAC digest ever appeared in SQL; the raw token was written to a private file and never displayed |
| No secret in logs, SQL exports, browser storage, URLs, or error bodies | `tests/recovery.security.test.ts` (local); deployed responses and SQL inspected directly this session showed only digests, ids, and status codes |

## Limitations

- All deployed evidence comes from the isolated `test` Worker and disposable identities. No
  production owner, secret, or user data exists.
- Concurrent-confirmation racing for the operator flow (two simultaneous confirmations of one
  token) is covered by `tests/recovery.test.ts` against a local Durable Object only; it was not
  re-raced against the deployed Worker, since doing so live needs two tokens contending inside
  the same 15-minute window and would add little beyond what the local test already proves
  under real Workers-runtime transaction semantics.
- The allowed-list-removal cascade (revoking pending rotations and unused operator tokens when
  an email is removed) is covered locally only, to avoid disturbing the disposable household's
  allowed list mid-run.
- Internal Durable Object CPU time and peak memory remain unquantified, for the reason Stage 1
  and Stage 2 recorded: a deployed Worker freezes its timers between I/O.

## Rollback

Revert faulty route code while retaining the additive `pending_credential_rotations` and
`operator_reset_tokens` tables, or rebuild the disposable test object from fixtures. An app-code
rollback must not restore old credential data or re-enable a consumed or revoked token. Repair
test data with a tested migration or reset the disposable object; never apply that reset to a
production Durable Object.

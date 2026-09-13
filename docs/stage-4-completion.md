# Stage 4 completion — board API

**Date:** 2026-09-13 (Asia/Jerusalem)
**Plan:** archived Stage 4 plan (`development-plans/archived/stage-4-board-api.md`)
**Decision:** **Complete.** The board API's exit gate passed on the deployed Free test Worker.
No production account, secret, or data was created.

## Tested version

| Item | Value |
| --- | --- |
| Board API commit | `1b3fc04` |
| Commit the gate was last confirmed against | `6aae5b6` (`6aae5b695484088d514c83af81375337ba70fd5f`) |
| CI run | [34749133629](https://github.com/yhaspel/goal-tracker/actions/runs/34749133629) — `checks: success`, `deploy-test: success` |
| Deployed version ID | `0719da20-9c2c-4598-81a3-a74116c2306d`, printed by the `deploy-test` job and confirmed live |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Deployed schema version | 4, confirmed by `python3 scripts/verify_stage_1.py <host> routing` |

## Commands

```sh
npm ci && npm run lint && npm run typecheck && npm run check:links && npm run check:i18n && npm test
python3 scripts/verify_stage_1.py https://family-board-test.yuval3000.workers.dev routing
node scripts/board-smoke.ts https://family-board-test.yuval3000.workers.dev
```

## What was delivered

- **Migration version 4**: `board_state`, `columns`, and `cards` with checks, references, and
  indexes, seeding the three built-in columns once with fixed ids. A re-run leaves existing
  names, cards, and the revision untouched.
- **`worker/src/board/`**: `repository.ts` for typed synchronous SQL, `service.ts` for
  ordering, validation, and the revision guard.
- **`worker/src/routes/board.ts`**: the board read plus column and card mutations, each in one
  short synchronous transaction.
- **Membership integration** in `auth.ts`, `members.ts`, and `allowed-emails.ts`.
- **Front Worker**: per-route body caps, so a 4,000-code-point description fits in 64 KiB
  without loosening the 16 KiB auth limit.
- **Tests**: `tests/board.test.ts` and `tests/board.concurrent.test.ts`.
- **`scripts/board-smoke.ts`** for the deployed environment.

## Acceptance evidence

`scripts/board-smoke.ts` reported **39 of 39 checks passed** against the deployed test Worker,
twice: once against the deployment serving the Stage 4 code, and again against the final
commit above. It covers a card create, a cross-column move, a conflicting stale move, an
allowed-list removal that clears assignments, a deactivation that clears assignments, and the
restoration of the seventh seat afterwards. It deletes the cards it created.

| Exit-gate condition | Evidence |
| --- | --- |
| Three built-in columns in order; a re-run or redeploy does not duplicate them | `tests/board.test.ts`; the deployed board still shows exactly three seeded columns after five redeployments |
| Owner can create, rename, move, and delete an empty column; a member gets 403 for all four | `tests/board.test.ts` |
| Deleting a non-empty or last column returns 409 without moving or deleting cards | `tests/board.test.ts` |
| Any active, allowlisted member can create, edit, assign, unassign, move, and delete cards | Deployed board smoke; `tests/board.test.ts` |
| Invalid lengths, types, unknown ids, extra fields, out-of-range indices, and ineligible assignees fail without writes | `tests/board.test.ts` asserts the revision never moves across eight rejection cases |
| 501st card and 21st column are refused | `tests/board.concurrent.test.ts`, seeding to the boundary |
| Exactly one revision-guarded mutation succeeds per old revision; the loser gets 409 with `details.boardRevision` and no partial write | `tests/board.concurrent.test.ts` for simultaneous moves, edit-versus-delete, and rename-versus-reorder; deployed board smoke for the stale move |
| Activation and deactivation each advance the revision once; an allowed-list update advances it once when eligible active members change, and not at all otherwise | `tests/board.test.ts`; deployed board smoke checks the exact expected revision after each |
| Assignment versus deactivation never leaves a card assigned to an ineligible member | `tests/board.concurrent.test.ts` races the two and asserts the committed state either refused the assignment or cleared it |
| After randomised sequences: unique ids, one valid column per card, dense positions, one revision per state-changing request | `tests/board.concurrent.test.ts` runs 30 seeded operations and re-checks every invariant after each |
| Anonymous, removed-from-list, and expired-session reads and writes return 401; missing Origin or CSRF is refused; unknown `/api/v1/` paths return JSON 404 | `tests/board.concurrent.test.ts`; deployed board smoke |

## Measured behaviour

**Foreign keys are enforced by default** in the Durable Object runtime: `PRAGMA foreign_keys`
reports 1 and inserting a card with a bogus `column_id` fails with
`SQLITE_CONSTRAINT_FOREIGNKEY`. No explicit enable is needed, and `tests/board.test.ts` pins
this so a runtime change would be caught.

**Rows written per reorder**, measured by counting cards whose `updated_at` changed:

| Operation | Rows written |
| --- | --- |
| Adjacent swap within a column | 2 |
| First to last within a column of six | 6 |
| Cross-column move out of a column of six | 6 |
| Move appended to the end of another column | 1 |

Only cards that actually change position are rewritten. The worst case for one move is
therefore bounded by the size of the source column plus the destination column, so at most 500
rows under the card cap — comfortably inside the Free plan's 100,000 rows written per day for
a seven-person board. Stage 7's usage review should confirm this against real traffic.

## Deviations from the plan as written

- The plan named the `400` code `validation_error`. Stage 2 had already shipped and deployed
  `invalid_request` for the same condition, with per-field detail in `details.fieldErrors`, and
  the master plan requires consistent errors. Board routes therefore use `invalid_request` too,
  and the Stage 4 plan records that reconciliation inline rather than leaving Stage 5 to branch
  on two spellings of one condition. No other code changed.
- The three seeded columns use fixed UUIDs rather than generated ones. They are opaque,
  addressable only inside one household's Durable Object, and being fixed makes them maximally
  stable, which is what the plan asks for.

## Limitations

- All evidence comes from the isolated `test` Worker with disposable identities.
- The 500-card and 20-column caps were exercised by seeding rows directly to the boundary
  rather than by creating 500 cards through the API.
- Internal Durable Object CPU time and peak memory remain unquantified, for the reason Stage 1
  recorded: a deployed Worker freezes its timers between I/O.
- On 2026-09-13 a deployment of this stage took roughly 25 minutes to reach the edge while
  Cloudflare's API reported it live at 100%. See the [execution log](stages-2-6-execution-log.md)
  for the evidence and what was tried. Later deployments propagated within seconds.

## Rollback

Revert faulty route code while retaining the additive migration, or rebuild the disposable test
object from fixtures. If reverting to Stage 2 or Stage 3 code, temporarily disable member
deactivation **and** allowed-list replacement until their atomic assignment clearing is
restored, so no card can stay assigned to an ineligible member. Repair test data with a tested
migration or reset the disposable object; never by deleting cards or resetting `boardRevision`
by hand.

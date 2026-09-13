# Stage 4 — Board API

**Status:** Implementation-ready subplan  
**Parent:** [Family Kanban Board master plan](personal-business-goals-dashboard-master-plan.md), Stage 4  
**Prerequisite:** Stage 3 exit gate passed and its schema migration version 3 applied after Stage 2. Stage 4's migration version 4 must not deploy before version 3; board API code may be drafted in parallel only after the Stage 2/3 shared contracts are frozen. Stages 1–6 use disposable accounts in an isolated Free test environment; production initialization waits for Stage 7 backup tooling.  
**Outcome:** One reliable shared board API with owner-managed columns, member-managed cards, active-member assignment, and transaction-safe reordering.

## Scope and invariants

There is exactly **one board** in one named SQLite-backed Durable Object. All active, currently allowlisted members can read the board and create, edit, assign, move, or delete cards. Only the owner can create, rename, reorder, or delete columns; column deletion requires the column to be empty and at least one other column to remain. The initial columns are To Do, In Progress, and Done. Built-in names are returned as translation keys until renamed; a renamed name remains literal in every language. No goals, private boards, checklists, labels, due dates, attachments, or sockets enter this stage.

All IDs are opaque UUIDs, timestamps are UTC ISO strings, positions are zero-based dense integers, and `board_state.revision` is a monotonically increasing safe integer. For every committed state, columns are ordered deterministically and each card belongs to exactly one existing column and appears exactly once at a unique position within that column. All mutation authorization, validation, and revision checks happen inside the Durable Object. The Stage 2 session cookie `__Host-kanban_session`, exact same-origin `Origin`, and `X-CSRF-Token` rules apply to every board mutation. Keep the Stage 2 response envelope: `{data:...}` on success and `{error:{code,message}}` on failure.

## Schema and shared types

Add an idempotent Stage 4 migration in `worker/src/db/migrations.ts`:

- `board_state`: singleton row (`id=1`, `revision INTEGER NOT NULL DEFAULT 1`). Seed once; do not reset revision on re-deploy.
- `columns`: `id` primary key, `name_key` nullable (`todo`, `in_progress`, `done` only), `custom_name` nullable, `position INTEGER NOT NULL`, `created_at`, `updated_at`. Exactly one of `name_key` or `custom_name` is present. Seed the three built-in columns once in one migration transaction, with positions 0–2. Index `position`.
- `cards`: `id` primary key, `column_id` required reference, `title` required, `description` nullable, `assignee_user_id` nullable reference, `creator_user_id` required reference, `position INTEGER NOT NULL`, `created_at`, `updated_at`. Index `(column_id, position, id)` and `assignee_user_id`. User rows are deactivated, never hard-deleted in this release, so historical creator metadata remains.

Validate server-side after Unicode trimming: title 1–200 characters, description at most 4,000 characters, custom column name 1–80 characters. Treat Unicode code points, not UTF-16 code units, as the length unit; reject control characters except normal line breaks in descriptions. Validate `boardRevision` and every index as a nonnegative safe integer, never silently coerce a string or fraction. Rendered user text is plain text, never HTML. Allow `description:null` and `assigneeUserId:null` to clear optional values. Card edits never implicitly change column or position. Assignment is legal only when the target user is active **and currently allowlisted** in this household. To bound one-response size and SQL work on Free, cap the initial release at **500 cards and 20 columns**, return a stable `board_full` or `column_limit` conflict on create, and document these limits in the Stage 5 UI. Those caps can be revisited after measured usage; never silently truncate the board response.

Define the canonical TypeScript request/response types in `shared/api.ts` (or the Stage 1 shared API module). Implement SQL data access in `worker/src/board/repository.ts`, board rules/ordering in `worker/src/board/service.ts`, and route handlers in `worker/src/routes/board.ts`; wire the routes through `worker/src/household-do.ts`. Keep the front Worker router thin. Add focused integration and concurrency tests in `tests/` using the isolated local Durable Object.

## API contract

`GET /api/v1/board` returns one coherent snapshot:

```json
{
  "data": {
    "boardRevision": 1,
    "columns": [
      {
        "id": "opaque-id",
        "nameKey": "todo",
        "customName": null,
        "position": 0,
        "cards": [
          {
            "id": "opaque-id",
            "columnId": "opaque-id",
            "title": "Task",
            "description": null,
            "assigneeUserId": null,
            "creatorUserId": "opaque-id",
            "position": 0,
            "createdAt": "2026-09-12T00:00:00.000Z",
            "updatedAt": "2026-09-12T00:00:00.000Z"
          }
        ]
      }
    ],
    "activeMembers": [{ "id": "opaque-id", "email": "member@example.test" }]
  }
}
```

Read columns by `(position,id)` and cards by `(position,id)` inside one synchronous `ctx.storage.transactionSync()` read snapshot. `activeMembers` contains only active, currently allowlisted users. Return `Cache-Control: no-store`; do not leak board data to anonymous, inactive, or removed-from-list users. An in-app display name is not required in this release; Stage 5 may show the account email for assignment. Do not expose password, phrase, session, or operator fields.

| Method and route | Request body | Rule |
| --- | --- | --- |
| `POST /api/v1/columns` | `{boardRevision, name}` | Owner only; append a custom-named column |
| `PATCH /api/v1/columns/:id` | `{boardRevision, name}` | Owner only; rename, setting `nameKey` to null |
| `POST /api/v1/columns/:id/move` | `{boardRevision, targetIndex}` | Owner only; reorder 0–`columnCount-1` |
| `DELETE /api/v1/columns/:id` | `{boardRevision}` | Owner only; empty column only; preserve at least one |
| `POST /api/v1/cards` | `{boardRevision, columnId, title, description?, assigneeUserId?}` | Active member; append at end |
| `PATCH /api/v1/cards/:id` | `{boardRevision, title?, description?, assigneeUserId?}` | Active member; reject an empty patch or unknown field |
| `POST /api/v1/cards/:id/move` | `{boardRevision, targetColumnId, targetIndex}` | Active member; remove from source, insert at index in target |
| `DELETE /api/v1/cards/:id` | `{boardRevision}` | Active member; UI confirms before calling |

Every successful mutation returns `{data:{boardRevision:<new revision>,id?:<changed ID>}}`; the UI refetches the board after mutation. Include `boardRevision` in the JSON body even for `DELETE`; the API client must send the corresponding content type. For a same-column card move, `targetIndex` refers to the list **after removing the moving card**, in range `0..remainingCount`; for a cross-column move it refers to the destination list before insertion, in range `0..destinationCount`. A no-op move or identical edit may return the unchanged revision with `{data:{boardRevision,unchanged:true}}`, after validation, without a write. For column moves, the target index is the final position in the column list.

A stale revision returns HTTP `409` with `{error:{code:"revision_conflict",message:"The board changed; reload and retry.",details:{boardRevision:<current>}}}` and **no mutation**. Add optional `details` to the shared error type while keeping the Stage 2 envelope. Other stable errors include `validation_error` (`400`), `unauthenticated` (`401`), `forbidden` (`403`), `not_found` (`404`), `column_not_empty`/`last_column`/`board_full`/`column_limit` (`409`), and Stage 2 `rate_limited` (`429`). Return safe messages. The Stage 5/6 UI translates stable error codes, not the English fallback message. It must reload after a `409`, show the failed move as unsaved, and retain unsaved card-form values for review and retry; it must not automatically apply the stale edit against the newer board.

## Ordered implementation tasks

1. **Migration and seed.** Create `board_state`, `columns`, and `cards` with checks, references, indexes, and stable IDs. Verify SQLite foreign-key enforcement in the actual Durable Object runtime and explicitly enable it if required. Seed default translation keys once. Test a migration rerun and verify it leaves existing names, cards, and revision untouched. Ensure `GET /api/v1/board` works for an empty seeded board.
2. **Read and authorization.** Implement one consistent board snapshot with eligible active members for assignment choices. Check live session, active status, and Stage 2 allowed-list membership before any read. Enforce owner-only column endpoints in the Durable Object before revealing target details. Return JSON 404 for unknown `/api/v1/*` routes rather than an SPA page.
3. **Transactional mutations.** In one short synchronous `ctx.storage.transactionSync()` callback per mutation: re-check the acting session is live and user active/allowlisted, validate current `boardRevision`, entity existence, role, active/allowlisted assignee, bounds and 500/20 caps; compute the affected card/column ID arrays; apply changes and renumber affected positions densely; increment `board_state.revision` exactly once; commit. Do not `await`, perform network calls, or hash passwords inside these callbacks. Use `(position,id)` for deterministic reads even while detecting a broken invariant. Because one named Durable Object serializes the household's SQL work, a second mutation with the old revision must observe the new revision and fail.
4. **Member and allowed-list integration.** Extend Stage 2's owner bootstrap and registration-confirm transactions to increment the board revision when an eligible account becomes active and the board already exists, because `activeMembers` in the board snapshot changes. Keep Stage 2's `PATCH /api/v1/members/:id` route and owner-only account/session checks. Extend its **same SQL transaction** to set the member inactive, revoke their sessions, set their current `cards.assignee_user_id` values to null, and increment the board revision once. Extend the Stage 2 allowed-list replacement transaction too: when it removes an active member, clear that member's current card assignments and advance the board revision; when it re-adds a still-active member, advance the revision so `activeMembers` includes them again. One replacement request advances the board revision at most once even if several eligible members change; changes involving only unregistered/inactive emails do not change it. If removal/deactivation runs before a card assignment, the latter rejects the ineligible assignee; if assignment commits first, the membership transaction clears it. Never remove historical card text or `creator_user_id`. Owner self-deactivation/removal remains forbidden. These membership endpoints do not require a client `boardRevision`, but return the new revision when the board exists.
5. **Error and scale behavior.** Reuse Stage 2 rate limiting and parser behavior, but set a **64 KiB board JSON body limit** in both the front Worker and Durable Object so a valid 4,000-code-point description is not rejected by Stage 2's smaller 16 KiB auth limit. Use `Cache-Control: no-store` for board responses, robust invalid JSON handling, and no secrets in logs. Measure rows written for typical and worst-case reorder operations; keep the 500-card cap and Stage 7 quota review explicit rather than relying on an unbounded SQL read.

## Acceptance and adversarial tests

- A new board has exactly the three built-in columns in the correct order. A second migration or deploy does not duplicate them. Built-in `nameKey` labels localize through Stage 6; after renaming, `customName` remains the literal user-entered name in every locale.
- An owner can create, rename, move, and remove an empty column. A member receives `403` for all column mutations. Deleting a nonempty or final remaining column gets `409` without moving or deleting cards.
- Any active, allowlisted member can create, edit, assign, unassign, move within and across columns, and delete cards. Invalid lengths, bad types, unknown IDs, extra fields, out-of-range indices, nonexistent, inactive, or no-longer-allowed assignees, and 501st card/21st column requests fail without writes. The creator ID stays intact after edits and deactivation.
- Test two simultaneous moves with the same revision, simultaneous edit/delete, rename/reorder, and assignment versus deactivation/allowlist removal. Exactly one revision-guarded board mutation succeeds per old revision; the loser gets `409` with `error.details.boardRevision` and no partial writes. Activation and deactivation each advance revision once; an allowed-list update advances it once when eligible active members change. Removal/deactivation and assignment serialize to an unassigned or rejected final state, never an assignment to an ineligible member. If a member is removed or deactivated after pre-authorization but before a pending board write, the in-transaction session/list check rejects the write.
- After every randomized sequence of creates, deletes, and moves, assert unique card IDs, one valid column per card, positions `0..n-1` in every column, positions `0..m-1` for columns, and exactly one revision increment per state-changing request. Failed or no-op requests do not increment revision. Test moving to first, last, same, and empty destination positions.
- Anonymous, inactive, removed-from-list, and expired-session reads/writes return `401`; missing/foreign `Origin` or CSRF token on mutations is rejected; members cannot mutate columns; unknown `/api/v1/` routes return JSON 404. A board response exposes only the specified public member/card fields. A Free-deployment smoke test covers one create, cross-column move, conflicting stale move, allowlist-removal cleanup, and deactivation cleanup.

## Exit gate and rollback

Stage 4 is done when the schema migration, all endpoints, membership integration, ordering invariants, authorization tests, conflict handling, and isolated Free-test-deployment smoke test pass. Freeze the API contract for Stage 5. If a test deployment fails, revert faulty route code while retaining the additive SQL migration, or rebuild the disposable test object from fixtures. If reverting to Stage 2 code, temporarily disable member deactivation **and allowed-list replacement** until their atomic assignment cleanup is restored, so cards cannot remain assigned to ineligible users. Repair test data with a tested migration or reset the disposable object, never by manually deleting cards or resetting `boardRevision`. Do not initialize production accounts before Stage 7's export, encrypted backup, and restore drill are complete.

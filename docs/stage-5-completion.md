# Stage 5 completion — board and account UI

**Date:** 2026-09-13 (Asia/Jerusalem)
**Plan:** [archived Stage 5 plan](../development-plans/archived/stage-5-board-account-ui.md)
**Decision:** **Complete.** Every account and board workflow runs against the deployed Free
test Worker. No production account, secret, or data was created.

## Tested version

| Item | Value |
| --- | --- |
| Interface commit | `909e69c`, with accessibility fixes in `6aae5b6` |
| Commit verified | `6aae5b6` (`6aae5b695484088d514c83af81375337ba70fd5f`) |
| CI run | [34749133629](https://github.com/yhaspel/goal-tracker/actions/runs/34749133629) — `checks: success`, `deploy-test: success` |
| Deployed version ID | `0719da20-9c2c-4598-81a3-a74116c2306d` |
| Test host | <https://family-board-test.yuval3000.workers.dev> |
| Drag library | `@dnd-kit/react` 0.5.0 and `@dnd-kit/dom` 0.5.0, both exact-pinned |

## What was delivered

`web/src/` now holds a complete application: a typed same-origin API client
(`api/client.ts`, `api/endpoints.ts`), a small history router with guest, member, and owner
guards, a session provider, the account screens (bootstrap, invitation registration, phrase
confirmation, sign-in and sign-out, phrase recovery, operator-token recovery, signed-in
credential change), the owner settings screen (one-address-per-row allowed list, invitations,
people), and the board with a card editor, owner column controls, drag-and-drop, and explicit
move controls. Styling uses logical properties throughout so the same stylesheet serves both
writing directions.

## Acceptance evidence

Browser verification used Chrome driven through the DevTools protocol, reading the
accessibility tree rather than pixels, so what is recorded here is what assistive technology
would receive.

**On the deployed test Worker:**

- A `/board` deep link as a guest redirected to `/login`; the guest language selector was
  present.
- Sign-in succeeded; the submit button disabled itself while the request was in flight.
- A card was created with a title mixing Hebrew and Latin and a description mixing Cyrillic,
  Latin, and Hebrew, assigned to another member, announced through the polite live region,
  and then deleted through the confirmation dialog with its own announcement.
- The board read, card create, cross-column move, stale-move conflict carrying the current
  revision, allowed-list removal clearing assignments, and deactivation clearing assignments
  are all covered by `scripts/board-smoke.ts`, **39 of 39 checks passed**.
- Phrase recovery and the signed-in credential change are covered by
  `scripts/recovery-smoke.ts`, **23 of 23 checks passed**.
- Owner bootstrap, the allowed-list editor's contract, invitations, and seat limits are covered
  by `scripts/auth-smoke.ts`, **37 of 37 checks passed**.
- **Browser storage holds nothing sensitive:** `localStorage` and `sessionStorage` were empty,
  the only script-readable cookie was `kanban_locale=en`, the session cookie was not readable
  from script, and the URL carried no query or fragment. The console contained no application
  output at all — only the browser's own note of the expected `401` from the session probe.

**Against a local Durable Object running the same commit**, with a disposable seven-person
household created by `scripts/auth-smoke.ts`:

- Pointer drag across columns, keyboard drag (space to lift, arrow to move, space to drop),
  and the explicit **Move to column** control all persisted the correct order and announced the
  result once each.
- The owner settings screen showed an account that had left the allowed list but still held a
  seat, labelled as such, which is the distinction the product depends on.
- Saving the allowed list announced the result and refreshed the people list.
- At a 320 CSS pixel viewport the page did not scroll sideways, only the board's own container
  did, and no interactive target was under 24 pixels.

## Defects found by that verification and fixed

1. **The whole card was a draggable button.** Its accessible name swallowed the title,
   description, assignee, and every nested control, and read the assignee's opaque id aloud.
   The drag affordance is now a small labelled handle and the card is an ordinary list item.
2. **The assignee was rendered as a raw user id** instead of the member's address.
3. **Six identical "Deactivate" buttons** were indistinguishable to a screen reader. Each now
   carries an accessible name that begins with the visible label and adds the address.
4. **The drag library announced drops by opaque id**, alongside the application's own
   announcement. Its announcer is switched off, leaving one voice in the chosen language.
5. **Focus was lost after deleting a card**, because the dialog tried to return focus to the
   button it had just removed. It now falls back to the main landmark.
6. **The submit button relabelled itself "Saving…" during sign-in.** The label now stays put
   and the busy state is carried by `aria-busy`.
7. **List semantics were dropped** by `list-style: none` with a flex layout; roles are now
   explicit.

## Automated accessibility results

Lighthouse, both desktop and mobile, on the board and on the owner settings screen:
**accessibility 100**, best practices 100, with all 26 accessibility audits passing. The only
failing audit anywhere was an SEO meta description, which a private board should not have;
`index.html` now asks robots not to index the app.

## Limitations

- Touch was exercised through a touch-enabled emulated viewport, not on physical hardware. The
  drag handle sets `touch-action: none` and every drag also has an equivalent button control,
  so no board action requires a touch gesture.
- The revision-conflict path was exercised at the API level against the deployed Worker and in
  the interface against a local object; two simultaneous browser sessions were not driven
  against the deployed host.
- Card editing and owner column management were driven in a browser against a local object
  running the same commit, and against the deployed Worker through the API.
- No screen reader was run. Stage 6 records that separately; what is claimed here is
  accessibility-tree inspection and automated auditing.

## Rollback

Revert to the previous static bundle while leaving the Durable Object and its data alone. Do
not roll back to an interface that sends an incompatible API payload; deploy a compatible
adapter first. If card movement misbehaves, disable the drag integration and keep the explicit
move controls, which cover every movement on their own.

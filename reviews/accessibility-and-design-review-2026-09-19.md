# Accessibility audit and design critique — Goal Tracker — 2026-09-19

**Standard:** WCAG 2.1 AA, plus the project's own floor in `docs/design-system.md` (which is stricter
in places: 24 px absolute / 44 px touch targets, 3 px focus ring, never colour alone).
**Reviewed at commit:** `fe17b86` (`main`, level with `origin/main`, clean tree).
**Surface:** every route the SPA serves — `/`, `/login`, `/register`, `/recover`, `/bootstrap`,
`/board`, `/goals`, `/vision`, `/account`, `/members` — signed in as owner and as guest.

## How this review was done

Two passes, and the findings below say which pass produced each one.

1. **Source read.** Every file under `web/src` (the 35 components, hooks, dictionaries and the one
   stylesheet), `docs/design-system.md`, `tests/web.ui.test.ts`, `scripts/check-i18n.ts`, and the
   copy-review and Stage 8 records. Contrast ratios were computed from the `--gt-*` tokens for both
   themes (table below), not estimated.
2. **Rendered walk.** The production build in `web/dist` (current: no source file is newer than it)
   was served against a throwaway in-memory mock of the `/api/v1` contract and driven with headless
   Chromium 1194 (Playwright 1.56): all ten routes × 390 / 834 / 1440 × `en` / `he` / `ru` × light /
   dark — 180 full-page screenshots — with structural measurement on each (document overflow,
   interactive targets under 24 px, computed styles), then a keyboard-only interaction pass reading
   `document.activeElement` and both live regions after each action. Seeded data included Hebrew and
   Russian member text inside English screens, a 4-column board, due dates in all three states, a
   member removed from the allowed list, an expired invitation, uncaptioned images, and a 200-character
   card title. Rendering claims below are observed, not inferred, unless marked otherwise.

**Not done:** no real screen reader was listened to (live-region text was read from the DOM); no
Safari, Firefox or touch device; nothing was run against production or the test Worker. Those gaps
are the same ones `docs/stage-8-completion.md` records.

---

## Accessibility Audit: Goal Tracker

**Standard:** WCAG 2.1 AA | **Date:** 2026-09-19

### Summary

**Issues found:** 21 | **Critical:** 3 | **Major:** 9 | **Minor:** 9

The floor the design system describes is largely real: every interactive target measured ≥ 24 px at
every width and locale (44 px where a finger reaches), the focus ring is visible on every control in
both themes, every icon is `aria-hidden` beside text or inside a named control, the drag-and-drop
keyboard path announces pick-up, hover and cancel, and the actions menu's keyboard contract works as
documented. The defects are concentrated in three places: **state that is invisible or lost**
(the recovery radios show no checked state; focus is dropped to `<body>` by every control that
disables itself while a request is in flight), **outcomes that are silent** (column changes, the
carousel, invitations, upload failures, the recovery-phrase step), and **the dark theme's border
token**, which is below 3:1 on two of the three grounds it sits on.

### Findings

#### Perceivable

| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| A1 | **The `/recover` radio buttons have no visible checked state.** The global `input { appearance: none }` (style.css `input, textarea, select`) strips the native radio rendering, and `accent-color` does nothing once appearance is none. Both options render as identical empty 24 px squares in both themes; "I have my recovery phrase" is checked by default and nothing shows it. Screen readers get `checked` from the DOM; sighted users get nothing. Observed at every width/locale/theme. | 1.3.1 Info and Relationships, 4.1.2 (state), 1.4.1 in effect | 🔴 Critical | Draw the state from tokens: a round 24 px control with a `--gt-line` border and a `--gt-accent-ink` dot on `:checked` via `::before` (see remediation R1). Record the round shape as deliberate deviation 12 — a square radio reads as the checkbox the system says it never has. |
| A2 | **Dark theme borders are below 3:1 on two of the three grounds.** `--gt-line` `#5a6a75` is 3.16:1 on `--gt-surface` but **2.81:1 on `--gt-raised`** (card, dialog, panel and input borders, every outlined button in a dialog) and **2.41:1 on `--gt-plate`** (card borders inside built-in columns, the column-strip buttons, the dashed empty-column drop slot). `--gt-notice-line` dark `#5a6a75` is 2.81:1 on the notice fill and on raised (the notice alert's 4 px edge, the invitation-code callout). The design-system text says "3:1 borders in both themes"; the Stage 8 report measured 3.16 on the surface only. Computed. | 1.4.11 Non-text Contrast | 🟡 Major | Set dark `--gt-line` and `--gt-notice-line` to `#6f8190` (3.35:1 on plate, 3.90:1 on raised, 4.40:1 on surface; 1.76:1 against `--gt-ink-soft` text so it still reads as a hairline). Update the token table's claim. |
| A3 | **The "due soon" badge says exactly what the plain "due" badge says.** `card.dueSoon` equals `card.due` in all three dictionaries (`Due {date}` / `עד {date}` / `Срок: {date}`); the only difference is the warning tint and the CSS-generated `⚠`, which screen readers expose inconsistently. The design-system note that "each of the three due states is its own dictionary sentence" is not true for this one. Source read + observed. | 1.4.1 Use of Color (borderline — the glyph is a non-colour cue), 1.3.1 | 🟢 Minor | Give the state a sentence: `Due soon: {date}` / `בקרוב: עד {date}` / `Скоро срок: {date}`. |
| A4 | **Vision images have no text alternative when they have no caption.** Tile buttons are named ("Open image 3"), but the carousel's `<img alt="">` and an uncaptioned image leave a screen-reader user with "Image 3 of 5" and nothing about the image. The caption is the only alt text this app can have, and the carousel never uses it as one. Source read + observed. | 1.1.1 Non-text Content | 🟢 Minor | In the carousel, `alt={image.caption ?? ''}` (the caption paragraph stays for sighted users; the redundancy is harmless and the empty-alt case is unchanged). Say in `vision.addHelp`'s neighbourhood that the caption is what a screen reader hears — a copy change, see D9. |
| A5 | **The page scrolls sideways on tablets with four or more columns.** At 834–1199 with four populated columns the document is 215 px wider than the viewport. Cause: the visually-hidden "Assigned to:" span in every card is `position: absolute`, and the `.board` scroll container is not positioned, so the span's containing block is `.board-track` — the span lands at its static position inside a column that starts past the viewport edge and stretches the page. The same mechanism applies at 1200+ once a populated column starts beyond the edge. Observed; verified fixed by `.board { position: relative }` + `.card-list .card { position: relative }` (overflow 0). | 1.4.10 Reflow (and the system's own "never scrolls sideways" rule) | 🟡 Major | R4. |
| A6 | **Member text can widen a column, and can scroll the page sideways.** A "Part of …" badge is `white-space: nowrap`; a milestone title of ~80 characters made the column 510 px wide at 1440 (it is `flex: 0 0 320px`, but a flex item's automatic minimum size is its min-content width, and the column's is the badge). The long assignee address widened another column to 363 px instead of ellipsising as the stylesheet intends. On `/goals` at 390 a card chip with a 200-character card title scrolled the page by **576 px**; on `/members` at 390 in Russian the `members.notAllowed` badge scrolled it by **56 px** (it is a 57-character sentence in a nowrap badge). An unbroken description word (a long URL path) widens a column too — `.card-description` is `pre-wrap` with no `overflow-wrap`. All observed. | 1.4.10 Reflow | 🟡 Major | `.column { min-inline-size: 0 }`; `.card-badges .badge, .milestone-cards .badge { max-inline-size: 100%; overflow: hidden; text-overflow: ellipsis }` (they stay `inline-block` and `nowrap`, so the bidi rule in the design system is untouched); `.list .badge { white-space: normal }` for the status badges, which must not truncate; `.card-description { overflow-wrap: anywhere }`. Verified: every overflow above measures 0 with these rules, columns hold their basis, the address ellipsises. R5. |
| A7 | **Goal plates render with no padding.** `.goal-plate { padding: var(--gt-space-5) }` names a token that does not exist (the scale is 1, 2, 3, 4, 6, 8, 12), so the declaration is invalid at computed-value time and padding is 0: the title, notes, meter and every milestone row sit on the plate's border, and the accent top rule touches the title. Observed at every width. Not a WCAG failure by itself — listed here because it is the most visible defect in the product and the fix is one token. | — (see D1) | 🔴 Critical (visual) | Add `--gt-space-5: 17px` to the base token block and keep the rule. R2. |

#### Operable

| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| A8 | **Every control that disables itself while a request is in flight drops keyboard focus to `<body>`.** `Submit` sets `disabled={pending}`; so do the milestone Done toggle, the four column-strip buttons, Revoke, Deactivate and "Add images". Measured: pressing Enter on the Done toggle → `activeElement` is `BODY` during and after the request; Save in the card dialog → `BODY` during the request, and **after a failed save (server field error) focus stays on `BODY` inside the open modal**, where the dialog's own `onKeyDown` Tab trap can no longer see keystrokes — the next Tab lands on the skip link behind the backdrop. Sign-in with a wrong password → `BODY`. Column move → `BODY`, and the strip is re-rendered so nothing restores it. | 2.4.3 Focus Order, 2.1.1 in effect, 4.1.2 | 🔴 Critical | Never put `disabled` on the control that has focus. Use `aria-disabled={pending}` plus the pending guard every handler already has (each form's `submit` and every `runMutation` return early while pending), keep `aria-busy` and the busy squares. Structural disabling at list ends (deviation 7) stays real `disabled`. R3. |
| A9 | **Focus is lost after actions that remove or re-mount the focused control.** Moving a card to another column through its menu re-mounts the card under a different `<ol>`, so the trigger that had focus is destroyed (measured: `BODY`). Deleting a card, goal, milestone or image: the confirm dialog returns focus to the menu trigger — which still exists when the dialog closes, because the mutation runs *after* `setDeleting(null)` — and the row is then removed (measured: `BODY`; the documented "fall back to `#main`" path never fires). Moving a column towards an end lands its own button in the real-`disabled` state. Within-list "move up/down" keeps focus (measured), because React moves the node. | 2.4.3 Focus Order | 🟡 Major | After a cross-column move, focus the moved card's actions trigger by id; after a delete, focus the list's add control (the column's "Add a card", the goals header "Add a goal", the plate's "Add a milestone", "Add images"); after a column move, focus the same button in the moved strip, or its Rename neighbour if it is now at an end. R6. |
| A10 | **The phone pager's Previous/Next buttons are named after the adjacent column only.** Their `aria-label` is `columnLabel(columns[active ± 1] ?? activeColumn)`: at the first column the disabled "previous" button is named after the *current* column ("In progress", on the In progress panel — measured), and a working one is just "To do" with a chevron. Neither name says what the button does. | 4.1.2 Name, Role, Value; 2.4.6 | 🟡 Major | Name them `board.previousColumn` / `board.nextColumn` ("Previous column" / "Next column", new keys), and announce the column that appears (`board.columnShown`, new key) so a screen-reader user hears where they landed. R9. |
| A11 | **Modal dialogs rely on `aria-modal` alone**; the rest of the app is never `inert`. The Tab trap is implemented, Escape works, and focus return is handled, so this is a robustness gap for older assistive technology and for pointer-reachable content behind the backdrop, not a broken contract. Source read. | 2.4.3 (advisory) | 🟢 Minor | Advisory only — a portal-plus-`inert` refactor is not worth its regression risk against the focus contract as shipped. Left out of the remediation prompt deliberately. |
| A12 | **`card.dragInstructions` never mentions Escape**, which cancels a drag and is announced (`card.dragCanceled`). Source read. | 2.1.1 (advisory), 3.3.2 | 🟢 Minor | Append the Escape sentence in all three dictionaries. R13. |
| A13 | **Language `<select>` changes the page language and direction on `change`.** In browsers that fire `change` while arrowing through a closed select, a keyboard user cycles the whole interface (and, signed in, sends a save) per keystroke. Not reproduced under Playwright; noted from the code. | 3.2.2 On Input | 🟢 Minor | Advisory. The saved-language announcement already exists; leave as is unless a real user reports it. |

#### Understandable

| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| A14 | **The allowed-address box shouts on every keystroke.** Four `Alert tone="error"` elements (`role="alert"`) render from live validation of the textarea; typing `new` produced the assertive alert "This does not look like an email address: new" (measured), and every further character re-announces it. The textarea itself gets no `aria-invalid` and no `aria-describedby` (measured: both `null`). | 3.3.1 Error Identification, 4.1.3 misuse | 🟡 Major | Pass the first live message to `Field`'s `error` prop, which already wires `aria-invalid` + `aria-describedby` and renders it as text, and remove the four alerts. The two server-side alerts (conflict, seats) stay. R7. |
| A15 | **Five hand-rolled `<select>` fields show errors that are not associated with the control.** Assignee and "Part of" (`CardDialog`), year and month (`GoalsPage`), goal (`VisionPage`): each renders `<span className="error">` with no `id`, and the select has no `aria-describedby` or `aria-invalid`. Source read. | 3.3.1, 1.3.1 | 🟡 Major | Give each error span an id, and the select `aria-describedby` / `aria-invalid` when it is present. R8. |
| A16 | **`*` marks required fields and nothing says what `*` means.** `app.required` ("Required") exists in all three dictionaries and is unused. Source read. | 3.3.2 Labels or Instructions | 🟢 Minor | Advisory: the `required` attribute already reaches assistive technology; a visible legend is a copy decision for the owner. Not in the remediation prompt. |
| A17 | **The recovery method's `<legend>` repeats the page `<h1>`** ("Recover your account" twice, 40 px apart) instead of naming the choice. Observed. | 2.4.6 Headings and Labels | 🟢 Minor | A question as the legend: `recover.methodLegend` — "How do you want to recover?" / "איך תרצו לשחזר את החשבון?" / "Как вы хотите восстановить доступ?". R12. |

#### Robust

| # | Issue | WCAG Criterion | Severity | Recommendation |
|---|-------|---------------|----------|----------------|
| A18 | **The document title never changes.** `<title>Goal Tracker</title>` is static and `document.title` is never written; all ten routes, in every language, have the same title, and client-side navigation gives the tab, history and a screen reader's page announcement nothing to distinguish. Measured on five member routes and `/login`. | 2.4.2 Page Titled (Level A) | 🔴 Critical | Set `document.title` from the screen's existing heading key and `app.name` on every path and locale change: `Board – Goal Tracker`, `לוח – Goal Tracker`. No new strings. R10. |
| A19 | **Outcomes with no status message.** (a) Column create, rename, move and delete announce nothing (measured: the polite region still held the previous card's message after a column move). (b) The carousel: ← / → / Next change the image with no announcement and `alt=""` — a screen-reader user pressing Next hears nothing at all (measured: both regions empty after a step). (c) Creating an invitation renders the one-time code in a callout below the form with no announcement and focus on `BODY` (measured). (d) A file that fails to upload shows `vision.fileUnreadable` / `error.image_too_large` in the list silently; only a success is announced. (e) `/register`, `/recover` and `/account` replace the form with the recovery-phrase step — the one-time secret — without moving focus or announcing (measured: `BODY`, regions empty). | 4.1.3 Status Messages; 2.4.3 for (c) and (e) | 🟡 Major | (a) three new keys `board.columnSaved` / `board.columnDeleted` / `board.columnMoved`; (b) announce `vision.position` (with the caption when there is one — new key `vision.positionWithCaption`); (c) announce `invitations.codeHeading` and focus the callout heading; (d) announce the failure reason assertively; (e) `PhraseStep` focuses its own `<h2>` on mount. R11. |
| A20 | **The actions menu's group label is a `<p role="presentation">` directly inside `role="menu"`.** A menu may own only menuitem, group and separator; a presentational paragraph with text is a bare text child. Screen readers mostly skip it, so "Move to column" is never read as the group's name. Source read. | 4.1.2, 1.3.1 | 🟢 Minor | Wrap each labelled run in `<div role="group" aria-labelledby=…>` with the label as its first child. The roving index and every key binding are per item and unchanged. R14. |
| A21 | **The milestone Done toggle has a marker only when pressed.** Pressed gets `✓`; not pressed has no marker, so the two states differ by fill alone in the row where the word is the same in both. `aria-pressed` carries it for assistive technology. Observed. | 1.4.1 (advisory), 1.3.1 | 🟢 Minor | An unpressed marker (`○`) from the same `::before` rule, so both states carry a mark. R15. |

### Color Contrast Check

Computed from the tokens in `web/src/style.css` (relative luminance per WCAG; `--gt-line-soft` light is
the 16 % blend on `#f2f2f3`).

| Element | Foreground | Background | Ratio | Required | Pass? |
|---------|-----------|------------|-------|----------|-------|
| Body text on ground / card / column plate (light) | `#1d1f20` | `#f2f2f3` / `#f5f5f8` / `#eef6ff` | 14.79 / 15.21 / 15.18 | 4.5:1 | ✅ |
| Soft text 13 px (help, meta) on the three grounds (light) | `#5d5d60` | as above | 5.87 / 6.03 / 6.02 | 4.5:1 | ✅ |
| Links, primary fill label, add-card text (light) | `#416180` / `#f2f2f3` | `#f2f2f3` / `#416180` | 5.78 | 4.5:1 | ✅ |
| Accent chrome (column underline, icons) on ground / plate (light) | `#5980a6` | `#f2f2f3` / `#eef6ff` | 3.71 / 3.80 | 3:1 | ✅ |
| Control border `--gt-line` on ground / card / plate (light) | `#7a7a7d` | `#f2f2f3` / `#f5f5f8` / `#eef6ff` | 3.82 / 3.93 / 3.92 | 3:1 | ✅ |
| Danger text and border on card (light) | `#8c2020` | `#f5f5f8` | 8.24 | 4.5:1 | ✅ |
| Warning mark / ink on warning fill (light) | `#7a5300` / `#1d1f20` | `#fdf3d8` | 6.20 / 14.96 | 4.5:1 | ✅ |
| Focus ring on ground / card / plate (light) | `#2c455d` | `#f2f2f3` / `#f5f5f8` / `#eef6ff` | 8.87 / 9.12 / 9.10 | 3:1 | ✅ |
| Done cap text on steel (light) | `#f2f2f3` | `#1d2d3d` | 12.56 | 4.5:1 | ✅ |
| Avatar pairs 0–3 (light) | ink | fill | 8.12 / 6.76 / 8.12 / 6.78 | 4.5:1 | ✅ |
| Body text on ground / card / plate (dark) | `#e8eaec` | `#14191d` / `#1d2429` / `#22303d` | 14.67 / 13.03 / 11.17 | 4.5:1 | ✅ |
| Soft text on ground / card / plate (dark) | `#a3adb6` | as above | 7.76 / 6.89 / 5.91 | 4.5:1 | ✅ |
| Links and primary label (dark) | `#94bce3` / `#14191d` | `#14191d` / `#94bce3` | 8.90 | 4.5:1 | ✅ |
| **Control border `--gt-line` on ground (dark)** | `#5a6a75` | `#14191d` | 3.16 | 3:1 | ✅ |
| **Control border `--gt-line` on card `--gt-raised` (dark)** | `#5a6a75` | `#1d2429` | **2.81** | 3:1 | ❌ A2 |
| **Control border `--gt-line` on column plate (dark)** — card borders, strip buttons, empty-slot dashes | `#5a6a75` | `#22303d` | **2.41** | 3:1 | ❌ A2 |
| **Notice line on notice fill / card (dark)** | `#5a6a75` | `#1a242e` / `#1d2429` | **2.81** | 3:1 | ❌ A2 |
| Proposed dark `--gt-line` on plate / card / ground | `#6f8190` | `#22303d` / `#1d2429` / `#14191d` | 3.35 / 3.90 / 4.40 | 3:1 | ✅ |
| Warning line on card (dark) | `#a8843a` | `#1d2429` | 4.51 | 3:1 | ✅ |
| Danger text on card / on danger fill (dark) | `#f0a8a8` | `#1d2429` / `#2b1c1c` | 8.13 / 8.46 | 4.5:1 | ✅ |
| Focus ring on ground / card / plate / steel (dark) | `#b5d9fd` | `#14191d` / `#1d2429` / `#22303d` / `#22303d` | 12.06 / 10.70 / 9.18 / 9.18 | 3:1 | ✅ |
| Milestone toggle pressed label on success (both) | `#f5f5f8` / `#1d2429` | `#2f6a4a` / `#7fc9a2` | 5.88 / 8.06 | 4.5:1 | ✅ |
| Year chip / pager tab selected label (both) | on-accent | accent-ink | 5.78–8.90 | 4.5:1 | ✅ |
| Meter fill on its track (both) | accent-ink | plate | 5.93 / 6.78 | 3:1 | ✅ |
| Disabled controls at `opacity: 0.45` (both) | — | — | 2.76 / 3.78 | exempt | — (see D2) |

The focus ring is offset 2 px, so it is always measured against the ground around a control, never
against the control's own fill; every ground passes in both themes.

### Keyboard Navigation

Measured with the keyboard only, 1440 px, English, against the mock. ✅ = behaves as the design
system's contract says.

| Element | Tab Order | Enter/Space | Escape | Arrow Keys |
|---------|-----------|-------------|--------|------------|
| Skip link → header nav → language select → main | Logical; `main` receives focus on every route change (announces the screen) | Links navigate; Sign out is a button | — | — |
| Card title button | In card order | Opens Edit; **focus returns to the title after a successful save** ✅; after a *failed* save focus is on `body` ❌ A8 | Closes dialog, returns focus ✅ | — |
| Drag handle (≥ 834 px only) | After the title | Picks up; `card.dragPickedUp` announced ✅ | Cancels; `card.dragCanceled` announced ✅ | Moves; `card.dragOver` announced ✅ (Escape not mentioned in the instructions — A12) |
| Card actions menu | After the handle | Opens on first item ✅; ↓ opens on first, ↑ on last ✅ | Closes and returns focus to the trigger ✅ | ↑↓ cycle, Home/End jump ✅ (measured: End → Delete) |
| Menu → Move to another column | — | Card moves; announced ✅; **focus lost to `body`** ❌ A9 | — | — |
| Menu → Move up/down | — | Announced ✅; focus stays on the trigger ✅ | — | — |
| Menu → Delete → confirm | Dialog focuses Close, then Cancel, Delete | Announced ✅; **focus lost to `body`** ❌ A9 | Cancels ✅ | — |
| Column strip (owner) | Rename, start, end, delete per column | Move works; **no announcement**, **focus lost** ❌ A8/A19 | — | — |
| Board scroll-end button | After the last column's content | Scrolls 80 % of the track ✅ | — | — |
| Milestone Done toggle | In row order | Toggles; `milestone.markedDone` announced ✅; **focus lost to `body`** ❌ A8 | — | — |
| Year strip (`aria-pressed` buttons) | In order | Switches year ✅ | — | — |
| Vision tile → carousel | Tiles in order | Opens; focus on Close ✅; on close **returns to the tile** ✅ | Closes ✅ | ← → step, mirrored in RTL ✅; **nothing announced** ❌ A19 |
| Phone pager tabs (390) | Roving tabindex ✅ | Selects | — | ← → cycle, mirrored ✅ (no Home/End — optional) |
| Phone pager Previous/Next | After the tabs | Steps ✅ | — | — (names wrong — A10) |
| Phone nav sheet | Focus moves to the first link ✅; Tab cycles ✅ | — | Closes and returns focus to the menu button ✅ | — |
| Sign-in / register / recover forms | Fields then Submit | Submit; on failure `role="alert"` announces ✅ but **focus is on `body`** ❌ A8; on success (register) the phrase step appears **without focus or announcement** ❌ A19 | — | — |
| Language select | In header order | — | — | Changes language immediately (A13) |

### Screen Reader

Read from the accessibility tree and the two live regions, not heard.

| Element | Announced As | Issue |
|---------|-------------|-------|
| Every route | "Goal Tracker" (document title) + focus on `main` | Same title everywhere — A18 |
| `/recover` radios | "I have my recovery phrase, radio button, checked, 1 of 2" | Correct for AT; invisible for sighted users — A1 |
| Card | h3 title button "…"; "Drag …, button, Press Space or Enter to pick up a card…"; "Actions for …, menu button, collapsed"; badges as text; "Assigned to: dana@…" | ✅ |
| Due-soon badge | "⚠ Due Sep 19, 2026" or "Due Sep 19, 2026" depending on the reader's handling of generated content | State not in words — A3 |
| Column strip buttons | "Move To do towards the end, button" | ✅ name; nothing after activation — A19 |
| Actions menu | "Actions for …, menu"; items "Edit, menu item" …; "Move to column" | Group label not a group — A20 |
| Milestone toggle | "Done: Register for the race, toggle button, pressed" | ✅; after activation "… marked done." (polite) ✅ |
| Goal progress | "1 of 3 milestones done" + `aria-hidden` bar | ✅ |
| Vision tile | "Open Trail near the sea 1, button" / "Open image 2, button" | ✅ |
| Carousel step | (nothing) | A19 (b), A4 |
| Invitation created | (nothing); code callout appears below | A19 (c) |
| Allowed-address box while typing | "This does not look like an email address: n" … per keystroke (assertive) | A14 |
| Phone pager Previous | "To do, button" / "In progress, button, dimmed" | A10 |
| Phrase step | (nothing); h2 "Save your recovery phrase" is on screen | A19 (e) |

### Priority Fixes

1. **Draw the radio state and stop disabling the focused control (A1, A8)** — affects every sighted
   user recovering an account, and every keyboard and screen-reader user on every form, toggle and
   column change; a failed save inside a modal currently strands focus behind the backdrop.
2. **Give every route a title and every silent outcome a message (A18, A19)** — blocks screen-reader
   users from knowing where they are, what a column change did, what image the carousel shows, that an
   invitation code was issued, that an upload failed, or that the one-time recovery phrase is on screen.
3. **Restore the goal plate padding and stop the page scrolling sideways (A7, A5, A6)** — the two most
   visible defects; the second is member-text-dependent and already reachable with today's limits.
4. **Lift the dark border token to 3:1 (A2)** — one hex value in one block.
5. **Associate errors with their controls and stop the per-keystroke alert (A14, A15)**.
6. **Name the pager buttons, restore focus after moves and deletes (A10, A9)**.
7. Minor: due-soon sentence, carousel alt, legend, Escape in the drag instructions, menu group
   semantics, unpressed toggle marker (A3, A4, A17, A12, A20, A21).

---

## Design Critique: Goal Tracker

**Context.** A private household Kanban board with yearly goals and a vision board, one shared board,
at most seven people, three languages including a right-to-left one, no theme toggle, light and dark
by OS preference. Stage: shipped and in production; polish and correctness, not exploration.

### Overall Impression

The system is unusually coherent for an app of this size: one accent, square blueprint objects, a
condensed heading face over a plain body face, tinted column plates and raised paper cards — and it
holds up in Hebrew, in Russian, in dark, and at 390 px, where the column pager and the bottom sheets
are the right calls. The biggest opportunities are not aesthetic. Two rendering defects undercut the
polish (goal plates with no padding; the page scrolling sideways when member text or a fourth column
arrives), and the *feedback* layer is behind the visual layer: every control on screen dims for the
length of every request, several outcomes are silent, and two choice controls (the recovery radios,
the milestone toggle) do not show their state.

### Usability

| Finding | Severity | Recommendation |
|---------|----------|----------------|
| D1 **Goal plates have no padding** (`--gt-space-5` is undefined). Titles, notes, the meter and the milestone rows touch the border; the accent top rule sits on the title. This is the first thing a member sees on `/goals`. | 🔴 Critical | Define `--gt-space-5: 17px` (the 0.85-density scale step between 13.6 and 20.4). |
| D2 **Everything dims during every request.** `pending` disables the title button on every card, every add button, the column strips, the toggles — so a 250 ms move makes the whole board flash to 45 % opacity and back. It reads as a fault, and it is what causes the focus loss in A8. | 🟡 Moderate | Leave unrelated controls enabled — `runMutation` already serialises (it returns early while pending), and opening a dialog is not a mutation. Keep `disabled` only for structural states (ends of a list, a single remaining column). Show busy where it happens: `aria-busy` + the squares on the activated control. |
| D3 **The recovery radios look like empty checkboxes and show no selection** (A1). | 🔴 Critical | Round, token-drawn, with a filled dot when checked. |
| D4 **The milestone "Done" toggle reads as a status label.** An open milestone shows a plain button that says "Done", which a reader can take as "this is done". Pressed, it becomes a green `✓ Done`. The words are right for assistive technology (`aria-pressed` carries the state), but sighted users get no marker in the open state. | 🟡 Moderate | Give the open state its own mark (`○`) so both states are a mark plus a word, and the pair reads as a toggle. No string changes. |
| D5 **Member text can reshape the board.** A long milestone title in a "Part of …" badge widens a column from 320 to 510 px; a long address stops ellipsising and widens another; a long card title in a goal chip scrolls `/goals` sideways at 390 (A6). | 🟡 Moderate | Fix the column's automatic minimum size and truncate card and chip badges with an ellipsis; wrap the settings status badges. |
| D6 **Silent outcomes.** Column rename/move/delete, the carousel, invitation creation, upload failures, and the recovery-phrase step give no confirmation beyond the pixels changing (A19). A sighted user who has scrolled, or is on a phone, misses the invitation code appearing below the fold. | 🟡 Moderate | Announce, and move focus to the thing that appeared (the code callout, the phrase heading). |
| D7 **The register flow says "Step 2 of 2" only on step 2.** The first form has no step label, so the count appears from nowhere. | 🟢 Minor | Render `flow.step` (1 of 2) above the registration and bootstrap forms — the key exists. |
| D8 **Delete dialogs are titled "Delete"** for a card, a column, a goal, a milestone and an image alike; the body sentence carries the object. Acceptable, but the title is the dialog's accessible name. | 🟢 Minor | Advisory — a per-object title needs five strings × 3; the body sentence already names the object. Left out of the remediation. |
| D9 **A vision tile gives no sign it is linked to a goal**; the link is visible only in the carousel and the edit dialog. Uncaptioned images are labelled "Image 2", and nothing tells a member that the caption is also the image's description for a screen reader. | 🟢 Minor | Advisory: a "Part of …" badge in the tile foot would be the same badge the card uses; a one-line caption hint is a copy decision for the owner. Not in the remediation. |
| D10 **The actions sheet on a phone has no visible title**, so with the card hidden behind the backdrop the sheet does not say whose actions it holds (`aria-label` names it for AT). | 🟢 Minor | Advisory: a visible sheet header from `triggerLabel` below 834 px. Not in the remediation. |
| D11 **The phone pager's chip row scrolls without saying so**: at 390 the fourth chip is off-screen and the row has no edge fade, unlike the board track. "Column 1 of 4" under the heading is the only hint. | 🟢 Minor | Advisory: the same `data-overflow` fade the track uses. Not in the remediation. |
| D12 **The scroll-end button floats over the last visible column** at mid-height, where it can sit on a card's controls. | 🟢 Minor | Advisory; it only exists while there is more board to the end. |
| D13 **"Add a milestone to {title}" splits into two columns at 390 px.** The button is a flex row and `WithValue` renders the sentence as template text plus a span, so the two halves become separate flex items that wrap side by side ("Add a milestone to" left, the title right). Observed. | 🟢 Minor | One `<span>` around the whole sentence, so it is a single inline box that wraps as a sentence. R5. |

### Visual Hierarchy

- **What draws the eye first**: the Done column's steel cap and, on a form, the single filled
  primary button — correct in both cases; there is exactly one solid object per screen.
- **Reading flow**: heading → count → columns left to right (right to left in Hebrew, with the
  chevrons, the drag handle and the edge fade mirrored — verified); inside a card, title → description
  → badges → assignee, with the hairline above the meta row doing the separation. The owner's
  four-button strip under every column header is the busiest element on the board; deviation 5
  justifies it, and it is owner-only.
- **Emphasis**: right. Titles are the only condensed, heavy text on a card; badges are 12 px and
  quiet; the due-soon and overdue tints are the only warm colour on the page and therefore carry
  weight — which is why the due-soon badge should also *say* it is soon (A3).
- **Whitespace**: consistent at the 0.85 density everywhere except the goal plate (D1), where it is
  absent.
- **Type in Hebrew and Russian**: the platform fallback for headings is expected and documented;
  Russian headings on `/members` at 390 are large and heavy relative to the Latin ones, but wrap
  cleanly. Nothing clips or overlaps in the 120 non-English screenshots.

### Consistency

| Element | Issue | Recommendation |
|---------|-------|----------------|
| Spacing tokens | `--gt-space-5` is used by `.goal-plate` but never defined; the scale skips 5, 7, 9–11 | Define `--gt-space-5: 17px`; leave the rest undefined until used. |
| Colour rule 1 (no hex outside the token blocks) | `.column.column-done .column-header h2`, `.column-count` and `.done-check` hard-code `#f2f2f3`; the dark `button.primary:hover` block hard-codes `#14191d`, which is exactly dark `--gt-on-accent` | Add `--gt-on-steel: #f2f2f3` to both theme blocks and use it in the three places; use `var(--gt-on-accent)` in the hover rule. |
| Design-system text vs. stylesheet | The doc says borders are 3:1 in both themes (false in dark, A2); says each due state has its own sentence (false for due-soon, A3); says the address in the card meta ellipsises (true only once the column cannot grow, A6); says a badge is never a flex container (still true after the fixes here — the fixes change only `max-inline-size`, `overflow`, `text-overflow` and, in lists, `white-space`) | Update the three sentences in the same change that fixes them; add deviation 12 (round radios) and a note on the `.board` positioning. |
| Badge behaviour | One `.badge` rule serves three contexts with different needs: card and chip badges should truncate, status badges in lists should wrap | Context rules (`.card-badges`, `.milestone-cards`, `.list`) over the shared base. |
| `disabled` vs `aria-disabled` | Both structural and transient states use the real attribute, which is what strips focus | Structural: `disabled`. Transient (pending): `aria-disabled` + guard. Write the rule into the accessibility floor. |
| Dictionaries | Four keys are unused (`app.confirm`, `app.required`, `app.offline`, `account.language`); harmless | Housekeeping, optional. |
| Step indicator | `flow.step` appears on step 2 only (D7) | Show it on step 1. |

### Accessibility

- **Color contrast**: every text pairing passes in both themes (≥ 5.78:1 light, ≥ 5.91:1 dark);
  the light theme's borders pass (≥ 3.71:1); the dark theme's `--gt-line` fails on card and plate
  grounds (2.81 / 2.41) — A2.
- **Touch targets**: no interactive element under 24 × 24 px in any of the 180 rendered states;
  44 px wherever the stylesheet promises it (phone sheets, dialog footers, toggles, chips, tiles).
- **Text readability**: 15 px body at 1.6 (1.65 in Hebrew), 13 px help, 12 px labels and badges,
  16 px inputs (no iOS zoom). The 11 px micro size is used only for the held-marker chip and the
  menu group label. Card descriptions clamp at two lines by design.

### What Works Well

- The token discipline is real: colours, spaces, radii and durations come from `--gt-*`, logical
  properties mirror the whole interface for Hebrew from one stylesheet, and the four directional
  icons flip — verified at every width in `he`.
- Bidi handling of member text is careful and correct: `dir="auto"` on titles, isolated LTR spans for
  addresses and codes, Russian guillemets hugging the title, Hebrew sentences naming the object before
  the member's text so agreement is never guessed.
- The card carries two controls, the actions menu implements a complete and correct keyboard model
  (measured), and the drag-and-drop path is announced at pick-up, hover and cancel in the interface
  language — rare in a Kanban board.
- The recovery-phrase step is well designed: steel-capped one-time block, `dir="ltr"` mono, a Copy
  button that announces, and a confirm-by-retyping field with plain help.
- Focus rings are visible on every control against every ground in both themes, and `main`
  receives focus on every navigation.
- The phone treatment — column pager, bottom sheets for the menu and dialogs, 56 px sheet rows —
  is the right shape, and dark mode is a palette, not an inversion.

### Priority Recommendations

1. **Repair the two visible defects and the two invisible states** — goal-plate padding, sideways
   scroll, radio checked state, and the focus loss from transient `disabled` — because they are what a
   member meets first and they affect every input method.
2. **Close the feedback loop** — page titles, announcements for column changes / carousel /
   invitations / upload failures / the phrase step, and focus that lands somewhere useful after a
   move or a delete.
3. **Bring the dark theme up to the documented floor and make badges robust to member text**, then
   record all of it in `docs/design-system.md` so the next change works inside the corrected system.

---

## Consolidated remediation list (feeds the one-shot prompt)

Ordered from most critical to regular. Each item names the findings it closes.

| # | Priority | Change | Closes |
|---|----------|--------|--------|
| R1 | Critical | Token-drawn round radio with a visible checked state | A1, D3 |
| R2 | Critical | Define `--gt-space-5` | A7, D1 |
| R3 | Critical | `aria-disabled` + guard instead of `disabled` on every transient-pending control (`Submit`, milestone toggle, column strip, Revoke, Deactivate, Add images); stop disabling unrelated controls | A8, D2 |
| R4 | Critical | Contain the visually-hidden spans: `.board` and `.card-list .card` positioned | A5 |
| R5 | Major | Column minimum size; badge truncation / wrapping; description wrapping; the add-milestone sentence as one inline box | A6, D5, D13 |
| R6 | Major | Focus after cross-column move, after deletes, after column moves | A9 |
| R7 | Major | Allowed-address validation through `Field`'s `error`, no per-keystroke alerts | A14 |
| R8 | Major | Associate the five select errors | A15 |
| R9 | Major | Pager Previous/Next names + "column shown" announcement | A10 |
| R10 | Major | Per-route `document.title` | A18 |
| R11 | Major | Announcements: columns, carousel, invitation, upload failure; phrase-step focus | A19, D6 |
| R12 | Regular | Dark `--gt-line` / `--gt-notice-line` → `#6f8190`; `--gt-on-steel` token; recover legend; step 1 of 2 | A2, A17, D7, consistency |
| R13 | Regular | Due-soon sentence; Escape in drag instructions; carousel alt | A3, A12, A4 |
| R14 | Regular | Menu group semantics | A20 |
| R15 | Regular | Unpressed toggle marker | A21, D4 |
| R16 | Regular | `docs/design-system.md` kept in step; verification matrix | consistency |

Advisory, deliberately not in the prompt: A11 (inert), A13 (language select), A16 (asterisk legend),
D8 (delete titles), D9 (tile goal badge, caption hint), D10 (sheet title), D11 (chip-row fade), D12
(scroll-end placement).

## Evidence notes

- Overflow measurements: `/board` 834 px, four columns, `en`/`he`/`ru`, light and dark: document
  scrollWidth 1049 vs clientWidth 834; `.board-track` scrollWidth 1022 with the track itself 780 wide;
  the only elements past the edge outside `.board`'s scroll were the `.visually-hidden` spans' static
  positions. With `.board { position: relative }` injected: 0.
- Long-text measurements at 1440: column widths `[363, 510, 320, 320]` with a 57-character address
  and an 80-character milestone title; `[320, 320, 320, 320]` with R5 injected, badge `scrollWidth >
  clientWidth` (ellipsis active), address ellipsised.
- `/goals` 390 with a 200-character card title chip: overflow 576 px → 0 with R5. `/members` 390 `ru`:
  56 px → 0 with `.list .badge { white-space: normal }`.
- `.goal-plate` computed `padding: 0px` at every width; `17px` with the token defined.
- Focus log (Chromium 1194): toggle → `BODY` during and after; dialog Save → `BODY` during, title
  button after success, `BODY` after a field error; move-to-column → `BODY`; move-up → trigger;
  delete → `BODY`; column move → `BODY`; carousel → Close on open, tile on close, regions empty after
  a step; invitation → `BODY`, regions empty, callout present; login failure → `BODY`; register →
  phrase step: `BODY`, regions empty.
- Radios: `input[type=radio]` checked `true` / `false` in the DOM, both rendered as identical empty
  squares at 24 px in light and dark; a dot appears with R1 injected.

---

## The remediation prompt, and its adversarial review

The findings above are closed by `prompts/fix-accessibility-and-design-review.prompt.md` (R1–R16 in
priority order; the eight advisory items are named there as out of scope), with
`prompts/fix-accessibility-and-design-review.apply.py` as a mechanical copy of its code edits that
exists only to validate them — the prompt is applied by hand. Both are on the owner's machine under
the Git-ignored `prompts/`, as the project keeps its prompts.

**Validation of the prompt's code (2026-09-19).** The script's exact-match replacements were applied to
a fresh clone of `fe17b86` (every "find" snippet matched exactly once); on the result `tsc --noEmit`,
`eslint`, `check:i18n` (338 English keys), `vite build` and `vitest run` (22 files, 270 tests) all
passed, `git diff --check` was clean, and the built bundle, served through the same mock as the
review, re-measured: `document.title` per route; focus kept on the pending Submit inside the modal
and on a failed sign-in; focus on the toggle after toggling; focus on the moved card's menu after a
cross-column move, on the column's add button after a card delete, on the pressed strip button after
a column move (its Rename neighbour once it is disabled; the column's chip on a phone), on `Add a
goal` / the plate's add button / `Add images` after the other deletes; the column, carousel,
invitation and recovery announcements; the phrase step's and the done panel's heading focus; no
document overflow in any of the 180 route × width × locale × theme states, including `/members` in
Russian at 390 and a board with an 80-character milestone badge and a 57-character address; goal
plates at 17px; round radios with the dot and the hover cue in both themes; the menu's labelled
`role="group"` with its hairlines; the allowed-address box with `aria-invalid` and `aria-describedby`
and no `role="alert"` while typing.

**Adversarial review (independent pass, Chromium 141 against the patched build).** Verdict before
fixes: *ready with fixes* — the code half held (every quoted original matched, all seventeen
`disabled={pending}` sites covered, hook order stable, ids unique, contracts intact, i18n parity and
Hebrew/Russian register correct, no secret or seat touched); the operational half had five real
problems and fifteen polish items. All twenty were folded into the prompt:

1. A Step 6 self-check grep matched `aria-disabled` and would have read as a failure → an exact
   regex, and the expected twelve `aria-disabled` lines named.
2. The three-commit split relied on interactive `git add -p` → commits at the step boundaries, each
   intermediate state verified to pass the checks on its own.
3. The test-Worker pass could have led an executor to confirm a credential rotation on the smoke
   owner → an explicit `/account` bullet that stops before confirming.
4. "Tab reaches both radios" is false in the native radio model → reworded to the arrow-key model,
   with an instruction not to add `tabindex`.
5. Production deploy was not gated on the browser pass having run → gated explicitly.
6–20. The radio lost the hover cue every input has (a hover rule restored); the dot's transition was
   a twelfth motion (dropped); the floor bullet promised `aria-busy` on controls that do not get it
   (reworded); `AGENTS.md` still said "eleven deviations" (updated); the recovery done panel dropped
   focus (its heading now takes it); a phone column move fell to `main` (the column's chip is a
   candidate); a hex value in a comment (removed); an ambiguous paragraph reference in the
   design-system edit (named); `/` and production's `/bootstrap` would have read as title/step
   defects (excepted); the production URL, rollback command and execution-log update were missing
   (added); the commit trailer hard-coded one session (now the executor's own); a missing `reviews/`
   could have been reconstructed (now a stop); "delete an image" could have hit a pre-existing one
   (now the uploaded `ZZ a11y` image); the select-error placement in `GoalsPage` was under-specified
   (named); the pager button strings are noun phrases beside the dictionaries' verbal-noun buttons
   (kept — `vision.previous` sets the same precedent).

**Verdict after fixes: ready to execute.** What the prompt still cannot prove by itself — and says
so — is anything that needs the real Worker, another engine or a screen reader: CI, the test-Worker
and production passes, Safari and Firefox, the assertive upload-failure announcement on a real file,
and how the announcements sound.

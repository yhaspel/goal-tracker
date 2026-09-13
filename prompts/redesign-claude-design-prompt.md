# Full UI/UX redesign + design system — "Goal Tracker" (repo: goal-tracker)

Design a complete visual redesign and a reusable design system for an existing, shipped web app. Everything you design must map onto the app that already exists — same routes, same features, same rules. This is a redesign, not a product redesign: no new features, no invented screens, no decorative controls that do nothing.

**Source of truth:** https://github.com/yhaspel/goal-tracker

Read these before you draw anything:

- `web/src/` — `App.tsx`, `router.tsx`, `WelcomePage.tsx`, `board/BoardPage.tsx`, `board/CardDialog.tsx`, `auth/*.tsx`, `members/SettingsPage.tsx`, `components/ui.tsx`, `i18n/LanguageSelector.tsx`
- `web/src/i18n/en.ts` and `he.ts` — every string in the product, in English and Hebrew. Use these exact strings as your copy, with one exception: the product is being renamed (see §7, artboard 2), so the `app.name` string is the one string that changes. Do not write other new copy except where a new component genuinely needs a label; flag any such addition in a note.
- `web/src/style.css` — the current styling, so you know exactly what you are replacing.
- `shared/api.ts` — the data model and every field that exists.
- `development-plans/personal-business-goals-dashboard-master-plan.md` — product scope and the explicit non-goals.

Everything below is also stated inline, so you can work from this brief alone if the repo is unavailable.

---

## 1. What the product is

A private, shared Kanban board for one household or small working group. **Up to seven active people, including the owner.** One group, one board. Everyone sees and edits the same board.

- **Roles:** `guest` (not signed in), `member`, `owner` (exactly one; the group's admin).
- **Members** can create, edit, assign, move and delete cards.
- **The owner** additionally manages the allowed-email list, invitations and people, and is the only one who can add, rename, reorder or delete columns.
- **The board** starts with To do / In progress / Done. Columns can be renamed to anything; built-in names are translated until renamed. At least one column must always exist; a board holds at most 20 columns and 500 cards.
- **A card** has only: title (1–200 chars), optional description (up to 4,000 chars), optional assignee (one active member), column, and position. That is the entire card.
- **Joining is invitation-only.** The owner adds an address to an allowed list, generates a single-use 32-character invitation code, and hands it over in person. **The app never sends email.** There is no email verification and no email password reset.
- **Recovery is a 12-word phrase**, shown exactly once at sign-up and re-typed to confirm. If someone loses both password and phrase, the owner arranges a manual reset code that expires in 15 minutes.
- Everything is concurrent: the board carries a revision number, and a stale edit is rejected and reloaded rather than silently overwriting someone else's work.

The interface ships in **English, Hebrew and Russian**. Hebrew is right-to-left and flips the whole layout.

## 2. Why it's being redesigned

The app is feature-complete and rigorously accessible, but it looks like an unstyled prototype: one flat blue, system font, hairline borders, no dark mode, no motion, no hierarchy, no personality. On a phone the board is a horizontal strip of 17rem columns, and every card carries five small controls in a row (edit, move up, move down, a move-to-column dropdown, delete).

**Target feel: simple, inviting, engaging, and fun.** This is a board a family opens every day, not an enterprise tool. Warmth, a clear sense of progress, and small moments of delight — never at the cost of legibility, reachability, or the accessibility floor in §4.

## 3. Hard constraints — do not design around these

**Routes.** The server serves the app shell for exactly these eight paths and 404s everything else. Design these and only these:

| Path | Who | Screen |
|---|---|---|
| `/` | guest | Welcome |
| `/login` | guest | Sign in |
| `/register` | guest | Join with invitation → recovery phrase step |
| `/recover` | guest | Recover account (phrase **or** owner-issued reset code) |
| `/bootstrap` | guest, once ever | Set up the owner account → recovery phrase step |
| `/board` | member | The board |
| `/account` | member | Your account |
| `/members` | owner only | Settings (allowed addresses, invitations, people) |

**Features that do not exist. Never draw them:**
due dates, reminders, calendars, labels/tags, priorities, subtasks or checklists, attachments or images, comments, activity feeds, notifications or a bell, search, filters, sorting, multiple boards or projects, goals/progress bars/streaks/gamified scores, archives, card colors chosen by users, profile photos, display names, "Sign up" without a code, "Forgot password — we'll email you a link", social sign-in, real-time presence/cursors, analytics, admin dashboards, export, dark/light toggle placement you invented without wiring (see §7 — it is a real, saved setting only if you say how; otherwise follow the OS).

**No no-op controls.** Every button, link, menu item, icon and field in every mockup must correspond to a real action in this app. If a control is not in the code, it is not in the design.

**Identity is an email address.** There are no display names, no profile pictures, no initials stored anywhere. If you want an avatar, it must be derived purely from the email string — say exactly how (e.g. first letter of the local part, color hashed from the address) and show what it does with long addresses and non-Latin locals. Assignee fields, member lists and invitation rows all show email addresses, which are long, must stay left-to-right even in Hebrew, and need a stated truncation rule.

**Nothing may require dragging.** Drag is a convenience. Every card keeps explicit, keyboard- and screen-reader-operable equivalents: move up, move down, move to another column. The drag handle is a small real button inside the card, never the card itself.

**Implementation target.** React 19 + Vite, a single hand-written CSS file, CSS custom properties, CSS logical properties (`margin-inline`, `padding-block`, `inset-inline-start`) so RTL mirrors without a second stylesheet, and `@dnd-kit/react` for dragging. **No Tailwind, no component library, no icon package, no web fonts that need a network the app can't guarantee** — if you specify a font, give a system fallback stack that covers Latin, Hebrew and Cyrillic, and make the design hold up in the fallback. Icons must be inline SVG you specify. Deliver tokens as CSS custom properties, not as framework config.

## 4. Accessibility floor — WCAG 2.1 AA, already achieved, must not regress

Annotate these on the canvas; treat them as acceptance criteria, not aspirations.

- Contrast: 4.5:1 for body text, 3:1 for large text, UI borders and focus indicators — **in both light and dark**. State the measured ratio for each token pair you rely on.
- A visible focus indicator that survives every background in your palette (today: 3px solid outline, 2px offset). Never remove outlines.
- Minimum interactive target 24×24px absolute floor; design to 44×44px for anything touched on a phone. Short words in Hebrew produce tiny links — size the control, not the text.
- Error state is never color alone: a marker character or icon plus a heavier border plus text.
- Dialogs: labelled, modal, trap Tab, close on Escape, return focus to the opener, and fall back to the main landmark when the opener no longer exists (deleting a card removes its own delete button).
- A skip link to main content, visible on focus.
- Two live regions (polite for saves and successful moves, assertive for failures and conflicts). Show where announcements originate and what they say.
- A busy submit button keeps its label — it must not rewrite its accessible name mid-action. Busy is conveyed by `aria-busy` plus a marker that respects reduced motion.
- Respect `prefers-reduced-motion`: every animation you specify needs a defined reduced-motion fallback.
- No text in images; no meaning carried only by icon.

## 5. Trilingual and RTL

- Layout must mirror wholesale for Hebrew via logical properties. Directional icons (arrows, chevrons, move-to-column indicators, drag affordances) mirror; non-directional ones don't. Say which is which.
- User-authored text (card titles, descriptions, custom column names) renders `dir="auto"` — a Latin title inside a Hebrew interface must read correctly, and vice versa. Show a mixed-script card.
- Email addresses, invitation codes, reset codes and recovery words stay LTR and bidi-isolated inside RTL sentences. Show one.
- The language selector is reachable by guests too — someone has to read the join and recovery screens before they have an account. Language names appear in their own language: English / עברית / Русский.
- Type: Hebrew has no italics, no case, different x-height and no small-caps; Russian words run long. Your type scale and every fixed-width control must survive all three. Show the nav and the primary buttons in all three languages at the tightest breakpoint.
- Dates and numbers are locale-formatted.

## 6. Visual direction — explore, then commit

**Artboard 1 is three style tiles.** Three genuinely distinct directions for this product (not three tints of the same idea), each showing: palette with roles, type pairing, a board card, a primary and secondary button, and one column header. Name each direction and write two lines on what it optimizes for. **Then state your recommendation and why, and build every other artboard in the chosen direction.** Leave the unchosen tiles on the canvas.

Anchor points, whichever way you go: warm rather than corporate; typographic clarity over ornament; a clear, satisfying sense of a card moving toward Done; restraint in the number of colors and shadows; nothing that would embarrass an adult using it in front of colleagues.

## 7. Deliverables — the artboard plan

One canvas, artboards laid out in labeled rows, named `NN · Section · Name`. Desktop artboards 1440×1024, tablet 834×1112, phone 390×844. Use real, plausible content — never lorem ipsum, never empty gray placeholder blocks.

**A. Foundations**
1. Style exploration — three tiles + recommendation (§6).
2. Brand identity — **the product is named "Goal Tracker"** (the code currently reads "Family board" in `app.name`; that string is being replaced). Design the wordmark, a logo mark, the app icon at 512/180/32, and the favicon, and use the name consistently on every artboard after this one. The app ships in three languages, so also propose how the name renders in Hebrew and Russian — transliterated, translated, or kept Latin in all three — and say which you recommend and why. Check that whatever you choose still sits correctly in the RTL header next to the nav.
3. Color tokens — full light and dark ramps, every token named by role (surface, raised surface, ink, ink-soft, line, accent, accent-ink, danger, warning, notice, success). Contrast ratios printed next to each pair. Dark is a first-class palette, not an inversion.
4. Typography and spacing — scale, line heights, the Latin/Hebrew/Cyrillic font stack, the spacing and radius scales, and the breakpoint table.
5. Iconography, elevation and states — the inline SVG icon set you actually use (and nothing more), elevation/shadow steps for both themes, and the shared interaction states: rest, hover, focus-visible, active, disabled, busy.

**B. Components**
6. Component library sheet — every control in the app, every state, both themes: text input, textarea, select, radio group, checkbox, primary/secondary/danger/icon button, submit-busy, link, badge (with the four invitation statuses and the two member statuses), alert (error/notice), inline field error, help text, callout, warning block, one-time-secret block with copy button, list row, skip link, language selector, header/nav, dialog shell (header, body, footer), live-region toast or status line.
7. Board components — card (rest, hover, focus, dragging, drop target, mid-flight ghost), column (header, count, empty, owner controls), the add-card and add-column affordances. Include the card's **full anatomy**: title up to 200 characters, optional description up to 4,000 characters (state the truncation and expansion rule), assignee email, drag handle, and all card actions. Solve the clutter problem: five separate controls per card is the thing being fixed — but every action must stay reachable without drag, operable by keyboard, labelled for screen readers, and within target size. If you use an overflow menu, show it open, specify its keyboard behavior, and keep edit reachable in one step.

**C. Screens — desktop (one artboard each)**
8. Welcome `/` — both variants: before any owner exists (offers owner setup) and after (sign in / join).
9. Sign in `/login` — including the "this app never sends email, there is no reset link" reality and the route to `/recover`.
10. Join with invitation `/register` — 32-character code, email, password (min 12 chars), plus the explanation of how a code is obtained.
11. Recovery phrase step — the 12 words shown once, copy control, the "only time it will be shown / not saved in this browser / support cannot look it up" warning, and the confirm-by-retyping field. Use obviously fake words. This screen carries the highest stakes in the product; design it like it. It is **one shared component reused in four flows** — joining, owner setup, recovery, and rotating credentials from Account — each with its own surrounding heading and footnote. Design it once and show how the four framings differ.
12. Owner setup `/bootstrap` — setup secret, email, password, then the same phrase step.
13. Recover `/recover` — the two-method choice (own phrase vs. owner-issued 15-minute reset code), the relevant fields for each, and the success state.
14. Board `/board` — as a member, with a realistic amount of content (see §9).
15. Board `/board` — as the owner, showing the column controls that only they see.
16. Card dialog — create and edit, with title, optional description, assignee select, cancel/save.
17. Account `/account` — password change, phrase-only regeneration, interface language, and the warning that finishing signs you out on every device.
18. Settings `/members` — the whole owner screen: allowed addresses (the API replaces the **whole set** at once with a revision check, so whatever row-editor you design must still submit as one list and handle "the list changed elsewhere"), a removal warning, invitations (create, one-time code display, list with status and expiry, revoke), and people (seats in use, roles, status, deactivate).

**D. Screens — mobile, 390×844 (one artboard each)**
19. Mobile board — **the centerpiece.** Today it's a horizontal strip of narrow columns. Solve it properly: propose and show a real pattern (column pager with swipe and a visible column switcher, a stacked accordion, or whatever you can defend), and state how someone moves a card between columns on a phone without drag. Show the column switcher, the card list, and the add-card affordance.
20. Mobile card dialog / bottom sheet — including the keyboard-open state.
21. Mobile card actions — the overflow or action surface, open.
22. Mobile sign in + join.
23. Mobile recovery phrase step — 12 words on a 390px screen with a copy control and a confirm field is the hardest layout in the product.
24. Mobile account + settings — including the allowed-addresses editor and the invitation-code hand-off.
25. Tablet 834px — board only, showing how the desktop grid degrades.

**E. States, empties and edge cases (group onto 2–3 artboards)**
26. Empty and loading — first-load skeleton or loading state, board with no cards at all, an empty column, no invitations yet.
27. Errors and conflicts — offline banner; network failure; session expired; rate-limited; service unavailable; **the revision conflict**, where the board reloaded under you, your move was rejected, and your unsaved card text was deliberately kept for review; delete confirmations for card and column ("the column must be empty first"); seats full; an address removed from the allowed list while its account still holds a seat; a deactivated member; a no-longer-assignable assignee still shown on a card until changed.
28. Limits — board full (500 cards), maximum columns reached (20), last remaining column (delete disabled), more than 7 allowed addresses, duplicate or malformed address in the list.

**F. Hebrew / RTL**
29. Board in Hebrew, fully mirrored, including a mixed-script card (Hebrew title with a Latin word, Latin title in the Hebrew UI) and an LTR-isolated email in an RTL sentence.
30. Settings + recovery phrase in Hebrew — the two most text-dense screens.
31. RTL rules sheet — which icons mirror, which don't; the isolation rule for emails, codes and phrases; how `dir="auto"` content sits inside mirrored chrome; Hebrew-specific type notes.

**G. Motion and flows**
32. Motion spec — card pick-up, drag-over, drop and settle; rejected-move return; column change; dialog open/close; sheet present/dismiss; toast/announcement timing; the save-busy indicator; a small, tasteful Done moment. Durations, easing, and the `prefers-reduced-motion` fallback for every one.
33. Flow boards — `join → code → password → phrase → confirm → board`, and `owner: allow address → create invitation → hand over code → person joins → seat used`, drawn as annotated screen sequences.

**H. Handoff**
34. Dev handoff sheet — the complete token list as CSS custom properties (light and dark blocks, ready to paste), a component-by-component spec (sizes, spacing, radii, states, the class or component it maps to in `web/src/components/ui.tsx`), the breakpoint table with what changes at each, and a short, ordered implementation plan for replacing `web/src/style.css` without touching behavior.

## 8. Responsive system

- Mobile-first tokens; phone (≤390), large phone, tablet (834), desktop (1440), wide.
- The page never scrolls horizontally. If anything scrolls sideways it is one contained region, deliberately, with a visible affordance.
- Inputs are at least 16px on iOS so focusing never triggers zoom; comfortable touch heights throughout; respect safe-area insets at the bottom of a phone.
- Nothing hides behind hover: every hover affordance has a tap and a keyboard equivalent.
- Say what the header/nav becomes on a phone, given it must carry brand, up to four nav items, a language selector and the signed-in address.

## 9. Sample content — use this, consistently, everywhere

Owner `yuval@example.com`; members `dana@example.com`, `maya@example.com`, `eitan@example.com`. Seats: 4 of 7 in use.

Columns: **To do** / **In progress** / **Done** (plus one renamed column, e.g. **Waiting on someone**, to prove custom names).

Cards (English canvas): "Book the dentist for Maya" (Dana), "Renew the car insurance" (unassigned), "Fix the bike's back brake" (Eitan, with a two-line description), "Plan the Friday dinner shopping list" (Yuval, long description that needs truncation), "Call the plumber about the kitchen tap" (Dana), "Return the package to the post office" (done).

Hebrew canvas: "לקבוע תור לרופא שיניים למאיה", "לחדש את ביטוח הרכב", "לתקן את הבלם האחורי באופניים", and one deliberately mixed card: "להזמין כרטיסים ל-Tel Aviv Marathon".

Use fake values for anything secret: invitation code as 32 obviously-dummy characters, recovery phrase as 12 plainly fake words.

## 10. Definition of done — check before you finish

- [ ] Three style directions explored, one recommended, and every screen built in it.
- [ ] Every one of the eight routes designed at desktop **and** phone width.
- [ ] Light and dark palettes both designed, with contrast ratios stated.
- [ ] Hebrew RTL artboards present, including mixed-script and LTR-isolated content.
- [ ] Every card action reachable without dragging, by keyboard, at ≥24px (44px on touch).
- [ ] Empty, loading, error, conflict, limit and confirmation states all shown.
- [ ] Motion specified with reduced-motion fallbacks.
- [ ] Handoff sheet contains paste-ready CSS custom properties and a spec for every component.
- [ ] **Zero controls that do nothing.** Walk the canvas once and delete any button, link, icon or field that has no counterpart in the codebase.
- [ ] Copy taken from `web/src/i18n/en.ts` / `he.ts`; the product named "Goal Tracker" throughout; any other new string flagged as an addition.

Where you deviate from anything in this brief, do it deliberately and leave a short note on the canvas saying what you changed and why.

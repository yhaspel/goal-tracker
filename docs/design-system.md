# The interface design system

Every visible change to this application is made inside the system described here. The
authority is `web/src/style.css` — its `:root` blocks are the tokens, and this document explains
what they mean and which rules a change must not break. When the two disagree, the stylesheet is
right and this document is stale; fix it in the same change.

## What the system is

Industry, in its "Worksheet" direction: steel-blue on a light technical ground, Barlow Condensed
headings over Barlow body, a modular grid, and cards, columns and buttons framed as blueprint
objects — square-cornered, hairline-bordered. Columns are tinted plates and the card is a raised
paper slip. That tone is the whole source of warmth: there is no decorative colour beyond the
one steel accent and the three status roles.

The design canvas it was drawn from lives outside the repository, and so does the plan that
applied it: `prompts/apply-design-system.prompt.md`. Like everything under `prompts/` and
`development-plans/`, that file is on the owner's machine and absent from a clone by design, so
it is named here rather than linked. This document is the part that ships, and it is where
anything about the interface that must outlive a plan belongs.

## Rules a change must not break

1. **Tokens, not values.** No hex, no font name, no raw pixel that a `--gt-*` variable already
   carries. If a change needs a value the tokens do not have, add the token in both theme blocks
   and say why here — never one theme only.
2. **Square.** `--gt-radius` is `0` and applies to cards, columns, buttons, inputs and the
   dialog. Only `.badge` and the avatar chip take `--gt-radius-chip` (2px). Nothing is a pill.
3. **Logical properties.** `margin-inline`, `padding-block`, `inset-inline-start`, and so on.
   The interface mirrors for Hebrew from one stylesheet; a `margin-left` is a bug. Icons that
   point along the reading direction carry `icon-mirror`.
4. **One accent.** `--gt-accent` is chrome and icons only — it is 3.7:1 on the ground and cannot
   carry body text. Links, the primary fill and any accent-coloured text use `--gt-accent-ink`.
   `--gt-steel` is reserved for the Done cap and the app mark.
5. **Both themes, always.** Dark follows `prefers-color-scheme`. There is deliberately **no
   theme toggle**: `PreferencesResponse` stores only `language`, so a saved theme would have
   nowhere to live, and a toggle would need a new server field.
6. **Zero controls that do nothing.** If it is not wired to code, it is not in the interface.
   In particular there is still no checkbox anywhere. The product has exactly two choice
   controls: the `/recover` radio pair, and the milestone Open/Done toggle — which is a
   **button** with `aria-pressed`, not a checkbox, and no per-row allowed-address editor (the API
   replaces the whole set against a revision).
7. **Copy comes from the dictionaries.** Every visible string is a key in
   `web/src/i18n/en.ts`, `he.ts` and `ru.ts`. A new string needs all three before it builds;
   `npm run check:i18n` enforces it.

## Tokens

Read them from `web/src/style.css`. The roles, rather than the values:

| Role | Token | Use |
| --- | --- | --- |
| Ground | `--gt-surface` | The page |
| Card | `--gt-raised` | Cards, panels, the header, dialogs, menus |
| Column | `--gt-plate` | A built-in column's plate; a renamed column drops the tint |
| Text | `--gt-ink`, `--gt-ink-soft` | Body, then help and meta |
| Control edge | `--gt-line` | The border of anything interactive — never `--gt-line-soft` |
| Decorative rule | `--gt-line-soft` | Hairlines between content. 1.2:1, so nothing structural |
| Accent | `--gt-accent` | Chrome, icons, the column underline. Not text |
| Accent ink | `--gt-accent-ink` | Links, the primary fill, accent-coloured text |
| Pressed accent | `--gt-accent-deep` | Hover and active one and two ramp steps on |
| Steel | `--gt-steel` | The Done cap and the app mark, and nothing else |
| Focus | `--gt-focus` | The ring. 8.8:1 light, 12.1:1 dark |
| Status | `--gt-danger`, `--gt-warning-*`, `--gt-notice-*`, `--gt-success` | Each with a `-fill` |

Spacing is Industry's 0.85 density: `--gt-space-1` (3.4px) through `--gt-space-12` (40.8px).
Elevation is `--gt-elev-sm|md|lg`; on a dark ground shadow is inert, so those steps add a 1px
inset top highlight instead. Motion is `--gt-dur-fast|base|slow` with `--gt-ease-out` and
`--gt-ease-in-out`.

The six variables the original stylesheet was written against (`--ink`, `--paper`, `--surface`,
`--line`, `--accent`, `--radius`) survive as aliases so nothing had to be migrated in one
commit. Write new rules against the `--gt-*` names.

## Type

`--gt-font-head` is Barlow Condensed for headings; `--gt-font-body` is Barlow for everything
else; `--gt-font-mono` for codes and phrases. Both faces are **self-hosted** from
`web/public/fonts/` as woff2 subsets and shipped with the build — nothing is fetched from
Google Fonts at runtime, and a UI change must not reintroduce a font request the app cannot
guarantee.

Google Fonts publishes Barlow and Barlow Condensed in latin, latin-ext and vietnamese only.
There is **no Cyrillic cut**, so Russian falls through to the platform UI face exactly as Hebrew
does, and the design is checked in that fallback. Hebrew headings therefore lose the
condensation and take `letter-spacing: -0.5px` at the same size step, with body copy at
`line-height: 1.65`. Do not add a substitute condensed face for either script.

Scale: display 42 (the welcome screen only), h1 32, h2 25, h3 20, body 15, small 13, micro 11,
labels 12 uppercase. Inputs are **16px** so iOS never zooms a field into focus.

## Layout and breakpoints

| Width | What changes |
| --- | --- |
| ≤ 833 | The board is a column pager, one column at a time. No drag handle exists on a card. The header is the brand plus one menu button, and the nav links, language selector, signed-in address and Sign out move into the sheet it opens. Dialogs render bottom-anchored with a pinned footer. Fields grow to 52px. The gallery is **two columns** |
| 834–1199 | The board is one contained horizontal track at 296px columns, with an edge fade and a scroll-end button. Dialogs are centred modals again. The gallery is **three columns**. **The header is up to two rows** — `.app-header .who` already carries `flex-basis: 100%`, and five nav links plus the language selector and the signed-in address make the second row the normal case, hardest in Russian |
| 1200–1439 | 272px columns, forms cap at 34rem. The gallery is **four columns** |
| ≥ 1440 | 320px columns, the track caps at 1360px and centres |

**Navigation capacity is a height question, not a width one.** `.nav-sheet` carries
`max-block-size: 90vh; overflow: auto` and stacks full-width 56px rows, so a fifth link cannot
overflow it: at 390px an owner's sheet comes to roughly 510–555px against 600px of allowance on
the shortest common phone. Keep `nav.goals` and `nav.vision` to one short word in every locale —
that is the constraint the 834–1199 header actually imposes.

**The page never scrolls sideways.** The board track and the phone pager's chip row are the only
regions in the product allowed to scroll horizontally, and both are contained. That is achieved
by the layout, not by clipping the body, so the verification pass can still see a real overflow
if one is introduced.

`BoardPage.tsx` reads `useMediaQuery('(max-width: 833px)')` as well as the stylesheet. That is
what removes the drag handle from the DOM on a phone rather than merely hiding it, and what
renders one column at a time behind the pager. Anything expressible in CSS alone stays in CSS.

## Components

Classes, and what owns them:

| Class | Component | Notes |
| --- | --- | --- |
| `button`, `.primary`, `.danger`, `.icon` | `Submit` and plain buttons | 44px minimum, 48 in forms. Primary fills with `--gt-accent-ink`; **danger is outlined, never filled**, in dialogs too |
| `.busy-dots` | `Submit` | Three 3px squares. The label never changes mid-request; `aria-busy` is what assistive technology reads |
| `.field`, `input`, `textarea`, `select` | `Field` | 12px label above, 6px gap, 13px help below. Invalid is a 2px danger border plus a `!` marker plus text |
| `.panel`, `.card` | Screens | `.panel.narrow` caps at 34rem |
| `.alert`, `.warning`, `.callout`, `.badge` | `Alert` and screens | `tone="error"` keeps `role="alert"`; notice does not, because the assertive region already carries urgent text. Every badge carries a mark as well as a colour. **`.badge` is `inline-block`, never a flex container** — see the note below |
| `.code`, `.phrase` | `PhraseStep`, `SettingsPage` | The one-time-secret block: 2px accent frame, steel cap, mono, `dir="ltr"` and isolated |
| `.dialog*`, `.dialog-body` | `Dialog` | One component. Below 834px a class and a media query make it a sheet; the focus contract is identical |
| `.nav-toggle`, `.nav-sheet` | `App` | The phone header. One control in both states: it swaps its icon and `aria-expanded`, never its accessible name |
| `.column`, `.column-custom`, `.column-done` | `BoardPage` | Plate, no tint when renamed, reversed steel cap for Done |
| `.card-title-button` | `BoardPage` | The title **is** the edit affordance. Never clamped |
| `.card-description` | `BoardPage` | Clamped to two lines. The full 4,000 characters live in the dialog, one step away — there is no expand toggle |
| `.avatar` | `BoardPage` | Derived purely from the address: first character of the local part, uppercased, on a fill hashed from the whole address. The letter carries the meaning; the colour is decoration |
| `.card-menu`, `.menu`, `.menu-item` | `ActionsMenu` | The actions menu, now shared by the board, the goals screen and the vision board. Anchored to the **viewport**, because the board track is a scroll container on both axes and an absolutely positioned menu is clipped at the column's foot |
| `.pager*` | `BoardPage` | The phone column pager |
| `.card-badges`, `.badge.warning` | `BoardPage` | The due and "part of" badges. Neither is a control, so the card still carries exactly two |
| `.skeleton-*` | `BoardPage`, `GoalsPage`, `VisionPage` | First load only. A background refetch never blanks the screen |
| `.year-strip`, `.year-chip` | `GoalsPage` | The year switcher. It **wraps**; it does not scroll. Its own classes rather than `.pager-*`, which is `display: none` above 834px |
| `.goal-plate`, `.goal-head`, `.goal-title`, `.goal-progress` | `GoalsPage` | One goal. The title is the edit affordance, the same rule the card follows |
| `.meter`, `.meter-fill` | `GoalsPage` | A token-drawn bar **after** a real sentence, `aria-hidden`. Never a native `<progress>` or `<meter>`: their UA chrome ignores every `--gt-*` token |
| `.milestone-group`, `.milestone-row`, `.milestone-toggle`, `.milestone-cards` | `GoalsPage` | Milestones grouped by month. The toggle's visible text and accessible name both name the action and never change; `aria-pressed` carries the state |
| `.gallery`, `.tile`, `.tile-button`, `.tile-foot` | `VisionPage` | Two / three / four columns. Each tile is a `<button>` wrapping an `<img alt="">`, because an image with a click handler is not focusable |
| `.carousel*`, `.dialog-wide` | `VisionPage` | The carousel is a `Dialog` with its own width, so the focus contract is the one already shipped. No autoplay; only the two neighbours are preloaded |
| `.upload-list` | `VisionPage` | Per-file status through `aria-busy` and `.busy-dots`. Not a progress bar: `fetch` cannot report upload progress, and a second HTTP path would bypass the one API client |

Icons live in `web/src/components/icons.tsx`: inline SVG on a 20×20 box at 1.5px stroke. No icon
package, and no glyph that depends on a font. **No icon carries meaning alone** — each sits
beside visible text or inside a control named by an `aria-label` from the dictionary.

### A badge is not a flex container, on purpose

`.badge` is `display: inline-block`, and its `::before` marker is separated by `margin-inline-end`
rather than by `gap`. That is load-bearing for bidi, not a style preference. A badge whose text is
interpolated renders as several children — template text, a `dir="auto"` span holding a
member-written title, more template text. In a flex container each run of text becomes an anonymous
flex item, so `gap` lands between *every* part, not just between the marker and the label. Russian
`card.partOfBadge` is `В рамках «{milestone}»`, and it shipped on 2026-09-15 rendering as
`« title »`, with the guillemets held 3.4px off the title they quote.

Do not "tidy" this back into `inline-flex`, and do not reach for the alternative that looks cheaper:
keeping the flex container with `gap: 0` and a margin on the marker **loses** the space in the
Hebrew and English templates, because an anonymous flex item's leading and trailing whitespace is
stripped and the gap was silently supplying it. Only a badge whose whole label sits in one inline
formatting context is correct.

There is no automated guard. The test suite runs in the Workers runtime with no jsdom, and jsdom
performs no layout, so this class of defect is reachable only by looking at a rendered badge.

### The card carries two controls, not five

Edit, move up, move down, move to column and delete were five separate controls on every card.
They are now the drag handle plus one actions menu, with the title as the edit affordance. Every
one of them calls the same handler it always did; nothing became drag-only. If a change adds a
sixth control to a card, it is going the wrong way — put it in the menu.

The menu ships a keyboard contract that a change must preserve: `aria-haspopup="menu"`,
`aria-expanded`, `role="menu"` with real `<button role="menuitem">` children; Enter, Space or ↓
opens on the first item and ↑ on the last; ↑↓ cycle, Home and End jump, Escape closes and
returns focus to the button, Tab closes and moves on. The current column is omitted from the
move group. Move up and move down are **disabled, not hidden**, at the ends of a list.

## The accessibility floor

This is a floor, not a target. A change may raise it and must not lower it.

- 4.5:1 for body text and 3:1 for borders and large text, **in both themes**.
- A 3px focus ring at 2px offset, never removed, re-checked against any new background.
- 24px absolute minimum target, 44px wherever a finger reaches. An inline link inside a sentence
  is the one WCAG exception, and even those are padded to 24px here.
- Errors are never colour alone: a marker, a heavier border and text.
- Two live regions, mounted once, polite and assertive. Announcement strings are part of the
  behaviour contract — a restyle does not touch them.
- `aria-busy` plus a marker that is still visible under `prefers-reduced-motion`.
- Emails, codes and phrase words are `dir="ltr"` and bidi-isolated inside Hebrew sentences;
  member-written text is `dir="auto"` so it takes direction from what was typed.

## Motion

Eleven motions, no more: card pick-up, drag-over, drop and settle, the rejected-move return, a
column change, dialog open and close, sheet present and dismiss, announcement stamping,
save-busy, skeleton shimmer, one quiet Done moment where the cap's check draws itself once, and
the carousel's image change. No confetti, no counter, no sound. **Never a shake.**

Every one needs a `prefers-reduced-motion` fallback, and **five** of them substitute a static
marker — the picked-up chip, the drop target, the busy squares, the flat skeleton, and the
carousel's position counter. Those markers belong to the component, not to the animation, so they
render in both modes. The counter matters most of the five: with the image transition removed it
is the only thing saying which image is current. The blanket reduced-motion rule that collapses
durations is not on its own a fallback: check that the state is still visible with animation off.

## Deliberate deviations

Do not "fix" these; each is a decision with a reason.

1. Industry's `.btn-primary` is an accent fill on the ground ink at 3.7:1, below AA for a 15px
   label. The primary button therefore fills with `--gt-accent-ink` and keeps the accent for its
   border and hover.
2. Industry ships no dark theme and no danger, warning or success roles. Both were added as
   tokens; dark is built from the accent ramp's deep end rather than inverted.
3. Industry's registration marks (`.blueprint` plus four corner `<i>` children) are not used.
   They are four extra decorative elements inside every card, column and button in a list that
   can hold 500 cards, and they carry nothing.
4. `app.name` is byte-identical in all three locales. A household that mixes languages would
   otherwise see a different product name per person, and the Russian translation does not fit
   the phone header. `tests/web.ui.test.ts` carries an explicit asserted exception for that one
   key, so the never-falls-back-to-English test still covers everything else.
5. The owner's per-column strip is four icon buttons named by the same full dictionary sentences
   they used to show as text. Four sentences like "Move Waiting on someone towards the start"
   cannot be read as visible text inside a 272px column in any of the three languages.
6. The picked-up marker on a dragging card is a grip chip rather than a word, because the
   applied plan fixed the new-string list at nine and none of them is that word.
7. Move up and move down use the real `disabled` attribute — as those controls always did —
   rather than `aria-disabled` plus a reason sentence, because no dictionary string states the
   reason.
8. **The due-date field is a native `<input type="date">`**, which is the one place the interface
   shows browser chrome it does not control: the picker panel is the platform's. The alternative
   is three custom spin fields and a calendar widget, with their own keyboard model and their own
   locale handling, to replace something every platform already does well and accessibly. The
   global `appearance: none` costs it the picker indicator, which the stylesheet draws back on,
   and WebKit's intrinsic-size collapse is answered with an explicit `min-inline-size`.
9. **The file input is visually hidden and labelled by a real `<button>`.** A bare file input
   renders browser-supplied text — "Choose File", "No file chosen" — in the *browser's* language
   rather than the app's, which breaks rule 7 outright, and it cannot be styled to the 44px
   target.
10. **Month and date names come from `Intl`, not from the dictionaries.** Twelve month names in
    three languages is 36 strings that every platform already has, correctly, including their
    grammatical form in a date. `useMonthNames` and `useCalendarDay` in `components/ui.tsx` are
    the only two places that construct a formatter.
11. **`goals.optgroupLabel` and `milestone.optionLabel` are byte-identical in all three locales.**
    An `<optgroup label>` and an `<option>` are plain text, so an element cannot carry the bidi
    isolation and the template has to: each is a separator plus two U+2068/U+2069-isolated
    placeholders, and contains no translatable word. `tests/web.ui.test.ts` names them, with
    `app.name`, as the asserted exceptions to the never-identical rule.

## Verifying a UI change

Run the usual local checks first: `npm run lint`, `npm run typecheck`, `npm run check:i18n`,
`npm test`, `npm run build`. They catch a missing translation and a type error, and nothing
about how the change looks.

Then look at it. The matrix that matters is **ten** routes — `/`, `/login`, `/register`,
`/recover`, `/bootstrap`, `/board`, `/goals`, `/vision`, `/account`, `/members` — × 390 / 834 /
1440 × `en` / `he` / `ru` × light and dark, keyboard only. For anything beyond a one-line tweak,
walk at least the routes the change touches at all three widths, in Hebrew as well as English, and
in both themes, and confirm:

- no horizontal page scroll anywhere;
- no target under 24px;
- the focus ring is visible on every new control, against its own background;
- no icon carries meaning without text or an `aria-label`;
- addresses, codes and phrase words stay left-to-right inside Hebrew sentences;
- every announcement string is unchanged.

A guest session and a signed-in session reach different routes — the guest-only screens redirect
once a session exists — so walk them separately rather than assuming one pass covered both.

State plainly what you checked and what you did not. A passing build is not a browser check, and
neither is a screenshot of one width.

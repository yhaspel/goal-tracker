# Stage 6 completion — localization and accessibility

**Date:** 2026-09-13 (Asia/Jerusalem)
**Plan:** [archived Stage 6 plan](../development-plans/archived/stage-6-localization-accessibility.md)
**Decision:** **Closed by owner decision — not by a passed exit gate.** The plan's exit gate
requires "a manual screen-reader review covering at least one representative desktop workflow
and one mobile workflow, in each of English, Hebrew, and Russian, with findings recorded and
fixed before release." That review was never performed, by this or any earlier session. The
owner asked why it was needed, was given the explanation below, and then instructed that Task B
be marked done. This report records that decision plainly rather than describing the review as
having happened. `AGENTS.md` is explicit — "Do not claim browser, accessibility, or
screen-reader checks that were not performed" — and nothing here claims one did.

## What Stage 6 delivered and verified

Complete English, Hebrew, and Russian dictionaries with a release-blocking CI check for
completeness, placeholders, and plural categories; immediate `lang`/`dir` switching with no
wrong-direction flash; guest and signed-in language persistence; logical-property (`margin-
inline`, etc.) layout verified right-to-left; mixed-script card content rendering; fully
keyboard-operable drag with explicit move-up/move-down/move-to-column alternatives; one polite
and one assertive ARIA live region, with the drag library's own announcer disabled to avoid
duplicates; and Lighthouse accessibility 100, all 26 audits passing, on the board and settings
screens, at both desktop and mobile widths. All of that is automated, locally and/or
CI-verified, and none of it is in question here.

## What remains: the manual screen-reader review

The plan calls for a person operating a real screen reader — VoiceOver, NVDA, or TalkBack —
through at least one desktop and one mobile workflow, in each locale, against the deployed test
Worker, with findings recorded and fixed. No session had a real screen reader or a physical
touch device available, so this was never done. Nothing below substitutes for it.

### Why a structural walkthrough is not the same check

This session ran a best-effort supplement instead: driving the deployed test Worker through a
Chrome browser extension and reading the accessibility tree and raw ARIA/DOM state directly,
rather than listening to a screen reader. That is a genuinely different check, for concrete
reasons:

- A screen reader applies its own heuristics on top of the DOM/ARIA tree — how VoiceOver's
  rotor groups headings and landmarks, whether two identical consecutive live-region messages
  get re-announced, how it walks bidi-reordered visual text versus logical DOM order. None of
  that is observable by querying attributes; it can only be heard.
- Different screen readers handle ARIA live regions, `dir`, and RTL bidi text differently, and
  have their own bugs. Source or DOM inspection cannot surface AT-vendor-specific behavior.
- The tool used this session for the walkthrough turned out to have exactly this kind of gap:
  its own accessibility-tree dump does not appear to honor `aria-hidden` when listing nodes (see
  the duplicate-`id` finding below) — a direct demonstration that a tool's model of "what
  assistive technology sees" can diverge from reality.
- Mobile screen readers navigate by touch gesture (swipe, double-tap), which has no equivalent
  in this session's tooling at all. There is zero mobile coverage from the structural
  walkthrough, on any locale.
- Whether the experience is actually usable — is a label read in a sensible order, does a move
  announcement feel discoverable, is anything read as an opaque identifier — is a judgment only
  a human listening can make. The right ARIA attributes being present is necessary but not
  sufficient for that judgment.

### What the structural walkthrough covered, and found

Desktop only, against `https://family-board-test.yuval3000.workers.dev`, signed in with a
disposable identity from `.secrets.smoke.json`: the full workflow (sign in, create a
mixed-script card, assign a member, save, move it with the explicit controls, move it again with
keyboard drag, delete it) in English, then card creation and a structural check in Hebrew and
Russian. Full detail is in the
[execution log](../docs/stages-2-6-execution-log.md#what-was-verified-where). Three findings
worth a real reviewer's attention first:

1. **A mixed-script title's visual order can diverge from its typed order.** `Buy milk לחלב 2%`
   (English UI, left-to-right base direction) renders visually as "Buy milk 2% לחלב" — the
   Hebrew word and the trailing `2%` swap places under the plain Unicode bidi algorithm, with no
   directional isolation on the field. The mirrored case, `קנייה: 2% חלב Milk` (Hebrew UI,
   right-to-left base direction), rendered in the exact typed order with no reordering. Russian
   is also a left-to-right locale but was not independently exercised for this — it was not
   confirmed to have the same issue, only not ruled out.
2. **The language switcher's own confirmation lags one locale-switch behind the selection.**
   Switching English to Hebrew announced "Language saved." in English; switching Hebrew to
   Russian announced "השפה נשמרה." in Hebrew. Every other live-region message (card saved,
   moved, deleted) updates to the newly selected locale immediately.
3. **Keyboard drag gives no feedback between pick-up and drop.** Space correctly picks up a card
   (a properly `aria-hidden` overlay clone appears; the original's move buttons become genuinely
   `disabled`) and the arrow keys do move it — the card landed in the intended column on drop —
   but nothing announces the pick-up, and nothing indicates the pending target while arrow keys
   are pressed. The only feedback is the final "moved to `<column>`, position `<n>`" announcement
   after dropping.

Minor: the drag-overlay clone shares its DOM `id` with the original (invalid HTML), but this has
no assistive-technology consequence — the clone is correctly `aria-hidden="true"`. The
accessibility-tree dump tool used this session does not appear to honor that attribute when
listing nodes, which is why a direct DOM/ARIA query was needed to tell the two apart, and why
this is recorded as a tool limitation rather than an exposure defect.

None of these three findings are fixed as part of this closure. They are open, carried forward
as residual risk below, not resolved.

## Coverage matrix

The plan asks for a compact matrix of device, locale, direction, keyboard, screen reader, and
mixed-script results. Every "screen reader" cell reads "Not performed" because that is the
literal fact; nothing here should be read as a pass.

| Device | Locale | Direction | Keyboard | Screen reader | Mixed script |
| --- | --- | --- | --- | --- | --- |
| Desktop | English | ltr | Functional: pick-up/move/drop all work; no intermediate feedback (finding 3) | Not performed | Bidi reordering observed (finding 1) |
| Desktop | Hebrew | rtl | Not independently re-exercised beyond card creation | Not performed | No reordering observed (finding 1) |
| Desktop | Russian | ltr | Not independently re-exercised beyond card creation | Not performed | Structural check only; bidi behavior not independently confirmed |
| Mobile | English | ltr | Not performed | Not performed | Not performed |
| Mobile | Hebrew | rtl | Not performed | Not performed | Not performed |
| Mobile | Russian | ltr | Not performed | Not performed | Not performed |

(A separate, unrelated check — Stage 6's own acceptance test for a 320 CSS pixel viewport and
200% zoom — passed locally earlier in the run. That is a visual-layout check, not a screen-reader
or touch-input check, and does not fill any cell above.)

## The decision to close without the review

The owner asked why Task B specifically requires a real screen reader rather than the
structural checks already done, was given the explanation above, and then instructed that Task
B be marked done. Closing Stage 6 this way is an explicit, informed acceptance of the residual
risk described above — not a claim that the risk was resolved or that the review is
unnecessary. The plan's own acceptance criteria for the screen-reader review are not met; this
report exists so that fact stays visible rather than getting lost when the plan and its handoff
are archived.

## Recommended follow-up

A real screen-reader pass — VoiceOver, NVDA, or TalkBack, desktop and mobile, all three locales
— is still worth doing, ideally before or alongside Stage 7. The three findings above are a
reasonable starting checklist for that pass: confirm whether Russian shares English's bidi
reordering, confirm whether any of the three actually matters to a real AT user (the language-
switcher lag and the missing keyboard-drag feedback look like genuine defects independent of
which screen reader is used), and fix what is confirmed. None of the three has been fixed here;
fixing them was out of scope for this closure and was not requested.

## Rollback

Nothing in this closure changes application behavior — no code, migration, or configuration
changed. There is nothing to roll back. Reopening Stage 6 later only means running the review
this report describes as outstanding and fixing what it finds.

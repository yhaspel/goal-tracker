# Interface copy review — English, Hebrew, Russian — 2026-09-15

A full read of every visible string in the three interface dictionaries (`web/src/i18n/en.ts`,
`he.ts`, `ru.ts` — 328 English keys before the review, four plural families), each checked against
where and how it renders: label, select option, badge, dialog title, `aria-label`, or live-region
announcement. The source tree was also searched for visible text outside the dictionaries; there is
none beyond the three language endonyms in `LanguageSelector.tsx` and the `<title>` in
`web/index.html`, both correct.

**Verdict: fix-first, now fixed.** English needed polish only. Hebrew and Russian each had a class
of real grammatical defect that a string-by-string translation cannot see, because it only appears
once a member's own text is interpolated into the sentence.

| Locale | Strings changed |
| --- | --- |
| English | 43 |
| Hebrew | 115 |
| Russian | 105 |

Placeholders are unchanged in every key, every plural family still covers exactly its language's
categories, and no Hebrew or Russian string falls back to or equals English. One key was added,
`board.renameColumnHeading`, and `BoardPage.tsx` uses it for the rename dialog's title.

## What was wrong, by kind

### Hebrew

- **A prefix letter left hanging, or glued to member text.** `card.assignee` was `משויך ל` over an
  option `לאף אחד`, and the card rendered it as "משויך ל: לאף אחד". `card.partOf` and
  `vision.goalLink` were the bare label `חלק מ`. `card.partOfBadge` was `חלק מ{milestone}` and
  `milestone.addTo` was `הוספת אבן דרך ל{title}`, both gluing a prefix onto a title that may be
  Latin ("חלק מRun a marathon"). The rename dialog's title reused `board.renameColumn` with an empty
  name, so it read `שינוי השם של` and stopped. Now: `באחריות` / `אף אחד`, `שיוך לאבן דרך`,
  `שיוך למטרה`, `במסגרת {milestone}`, `הוספת אבן דרך למטרה {title}`, and a dialog title of its own,
  `שינוי שם העמודה`.
- **Verb agreement taken from whatever the member typed.** Every save, delete, move and drag
  announcement began with `{title}` and a verb whose gender was a guess. They now name the object
  first — `הכרטיס {title} נשמר`, `המטרה {title} נמחקה`, `אבן הדרך {title} הוזזה…` — so the verb
  agrees with a noun that is known.
- **Sentences that said the wrong thing.** `invitations.expires` was `פג ב־{date}`, "expired on", on
  invitations that have not expired yet; it is now `בתוקף עד {date}`. `settings.yourText` labelled
  the text that had just *failed* to save `(נשמר)`, "saved"; it is now `(לא נשמר)`. The singular
  `goals.progress.one` produced "הושלמה 0 מתוך…".
- **Terminology.** The recovery phrase was `משפט` (a literal "sentence"); it is now the established
  `ביטוי שחזור` everywhere. `אימייל` and `מייל` were mixed. Reordering used both `הזזה` and `העברה`,
  which now mean reorder and move-to-another-column respectively. The default column `לעשות`, an
  infinitive that made "הוספת כרטיס לעמודה לעשות", is now the standard `לביצוע`.
- **Grammar and register.** `השתמשו בלפחות 12 תווים` is not grammatical. `סוד ההתקנה` and `מי שפרס את
  הלוח` read as machine translation. `טוען…` was gendered. The upload statuses mixed feminine
  adjectives with first-person plural verbs.

### Russian

- **Participle agreement taken from member text.** `{title} сохранена` is only correct if the member's
  title happens to be a feminine noun; "Купить молоко сохранена" is not Russian. Every card, goal and
  milestone announcement, confirmation and `aria-label` now names the object and quotes the title:
  `Карточка «{title}» сохранена`, `Этап «{title}» перемещён…`, `Действия с целью «{title}»`.
- **A number outside a plural key.** `settings.tooMany` was `Здесь {count} адресов`, wrong for 21, 22,
  23, 24, 31… It is now `Адресов в списке: {count}`, which is correct for every count.
- **Labels that were not idiomatic.** `Часть чего` / `Ничего` above the milestone and goal selects,
  and `Назначено` / `Никому` for the assignee. Now `Этап цели`, `Цель`, `Без привязки`,
  `Исполнитель`, `Не назначен`, and the badge `В рамках «{milestone}»`.
- **Sentences that said the wrong thing.** `settings.yourText` said `(сохранён)` on unsaved text.
  `goals.progress` began a standalone line in lower case.
- **Consistency.** Dialog headings are now nouns throughout (`Изменение цели`, not `Изменить цель`),
  a title is `название` everywhere (it was `заголовок` on cards and in the shared validation
  messages), column names are quoted in the column controls as they already were in the drag
  announcements, and "cannot be undone" is one sentence rather than two.

### English

Polish, apart from six genuine defects: `phrase.noStorage` promised that "support" cannot look the
phrase up, and there is no support; `error.unavailable` named the board although it is reachable
from every screen; `settings.yourText` said `(kept)` where the point is that it was not saved;
`error.revision_conflict` was two clauses with two unanchored "it"s; `vision.fileUploading` said
"Sending" beside an upload; and `invitations.revokeFor` announced "Revoke" followed by an email
address, as if the address were revoked. The rest — "Forgot your password?", "Join with an
invitation", key names capitalised, "The email address or password is incorrect." — is register.

## Glossary

The Hebrew and Russian dictionary headers now carry these, so the next string added follows them.

| Concept | English | Hebrew | Russian |
| --- | --- | --- | --- |
| recovery phrase | recovery phrase | ביטוי שחזור | фраза для восстановления |
| owner | owner | הבעלים (plural agreement) | владелец |
| member / user | member | משתמש/ת | участник |
| assignee | Assigned to | באחריות | Исполнитель |
| title | Title | כותרת | Название |
| milestone | milestone | אבן דרך | этап |
| vision board | Vision board | לוח חזון | Доска мечты |
| reorder / move to column | Move up · Move to column | הזזה · העברה | Переместить |
| link to a goal (label) | Part of | שיוך לאבן דרך · שיוך למטרה | Этап цели · Цель |
| expired | Expired | פג תוקף | Истекло |
| email | email | אימייל (never מייל) | электронная почта |

Rules that outlive this review: a member-written title never takes a Hebrew prefix letter directly
and never sets a Russian participle's gender — name the object first. Hebrew addresses the member in
the gender-neutral plural; buttons and headings are verbal nouns. Russian buttons are infinitives
and headings are nouns.

## Deliberately not changed

- `app.name`, `goals.optgroupLabel` and `milestone.optionLabel` stay byte-identical across locales;
  see deviations 4 and 11 in [the design system](design-system.md).
- Month and date names come from `Intl`, not from the dictionaries.
- `card.overdue` in English stays `Overdue {date}`; the Hebrew `באיחור מאז {date}` also stays.
- The Worker's own `message` fields in API errors are developer-facing — the interface translates by
  error code — so `worker/src` was not touched.
- Historical records under `docs/` that quote the old strings are records, not copy, and were left
  as written. `README.md` was updated where it names the "Join with an invitation" link.

## What the browser passes showed

The change was landed on 2026-09-15 as commit `1ea5b82` and deployed to production as version
`690cf146-4757-4985-abfc-5358a4aa68d6`. Two browser passes checked it: a full one on the deployed
**test** Worker, where creating and deleting rows is allowed, and a read-only one on **production**.
Both ran in Chrome at 390 (an emulated viewport), 834 and 1440, in `en`, `he` and `ru`. Full
evidence is in [the production deployment record](production-deployment.md).

### The long strings at 390, which is what was open

- **Russian `board.addCardTo`** (`Добавить карточку в колонку «К выполнению»`, the longest of the
  three) sits in the phone pager's add button. The button is **334×44 in every locale** — its box
  does not grow with the string — and the text wraps inside it rather than clipping or ellipsising
  (`white-space: normal`, and `scrollWidth`/`scrollHeight` never exceed the client box). No
  horizontal page scroll at any width.
- **Russian `card.discardDraft`** (`Сбросить изменения`) appears in the conflict footer, the
  tightest layout in the product. At 390 that footer wraps to two rows: Discard and Cancel share the
  first at 170×48 each, with the primary Save full-width at 349×48 beneath. The Discard label itself
  wraps to two lines inside its 170px button and does not clip. Hebrew `ויתור על השינויים` and
  English `Discard changes` behave the same.
- **Hebrew `vision.moveEarlier`** (`הזזה למיקום הקודם`) is a menu item in the vision actions menu;
  it renders on one line in a viewport-anchored menu and does not overflow.
- **Hebrew `vision.addHelp`** at 390 starts in Hebrew and keeps `JPEG,‏ PNG או WebP` in that order —
  the U+200F after the comma is doing its job — and `ל־JPEG` closes the sentence correctly.

### The new quotes in Russian badges — found here, fixed on 2026-09-15

`card.partOfBadge` rendered as `В рамках « ZZ copy Run a marathon »`, with a visible gap inside each
guillemet. The dictionary string and the element's `textContent` were both correct, with no spaces:
the gap was layout. `.badge` was `display: inline-flex` with `gap: 3.4px`, and the interpolated title
is wrapped in a `<span dir="auto">` for bidi isolation — so in a flex container that span, and each
run of template text around it, became separate (partly anonymous) flex items and the gap landed
between every part.

This record originally deferred the fix, on the ground that changing `.badge`'s layout "would drag
the `⚠`/`•` marker spacing into a text-only release". **That justification was wrong and is
withdrawn.** Three independent measurements in Chrome, against rigs reproducing the real rules,
showed the marker and its 3.4px gap do not move at all: badge height stays 24.8px and the label
keeps its offset from the badge's inline start, in every locale and in both the plain and `warning`
variants.

The fix, shipped on 2026-09-15, is that **`.badge` is deliberately no longer a flex container**. It
is `display: inline-block`, and the marker's separation moved from `gap` to `margin-inline-end` on
`.badge::before`. That keeps the whole label in one inline formatting context, so the guillemets hug
and each template's own trailing space does the spacing. Measured byte-identical to the alternative
(wrapping the label in an extra element) in all three locales, while touching no component file and
— the reason it was preferred — removing the failure mode rather than documenting it, since a future
multi-part badge cannot reintroduce it. This repository has no DOM test harness to catch such a
regression: the suite runs in the Workers runtime with no jsdom, and jsdom performs no layout.

Two corrections to what this section first claimed. `.badge` was `inline-flex`, not `flex`. And the
board badge was **not** the only site with the construct: `milestone.cardChip` on the goals screen
(`GoalsPage.tsx`) is the same shape, and merely had no visible symptom because its ` · ` separator
already puts a space where the stray gap fell. `board.addCardTo` quotes a *column* name, which is
not bidi-wrapped, and its guillemets always hugged correctly.

One route that looks cheaper is genuinely broken, recorded so nobody reaches for it: keeping the flex
container and setting `gap: 0` with a margin on the marker **loses** the space in the Hebrew and
English templates, because an anonymous flex item's trailing whitespace is stripped. Only a fix that
puts the whole label in one inline run works.

### What the grammar fix was for, seen working

- Hebrew announcements name the object first, so the verb agrees with a noun this code knows:
  `הכרטיס ZZ copy due today הורם…`, `אבן הדרך ZZ copy milestone B הוזזה למיקום 1.`,
  `סימון ההשלמה הוסר מאבן הדרך ZZ copy Run a marathon.`
- Russian participles agree with the noun, not the member's text: `Карточка «…» взята.`,
  `Карточка «…» осталась в колонке «К выполнению».`, `Цель «ZZ copy goal» удалена.`
- **A Latin milestone title inside a Hebrew badge is not reordered.** `במסגרת ZZ copy Run a marathon`
  renders with the Hebrew word at the RTL line start and the Latin title running left-to-right after
  it, on one 25px line, screenshotted at 1440.
- Goal progress reads correctly at all three plural boundaries: `הושלמו 1 מתוך אבן דרך אחת`,
  `הושלמו 1 מתוך שתי אבני דרך`, `הושלמו 1 מתוך 5 אבני דרך`; `Выполнено 1 из 1 этапа`,
  `…из 2 этапов`, `…из 5 этапов`, capitalised.
- `settings.tooMany` is correct for a count that used to break it: `Адресов в списке: 8. Максимум —
  7, включая ваш.`
- `invitations.expires` reads `בתוקף עד …` / `Действует до …` on a **real, unexpired** production
  invitation — the string that previously claimed it had expired.
- The new `board.renameColumnHeading` titles the rename dialog — `Rename column` /
  `שינוי שם העמודה` / `Переименование колонки` — while the icon button keeps the full
  `board.renameColumn` sentence as its `aria-label`, on both Workers.

## A defect this review introduced, found by rendering it — fixed 2026-09-16

`invitations.expires` was `פג ב־{date}` — "expired on" — and the review changed it to
`בתוקף עד {date}`, "valid until", because it was being shown on invitations that had *not* expired.
That was right for the common case and wrong for the rare one. On an **already expired** row the
date line then asserted current validity next to a badge saying the opposite:

```
zz-expired@example.test   פג תוקף   בתוקף עד 8 בספט׳ 2026     ← "expired" beside "in force until [a past date]"
zz-expired@example.test   Истекло   Действует до 8 сент. 2026 г.
```

Nothing but rendering it could have caught this: the review reasoned about the string, and the
string is correct — for pending rows. It was found only once an expired invitation was put on screen,
which needed a seeded row because no invitation on either household has ever expired.

The date line now follows the status. A new key, `invitations.expired`, is used when the status is
`expired`, and Hebrew reuses the very string the review had removed — `פג ב־{date}` was never wrong,
it was merely applied to the wrong rows:

```
zz-expired@example.test   פג תוקף   פג ב־8 בספט׳ 2026
zz-expired@example.test   Истекло   Истёк 8 сент. 2026 г.
zz-expired@example.test   Expired   Expired on Sep 8, 2026
```

Pending, used and revoked rows are untouched and still read `בתוקף עד` / `Действует до` / `Expires`.
A used or revoked row can also carry a past expiry date, which reads a little oddly for the same
reason, but there the badge is about a different event entirely — the invitation was consumed or
cancelled, and when its window would have closed is genuinely just information. Only the expired row
made the two statements contradict each other.

## Closed on 2026-09-16

Four of the six gaps this record first listed were closed, each by a method named here so the claim
can be judged rather than taken on trust.

- **The transient upload statuses.** Under 6× CPU throttling and Slow 3G on the deployed test
  Worker, a multi-file upload of 17.5 MB PNGs holds each state long enough to read, and a 40 ms
  sampler recorded the whole ordered transcript. All four render in all three locales:
  `בתור → בהכנה → בהעלאה → נוספה`, `В очереди → Подготовка → Загрузка → Добавлено`,
  `Waiting → Preparing → Uploading → Added`. `בהעלאה` held for about eleven seconds. The `busy-dots`
  marker sits beside the uploading row, as the `aria-busy` contract requires.
- **`invitations.status.expired`, and `pending` and `revoked` with it** — none of the three had ever
  rendered. Reached on a **local Miniflare stage** with a throwaway household, by seeding invitation
  rows with past expiries, a revoked timestamp and a consumed timestamp, so the *server's* own
  derivation produced each status. All four render: `Expired` / `פג תוקף` / `Истекло`,
  `Revoked` / `בוטלה` / `Отозвано`, `Used` / `נוצלה` / `Использовано`,
  `Waiting` / `ממתינה` / `Ожидает`. This is also what found the defect described above. The stage was
  torn down and the machine's previous local state restored.
- **`prefers-reduced-motion`.** The MCP browser exposes no media emulation, so a throwaway Chrome was
  launched with `--force-prefers-reduced-motion=reduce` and driven over CDP against
  **production's own `/login`**, then again without the flag as a control. The browser evaluates the
  query (`matchMedia` true vs false) and every declaration in the `@media` block takes effect on
  real elements carrying the real classes:

  | | `reduce` | `no-preference` |
  | --- | --- | --- |
  | `.busy-dots i` opacity | `1` — the static marker stays visible | `0.35`, mid-animation |
  | `.busy-dots i` animation-duration | `1e-06s` | `1.1s` |
  | `.skeleton-block` / `.skeleton-tile` background | `none` — flat | gradient shimmer |
  | `.card.dragging` transform | `none` | the tilt matrix |
  | `.carousel-image` animation | `none` | `gt-fade-in` |

  What that does **not** prove: dnd-kit's own JavaScript reduced-motion branch, which needs a real
  drag, and the fifth static marker — the carousel's position counter — which is component-rendered
  rather than CSS and was confirmed separately by reading `תמונה 2 מתוך 2` out of the carousel.
- **Every string, verbatim in what production serves.** All **1002** dictionary values across the
  three locales — including every one in the cluster production's own data could not show — appear
  literally in the JavaScript production hands the browser. Zero missing.
- **The cluster rendered from production's own database** (2026-09-16). The owner authorised
  temporary rows, so a verified encrypted backup was taken first, the fewest rows that show the
  surfaces were created through the real API, every string was read in all three locales, everything
  was deleted, and a second verified backup reconciled **identically** on every count — 2 users,
  2 allowed addresses, 3 columns, 1 card, 0 goals, 0 milestones, 0 images, 0 bytes. Only the
  revisions moved. The due badges in all three states, `card.partOfBadge`, `card.unassigned` beside a
  genuinely assigned card, the goal progress fraction, `milestone.addTo`, `milestone.cardChip`, the
  vision tile, the carousel **over real pixels**, and the image edit dialog were all seen rendering
  from rows production's own Worker returned. The badge fix was re-measured there: Russian gaps 0 and
  0, every badge `inline-block` at 24.8px, the `⚠` marker keeping its 3.4px margin. Full detail is in
  [the production deployment record](production-deployment.md).

- **Safari/WebKit** — the first WebKit pass this project has had, through `safaridriver` against
  production (`AppleWebKit/605.1.15`, Safari 26.6.2, confirmed not Chromium). Zero horizontal
  overflow in all nine width × locale combinations, `dir` correct, the self-hosted Barlow faces
  loading, and **the badge fix holding**: `inline-block`, Russian guillemets at gap 0 either side,
  `⚠` keeping its margin. Badge height is 24px in WebKit against 24.8px in Chromium — sub-pixel
  rounding of the same box, not a defect.
- **A real screen reader.** The owner enabled VoiceOver Utility's *Allow VoiceOver to be controlled
  with AppleScript*, and VoiceOver's speech was read back verbatim. The two headline fixes of this
  review were **heard**, out of the polite live region: `הכרטיס  ZZ vo card  נשמר.` and
  `Карточка « ZZ vo card»  сохранена.` — the Hebrew naming the object before the title, the Russian
  participle agreeing with `Карточка` rather than with member text. Also heard:
  `card.dragInstructions` in full, the owner column strip's four buttons by name with `dimmed`
  conveying the disabled state, `כרטיס אחד` as the Hebrew singular card count, and
  `board.column.todo` spoken as the new `לביצוע`. Method and the full transcript are in
  [the production deployment record](production-deployment.md).

## What is still unchecked

- **iOS, and any real touch device.** The WebKit pass is macOS desktop Safari. iOS has a different
  input stack and browser chrome, and 390px throughout this record is an emulated viewport rather
  than a phone someone touched.
- **Signed-in Safari.** The WebKit pass covered the guest routes plus the badge measured against the
  real deployed stylesheet. A signed-in WebKit walk of the board, goals and vision screens has not
  been done.
- **Dark theme beyond one look.** Dark was checked on `/board` and `/goals` at 390 in Hebrew on the
  test Worker; production was walked in light only. The change moves text, not colour.

## A register inconsistency this review left behind — also fixed on 2026-09-15

Hebrew `vision.uploadHeading` was `מוסיפים תמונות`, a present-tense finite verb — the only one used
as a label anywhere in `he.ts`, apart from the deliberate imperative at `phrase.heading` that mirrors
English's. The upload *statuses* beneath it had become verbal nouns (`בהכנה`, `בהעלאה`) and the
parallel Russian key had been changed to a noun (`Добавление изображений`), so it was left as the
lone outlier against the glossary's own rule that Hebrew headings are verbal nouns.

It is now **`הוספת התמונות`** — "adding *the* images", definite. The obvious `הוספת תמונות` was
rejected because it is byte-identical to `vision.addImages`, the button that opens the file chooser,
and that button is only *disabled* while the upload list is on screen, never unmounted — so the two
would paint the same phrase twice within a few pixels, and a screen reader would announce it once as
a button and once as a level-2 heading. Definiteness is the distinction Hebrew has where English and
Russian use a derivational one ("Add images" / "Adding images"; `Добавить изображения` /
`Добавление изображений`), and it matches the house pattern for a heading that names a specific known
object: `recover.heading` is `שחזור החשבון`, `board.renameColumnHeading` is `שינוי שם העמודה`.

It also corrects an aspect error rather than only a register one. `outcomes` is set once per batch
and never cleared, so the heading outlives the upload and sits above rows reading `נוספה` and
`ההוספה נכשלה`. A verbal noun is aspectless and covers the finished state; "we are adding" asserts an
action still in progress and is simply false by then. `הוספה` is also already this feature's verb in
those row statuses, so the heading now ties to the vocabulary beneath it.

## Every change

Old and new value of every key that changed, per locale.

### English — 43

| Key | Before | After |
| --- | --- | --- |
| `nav.join` | `Join with invitation` | `Join with an invitation` |
| `welcome.body` | `Sign in to see the board. Joining needs an invitation from the owner.` | `Sign in to see the board. To join, you need an invitation from the owner.` |
| `signIn.forgot` | `Lost your password?` | `Forgot your password?` |
| `signIn.noEmail` | `This app never sends email. There is no email reset link.` | `This app never sends email, so there is no password reset link.` |
| `bootstrap.body` | `The first owner sets up this board once, without an invitation code. After signing in, the owner can allow email addresses and create invitations in Settings.` | `The owner sets up this board once, without an invitation code. After signing in, the owner can allow email addresses and create invitations in Settings.` |
| `register.body` | `Enter the invitation code the owner gave you, together with the address it was issued for.` | `Enter the invitation code the owner gave you, along with the email address it was issued for.` |
| `register.inviteHow` | `The owner adds your email to the allowed list in Settings, creates a one-time invitation code there, and shares it with you directly. This app does not send email.` | `The owner adds your email address to the allowed list in Settings, creates a one-time invitation code there, and shares it with you directly. This app does not send email.` |
| `register.passwordHelp` | `At least 12 characters. Avoid anything you use elsewhere.` | `At least 12 characters. Do not reuse a password from another site.` |
| `phrase.noStorage` | `It is not saved in this browser, and support cannot look it up for you.` | `It is not saved in this browser, and nobody can look it up for you.` |
| `phrase.confirmHelp` | `Separate the words with spaces. Capitals do not matter.` | `Separate the words with spaces. Capitalization does not matter.` |
| `phrase.abandonWarning` | `If you close this page before confirming, nothing changes and you start again.` | `If you close this page before confirming, nothing changes and you will have to start again.` |
| `recover.phraseBody` | `Enter your address, your saved 12-word phrase, and the password you want instead.` | `Enter your email address, your saved 12-word recovery phrase, and a new password.` |
| `recover.done` | `Your password and phrase were replaced. Sign in with the new password.` | `Your password and recovery phrase have been replaced. Sign in with your new password.` |
| `account.signOutWarning` | `Finishing signs you out everywhere, including this device.` | `Finishing signs you out on every device, including this one.` |
| `account.languageFailed` | `That language could not be saved. Showing your last saved choice.` | `Your language choice could not be saved. Showing your last saved language.` |
| `settings.allowedBody` | `One address per line. At most {max} addresses including your own.` | `One address per line. At most {max} addresses, including your own.` |
| `settings.removalWarning` | `Removing an address ends that person’s access immediately on every device and cancels any unused invitation. Their account still uses a seat until you deactivate it.` | `Removing an address immediately ends that person’s access on every device and cancels any unused invitation. Their account still takes up a seat until you deactivate it.` |
| `settings.yourText` | `Your text (kept)` | `Your text (not saved)` |
| `invitations.revokeFor` | `Revoke {email}` | `Revoke the invitation for {email}` |
| `invitations.expired` | *(new key, 2026-09-16)* | `Expired on {date}` |
| `members.notAllowed` | `Removed from the allowed list, still using a seat` | `Removed from the allowed list but still using a seat` |
| `members.deactivateConfirm` | `Deactivate {email}? This frees their seat, ends their sessions, and clears their card assignments. It cannot be undone.` | `Deactivate {email}? This frees their seat, signs them out everywhere, and unassigns them from their cards. It cannot be undone.` |
| `board.renameColumnHeading` | *(new key)* | `Rename column` |
| `card.dragInstructions` | `Press space or enter to pick up a card, arrow keys to move it, and space or enter to drop it.` | `Press Space or Enter to pick up a card, use the arrow keys to move it, and press Space or Enter again to drop it.` |
| `card.moveRejected` | `{title} was not moved. The board changed; it has been reloaded.` | `{title} was not moved. The board changed and has been reloaded.` |
| `card.discardDraft` | `Discard` | `Discard changes` |
| `card.dueDateHelp` | `A calendar day. Leave it empty for no date.` | `A date without a time. Leave it empty if there is no due date.` |
| `goals.deleteConfirm` | `Delete the goal {title}? Its milestones go with it, any card linked to them is unlinked, and any image pointing at it stops pointing at it. This cannot be undone.` | `Delete the goal {title}? Its milestones will be deleted with it, and any linked cards and images will be unlinked. This cannot be undone.` |
| `milestone.deleteConfirm` | `Delete the milestone {title}? Any card linked to it is unlinked. This cannot be undone.` | `Delete the milestone {title}? Any cards linked to it will be unlinked. This cannot be undone.` |
| `vision.addHelp` | `JPEG, PNG or WebP. Each image is resized in your browser before it is sent, which also removes the location a phone photograph records. Apple HEIC photographs cannot be read here — export them as JPEG first.` | `JPEG, PNG or WebP. Each image is resized in your browser before it is uploaded, which also removes any location data a phone photo carries. HEIC photos from Apple devices cannot be read here — export them as JPEG first.` |
| `vision.fileUploading` | `Sending` | `Uploading` |
| `vision.fileUnreadable` | `That file could not be read as an image. Export an Apple HEIC photograph as JPEG first.` | `This file could not be read as an image. If it is an Apple HEIC photo, export it as JPEG first.` |
| `error.invalid_credentials` | `That email address and password combination did not work.` | `The email address or password is incorrect.` |
| `error.unavailable` | `The board is temporarily unavailable. Try again shortly.` | `The app is temporarily unavailable. Try again shortly.` |
| `error.invalid_pending_token` | `That sign-up expired. Start again.` | `That sign-up has expired. Start again.` |
| `error.invalid_phrase` | `That phrase did not match.` | `That recovery phrase does not match.` |
| `error.invalid_challenge` | `That recovery request expired. Start again.` | `That recovery request has expired. Start again.` |
| `error.revision_conflict` | `It changed somewhere else. It has been reloaded.` | `This changed somewhere else and has been reloaded.` |
| `error.unsupported_image_type` | `That kind of image cannot be used. Try a JPEG, a PNG or a WebP.` | `That image type is not supported. Use JPEG, PNG or WebP.` |
| `field.dueDate.invalid` | `Enter a real date, as year, month and day.` | `Enter a valid date with a day, month and year.` |
| `field.dueDate.out_of_range` | `Choose a date between 2000 and 2999.` | `Choose a date between the years 2000 and 2999.` |
| `field.status.invalid` | `That is not a status a milestone can have.` | `That is not a valid milestone status.` |
| `field.mediaType.invalid` | `That kind of image cannot be used here.` | `That image type cannot be used here.` |
| `field.width.invalid` | `That image size is not valid.` | `Those image dimensions are not valid.` |

### Hebrew — 115

| Key | Before | After |
| --- | --- | --- |
| `app.loading` | `טוען…` | `בטעינה…` |
| `app.retry` | `לנסות שוב` | `ניסיון נוסף` |
| `nav.join` | `הצטרפות עם הזמנה` | `הצטרפות בהזמנה` |
| `welcome.body` | `היכנסו כדי לראות את הלוח. ההצטרפות מחייבת הזמנה מהבעלים.` | `היכנסו כדי לראות את הלוח. להצטרפות נדרשת הזמנה מהבעלים.` |
| `signIn.noEmail` | `האפליקציה לא שולחת אימייל, ואין קישור לאיפוס סיסמה במייל.` | `האפליקציה אף פעם לא שולחת אימיילים, ולכן אין קישור לאיפוס סיסמה.` |
| `bootstrap.body` | `הבעלים הראשונים מקימים את הלוח פעם אחת, בלי קוד הזמנה. לאחר הכניסה הם יכולים להוסיף כתובות אימייל לרשימת המורשים וליצור הזמנות בהגדרות.` | `הבעלים מקימים את הלוח פעם אחת, בלי קוד הזמנה. אחרי הכניסה אפשר להוסיף כתובות אימייל לרשימת המורשים וליצור הזמנות בהגדרות.` |
| `bootstrap.secret` | `סוד ההתקנה` | `מפתח ההקמה` |
| `bootstrap.secretHelp` | `קבלו את הערך ממי שפרס את הלוח. זה אינו קוד הזמנה.` | `קבלו אותו ממי שהתקין את הלוח. זה לא קוד הזמנה.` |
| `bootstrap.closed` | `חשבון הבעלים כבר קיים. אפשר להיכנס במקום זאת.` | `חשבון הבעלים כבר קיים. אפשר פשוט להיכנס.` |
| `register.body` | `הזינו את קוד ההזמנה שקיבלתם מהבעלים, יחד עם הכתובת שעבורה הוא הונפק.` | `הזינו את קוד ההזמנה שקיבלתם מהבעלים ואת כתובת האימייל שעבורה הוא הונפק.` |
| `register.codeHelp` | `32 תווים, שקיבלתם מהבעלים.` | `קוד בן 32 תווים שקיבלתם מהבעלים.` |
| `register.passwordHelp` | `לפחות 12 תווים. עדיף לא להשתמש בסיסמה שמשמשת אתכם במקום אחר.` | `לפחות 12 תווים. אל תשתמשו בסיסמה שכבר משמשת אתכם באתר אחר.` |
| `phrase.heading` | `שמרו את משפט השחזור` | `שמרו את ביטוי השחזור` |
| `phrase.body` | `שתים־עשרה המילים האלה הן הדרך היחידה לחזור לחשבון אם תשכחו את הסיסמה. רשמו אותן עכשיו ושמרו במקום בטוח.` | `שתים־עשרה המילים האלה הן הדרך היחידה לחזור לחשבון אם תשכחו את הסיסמה. רשמו אותן עכשיו ושמרו אותן במקום בטוח.` |
| `phrase.confirmLabel` | `הקלידו את המשפט כדי לאשר ששמרתם אותו` | `הקלידו את ביטוי השחזור כדי לאשר ששמרתם אותו` |
| `phrase.confirmHelp` | `הפרידו בין המילים ברווח. אותיות גדולות או קטנות אינן משנות.` | `הפרידו בין המילים ברווחים. אין הבדל בין אותיות גדולות לקטנות.` |
| `recover.withPhrase` | `יש לי את משפט השחזור` | `יש לי את ביטוי השחזור` |
| `recover.phraseBody` | `הזינו את הכתובת שלכם, את משפט שתים־עשרה המילים השמור, ואת הסיסמה החדשה.` | `הזינו את כתובת האימייל שלכם, את ביטוי השחזור בן 12 המילים ששמרתם ואת הסיסמה החדשה.` |
| `recover.tokenBody` | `הבעלים יכולים להנפיק קוד איפוס חד־פעמי אחרי שיוודאו מי אתם. הקוד פג אחרי 15 דקות.` | `הבעלים יכולים להנפיק קוד איפוס חד־פעמי אחרי שיוודאו שזה אתם. הקוד בתוקף ל־15 דקות.` |
| `recover.phraseLabel` | `משפט שחזור` | `ביטוי שחזור` |
| `recover.lostBoth` | `איבדתם גם את הסיסמה וגם את המשפט? פנו ישירות לבעלים. אין איפוס באמצעות אימייל.` | `איבדתם גם את הסיסמה וגם את ביטוי השחזור? פנו ישירות לבעלים. אין איפוס באמצעות אימייל.` |
| `recover.done` | `הסיסמה ומשפט השחזור הוחלפו. היכנסו עם הסיסמה החדשה.` | `הסיסמה וביטוי השחזור הוחלפו. היכנסו עם הסיסמה החדשה.` |
| `account.newPasswordHelp` | `השאירו ריק כדי לשמור על הסיסמה ולהחליף רק את משפט השחזור.` | `השאירו את השדה ריק כדי להחליף רק את ביטוי השחזור, בלי לשנות את הסיסמה.` |
| `account.signOutWarning` | `הסיום מנתק אתכם מכל המכשירים, כולל המכשיר הזה.` | `בסיום תנותקו מכל המכשירים, כולל המכשיר הזה.` |
| `account.languageFailed` | `לא הצלחנו לשמור את השפה. מוצגת הבחירה האחרונה שנשמרה.` | `לא הצלחנו לשמור את השפה. מוצגת השפה האחרונה שנשמרה.` |
| `settings.allowedBody` | `כתובת אחת בכל שורה. עד {max} כתובות, כולל שלכם.` | `כתובת אחת בכל שורה. עד {max} כתובות, כולל הכתובת שלכם.` |
| `settings.allowedConflict` | `הרשימה השתנתה במקום אחר. הטקסט שלכם נשמר למטה; השוו אותו לרשימה הנוכחית לפני שמירה נוספת.` | `הרשימה השתנתה במקום אחר. הטקסט שלכם מופיע למטה; השוו אותו לרשימה הנוכחית לפני שתשמרו שוב.` |
| `settings.tooMany` | `יש כאן {count} כתובות. המגבלה היא {max}, כולל שלכם.` | `ברשימה יש {count} כתובות, והמגבלה היא {max}, כולל הכתובת שלכם.` |
| `settings.yourText` | `הטקסט שלכם (נשמר)` | `הטקסט שלכם (לא נשמר)` |
| `invitations.expires` | `פג ב־{date}` | `בתוקף עד {date}` |
| `invitations.expired` | *(new key, 2026-09-16)* | `פג ב־{date}` — the old string, now on the rows it was always right for |
| `invitations.status.expired` | `פגה` | `פג תוקף` |
| `members.heading` | `אנשים` | `משתמשים` |
| `members.role.member` | `חבר/ה` | `משתמש/ת` |
| `members.notAllowed` | `הוסר/ה מרשימת המורשים, ועדיין תופס/ת מקום` | `הוסר/ה מרשימת המורשים אך עדיין תופס/ת מקום` |
| `members.deactivateConfirm` | `להשבית את {email}? הפעולה משחררת את המקום, מסיימת את החיבורים ומנקה את השיוכים לכרטיסים. אי אפשר לבטל אותה.` | `להשבית את {email}? הפעולה תשחרר את המקום, תנתק את החשבון מכל המכשירים ותסיר ממנו את האחריות על כרטיסים. אי אפשר לבטל אותה.` |
| `members.deactivated` | `{email} הושבת/ה.` | `החשבון {email} הושבת.` |
| `board.columnEmpty` | `אין כאן כלום עדיין.` | `עדיין אין כאן כלום.` |
| `board.renameColumnHeading` | *(new key)* | `שינוי שם העמודה` |
| `board.deleteColumnConfirm` | `למחוק את העמודה {name}? היא חייבת להיות ריקה קודם.` | `למחוק את העמודה {name}? אפשר למחוק רק עמודה ריקה.` |
| `board.column.todo` | `לעשות` | `לביצוע` |
| `card.assignee` | `משויך ל` | `באחריות` |
| `card.unassigned` | `לאף אחד` | `אף אחד` |
| `card.dragInstructions` | `לחצו רווח או Enter כדי להרים כרטיס, מקשי חצים כדי להזיז אותו, ורווח או Enter כדי להניח.` | `לחצו על מקש הרווח או על Enter כדי להרים כרטיס, על מקשי החצים כדי להזיז אותו, ושוב על הרווח או על Enter כדי להניח אותו.` |
| `card.dragPickedUp` | `{title} הורם. מיקום {position} בעמודה {column}. השתמשו במקשי החצים כדי להזיז אותו.` | `הכרטיס {title} הורם. מיקום {position} בעמודה {column}. הזיזו אותו בעזרת מקשי החצים.` |
| `card.dragOver` | `{title} מעל {column}, מיקום {position}.` | `הכרטיס {title} מעל העמודה {column}, מיקום {position}.` |
| `card.dragCanceled` | `ההעברה בוטלה. {title} נשאר בעמודה {column}.` | `ההעברה בוטלה. הכרטיס {title} נשאר בעמודה {column}.` |
| `card.movedTo` | `{title} הועבר אל {column}, מיקום {position}.` | `הכרטיס {title} הועבר לעמודה {column}, מיקום {position}.` |
| `card.moveRejected` | `{title} לא הועבר. הלוח השתנה ונטען מחדש.` | `הכרטיס {title} לא הועבר. הלוח השתנה ונטען מחדש.` |
| `card.saved` | `{title} נשמר.` | `הכרטיס {title} נשמר.` |
| `card.deleted` | `{title} נמחק.` | `הכרטיס {title} נמחק.` |
| `card.discardDraft` | `ביטול הטיוטה` | `ויתור על השינויים` |
| `card.dueDateHelp` | `יום בלוח השנה. השאירו ריק אם אין תאריך.` | `תאריך בלבד, בלי שעה. השאירו ריק אם אין תאריך יעד.` |
| `card.due` | `ליום {date}` | `עד {date}` |
| `card.dueSoon` | `ליום {date}` | `עד {date}` |
| `card.partOf` | `חלק מ` | `שיוך לאבן דרך` |
| `card.partOfNone` | `שום דבר` | `ללא` |
| `card.partOfBadge` | `חלק מ{milestone}` | `במסגרת {milestone}` |
| `card.partOfUnknown` | `חלק ממטרה` | `במסגרת מטרה` |
| `goals.moveUp` | `העברה למעלה` | `הזזה למעלה` |
| `goals.moveDown` | `העברה למטה` | `הזזה למטה` |
| `goals.deleteConfirm` | `למחוק את המטרה {title}? אבני הדרך שלה יימחקו איתה, כל כרטיס שמקושר אליהן ינותק, וכל תמונה שמצביעה עליה תפסיק להצביע עליה. אי אפשר לבטל את הפעולה.` | `למחוק את המטרה {title}? גם אבני הדרך שלה יימחקו, וכל הכרטיסים והתמונות המקושרים ינותקו. אי אפשר לבטל את הפעולה.` |
| `goals.saved` | `{title} נשמרה.` | `המטרה {title} נשמרה.` |
| `goals.deleted` | `{title} נמחקה.` | `המטרה {title} נמחקה.` |
| `goals.moved` | `{title} הועברה למיקום {position}.` | `המטרה {title} הוזזה למיקום {position}.` |
| `goals.progress.one` | `הושלמה {done} מתוך אבן דרך אחת` | `הושלמו {done} מתוך אבן דרך אחת` |
| `milestone.addTo` | `הוספת אבן דרך ל{title}` | `הוספת אבן דרך למטרה {title}` |
| `milestone.markedDone` | `{title} סומנה כהושלמה.` | `אבן הדרך {title} סומנה כהושלמה.` |
| `milestone.markedOpen` | `{title} סומנה כלא הושלמה.` | `סימון ההשלמה הוסר מאבן הדרך {title}.` |
| `milestone.deleteConfirm` | `למחוק את אבן הדרך {title}? כל כרטיס שמקושר אליה ינותק. אי אפשר לבטל את הפעולה.` | `למחוק את אבן הדרך {title}? כרטיסים שמקושרים אליה ינותקו ממנה. אי אפשר לבטל את הפעולה.` |
| `milestone.saved` | `{title} נשמרה.` | `אבן הדרך {title} נשמרה.` |
| `milestone.deleted` | `{title} נמחקה.` | `אבן הדרך {title} נמחקה.` |
| `milestone.moved` | `{title} הועברה למיקום {position}.` | `אבן הדרך {title} הוזזה למיקום {position}.` |
| `vision.addHelp` | `JPEG,‏ PNG או WebP. כל תמונה מוקטנת בדפדפן שלכם לפני השליחה, וכך גם נמחק המיקום שתצלום מהטלפון שומר. אי אפשר לקרוא כאן תצלומי HEIC של אפל — ייצאו אותם קודם כ־JPEG.` | `אפשר להוסיף תמונות JPEG,‏ PNG או WebP. כל תמונה מוקטנת בדפדפן לפני ההעלאה, וכך נמחקים גם נתוני המיקום שהטלפון שומר בתמונה. אי אפשר לקרוא כאן תמונות HEIC של אפל — ייצאו אותן קודם ל־JPEG.` |
| `vision.goalLink` | `חלק מ` | `שיוך למטרה` |
| `vision.goalNone` | `שום דבר` | `ללא` |
| `vision.moveEarlier` | `העברה אחורה` | `הזזה למיקום הקודם` |
| `vision.moveLater` | `העברה קדימה` | `הזזה למיקום הבא` |
| `vision.moved` | `התמונה הועברה למיקום {position}.` | `התמונה הוזזה למיקום {position}.` |
| `vision.uploadHeading` | `מוסיפים תמונות` | `הוספת התמונות` *(added 2026-09-15, see above)* |
| `vision.fileQueued` | `ממתינה` | `בתור` |
| `vision.filePreparing` | `מכינים` | `בהכנה` |
| `vision.fileUploading` | `שולחים` | `בהעלאה` |
| `vision.fileFailed` | `לא הצלחנו להוסיף` | `ההוספה נכשלה` |
| `vision.fileUnreadable` | `לא הצלחנו לקרוא את הקובץ הזה כתמונה. ייצאו תצלום HEIC של אפל כ־JPEG קודם.` | `לא הצלחנו לקרוא את הקובץ הזה כתמונה. אם זו תמונת HEIC של אפל, ייצאו אותה קודם ל־JPEG.` |
| `error.unauthenticated` | `החיבור הסתיים. היכנסו שוב.` | `ההתחברות הסתיימה. היכנסו שוב.` |
| `error.invalid_credentials` | `השילוב של כתובת האימייל והסיסמה לא עבד.` | `כתובת האימייל או הסיסמה שגויות.` |
| `error.forbidden` | `אין לכם גישה לזה.` | `אין לכם הרשאה לכך.` |
| `error.unavailable` | `הלוח אינו זמין כרגע. נסו שוב בקרוב.` | `האפליקציה אינה זמינה כרגע. נסו שוב בעוד כמה רגעים.` |
| `error.seats_full` | `כל המקומות תפוסים. השביתו מישהו קודם.` | `כל המקומות תפוסים. השביתו משתמש כדי לפנות מקום.` |
| `error.invalid_pending_token` | `ההרשמה פגה. התחילו מחדש.` | `תוקף ההרשמה פג. התחילו מחדש.` |
| `error.invalid_phrase` | `המשפט לא תואם.` | `ביטוי השחזור לא תואם.` |
| `error.invalid_challenge` | `בקשת השחזור פגה. התחילו מחדש.` | `תוקף בקשת השחזור פג. התחילו מחדש.` |
| `error.recovery_failed` | `לא ניתן היה להשלים את הבקשה.` | `לא הצלחנו להשלים את הבקשה.` |
| `error.too_many_rotations` | `סיימו או המתינו לבקשת השחזור הפתוחה לפני שתתחילו אחת נוספת.` | `כבר יש בקשת שחזור פתוחה. השלימו אותה או המתינו שתוקפה יפוג.` |
| `error.revision_conflict` | `משהו השתנה במקום אחר. הכול נטען מחדש.` | `הנתונים השתנו במקום אחר ונטענו מחדש.` |
| `error.board_full` | `הלוח מלא. מחקו כרטיס כדי להוסיף אחד נוסף.` | `הלוח מלא. מחקו כרטיס כדי להוסיף כרטיס חדש.` |
| `error.column_limit` | `בלוח כבר יש את המספר המרבי של עמודות.` | `הלוח כבר מכיל את מספר העמודות המרבי.` |
| `error.payload_too_large` | `זה גדול מדי לשמירה. נסו טקסט קצר יותר, או תמונה קטנה יותר.` | `התוכן גדול מדי לשמירה. נסו טקסט קצר יותר או תמונה קטנה יותר.` |
| `error.unsupported_media_type` | `לא ניתן היה לשלוח את הבקשה.` | `לא הצלחנו לשלוח את הבקשה.` |
| `error.image_limit` | `לוח החזון מלא. מחקו תמונה כדי להוסיף אחת נוספת.` | `לוח החזון מלא. מחקו תמונה כדי להוסיף תמונה חדשה.` |
| `error.unsupported_image_type` | `אי אפשר להשתמש בסוג התמונה הזה. נסו JPEG,‏ PNG או WebP.` | `סוג התמונה הזה אינו נתמך. השתמשו ב־JPEG,‏ PNG או WebP.` |
| `field.password.too_short` | `השתמשו בלפחות 12 תווים.` | `הסיסמה חייבת להכיל לפחות 12 תווים.` |
| `field.password.too_long` | `השתמשו בלא יותר מ־128 תווים.` | `הסיסמה יכולה להכיל עד 128 תווים.` |
| `field.emails.invalid_emails` | `אחת השורות אינה כתובת תקינה, או שכתובת חוזרת פעמיים.` | `אחת השורות אינה כתובת תקינה, או שיש כתובת שמופיעה יותר מפעם אחת.` |
| `field.emails.invalid_count` | `השאירו בין כתובת אחת ל־{max} כתובות, כולל שלכם.` | `השאירו בין כתובת אחת ל־{max} כתובות, כולל הכתובת שלכם.` |
| `field.assigneeUserId.ineligible` | `אי אפשר לשייך כרטיסים לאדם הזה יותר.` | `כבר אי אפשר לשייך כרטיסים למשתמש הזה.` |
| `field.assigneeUserId.invalid` | `השיוך הזה אינו תקין.` | `אי אפשר להטיל את האחריות על המשתמש שנבחר.` |
| `field.boardRevision.invalid` | `טענו מחדש ונסו שוב.` | `טענו את הדף מחדש ונסו שוב.` |
| `field.goalsRevision.invalid` | `טענו מחדש ונסו שוב.` | `טענו את הדף מחדש ונסו שוב.` |
| `field.visionRevision.invalid` | `טענו מחדש ונסו שוב.` | `טענו את הדף מחדש ונסו שוב.` |
| `field.dueDate.invalid` | `הזינו תאריך אמיתי, עם שנה, חודש ויום.` | `הזינו תאריך תקין, עם יום, חודש ושנה.` |
| `field.dueDate.out_of_range` | `בחרו תאריך בין 2000 ל־2999.` | `בחרו תאריך בין השנים 2000 ל־2999.` |
| `field.caption.invalid` | `כיתוב הוא שורה אחת, בלי תווים שאי אפשר לשמור.` | `הכיתוב חייב להיות שורה אחת, בלי תווים שאי אפשר לשמור.` |
| `field.status.invalid` | `זה אינו מצב שאבן דרך יכולה להיות בו.` | `הסטטוס של אבן הדרך אינו תקין.` |
| `field.mediaType.invalid` | `אי אפשר להשתמש כאן בסוג התמונה הזה.` | `סוג התמונה הזה אינו נתמך כאן.` |
| `field.width.invalid` | `גודל התמונה הזה אינו תקין.` | `מידות התמונה אינן תקינות.` |

### Russian — 105

| Key | Before | After |
| --- | --- | --- |
| `welcome.body` | `Войдите, чтобы увидеть доску. Для присоединения нужно приглашение от владельца.` | `Войдите, чтобы увидеть доску. Присоединиться можно только по приглашению владельца.` |
| `signIn.noEmail` | `Приложение не отправляет письма. Ссылки для сброса пароля по почте нет.` | `Приложение никогда не отправляет письма, поэтому ссылки для сброса пароля нет.` |
| `bootstrap.body` | `Первый владелец создаёт доску один раз, без кода приглашения. После входа он может добавлять адреса в список разрешённых и создавать приглашения в настройках.` | `Владелец создаёт доску один раз, без кода приглашения. После входа он сможет добавлять адреса в список разрешённых и создавать приглашения в настройках.` |
| `bootstrap.secret` | `Секрет установки` | `Секретный ключ установки` |
| `bootstrap.secretHelp` | `Получите его у того, кто развернул доску. Это не код приглашения.` | `Получите его у того, кто установил доску. Это не код приглашения.` |
| `register.heading` | `Присоединиться к доске` | `Присоединение к доске` |
| `register.codeHelp` | `32 символа, которые вам дал владелец.` | `32 символа. Код выдаёт владелец.` |
| `register.passwordHelp` | `Не менее 12 символов. Не используйте пароль, который применяете где-то ещё.` | `Не менее 12 символов. Не используйте пароль от других сайтов.` |
| `recover.phraseBody` | `Введите свой адрес, сохранённую фразу из 12 слов и новый пароль, который хотите установить.` | `Введите адрес электронной почты, сохранённую фразу из 12 слов и новый пароль.` |
| `recover.tokenBody` | `Владелец может выдать одноразовый код сброса, убедившись, кто вы. Код действует 15 минут.` | `Владелец может выдать одноразовый код сброса, убедившись, что это действительно вы. Код действует 15 минут.` |
| `recover.done` | `Пароль и фраза заменены. Войдите с новым паролем.` | `Пароль и фраза для восстановления заменены. Войдите с новым паролем.` |
| `settings.allowedConflict` | `Список изменился в другом месте. Ваш текст сохранён ниже; сравните его с текущим списком, прежде чем сохранять снова.` | `Список изменился в другом месте. Ваш текст оставлен ниже — сравните его с текущим списком, прежде чем сохранять снова.` |
| `settings.tooMany` | `Здесь {count} адресов. Предел — {max}, включая ваш.` | `Адресов в списке: {count}. Максимум — {max}, включая ваш.` |
| `settings.yourText` | `Ваш текст (сохранён)` | `Ваш текст (не сохранён)` |
| `invitations.expired` | *(new key, 2026-09-16)* | `Истёк {date}` |
| `members.deactivated` | `{email} отключён.` | `Аккаунт {email} отключён.` |
| `board.renameColumn` | `Переименовать {name}` | `Переименовать «{name}»` |
| `board.renameColumnHeading` | *(new key)* | `Переименование колонки` |
| `board.deleteColumn` | `Удалить {name}` | `Удалить «{name}»` |
| `board.deleteColumnConfirm` | `Удалить колонку {name}? Сначала она должна быть пустой.` | `Удалить колонку «{name}»? Удалить можно только пустую колонку.` |
| `board.moveColumnStart` | `Переместить {name} ближе к началу` | `Переместить «{name}» ближе к началу` |
| `board.moveColumnEnd` | `Переместить {name} ближе к концу` | `Переместить «{name}» ближе к концу` |
| `board.addCardTo` | `Добавить карточку в «{column}»` | `Добавить карточку в колонку «{column}»` |
| `card.title` | `Заголовок` | `Название` |
| `card.assignee` | `Назначено` | `Исполнитель` |
| `card.unassigned` | `Никому` | `Не назначен` |
| `card.deleteConfirm` | `Удалить карточку {title}? Отменить нельзя.` | `Удалить карточку «{title}»? Это действие нельзя отменить.` |
| `card.actions` | `Действия для {title}` | `Действия с карточкой «{title}»` |
| `card.dragHandle` | `Перетащить {title}` | `Перетащить карточку «{title}»` |
| `card.dragInstructions` | `Нажмите пробел или Enter, чтобы взять карточку, стрелки — чтобы переместить её, пробел или Enter — чтобы отпустить.` | `Нажмите пробел или Enter, чтобы взять карточку, клавиши со стрелками — чтобы переместить её, и снова пробел или Enter — чтобы отпустить.` |
| `card.dragPickedUp` | `{title} поднята. Позиция {position} в колонке «{column}». Используйте клавиши со стрелками, чтобы переместить её.` | `Карточка «{title}» взята. Позиция {position} в колонке «{column}». Перемещайте её клавишами со стрелками.` |
| `card.dragOver` | `{title} над колонкой «{column}», позиция {position}.` | `Карточка «{title}» над колонкой «{column}», позиция {position}.` |
| `card.dragCanceled` | `Перемещение отменено. {title} осталась в колонке «{column}».` | `Перемещение отменено. Карточка «{title}» осталась в колонке «{column}».` |
| `card.movedTo` | `{title} перемещена в «{column}», позиция {position}.` | `Карточка «{title}» перемещена в колонку «{column}», позиция {position}.` |
| `card.moveRejected` | `{title} не перемещена. Доска изменилась и была обновлена.` | `Карточка «{title}» не перемещена: доска изменилась и была обновлена.` |
| `card.saved` | `{title} сохранена.` | `Карточка «{title}» сохранена.` |
| `card.deleted` | `{title} удалена.` | `Карточка «{title}» удалена.` |
| `card.discardDraft` | `Отбросить` | `Сбросить изменения` |
| `card.dueDateHelp` | `Календарный день. Оставьте пустым, если срока нет.` | `Только дата, без времени. Оставьте пустым, если срока нет.` |
| `card.due` | `Срок {date}` | `Срок: {date}` |
| `card.dueSoon` | `Срок {date}` | `Срок: {date}` |
| `card.overdue` | `Просрочено {date}` | `Просрочено: {date}` |
| `card.partOf` | `Часть чего` | `Этап цели` |
| `card.partOfNone` | `Ничего` | `Без привязки` |
| `card.partOfBadge` | `Часть: {milestone}` | `В рамках «{milestone}»` |
| `card.partOfUnknown` | `Часть цели` | `В рамках цели` |
| `goals.editHeading` | `Изменить цель` | `Изменение цели` |
| `goals.actions` | `Действия для {title}` | `Действия с целью «{title}»` |
| `goals.deleteConfirm` | `Удалить цель {title}? Её этапы будут удалены вместе с ней, связанные карточки отвяжутся, а изображения перестанут на неё ссылаться. Это нельзя отменить.` | `Удалить цель «{title}»? Её этапы тоже будут удалены, а связанные карточки и изображения — отвязаны. Это действие нельзя отменить.` |
| `goals.saved` | `{title} сохранена.` | `Цель «{title}» сохранена.` |
| `goals.deleted` | `{title} удалена.` | `Цель «{title}» удалена.` |
| `goals.moved` | `{title} перемещена на позицию {position}.` | `Цель «{title}» перемещена на позицию {position}.` |
| `goals.progress.one` | `выполнено {done} из {count} этапа` | `Выполнено {done} из {count} этапа` |
| `goals.progress.few` | `выполнено {done} из {count} этапов` | `Выполнено {done} из {count} этапов` |
| `goals.progress.many` | `выполнено {done} из {count} этапов` | `Выполнено {done} из {count} этапов` |
| `goals.progress.other` | `выполнено {done} из {count} этапов` | `Выполнено {done} из {count} этапа` |
| `milestone.addTo` | `Добавить этап к {title}` | `Добавить этап к цели «{title}»` |
| `milestone.editHeading` | `Изменить этап` | `Изменение этапа` |
| `milestone.markedDone` | `{title} отмечен выполненным.` | `Этап «{title}» отмечен как выполненный.` |
| `milestone.markedOpen` | `{title} отмечен невыполненным.` | `Этап «{title}» отмечен как невыполненный.` |
| `milestone.actions` | `Действия для {title}` | `Действия с этапом «{title}»` |
| `milestone.deleteConfirm` | `Удалить этап {title}? Связанные с ним карточки отвяжутся. Это нельзя отменить.` | `Удалить этап «{title}»? Связанные с ним карточки будут отвязаны. Это действие нельзя отменить.` |
| `milestone.saved` | `{title} сохранён.` | `Этап «{title}» сохранён.` |
| `milestone.deleted` | `{title} удалён.` | `Этап «{title}» удалён.` |
| `milestone.moved` | `{title} перемещён на позицию {position}.` | `Этап «{title}» перемещён на позицию {position}.` |
| `vision.addHelp` | `JPEG, PNG или WebP. Каждое изображение уменьшается в вашем браузере перед отправкой, и заодно удаляются координаты, которые записывает телефон. Снимки Apple HEIC здесь прочитать нельзя — сначала экспортируйте их в JPEG.` | `JPEG, PNG или WebP. Перед загрузкой каждое изображение уменьшается в браузере, и при этом удаляются данные о местоположении, которые сохраняет телефон. Фото HEIC с устройств Apple здесь не открываются — сначала экспортируйте их в JPEG.` |
| `vision.tile` | `Открыть {caption}` | `Открыть «{caption}»` |
| `vision.goalLink` | `Часть чего` | `Цель` |
| `vision.goalNone` | `Ничего` | `Без привязки` |
| `vision.editHeading` | `Изменить изображение` | `Изменение изображения` |
| `vision.actions` | `Действия для изображения {n}` | `Действия с изображением {n}` |
| `vision.moveEarlier` | `Переместить раньше` | `Переместить ближе к началу` |
| `vision.moveLater` | `Переместить позже` | `Переместить ближе к концу` |
| `vision.deleteConfirm` | `Удалить это изображение? Это нельзя отменить.` | `Удалить это изображение? Это действие нельзя отменить.` |
| `vision.uploadHeading` | `Добавляем изображения` | `Добавление изображений` |
| `vision.filePreparing` | `Готовим` | `Подготовка` |
| `vision.fileUploading` | `Отправляем` | `Загрузка` |
| `vision.fileUnreadable` | `Этот файл не удалось прочитать как изображение. Сначала экспортируйте снимок Apple HEIC в JPEG.` | `Не удалось прочитать этот файл как изображение. Если это фото HEIC с устройства Apple, сначала экспортируйте его в JPEG.` |
| `error.invalid_credentials` | `Такое сочетание адреса и пароля не подошло.` | `Неверный адрес электронной почты или пароль.` |
| `error.forbidden` | `У вас нет доступа к этому.` | `У вас нет на это прав.` |
| `error.unavailable` | `Доска временно недоступна. Попробуйте чуть позже.` | `Приложение временно недоступно. Попробуйте чуть позже.` |
| `error.invalid_pending_token` | `Регистрация истекла. Начните заново.` | `Время на регистрацию истекло. Начните заново.` |
| `error.invalid_phrase` | `Фраза не совпала.` | `Фраза для восстановления не совпадает.` |
| `error.invalid_challenge` | `Запрос на восстановление истёк. Начните заново.` | `Срок действия запроса на восстановление истёк. Начните заново.` |
| `error.revision_conflict` | `Что-то изменилось в другом месте. Данные обновлены.` | `Данные изменились в другом месте и были обновлены.` |
| `error.payload_too_large` | `Это слишком велико для сохранения. Попробуйте текст покороче или изображение поменьше.` | `Слишком большой объём для сохранения. Сократите текст или выберите изображение поменьше.` |
| `error.goal_limit` | `Места для ещё одной цели нет. Сначала удалите одну.` | `Больше целей добавить нельзя. Сначала удалите одну из них.` |
| `error.milestone_limit` | `Места для ещё одного этапа нет. Сначала удалите один.` | `Больше этапов добавить нельзя. Сначала удалите один из них.` |
| `error.image_too_large` | `Это изображение слишком велико.` | `Это изображение слишком большое.` |
| `error.unsupported_image_type` | `Такой вид изображения использовать нельзя. Попробуйте JPEG, PNG или WebP.` | `Этот формат изображения не поддерживается. Используйте JPEG, PNG или WebP.` |
| `error.image_rejected` | `Это изображение не удалось прочитать.` | `Не удалось прочитать это изображение.` |
| `field.email.invalid_email` | `Введите правильный адрес электронной почты.` | `Введите корректный адрес электронной почты.` |
| `field.emails.invalid_emails` | `Одна из строк не является правильным адресом, или адрес повторяется.` | `В одной из строк некорректный адрес, или какой-то адрес повторяется.` |
| `field.title.required` | `Введите заголовок.` | `Введите название.` |
| `field.title.too_long` | `Заголовок слишком длинный.` | `Название слишком длинное.` |
| `field.title.invalid` | `В заголовке есть символы, которые нельзя сохранить.` | `В названии есть символы, которые нельзя сохранить.` |
| `field.assigneeUserId.ineligible` | `Этому человеку больше нельзя назначать карточки.` | `Этому участнику больше нельзя назначать карточки.` |
| `field.assigneeUserId.invalid` | `Это назначение недопустимо.` | `Такого исполнителя выбрать нельзя.` |
| `field.year.out_of_range` | `Выберите год между 2000 и 2999.` | `Выберите год от 2000 до 2999.` |
| `field.dueDate.invalid` | `Введите настоящую дату — год, месяц и день.` | `Введите корректную дату: день, месяц и год.` |
| `field.dueDate.out_of_range` | `Выберите дату между 2000 и 2999 годом.` | `Выберите дату в пределах 2000–2999 годов.` |
| `field.notes.too_long` | `Эти заметки слишком длинные.` | `Заметки слишком длинные.` |
| `field.caption.too_long` | `Эта подпись слишком длинная.` | `Подпись слишком длинная.` |
| `field.data.invalid` | `Это изображение не удалось прочитать.` | `Не удалось прочитать это изображение.` |
| `field.mediaType.invalid` | `Такой вид изображения здесь использовать нельзя.` | `Этот формат изображения здесь не поддерживается.` |
| `field.width.invalid` | `Такой размер изображения недопустим.` | `Недопустимые размеры изображения.` |

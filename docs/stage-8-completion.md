# Stage 8 — due dates, goals, and the vision board

**Date:** 2026-09-14
**Deployed test Worker:** `https://family-board-test.yuval3000.workers.dev`, version `06a0ba4d-02c9-4535-b1df-bf25e07d7b95` — deployed by CI from commit `d8f65db` on `main`, run [34809371375](https://github.com/yhaspel/goal-tracker/actions/runs/34809371375), both jobs green. It supersedes `aa5f9bf2`, the hand-deployed build the measurements below were taken against; the two are the same commit.
**Schema version:** 5 (migration 5 applied to the existing test object, which held real disposable data)
**Status:** implemented and proven on the deployed **test** Worker. **Not deployed to production, and it must not be** — Stage 7's exit gate has not passed. See [the Stage 7 status record](stage-7-status.md).

This records what was verified, what was measured, and what was not. Where a number came from a
local Workers-runtime run rather than the deployed Worker, it says so.

## What shipped

Migration 5 (`goal_state`, `vision_state`, `goals`, `milestones`, `vision_images`, and two
nullable columns on `cards`), the goals and vision APIs with their tests and deployed smoke
scripts, the due-date and milestone-link card changes, the `/goals` and `/vision` screens, the
extracted `ActionsMenu`, complete `en`/`he`/`ru` dictionaries including the four reworded existing
strings, the backup and restore extensions with a paged image phase, and the updates to
[`design-system.md`](design-system.md), `AGENTS.md` and [`README.md`](../README.md).

## The CPU gate, and the caps it changed

**This is the one finding that changed the product.** Stage 8's plan proposed `MAX_IMAGE_BYTES`
of 1,400,000 and `MAX_THUMB_BYTES` of 120,000, and required the resulting upload to clear the
front Worker's Free CPU budget with margin — `forwardBounded` buffers the whole body into one
`Uint8Array` before forwarding, so the front Worker pays for every byte.

Cloudflare's limits pages were re-read on 2026-09-14, as the plan requires rather than quoting the
master plan's dated table. **Workers Free is still 10 ms CPU per request**, and 100,000
requests/day. Durable Objects are documented separately at a 30-second default, extendable to 5
minutes — so the 10 ms figure is the *front Worker's* budget, which is what the gate is about.
Durable Objects Free is **5 GB total** across the account with a **1 GB** per-object limit, a 2 MB
maximum row/BLOB size, and 100 columns per table. `vision_images` has nineteen columns and a
maximum row of roughly 0.5 MB, both comfortable.

Measured on the deployed test Worker through `wrangler tail --format json`, which reports
`cpuTime` and `executionModel` per invocation. Each row is the **front Worker** (`stateless`)
invocation for a `POST /api/v1/vision/images`:

| decoded image + thumb | request body | n | median CPU | max CPU | over 10 ms |
| --- | --- | --- | --- | --- | --- |
| 1,400,000 + 120,000 | 2,026,857 | 7 | 24 ms | **39 ms** | 7 / 7 |
| 1,000,000 + 120,000 | 1,493,525 | 1 | 18 ms | 18 ms | 1 / 1 |
| 800,000 + 120,000 | 1,226,857 | 9 | 7 ms | 15 ms | 4 / 9 |
| 600,000 + 120,000 | 960,188 | 5 | 11 ms | 17 ms | 4 / 5 |
| 400,000 + 120,000 | 693,524 | 5 | 6 ms | 7 ms | 0 / 5 |
| 250,000 + 120,000 | 493,524 | 5 | 5 ms | 8 ms | 0 / 5 |

The shape of that is a **threshold, not a slope**. Below roughly 700 KB of request body the worst
case stays at 7–8 ms; above it the maximum jumps to 15–18 ms and keeps climbing. The floor is
about 3–8 ms whatever the size, so no cap buys a large margin — what a cap can do is keep the
size-dependent part small.

**The caps were therefore lowered, which is the action the plan pre-authorises for this
outcome** ("lower `MAX_IMAGE_BYTES` until it does; do not raise the limit by moving to a paid
plan, and do not skip the measurement"):

| Constant | Plan | Shipped |
| --- | --- | --- |
| `MAX_IMAGE_BYTES` | 1,400,000 | **400,000** |
| `MAX_THUMB_BYTES` | 120,000 | **100,000** |
| `VISION_BODY_LIMIT` / `MAX_VISION_BODY` | 3 MiB | **1 MiB** |

Re-measured at the shipped caps (667 KB body), fourteen uploads on the deployed test Worker:

| | median | p90 | max | over 10 ms |
| --- | --- | --- | --- | --- |
| Front Worker (`stateless`) | **7 ms** | 14 ms | 14 ms | **2 / 14** |
| Durable Object | 14 ms | 17 ms | 18 ms | 12 / 14 |

So the change moved the front Worker from *always* over the documented budget (7 of 7) to usually
under it (12 of 14), and cut the median from 24 ms to 7 ms. Wall time for a maximum upload is
209–251 ms typical.

**The residual risk, stated plainly.** Two of fourteen samples at the shipped caps still measured
14 ms, over the documented 10 ms. Outliers of that size appeared at *every* payload size tested,
including the smallest — the 494 KB body produced an 8 ms sample against a 5 ms median — so they
are not bought off by lowering the cap further, and lowering it further would cost image quality
for no measured CPU benefit. 400,000 is where the size-dependent component stops dominating.

**A second observation, which is not a licence.** Across roughly forty deployed requests, **no
request was ever terminated for exceeding CPU** — every `outcome` was `ok`, including the samples
at 39 ms, nearly four times the documented limit. The 10 ms figure did not behave as a hard
per-request kill on this account. That is an observation about current enforcement, not a
guarantee, and the caps were set against the documented limit rather than against the observed
leniency. If Cloudflare tightens enforcement, the shipped configuration is the one that survives.

**What the lower cap costs a member: a quality step, not a refusal.** The browser encodes to WebP
at q0.82 and, if that is over the cap, re-encodes to JPEG at 0.82 → 0.72 → 0.62 → 0.5. A 1600px
photograph lands inside 400 KB at those settings. A 3000×2000 source driven through the real
pipeline in a browser produced a 1600×1067 WebP of **10,438 bytes** with a 320×213 thumbnail of
1,472 bytes — two orders of magnitude inside the caps.

One consequence worth recording: at 500,000 decoded bytes per image, sixty images is 30 MB, so the
**60-image count cap now binds before the 64 MiB byte budget**, which the plan expected to bind
first at around 44 images. Both caps are kept; `storage_full` is now reachable only through the
`databaseSize` backstop.

## The other measurements

### Gallery cost, on the deployed test Worker

Measured at **twenty** images, because the per-account upload limit is thirty per fifteen minutes.
Thumbnails were 30,000 bytes each, which is what the 320px WebP encode produces for a detailed
image.

| | requests | bytes | wall |
| --- | --- | --- | --- |
| Cold | 21 | 611,042 | 2,879 ms |
| Warm, forced revalidation (20 × `304`) | 21 | 11,042 | 2,014 ms |
| Warm, as a browser actually behaves | **1** | 11,042 | — |

The listing alone was 11,042 bytes for twenty images. **Extrapolated** to the sixty-image cap:
61 requests and roughly 1.8 MB cold, and **one request** warm — because
`Cache-Control: private, max-age=31536000, immutable` means a browser does not revalidate at all.
That single header is what keeps a full gallery from costing sixty Durable Object requests on
every view of an object that serialises the whole household's work.

### Response sizes and SQL cost, in the Workers runtime

These are deterministic functions of the data and the same code runs in both places, so they were
measured by `tests/stage8.measurements.test.ts` rather than by filling the deployed test household
with five hundred disposable cards. **They are not deployed measurements**, and the file says so.

| What | Result |
| --- | --- |
| Board response, 500 cards each with a due date and a milestone link | 172,124 bytes |
| Goals snapshot at the caps (50 goals × 24 milestones) | 369,676 bytes |
| Goals **index** at the same caps — what the card editor fetches | 137,553 bytes |
| Vision listing, 60 images holding 25.8 MB of bytes | **33,310 bytes** |
| Goal delete detaching 100 cards from 24 milestones | one `UPDATE`, one `DELETE`, one compaction |

The vision listing number is the one that matters most: a gallery holding 25.8 MB of image bytes
serialises to 33 KB, because no listing query ever names `content` or `thumb`. A `SELECT *`
creeping back in would make that number explode, which is why the test asserts a ceiling on it.

### `databaseSize`

Measured in the Workers runtime, before an upload, after it, and after deleting it:
**262,144 → 659,456 → 262,144 bytes.**

It **did** fall. The plan expected it very likely would not — SQLite puts freed pages on a
freelist rather than returning them to the file — and told us not to write a test asserting that
it falls. No such test was written; the measurement reports whichever happens. Two caveats: this
is the local runtime, not the deployed one, and no route exposes `databaseSize` on a deployed
Worker, so the deployed behaviour is **unverified**. `MAX_DATABASE_BYTES` is still documented as a
one-way ratchet, and `vision_state.bytes_used` is still the member-facing budget.

## Deployed acceptance checks

Run against `https://family-board-test.yuval3000.workers.dev`, schema 5, with the disposable
household. Each script leaves the environment as it found it.

They were run twice: once against the hand-deployed build while the work was in progress, and
again against **`06a0ba4d`, the version CI deployed** — because the version that is live is the one
the acceptance checks have to be true of, and a hand-deployed build is not that version even when
it is the same commit. Identical results both times.

| Script | Result |
| --- | --- |
| `scripts/goals-smoke.ts` | **54 / 54** |
| `scripts/vision-smoke.ts` | **39 / 39** |
| `scripts/board-smoke.ts` (regression) | **39 / 39** |

Between them those cover: goal create/reorder/year-move-with-compaction, a title-only patch that
resends the year leaving position alone, milestone create and status change, a card carrying a due
date and a link, a title-only card edit preserving both, an impossible date refused with a field
error, the compact index and the four refused `?view=` shapes, a stale-revision `409` carrying
`details.goalsRevision`, a goals change **not** invalidating a board writer, the delete cascade
advancing the board revision exactly once, byte-exact image round trip, the cache and `ETag`
contract, `304` revalidation, `401`-not-`304` for an anonymous caller with a matching ETag, the
four refused `?variant=` shapes, a type/bytes mismatch refused, an SVG refused whatever it
declares, unpadded base64 refused before decoding, and a delete that gives the bytes back.

Local suite: **21 files, 258 tests**, plus `lint`, `typecheck`, `check:links`, `check:i18n` and
`build`. The production dry-run bundle contains no `operator/import`, no `restore_import_marker`
and no `restore_pending_images`; the restore bundle contains all three. CI asserts both.

## Interface walk

Walked in Chrome against a local server seeded with English, Hebrew and Russian content, real
decodable PNGs, and cards in all three due states.

**Covered:** `/board`, `/goals`, `/vision` at 390 / 834 / 1440; `en`, `he` and `ru`; light and
dark; guest and signed-in separately; keyboard only for the carousel. Specifically confirmed:

- No horizontal page scroll at 390, 834 or 1440 in any locale (`scrollWidth === clientWidth`).
- The three due badges render distinctly, each with its own sentence and a mark as well as a tint.
- Hebrew mirrors: the year strip, the meter's fill direction, the Done toggle's position, the
  date input's picker indicator and the select drop arrow all flip.
- Composite labels read correctly: `כרטיס · Call the landlord` in a Hebrew page, `אפריל · Book the
  van` in the "Part of" select, `Добавить этап к Move the flat` in Russian.
- Month names come from `Intl` in all three locales (מרץ / АПРЕЛЬ / March).
- The phone sheet holds five links at **480 px** — measured, against 90vh — and does not overflow.
- The 834–1199 header **is two rows**, hardest in Russian, as the design system now records.
- Contrast on every new control, computed in both themes: text 5.88–14.79 (light) and 6.89–14.67
  (dark); borders 3.16; the meter fill against its track 6.78.
- Nothing interactive under 24 px, and nothing under 44 px in the card dialog.
- The full upload pipeline in a real browser: 3000×2000 PNG → 1600×1067 WebP with the media type
  read back from the blob, a 320×213 thumbnail drawn from the full canvas, a per-file status that
  reached "Added", and `aria-busy` returning to false.
- Keyboard-only carousel: focus a tile → Enter opens → ← / → step (2 → 3) → Escape closes and
  focus returns **to that tile**.
- Guest: `/goals` and `/vision` serve the shell `no-store` and then redirect to `/login`;
  `/goalz` is a 404; both APIs answer `401`.

**Four defects were found by the walk and fixed:**

1. **The carousel's arrow keys did nothing.** `Dialog` moves focus to the first focusable control,
   which is the Close button in the dialog *header* — a sibling of the body the carousel renders
   into — so a `keydown` handler on the carousel element never saw the key. ← and → only worked
   once the member had tabbed onto Previous or Next. Rebound on the document while the carousel is
   open, the way the phone header's Escape already is, and re-verified.
2. **The gallery was ragged.** Each tile kept its own aspect ratio, so one portrait image stretched
   its whole row and left dead space under its neighbours' captions. Tiles now share a 4:3 preview
   box with `object-fit: cover`; the carousel still shows the whole image, `contain`.
3. **The language selector was 36 px tall in the phone sheet** — below the 44 px floor. The 36 px
   is deliberate for the desktop header's compact row, where a pointer reaches it; the sheet is a
   finger surface. **This is a pre-existing Stage 6 defect**, not one Stage 8 introduced, but it
   sits in a surface Stage 8 changed and the walk is what found it.
4. **A tile with no caption showed "Open image 4" as visible text** — an instruction where a noun
   belongs. Split into `vision.untitled` for the label, keeping `vision.tileAt` for the button's
   accessible name.

**Not covered, and not claimed:**

- **No screen-reader pass.** The announcement strings, `aria-pressed`, `aria-busy` and the live
  regions were verified structurally in the accessibility tree, not by listening. This is the same
  gap Stage 6 closed by owner decision rather than by its gate passing.
- **`prefers-reduced-motion` was not emulated in the browser.** The rule removing the carousel's
  transition is present in the stylesheet, and the position counter is structural — it is in the
  DOM unconditionally, not created by an animation — so it renders in both modes by construction.
  That is an argument from the code, not an observation.
- The remaining seven routes were walked only incidentally, through the header, which is the part
  of them Stage 8 changed.
- Only Chrome. No Safari or Firefox pass, and in particular the WebKit date-input and
  `createImageBitmap` HEIC behaviours are handled in code but unobserved.
- No touch-device pass; 390 px was emulated with touch, not driven by a finger.

## Decisions and deviations recorded here

- **The three revisions are independent, and the "only when a row changed" rule is stricter than
  the two existing paths.** `routes/members.ts` bumps the board revision unconditionally whenever
  its target was active, and `routes/allowed-emails.ts` keys its bump on an eligibility change
  rather than on rows written. Stage 8 uses `sql.exec().rowsWritten` and advances a neighbouring
  revision only when it is greater than zero. **Stage 8 deliberately does not change those two
  older paths**; the difference is recorded here so a later reader does not mistake it for an
  inconsistency to "fix".
- **The board's own wording changed.** Because one `revision_conflict` code now serves three
  domains and `errorText` looks up `error.${code}` with no domain context, four existing strings
  were reworded in all three languages to stop naming the board: `error.revision_conflict`,
  `error.network`, `field.boardRevision.invalid`, and `error.payload_too_large` (which now has to
  cover an over-long description and an over-large image alike).
- **One deliberate exception to the blanket `no-store` on `/api`.** `GET
  /api/v1/vision/images/:id/content` answers `private, max-age=31536000, immutable` with a strong
  `ETag`. An image's bytes never change for the life of its id, and `private` keeps every shared
  cache out, so Stage 7's guarantee — a cache cannot serve one member's response to another — is
  unchanged. Stage 7's plan and its acceptance wording were amended to match. The session is
  re-checked **before** the `If-None-Match` comparison, so a member whose access ended gets `401`,
  never a `304`; the deployed smoke test asserts exactly that.
- **The operator image routes needed their own rate limit.** A restore drill at the image cap was
  refused at its sixth image, because `operatorImportPerIp` is six per fifteen minutes — sized when
  an import was one request. The envelope routes keep their tight limits, because each of those
  serialises or parses a whole household; the paged image routes got `operatorImagePerIp` at 400,
  sized for three backup attempts or a resumed restore at the caps. **This was found by a test, not
  by reasoning.**
- **A version 1 envelope must be rebuilt in its own shape before its digest is checked.** The
  reader is version-aware and the upgrade to the version 2 shape happens afterwards. Adding the
  version 2 fields before verification would have made every backup taken before today fail its own
  digest — including the only production copy that exists.
- **The stored archive format moved to `goal-tracker-backup-v2`**, because image bytes do not fit
  inside the envelope. `v1` copies remain readable by `verify` and `restore`; a `v1` copy simply
  has no images, which is correct, because it predates them.
- **The server cannot verify that a thumbnail depicts its image.** It checks type, magic bytes,
  size and dimensions, and that the thumbnail is no larger than the full image in either
  dimension. In a seven-person invitation-only household that is accepted, and written down here
  rather than implied by a check that does not exist.
- Three deviations were added to [`design-system.md`](design-system.md)'s list, taking it from
  seven to eleven: the native date input, the visually hidden file input, `Intl`-supplied month and
  date names, and the two composite select labels that are byte-identical in all three locales.

## What this stage does **not** close

**Stage 8 must not reach production until Stage 7 closes.** Production has held real household
data since 2026-09-13 with a lost-phrase rescue that has never been proven against a deployed
Worker and no successful sign-in on a restored household. Every feature here adds rows that exist
nowhere else, and migration 5 would be applied to that live database.

The plan's own delivery condition names one more thing this record cannot claim: an encrypted
backup taken at the Stage 8 caps and restored into a pristine isolated namespace. The **restore
drill at the caps passed in the Workers runtime** — sixty images through both phases, byte for
byte, with the restored household re-exporting to identical counts, images and cards — but it has
**not** been run against a deployed restore Worker with a real encrypted archive on disk.

**Why it stopped there, precisely.** Every operator route on the deployed test Worker answers
`404`, verified on 2026-09-14 with no bearer, with a wrong bearer, and on the paged image export:

```
GET  /api/v1/operator/export              → 404
GET  /api/v1/operator/export/images/abc   → 404
POST /api/v1/operator/import              → 404
```

That is correct and expected. Test has no `BACKUP_OPERATOR_SECRET`, so `authorize()` fails closed
and answers with the same `404` an unknown path gets; and the import route is compiled out of the
test build entirely. Exercising the two-phase backup against a deployed Worker therefore needs two
things this run deliberately did not do on its own: **provisioning a `BACKUP_OPERATOR_SECRET` on
test**, and **standing up a dated drill Worker with a public hostname** — the standing `restore`
environment has `workers_dev: false` and no route, which is exactly why an idle restore Worker is
not an attack surface. Both are operator actions with their own procedure in
[the operator runbook](operator-runbook.md#monthly-restore-drill).

That drill is the first thing to do when this is picked up, and it belongs with the Stage 7
checklist in the same runbook.

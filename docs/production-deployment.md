# Production deployment record

**Date:** 2026-09-13 (Asia/Jerusalem)
**Worker:** `family-board-production` → <https://family-board-production.yuval3000.workers.dev>
**Version:** `e1b889bd-e89e-45ec-98ce-fe19af832844`, deployed at 100%
**Commit:** `6d1538b`, CI [34751472649](https://github.com/yhaspel/goal-tracker/actions/runs/34751472649) — `checks: success`, `deploy-test: success`
**Deployed by:** `npm run deploy:prod`, manually, on the owner's explicit instruction

## Why this record exists

The plans sequence production behind Stage 7's backup, restore, and hardening gate, and the
Stages 2–6 execution prompt says not to deploy new application behaviour to production. The
owner was told that, asked for the deployment anyway, and that decision stands. This page
records what was deployed, what was deliberately not done, and which guarantees are therefore
not yet in place, so nobody later mistakes the current state for a completed release.

## What was deployed

The application as of commit `6d1538b`: the account API, credential rotation, the board API,
the React interface, and the English, Hebrew, and Russian dictionaries. The production bundle
is byte-identical in behaviour to the test one apart from its bindings — the same asset hash,
`index-UP1JWDx3.js`, is served by both.

On the first request the production Durable Object applied schema migrations 2, 3, and 4. That
is a forward-only change: redeploying older Worker code does **not** remove those tables.

## Secrets

All four were generated fresh for this environment and uploaded through stdin, so none reached
a command line or a shell history entry. Production shares no secret with test.

| Secret | Purpose | State |
| --- | --- | --- |
| `BOOTSTRAP_SECRET` | Opened one-time owner creation | **Deleted 2026-09-13**, after the owner account existed |
| `RECOVERY_DIGEST_KEY` | Keys recovery-phrase digests and operator reset tokens | Configured |
| `CSRF_SECRET` | Signs the session-bound CSRF value | Configured |
| `RATE_LIMIT_KEY` | Pseudonymises rate-limit bucket keys | Configured |

The three remaining secrets are escrowed at `.secrets.production.env` (mode 0600, ignored by
Git) on the owner's machine. Escrow happened at creation, because Cloudflare never shows a
secret again and the lost-phrase runbook is inoperable without `RECOVERY_DIGEST_KEY`. The test
environment had to learn that the hard way; see the [execution log](stages-2-6-execution-log.md).

**Move that file into real escrow, separately from any data backup.** A single laptop is not
an escrow. Replacing `RECOVERY_DIGEST_KEY` later invalidates every stored recovery phrase.

### `BOOTSTRAP_SECRET` was retired on 2026-09-13

Once the owner account existed, the secret had no remaining purpose: owner creation is closed
permanently by database state, not by the secret. It was deleted from the Worker at the owner's
request and removed from the escrow file, so no copy of it remains anywhere the project
controls.

Bootstrap now fails closed twice over, which was confirmed on the deployed Worker:
`GET /api/v1/auth/bootstrap/status` reports `bootstrapAvailable: false` because the state is
consumed, and `POST /api/v1/auth/bootstrap/prepare` answers `403` for **any** supplied value
because no secret is configured at all. Health, the board, and login were unaffected.

Restoring owner creation is not possible and is not meant to be: if the owner account is ever
lost, the route back is the lost-phrase operator rescue, not a second bootstrap.

**Move that file into real escrow, separately from any data backup.** A single laptop is not
an escrow. Replacing `RECOVERY_DIGEST_KEY` later invalidates every stored recovery phrase.

## Verified on the deployed Worker

| Check | Result |
| --- | --- |
| `python3 scripts/verify_stage_1.py <production> routing` | Passed: navigation routes serve the shell, unknown paths and unknown API paths return JSON 404, health carries `Cache-Control: no-store`, a wrong method returns 405 with `Allow` |
| Schema version | 4 |
| `GET /api/v1/board`, `GET /api/v1/members` | 401 — live and requiring a session |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":true}` — no owner exists |
| Diagnostic routes | 404; the strings are absent from the minified production bundle |
| `family-board-restore` | Still unexposed, 404, no public route |

## Task D revalidation, 2026-09-13 (later the same day)

`handoff-remaining-checks.md` Task D asks for a read-only re-check of the checklist above,
without touching production. Re-run this session, all via plain unauthenticated HTTP requests
with no cookies (no login attempt beyond the one generic-failure check the checklist itself
prescribes), except the last two rows:

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 4`, `Cache-Control: no-store` — matches |
| `GET /api/v1/auth/bootstrap/status` | **`{"bootstrapAvailable":false}`** — does **not** match the deployment-time row above (`true`). See the flag below |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` (no session) | All `401`, code `unauthenticated`, generic body, no address named — matches |
| `GET /api/v1/diagnostics/probe?nonce=<32 hex>` | `404` — matches |
| `POST /api/v1/auth/bootstrap/prepare`, wrong secret | `403`, then `429` with `Retry-After` on repeat — matches |
| `POST /api/v1/auth/login`, dummy address, correct `Origin` | `401 invalid_credentials`, generic message — matches |
| Same request, no `Origin` header | `403 forbidden` — matches |
| `https://family-board-restore.yuval3000.workers.dev` | `404` — matches |
| Browser: `/board`, `/login`, `/register`, `/recover`, `/bootstrap`, `/account`, `/members` | Each returns `200` and serves the same SPA shell (checked with plain `curl`, no cookies) — matches |
| Browser: `/board` as a guest redirects to `/login` | **Not verified.** That redirect is client-side routing, invisible to `curl`, and the only open browser tab to production this session unexpectedly already held a signed-in session rather than a guest one (see the flag below), so this could not be exercised safely |
| Browser: `localStorage`, `sessionStorage`, `document.cookie` | **Not verified**, for the same reason — the browser automation tool's own safety redaction also declines cookie/session-storage reads on a page it recognizes as holding a live session, and this session did not attempt to bypass that |
| Cloudflare dashboard | Production and test remain distinct Durable Object namespaces with distinct secret stores; production still has no Workers Builds connection — matches |

### Re-verified after the documentation push, 2026-09-13

Commit `94a123e`, CI run
[34756958780](https://github.com/yhaspel/goal-tracker/actions/runs/34756958780) —
`checks: success`, `deploy-test: success`. That push changed documentation only; no application
code moved, and nothing was deployed to production.

The whole checklist above was re-run afterwards with plain unauthenticated `curl`. **Every row
still matches**, with two rows now reading differently for known reasons:

- `GET /api/v1/auth/bootstrap/status` returns `{"bootstrapAvailable":false}`, which is correct
  and expected — an owner exists.
- `POST /api/v1/auth/bootstrap/prepare` now answers `403` for **any** value, not only a wrong
  one, because `BOOTSTRAP_SECRET` has been deleted. Repeats reached `429` with a decreasing
  `Retry-After` (231s, 231s, 230s), so the per-address limit is working.

The 401 bodies were read in full and disclose nothing:
`{"error":{"code":"unauthenticated","message":"Sign in to continue."}}` from all three
protected routes, with no address named. The two rows left unverified above — the guest
redirect from `/board` and browser storage contents — remain unverified here, for the same
reason: checking them needs a browser holding no production session.

### Confirmed: a production owner account exists

Two independent observations this session, both unexpected: `GET /api/v1/auth/bootstrap/status`
returned `bootstrapAvailable:false` (confirmed twice, including once from a plain `curl` with no
cookies at all, which rules out any browser-session artifact), and a Chrome tab already open to
`/board` returned `200` from `/api/v1/board` and `/api/v1/auth/session` rather than the `401` a
guest gets. Reading `worker/src/routes/auth.ts` confirms `bootstrapAvailable` can only be
`false` once the bootstrap-confirm transaction has run, and that transaction creates the real
owner row in the same statement — there is no code path that lets the flag desync from reality.

**The owner confirmed it directly on 2026-09-13: they bootstrapped the production owner account
themselves**, outside of this session and separately from anything either automated run did. So
this is fact, not inference: production now holds a real owner account, and — because the owner
signed in on this machine to do it — a live session for it. Treat the two bullets under
"Deliberately not done" below as describing the state **at deployment**, now superseded; the
current state is in the new section right after this one.

None of the cautions elsewhere in this repository soften because of this — if anything they now
matter more, since they apply to a real account rather than a hypothetical one: no backup exists
for production, and the lost-phrase operator rescue has been proven only against the **test**
Worker (see the [Stage 3 completion report](stage-3-completion.md)), never against production's
own Durable Object and secrets. Concretely: if this owner's password and recovery phrase are
both lost right now, the account is not recoverable, and if the Durable Object were ever lost or
corrupted, there is nothing to restore it from.

## Deliberately not done

- **No owner account was created, at the moment of this deployment.** Bootstrap was open, and
  the board held nothing but its three seeded columns. **No longer current — the owner
  bootstrapped an account on 2026-09-13; see "Confirmed: a production owner account exists"
  above.**
- **No invitations, members, or cards existed, at the moment of this deployment** (same
  caveat — the owner may have added some since).
- **CI still deploys test only.** Production has no automatic pipeline; this deployment was
  manual and the next one must be too, until a separate production release workflow exists.

## Guarantees that are not yet in place

These are Stage 7's job and none of them is done. They are the reason the gate existed.

- **No backup, export, or restore.** There is no way to take a copy of production data and no
  proven way to put one back. Cloudflare's 30-day point-in-time recovery is not a substitute
  and has never been exercised for this object.
- **The lost-phrase operator rescue has never been proven against a deployed Worker.** It works
  end to end against a local Durable Object using the real runbook SQL, but the deployed
  rehearsal is still outstanding. Until it is done, assume that a person who loses both their
  password and their recovery phrase cannot be recovered.
- **No manual screen-reader review** has been performed by this project's tooling in any locale
  — Stage 6 was closed by owner decision without it; see
  [`docs/stage-6-completion.md`](stage-6-completion.md). The owner reported on 2026-09-13 that
  the screen reader works, and the four defects the structural walkthrough had recorded are now
  fixed and deployed, but no review run by this project has ever produced that finding.
- No production security-header review, dependency review, restore drill, or usage review.

See [`docs/stage-6-completion.md`](stage-6-completion.md) for how Stage 6's screen-reader check
was closed and
`development-plans/stage-7-backup-hardening-release.md`
for the rest.

## The owner account, now that it exists

Bootstrap closed on 2026-09-13 when the owner created the account directly (see "Confirmed: a
production owner account exists" above), ahead of the original advice in this document to wait
for backup and a deployed rescue rehearsal first. That decision stands; this section is now
about what protects the account that exists, not about how to create one.

- **The recovery phrase shown at bootstrap is the only backup that exists for this account.**
  It was displayed exactly once. If it was not saved somewhere durable at the time, there is
  currently no way to regenerate it without already being signed in.
- **The lost-phrase operator rescue is unproven against production.** It has been exercised
  successfully, repeatedly, against the **test** Worker's own Durable Object (see the
  [Stage 3 completion report](stage-3-completion.md)), but never against production's. Until
  someone deliberately rehearses it there — which itself requires care, since it means
  generating and redeeming a real operator token against the live object — do not assume it
  will work the same way.
- **`BOOTSTRAP_SECRET` has been deleted** from the deployment, on 2026-09-13. See the Secrets
  section above. It was not load-bearing — the route already refused a second owner from
  database state alone — so removing it only closed residual exposure.
- Bootstrap cannot run again while this owner row exists, so there is no way to create a second
  owner by mistake.

## Rollback

Redeploying an earlier Worker version restores earlier behaviour but **does not** undo the
schema migration, and must not be taken below Stage 2, which would remove allowed-list
enforcement. Do not reset or delete the production Durable Object namespace: after an owner
exists it holds the only copy of the household's data, and there is no backup to restore from.

## Second production deployment, 2026-09-13 — the accessibility fixes

**Version:** `ff9c08c2-8b7e-4b89-8b16-3781e5ba0743`, deployed at 100%
**Commit:** `cec6c80`, CI [34758786464](https://github.com/yhaspel/goal-tracker/actions/runs/34758786464) — `checks: success`, `deploy-test: success`
**Deployed by:** `npm run deploy:prod`, manually, on the owner's explicit instruction

An intermediate deployment of `54e23a7` (version `865df723-d3f4-44c8-9c4e-ea7a93c2bd3c`, CI
[34758484173](https://github.com/yhaspel/goal-tracker/actions/runs/34758484173)) was superseded
about seven minutes later by `cec6c80`, which adds the target-size fix for the guest screens.

This deployment is **interface-only**. No route, no API contract, no migration: the production
Durable Object still reports `schemaVersion: 4`, unchanged from the first deployment, and no
production data was read, created, or modified. The bundle production serves is byte-identical
to the local build and to what CI deployed to test — `sha256 a60fcf87d76a3ef4` for
`index-B_sTXiOj.js` and `ca2965fe67383856` for `index-DBIBJqBn.css`, compared directly rather
than inferred from the filename hash.

What changed: the keyboard-drag announcements, the language-switcher confirmation locale,
`dir="auto"` on the card and column-name inputs, the drag overlay's duplicate DOM `id`, and two
minimum-target-size fixes. See the [Stage 6 completion report](stage-6-completion.md).

### Verified on the deployed Worker, read-only

Nothing below signs in. Production holds a real owner account whose credentials this session
does not have and did not seek.

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 4`, `Cache-Control: no-store` — unchanged by the deployment |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` (no session) | All `401 unauthenticated`, generic body, no address named |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":false}` — the owner still exists and bootstrap stays closed |
| `GET /api/v1/diagnostics/probe` | `404`; diagnostics remain absent from the production bundle |
| `family-board-restore` | `404`, still unexposed |
| SPA routes `/board /login /register /recover /account /members /bootstrap` | Each `200 text/html`; an unknown path is `404` |
| Served assets | Byte-identical to the local build, both hashes confirmed |
| New announcement strings present in the shipped bundle | All three locales — `Picked up` / `הורם` / `поднята`, and the cancel strings — found in the minified production JS |
| Old duplicated-`id` markup | Absent from the shipped bundle |

### The two rows that could never be verified before

Both earlier attempts recorded these as unverified because the only browser tab open to
production already held a live session. A browser context holding no production session at all
closes them:

| Check | Result |
| --- | --- |
| `/board` as a guest redirects to `/login` | **Verified.** Navigating to `/board` with no session lands on `/login` |
| Browser storage contents | **Verified.** `localStorage` and `sessionStorage` are both empty, and the only script-visible cookie is `kanban_locale`, the non-sensitive preference. The session cookie is `__Host-` and `HttpOnly`, so it is correctly invisible to script |

### Guest interface, all three locales, mobile

390 × 844 with touch emulation, across `/`, `/login`, `/register`, `/recover`, and `/bootstrap`
in English, Hebrew, and Russian: correct `lang` and `dir` in every case, no horizontal overflow,
and no interactive target under 24 × 24 CSS pixels apart from one link that is deliberately
inline in a sentence. The only console error is the `401` a guest's own session probe returns,
which is the expected behaviour.

The signed-in screens were exercised against a **local** Durable Object with a disposable owner
account, not against production — that is where the drag announcements, the locale-switch
confirmation, and the editor's text direction were checked. See the
[execution log](stages-2-6-execution-log.md).

### Rollback

Redeploying version `596488a7-b2d5-4415-801c-ecc6d3c49087` restores the interface as it was
before these fixes. It touches no schema and no data, so it is safe in a way the first
deployment's rollback was not — but it reintroduces the four accessibility defects.

## Third production deployment, 2026-09-13 — the cross-column drag rework

**Version:** `af5f51ad-3337-431f-96a6-3d6613edb171`, deployed at 100%
**Commit:** `2ba103d`, CI [34761451152](https://github.com/yhaspel/goal-tracker/actions/runs/34761451152) — `checks: success`, `deploy-test: success`
**Deployed by:** `npm run deploy:prod`, manually, on the owner's explicit instruction

Interface-only again. `schemaVersion` is still 4, no route or API contract changed, and no
production data was read, created, or modified. The served assets are byte-identical to the
local build and to what CI deployed to test: `sha256 df7482d1208dc2c9` for `index-CbTUh6hF.js`
and `ca2965fe67383856` for `index-DBIBJqBn.css`, compared byte for byte rather than inferred
from the filename hash.

What changed: dropping a card is now resolved from the drag's own projection instead of the
sortable plugin's indices, which is what lets a card cross columns without React tearing the
board down. Two defects found while verifying that rework are fixed in the same commit — a
canceled drag that left the board showing a move the server never received, and a multi-column
drag that committed the second-to-last hop. Both are described in the
[execution log](stages-2-6-execution-log.md).

### Verified on the deployed Worker, read-only

Nothing below signs in; production's owner credentials are not held by this session.

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 4`, `Cache-Control: no-store` |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` (no session) | All `401 unauthenticated`, generic body, no address named |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":false}` |
| `POST /api/v1/auth/login`, dummy address, correct `Origin` | `401` |
| Same request with no `Origin` header | `403` |
| `GET /api/v1/diagnostics/probe` | `404` |
| `family-board-restore` | `404`, still unexposed |
| SPA routes, all seven | `200 text/html`; unknown path `404` |
| Served assets | Byte-identical to the local build, both hashes confirmed |
| Guest `/board` | Redirects to `/login` |
| Browser storage | `localStorage` and `sessionStorage` empty; only `kanban_locale` visible to script |
| Guest screens, 390 × 844, three locales, five routes | Correct `lang` and `dir`, no overflow, no undersized target except the one deliberately inline link |
| Console | Only the `401` a guest's own session probe returns |

The signed-in half — the nine drag scenarios, each asserting that the rendered board matches
`GET /api/v1/board` — was exercised against a **local** Durable Object with a disposable owner,
not against production.

### Rollback

Redeploying `ff9c08c2-8b7e-4b89-8b16-3781e5ba0743` returns to the previous interface. It touches
no schema and no data, but it restores the cross-column drag behaviour this commit fixes.

## Fourth production deployment, 2026-09-13 — the Industry design system

**Version:** `7a9a4d2a-c1a3-455d-b722-fde38e7b6c84`, deployed at 100%
**Commit:** `3095700`, CI [34769950652](https://github.com/yhaspel/goal-tracker/actions/runs/34769950652) — `checks: success`, `deploy-test: success`
**Deployed by:** `npm run deploy:prod`, manually, on the owner's explicit instruction

Interface-only. `schemaVersion` is still 4, no route, API contract, validation rule,
announcement string, or focus contract changed, and no production data was created, modified,
or deleted. The served assets are byte-identical to the local build: `sha256`
`368598885d545dbb7925b59c8d2402009f42a55d9bf99ed741230ac68fd6e516` for `index-FbeFDlm9.js` and
`db092613ce6bc30cb398e45707b02fb8345c1ab43dae43f9e3c4f4c55a9c82cd` for `index-BPFtyiPT.css`,
compared byte for byte rather than inferred from the filename hash. All ten `.woff2` subsets
were compared the same way.

What changed: a full restyle onto the Industry design system in its "Worksheet" direction —
light and dark token blocks, square corners (`--gt-radius: 0`), hairline borders, one steel
accent, and self-hosted Barlow and Barlow Condensed served from same-origin `/fonts/`. The
board gains column plates, a title-as-edit-button card with a derived avatar, a two-control
actions menu, a phone column pager, a tablet scroll-end affordance, and a loading skeleton. The
product name became **Goal Tracker**, byte-identical in all three locales by design.

### Verified on the deployed Worker, read-only

Nothing below wrote to production. The owner signed in themselves in the browser session; this
session never handled the password.

| Check | How | Result |
| --- | --- | --- |
| `GET /api/v1/health` | curl | `200`, `schemaVersion: 4`, `Cache-Control: no-store` |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` (no session) | curl | All `401 unauthenticated`, generic body, no address named |
| `GET /api/v1/auth/bootstrap/status` | curl | `{"bootstrapAvailable":false}` |
| `GET /api/v1/diagnostics/probe` | curl | `404` |
| SPA routes, all eight | curl | `200 text/html`; unknown path `404` |
| `/fonts/…`, all ten `.woff2` | curl | `200`, `font/woff2`, each `sha256` equal to the local build |
| Served `index-*.js` and `index-*.css` | curl + `shasum` | Byte-identical to `web/dist`, both hashes confirmed |
| `family-board-restore` | curl | `404`, still unexposed |
| Guest screens: 5 routes × 3 locales × 3 widths × 2 themes (90 states) | browser | No horizontal page scroll anywhere; `lang`/`dir` correct, Hebrew `rtl` and fully mirrored; every control square-cornered; no target under 24 px |
| Fonts on the wire | browser network panel | Five same-origin `.woff2` on `/login`; nothing from `fonts.googleapis.com` or `fonts.gstatic.com` |
| Latin vs Cyrillic rendering | canvas text measurement | Latin genuinely paints in Barlow Condensed (94.9 px vs 119 px default); Cyrillic measures identical to the default face, i.e. it falls through — see deviation 1 |
| Focus ring | keyboard | `3px solid` at `2px` offset, `:focus-visible`, on every control reached |
| Skip link | keyboard | First focusable element in DOM order; reveals itself on focus with the ring |
| Error state | submitted `/login` with `not-an-address` | The **form-level** `.alert`: `role="alert"`, `!` marker via `::before`, 4 px leading bar plus tinted plate — carried by marker and border, not colour alone |
| Inline `/register` link | measurement | "Set up the owner account" is exactly `24px` tall — the documented exception holds |
| No dead controls | DOM scan, all guest + signed-in routes | No theme toggle, no stray checkbox, no per-row allowed-address editor |
| Guest console | DevTools | Exactly one error: the `401` a guest's own session probe returns |
| Two controls per card | a11y tree + screenshot at 834 and 1440 | Drag handle and actions menu, plus the title as the edit affordance. Not five |
| Card tab order | keyboard | title → drag handle → actions menu |
| Actions menu contract | keyboard | Enter, Space and ↓ open on the first item; ↑ opens on the last; ↑↓ cycle both ways; Home/End jump; Escape closes and returns focus with `aria-expanded=false`; Tab closes and moves to "Add a card" |
| Actions menu is not clipped | screenshot + hit test | Menu overflows the column plate and stays fully visible; Delete is painted and hit-testable |
| Menu contents | a11y tree | Current column absent from "move to column"; Move up and Move down carry the real `disabled` attribute |
| Column caps | screenshot | Done wears the reversed steel cap with its check; To do and In progress wear the accent underline |
| Empty column and add plate | screenshot | Dashed slot present; "Add a card" visible at rest, not hover-revealed |
| Card dialog | keyboard | Opens from the title, focus lands in the first field, `.dialog-body` present, Escape closes and returns focus to the title. Closed without saving |
| Phone board, 390 | DOM + screenshot | **Zero** drag handles in the DOM; chip row with counts, prev/next chevrons, "Column 1 of 3", dot rail, and "Add a card to To do" |
| Phone header and sheet | DOM | Brand plus one menu button; sheet carries nav links, language selector, "Signed in as …", and Sign out, with focus moved in and Escape returning it |
| Phone card dialog | screenshot | Bottom-anchored with a pinned full-width Cancel/Save row |
| Tablet track, 834 | measurement | Page does not scroll sideways; the only sideways scroller is `OL.board` (1047 → 780); edge fade visible; "Scroll the board towards the end" is 48×48, focusable, 3px ring |
| Hebrew board | computed style | Addresses are `direction: ltr` with `unicode-bidi: isolate` and `text-overflow: ellipsis`; avatar chip shows `Y`, the first character of the local part; chevrons and edge fade mirror |
| Signed-in screens: 3 routes × 3 locales × 3 widths × 2 themes (54 states) | browser | No horizontal page scroll; `dir` correct; no undersized target; no rounded control beyond the deliberate chip token |
| Signed-in console | DevTools | No messages |
| Board data unchanged | `GET /api/v1/board` before and after | Same three columns, same two cards, same titles |

The one corner radius in the system is `--gt-radius-chip: 2px`, used by the phone pager tabs and
the held-card marker. `--gt-radius` itself is `0`. A 2 px chip is deliberate, not a stray round.

### Not verified, and why

- **`prefers-reduced-motion: reduce` was not driven in the browser.** The Chrome MCP `emulate`
  tool exposes `colorScheme` but no reduced-motion option, so the media feature could not be
  toggled. Instead the deployed stylesheet and the component source were read directly. Under
  the reduce block the busy squares get `opacity: 1` (visible, not pulsing), `.skeleton-block`
  gets `background-image: none` (flat, still visible against `--gt-line-soft`), and
  `.card.dragging` gets `transform: none` while keeping `border: 2px solid` and `elev-lg`. The
  picked-up chip is `.held-marker`, a DOM element with no animation or transition at all, and
  the dashed drop slot `.card-slot` is a static `1px dashed` border. All four markers therefore
  survive the preference, but this is a code reading, not an observed render.
- **The three transient markers were never triggered in production.** The picked-up chip, the
  busy squares, and the loading skeleton only appear mid-drag or mid-request. Dragging a real
  card was out of scope for a read-only pass, so they were not observed on this deployment.
- **390 CSS px came from a CDP viewport override, not a window resize.** Chrome clamps its
  window to a 500 px minimum on this machine, so `resize_page` could not reach 390. The width
  was set with an explicit `390x844x3,mobile,touch` viewport — exact dimensions, not a device
  preset label. 834 and 1440 were set the same way.
- **No screen-reader review was performed.** That remains true of this project's tooling, as
  Stage 6's record already states.
- **The field-level invalid state was not exercised.** The design system specifies a 2 px danger
  border plus a `!` marker plus text on an invalid `.field`. Submitting `/login` with
  `not-an-address` reached the server and came back as a credential failure, which renders the
  **form-level** `.alert` instead — a 4 px leading bar on a tinted plate, with its own `!`
  marker. Both carry the error by marker and border rather than colour alone, but the 2 px
  field border is a different style and was not seen on this pass.

### Deliberate deviations carried by this deployment

The six listed in commit `3095700` stand: no Cyrillic cut exists for Barlow or Barlow Condensed
so Russian falls through to the platform face exactly as Hebrew does; `app.name` is identical in
all three locales by design and the suite asserts it; the per-column strip is four icon buttons
named by full dictionary sentences; the picked-up marker is a grip chip rather than a "HELD"
word; Move up and Move down use the real `disabled` attribute; and the phone reads the media
query in JavaScript so the drag handle leaves the DOM rather than merely being hidden.

### Rollback

Redeploying version `af5f51ad-3337-431f-96a6-3d6613edb171` restores the previous interface. The
change touches no schema, no migration, and no data, so the rollback is a pure asset swap and is
safe in the way the first deployment's was not:

```
git revert --no-commit 3095700   # or check out 1ca62e3 in a worktree
npm run deploy:prod
```

`1ca62e3` is the commit before the redesign.

## Stage 7 landed on `main`, 2026-09-13 — **not** deployed to production

This section is deliberately not headed "fifth production deployment". Nothing was deployed to
production here. Stage 7's code is on `main` and on the test Worker; production is still serving
the fourth deployment, version `7a9a4d2a-c1a3-455d-b722-fde38e7b6c84`, unchanged.

**Commit:** `9c10e19`, "Give the household a backup it can actually be restored from"
**CI:** [34775711046](https://github.com/yhaspel/goal-tracker/actions/runs/34775711046) —
`checks: success`, `deploy-test: success`
**Production version after this push:** `7a9a4d2a-c1a3-455d-b722-fde38e7b6c84` — the same one as
before it

### Re-verified locally before the push

Node 25.2.1, npm 11.12.1, from a clean `npm ci`. `lint`, `typecheck`, `check:links` (19 files),
`check:i18n` (3 locales, 217 English keys), and `npm audit --audit-level=moderate` (0
vulnerabilities) all clean. `npm test` — **14 test files, 149 tests, all passing**, against a
baseline of 12 files and 125 tests.

Both bundle-isolation checks were then run by hand against `index.js` from a `--dry-run` outdir,
not against the whole directory: `index.js.map` embeds the original TypeScript and would name
every route regardless of what the bundle contains.

| Check | Result |
| --- | --- |
| `operator/import` in the production bundle | Absent |
| `restore_import_marker` in the production bundle | Absent |
| `operator/export` in the production bundle | Present |
| `operator/import` in the restore bundle | Present |

CI runs the same four as named steps, and all four passed in the `checks` job: "Prove the restore
import is absent from the production bundle" and "Prove the restore bundle does carry the import
route".

### Production smoke test, read-only, after the push

No sign-in, no cookie, no write. Plain `curl` against
`https://family-board-production.yuval3000.workers.dev`. The point of this pass is the opposite of
the usual one: it is evidence that pushing to `main` changed **nothing** in production.

| Check | Expected | Result |
| --- | --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 4`, `Cache-Control: no-store` | Pass — `{"data":{"status":"ok","schemaVersion":4}}` |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` | `401 unauthenticated`, generic body, no address named | Pass — all three `{"error":{"code":"unauthenticated","message":"Sign in to continue."}}` |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":false}` | Pass |
| `GET /api/v1/operator/export`, no `Authorization` | `404`, body exactly `{"error":{"code":"not_found","message":"Not found"}}` | Response matches byte for byte — but see the note below |
| `GET /api/v1/operator/export`, `Authorization: Bearer wrong` | The same `404` | Same, byte for byte |
| `POST /api/v1/operator/import` | `404` | Pass, and permanently — the route is not in the production bundle at all |
| `GET /api/v1/diagnostics/probe?nonce=<32 hex>` | `404` | Pass |
| `GET /` and each of the seven other SPA routes | `200 text/html` | Pass, all eight |
| The same routes | `Cache-Control: no-store` | **Not yet deployed** — currently `public, max-age=0, must-revalidate` |
| The same routes | CSP starting `default-src 'none'` | **Not yet deployed** — no CSP header at all |
| `/assets/index-FbeFDlm9.js` | `200`, CSP present, and **not** `no-store` | Partly — `200` and correctly not `no-store`; CSP **not yet deployed** |
| `/nope` | `404`, not HTML | Pass — `404` with an empty body and no content type |
| Every response | `nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000` | **Not yet deployed** — none of the three is present on any response |
| `family-board-restore` | `404`, no public route | Pass — Cloudflare `error code: 1042`, still unexposed |

The two operator rows need care. Production returned exactly the expected status and exactly the
expected body — but it reached that answer as an *unknown path*, because `operator/export` is not
in the build production is serving. The refusal that Stage 7 specifies, and the pre-Stage-7
not-found, are indistinguishable from outside. That is the design working as intended, and it is
also why these two rows are not yet evidence of anything: they will look identical after the
deploy, when they will mean something different.

The pre-Stage-7 `Cache-Control: no-store` on API responses comes from the JSON envelope in
`shared/api.ts`, which has carried it since Stage 1. The security headers are genuinely new in
this commit; their absence in production is expected, not a regression.

Served assets were compared byte for byte, not by filename hash. Production is serving `sha256`
`368598885d545dbb7925b59c8d2402009f42a55d9bf99ed741230ac68fd6e516` for `index-FbeFDlm9.js` and
`db092613ce6bc30cb398e45707b02fb8345c1ab43dae43f9e3c4f4c55a9c82cd` for `index-BPFtyiPT.css` —
identical to the local build and to the fourth deployment's record. Stage 7 touches nothing under
`web/src`.

### What the deployed test Worker shows, which is what production will get

`deploy-test` published this commit to `family-board-test`, so the Stage 7 headers can be read on
a deployed Free Worker rather than inferred from source. Read-only, same `curl` pass:

| Where | Observed |
| --- | --- |
| API responses | `nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000`; no CSP, which is correct — the CSP is for documents and assets |
| SPA shell, `/` | `Cache-Control: no-store`, plus `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`, `X-Frame-Options: DENY`, COOP and CORP `same-origin` |
| `/assets/*` | Same CSP and headers, and correctly **not** `no-store` |
| `GET /api/v1/operator/export`, no bearer and wrong bearer | Identical `404` both times — test has no `BACKUP_OPERATOR_SECRET` provisioned, so the route fails closed exactly as it must |

`script-src` carries no `'unsafe-inline'`. `style-src` does, because React and the drag projection
set `style=` attributes; that allowance is required rather than convenient.

### Two things waiting on the owner

Neither was done, and neither is done by pushing.

1. **Deploying Stage 7 to production.** `npm run deploy:prod` was not run. The change adds no
   migration — `SCHEMA_VERSION` stays 4, and the restore-only `restore_import_marker` table is
   created by the import handler, which does not exist in the production build — so the rollback
   is a plain redeploy of `7a9a4d2a-c1a3-455d-b722-fde38e7b6c84` with no data implication.
2. **Provisioning `BACKUP_OPERATOR_SECRET` in production.** Not generated, not set. Until it is,
   `GET /api/v1/operator/export` fails closed in production and no backup can be taken, deployed
   or not. The commands are in [the operator runbook](operator-runbook.md).

Everything else on the Stage 7 release checklist — the first production backup, the isolated
restore drill, the maximum-size measurement, the deployed lost-phrase rehearsal — sits behind
those two. Stage 7 is **not closed** by this push, and its plan does not move to `archived/`.

Production still holds the only copy of its data.

> **Superseded the same day.** The owner then authorised both checkpoints. Everything above
> remains an accurate record of the push itself, but production is no longer on
> `7a9a4d2a-c1a3-455d-b722-fde38e7b6c84` and the secret is no longer unprovisioned. See the next
> section.

## Fifth production deployment, 2026-09-13 — Stage 7 backup and hardening

**Version:** `5d099a34-3480-4fc5-89cb-ec779a94ea39`, at 100% — the code went up as
`37752249-68a9-48d3-bc3d-2895bc0f8bc2` at 19:00:45Z, and provisioning the secret a minute later
re-versioned the Worker with `Source: Secret Change`. Same code, new version ID. A Cloudflare
version pins bindings as well as code, so a secret change always mints one; expect this whenever a
secret is set, and roll back to a version ID rather than to a commit.
**Commit:** `5179a8e` (Stage 7 code landed in `9c10e19`), CI
[34775917662](https://github.com/yhaspel/goal-tracker/actions/runs/34775917662) —
`checks: success`, `deploy-test: success`
**Deployed by:** `npm run deploy:prod`, manually, on the owner's explicit instruction

The owner was asked about the two checkpoints the handoff reserved for them, and authorised both:
deploy Stage 7 to production, and generate and set `BACKUP_OPERATOR_SECRET` there. Both were then
done, in that order.

No migration. `SCHEMA_VERSION` stays 4, the production Durable Object grew no table, and no
production data was created, modified, or deleted. `wrangler` reported "No updated asset files to
upload" — Stage 7 touches nothing under `web/src`, so the served assets are the same
`index-FbeFDlm9.js` and `index-BPFtyiPT.css` the fourth deployment verified byte for byte.

What changed in production: the security headers, `no-store` on the SPA shell, and a
bearer-authenticated `GET /api/v1/operator/export`. `POST /api/v1/operator/import` is **not** in
this build and cannot be — CI fails the `checks` job if the route or `restore_import_marker`
appears in the production bundle.

### Verified on the deployed Worker, read-only

Same `curl` pass as before the deploy, so the two runs are directly comparable. No sign-in, no
cookie, no write.

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 4`, `Cache-Control: no-store` |
| `GET /api/v1/board`, `/api/v1/members`, `/api/v1/settings/allowed-emails` | All `401 unauthenticated`, generic body, no address named |
| `GET /api/v1/auth/bootstrap/status` | `{"bootstrapAvailable":false}` |
| `GET /api/v1/operator/export`, no `Authorization` | `404`, body exactly `{"error":{"code":"not_found","message":"Not found"}}` |
| `GET /api/v1/operator/export`, wrong bearer | The same `404`, byte for byte |
| `POST /api/v1/operator/import` | `404` — the route is absent from this build |
| `GET /api/v1/diagnostics/probe?nonce=<32 hex>` | `404` |
| All eight SPA routes | `200 text/html`, and `Cache-Control: no-store` on **all eight** |
| The same routes | `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`, plus `X-Frame-Options: DENY`, COOP and CORP `same-origin` |
| `/assets/index-FbeFDlm9.js` | `200`, CSP and `nosniff` present, and correctly **not** `no-store` (`public, max-age=0, must-revalidate`) |
| `/nope` | `404`, empty body, no content type |
| Every response above | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000` |
| `family-board-restore` | `404`, still no public route |

Every row that was marked "not yet deployed" before the deploy now passes. `script-src` carries no
`'unsafe-inline'`; `style-src` does, because React and the drag projection set `style=` attributes.

### `BACKUP_OPERATOR_SECRET` in production

Generated with `openssl rand -hex 32` into a `0600`, Git-ignored `.secrets.backup-operator.production`
and piped to `wrangler secret put` on stdin. The value was never an argument to any process, never
echoed, and never written anywhere else. `wrangler secret list --env production` now shows four
secrets — `BACKUP_OPERATOR_SECRET`, `CSRF_SECRET`, `RATE_LIMIT_KEY`, `RECOVERY_DIGEST_KEY` — and
correctly still no `BOOTSTRAP_SECRET`.

The secret was written **without a trailing newline**, deliberately. `worker/src/routes/operator.ts`
compares `ctx.env.BACKUP_OPERATOR_SECRET` verbatim and the bearer pattern is `Bearer\s+(\S+)`, so a
stored newline would have been part of the secret and no caller could ever have matched it. The
runbook's provisioning snippet used a plain `>` redirect, which leaves one; it has been corrected in
the same change as this record.

`BACKUP_HOUSEHOLD_ID` was confirmed from the deploy output rather than assumed: the production
Worker's bindings list `env.BACKUP_HOUSEHOLD_ID ("goal-tracker-production")`.

The route was then proven to authenticate, once: `GET /api/v1/operator/export` with the correct
bearer returned `200 application/json`, 2,318 bytes. **The body was discarded to `/dev/null` and
never read** — the point was to prove the credential works, not to look at the household's data.
That single request is also why the failure mode described above matters: had the newline been
stored, this would have returned the same `404` as a wrong secret, and the cause would not have
been visible from outside.

### What this deployment still does not give you

A working export route is not a backup. **No production backup has been taken.** Production
continues to hold the only copy of its data, and the owner account remains unrecoverable if its
password and recovery phrase are both lost.

Still outstanding on the Stage 7 release checklist, now that the deploy and the secret are done:

- The first encrypted production backup, taken and verified
- The full drill that restores that copy into a fresh isolated namespace, then destroys it
- The maximum-size export measurement against the Free limits
- The deployed lost-phrase rescue rehearsal
- `BACKUP_OPERATOR_SECRET` in `test`, and the round trip against the deployed test Worker
- Moving the escrowed secrets off the single laptop
- Confirming whether point-in-time recovery is available on this Free account
- `docs/stage-7-completion.md`, and only then archiving the stage plan

Stage 7 is **not closed**, and its plan does not move to `archived/`.

### Rollback

Redeploying `7a9a4d2a-c1a3-455d-b722-fde38e7b6c84` returns to the fourth deployment. There is no
migration and no data implication — the rollback is a plain version redeploy:

```sh
npx wrangler rollback 7a9a4d2a-c1a3-455d-b722-fde38e7b6c84 --env production
```

Name the version explicitly. A bare `wrangler rollback` goes to the previous version, which here is
`37752249` — the same Stage 7 code with the secret unset, which is not the pre-Stage-7 state anyone
would mean by "roll back". It removes the security headers and the export route. `BACKUP_OPERATOR_SECRET` would survive the
rollback as a configured but unused secret, which is harmless; the route that reads it would no
longer exist.

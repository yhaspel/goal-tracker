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

A working export route is not a backup. At the time this section was written no production backup
had been taken. One was taken immediately afterwards — see the next section — so the sentence that
stood here ("production continues to hold the only copy of its data") is no longer true.

Still outstanding on the Stage 7 release checklist, now that the deploy and the secret are done:

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

## The first production backup, 2026-09-13

**Copy:** `goal-tracker-production-2026-09-13-schema4-1f0ac18e.backup.enc`
**Taken at:** `2026-09-13T19:25:43.293Z`, from production version
`5d099a34-3480-4fc5-89cb-ec779a94ea39`
**Where:** `~/goal-tracker-backups/` on the owner's machine, mode 0600, directory 0700
**Key:** `~/.goal-tracker/backup.key`, mode 0600, generated fresh — **no copy of it existed before
this, and there is still only one**

Production has been holding the only copy of its data since 2026-09-13. It no longer is.

```
Wrote goal-tracker-production-2026-09-13-schema4-1f0ac18e.backup.enc
  household goal-tracker-production, schema 4, board revision 19
  1 users (1 active), 1 allowed addresses, 3 columns, 2 cards
  verified by decrypting the stored file: digest d56aa774755679e1…
Retention: nothing to prune.
```

`create` exited 0, which means the household passed its own integrity checks. `verify` then
re-read the file from disk independently and agreed.

### What was checked beyond the tool's own word

The tool verifies its own copy, so it was also checked from outside:

| Check | Result |
| --- | --- |
| The file decrypts under the key, independently of `backup.ts create` | Yes — `verify` reports `ok`, schema 4, 1 user, 2 cards |
| The digest recomputes over the canonical payload | Yes, `d56aa774755679e1…` (64 hex chars) |
| The stored file is genuinely ciphertext | No household string appears in it — the address, `todo`, `in_progress` and `done` are all absent |
| No plaintext or `.partial` temporary file was left behind | None in the directory |
| The owner account survives with a usable credential | `passwordHash` present, 100 chars, carrying its own scrypt parameters (`N=16384`) and salt |
| The recovery credential survives and belongs to that user | `phraseDigest` present, 64 chars, `userId` matches |
| The allowed-email list survives | 1 address, normalised |
| Counts match the arrays they describe | users, columns, cards and allowed emails all agree |
| Referential integrity inside the copy | Every card belongs to a column in the copy; every assignee is a user in the copy; column positions unique |
| An active owner exists | Yes — role `owner`, status `active` |

That inspection printed shapes and lengths only. No address, password hash or recovery digest was
written to a terminal, a log, or a file.

### The schema pin — **resolved on 2026-09-14; do not follow the old advice**

This section used to say that the import demanded exact schema equality, that there was no upgrade
path for an old payload, and that once migration 5 landed a schema-4 copy could only be restored by
checking out a schema-4 commit first. **All three are now false, and acting on them would be a
mistake during a recovery** — checking out an old commit to restore a copy that the current build
reads perfectly well would cost time in the one situation where time matters.

Stage 8 added the upgrade path this note asked for. The import now accepts any schema from
`MIN_IMPORTABLE_SCHEMA_VERSION` (4) up to the restore object's own, and refuses only a **newer**
one. A schema-4 copy therefore restores into a schema-5 build directly: the older payload is
transformed, the Stage 8 tables come back empty, and every card's `dueDate` and `milestoneId` comes
back null. Proven on 2026-09-14 by restoring a real production copy into a deployed Stage 8 drill
Worker — 22 of 22 checks, including every password hash and recovery digest byte-identical. See
[the Stage 8 completion report](stage-8-completion.md).

One genuinely new rule replaces the old pin, and it is a refusal rather than a restriction. A copy
whose `formatVersion` is **older** than the `schemaVersion` it claims is rejected outright, because
that pairing can only be produced by a deployment running code older than its own database — a
rolled-back Worker — and such a copy is silently missing every row that code could not read. If a
backup is ever refused with *"older than its database"*, do not try to force it: redeploy the code
that matches the database and take a fresh copy.

### Still not proven

The copy is intact and complete. What has **not** happened is a restore into a deployed Cloudflare
object, and no automated test signs in to a restored household — the suite compares password-hash
strings and stops there. The only end-to-end sign-in evidence anywhere is one local `wrangler dev`
run from a previous session, against disposable data rather than this copy.

Three things remain genuinely unproven, in order of how much they matter:

1. **The copy and its key are on the same laptop.** If that machine is the disaster, the backup
   dies with it. This is the single largest real risk and it is not a code defect. Carrying the
   `.enc` file and the key to a second location and running `verify` there would settle it.
2. **No deployed restore has ever run.** See the drill in [the operator runbook](operator-runbook.md).
3. **The recovery phrase has never been shown to verify on a restored object.** Signing in does not
   prove it: login never touches `phrase_digest`, and the route context only checks that
   `RECOVERY_DIGEST_KEY` is present, not that it is the right one.

### A defect found while taking it

Auditing the path around this backup turned up one real bug in `scripts/backup.ts`, fixed in the
same change. `create()` knew whether the household had passed its integrity checks before it
pruned, but pruned first and reported afterwards. Retention pins the newest copy and has no idea
whether a copy is restorable, so a run that produced a copy `importBackup` would refuse also
deleted an older clean one — and repeated weekly, every retained copy but the month's oldest ends
up unrestorable. The integrity gate now runs before pruning, and a failed household skips pruning
entirely while still keeping its copy. `tests/backup-retention.test.ts` pins the retention
mechanism that made it dangerous.

The bug could not have affected this backup: it was the first, and with one copy on disk retention
keeps it under every rule.

## The first restore drill, 2026-09-13

**Drill Worker:** `family-board-restore-2026-09` →
`https://family-board-restore-2026-09.yuval3000.workers.dev`, version
`f4776157-bfe1-40ce-af43-713341ebf14c`
**Copy restored:** `goal-tracker-production-2026-09-13-schema4-1f0ac18e.backup.enc`
**Lifetime:** created and destroyed in the same sitting
**Outcome:** the restored household re-exported **byte-identically** to the backup

The copy had been proven to decrypt. This proves the other half: that a deployed Cloudflare object
will accept it and reconstruct the household from it.

### What was done

A dated environment was added to `wrangler.jsonc`, deployed, drilled, and removed again; the file
is back to its committed state. The Worker got its own Durable Object namespace — a namespace is
keyed by (script name, class name), so reusing `RestoreHouseholdDO` under a different Worker name
gives a fresh, empty one and avoids a throwaway export in `worker/src/index.ts`.

Before the import the target was confirmed pristine: `bootstrapAvailable: true`, schema 4,
migrations applied, no owner.

```
Importing household goal-tracker-production into family-board-restore-2026-09.yuval3000.workers.dev
  taken 2026-09-13T19:25:43.293Z, schema 4
Imported. {"imported":true,"boardRevision":19,"schemaVersion":4,
           "counts":{"allowedEmails":1,"users":1,"activeUsers":1,
                     "recoveryCredentials":1,"invitations":0,"columns":3,"cards":2}}
```

### The decisive check: export(import(backup)) == backup

The restored household was re-exported through `GET /api/v1/operator/export` and compared field by
field against the backup's decrypted payload.

| Field | Result |
| --- | --- |
| `formatVersion`, `schemaVersion`, `householdId` | Identical |
| `counts` | Identical |
| `appState` — `bootstrapConsumed`, `allowlistRevision` | Identical |
| `boardState.revision` | Identical (19) |
| `allowedEmails` | Identical |
| `users` — ids, addresses, **password hashes**, roles, status, language, credential epoch, timestamps | Identical |
| `recoveryCredentials` — userId, **phraseDigest**, version, createdAt | Identical |
| `invitations` | Identical (none) |
| `columns` — ids, `nameKey`, positions | Identical |
| `cards` — ids, columnId, position, title, description, assignee, timestamps | Identical |
| `integrity` | Identical, `ok: true` on both sides |
| `createdAt` | Differs, as it must — the re-export's own timestamp |
| **Whole payload excluding `createdAt`** | **Identical** |

The re-export was also the same size as the production export, 2,318 bytes. Nothing was dropped,
renamed, coerced or regenerated.

### The refusals

| Check | Result |
| --- | --- |
| A second import into the restored object | `409 restore_target_not_pristine` — *"users already holds 1 row(s)"* |
| `GET /api/v1/auth/bootstrap/status` after the import | `false` — `bootstrap_consumed` came back with the household, so the drill Worker is closed to a second owner |
| `GET /api/v1/board`, `GET /api/v1/members`, no session | `401` — no session survived the restore |
| The real owner address with a wrong password | `401 invalid_credentials`, **not** a `500` — the stored scrypt record was parsed and re-derived against, so the hash restored intact |
| An address not in the household | The same generic `401` |
| `GET /api/v1/operator/export` with a wrong bearer | `404`, indistinguishable from an unknown path |
| `POST /api/v1/operator/import` on **production** and **test** | `404` on both — the route is absent from those builds on the deployed Workers, not merely in the bundle |

### One deliberate deviation from the runbook

The runbook said to put production's `RECOVERY_DIGEST_KEY` on the drill Worker "so phrase
verification can be checked". A throwaway key was used instead.

Phrase verification cannot be checked without someone's *actual* recovery phrase, which this
session did not have. Production's key would therefore have bought nothing testable while putting
production-equivalent credential material on a public hostname. Phrase digests restore as opaque
strings either way, so the round trip above is unaffected — the digests compared identical. The
runbook now recommends the throwaway by default and keeps production's key for the case where
someone is actually rehearsing the phrase flow with a phrase in hand.

### Teardown

`npx wrangler delete --env restore-drill-2026-09`, after a `--dry-run` and after re-reading the
Worker name. Confirmed afterwards: the drill hostname answers Cloudflare's `1042`, and
`family-board-production`, `family-board-test` and `family-board-restore` all answer exactly as
they did before. Production is still on `5d099a34-3480-4fc5-89cb-ec779a94ea39`. The five disposable
drill secrets were destroyed on disk.

The runbook's teardown instruction was wrong and has been corrected: this configuration uses the
`exports` map, which rejects a `deleted` tombstone outright — *"exports.&lt;Class&gt;.type must be
`durable-object` or `worker`"*. Tombstones belong to the older `migrations`/`deleted_classes`
syntax. Deleting the Worker is the mechanism, and it takes the namespace and the public hostname
with it.

### What is still not proven

**A successful sign-in.** Everything above proves the credential material survived intact and that
the verification path runs against it, but not that a correct password completes a login on a
restored household. The hash is one-way, so only someone holding an account's password can close
that gap — a few minutes' work the next time the owner runs a drill.

**The recovery phrase verifying on a restored object**, for the same reason, and because a
throwaway digest key was used here by choice.

**Off-machine survival.** The copy and its key are still on one laptop. That remains the largest
real risk to this backup, and no drill can settle it.

## Stage 8 deployed — 2026-09-14

**Version `9e70b2ea-ed45-47f9-9ed0-ec7404225346`**, deployed by hand with `npm run deploy:prod` from
commit `a31fa8f` on `main`. **Schema 4 → 5**: the first migration ever applied to a production
object holding real data.

### What was done first, and why it mattered

The plan requires a verified backup immediately before the deploy, and migration 5 rehearsed
against an object restored from a production-shaped copy before it ever meets production. Doing
both in order is what found three defects that would have left this household with no working
recovery path:

1. The importer demanded **exact** schema equality, so the only existing backup — schema 4 — could
   not be restored into schema-5 code. `409 schema_mismatch`, reproduced.
2. The backup CLI refused to back up production at all, because it required the Worker to emit the
   tool's own format version and production emitted the older one.
3. A rolled-back Worker would have written a coherent-looking, silently empty backup, which would
   have imported as a clean success while retention pruned the copies that still held the data.

All three were fixed before the deploy. The rehearsal then ran against two successive throwaway
drill Workers, the second on exactly the code that shipped: **22 of 22** checks, including every
password hash and recovery digest byte-identical.

### The deploy itself

| Check | Result |
| --- | --- |
| `/api/v1/health` | `schemaVersion: 5` |
| Data intact | Fresh backup taken immediately after: board revision **19**, 1 user, 3 columns, 2 cards — unchanged from before |
| `/goals`, `/vision` | `200`, shell served `no-store` |
| `/goalz` | `404` |
| `/api/v1/goals`, `/api/v1/vision` to a stranger | `401` |
| `POST /api/v1/operator/import` | `404` — still absent from the production build |
| Headers | CSP `default-src 'none'` with `frame-ancestors 'none'`, `nosniff`, `no-referrer`, HSTS, `X-Frame-Options: DENY`, COOP `same-origin` |
| CI | Run [34811586441](https://github.com/yhaspel/goal-tracker/actions/runs/34811586441), both jobs green |

### Retention pruned the pre-deploy copy, and *why* it chose that one was luck

The pre-deploy schema-4 copy `goal-tracker-production-2026-09-14-schema4-f18da17f.backup.enc` was
**pruned by the post-deploy backup**. Both were written on 2026-09-14, so both fall in ISO week
`2026-W38`, and weekly retention keeps one copy per week. Re-run against that exact directory state,
`retainedCopies()` prints `PRUNE …f18da17f…`. The 2026-09-13 copy is in a *different* week
(`2026-W37`), which is why it was never at risk; it survives, still schema 4, so a rollback path
across migration 5 exists.

**Which of the two it kept was not decided by recency.** `sortCopies()` compares the date string and
then the whole filename, and the date was tied — so the choice fell to the next differing character,
which happened to be the schema digit (`schema4` < `schema5`). Had the deploy not changed the schema,
the tiebreak would have fallen to the random hex suffix, `f18da17f` would have sorted last and been
kept as the week's "newest", and the post-deploy copy would have been the one at risk instead. That
is a defect, not a quirk; it is described in full in [the operator runbook](operator-runbook.md) and
fixed by putting the time of day into the filename.

Before the next schema change, take the pre-deploy copy into a separate directory — as was later done
for the pre-UI-test copy in `~/goal-tracker-backups-preuitest/` — rather than trusting retention to
keep the right one.

### The guest interface, walked in production

Chrome, an isolated browser profile with no stored session, against the live production Worker.

| Dimension | Covered |
| --- | --- |
| Widths | 390 (mobile emulation, touch), 834, 1440 |
| Locales | `en`, `he`, `ru`, switched through the real language selector; `he` reports `dir="rtl"` |
| Themes | Light and dark, via `prefers-color-scheme`; dark resolves to `#14191d` on `#e8eaec` |
| Screens | `/login`, `/register`, `/recover`, plus the guest redirect from `/board`, `/goals` and `/vision` |

- **No horizontal scroll** anywhere: `scrollWidth - clientWidth` is `0` on every width × locale × theme
  combination above.
- **No undersized target.** The two recovery-method radios measure 24 × 24 themselves but sit inside
  a 300 × 44 `<label>`, which is the target a finger actually hits. The only element below 44px tall
  is the skip link at 303 × 42 — keyboard-only, never touched, and comfortably over the 24px
  absolute floor.
- **Keyboard only.** Tabbing through `/login` reaches the email field, the password field, Submit,
  both inline links, the skip link and the header link, and every one of them paints
  `3px solid` at `2px` offset — the ring the design system's floor requires, unmodified in
  production.
- **No console errors.** The single console entry is the app's own session probe answering `401` to
  a guest, which is the correct answer.
- **`/board`, `/goals` and `/vision` all redirect a guest to `/login`** rather than rendering, which
  is what shows the two new Stage 8 routes are wired into the deployed client router and not just
  present in the bundle.

### The deployed bundle is the commit that was built

`https://…/assets/index-BQYashxT.js` as served by production is **byte-identical** to
`web/dist/assets/index-BQYashxT.js` built locally from `a31fa8f` —
SHA-256 `64599b5d690fd4da7c0523c82ff2a006f25d60d0a890953059f46edb3575d84f`. The Goals and Vision
navigation strings are present in all three locales in that file (`Goals` / `מטרות` / `Цели`,
`Vision` / `חזון` / `Мечты`), and `operator/import` does not appear in it.

## The signed-in interface, walked in production — 2026-09-14

The owner signed in on the isolated browser profile, and the whole Stage 8 surface was then
exercised against **real production data**. A verified backup was taken immediately beforehand into
a separate directory (`~/goal-tracker-backups-preuitest/`) so the walk was reversible, and
everything the walk created was deleted at the end.

### What was created and then removed

One card, one goal, three milestones across two months, and two images — all named `ZZ …` and
described as test rows. Final state: 3 columns, 1 card, 0 goals, 0 milestones, 0 images, 0 stored
bytes, byte-for-byte the content the pre-walk backup recorded. Only the revisions moved (board
21 → 30, vision 1 → 6), which is what they are for.

### Due dates

Typed into the native date control — the control accepts `10092026` in the day/month/year order it
advertises and stores `2026-09-10`. All four states render correctly against the viewer's own local
date, which is the contract:

| Date set | Rendered |
| --- | --- |
| 2026-09-10 (past) | `Overdue Sep 10, 2026`, `badge warning` |
| 2026-09-14 (today) | `Due Sep 14, 2026`, `badge warning`, with a `⚠` marker — not colour alone |
| 2026-09-15 (tomorrow) | same |
| 2026-09-16 (later) | `Due Sep 16, 2026`, plain `badge` |
| cleared | no badge at all |

### Goals

- Goal created with notes and a year; the year strip and the empty state behave.
- Three milestones across September and October; **positions are dense within the month group**
  (September 0 and 1, October 0), not across the goal.
- Progress reads `1 of 3 milestones done` from the explicit per-milestone status — never from a
  column — and is announced politely.
- `Move up` reordered within the month group and announced `moved to position 1`.
- A card linked through **Part of**, whose options are bidi-isolated per part
  (`⁨September⁩ · ⁨ZZ milestone B⁩`). The link then shows on the card *and* on the milestone row.
- **The delete cascade is real**: deleting the goal removed its milestones, set the linked card's
  `milestoneId` to `null`, and advanced the **board** revision as well as the goals revision, so a
  second viewer refetches. The confirmation names the goal and spells out all three consequences.

### The vision board

- A 3.65 MB 1600×1200 PNG became a **37,204-byte WebP** with a 10,958-byte 320×240 thumbnail; a
  900×1600 portrait PNG became 30,208 bytes with a 180×320 thumbnail. Both are far inside the
  400,000 / 100,000 caps, and re-encoding is what strips a photograph's location.
- `GET /api/v1/vision/images/:id/content` returned **exactly** the 37,204 bytes whose SHA-256 equals
  the stored `contentDigest`, under `Cache-Control: private, max-age=31536000, immutable` with a
  strong `ETag` equal to that digest. `If-None-Match` answered `304`.
- **The session is still checked before the `ETag` comparison**: the same request with credentials
  omitted answered `401` and `no-store`, never `304`.
- The carousel opens, `ArrowRight` / `ArrowLeft` page through it — the document-level rebind that
  Stage 8 added works in production — and `Escape` closes it and returns focus to the tile.
- Editing a caption changed the tile's accessible name to `Open <caption>`.

### Deletes, and the shape of the confirmation

Image, goal and card deletes each open a confirmation that names the thing and says it cannot be
undone. **Cancel is genuinely non-destructive** — checked, not assumed. The danger button is
outlined and never filled, and positions compact after a delete.

### Layout, in nine combinations per width

390 (touch emulation), 834 and 1440 × `en`, `he`, `ru`, light and dark, on `/board`, `/goals` and
`/vision`, with the test rows present so the screens were not empty:

- **Zero horizontal overflow** in every single combination.
- **No text below 4.5:1**, or 3:1 for large text, measured against each element's effective
  background in both themes.
- Hebrew reports `dir="rtl"` and mirrors; Russian falls through to the platform face as expected.
- The phone pager works: a Menu sheet listing Board, Goals, Vision, Settings, Account and Sign out
  at 56px each, with the language selector at exactly **44px** — the Stage 8 fix holds in
  production — plus column tabs with counts and `Column 1 of 3`.

### One observation, not a defect

Card, goal and milestone **titles** are ~24px-tall buttons on a phone (a two-line title grows to
48). That clears the 24px absolute floor and clears WCAG 2.5.8's spacing exception — the nearest
other target is 7px away and a 24px circle on the title reaches neither — but it is under the
"44px wherever a finger reaches" line in the design system. It is consistent with the pre-existing
card pattern rather than new in Stage 8, so it is recorded here as a judgement call to revisit, not
as a regression.

### What is still not verified in production

Ordered by what it would cost to be wrong. None of these is a known fault; they are places where
production has no evidence of its own.

1. **No production backup has ever contained an image, a goal or a milestone**, and the two-phase
   export/restore has never run against a deployed Worker. The walk created images and then removed
   them, so nothing is at risk today — but the first image this household *keeps* has no proven
   recovery path. Closing it means taking a backup while images exist and restoring it into a drill
   Worker.
2. **Chrome only, and 390px was emulated rather than touched.** Four Safari/iOS behaviours the code
   handles blind: the native date control's presentation, `createImageBitmap` on a `.heic` file
   straight off an iPhone, `canvas.toBlob('image/webp')` silently producing PNG on older Safari, and
   the carousel's document-level key handling under VoiceOver.
3. **No failure state of the upload pipeline has ever been rendered in a browser.** Both uploads
   landed two orders of magnitude inside the caps, so the JPEG quality ladder never ran and neither
   `TooLargeAfterEncodingError` nor `UnreadableImageError` ever threw. The server refusals are
   covered by `tests/vision.test.ts` and `scripts/vision-smoke.ts`; their rendering is covered by
   nothing.
4. **One session, one account.** No revision conflict has reached the production browser, and no
   ordinary member has created or deleted a goal, milestone or image here. The API behaviour is
   pinned by `tests/goals.test.ts`, `tests/vision.test.ts` and `tests/goals.concurrent.test.ts`.
5. **The CPU gate that set the caps was measured on the test Worker, never on production**, where
   2 of 14 samples at the shipped caps still cost 14 ms against a documented 10 ms budget. The
   production uploads were ~48 KB, nowhere near the 667 KB a capped request may carry.
6. **Still no screen-reader pass, and `prefers-reduced-motion` was never emulated.** "Announced
   politely" above means the live region was read out of the accessibility tree, not heard. This is
   the same gap Stage 6 and Stage 8 both closed by owner decision, now inherited by a release.
7. **No cap or rate limit was reached**, so `image_limit`, `storage_full`, `goal_limit`,
   `milestone_limit` and a `429` with `Retry-After` have never been rendered by the live client.
   The rate limit bites first: 30 uploads in fifteen minutes is a plausible first sitting.
8. **Untouched mutations**: image reorder, linking an image to a goal and the cascade that unlinks
   it, goal reorder, a goal year change, a milestone month change, and deleting a single milestone.
   All are covered by the Workers-runtime tests and the test-Worker smoke checks.

## Sixth production deployment, 2026-09-15 — the trilingual copy review

**Version `690cf146-4757-4985-abfc-5358a4aa68d6`**, deployed by hand with `npm run deploy:prod`
from commit `1ea5b82` on `main`. CI run
[34994831415](https://github.com/yhaspel/goal-tracker/actions/runs/34994831415) — `checks: success`
(including the dependency audit and both bundle dry runs) and `deploy-test: success` — ran on
exactly that commit before the deploy.

**Interface text only.** No schema change (`schemaVersion` stays **5**), no migration, no route, no
contract, no validation rule, and no production data. One new dictionary key,
`board.renameColumnHeading`, and one line of `BoardPage.tsx` that uses it; everything else is
dictionary values. `check:i18n` reports **329** English keys, 328 before plus that one.

What changed and why is [the copy review record](copy-review-2026-09-15.md), which carries the
before and after of all 263 changed strings. In short: interpolating a member's own title into a
sentence was leaving Hebrew prefix letters glued to Latin text and letting Russian participles take
their gender from whatever the member had typed, so every card, goal and milestone announcement now
names the object before the title. Three strings said the opposite of what was true — an unexpired
invitation labelled "expired on" in Hebrew, unsaved text labelled "saved" in Hebrew and Russian.
The recovery phrase got a settled Hebrew term, `ביטוי שחזור`. And the rename-column dialog stopped
reusing an `aria-label` sentence with an empty name, which had left it reading `שינוי השם של`.

### Verified on the deployed Worker, read-only

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200`, `schemaVersion: 5`, `Cache-Control: no-store` |
| `/api/v1/board`, `/api/v1/goals`, `/api/v1/vision` with no session | `401` each |
| `POST /api/v1/operator/import` | `404` — still absent from the production build |
| All ten SPA routes | `200 text/html` with `no-store`; `/goalz` is `404` |
| Served `index-dIFc2SgX.js` | SHA-256 `ab64f636…22598b73`, **byte-identical** to the local `web/dist` build and to what the test Worker serves |
| Served `index-BvChO5FA.css` | SHA-256 `951cacce…c55f8f8dd`, byte-identical |
| Strings in the served JS | `renameColumnHeading`, `ביטוי השחזור`, `Карточка «`, `שינוי שם העמודה`, `Переименование колонки` all present; `משפט השחזור`, `Часть чего` and `operator/import` all absent |

### The guest interface, walked in production

An isolated browser profile with no session, at **390** (CDP viewport override with touch), **834**
and **1440**, in `en`, `he` and `ru`, on `/`, `/login`, `/register`, `/recover` and `/bootstrap`.

- **Zero horizontal page scroll** in every width × locale × route combination.
- `<html lang>` and `dir` follow the selector; `he` reports `dir="rtl"` and mirrors.
- **The longer `nav.join` does not cost a header row.** At 834 the header stays a single 57px row in
  all three locales, both links sharing one baseline — including the Russian
  `Присоединиться по приглашению`, the longest at 243–254px.
- At 390 the nav sheet is contained to 0→390 with 56px rows and the language selector at exactly
  **44px**, in all three locales.
- No wrong password was submitted here; production's rate limit protects a real account. That check
  was done on the test Worker instead, where all three locales rendered `error.invalid_credentials`
  into the assertive live region.

### The signed-in interface, walked in production — strictly read-only

The owner signed in themselves on their own browser profile. **This session never asked for, saw,
typed or handled the password.** Walked `/board`, `/goals`, `/vision`, `/members` and `/account` at
390 and 1440 in all three locales, plus 834 in Russian.

- **`GET /api/v1/board` reported revision 30 before the walk and revision 30 after it**, with the
  same three built-in columns and the same single card. Goals and vision revisions were likewise
  unmoved. Nothing was created, edited, moved or deleted, and the allowed-email list was never
  saved.
- Every dialog was opened, read and closed with **Cancel** or **Escape**: the rename-column dialog,
  the delete-column confirmation, the card edit dialog and the card delete confirmation, in each of
  the three locales. The card survived each one.
- **The new key renders on real data**: the rename dialog's title is `Rename column` /
  `שינוי שם העמודה` / `Переименование колонки`, with the real column name in the field beneath it,
  and the icon button keeps the full `board.renameColumn` sentence as its `aria-label`. That is the
  split the change was for.
- **Two things the test household could not show, both seen here on real rows.** An *assigned* card
  renders `Assigned to:` / `באחריות:` / `Исполнитель:` beside a real member — every test card was
  unassigned. And a **real invitation row** reads `בתוקף עד 21 בספט׳ 2026, 15:13` in Hebrew and
  `Действует до 21 сент. 2026 г., 15:13` in Russian, which is the string that used to claim an
  unexpired invitation had expired.
- Hebrew built-in column names are `לביצוע`, `בתהליך`, `הושלם` — `board.column.todo` is the new
  `לביצוע`, not the infinitive `לעשות`.
- Keyboard: Enter opened a card's actions menu on its first item, Escape closed it and returned
  focus to the trigger with `aria-expanded="false"`. The danger button in the delete confirmation is
  **outlined, not filled** (transparent background), as the design system requires.
- **Zero horizontal page scroll** on all five routes at 390 in all three locales. At 834 in Russian
  the five nav links stay on one row with the signed-in address on a second, which is the documented
  834–1199 behaviour rather than a regression.
- No console errors. The only console entries across both halves are two of Chrome's own verbose DOM
  hints (form nesting on `/recover`, a password form without a username field on `/account`), both
  pre-existing and unrelated to copy.

### Not verified, and why

1. **The gated `ZZ copy` exception was offered and declined**, so the walk stayed read-only. This
   production household has **no goal, no milestone, no image, and no card with a due date or a
   milestone link**, so these surfaces were *not* seen against production data: the due badges
   (`card.due`, `card.dueSoon`, `card.overdue`), `card.partOfBadge`, `card.unassigned` on a card,
   all goal and milestone copy including `goals.progress` and `milestone.addTo`, and every vision
   tile, carousel and image-edit string. All of them were exercised on the deployed **test** Worker
   against seeded rows, and the production bundle is byte-identical to the one that was walked
   there — but production has no evidence of its own.
2. **Chrome only, and 390px was an emulated viewport, not a touched device.** Chrome clamps its
   window to 500px on this machine, so 390 is reached through a CDP override — the same method and
   the same caveat as the 2026-09-14 walk. No Safari or iOS pass.
3. **No screen-reader pass.** Announcements were read out of the accessibility tree and the live
   regions' text content, never heard. `prefers-reduced-motion` was not emulated. This is the same
   standing gap Stage 6 and Stage 8 both closed by owner decision.
4. **No error state was rendered in production.** The conflict banner, the field validation
   messages, and the allowed-email limit messages were all proven on the test Worker; producing any
   of them here would have meant writing to real data or spending a real account's rate limit.
5. **Light theme only in production.** The dark-theme look was taken on the test Worker
   (`/board` and `/goals` at 390 in Hebrew), where dark resolves to `#14191d` on `#e8eaec`. The
   change moves text, not colour.

### One cosmetic issue found and deliberately not fixed

In Russian, `card.partOfBadge` is `В рамках «{milestone}»`, and the interpolated title is wrapped in
a `<span dir="auto">` for bidi isolation. `.badge` is `display: flex` with `gap: 3.4px`, so that span
becomes a flex item and the gap pushes **3.4px between each guillemet and the title** — it renders
as `« ZZ copy Run a marathon »` rather than `«ZZ copy Run a marathon»`. The dictionary string is
correct and `textContent` has no spaces; the gap is the pre-existing stylesheet rule meeting a newly
quoted string. It is the only element on the board affected — `board.addCardTo` quotes a *column*
name, which is not bidi-wrapped, and hugs correctly. Fixing it means changing `.badge`'s layout,
which would put the `⚠`/`•` marker spacing that the accessibility floor depends on back in scope for
a text-only release. Left as it is, recorded here and in the review record.

### Rollback

Interface text only — no schema, no migration, no API change, no data — so returning to the previous
copy is a pure asset swap:

```sh
npx wrangler rollback 9e70b2ea-ed45-47f9-9ed0-ec7404225346 --env production
```

**`9e70b2ea-ed45-47f9-9ed0-ec7404225346`** is the version this deployment replaced (commit `a31fa8f`,
the Stage 8 deploy). Reverting commit `1ea5b82` and running `npm run deploy:prod` reaches the same
place.

## Seventh production deployment, 2026-09-15 — the two issues the copy release left open

**Version `851c3705-7d55-4fa8-9f7b-750a301d9fc2`**, deployed by hand from commit `e1ff745`. CI run
[35004244853](https://github.com/yhaspel/goal-tracker/actions/runs/35004244853), both jobs green.
Interface only; `schemaVersion` stays 5 and no production data was touched.

The sixth deployment recorded two problems and deferred both. They are fixed here, and one of the
two reasons given for deferring turned out to be wrong.

**The Russian badge.** `.badge` was `inline-flex` with `gap: 3.4px`. A badge whose text is
interpolated renders as several children — template text, a `dir="auto"` span holding a
member-written title, more template text — and in a flex container each run of text becomes an
*anonymous flex item*, so the gap meant for the status marker landed between every part.
`В рамках «{milestone}»` therefore shipped as `« title »`. The badge is now `inline-block` with the
marker separated by `margin-inline-end`, which keeps the whole label in one inline formatting
context.

Three independent adversarial reviews measured this before it shipped, and between them corrected
the original proposal on three counts: the extra stylesheet rule first proposed was a **measured
no-op** (flex items are blockified anyway); `VisionPage.tsx` was wrongly listed as an affected site
(it is a `<p class="help">` in the carousel, whose guillemets already hugged); and the deferral
reason recorded in the review — that fixing it would disturb the `⚠`/`•` marker spacing — was
**disproved**, since badge height stays 24.8px and the marker keeps its offset. A fourth finding is
recorded in the stylesheet and the design system so nobody reaches for it: keeping the flex container
and setting `gap: 0` with a margin on the marker **loses** the space in the Hebrew and English
templates, because an anonymous flex item's trailing whitespace is stripped.

Measured on production's own stylesheet after the deploy, against probe elements carrying the real
classes:

| Badge | display | height | gap before title | gap after title | marker |
| --- | --- | --- | --- | --- | --- |
| `В рамках «…»` | `inline-block` | 24.8px | **0** (was 3.4) | **0** (was 3.4) | `•` + 3.4px |
| `במסגרת …` (RTL) | `inline-block` | 24.8px | 0 | — | `•` + 3.4px |
| `Part of …` | `inline-block` | 24.8px | 0 | — | `•` + 3.4px |
| `Due Sep 15, 2026` | `inline-block` | 24.8px | — | — | `⚠` + 3.4px |

**The Hebrew upload heading.** `vision.uploadHeading` was `מוסיפים תמונות`, the only present-tense
finite verb used as a label in the dictionary. It is now **`הוספת התמונות`**. Three independent
proposals and three judges on separate lenses all converged on that exact string. The definite form
is what keeps it distinct from the `הוספת תמונות` button, which is only *disabled* during an upload
and never unmounted — confirmed on screen, with the heading and the button visible together and
`identical: false`. It also corrects an aspect error: the upload list is never cleared, so the
heading outlives the upload and sits above rows already reading `נוספה`, where "we are adding" is
simply false.

**Rollback:** `npx wrangler rollback 690cf146-4757-4985-abfc-5358a4aa68d6 --env production`.

## Eighth production deployment, 2026-09-16 — the invitation expiry line

**Version `a3342650-cc9f-4269-b251-c171988e7973`**, deployed by hand from commit `432b406`. CI run
[35053028782](https://github.com/yhaspel/goal-tracker/actions/runs/35053028782), both jobs green.
Interface only; `schemaVersion` stays 5, no production data touched. One new key,
`invitations.expired`, taking `check:i18n` from 329 to 330.

**A defect the copy review itself introduced, found only by rendering it.** The review changed
`invitations.expires` from "expired on" to "valid until" because it was showing on invitations that
had not expired. Right for the common case, wrong for the rare one: on an already expired row the
date line asserted current validity beside a badge saying the opposite — `פג תוקף` next to
`בתוקף עד 8 בספט׳ 2026`, a past date, and `Истекло` next to `Действует до`. The date line now follows
the status, and Hebrew reuses the very string the review had removed, because `פג ב־{date}` was never
wrong — only ever applied to the wrong rows. Pending, used and revoked rows are unchanged.

This is the clearest argument in the whole exercise for rendering over reasoning: the string was
correct, the review's analysis of it was correct, and the bug lived entirely in which rows it reached.

**Rollback:** `npx wrangler rollback 851c3705-7d55-4fa8-9f7b-750a301d9fc2 --env production`.

### Gaps closed alongside these two deployments

Four of the six gaps the sixth deployment listed are now closed. Each method is named so the claim
can be judged rather than trusted.

| Gap | How it was closed | What it does **not** prove |
| --- | --- | --- |
| The transient upload statuses had never been seen | 6× CPU throttling + Slow 3G on the deployed test Worker with 17.5 MB PNGs, and a 40 ms sampler recording the transcript. All four states in all three locales: `בתור → בהכנה → בהעלאה → נוספה`, `В очереди → Подготовка → Загрузка → Добавлено`, `Waiting → Preparing → Uploading → Added`. `בהעלאה` held ~11s | That they are readable at normal CPU and network — they are not, which is why they were never seen |
| `invitations.status.expired`, `pending` and `revoked` had never rendered | A **local Miniflare stage** with a throwaway household: invitation rows seeded with past expiries, a revoked timestamp and a consumed timestamp, so the server's own `invitationStatus` derivation produced each one. All four render in all three locales | Anything about the deployed runtime; the stage was local. It is, however, what found the defect above |
| `prefers-reduced-motion` had never been emulated | A throwaway Chrome launched with `--force-prefers-reduced-motion=reduce`, driven over CDP against **production's own `/login`**, plus a control run without the flag. `matchMedia` flips, and every declaration in the `@media` block takes effect: `.busy-dots i` opacity 1 vs 0.35, skeleton background `none` vs gradient, `.card.dragging` transform `none` vs the tilt matrix, `.carousel-image` animation `none` vs `gt-fade-in` | dnd-kit's own JS reduced-motion branch, which needs a real drag. The carousel's position counter is component-rendered, not CSS, and was confirmed separately |
| The cluster production's data cannot show | Two things. (a) All **1002** dictionary values across three locales appear **verbatim** in the JavaScript production serves — zero missing. (b) Every string in the cluster was rendered **on the production origin in a real signed-in session** from synthetic payloads supplied by a read-only `fetch` wrapper that refused `POST`, `PATCH`, `DELETE` and `PUT` (each probed and rejected). Board, goals and vision revisions identical before and after | That production's **own database** ever returned them. The offer to create temporary rows behind a verified backup was declined a second time. This is the one step no stub can reach |

### Still not verified

1. **Safari, iOS and any real touch device.** `safaridriver` is present and enabled, but Safari's
   **Develop → Allow Remote Automation** is off and the owner chose to leave it off, so no WebKit
   session could be created. **This matters more than it did before**: the badge fix is a CSS layout
   change, and `inline-block` versus `inline-flex` is exactly the class of difference that can vary
   between engines. It was measured in Chromium only.
2. **No screen reader.** Announcements were read out of the accessibility tree and live-region text,
   never heard.
3. **Production's own stored rows**, as above.
4. **Dark theme in production.** Checked on the test Worker only; the changes move text and one
   layout mode, not colour.

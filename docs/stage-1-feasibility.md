# Stage 1 hosting and security feasibility

**Checked:** 2026-09-12–13 (Asia/Jerusalem)  
**Account:** Yuval3000@gmail.com's Account  
**Workers plan:** Free, confirmed in the signed-in Cloudflare dashboard under Workers plans (`Current plan`).  
**Account readiness:** Workers & Pages showed no projects and 0 / 100,000 requests today before deployment.  
**Decision:** **GO for Stage 2.** The live Free-tier proof passed. Stage 1 contains no accounts or real user data.

## Current Free terms

Cloudflare's [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) currently state 100,000 Worker requests/day, 10 ms front Worker CPU per request, 128 MB isolate memory, 50 subrequests/request, and 20,000 static files per Worker version. The front Worker only routes, bounds bodies, and forwards API requests to the DO. An account [comes with a `workers.dev` subdomain](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/); this stage requires no custom zone.

[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) currently states that Free supports SQLite-backed DOs, with 100,000 DO requests/day, 13,000 GB-s duration/day, 5 million SQL rows read/day, 100,000 rows written/day, and 5 GB total stored data. When a Free limit is exceeded, further operations of that type fail; this is not automatic paid usage. Daily limits reset at 00:00 UTC. The [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) list 1 GB maximum storage per SQLite object on Free, and the default 30-second DO CPU budget per request. Exceeding the per-object storage limit makes writes fail with `SQLITE_FULL`. These terms should be rechecked before Stage 2 and before activating real owners.

Cloudflare's [declarative DO class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) are used without legacy migration declarations. The same `household` name is fixed in code, but the separate Worker and class namespaces isolate production, test, and restore. [Static Assets Worker-first binding](https://developers.cloudflare.com/workers/static-assets/binding/) is enabled; SPA fallback is omitted.

## Local evidence

| Check | Result |
| --- | --- |
| Node/npm | 25.2.1 / 11.12.1 |
| Wrangler | 4.131.1, exact-pinned |
| React/Vite/TypeScript/Vitest | 19.3.0 / 8.3.0 / 5.9.3 / 4.1.11, exact-pinned |
| Clean install and audit | `npm ci` passed; `npm audit` found 0 vulnerabilities after pinning patched Vitest 4.1.11 |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | Passed: routing, SQLite probe across forced DO eviction, native scrypt, bounded queue |
| Test dry run | `HOUSEHOLD → TestHouseholdDO`, `DEPLOYMENT_ENV=test`, Static Assets binding |
| Production dry run | `HOUSEHOLD → HouseholdDO`, `DEPLOYMENT_ENV=production`; diagnostic handler strings absent from minified `index.js` |
| Restore dry run | `HOUSEHOLD → RestoreHouseholdDO`, `DEPLOYMENT_ENV=restore`, no public `workers.dev` route; diagnostic handler strings absent from minified `index.js` |

Local Workerd success does not establish Free deployment feasibility. Deployed routing, durable SQL, and scrypt are required below.

## Deployed evidence

| Item | Result |
| --- | --- |
| Test `workers.dev` URL | <https://family-board-test.yuval3000.workers.dev> |
| Production `workers.dev` URL | <https://family-board-production.yuval3000.workers.dev> (empty shell only) |
| Restore Worker | `family-board-restore` deployed with **no public target** (`workers_dev: false`) |
| Routing and health | Live test and production verifier passed; Chrome direct navigation to `/login` and `/board` rendered the shell. Missing assets and unknown API paths did not return HTML. Health returned schema version 1 and `Cache-Control: no-store`; wrong method returned 405. |
| SQLite persistence | Test probe written, test Worker redeployed, later read confirmed the row, then removed it. A forged `object=production` query still addressed the fixed test object. |
| Secret isolation | Missing and wrong test secret returned 404. Production diagnostic paths returned 404 even with the valid test secret. |
| Native scrypt | Correct password verified; wrong password rejected; two fresh 16-byte salts produced different hashes. Parameters `N=16384,r=8,p=5`, 32-byte key. |
| 20 warm hash requests | Client wall-clock p50 **555.44 ms**, p95 **592.88 ms**; 0 failures/timeouts (2026-09-12 19:16 UTC). |
| 20 confirmed cold DO sessions | 23 timed samples included baseline and 2 unchanged sessions; 20 with a changed random session marker counted. Client p50 **596.57 ms**, p95 **656.03 ms**; 0 failures/timeouts. Each sample followed test redeployment and was the first hash request to that session. |
| Seven-request hash burst | **1,569.53 ms** total; all seven succeeded without timeout. |
| Bounded KDF queue | Workerd test confirms one active plus seven waiting; the exact ninth operation rejects with `QueueFullError`. The diagnostic HTTP handler maps that error to 503 `busy` and `Retry-After: 1`. A separate live 25-request burst completed with 25 successes, so it did not create sustained simultaneous queue contention and is not counted as ninth-caller proof. |
| CPU duration and queue wait | Per-operation values were **unobservable**: deployed Workers freeze `performance.now()` and `Date.now()` between I/O, so the diagnostic code returned zero. We report null rather than treating zero as measured CPU or queue time. The dashboard had not populated this namespace's CPU graph at inspection. |
| Peak memory | Per-operation peak not observable in the test response; dashboard memory graph had not populated at inspection. There were no HTTP 5xx/timeout responses in the threshold benchmark or CPU/memory limit errors in the inspected dashboard error categories. |

Cloudflare's [timer behavior](https://developers.cloudflare.com/workers/runtime-apis/performance/) explains why internal CPU-only durations are zero in a deployed Worker. The client wall-clock values above include network time, so they conservatively bound the requested end-to-end latency. Dashboard metric zeros were not interpreted as measured zero CPU or memory usage.

Cloudflare created three separate SQLite-backed namespaces. The namespace IDs shown in the dashboard were `357b0e1804bb416ba0c51f2850a42a96` for `family-board-production_HouseholdDO`, `907adf9612a14874901fb8a6a1427b96` for `family-board-test_TestHouseholdDO`, and `8360f0bcceb0425db62558019279bc16` for `family-board-restore_RestoreHouseholdDO`. Each Worker binds only its own namespace and derives the object ID from the fixed name `household`. Production and restore diagnostics were absent from their minified dry-run bundles. The test namespace stored only disposable probe data, which was removed.

## Gate

The deployed Free DO met the specified work factor without weakening parameters. Both p95 values were below five seconds, and the seven-request burst was below 15 seconds with no failed or timed-out benchmark request. The queue's exact capacity passed in the Workers runtime test, and code inspection confirmed the retryable HTTP mapping. The live HTTP bursts did not sustain enough overlap to observe an actual 503; Stage 2 should retain a contention test when integrating account endpoints. Internal DO CPU duration, queue wait, and peak memory remain unquantified because the runtime timer and dashboard did not expose useful samples during this check. They do not overturn the measured latency and failure gate, but should be monitored when accounts are introduced.

If any condition fails, stop before storing credentials and revisit the master hosting decision. Do not weaken the scrypt parameters.

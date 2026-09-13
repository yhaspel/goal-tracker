import { jsonError } from '../../shared/api';
import { HouseholdImplementation } from './household-do';
import { OPERATOR_EXPORT_PATH, OPERATOR_IMAGE_EXPORT_PATTERN } from './routes/operator';

declare const __ENABLE_DIAGNOSTICS__: boolean;
declare const __ENABLE_RESTORE_IMPORT__: boolean;

export { HouseholdImplementation as HouseholdDO, HouseholdImplementation as TestHouseholdDO, HouseholdImplementation as RestoreHouseholdDO };

export interface Env {
  ASSETS: Fetcher;
  HOUSEHOLD: DurableObjectNamespace;
  DEPLOYMENT_ENV: 'production' | 'test' | 'restore';
  TEST_DIAGNOSTIC_SECRET?: string;
  /** One-time owner creation. Removed from the deployment after the owner is active. */
  BOOTSTRAP_SECRET?: string;
  /** Keyed digest for recovery phrases and operator reset tokens. Escrow it when you set it. */
  RECOVERY_DIGEST_KEY?: string;
  /** Signs the session-bound CSRF value. */
  CSRF_SECRET?: string;
  /** Pseudonymises rate-limit bucket keys so no raw email or IP is stored. */
  RATE_LIMIT_KEY?: string;
  /** Authorises the Stage 7 operator backup routes. Never a session, never a browser. */
  BACKUP_OPERATOR_SECRET?: string;
  /** Names the household a backup belongs to. A restore target must be configured to match. */
  BACKUP_HOUSEHOLD_ID?: string;
}

/**
 * Direct navigation to each of these serves the shell; anything else 404s rather than
 * rendering the app. Must stay in step with `ROUTES` in `web/src/router.tsx`.
 */
export const SPA_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/login',
  '/register',
  '/recover',
  '/bootstrap',
  '/board',
  '/goals',
  '/vision',
  '/account',
  '/members'
]);

/** Auth bodies are small. A board card may carry a 4,000-code-point description. */
const AUTH_BODY_LIMIT = 16 * 1024;
const BOARD_BODY_LIMIT = 64 * 1024;
/**
 * `POST /api/v1/vision/images`, and the two operator image routes. A maximum upload is a
 * 1,400,000-byte image and a 120,000-byte thumbnail, which is 2,026,668 bytes once base64 has
 * added its 33%; this leaves room for the metadata and the JSON around it. Kept in step with
 * `MAX_VISION_BODY` in `routes/vision.ts`, which the Durable Object re-enforces.
 */
const VISION_BODY_LIMIT = 3 * 1024 * 1024;
/** The restore import, and nothing else. Kept in step with `MAX_BACKUP_BODY` in `http.ts`. */
const BACKUP_BODY_LIMIT = 16 * 1024 * 1024;

const ID = '[A-Za-z0-9-]{1,64}';

/**
 * Explicit API allowlist with a per-route body cap. Anything else under /api is refused here,
 * so a request for an unknown path never costs a Durable Object request against the Free quota.
 */
const API_ROUTES: ReadonlyArray<{ pattern: RegExp; bodyLimit: number }> = [
  { pattern: /^\/api\/v1\/health$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/auth\/bootstrap\/(status|prepare)$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/auth\/registration\/(prepare|confirm)$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/auth\/(login|session|logout)$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/settings\/allowed-emails$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/invitations$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/invitations/${ID}$`), bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/members$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/members/${ID}$`), bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/recovery\/(phrase|operator)\/(start|confirm)$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/account\/credentials\/(start|confirm)$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/me\/preferences$/, bodyLimit: AUTH_BODY_LIMIT },
  { pattern: /^\/api\/v1\/board$/, bodyLimit: BOARD_BODY_LIMIT },
  { pattern: /^\/api\/v1\/columns$/, bodyLimit: BOARD_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/columns/${ID}(/move)?$`), bodyLimit: BOARD_BODY_LIMIT },
  { pattern: /^\/api\/v1\/cards$/, bodyLimit: BOARD_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/cards/${ID}(/move)?$`), bodyLimit: BOARD_BODY_LIMIT },
  { pattern: /^\/api\/v1\/goals$/, bodyLimit: BOARD_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/goals/${ID}(/move)?$`), bodyLimit: BOARD_BODY_LIMIT },
  { pattern: /^\/api\/v1\/milestones$/, bodyLimit: BOARD_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/milestones/${ID}(/move)?$`), bodyLimit: BOARD_BODY_LIMIT },
  { pattern: /^\/api\/v1\/vision$/, bodyLimit: BOARD_BODY_LIMIT },
  // The one route that carries an image. Everything else about the vision board is small.
  { pattern: /^\/api\/v1\/vision\/images$/, bodyLimit: VISION_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/vision/images/${ID}(/move)?$`), bodyLimit: BOARD_BODY_LIMIT },
  { pattern: new RegExp(`^/api/v1/vision/images/${ID}/content$`), bodyLimit: BOARD_BODY_LIMIT },
  // Export is available in every environment; it is gated by the operator bearer secret, and
  // the test environment needs it to run a drill from disposable data.
  { pattern: new RegExp(`^${OPERATOR_EXPORT_PATH}$`), bodyLimit: AUTH_BODY_LIMIT },
  // The paged image export carries one image back, so it takes the vision cap rather than the
  // envelope's. Its request body is empty; the limit bounds nothing here but is stated for the
  // same reason every other route states one.
  { pattern: OPERATOR_IMAGE_EXPORT_PATTERN, bodyLimit: VISION_BODY_LIMIT }
];

/** Board deletes carry `{boardRevision}`, so DELETE can have a body too. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Sent with every response. `nosniff` matters most on the API: a JSON body must never be
 * interpreted as the SPA. HSTS is scoped to this exact host and carries no `includeSubDomains`,
 * because the deployment lives on a shared `workers.dev` parent.
 */
const BASE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'no-referrer'],
  ['Strict-Transport-Security', 'max-age=31536000']
];

/**
 * `'unsafe-inline'` appears in `style-src` and nowhere else. It is required, not convenient:
 * `style-src` governs `style=` attributes as well as `<style>` elements, and both React and
 * the board's drag projection set inline transforms. There is no inline script, no `eval`, and
 * no third-party origin anywhere in the bundle — the fonts are served from this same origin.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join('; ');

const DOCUMENT_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ...BASE_SECURITY_HEADERS,
  ['Content-Security-Policy', CONTENT_SECURITY_POLICY],
  ['X-Frame-Options', 'DENY'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()']
];

/**
 * Copies a response so its headers can be set. The body is passed through untouched, so an
 * eight-megabyte export still streams rather than being buffered here.
 */
function decorate(
  response: Response,
  headers: ReadonlyArray<readonly [string, string]>,
  cacheControl?: string
): Response {
  const decorated = new Response(response.body, response);
  for (const [name, value] of headers) decorated.headers.set(name, value);
  if (cacheControl !== undefined) decorated.headers.set('Cache-Control', cacheControl);
  return decorated;
}

const apiResponse = (response: Response) => decorate(response, BASE_SECURITY_HEADERS);
const assetResponse = (response: Response) => decorate(response, DOCUMENT_SECURITY_HEADERS);
/**
 * The same `index.html` serves `/register` and `/recover`, so the shell is never stored. The
 * hashed `/assets/*` and `/fonts/*` files keep whatever caching Static Assets gives them.
 */
const shellResponse = (response: Response) => decorate(response, DOCUMENT_SECURITY_HEADERS, 'no-store');

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

function isDiagnosticPath(path: string, env: Env): boolean {
  return __ENABLE_DIAGNOSTICS__ && env.DEPLOYMENT_ENV === 'test' && path.startsWith('/api/v1/diagnostics/');
}

/**
 * True only in the restore build. The path strings live inside the guard so they are absent from
 * the production and test bundles, the same way the diagnostic routes are.
 */
function isRestoreImportPath(path: string): boolean {
  if (!__ENABLE_RESTORE_IMPORT__) return false;
  return path === '/api/v1/operator/import';
}

/** The rest of the restore-only surface: the image phase and the two bookkeeping paths. */
function restoreImagePhaseLimit(path: string): number | null {
  if (!__ENABLE_RESTORE_IMPORT__) return null;
  if (path === '/api/v1/operator/import/complete' || path === '/api/v1/operator/import/status') {
    return AUTH_BODY_LIMIT;
  }
  return new RegExp(`^/api/v1/operator/import/images/${ID}$`).test(path) ? VISION_BODY_LIMIT : null;
}

function householdStub(env: Env): DurableObjectStub {
  // The object name is fixed in server code. No request field can select another one.
  return env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household'));
}

async function forwardBounded(request: Request, stub: DurableObjectStub, bodyLimit: number): Promise<Response> {
  if (!request.body) return stub.fetch(request);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > bodyLimit) {
      await reader.cancel();
      return jsonError('payload_too_large', 'Payload too large', 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return stub.fetch(new Request(request, { body }));
}

/**
 * The restore import is the one route whose body is not buffered here. A sixteen-megabyte
 * backup would cost this Worker roughly twice that in memory and a full copy pass against the
 * Free plan's ten-millisecond CPU budget, so the declared length is checked and the request is
 * handed to the Durable Object unread. The object re-enforces the same cap while it reads.
 */
async function forwardStreamed(request: Request, stub: DurableObjectStub, bodyLimit: number): Promise<Response> {
  const declared = request.headers.get('content-length');
  if (declared === null) {
    return jsonError('length_required', 'Send the backup with a Content-Length header.', 411);
  }
  const length = Number(declared);
  if (!Number.isSafeInteger(length) || length < 0) {
    return jsonError('invalid_request', 'The request was not valid.', 400);
  }
  if (length > bodyLimit) return jsonError('payload_too_large', 'Payload too large', 413);
  return stub.fetch(request);
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (isRestoreImportPath(path)) {
    const stub = householdStub(env);
    // Anything but POST goes down the ordinary path so the Durable Object answers it, and a
    // stranger gets the same 404 the object gives every unauthorized operator request.
    if (request.method !== 'POST') return forwardBounded(request, stub, AUTH_BODY_LIMIT);
    return forwardStreamed(request, stub, BACKUP_BODY_LIMIT);
  }

  // The image phase is small enough to buffer — one image, not a whole household — so it goes
  // down the ordinary bounded path rather than the streamed one the envelope needs.
  const restorePhaseLimit = restoreImagePhaseLimit(path);
  if (restorePhaseLimit !== null) {
    return forwardBounded(request, householdStub(env), restorePhaseLimit);
  }

  const route = API_ROUTES.find(candidate => candidate.pattern.test(path));
  if (!route && !isDiagnosticPath(path, env)) {
    return jsonError('not_found', 'Not found', 404);
  }
  if (path === '/api/v1/health' && request.method !== 'GET') {
    return jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'GET' });
  }
  const bodyLimit = route?.bodyLimit ?? AUTH_BODY_LIMIT;
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  // Checked only when a body is actually declared: `POST /auth/logout` carries none,
  // and a browser sends no content type for a bodyless request. A chunked body with no
  // declared length still meets the same check inside the Durable Object.
  // Stage 1's secret-gated diagnostic routes keep their own handling, so an
  // unauthenticated probe still gets an indistinguishable 404 rather than a 415.
  if (route && BODY_METHODS.has(request.method) && declaredLength > 0) {
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      return jsonError('unsupported_media_type', 'Send application/json.', 415);
    }
  }
  if (declaredLength > bodyLimit) {
    return jsonError('payload_too_large', 'Payload too large', 413);
  }
  return forwardBounded(request, householdStub(env), bodyLimit);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (isApiPath(path)) return apiResponse(await handleApi(request, env, path));
      if (path.startsWith('/api')) return apiResponse(jsonError('not_found', 'Not found', 404));
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return apiResponse(jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'GET, HEAD' }));
      }
      if (SPA_ROUTES.has(path)) {
        const indexUrl = new URL('/index.html', url);
        return shellResponse(
          await env.ASSETS.fetch(new Request(indexUrl, { method: request.method, headers: request.headers }))
        );
      }
      return assetResponse(await env.ASSETS.fetch(request));
    } catch {
      return apiResponse(jsonError('internal_error', 'Internal error', 500));
    }
  }
} satisfies ExportedHandler<Env>;

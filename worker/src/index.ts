import { jsonError } from '../../shared/api';
import { HouseholdImplementation } from './household-do';

declare const __ENABLE_DIAGNOSTICS__: boolean;

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
  '/account',
  '/members'
]);

/** Auth bodies are small. A board card may carry a 4,000-code-point description. */
const AUTH_BODY_LIMIT = 16 * 1024;
const BOARD_BODY_LIMIT = 64 * 1024;

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
  { pattern: new RegExp(`^/api/v1/cards/${ID}(/move)?$`), bodyLimit: BOARD_BODY_LIMIT }
];

/** Board deletes carry `{boardRevision}`, so DELETE can have a body too. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

function isDiagnosticPath(path: string, env: Env): boolean {
  return __ENABLE_DIAGNOSTICS__ && env.DEPLOYMENT_ENV === 'test' && path.startsWith('/api/v1/diagnostics/');
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (isApiPath(path)) {
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
        // The object name is fixed in server code. No request field can select another one.
        const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household'));
        return await forwardBounded(request, stub, bodyLimit);
      }
      if (path.startsWith('/api')) return jsonError('not_found', 'Not found', 404);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'GET, HEAD' });
      }
      if (SPA_ROUTES.has(path)) {
        const indexUrl = new URL('/index.html', url);
        return env.ASSETS.fetch(new Request(indexUrl, { method: request.method, headers: request.headers }));
      }
      return env.ASSETS.fetch(request);
    } catch {
      return jsonError('internal_error', 'Internal error', 500);
    }
  }
} satisfies ExportedHandler<Env>;

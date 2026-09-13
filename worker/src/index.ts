import { jsonError } from '../../shared/api';
import { HouseholdImplementation } from './household-do';

declare const __ENABLE_DIAGNOSTICS__: boolean;

export { HouseholdImplementation as HouseholdDO, HouseholdImplementation as TestHouseholdDO, HouseholdImplementation as RestoreHouseholdDO };

export interface Env {
  ASSETS: Fetcher;
  HOUSEHOLD: DurableObjectNamespace;
  DEPLOYMENT_ENV: 'production' | 'test' | 'restore';
  TEST_DIAGNOSTIC_SECRET?: string;
}

const SPA_ROUTES = new Set(['/', '/login', '/register', '/recover', '/board']);
const MAX_API_BODY = 2048;

function isApiPath(path: string): boolean { return path === '/api' || path.startsWith('/api/'); }

async function forwardBounded(request: Request, stub: DurableObjectStub): Promise<Response> {
  if (!request.body) return stub.fetch(request);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_API_BODY) {
      await reader.cancel();
      return jsonError('payload_too_large', 'Payload too large', 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return stub.fetch(new Request(request, { body }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (isApiPath(path)) {
        if (path !== '/api/v1/health' && !(__ENABLE_DIAGNOSTICS__ && env.DEPLOYMENT_ENV === 'test' && path.startsWith('/api/v1/diagnostics/'))) {
          return jsonError('not_found', 'Not found', 404);
        }
        if (path === '/api/v1/health' && request.method !== 'GET') return jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'GET' });
        if (Number(request.headers.get('content-length') ?? 0) > MAX_API_BODY) return jsonError('payload_too_large', 'Payload too large', 413);
        const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household'));
        return await forwardBounded(request, stub);
      }
      if (path.startsWith('/api')) return jsonError('not_found', 'Not found', 404);
      if (request.method !== 'GET' && request.method !== 'HEAD') return jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'GET, HEAD' });
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

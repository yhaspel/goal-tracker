import { DurableObject } from 'cloudflare:workers';
import { jsonData, jsonError } from '../../shared/api';
import { hashPassword, KdfQueue, QueueFullError, verifyPassword } from './auth/kdf-queue';
import { migrate } from './db/migrations';
import { toResponse } from './http';
import { handleAllowedEmailsRoute } from './routes/allowed-emails';
import { handleAuthRoute } from './routes/auth';
import type { RouteContext } from './routes/context';
import { handleInvitationRoute } from './routes/invitations';
import { handleMemberRoute } from './routes/members';
import { handleRecoveryRoute } from './routes/recovery';
import type { Env } from './index';

declare const __ENABLE_DIAGNOSTICS__: boolean;

const MAX_DIAGNOSTIC_BODY = 2048;

function matchesSecret(actual: string | null, expected: string): boolean {
  if (!actual || actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_DIAGNOSTIC_BODY) throw new Error('too_large');
  if (!request.body) throw new Error('invalid_json');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DIAGNOSTIC_BODY) {
      await reader.cancel();
      throw new Error('too_large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch { throw new Error('invalid_json'); }
}

async function probe(request: Request, ctx: DurableObjectState): Promise<Response> {
  if (request.method === 'POST') {
    let body: unknown;
    try { body = await boundedJson(request); } catch { return jsonError('invalid_request', 'Invalid request', 400); }
    const nonce = (body as { nonce?: unknown } | null)?.nonce;
    if (typeof nonce !== 'string' || !/^[a-f0-9]{32,64}$/.test(nonce)) return jsonError('invalid_request', 'Invalid request', 400);
    ctx.storage.sql.exec('INSERT OR IGNORE INTO diagnostic_probe (nonce, created_at) VALUES (?, ?)', nonce, new Date().toISOString());
    return jsonData({ written: true }, 201);
  }
  const nonce = new URL(request.url).searchParams.get('nonce');
  if (!nonce || !/^[a-f0-9]{32,64}$/.test(nonce)) return jsonError('invalid_request', 'Invalid request', 400);
  if (request.method === 'GET') {
    const row = [...ctx.storage.sql.exec<{ nonce: string }>('SELECT nonce FROM diagnostic_probe WHERE nonce = ?', nonce)][0];
    return jsonData({ found: Boolean(row) });
  }
  if (request.method === 'DELETE') {
    ctx.storage.sql.exec('DELETE FROM diagnostic_probe WHERE nonce = ?', nonce);
    return jsonData({ removed: true });
  }
  return jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'GET, POST, DELETE' });
}

async function scryptDiagnostic(request: Request, kdf: KdfQueue): Promise<Response> {
  if (request.method !== 'POST') return jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'POST' });
  let body: unknown;
  try { body = await boundedJson(request); } catch { return jsonError('invalid_request', 'Invalid request', 400); }
  const input = body as { action?: unknown; password?: unknown; salt?: unknown; hash?: unknown } | null;
  if (!input || typeof input.password !== 'string' || input.password.length < 16 || input.password.length > 128) {
    return jsonError('invalid_request', 'Invalid request', 400);
  }
  try {
    if (input.action === 'hash') return jsonData(await hashPassword(input.password, kdf));
    if (input.action === 'verify' && typeof input.salt === 'string' && typeof input.hash === 'string') {
      return jsonData(await verifyPassword(input.password, input.salt, input.hash, kdf));
    }
    return jsonError('invalid_request', 'Invalid request', 400);
  } catch (error) {
    if (error instanceof QueueFullError) return jsonError('busy', 'Try again later', 503, { 'Retry-After': '1' });
    return jsonError('internal_error', 'Internal error', 500);
  }
}

export class HouseholdImplementation extends DurableObject<Env> {
  private schemaVersion = 0;
  private kdf?: KdfQueue;
  private diagnosticSession?: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.schemaVersion = migrate(ctx.storage.sql, ctx.storage);
    });
  }

  /**
   * The Durable Object owns every identity, seat, role, session, allowed-email, and CSRF
   * decision. The front Worker only routes and bounds request shape, so any check repeated
   * here is the authoritative one.
   */
  private routeContext(): RouteContext {
    const now = new Date();
    this.kdf ??= new KdfQueue();
    return {
      sql: this.ctx.storage.sql,
      storage: this.ctx.storage,
      env: this.env,
      kdf: this.kdf,
      now,
      nowIso: now.toISOString()
    };
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/api/v1/health') {
        if (request.method !== 'GET') return jsonError('method_not_allowed', 'Method not allowed', 405, { Allow: 'GET' });
        return jsonData({ status: 'ok', schemaVersion: this.schemaVersion });
      }
      if (__ENABLE_DIAGNOSTICS__ && path.startsWith('/api/v1/diagnostics/') && this.env.DEPLOYMENT_ENV === 'test' && this.env.TEST_DIAGNOSTIC_SECRET) {
        if (!matchesSecret(request.headers.get('X-Diagnostic-Secret'), this.env.TEST_DIAGNOSTIC_SECRET)) return jsonError('not_found', 'Not found', 404);
        if (path === '/api/v1/diagnostics/probe') return probe(request, this.ctx);
        if (path === '/api/v1/diagnostics/scrypt') {
          this.kdf ??= new KdfQueue();
          this.diagnosticSession ??= crypto.randomUUID();
          const response = await scryptDiagnostic(request, this.kdf);
          response.headers.set('X-Diagnostic-Session', this.diagnosticSession);
          return response;
        }
      }

      const ctx = this.routeContext();
      const handled =
        handleAuthRoute(ctx, request, path) ??
        handleAllowedEmailsRoute(ctx, request, path) ??
        handleInvitationRoute(ctx, request, path) ??
        handleMemberRoute(ctx, request, path) ??
        handleRecoveryRoute(ctx, request, path);
      if (handled) return await handled;

      return jsonError('not_found', 'Not found', 404);
    } catch (error) {
      return toResponse(error);
    }
  }

}

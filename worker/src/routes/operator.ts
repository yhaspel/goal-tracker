import { jsonData, jsonError } from '../../../shared/api';
import { BackupFormatError, parseBackupEnvelope, serializeEnvelope } from '../../../shared/backup';
import { constantTimeEquals } from '../auth/crypto';
import { clientIp, consumeRateLimit, RATE_RULES, rateLimitKey } from '../auth/rate-limits';
import { buildBackupPayload } from '../backup/export';
import { importBackup } from '../backup/import';
import { HttpError, MAX_BACKUP_BODY, methodNotAllowed, readTextBody } from '../http';
import { securityEvent } from '../security-log';
import type { RouteContext } from './context';

declare const __ENABLE_RESTORE_IMPORT__: boolean;

export const OPERATOR_EXPORT_PATH = '/api/v1/operator/export';

/**
 * Operator-only backup routes.
 *
 * These are the one part of the API that is **not** cookie-authenticated. The trusted local
 * CLI is not a browser: it sends no `Origin`, so `assertSameOrigin()` would reject every
 * request, and it holds no session, which is deliberate — owner lockout is one of the reasons
 * a household ends up restoring. Authorization is a 32-byte bearer secret compared in constant
 * time, and the session cookie is ignored entirely.
 *
 * Every refusal answers with the same JSON `404` an unknown path gets, so an ordinary visitor
 * cannot learn that the route exists. The reason goes to the security log instead, which is
 * what an operator debugging a `404` reads with `wrangler tail`.
 */

function hidden(): Response {
  return jsonError('not_found', 'Not found', 404);
}

/**
 * Every deployed environment is HTTPS-only. Loopback is the one carve-out, and only so the
 * operator can rehearse `scripts/backup.ts` against `wrangler dev` before pointing it at a
 * real Worker; a loopback request never leaves the machine that made it.
 */
function isSecureTransport(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
}

function bearer(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

type Authorized = { householdId: string };

/**
 * HTTPS, configuration, rate limit, then the secret — in that order, so a flood is bounded
 * before any comparison work and a misconfigured environment is never mistaken for a wrong
 * credential in the log.
 */
function authorize(ctx: RouteContext, request: Request, event: string, rule: keyof typeof RATE_RULES): Authorized | null {
  if (!isSecureTransport(new URL(request.url))) {
    securityEvent(event, 'denied', { reason: 'insecure_transport' });
    return null;
  }
  const secret = ctx.env.BACKUP_OPERATOR_SECRET;
  const householdId = ctx.env.BACKUP_HOUSEHOLD_ID;
  const rateSecret = ctx.env.RATE_LIMIT_KEY;
  if (!secret || !householdId || !rateSecret) {
    securityEvent(event, 'error', { reason: 'operator_backup_not_configured' });
    return null;
  }

  const decision = consumeRateLimit(
    ctx.sql,
    rateLimitKey(rateSecret, rule, clientIp(request)),
    RATE_RULES[rule],
    ctx.now
  );
  if (!decision.allowed) {
    securityEvent(event, 'denied', { reason: 'rate_limited' });
    return null;
  }

  const supplied = bearer(request);
  if (supplied === null || !constantTimeEquals(secret, supplied)) {
    securityEvent(event, 'denied', { reason: 'bad_operator_secret' });
    return null;
  }
  return { householdId };
}

/**
 * The body is written once, as the canonical text the digest was taken over. Wrapping it in
 * `jsonData()` would serialise a maximum-size household a second time for no benefit.
 */
function exportBackup(ctx: RouteContext, request: Request): Response {
  // Authorization runs before the method check on purpose: a stranger sending POST must get
  // the same 404 a stranger sending GET gets, not a 405 that confirms the route is there.
  const authorized = authorize(ctx, request, 'operator.backup.export', 'operatorExportPerIp');
  if (!authorized) return hidden();
  if (request.method !== 'GET') throw methodNotAllowed('GET');

  const payload = buildBackupPayload(ctx.sql, {
    schemaVersion: ctx.schemaVersion,
    householdId: authorized.householdId,
    createdAt: ctx.nowIso
  });
  const body = serializeEnvelope(payload);
  securityEvent('operator.backup.export', payload.integrity.ok ? 'allowed' : 'error', {
    reason: payload.integrity.ok ? 'exported' : 'exported_with_integrity_issues'
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function importIntoRestore(ctx: RouteContext, request: Request): Promise<Response> {
  // The build guard already keeps this code out of the production bundle. This is the second
  // lock: a restore build accidentally deployed over production still refuses to write.
  if (ctx.env.DEPLOYMENT_ENV === 'production') {
    securityEvent('operator.backup.import', 'denied', { reason: 'import_refused_in_production' });
    return hidden();
  }
  const authorized = authorize(ctx, request, 'operator.backup.import', 'operatorImportPerIp');
  if (!authorized) return hidden();
  if (request.method !== 'POST') throw methodNotAllowed('POST');

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new HttpError(415, 'unsupported_media_type', 'Send application/json.');
  }
  const text = await readTextBody(request, MAX_BACKUP_BODY);

  let envelope;
  try {
    envelope = parseBackupEnvelope(text);
  } catch (error) {
    const reason = error instanceof BackupFormatError ? error.reason : 'the backup could not be read';
    securityEvent('operator.backup.import', 'denied', { reason: 'malformed_backup' });
    throw new HttpError(400, 'invalid_backup', `That backup was rejected: ${reason}.`);
  }

  if (envelope.payload.householdId !== authorized.householdId) {
    securityEvent('operator.backup.import', 'denied', { reason: 'household_mismatch' });
    throw new HttpError(
      409,
      'household_mismatch',
      'That backup belongs to a different household than this restore target is configured for.'
    );
  }
  if (envelope.payload.schemaVersion !== ctx.schemaVersion) {
    securityEvent('operator.backup.import', 'denied', { reason: 'schema_mismatch' });
    throw new HttpError(
      409,
      'schema_mismatch',
      `That backup is schema version ${envelope.payload.schemaVersion}; this object is at ${ctx.schemaVersion}.`
    );
  }

  const result = importBackup(ctx.storage, ctx.sql, envelope.payload, {
    digest: envelope.digest,
    importedAt: ctx.nowIso,
    targetSchemaVersion: ctx.schemaVersion
  });
  securityEvent('operator.backup.import', 'allowed', { reason: 'imported' });
  return jsonData({ imported: true, ...result }, 201);
}

export function handleOperatorRoute(
  ctx: RouteContext,
  request: Request,
  path: string
): Promise<Response> | undefined {
  if (path === OPERATOR_EXPORT_PATH) {
    return (async () => exportBackup(ctx, request))();
  }
  if (__ENABLE_RESTORE_IMPORT__ && path === '/api/v1/operator/import') {
    return importIntoRestore(ctx, request);
  }
  return undefined;
}

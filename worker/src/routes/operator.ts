import { jsonData, jsonError } from '../../../shared/api';
import {
  BackupFormatError,
  MIN_IMPORTABLE_SCHEMA_VERSION,
  parseBackupEnvelope,
  parseImageBytes,
  serializeEnvelope
} from '../../../shared/backup';
import { constantTimeEquals } from '../auth/crypto';
import { clientIp, consumeRateLimit, RATE_RULES, rateLimitKey } from '../auth/rate-limits';
import { buildBackupPayload, readImageForBackup } from '../backup/export';
import { completeImport, importBackup, importImage, readMarker } from '../backup/import';
import { HttpError, MAX_BACKUP_BODY, methodNotAllowed, readJsonObject, readTextBody } from '../http';
import { securityEvent } from '../security-log';
import { MAX_VISION_BODY } from './vision';
import type { RouteContext } from './context';

declare const __ENABLE_RESTORE_IMPORT__: boolean;

export const OPERATOR_EXPORT_PATH = '/api/v1/operator/export';

/**
 * The paged image export. Deployed in production **and** restore, under the same bearer check as
 * the envelope export — a drill needs a source, and production is where the real images are.
 *
 * It returns JSON rather than `application/octet-stream`, which keeps the front Worker's
 * `application/json` gate intact, needs no second parser, and shares one validator with the
 * member upload route.
 */
export const OPERATOR_IMAGE_EXPORT_PATTERN = /^\/api\/v1\/operator\/export\/images\/([A-Za-z0-9-]{1,64})$/;

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

/** One image's bytes, base64 in both directions — the same shape the member upload sends. */
function exportImage(ctx: RouteContext, request: Request, id: string): Response {
  const authorized = authorize(ctx, request, 'operator.backup.export', 'operatorImagePerIp');
  if (!authorized) return hidden();
  if (request.method !== 'GET') throw methodNotAllowed('GET');

  const image = ctx.storage.transactionSync(() => readImageForBackup(ctx.sql, id));
  if (!image) return hidden();
  securityEvent('operator.backup.export', 'allowed', { reason: 'exported_image' });
  // `no-store`, unlike the member-facing content route: an operator copy is not a page asset.
  return jsonData(image);
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
  /**
   * An **older** schema restores; a newer one does not.
   *
   * This was an equality check, and that was wrong in the one case that matters most: the only
   * backup of a household is written by whatever build was live when it was taken, so the copy an
   * operator reaches for in an emergency is by definition from an *older* schema than the build
   * they are restoring into. An equality check refuses exactly that copy — a schema-4 production
   * backup could not be restored into a schema-5 object, which is the recovery path a schema-5
   * deployment most needs to have working.
   *
   * Accepting an older one is safe because every migration this project has added is additive:
   * the target's tables already exist, the payload simply has nothing to put in the newer ones,
   * and `parseBackupEnvelope` has already transformed the older format into the current shape.
   * A **newer** schema is still refused, because it carries data this build has never seen.
   *
   * `MIN_IMPORTABLE_SCHEMA_VERSION` is 4 rather than 1: the backup format did not exist before
   * schema 4, so there is no such thing as a schema-3 backup to be lenient about.
   */
  if (
    envelope.payload.schemaVersion > ctx.schemaVersion ||
    envelope.payload.schemaVersion < MIN_IMPORTABLE_SCHEMA_VERSION
  ) {
    securityEvent('operator.backup.import', 'denied', { reason: 'schema_mismatch' });
    throw new HttpError(
      409,
      'schema_mismatch',
      `That backup is schema version ${envelope.payload.schemaVersion}; this object is at ` +
        `${ctx.schemaVersion} and can restore ${MIN_IMPORTABLE_SCHEMA_VERSION} through ${ctx.schemaVersion}.`
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

/**
 * One image of the restore's second phase.
 *
 * Restore-only, like the envelope import, and guarded the same two ways: the build-time `define`
 * keeps it out of every other bundle, and the `DEPLOYMENT_ENV` check refuses to write even if a
 * restore build were deployed over production by accident.
 */
async function importImageIntoRestore(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  if (ctx.env.DEPLOYMENT_ENV === 'production') {
    securityEvent('operator.backup.import', 'denied', { reason: 'import_refused_in_production' });
    return hidden();
  }
  // The image budget, not the envelope one: a restore at the caps posts sixty of these.
  const authorized = authorize(ctx, request, 'operator.backup.import', 'operatorImagePerIp');
  if (!authorized) return hidden();
  if (request.method !== 'POST') throw methodNotAllowed('POST');

  const body = await readJsonObject(request, MAX_VISION_BODY);
  let image;
  try {
    image = parseImageBytes(body);
  } catch (error) {
    const reason = error instanceof BackupFormatError ? error.reason : 'the image could not be read';
    throw new HttpError(400, 'invalid_backup', `That image was rejected: ${reason}.`);
  }
  if (image.id !== id) {
    throw new HttpError(400, 'invalid_backup', 'That image payload is for a different image than the path names.');
  }

  const result = await importImage(ctx.storage, ctx.sql, image, ctx.nowIso);
  securityEvent('operator.backup.import', 'allowed', { reason: 'imported_image' });
  return jsonData({ imported: true, ...result }, 201);
}

/**
 * Finishes the restore. A distinct path rather than a reserved id, so the `/images/${ID}` pattern
 * cannot swallow it.
 */
async function completeRestore(ctx: RouteContext, request: Request): Promise<Response> {
  if (ctx.env.DEPLOYMENT_ENV === 'production') {
    securityEvent('operator.backup.import', 'denied', { reason: 'import_refused_in_production' });
    return hidden();
  }
  const authorized = authorize(ctx, request, 'operator.backup.import', 'operatorImportPerIp');
  if (!authorized) return hidden();
  if (request.method !== 'POST') throw methodNotAllowed('POST');

  const body = await readJsonObject(request, MAX_BACKUP_BODY);
  const expected = body.bytesUsed;
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) {
    throw new HttpError(400, 'invalid_request', 'Send the bytesUsed the backup recorded.');
  }

  const result = completeImport(ctx.storage, ctx.sql, expected);
  securityEvent('operator.backup.import', 'allowed', { reason: 'import_completed' });
  return jsonData({ complete: true, ...result });
}

/** Lets an operator see how far a half-finished restore got without guessing. */
function restoreStatus(ctx: RouteContext, request: Request): Response {
  if (ctx.env.DEPLOYMENT_ENV === 'production') return hidden();
  const authorized = authorize(ctx, request, 'operator.backup.import', 'operatorImportPerIp');
  if (!authorized) return hidden();
  if (request.method !== 'GET') throw methodNotAllowed('GET');
  const marker = ctx.storage.transactionSync(() => readMarker(ctx.sql));
  return jsonData(marker ?? { state: null });
}

export function handleOperatorRoute(
  ctx: RouteContext,
  request: Request,
  path: string
): Promise<Response> | undefined {
  if (path === OPERATOR_EXPORT_PATH) {
    return (async () => exportBackup(ctx, request))();
  }
  const imageExport = OPERATOR_IMAGE_EXPORT_PATTERN.exec(path);
  if (imageExport) {
    const id = imageExport[1]!;
    return (async () => exportImage(ctx, request, id))();
  }
  if (__ENABLE_RESTORE_IMPORT__) {
    if (path === '/api/v1/operator/import') return importIntoRestore(ctx, request);
    if (path === '/api/v1/operator/import/complete') return completeRestore(ctx, request);
    if (path === '/api/v1/operator/import/status') return (async () => restoreStatus(ctx, request))();
    const imageImport = /^\/api\/v1\/operator\/import\/images\/([A-Za-z0-9-]{1,64})$/.exec(path);
    if (imageImport) return importImageIntoRestore(ctx, request, imageImport[1]!);
  }
  return undefined;
}

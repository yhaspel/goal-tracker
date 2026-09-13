import { jsonData, type VisionMutationResponse, type VisionSnapshot } from '../../../shared/api';
import { type Actor, assertCsrf, currentActor, requireActor } from '../auth/authorize';
import { newId } from '../auth/crypto';
import { clientIp, consumeRateLimit, RATE_RULES, rateLimitKey } from '../auth/rate-limits';
import { findGoal } from '../goals/repository';
import {
  assertOnlyKeys,
  assertSameOrigin,
  conflict,
  invalidRequest,
  methodNotAllowed,
  notFound,
  rateLimited,
  readJsonObject,
  unauthenticated
} from '../http';
import { assertCurrentRevision, bumpRevision, readRevision, VISION_REVISION } from '../revisions';
import { securityEvent } from '../security-log';
import {
  countImages,
  deleteImage,
  findImage,
  insertImage,
  MAX_VISION_IMAGES,
  readBytesUsed,
  readImageContent,
  setBytesUsed,
  sumStoredBytes,
  updateImageMetadata
} from '../vision/repository';
import {
  compactGallery,
  MAX_DATABASE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
  MAX_VISION_TOTAL_BYTES,
  moveImage,
  readDimensions,
  readPayload,
  readVariantParameter,
  readVisionSnapshot,
  sha256Hex,
  validateCaption
} from '../vision/service';
import { MAX_BOARD_BODY } from './board';
import { requireSecrets, type RouteContext } from './context';

/**
 * The vision board.
 *
 * The upload travels as base64 inside an ordinary JSON body, which keeps the "every `/api` route
 * is JSON" invariant and keeps `readJsonObject` and `assertOnlyKeys` in play. It costs 33%
 * inflation, which is what `VISION_BODY_LIMIT` in `index.ts` pays for.
 */

/** A maximum upload is 2,026,668 bytes of base64 plus overhead; this bounds it with room. */
export const MAX_VISION_BODY = 3 * 1024 * 1024;

function assertStillEligible(ctx: RouteContext, request: Request, actor: Actor): Actor {
  const fresh = currentActor(ctx, request);
  if (!fresh || fresh.session.id !== actor.session.id) throw unauthenticated();
  return fresh;
}

function mutation(visionRevision: number, id?: string): Response {
  return jsonData<VisionMutationResponse>(id === undefined ? { visionRevision } : { visionRevision, id });
}

function unchanged(visionRevision: number): Response {
  return jsonData<VisionMutationResponse>({ visionRevision, unchanged: true });
}

async function beginMutation(
  ctx: RouteContext,
  request: Request,
  allowed: readonly string[],
  limit = MAX_BOARD_BODY
): Promise<{ actor: Actor; body: Record<string, unknown> }> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, limit);
  assertOnlyKeys(body, allowed);
  return { actor, body };
}

function optionalGoalId(body: Record<string, unknown>): string | null {
  const value = body.goalId;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidRequest('That goal is not valid.', { goalId: 'invalid' });
  }
  return value;
}

function assertGoal(ctx: RouteContext, goalId: string | null): void {
  if (goalId === null) return;
  if (!findGoal(ctx.sql, goalId)) throw invalidRequest('That goal is not valid.', { goalId: 'invalid' });
}

// --- read ---------------------------------------------------------------------------------

function readVision(ctx: RouteContext, request: Request): Response {
  if (request.method !== 'GET') throw methodNotAllowed('GET');
  requireActor(ctx, request);
  return jsonData<VisionSnapshot>(ctx.storage.transactionSync(() => readVisionSnapshot(ctx.sql)));
}

/**
 * The bytes, and the one deliberate exception to the blanket `no-store` on `/api`.
 *
 * An image's bytes are immutable for the life of its id: no route replaces them, and a deleted id
 * is never reused. `private` keeps every shared cache out of the response, and `immutable` is
 * what stops a sixty-tile gallery costing sixty Durable Object requests on every single view of
 * an object that serialises the whole household's work.
 *
 * The live-session check runs **before** the `If-None-Match` comparison, so a member whose access
 * has ended gets `401`, never a `304`.
 */
function readImage(ctx: RouteContext, request: Request, id: string): Response {
  if (request.method !== 'GET') throw methodNotAllowed('GET');
  requireActor(ctx, request);
  const variant = readVariantParameter(new URL(request.url));

  const stored = ctx.storage.transactionSync(() => readImageContent(ctx.sql, id, variant));
  if (!stored) throw notFound();

  const etag = `"${stored.digest}"`;
  const headers: Record<string, string> = {
    ETag: etag,
    // Never from anything the request says: the type comes from the stored, validated column.
    'Content-Type': stored.mediaType,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable'
  };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  return new Response(stored.bytes, { status: 200, headers });
}

// --- upload -------------------------------------------------------------------------------

async function addImage(ctx: RouteContext, request: Request): Promise<Response> {
  const { actor, body } = await beginMutation(
    ctx,
    request,
    [
      'visionRevision',
      'mediaType',
      'data',
      'width',
      'height',
      'thumbMediaType',
      'thumbData',
      'thumbWidth',
      'thumbHeight',
      'caption',
      'goalId'
    ],
    MAX_VISION_BODY
  );

  // Charged on every attempt, before any validation work. A card is cheap; an upload is not.
  const { rateLimit } = requireSecrets(ctx.env);
  for (const [rule, subject] of [
    ['visionUploadPerAccount', actor.user.id],
    ['visionUploadPerIp', clientIp(request)]
  ] as const) {
    const decision = consumeRateLimit(ctx.sql, rateLimitKey(rateLimit, rule, subject), RATE_RULES[rule], ctx.now);
    if (!decision.allowed) {
      securityEvent('vision.upload', 'denied', { userId: actor.user.id, reason: 'rate_limited' });
      throw rateLimited(decision.retryAfterSeconds);
    }
  }

  const full = readPayload(body.data, body.mediaType, MAX_IMAGE_BYTES, { data: 'data', mediaType: 'mediaType' });
  const thumb = readPayload(body.thumbData, body.thumbMediaType, MAX_THUMB_BYTES, {
    data: 'data',
    mediaType: 'mediaType'
  });
  const { width, height, thumbWidth, thumbHeight } = readDimensions(body);
  const caption = validateCaption(body.caption);
  const goalId = optionalGoalId(body);

  // Digests are computed here, before the transaction opens: hashing is async, and async work
  // inside a `transactionSync` is forbidden.
  const contentDigest = await sha256Hex(full.buffer);
  const thumbDigest = await sha256Hex(thumb.buffer);
  const added = full.byteSize + thumb.byteSize;
  const id = newId();

  const revision = ctx.storage.transactionSync(() => {
    const fresh = assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.visionRevision, VISION_REVISION);
    assertGoal(ctx, goalId);

    if (countImages(ctx.sql) >= MAX_VISION_IMAGES) {
      throw conflict('image_limit', `The vision board can hold at most ${MAX_VISION_IMAGES} images.`);
    }
    // Reconciled against the stored rows rather than trusted, so a counter that ever drifted
    // cannot silently hand out budget that is not there.
    const used = sumStoredBytes(ctx.sql);
    if (used !== readBytesUsed(ctx.sql)) setBytesUsed(ctx.sql, used);
    if (used + added > MAX_VISION_TOTAL_BYTES) {
      throw conflict('storage_full', 'The vision board has no room left. Delete an image first.');
    }
    if (ctx.storage.sql.databaseSize > MAX_DATABASE_BYTES) {
      throw conflict('storage_full', 'The vision board has no room left. Delete an image first.');
    }

    insertImage(
      ctx.sql,
      {
        id,
        caption,
        goal_id: goalId,
        media_type: full.mediaType,
        byte_size: full.byteSize,
        width,
        height,
        content_digest: contentDigest,
        thumb_media_type: thumb.mediaType,
        thumb_byte_size: thumb.byteSize,
        thumb_width: thumbWidth,
        thumb_height: thumbHeight,
        thumb_digest: thumbDigest,
        position: countImages(ctx.sql),
        creator_user_id: fresh.user.id,
        created_at: ctx.nowIso,
        updated_at: ctx.nowIso
      },
      { content: full.buffer, thumb: thumb.buffer }
    );
    setBytesUsed(ctx.sql, used + added);
    return bumpRevision(ctx.sql, VISION_REVISION);
  });

  // Never a caption, a file name, or a byte of image: the actor's opaque id and the outcome only.
  securityEvent('vision.upload', 'allowed', { userId: actor.user.id, reason: 'stored' });
  return mutation(revision, id);
}

async function patchImage(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['visionRevision', 'caption', 'goalId']);
  const touched = ['caption', 'goalId'].filter(key => key in body);
  if (touched.length === 0) throw invalidRequest('Nothing to change.');

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.visionRevision, VISION_REVISION);
    const image = findImage(ctx.sql, id);
    if (!image) throw notFound();

    const next = {
      caption: 'caption' in body ? validateCaption(body.caption) : image.caption,
      goal_id: 'goalId' in body ? optionalGoalId(body) : image.goal_id
    };
    if ('goalId' in body) assertGoal(ctx, next.goal_id);

    if (next.caption === image.caption && next.goal_id === image.goal_id) {
      return { revision: readRevision(ctx.sql, VISION_REVISION), changed: false };
    }
    updateImageMetadata(ctx.sql, id, next, ctx.nowIso);
    return { revision: bumpRevision(ctx.sql, VISION_REVISION), changed: true };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function moveImageRoute(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['visionRevision', 'targetIndex']);

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.visionRevision, VISION_REVISION);
    const image = findImage(ctx.sql, id);
    if (!image) throw notFound();
    const changed = moveImage(ctx.sql, image, body.targetIndex, ctx.nowIso);
    return {
      revision: changed ? bumpRevision(ctx.sql, VISION_REVISION) : readRevision(ctx.sql, VISION_REVISION),
      changed
    };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function removeImage(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['visionRevision']);

  const revision = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.visionRevision, VISION_REVISION);
    const image = findImage(ctx.sql, id);
    if (!image) throw notFound();

    deleteImage(ctx.sql, id);
    // Recomputed from what is left rather than subtracted, so the counter can never drift.
    setBytesUsed(ctx.sql, sumStoredBytes(ctx.sql));
    compactGallery(ctx.sql, ctx.nowIso);
    return bumpRevision(ctx.sql, VISION_REVISION);
  });
  return mutation(revision, id);
}

const IMAGE_ITEM = /^\/api\/v1\/vision\/images\/([^/]+)$/;
const IMAGE_MOVE = /^\/api\/v1\/vision\/images\/([^/]+)\/move$/;
const IMAGE_CONTENT = /^\/api\/v1\/vision\/images\/([^/]+)\/content$/;

export function handleVisionRoute(ctx: RouteContext, request: Request, path: string): Promise<Response> | undefined {
  if (path === '/api/v1/vision') return (async () => readVision(ctx, request))();

  if (path === '/api/v1/vision/images') {
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return addImage(ctx, request);
    })();
  }

  const content = IMAGE_CONTENT.exec(path);
  if (content) {
    const id = content[1]!;
    return (async () => readImage(ctx, request, id))();
  }
  const move = IMAGE_MOVE.exec(path);
  if (move) {
    const id = move[1]!;
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return moveImageRoute(ctx, request, id);
    })();
  }
  const item = IMAGE_ITEM.exec(path);
  if (item) {
    const id = item[1]!;
    return (async () => {
      if (request.method === 'PATCH') return patchImage(ctx, request, id);
      if (request.method === 'DELETE') return removeImage(ctx, request, id);
      throw methodNotAllowed('PATCH, DELETE');
    })();
  }

  return undefined;
}

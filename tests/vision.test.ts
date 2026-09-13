import { reset } from 'cloudflare:test';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GoalsMutationResponse, VisionMutationResponse, VisionSnapshot } from '../shared/api';
import { ApiClient } from './helpers/auth-client';
import { inHousehold } from './helpers/durable';
import { type Account, addMember, createOwner, setAllowed } from './helpers/household';
import { listImages, MAX_VISION_IMAGES } from '../worker/src/vision/repository';
import {
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
  MAX_VISION_TOTAL_BYTES
} from '../worker/src/vision/service';

const OWNER = 'owner@example.test';
const ALICE = 'alice@example.test';

beforeEach(async () => {
  await reset();
});

// --- payload builders -----------------------------------------------------------------------

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A byte string that starts with the right magic bytes and is otherwise deterministic filler. */
function imageBytes(kind: 'jpeg' | 'png' | 'webp', size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 7) % 251;
  if (kind === 'jpeg') bytes.set(JPEG_MAGIC, 0);
  else if (kind === 'png') bytes.set(PNG_MAGIC, 0);
  else {
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

type UploadOverrides = Record<string, unknown>;

function uploadBody(overrides: UploadOverrides = {}, sizes = { full: 2048, thumb: 512 }) {
  return {
    mediaType: 'image/webp',
    data: toBase64(imageBytes('webp', sizes.full)),
    width: 1600,
    height: 1200,
    thumbMediaType: 'image/webp',
    thumbData: toBase64(imageBytes('webp', sizes.thumb)),
    thumbWidth: 320,
    thumbHeight: 240,
    ...overrides
  };
}

async function vision(account: Account): Promise<VisionSnapshot> {
  const result = await account.client.call<VisionSnapshot>('GET', '/api/v1/vision');
  if (!result.data) throw new Error(`vision read failed: ${result.status} ${result.error?.code}`);
  return result.data;
}

async function upload(account: Account, overrides: UploadOverrides = {}, sizes?: { full: number; thumb: number }) {
  const current = await vision(account);
  return account.client.call<VisionMutationResponse>('POST', '/api/v1/vision/images', {
    body: { visionRevision: current.visionRevision, ...uploadBody(overrides, sizes) }
  });
}

async function mutate(account: Account, method: string, path: string, body: Record<string, unknown> = {}) {
  const current = await vision(account);
  return account.client.call<VisionMutationResponse>(method, path, {
    body: { visionRevision: current.visionRevision, ...body }
  });
}

function fieldErrors(error: { details?: Record<string, unknown> } | undefined): Record<string, string> {
  return ((error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors) ?? {};
}

// --- tests ----------------------------------------------------------------------------------

describe('upload and round trip', () => {
  it('stores an image and reports its metadata, digests and both sets of dimensions', async () => {
    const owner = await createOwner(OWNER);
    const bytes = imageBytes('webp', 4096);
    const thumb = imageBytes('webp', 512);
    const result = await upload(owner, { data: toBase64(bytes), thumbData: toBase64(thumb), caption: 'the beach' });
    expect(result.status).toBe(200);

    const snapshot = await vision(owner);
    expect(snapshot.visionRevision).toBe(2);
    const listed = snapshot.images[0]!;
    expect(listed).toMatchObject({
      caption: 'the beach',
      goalId: null,
      mediaType: 'image/webp',
      byteSize: 4096,
      width: 1600,
      height: 1200,
      thumbMediaType: 'image/webp',
      thumbByteSize: 512,
      thumbWidth: 320,
      thumbHeight: 240,
      position: 0,
      creatorUserId: owner.id
    });
    expect(listed.contentDigest).toBe(sha256(bytes));
    expect(listed.thumbDigest).toBe(sha256(thumb));
  });

  it('round-trips a 1.4 MB image with a digest that matches the bytes sent', async () => {
    const owner = await createOwner(OWNER);
    const bytes = imageBytes('webp', MAX_IMAGE_BYTES);
    const result = await upload(owner, { data: toBase64(bytes) });
    expect(result.status).toBe(200);

    const stored = (await vision(owner)).images[0]!;
    expect(stored.byteSize).toBe(MAX_IMAGE_BYTES);
    expect(stored.contentDigest).toBe(sha256(bytes));

    const readBack = await inHousehold(sql =>
      [...sql.exec<{ content: ArrayBuffer }>('SELECT content FROM vision_images WHERE id = ?', result.data!.id!)][0]
    );
    expect(new Uint8Array(readBack!.content)).toEqual(bytes);
  }, 60_000);

  it('accepts each of the three media types and refuses everything else', async () => {
    const owner = await createOwner(OWNER);
    for (const [mediaType, kind] of [
      ['image/jpeg', 'jpeg'],
      ['image/png', 'png'],
      ['image/webp', 'webp']
    ] as const) {
      const result = await upload(owner, {
        mediaType,
        data: toBase64(imageBytes(kind, 1024)),
        thumbMediaType: mediaType,
        thumbData: toBase64(imageBytes(kind, 256))
      });
      expect(result.status, mediaType).toBe(200);
    }

    for (const mediaType of ['image/gif', 'image/svg+xml', 'application/pdf', 'image/JPEG', '', null]) {
      const result = await upload(owner, { mediaType });
      expect(result.status, JSON.stringify(mediaType)).toBe(400);
      expect(result.error?.code, JSON.stringify(mediaType)).toBe('unsupported_image_type');
    }
  }, 60_000);

  it('refuses a payload whose bytes disagree with its declared type, on either payload', async () => {
    const owner = await createOwner(OWNER);
    const asPng = await upload(owner, { mediaType: 'image/jpeg', data: toBase64(imageBytes('png', 1024)) });
    expect(asPng.status).toBe(400);
    expect(asPng.error?.code).toBe('unsupported_image_type');

    const badThumb = await upload(owner, {
      thumbMediaType: 'image/png',
      thumbData: toBase64(imageBytes('jpeg', 256))
    });
    expect(badThumb.status).toBe(400);
    expect(badThumb.error?.code).toBe('unsupported_image_type');
    expect((await vision(owner)).images).toHaveLength(0);
  });

  it('refuses an SVG whatever it declares, and a GIF, a PDF and an empty payload', async () => {
    const owner = await createOwner(OWNER);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0]);

    for (const bytes of [svg, gif, pdf]) {
      for (const mediaType of ['image/webp', 'image/png', 'image/jpeg'] as const) {
        const result = await upload(owner, { mediaType, data: toBase64(bytes) });
        expect(result.status).toBe(400);
        expect(result.error?.code).toBe('unsupported_image_type');
      }
    }

    const empty = await upload(owner, { data: '' });
    expect(empty.status).toBe(400);
    expect(fieldErrors(empty.error).data).toBe('invalid');
    expect((await vision(owner)).images).toHaveLength(0);
  }, 60_000);

  it('refuses malformed base64 before decoding, leaving no partial row', async () => {
    const owner = await createOwner(OWNER);
    const valid = toBase64(imageBytes('webp', 1024));
    const cases: Record<string, string> = {
      whitespace: `${valid.slice(0, 8)} ${valid.slice(8)}`,
      urlSafe: valid.replace(/\+/g, '-').replace(/\//g, '_'),
      unpadded: valid.replace(/=+$/, ''),
      truncatedMidQuantum: valid.slice(0, valid.length - 3),
      paddingInTheMiddle: `${valid.slice(0, 4)}==${valid.slice(6)}`,
      allPadding: '===='
    };
    for (const [name, data] of Object.entries(cases)) {
      const result = await upload(owner, { data });
      expect(result.status, name).toBe(400);
      expect(fieldErrors(result.error).data, name).toBe('invalid');
    }
    expect((await vision(owner)).images).toHaveLength(0);
  }, 60_000);

  it('refuses one byte over either byte cap', async () => {
    const owner = await createOwner(OWNER);
    const tooBig = await upload(owner, { data: toBase64(imageBytes('webp', MAX_IMAGE_BYTES + 1)) });
    expect(tooBig.status).toBe(400);
    expect(tooBig.error?.code).toBe('image_too_large');

    const thumbTooBig = await upload(owner, { thumbData: toBase64(imageBytes('webp', MAX_THUMB_BYTES + 1)) });
    expect(thumbTooBig.status).toBe(400);
    expect(thumbTooBig.error?.code).toBe('image_too_large');

    // Exactly at the cap is accepted.
    expect((await upload(owner, { thumbData: toBase64(imageBytes('webp', MAX_THUMB_BYTES)) })).status).toBe(200);
  }, 60_000);

  it('refuses impossible dimensions and a thumbnail larger than its image', async () => {
    const owner = await createOwner(OWNER);
    for (const overrides of [
      { width: 9007199254740991 },
      { height: -1 },
      { width: 0 },
      { thumbWidth: 1.5 },
      { height: '1200' },
      { width: null }
    ]) {
      const result = await upload(owner, overrides);
      expect(result.status, JSON.stringify(overrides)).toBe(400);
      expect(fieldErrors(result.error).width, JSON.stringify(overrides)).toBe('invalid');
    }

    const wideThumb = await upload(owner, { thumbWidth: 1601 });
    expect(wideThumb.status).toBe(400);
    expect(wideThumb.error?.code).toBe('image_rejected');

    const tallThumb = await upload(owner, { thumbHeight: 1201 });
    expect(tallThumb.status).toBe(400);
    expect(tallThumb.error?.code).toBe('image_rejected');
    expect((await vision(owner)).images).toHaveLength(0);
  }, 60_000);

  it('allows a second upload of the same file: deduplication is not in scope', async () => {
    const owner = await createOwner(OWNER);
    const data = toBase64(imageBytes('webp', 2048));
    const first = await upload(owner, { data });
    const second = await upload(owner, { data });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const images = (await vision(owner)).images;
    expect(images).toHaveLength(2);
    expect(images[0]!.contentDigest).toBe(images[1]!.contentDigest);
    expect(images[0]!.id).not.toBe(images[1]!.id);
  });

  it('rejects an unknown field on an upload', async () => {
    const owner = await createOwner(OWNER);
    const result = await upload(owner, { filename: 'holiday.jpg' });
    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('invalid_request');
  });
});

describe('the byte budget', () => {
  it('never selects a BLOB when listing, however many images there are', async () => {
    const owner = await createOwner(OWNER);
    await upload(owner);
    await upload(owner);

    // The repository's own listing function is what the route uses; a later "tidy" back to
    // `SELECT *` would put sixty megabytes into the isolate, so the shape is asserted directly.
    const rows = await inHousehold(sql => listImages(sql) as unknown as Array<Record<string, unknown>>);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.prototype.hasOwnProperty.call(row, 'content')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row, 'thumb')).toBe(false);
    }
    expect(JSON.stringify(await vision(owner))).not.toContain('"content"');
  });

  it('tracks bytes_used on insert and gives them back exactly on delete', async () => {
    const owner = await createOwner(OWNER);
    const readUsed = () =>
      inHousehold(sql => [...sql.exec<{ bytes_used: number }>('SELECT bytes_used FROM vision_state WHERE id = 1')][0]!
        .bytes_used);

    expect(await readUsed()).toBe(0);
    const first = await upload(owner, {}, { full: 4096, thumb: 1024 });
    expect(await readUsed()).toBe(5120);
    await upload(owner, {}, { full: 2048, thumb: 512 });
    expect(await readUsed()).toBe(7680);

    await mutate(owner, 'DELETE', `/api/v1/vision/images/${first.data!.id}`);
    expect(await readUsed()).toBe(2560);

    // And it agrees with the authority it is reconciled against.
    const summed = await inHousehold(sql =>
      [...sql.exec<{ total: number }>(
        'SELECT COALESCE(SUM(byte_size + thumb_byte_size), 0) AS total FROM vision_images'
      )][0]!.total
    );
    expect(summed).toBe(await readUsed());
  }, 60_000);

  it('refuses an upload that would cross the 64 MiB budget, seeded by SQL', async () => {
    const owner = await createOwner(OWNER);
    // The rate limit stops at 31 uploads, so the budget is reached by seeding rows instead.
    await inHousehold(sql => {
      sql.exec(
        `INSERT INTO vision_images
           (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
            thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
            position, creator_user_id, created_at, updated_at)
         VALUES ('seeded', NULL, NULL, 'image/webp', ?, 100, 100, X'52494646', 'a',
                 'image/webp', 0, 50, 50, X'52494646', 'b', 0, ?,
                 '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
        MAX_VISION_TOTAL_BYTES - 1000,
        owner.id
      );
    });

    const result = await upload(owner, {}, { full: 2048, thumb: 512 });
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('storage_full');
    expect((await vision(owner)).images).toHaveLength(1);
  }, 60_000);

  it('refuses the 61st image with its own code, seeded by SQL', async () => {
    const owner = await createOwner(OWNER);
    await inHousehold(sql => {
      for (let index = 0; index < MAX_VISION_IMAGES; index += 1) {
        sql.exec(
          `INSERT INTO vision_images
             (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
              thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
              position, creator_user_id, created_at, updated_at)
           VALUES (?, NULL, NULL, 'image/webp', 4, 100, 100, X'52494646', ?,
                   'image/webp', 4, 50, 50, X'52494646', ?, ?, ?,
                   '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `seed-${index}`,
          `digest-${index}`,
          `thumb-${index}`,
          index,
          owner.id
        );
      }
    });

    const result = await upload(owner);
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('image_limit');
    expect((await vision(owner)).images).toHaveLength(MAX_VISION_IMAGES);
  }, 60_000);
});

describe('gallery ordering, metadata and deletes', () => {
  it('appends, reorders, and compacts after a delete', async () => {
    const owner = await createOwner(OWNER);
    const a = await upload(owner, { caption: 'a' });
    const b = await upload(owner, { caption: 'b' });
    const c = await upload(owner, { caption: 'c' });
    expect((await vision(owner)).images.map(image => image.caption)).toEqual(['a', 'b', 'c']);

    await mutate(owner, 'POST', `/api/v1/vision/images/${c.data!.id}/move`, { targetIndex: 0 });
    expect((await vision(owner)).images.map(image => [image.caption, image.position])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2]
    ]);

    await mutate(owner, 'DELETE', `/api/v1/vision/images/${a.data!.id}`);
    expect((await vision(owner)).images.map(image => [image.caption, image.position])).toEqual([
      ['c', 0],
      ['b', 1]
    ]);

    // A move computed against the compacted list still lands where it says.
    await mutate(owner, 'POST', `/api/v1/vision/images/${b.data!.id}/move`, { targetIndex: 0 });
    expect((await vision(owner)).images.map(image => image.caption)).toEqual(['b', 'c']);
  }, 90_000);

  it('reports a move that changes nothing as unchanged', async () => {
    const owner = await createOwner(OWNER);
    const first = await upload(owner);
    await upload(owner);
    const before = (await vision(owner)).visionRevision;
    const result = await mutate(owner, 'POST', `/api/v1/vision/images/${first.data!.id}/move`, { targetIndex: 0 });
    expect(result.data?.unchanged).toBe(true);
    expect((await vision(owner)).visionRevision).toBe(before);
  }, 60_000);

  it('edits a caption and a goal link, and refuses an unknown goal', async () => {
    const owner = await createOwner(OWNER);
    const image = await upload(owner);
    const goal = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
      body: { goalsRevision: 1, year: 2026, title: 'ship it' }
    });

    await mutate(owner, 'PATCH', `/api/v1/vision/images/${image.data!.id}`, {
      caption: 'summer',
      goalId: goal.data!.id
    });
    const stored = (await vision(owner)).images[0]!;
    expect(stored.caption).toBe('summer');
    expect(stored.goalId).toBe(goal.data!.id);

    const bad = await mutate(owner, 'PATCH', `/api/v1/vision/images/${image.data!.id}`, { goalId: 'nope' });
    expect(bad.status).toBe(400);
    expect(fieldErrors(bad.error).goalId).toBe('invalid');

    // A caption-only patch preserves the link, and an empty caption clears it.
    await mutate(owner, 'PATCH', `/api/v1/vision/images/${image.data!.id}`, { caption: null });
    const after = (await vision(owner)).images[0]!;
    expect(after.caption).toBeNull();
    expect(after.goalId).toBe(goal.data!.id);
  }, 60_000);

  it('bounds a caption at 200 code points and refuses a line break in one', async () => {
    const owner = await createOwner(OWNER);
    const image = await upload(owner);
    const tooLong = await mutate(owner, 'PATCH', `/api/v1/vision/images/${image.data!.id}`, {
      caption: 'א'.repeat(201)
    });
    expect(fieldErrors(tooLong.error).caption).toBe('too_long');

    const withBreak = await mutate(owner, 'PATCH', `/api/v1/vision/images/${image.data!.id}`, {
      caption: 'two\nlines'
    });
    expect(fieldErrors(withBreak.error).caption).toBe('invalid');
  }, 60_000);

  it('there is no route that replaces an image’s bytes', async () => {
    const owner = await createOwner(OWNER);
    const image = await upload(owner);
    const result = await mutate(owner, 'PATCH', `/api/v1/vision/images/${image.data!.id}`, {
      data: toBase64(imageBytes('webp', 1024))
    });
    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('invalid_request');
  });
});

describe('the content route', () => {
  /** The binary route is read with a raw request; the helper client parses JSON. */
  async function getContent(account: Account | null, id: string, query = '', headers: HeadersInit = {}) {
    const all = new Headers(headers);
    if (account?.client.cookie) all.set('Cookie', account.client.cookie);
    const { SELF } = await import('cloudflare:test');
    return SELF.fetch(new Request(`https://example.com/api/v1/vision/images/${id}/content${query}`, { headers: all }));
  }

  it('serves the stored bytes with the stored media type, an ETag and a private cache header', async () => {
    const owner = await createOwner(OWNER);
    const bytes = imageBytes('jpeg', 3000);
    const created = await upload(owner, { mediaType: 'image/jpeg', data: toBase64(bytes) });
    const id = created.data!.id!;

    const response = await getContent(owner, id);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Disposition')).toBe('inline');
    expect(response.headers.get('ETag')).toBe(`"${sha256(bytes)}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  }, 60_000);

  it('serves the thumbnail under ?variant=thumb, with its own type and digest', async () => {
    const owner = await createOwner(OWNER);
    const thumb = imageBytes('png', 900);
    const created = await upload(owner, { thumbMediaType: 'image/png', thumbData: toBase64(thumb) });
    const response = await getContent(owner, created.data!.id!, '?variant=thumb');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('ETag')).toBe(`"${sha256(thumb)}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(thumb);
  }, 60_000);

  it('answers 304 for a matching If-None-Match', async () => {
    const owner = await createOwner(OWNER);
    const created = await upload(owner);
    const first = await getContent(owner, created.data!.id!);
    const etag = first.headers.get('ETag')!;

    const revalidated = await getContent(owner, created.data!.id!, '', { 'If-None-Match': etag });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('ETag')).toBe(etag);
    expect((await revalidated.arrayBuffer()).byteLength).toBe(0);

    const changed = await getContent(owner, created.data!.id!, '', { 'If-None-Match': '"something-else"' });
    expect(changed.status).toBe(200);
  }, 60_000);

  it('refuses every query shape but a bare read and exactly variant=thumb', async () => {
    const owner = await createOwner(OWNER);
    const created = await upload(owner);
    for (const query of ['?variant=full', '?variant=', '?variant=thumb&variant=x', '?variant=thumb&x=1', '?x=1']) {
      const response = await getContent(owner, created.data!.id!, query);
      expect(response.status, query).toBe(400);
    }
  }, 60_000);

  it('refuses an anonymous caller, including a bare <img>-shaped request with no Origin', async () => {
    const owner = await createOwner(OWNER);
    const created = await upload(owner);
    const anonymous = await getContent(null, created.data!.id!);
    expect(anonymous.status).toBe(401);
    // And it is still 401 rather than 304 when a matching ETag is offered.
    const first = await getContent(owner, created.data!.id!);
    const withEtag = await getContent(null, created.data!.id!, '', {
      'If-None-Match': first.headers.get('ETag')!
    });
    expect(withEtag.status).toBe(401);
  }, 60_000);

  it('refuses a member whose address left the allowed list, 401 and not 304', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const created = await upload(owner);
    const seen = await getContent(alice, created.data!.id!);
    expect(seen.status).toBe(200);
    const etag = seen.headers.get('ETag')!;

    await setAllowed(owner, [OWNER]);
    const after = await getContent(alice, created.data!.id!, '', { 'If-None-Match': etag });
    expect(after.status).toBe(401);
  }, 90_000);

  it('404s an unknown id and an unknown sub-path', async () => {
    const owner = await createOwner(OWNER);
    expect((await getContent(owner, 'no-such-image')).status).toBe(404);
    const bytes = await owner.client.call('GET', '/api/v1/vision/images/x/bytes');
    expect(bytes.status).toBe(404);
    expect(bytes.error?.code).toBe('not_found');
  }, 60_000);
});

describe('vision authorization and conflicts', () => {
  it('refuses an anonymous caller on every vision route', async () => {
    await createOwner(OWNER);
    const stranger = new ApiClient('203.0.113.98');
    for (const [method, path] of [
      ['GET', '/api/v1/vision'],
      ['POST', '/api/v1/vision/images'],
      ['PATCH', '/api/v1/vision/images/whatever'],
      ['DELETE', '/api/v1/vision/images/whatever']
    ] as const) {
      const result = await stranger.call(method, path, { body: method === 'GET' ? undefined : {} });
      expect(result.status, `${method} ${path}`).toBe(401);
    }
  });

  it('refuses an upload without an Origin or the CSRF token', async () => {
    const owner = await createOwner(OWNER);
    const current = await vision(owner);
    const body = { visionRevision: current.visionRevision, ...uploadBody() };
    expect((await owner.client.call('POST', '/api/v1/vision/images', { body, origin: null })).status).toBe(403);
    expect((await owner.client.call('POST', '/api/v1/vision/images', { body, csrf: null })).status).toBe(403);
    expect((await vision(owner)).images).toHaveLength(0);
  }, 60_000);

  it('gives a stale writer a 409 carrying the current vision revision', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const stale = (await vision(alice)).visionRevision;
    await upload(owner);

    const result = await alice.client.call<VisionMutationResponse>('POST', '/api/v1/vision/images', {
      body: { visionRevision: stale, ...uploadBody() }
    });
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('revision_conflict');
    expect((result.error?.details as { visionRevision?: number } | undefined)?.visionRevision).toBe(stale + 1);
    expect((await vision(owner)).images).toHaveLength(1);
  }, 90_000);

  it('stops a loop at the per-account upload limit', async () => {
    const owner = await createOwner(OWNER);
    let limited = false;
    for (let attempt = 0; attempt < 34 && !limited; attempt += 1) {
      const result = await upload(owner, {}, { full: 512, thumb: 128 });
      if (result.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  }, 180_000);
});

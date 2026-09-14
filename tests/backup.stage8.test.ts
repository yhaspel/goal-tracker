import { env, reset, runInDurableObject, SELF } from 'cloudflare:test';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardMutationResponse, BoardSnapshot, GoalsMutationResponse, GoalsSnapshot } from '../shared/api';
import {
  BACKUP_FORMAT_VERSION,
  type BackupEnvelope,
  type BackupImageBytes,
  canonicalJson,
  parseBackupEnvelope
} from '../shared/backup';
import { MAX_VISION_IMAGES } from '../worker/src/vision/repository';
import { ORIGIN } from './helpers/auth-client';
import { addMember, createOwner } from './helpers/household';

/**
 * The Stage 8 half of the backup: format version 2, the new tables in the envelope, the paged
 * image phase, and the restore drill at the caps.
 */

const OWNER = 'owner@example.test';
const ALICE = 'alice@example.test';

beforeEach(async () => {
  await reset();
});

function operatorSecret(): string {
  const secret = env.BACKUP_OPERATOR_SECRET;
  if (!secret) throw new Error('the test environment must bind BACKUP_OPERATOR_SECRET');
  return secret;
}

function bearer(): Headers {
  return new Headers({ Authorization: `Bearer ${operatorSecret()}` });
}

function inObject<T>(objectName: string, callback: (sql: SqlStorage) => T): Promise<T> {
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(objectName));
  return runInDurableObject(stub, (_instance, state) => callback(state.storage.sql));
}

function operatorCall(objectName: string, path: string, init: { method?: string; body?: string } = {}) {
  const headers = bearer();
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(objectName));
  return stub.fetch(new Request(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers, body: init.body }));
}

async function readEnvelope(): Promise<{ text: string; envelope: BackupEnvelope }> {
  const response = await SELF.fetch(new Request(`${ORIGIN}/api/v1/operator/export`, { headers: bearer() }));
  expect(response.status).toBe(200);
  const text = await response.text();
  return { text, envelope: parseBackupEnvelope(text) };
}

// --- fixtures -------------------------------------------------------------------------------

function webpBytes(size: number, salt: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 7 + salt) % 251;
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

/**
 * Seeds a gallery straight into SQL. The rate limit stops the upload route at 31 in a window, so
 * a run at the caps has to be seeded — which is what the plan asks for, and what keeps this test
 * about the backup rather than about the upload.
 */
async function seedImages(
  objectName: string,
  count: number,
  ownerId: string,
  sizes = { full: 800, thumb: 200 }
): Promise<Array<{ id: string; content: Uint8Array; thumb: Uint8Array }>> {
  const seeded: Array<{ id: string; content: Uint8Array; thumb: Uint8Array }> = [];
  for (let index = 0; index < count; index += 1) {
    seeded.push({
      id: `image-${index}`,
      content: webpBytes(sizes.full, index),
      thumb: webpBytes(sizes.thumb, index + 100)
    });
  }
  await inObject(objectName, sql => {
    let bytes = 0;
    for (const [index, image] of seeded.entries()) {
      sql.exec(
        `INSERT INTO vision_images
           (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
            thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
            position, creator_user_id, created_at, updated_at)
         VALUES (?, ?, NULL, 'image/webp', ?, 1600, 1200, ?, ?, 'image/webp', ?, 320, 240, ?, ?, ?, ?,
                 '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
        image.id,
        `caption ${index}`,
        image.content.byteLength,
        image.content.buffer.slice(0, image.content.byteLength),
        sha256(image.content),
        image.thumb.byteLength,
        image.thumb.buffer.slice(0, image.thumb.byteLength),
        sha256(image.thumb),
        index,
        ownerId
      );
      bytes += image.content.byteLength + image.thumb.byteLength;
    }
    sql.exec('UPDATE vision_state SET bytes_used = ?, revision = revision + 1 WHERE id = 1', bytes);
  });
  return seeded;
}

/** A household with goals, milestones, a linked card with a due date, and a gallery. */
async function populate(imageCount = 3) {
  const owner = await createOwner(OWNER);
  const alice = await addMember(owner, ALICE);

  const goals = async () => {
    const result = await owner.client.call<GoalsSnapshot>('GET', '/api/v1/goals');
    return result.data!;
  };
  const goal = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
    body: { goalsRevision: (await goals()).goalsRevision, year: 2026, title: 'ship it', notes: 'the year of it' }
  });
  const milestone = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/milestones', {
    body: { goalsRevision: (await goals()).goalsRevision, goalId: goal.data!.id, month: 4, title: 'first cut' }
  });

  const board = (await owner.client.call<BoardSnapshot>('GET', '/api/v1/board')).data!;
  await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
    body: {
      boardRevision: board.boardRevision,
      columnId: board.columns[0]!.id,
      title: 'linked and dated',
      dueDate: '2026-04-15',
      milestoneId: milestone.data!.id,
      assigneeUserId: alice.id
    }
  });

  const images = await seedImages('household', imageCount, owner.id);
  return { owner, alice, goalId: goal.data!.id, milestoneId: milestone.data!.id, images };
}

// --- tests ----------------------------------------------------------------------------------

describe('the version 2 envelope', () => {
  it('declares format version 2 and carries every Stage 8 table', async () => {
    const { goalId, milestoneId, images } = await populate();
    const { envelope } = await readEnvelope();

    expect(envelope.payload.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(BACKUP_FORMAT_VERSION).toBe(2);
    expect(envelope.payload.goalState.revision).toBeGreaterThanOrEqual(1);
    expect(envelope.payload.visionState.bytesUsed).toBe(
      images.reduce((sum, image) => sum + image.content.byteLength + image.thumb.byteLength, 0)
    );

    expect(envelope.payload.goals.map(goal => goal.id)).toEqual([goalId]);
    expect(envelope.payload.goals[0]).toMatchObject({ year: 2026, title: 'ship it', notes: 'the year of it' });
    expect(envelope.payload.milestones.map(milestone => milestone.id)).toEqual([milestoneId]);
    expect(envelope.payload.milestones[0]).toMatchObject({ month: 4, status: 'open', goalId });

    expect(envelope.payload.cards[0]).toMatchObject({ dueDate: '2026-04-15', milestoneId });
    expect(envelope.payload.counts).toMatchObject({ goals: 1, milestones: 1, visionImages: images.length });
    expect(envelope.payload.integrity.ok).toBe(true);
  });

  it('carries image metadata and both digests, but never a byte of image', async () => {
    const { images } = await populate(2);
    const { text, envelope } = await readEnvelope();

    expect(envelope.payload.visionImages).toHaveLength(2);
    expect(envelope.payload.visionImages[0]).toMatchObject({
      id: images[0]!.id,
      mediaType: 'image/webp',
      contentDigest: sha256(images[0]!.content),
      thumbDigest: sha256(images[0]!.thumb),
      position: 0
    });
    // The bytes have their own route. Sixty images cannot fit a 16 MiB envelope.
    expect(text).not.toContain(toBase64(images[0]!.content).slice(0, 64));
    expect(text).not.toContain('"content"');
  });

  it('serves one image’s bytes through the paged export, with no-store', async () => {
    const { images } = await populate(2);
    const response = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`, { headers: bearer() })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = (await response.json()) as { data: BackupImageBytes };
    expect(body.data.id).toBe(images[0]!.id);
    expect(body.data.contentDigest).toBe(sha256(images[0]!.content));
    expect(body.data.data).toBe(toBase64(images[0]!.content));
    expect(body.data.thumbData).toBe(toBase64(images[0]!.thumb));
  });

  it('hides the paged export from an unauthorised caller and for an unknown id', async () => {
    const { images } = await populate(1);
    const anonymous = await SELF.fetch(new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`));
    expect(anonymous.status).toBe(404);

    const wrongSecret = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`, {
        headers: new Headers({ Authorization: 'Bearer wrong-secret-wrong-secret-wrong' })
      })
    );
    expect(wrongSecret.status).toBe(404);

    const missing = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/no-such-image`, { headers: bearer() })
    );
    expect(missing.status).toBe(404);
  });
});

describe('a version 1 backup still restores', () => {
  it('transforms it into the version 5 schema with no goals, no images and null due dates', async () => {
    const owner = await createOwner(OWNER);
    const board = (await owner.client.call<BoardSnapshot>('GET', '/api/v1/board')).data!;
    await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: board.boardRevision, columnId: board.columns[0]!.id, title: 'from the old world' }
    });
    const { envelope } = await readEnvelope();

    // Rebuild the same household as a version 1 copy: no Stage 8 fields anywhere, exactly as a
    // pre-Stage-8 Worker would have written it, digest and all.
    const v1Payload: Record<string, unknown> = {
      formatVersion: 1,
      // Schema 4, not the current one. Format 1 was only ever written by a schema-4 build, so a
      // format-1 envelope claiming schema 5 is not an old backup — it is one taken by a rolled-back
      // deployment, silently missing every Stage 8 row, and `parseBackupEnvelope` now refuses it.
      // This test used to carry the current schema version, which is a pair that cannot occur.
      schemaVersion: 4,
      householdId: envelope.payload.householdId,
      createdAt: envelope.payload.createdAt,
      counts: {
        allowedEmails: envelope.payload.counts.allowedEmails,
        users: envelope.payload.counts.users,
        activeUsers: envelope.payload.counts.activeUsers,
        recoveryCredentials: envelope.payload.counts.recoveryCredentials,
        invitations: envelope.payload.counts.invitations,
        columns: envelope.payload.counts.columns,
        cards: envelope.payload.counts.cards
      },
      integrity: { ok: true, issues: [] },
      appState: envelope.payload.appState,
      boardState: envelope.payload.boardState,
      allowedEmails: envelope.payload.allowedEmails,
      users: envelope.payload.users,
      recoveryCredentials: envelope.payload.recoveryCredentials,
      invitations: envelope.payload.invitations,
      columns: envelope.payload.columns,
      cards: envelope.payload.cards.map(card => {
        const { dueDate, milestoneId, ...rest } = card;
        void dueDate;
        void milestoneId;
        return rest;
      })
    };
    const body = canonicalJson(v1Payload);
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    const v1Text = `{"digest":${JSON.stringify(digest)},"payload":${body}}`;

    // It parses, verifies against its own version-1 digest, and reports version 1 as its source.
    const parsed = parseBackupEnvelope(v1Text);
    expect(parsed.sourceFormatVersion).toBe(1);
    expect(parsed.payload.goals).toEqual([]);
    expect(parsed.payload.visionImages).toEqual([]);
    expect(parsed.payload.cards.every(card => card.dueDate === null && card.milestoneId === null)).toBe(true);

    const response = await operatorCall('v1-target', '/api/v1/operator/import', { method: 'POST', body: v1Text });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { imported: true, imagesExpected: 0 } });

    const restored = await inObject('v1-target', sql => ({
      cards: [...sql.exec<{ title: string; due_date: string | null; milestone_id: string | null }>(
        'SELECT title, due_date, milestone_id FROM cards'
      )],
      goals: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM goals')][0]?.total,
      images: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM vision_images')][0]?.total,
      marker: [...sql.exec<{ state: string; format_version: number }>(
        'SELECT state, format_version FROM restore_import_marker'
      )][0]
    }));
    expect(restored.cards).toEqual([{ title: 'from the old world', due_date: null, milestone_id: null }]);
    expect(restored.goals).toBe(0);
    expect(restored.images).toBe(0);
    expect(restored.marker).toEqual({ state: 'complete', format_version: 1 });
  });

  it('refuses a format version this build does not know', async () => {
    await createOwner(OWNER);
    const { envelope } = await readEnvelope();
    const future = { ...(envelope.payload as unknown as Record<string, unknown>), formatVersion: 99 };
    const body = canonicalJson(future);
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    expect(() => parseBackupEnvelope(`{"digest":${JSON.stringify(digest)},"payload":${body}}`)).toThrow(
      /unsupported backup format version 99/
    );
  });
});

describe('the restore image phase', () => {
  it('restores every goal, milestone, link, due date and image byte', async () => {
    const { goalId, milestoneId, images } = await populate(3);
    const { text, envelope } = await readEnvelope();

    const imported = await operatorCall('drill', '/api/v1/operator/import', { method: 'POST', body: text });
    expect(imported.status).toBe(201);
    expect(await imported.json()).toMatchObject({ data: { imagesExpected: 3 } });

    // The gallery is not there yet, and the marker says so rather than pretending otherwise.
    const midway = await inObject('drill', sql => ({
      images: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM vision_images')][0]?.total,
      pending: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM restore_pending_images')][0]?.total,
      marker: [...sql.exec<{ state: string; images_expected: number; images_imported: number }>(
        'SELECT state, images_expected, images_imported FROM restore_import_marker'
      )][0],
      bytesUsed: [...sql.exec<{ bytes_used: number }>('SELECT bytes_used FROM vision_state WHERE id = 1')][0]?.bytes_used
    }));
    expect(midway.images).toBe(0);
    expect(midway.pending).toBe(3);
    expect(midway.marker).toEqual({ state: 'in_progress', images_expected: 3, images_imported: 0 });
    // The budget stays at zero until the bytes have actually arrived.
    expect(midway.bytesUsed).toBe(0);

    // Completing early is refused, because it would declare a gallery whole that is not.
    const early = await operatorCall('drill', '/api/v1/operator/import/complete', {
      method: 'POST',
      body: JSON.stringify({ bytesUsed: envelope.payload.visionState.bytesUsed })
    });
    expect(early.status).toBe(409);

    for (const image of images) {
      const source = await SELF.fetch(
        new Request(`${ORIGIN}/api/v1/operator/export/images/${image.id}`, { headers: bearer() })
      );
      const payload = ((await source.json()) as { data: BackupImageBytes }).data;
      const stored = await operatorCall('drill', `/api/v1/operator/import/images/${image.id}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      expect(stored.status, image.id).toBe(201);
    }

    const completed = await operatorCall('drill', '/api/v1/operator/import/complete', {
      method: 'POST',
      body: JSON.stringify({ bytesUsed: envelope.payload.visionState.bytesUsed })
    });
    expect(completed.status).toBe(200);

    const restored = await inObject('drill', sql => ({
      goals: [...sql.exec<{ id: string; year: number; title: string; position: number }>(
        'SELECT id, year, title, position FROM goals ORDER BY year, position'
      )],
      milestones: [...sql.exec<{ id: string; goal_id: string; month: number; status: string }>(
        'SELECT id, goal_id, month, status FROM milestones'
      )],
      cards: [...sql.exec<{ due_date: string | null; milestone_id: string | null }>(
        'SELECT due_date, milestone_id FROM cards'
      )],
      images: [...sql.exec<{ id: string; content: ArrayBuffer; thumb: ArrayBuffer; position: number }>(
        'SELECT id, content, thumb, position FROM vision_images ORDER BY position'
      )],
      vision: [...sql.exec<{ revision: number; bytes_used: number }>(
        'SELECT revision, bytes_used FROM vision_state WHERE id = 1'
      )][0],
      goalRevision: [...sql.exec<{ revision: number }>('SELECT revision FROM goal_state WHERE id = 1')][0]?.revision,
      marker: [...sql.exec<{ state: string; images_imported: number }>(
        'SELECT state, images_imported FROM restore_import_marker'
      )][0],
      pendingTable: [...sql.exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'restore_pending_images'"
      )]
    }));

    expect(restored.goals.map(goal => goal.id)).toEqual([goalId]);
    expect(restored.milestones[0]).toMatchObject({ id: milestoneId, goal_id: goalId, month: 4, status: 'open' });
    expect(restored.cards[0]).toEqual({ due_date: '2026-04-15', milestone_id: milestoneId });
    expect(restored.goalRevision).toBe(envelope.payload.goalState.revision);
    expect(restored.vision).toEqual({
      revision: envelope.payload.visionState.revision,
      bytes_used: envelope.payload.visionState.bytesUsed
    });
    expect(restored.marker).toEqual({ state: 'complete', images_imported: 3 });
    // The staging table is gone once there is nothing left to stage.
    expect(restored.pendingTable).toEqual([]);

    // Byte for byte, for every image.
    expect(restored.images.map(image => image.id)).toEqual(images.map(image => image.id));
    for (const [index, stored] of restored.images.entries()) {
      expect(new Uint8Array(stored.content), stored.id).toEqual(images[index]!.content);
      expect(new Uint8Array(stored.thumb), stored.id).toEqual(images[index]!.thumb);
    }
  }, 60_000);

  it('refuses bytes whose digest does not match what the envelope recorded', async () => {
    const { images } = await populate(1);
    const { text } = await readEnvelope();
    await operatorCall('digest-drill', '/api/v1/operator/import', { method: 'POST', body: text });

    const tampered: BackupImageBytes = {
      id: images[0]!.id,
      mediaType: 'image/webp',
      data: toBase64(webpBytes(800, 99)),
      thumbMediaType: 'image/webp',
      thumbData: toBase64(images[0]!.thumb),
      contentDigest: sha256(images[0]!.content),
      thumbDigest: sha256(images[0]!.thumb)
    };
    const response = await operatorCall('digest-drill', `/api/v1/operator/import/images/${images[0]!.id}`, {
      method: 'POST',
      body: JSON.stringify(tampered)
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('image_digest_mismatch');
    expect(await inObject('digest-drill', sql =>
      [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM vision_images')][0]?.total
    )).toBe(0);
  }, 60_000);

  it('refuses an image the envelope never listed, and the same image twice', async () => {
    const { images } = await populate(1);
    const { text } = await readEnvelope();
    await operatorCall('twice-drill', '/api/v1/operator/import', { method: 'POST', body: text });

    const source = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`, { headers: bearer() })
    );
    const payload = ((await source.json()) as { data: BackupImageBytes }).data;

    const stranger = await operatorCall('twice-drill', '/api/v1/operator/import/images/not-listed', {
      method: 'POST',
      body: JSON.stringify({ ...payload, id: 'not-listed' })
    });
    expect(stranger.status).toBe(404);

    expect((await operatorCall('twice-drill', `/api/v1/operator/import/images/${images[0]!.id}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })).status).toBe(201);
    // The second attempt is refused: the row is no longer pending.
    expect((await operatorCall('twice-drill', `/api/v1/operator/import/images/${images[0]!.id}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })).status).toBe(404);

    expect(await inObject('twice-drill', sql =>
      [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM vision_images')][0]?.total
    )).toBe(1);
  }, 60_000);

  it('refuses a path id that disagrees with the payload it carries', async () => {
    const { images } = await populate(2);
    const { text } = await readEnvelope();
    await operatorCall('mismatch-drill', '/api/v1/operator/import', { method: 'POST', body: text });

    const source = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`, { headers: bearer() })
    );
    const payload = ((await source.json()) as { data: BackupImageBytes }).data;
    const response = await operatorCall('mismatch-drill', `/api/v1/operator/import/images/${images[1]!.id}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    expect(response.status).toBe(400);
  }, 60_000);

  it('rejects a second envelope import whatever state the marker is in', async () => {
    const { images } = await populate(1);
    const { text } = await readEnvelope();
    expect((await operatorCall('second-drill', '/api/v1/operator/import', { method: 'POST', body: text })).status)
      .toBe(201);

    // While in_progress...
    const duringPhase = await operatorCall('second-drill', '/api/v1/operator/import', { method: 'POST', body: text });
    expect(duringPhase.status).toBe(409);
    expect(((await duringPhase.json()) as { error: { code: string } }).error.code).toBe('restore_target_not_pristine');

    const source = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`, { headers: bearer() })
    );
    const payload = ((await source.json()) as { data: BackupImageBytes }).data;
    await operatorCall('second-drill', `/api/v1/operator/import/images/${images[0]!.id}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    await operatorCall('second-drill', '/api/v1/operator/import/complete', {
      method: 'POST',
      body: JSON.stringify({ bytesUsed: 1000 })
    }).catch(() => undefined);

    // ...and after it.
    const afterPhase = await operatorCall('second-drill', '/api/v1/operator/import', { method: 'POST', body: text });
    expect(afterPhase.status).toBe(409);
  }, 60_000);

  it('refuses to complete when the recomputed budget disagrees with the envelope', async () => {
    const { images } = await populate(1);
    const { text } = await readEnvelope();
    await operatorCall('budget-drill', '/api/v1/operator/import', { method: 'POST', body: text });

    const source = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`, { headers: bearer() })
    );
    const payload = ((await source.json()) as { data: BackupImageBytes }).data;
    await operatorCall('budget-drill', `/api/v1/operator/import/images/${images[0]!.id}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const wrong = await operatorCall('budget-drill', '/api/v1/operator/import/complete', {
      method: 'POST',
      body: JSON.stringify({ bytesUsed: 999_999 })
    });
    expect(wrong.status).toBe(409);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe('restore_incomplete');

    const marker = await inObject('budget-drill', sql =>
      [...sql.exec<{ state: string }>('SELECT state FROM restore_import_marker')][0]
    );
    // Still resumable rather than stranded: only the image phase may finish this restore.
    expect(marker?.state).toBe('in_progress');
  }, 60_000);

  it('reports how far a half-finished restore got, so a resume is not a guess', async () => {
    const { images } = await populate(2);
    const { text, envelope } = await readEnvelope();
    await operatorCall('status-drill', '/api/v1/operator/import', { method: 'POST', body: text });

    const source = await SELF.fetch(
      new Request(`${ORIGIN}/api/v1/operator/export/images/${images[0]!.id}`, { headers: bearer() })
    );
    const payload = ((await source.json()) as { data: BackupImageBytes }).data;
    await operatorCall('status-drill', `/api/v1/operator/import/images/${images[0]!.id}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const status = await operatorCall('status-drill', '/api/v1/operator/import/status');
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      data: { state: 'in_progress', digest: envelope.digest, imagesExpected: 2, imagesImported: 1 }
    });
  }, 60_000);
});

describe('the restore drill at the Stage 8 caps', () => {
  it('carries a gallery at the image cap through both phases, byte for byte', async () => {
    const owner = await createOwner(OWNER);
    const images = await seedImages('household', MAX_VISION_IMAGES, owner.id, { full: 600, thumb: 160 });
    const { text, envelope } = await readEnvelope();

    expect(envelope.payload.counts.visionImages).toBe(MAX_VISION_IMAGES);
    expect(envelope.payload.integrity.ok).toBe(true);

    const imported = await operatorCall('caps-drill', '/api/v1/operator/import', { method: 'POST', body: text });
    expect(imported.status).toBe(201);

    for (const image of images) {
      const source = await SELF.fetch(
        new Request(`${ORIGIN}/api/v1/operator/export/images/${image.id}`, { headers: bearer() })
      );
      const payload = ((await source.json()) as { data: BackupImageBytes }).data;
      const stored = await operatorCall('caps-drill', `/api/v1/operator/import/images/${image.id}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      expect(stored.status, image.id).toBe(201);
    }

    const completed = await operatorCall('caps-drill', '/api/v1/operator/import/complete', {
      method: 'POST',
      body: JSON.stringify({ bytesUsed: envelope.payload.visionState.bytesUsed })
    });
    expect(completed.status).toBe(200);

    const restored = await inObject('caps-drill', sql => ({
      images: [...sql.exec<{ id: string; content: ArrayBuffer; position: number }>(
        'SELECT id, content, position FROM vision_images ORDER BY position'
      )],
      bytesUsed: [...sql.exec<{ bytes_used: number }>('SELECT bytes_used FROM vision_state WHERE id = 1')][0]?.bytes_used
    }));
    expect(restored.images).toHaveLength(MAX_VISION_IMAGES);
    expect(restored.bytesUsed).toBe(envelope.payload.visionState.bytesUsed);
    expect(restored.images.map(image => image.position)).toEqual(images.map((_, index) => index));
    for (const [index, stored] of restored.images.entries()) {
      expect(new Uint8Array(stored.content), stored.id).toEqual(images[index]!.content);
    }

    // And the restored household re-exports to the same envelope digest, which is what makes it
    // the same household rather than merely a similar one.
    const reexport = await operatorCall('caps-drill', '/api/v1/operator/export');
    const reread = parseBackupEnvelope(await reexport.text());
    expect(reread.payload.counts).toEqual(envelope.payload.counts);
    expect(reread.payload.visionImages).toEqual(envelope.payload.visionImages);
    expect(reread.payload.cards).toEqual(envelope.payload.cards);
  }, 180_000);
});

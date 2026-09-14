import { env, reset, runInDurableObject, SELF } from 'cloudflare:test';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardMutationResponse, BoardSnapshot } from '../shared/api';
import { canonicalJson, parseBackupEnvelope } from '../shared/backup';
import { ORIGIN } from './helpers/auth-client';
import { createOwner } from './helpers/household';

/**
 * The one path that has to work before Stage 8 can go anywhere near production.
 *
 * Production runs pre-Stage-8 code at **schema 4**, and the only backup of the household in
 * existence is a **format 1, schema 4** copy taken by that build. If Stage 8 is deployed and
 * anything goes wrong, that copy is what a restore has to be able to read. Stage 8's own plan
 * requires it: *"an older envelope restores into the version 5 schema with no goals, no
 * milestones, no images, and every `due_date` and `milestone_id` null."*
 *
 * `tests/backup.stage8.test.ts` covers a format-1 envelope, but builds it carrying the *current*
 * schema version — a combination that cannot exist, because format 1 was only ever written by a
 * schema-4 build. This file exercises the combination that actually sits on the operator's disk.
 */

beforeEach(async () => {
  await reset();
});

function bearer(): Headers {
  const secret = env.BACKUP_OPERATOR_SECRET;
  if (!secret) throw new Error('the test environment must bind BACKUP_OPERATOR_SECRET');
  return new Headers({ Authorization: `Bearer ${secret}` });
}

function operatorCall(objectName: string, path: string, body: string) {
  const headers = bearer();
  headers.set('Content-Type', 'application/json');
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(objectName));
  return stub.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body }));
}

function inObject<T>(objectName: string, callback: (sql: SqlStorage) => T): Promise<T> {
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(objectName));
  return runInDurableObject(stub, (_instance, state) => callback(state.storage.sql));
}

/**
 * Rebuilds the current household as a **pre-Stage-8** backup would have recorded it: format
 * version 1, schema version 4, no Stage 8 fields anywhere, digest taken over that exact shape.
 */
async function schemaFourBackup(): Promise<string> {
  const response = await SELF.fetch(new Request(`${ORIGIN}/api/v1/operator/export`, { headers: bearer() }));
  const current = parseBackupEnvelope(await response.text()).payload;

  const payload: Record<string, unknown> = {
    formatVersion: 1,
    // What a real pre-Stage-8 production export carries, and the whole point of this test.
    schemaVersion: 4,
    householdId: current.householdId,
    createdAt: current.createdAt,
    counts: {
      allowedEmails: current.counts.allowedEmails,
      users: current.counts.users,
      activeUsers: current.counts.activeUsers,
      recoveryCredentials: current.counts.recoveryCredentials,
      invitations: current.counts.invitations,
      columns: current.counts.columns,
      cards: current.counts.cards
    },
    integrity: { ok: true, issues: [] },
    appState: current.appState,
    boardState: current.boardState,
    allowedEmails: current.allowedEmails,
    users: current.users,
    recoveryCredentials: current.recoveryCredentials,
    invitations: current.invitations,
    columns: current.columns,
    cards: current.cards.map(card => {
      const { dueDate, milestoneId, ...rest } = card;
      void dueDate;
      void milestoneId;
      return rest;
    })
  };
  const body = canonicalJson(payload);
  const digest = createHash('sha256').update(body, 'utf8').digest('hex');
  return `{"digest":${JSON.stringify(digest)},"payload":${body}}`;
}

describe('restoring the production backup that actually exists', () => {
  it('accepts a format 1 / schema 4 backup into the schema 5 restore target', async () => {
    const owner = await createOwner();
    const board = (await owner.client.call<BoardSnapshot>('GET', '/api/v1/board')).data!;
    await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: board.boardRevision, columnId: board.columns[0]!.id, title: 'a card from before Stage 8' }
    });

    const text = await schemaFourBackup();
    const parsed = parseBackupEnvelope(text);
    expect(parsed.sourceFormatVersion).toBe(1);
    expect(parsed.payload.schemaVersion).toBe(4);

    const response = await operatorCall('prod-shaped-restore', '/api/v1/operator/import', text);
    const bodyText = await response.text();
    expect(
      response.status,
      `a schema-4 production backup must restore into a schema-5 object; got ${response.status} ${bodyText}`
    ).toBe(201);

    const restored = await inObject('prod-shaped-restore', sql => ({
      cards: [...sql.exec<{ title: string; due_date: string | null; milestone_id: string | null }>(
        'SELECT title, due_date, milestone_id FROM cards'
      )],
      users: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM users')][0]?.total,
      goals: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM goals')][0]?.total,
      images: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM vision_images')][0]?.total,
      marker: [...sql.exec<{ state: string; schema_version: number; format_version: number }>(
        'SELECT state, schema_version, format_version FROM restore_import_marker'
      )][0]
    }));

    // The transform the plan describes: the household comes back, with the Stage 8 tables empty
    // and both new card columns null.
    expect(restored.cards).toEqual([{ title: 'a card from before Stage 8', due_date: null, milestone_id: null }]);
    expect(restored.users).toBe(1);
    expect(restored.goals).toBe(0);
    expect(restored.images).toBe(0);
    expect(restored.marker?.state).toBe('complete');
  }, 60_000);

  /**
   * The rollback hole, pinned.
   *
   * Rolling the Worker code back across migration 5 is allowed, and `migrate()` reports
   * `MAX(version)` from `schema_migrations`, which does not fall when the code does. So a
   * rolled-back Worker writes the **old** format beside the **new** schema, in a copy that is
   * silently missing every goal, milestone, image and due date. Treated as an honest older
   * backup it restores "successfully" with those tables empty, and retention then prunes the
   * copies that still had the data.
   */
  it('refuses a format 1 envelope that claims schema 5 — a backup taken after a rollback', async () => {
    const owner = await createOwner();
    void owner;
    const text = await schemaFourBackup();
    const parsed = JSON.parse(text) as { payload: Record<string, unknown> };
    // Exactly what a rolled-back Worker emits: old code, newer database.
    parsed.payload.schemaVersion = 5;
    const body = canonicalJson(parsed.payload);
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    const rolledBack = `{"digest":${JSON.stringify(digest)},"payload":${body}}`;

    // Refused at parse time, which stops the CLI writing one as well as the importer reading one.
    expect(() => parseBackupEnvelope(rolledBack)).toThrow(/cannot describe a schema-5 household/);

    const response = await operatorCall('rolled-back-restore', '/api/v1/operator/import', rolledBack);
    expect(response.status).toBe(400);
    const body2 = (await response.json()) as { error: { code: string; message: string } };
    expect(body2.error.code).toBe('invalid_backup');
    expect(body2.error.message).toMatch(/older than its database/);

    // And nothing was written: a half-restored household is worse than a refused one.
    const rows = await inObject('rolled-back-restore', sql => ({
      users: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM users')][0]?.total,
      cards: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM cards')][0]?.total
    }));
    expect(rows).toEqual({ users: 0, cards: 0 });
  }, 60_000);

  it('still accepts the coherent pairs: format 1 with schema 4, and format 2 with schema 5', async () => {
    const owner = await createOwner();
    void owner;
    // Format 2 / schema 5 is what this build itself emits, and it must stay readable.
    const response = await SELF.fetch(new Request(`${ORIGIN}/api/v1/operator/export`, { headers: bearer() }));
    const current = parseBackupEnvelope(await response.text());
    expect(current.sourceFormatVersion).toBe(2);
    expect(current.payload.schemaVersion).toBe(5);

    // And format 1 / schema 4 is the copy on the operator's disk, covered by the first test here.
    const older = parseBackupEnvelope(await schemaFourBackup());
    expect(older.sourceFormatVersion).toBe(1);
    expect(older.payload.schemaVersion).toBe(4);
  }, 60_000);

  it('still refuses a backup from a schema this build genuinely cannot read', async () => {
    // Accepting an older schema must not become "accept anything". A backup from a *newer* schema
    // than this build understands has fields this code has never seen, and is still refused —
    // with `schema_mismatch` rather than the rollback error, because a copy carrying the current
    // format with a higher schema came from a newer build, not from rolled-back code.
    const owner = await createOwner();
    void owner;
    const response = await SELF.fetch(new Request(`${ORIGIN}/api/v1/operator/export`, { headers: bearer() }));
    const current = JSON.parse(await response.text()) as { payload: Record<string, unknown> };
    expect(current.payload.formatVersion).toBe(2);
    current.payload.schemaVersion = 99;
    const body = canonicalJson(current.payload);
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    const forward = `{"digest":${JSON.stringify(digest)},"payload":${body}}`;

    const imported = await operatorCall('future-schema-restore', '/api/v1/operator/import', forward);
    expect(imported.status).toBe(409);
    expect(((await imported.json()) as { error: { code: string } }).error.code).toBe('schema_mismatch');
  }, 60_000);
});

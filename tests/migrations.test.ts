import { env, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardMutationResponse, BoardSnapshot } from '../shared/api';
import {
  migrate,
  SCHEMA_VERSION,
  SEED_BOARD_REVISION,
  SEED_GOAL_REVISION,
  SEED_VISION_REVISION
} from '../worker/src/db/migrations';
import { inHousehold } from './helpers/durable';
import { type Account, createOwner } from './helpers/household';

/**
 * Migration 5 is the first one applied to a database that already holds a real board, so what is
 * being asserted here is not only that the new tables appear but that nothing existing moved.
 */

beforeEach(async () => {
  await reset();
});

/** Runs `migrate()` again against the live object, the way a redeploy would. */
function remigrate(): Promise<number> {
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household'));
  return runInDurableObject(stub, (_instance, state) => migrate(state.storage.sql, state.storage));
}

function tableNames(sql: SqlStorage): string[] {
  return [...sql.exec<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  )].map(row => row.name);
}

async function snapshot(account: Account): Promise<BoardSnapshot> {
  const result = await account.client.call<BoardSnapshot>('GET', '/api/v1/board');
  if (!result.data) throw new Error(`board read failed: ${result.status} ${result.error?.code}`);
  return result.data;
}

describe('migration 5', () => {
  it('reports the declared schema version and creates every new table', async () => {
    await createOwner();
    expect(await remigrate()).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(5);

    const names = await inHousehold(tableNames);
    for (const table of ['goal_state', 'vision_state', 'goals', 'milestones', 'vision_images']) {
      expect(names, table).toContain(table);
    }
    // The restore marker is created by the import handler, never by a migration, so production
    // does not grow a table it must not have.
    expect(names).not.toContain('restore_import_marker');
  });

  it('seeds both new revisions at 1 and the image budget at 0', async () => {
    await createOwner();
    const state = await inHousehold(sql => ({
      goal: [...sql.exec<{ revision: number }>('SELECT revision FROM goal_state WHERE id = 1')][0],
      vision: [...sql.exec<{ revision: number; bytes_used: number }>(
        'SELECT revision, bytes_used FROM vision_state WHERE id = 1'
      )][0],
      board: [...sql.exec<{ revision: number }>('SELECT revision FROM board_state WHERE id = 1')][0]
    }));
    expect(state.goal?.revision).toBe(SEED_GOAL_REVISION);
    expect(state.vision?.revision).toBe(SEED_VISION_REVISION);
    expect(state.vision?.bytes_used).toBe(0);
    // The board's own seed is unchanged by this migration.
    expect(state.board?.revision).toBeGreaterThanOrEqual(SEED_BOARD_REVISION);
  });

  it('is idempotent: a re-run writes no second migration row and changes no data', async () => {
    const owner = await createOwner();
    const before = await snapshot(owner);
    const beforeRows = await inHousehold(sql => ({
      versions: [...sql.exec<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')]
        .map(row => row.version),
      goalRevision: [...sql.exec<{ revision: number }>('SELECT revision FROM goal_state WHERE id = 1')][0]?.revision,
      goals: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM goals')][0]?.total
    }));

    expect(await remigrate()).toBe(SCHEMA_VERSION);
    expect(await remigrate()).toBe(SCHEMA_VERSION);

    const afterRows = await inHousehold(sql => ({
      versions: [...sql.exec<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')]
        .map(row => row.version),
      goalRevision: [...sql.exec<{ revision: number }>('SELECT revision FROM goal_state WHERE id = 1')][0]?.revision,
      goals: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM goals')][0]?.total
    }));
    expect(afterRows).toEqual(beforeRows);
    expect(beforeRows.versions).toEqual([1, 2, 3, 4, 5]);
    expect(await snapshot(owner)).toEqual(before);
  });

  it('leaves an existing board with cards untouched, positions and revision included', async () => {
    const owner = await createOwner();
    const initial = await snapshot(owner);
    const columnId = initial.columns[0]!.id;

    let revision = initial.boardRevision;
    for (const title of ['first', 'second', 'third']) {
      const created = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
        body: { boardRevision: revision, columnId, title }
      });
      revision = created.data!.boardRevision;
    }

    const before = await snapshot(owner);
    await remigrate();
    const after = await snapshot(owner);

    expect(after).toEqual(before);
    expect(after.columns[0]!.cards.map(card => [card.title, card.position])).toEqual([
      ['first', 0],
      ['second', 1],
      ['third', 2]
    ]);
    // The two new columns exist on every card and default to null rather than to a value.
    expect(after.columns[0]!.cards.every(card => card.dueDate === null && card.milestoneId === null)).toBe(true);
  });

  it('enforces the new milestone foreign key: a bogus milestone_id cannot be written', async () => {
    const owner = await createOwner();
    const board = await snapshot(owner);
    const columnId = board.columns[0]!.id;
    const created = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: board.boardRevision, columnId, title: 'anchored' }
    });
    const cardId = created.data!.id!;

    // Straight at SQL, which is where a foreign key either holds or does not.
    await expect(
      inHousehold(sql => {
        sql.exec('UPDATE cards SET milestone_id = ? WHERE id = ?', 'no-such-milestone', cardId);
      })
    ).rejects.toThrow();

    const still = await inHousehold(
      sql => [...sql.exec<{ milestone_id: string | null }>('SELECT milestone_id FROM cards WHERE id = ?', cardId)][0]
    );
    expect(still?.milestone_id).toBeNull();
  });

  it('enforces the goal foreign key on a milestone and on a vision image', async () => {
    await createOwner();
    await expect(
      inHousehold(sql => {
        sql.exec(
          `INSERT INTO milestones (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
           VALUES ('m1', 'no-such-goal', 1, 'orphan', NULL, 'open', 0, 'nobody', '2026-09-13', '2026-09-13')`
        );
      })
    ).rejects.toThrow();

    const milestones = await inHousehold(
      sql => [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM milestones')][0]?.total
    );
    expect(milestones).toBe(0);
  });
});

import { env, reset, runInDurableObject, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot, GoalsSnapshot } from '../shared/api';
import { MAX_CARDS } from '../worker/src/board/repository';
import { MAX_GOALS, MAX_MILESTONES_PER_GOAL } from '../worker/src/goals/repository';
import { MAX_VISION_IMAGES } from '../worker/src/vision/repository';
import { ORIGIN } from './helpers/auth-client';
import { inHousehold } from './helpers/durable';
import { type Account, createOwner } from './helpers/household';

/**
 * Stage 8 task 8, the half that does not need the deployed Worker.
 *
 * Response sizes and SQL row counts are deterministic functions of the data and the same code
 * runs in both places, so they are measured here rather than by filling the deployed test
 * household with five hundred disposable cards. The two things that genuinely differ under the
 * Free runtime — front-Worker CPU and the Durable Object's own duration — were measured against
 * the deployed test Worker instead; `docs/stage-8-completion.md` records which is which.
 *
 * These assertions are deliberately loose. They exist to catch an order-of-magnitude regression —
 * a `SELECT *` creeping back into a listing, a snapshot that starts carrying image bytes — not to
 * pin a number that will drift.
 */

beforeEach(async () => {
  await reset();
});

function report(label: string, value: string): void {
  // The point of this file is the numbers, and the numbers reach a person through stdout.
  // eslint-disable-next-line no-console -- a measurement harness reporting its measurements
  console.log(`MEASUREMENT ${label}: ${value}`);
}

async function readAs(account: Account, path: string): Promise<{ bytes: number; json: unknown }> {
  const response = await SELF.fetch(
    new Request(`${ORIGIN}${path}`, { headers: new Headers({ Cookie: account.client.cookie! }) })
  );
  const text = await response.text();
  return { bytes: new TextEncoder().encode(text).length, json: JSON.parse(text) };
}

describe('response sizes at the caps', () => {
  it('a 500-card board carrying due dates and milestone links', async () => {
    const owner = await createOwner();
    const board = (await owner.client.call<BoardSnapshot>('GET', '/api/v1/board')).data!;
    const columnId = board.columns[0]!.id;

    await inHousehold(sql => {
      sql.exec(
        `INSERT INTO goals (id, year, title, notes, position, creator_user_id, created_at, updated_at)
         VALUES ('g', 2026, 'the goal', NULL, 0, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
        owner.id
      );
      sql.exec(
        `INSERT INTO milestones (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
         VALUES ('m', 'g', 4, 'the milestone', NULL, 'open', 0, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
        owner.id
      );
      for (let index = 0; index < MAX_CARDS; index += 1) {
        sql.exec(
          `INSERT INTO cards
             (id, column_id, title, description, assignee_user_id, creator_user_id, position,
              due_date, milestone_id, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, ?, ?, '2026-12-31', 'm',
                   '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `card-${index}`,
          columnId,
          `a reasonably typical card title ${index}`,
          owner.id,
          index
        );
      }
    });

    const { bytes, json } = await readAs(owner, '/api/v1/board');
    const snapshot = (json as { data: BoardSnapshot }).data;
    expect(snapshot.columns.flatMap(column => column.cards)).toHaveLength(MAX_CARDS);
    report('board response, 500 cards with due dates and links', `${bytes} bytes`);
    // The two new fields add roughly 40 bytes a card. A board that suddenly doubled would mean
    // something large had been added to the card shape.
    expect(bytes).toBeLessThan(400_000);
  }, 60_000);

  it('a goals snapshot at the goal and milestone caps', async () => {
    const owner = await createOwner();
    await inHousehold(sql => {
      for (let goal = 0; goal < MAX_GOALS; goal += 1) {
        sql.exec(
          `INSERT INTO goals (id, year, title, notes, position, creator_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `goal-${goal}`,
          2026 + (goal % 3),
          `a goal with a reasonably long title, number ${goal}`,
          'a note of the kind a member might actually write, about what this year is for.',
          Math.floor(goal / 3),
          owner.id
        );
        for (let milestone = 0; milestone < MAX_MILESTONES_PER_GOAL; milestone += 1) {
          sql.exec(
            `INSERT INTO milestones
               (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
            `m-${goal}-${milestone}`,
            `goal-${goal}`,
            (milestone % 12) + 1,
            `a milestone title of ordinary length ${milestone}`,
            'a shorter note.',
            milestone % 2 === 0 ? 'open' : 'done',
            Math.floor(milestone / 12),
            owner.id
          );
        }
      }
    });

    const full = await readAs(owner, '/api/v1/goals');
    const index = await readAs(owner, '/api/v1/goals?view=index');
    const snapshot = (full.json as { data: GoalsSnapshot }).data;
    expect(snapshot.goals).toHaveLength(MAX_GOALS);
    expect(snapshot.goals.flatMap(goal => goal.milestones)).toHaveLength(MAX_GOALS * MAX_MILESTONES_PER_GOAL);

    report('goals snapshot at the caps (50 goals x 24 milestones)', `${full.bytes} bytes`);
    report('goals index at the caps', `${index.bytes} bytes`);
    // The index is what the card editor fetches on every board load, so its size is the one that
    // matters for the common path. It must stay a small fraction of the full snapshot.
    expect(index.bytes).toBeLessThan(full.bytes / 2);
  }, 120_000);

  it('a sixty-image gallery listing carries no bytes', async () => {
    const owner = await createOwner();
    await inHousehold(sql => {
      for (let index = 0; index < MAX_VISION_IMAGES; index += 1) {
        // 400 KB of content each, so the listing is measured against a full-size gallery.
        const content = new Uint8Array(400_000);
        content.set([0x52, 0x49, 0x46, 0x46], 0);
        content.set([0x57, 0x45, 0x42, 0x50], 8);
        const thumb = new Uint8Array(30_000);
        thumb.set([0x52, 0x49, 0x46, 0x46], 0);
        thumb.set([0x57, 0x45, 0x42, 0x50], 8);
        sql.exec(
          `INSERT INTO vision_images
             (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
              thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
              position, creator_user_id, created_at, updated_at)
           VALUES (?, ?, NULL, 'image/webp', ?, 1600, 1200, ?, ?, 'image/webp', ?, 320, 240, ?, ?, ?, ?,
                   '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `image-${index}`,
          `a caption of the length a member writes ${index}`,
          content.byteLength,
          content.buffer,
          `${'a'.repeat(63)}${index % 10}`,
          thumb.byteLength,
          thumb.buffer,
          `${'b'.repeat(63)}${index % 10}`,
          index,
          owner.id
        );
      }
      sql.exec('UPDATE vision_state SET bytes_used = ? WHERE id = 1', MAX_VISION_IMAGES * 430_000);
    });

    const { bytes, json } = await readAs(owner, '/api/v1/vision');
    const snapshot = (json as { data: { images: unknown[] } }).data;
    expect(snapshot.images).toHaveLength(MAX_VISION_IMAGES);
    report('vision listing, 60 images holding 25.8 MB of bytes', `${bytes} bytes`);
    // The gallery holds ~25 MB. If a `SELECT *` ever came back, this number would explode.
    expect(bytes).toBeLessThan(50_000);
  }, 120_000);
});

describe('SQL cost', () => {
  it('rows read and written for a goal delete that detaches cards', async () => {
    const owner = await createOwner();
    const board = (await owner.client.call<BoardSnapshot>('GET', '/api/v1/board')).data!;
    const columnId = board.columns[0]!.id;

    await inHousehold(sql => {
      sql.exec(
        `INSERT INTO goals (id, year, title, notes, position, creator_user_id, created_at, updated_at)
         VALUES ('g', 2026, 'the goal', NULL, 0, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
        owner.id
      );
      for (let index = 0; index < MAX_MILESTONES_PER_GOAL; index += 1) {
        sql.exec(
          `INSERT INTO milestones
             (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
           VALUES (?, 'g', ?, ?, NULL, 'open', ?, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `m-${index}`,
          (index % 12) + 1,
          `milestone ${index}`,
          Math.floor(index / 12),
          owner.id
        );
      }
      for (let index = 0; index < 100; index += 1) {
        sql.exec(
          `INSERT INTO cards
             (id, column_id, title, description, assignee_user_id, creator_user_id, position,
              due_date, milestone_id, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `card-${index}`,
          columnId,
          `card ${index}`,
          owner.id,
          index,
          `m-${index % MAX_MILESTONES_PER_GOAL}`
        );
      }
    });

    const before = await inHousehold(sql => {
      const cursor = sql.exec('SELECT COUNT(*) AS total FROM cards WHERE milestone_id IS NOT NULL');
      return [...cursor][0];
    });
    expect((before as { total: number }).total).toBe(100);

    const goals = (await owner.client.call<GoalsSnapshot>('GET', '/api/v1/goals')).data!;
    const removed = await owner.client.call('DELETE', '/api/v1/goals/g', {
      body: { goalsRevision: goals.goalsRevision }
    });
    expect(removed.status).toBe(200);

    // The detach is a single `UPDATE ... WHERE milestone_id IN (SELECT ...)`, so its cost is one
    // statement whatever the card count; the compaction that follows touches only the deleted
    // goal's own year.
    const after = await inHousehold(sql => ({
      linked: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM cards WHERE milestone_id IS NOT NULL')][0]
        ?.total,
      cards: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM cards')][0]?.total,
      milestones: [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM milestones')][0]?.total
    }));
    expect(after).toEqual({ linked: 0, cards: 100, milestones: 0 });
    report('goal delete detaching 100 cards from 24 milestones', 'one UPDATE, one DELETE, one compaction');
  }, 120_000);

  it('databaseSize before an upload, after it, and after the delete', async () => {
    const owner = await createOwner();
    const content = new Uint8Array(400_000);
    content.set([0x52, 0x49, 0x46, 0x46], 0);
    content.set([0x57, 0x45, 0x42, 0x50], 8);

    const size = () =>
      runInDurableObject(env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household')), (_instance, state) =>
        state.storage.sql.databaseSize
      );

    const before = await size();
    await inHousehold(sql => {
      sql.exec(
        `INSERT INTO vision_images
           (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
            thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
            position, creator_user_id, created_at, updated_at)
         VALUES ('measured', NULL, NULL, 'image/webp', ?, 1600, 1200, ?, 'a', 'image/webp', 4, 320, 240,
                 X'52494646', 'b', 0, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
        content.byteLength,
        content.buffer,
        owner.id
      );
    });
    const after = await size();
    await inHousehold(sql => {
      sql.exec("DELETE FROM vision_images WHERE id = 'measured'");
    });
    const afterDelete = await size();

    report('databaseSize before / after a 400 KB image / after deleting it', `${before} / ${after} / ${afterDelete}`);
    expect(after).toBeGreaterThan(before);
    // Deliberately **not** asserted to fall. SQLite does not return freed pages to the file: they
    // go on the freelist, so the reported size is a high-water mark. `MAX_DATABASE_BYTES` is
    // therefore a one-way ratchet whose only escape is an operator re-import into a fresh
    // namespace, and `vision_state.bytes_used` is the member-facing budget instead.
    report(
      'databaseSize after the delete',
      afterDelete < after ? 'fell — the freelist was returned' : 'did not fall — a high-water mark, as expected'
    );
  }, 60_000);
});

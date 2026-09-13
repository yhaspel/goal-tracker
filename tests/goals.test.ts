import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  BoardMutationResponse,
  BoardSnapshot,
  GoalsIndex,
  GoalsMutationResponse,
  GoalsSnapshot,
  VisionSnapshot
} from '../shared/api';
import { MAX_GOALS, MAX_MILESTONES, MAX_MILESTONES_PER_GOAL } from '../worker/src/goals/repository';
import { ApiClient } from './helpers/auth-client';
import { inHousehold } from './helpers/durable';
import { type Account, addMember, createOwner, setAllowed } from './helpers/household';

const OWNER = 'owner@example.test';
const ALICE = 'alice@example.test';

beforeEach(async () => {
  await reset();
});

async function goals(account: Account): Promise<GoalsSnapshot> {
  const result = await account.client.call<GoalsSnapshot>('GET', '/api/v1/goals');
  if (!result.data) throw new Error(`goals read failed: ${result.status} ${result.error?.code}`);
  return result.data;
}

async function board(account: Account): Promise<BoardSnapshot> {
  const result = await account.client.call<BoardSnapshot>('GET', '/api/v1/board');
  if (!result.data) throw new Error(`board read failed: ${result.status} ${result.error?.code}`);
  return result.data;
}

async function addGoal(account: Account, year: number, title: string, extra: Record<string, unknown> = {}) {
  const current = await goals(account);
  const result = await account.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
    body: { goalsRevision: current.goalsRevision, year, title, ...extra }
  });
  if (!result.data?.id) throw new Error(`goal create failed: ${result.status} ${result.error?.code}`);
  return result.data.id;
}

async function addMilestone(account: Account, goalId: string, month: number, title: string) {
  const current = await goals(account);
  const result = await account.client.call<GoalsMutationResponse>('POST', '/api/v1/milestones', {
    body: { goalsRevision: current.goalsRevision, goalId, month, title }
  });
  if (!result.data?.id) throw new Error(`milestone create failed: ${result.status} ${result.error?.code}`);
  return result.data.id;
}

async function mutate<T = GoalsMutationResponse>(
  account: Account,
  method: string,
  path: string,
  body: Record<string, unknown> = {}
) {
  const current = await goals(account);
  return account.client.call<T>(method, path, { body: { goalsRevision: current.goalsRevision, ...body } });
}

/** Every committed state must satisfy these, whatever sequence produced it. */
function assertInvariants(state: GoalsSnapshot): void {
  const byYear = new Map<number, string[]>();
  for (const goal of state.goals) {
    const bucket = byYear.get(goal.year) ?? [];
    bucket.push(goal.id);
    byYear.set(goal.year, bucket);
  }
  for (const [year, ids] of byYear) {
    const positions = state.goals.filter(goal => goal.year === year).map(goal => goal.position);
    expect(positions, `year ${year}`).toEqual(ids.map((_, index) => index));
  }

  const goalIds = new Set(state.goals.map(goal => goal.id));
  expect(goalIds.size).toBe(state.goals.length);

  const milestoneIds = new Set<string>();
  for (const goal of state.goals) {
    const byMonth = new Map<number, number[]>();
    for (const milestone of goal.milestones) {
      expect(milestone.goalId).toBe(goal.id);
      expect(milestoneIds.has(milestone.id)).toBe(false);
      milestoneIds.add(milestone.id);
      const bucket = byMonth.get(milestone.month) ?? [];
      bucket.push(milestone.position);
      byMonth.set(milestone.month, bucket);
    }
    for (const [month, positions] of byMonth) {
      expect(positions, `goal ${goal.id} month ${month}`).toEqual(positions.map((_, index) => index));
    }
  }
}

describe('goals read and create', () => {
  it('starts empty and appends each goal at the end of its year', async () => {
    const owner = await createOwner(OWNER);
    const empty = await goals(owner);
    expect(empty.goals).toEqual([]);
    expect(empty.goalsRevision).toBe(1);

    await addGoal(owner, 2026, 'first');
    await addGoal(owner, 2026, 'second');
    await addGoal(owner, 2027, 'other year');

    const state = await goals(owner);
    expect(state.goals.map(goal => [goal.year, goal.position, goal.title])).toEqual([
      [2026, 0, 'first'],
      [2026, 1, 'second'],
      [2027, 0, 'other year']
    ]);
    expect(state.goalsRevision).toBe(4);
    assertInvariants(state);
  });

  it('carries the board revision in the same snapshot as the goals', async () => {
    const owner = await createOwner(OWNER);
    const state = await goals(owner);
    expect(state.boardRevision).toBe((await board(owner)).boardRevision);
  });

  it('serves a compact index with no notes and no card links', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it', { notes: 'private detail' });
    await addMilestone(owner, goalId, 4, 'first cut');

    const result = await owner.client.call<GoalsIndex>('GET', '/api/v1/goals?view=index');
    expect(result.status).toBe(200);
    expect(result.data?.goals).toEqual([{ id: goalId, year: 2026, title: 'ship it' }]);
    expect(result.data?.milestones[0]).toMatchObject({ goalId, month: 4, title: 'first cut', status: 'open' });
    expect(JSON.stringify(result.data)).not.toContain('private detail');
  });

  it('refuses every query parameter shape but a bare read and exactly view=index', async () => {
    const owner = await createOwner(OWNER);
    for (const query of ['?view=', '?view=all', '?view=index&x=1', '?view=index&view=evil', '?x=1']) {
      const result = await owner.client.call<GoalsSnapshot>('GET', `/api/v1/goals${query}`);
      expect(result.status, query).toBe(400);
      expect(result.error?.code, query).toBe('invalid_request');
    }
  });

  it('rejects an unknown field, a bad year and a bad month', async () => {
    const owner = await createOwner(OWNER);
    const current = await goals(owner);
    const unknown = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
      body: { goalsRevision: current.goalsRevision, year: 2026, title: 'x', colour: 'red' }
    });
    expect(unknown.status).toBe(400);

    for (const year of [1999, 3000, 2026.5, '2026', null]) {
      const result = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
        body: { goalsRevision: current.goalsRevision, year, title: 'x' }
      });
      expect(result.status, JSON.stringify(year)).toBe(400);
      expect(
        (result.error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors?.year
      ).toBeDefined();
    }

    const goalId = await addGoal(owner, 2026, 'anchor');
    for (const month of [0, 13, 1.5, '3']) {
      const result = await mutate(owner, 'POST', '/api/v1/milestones', { goalId, month, title: 'x' });
      expect(result.status, JSON.stringify(month)).toBe(400);
    }
  });

  it('bounds notes at 1,000 code points', async () => {
    const owner = await createOwner(OWNER);
    const current = await goals(owner);
    const result = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
      body: { goalsRevision: current.goalsRevision, year: 2026, title: 'x', notes: 'א'.repeat(1001) }
    });
    expect(result.status).toBe(400);
    expect(
      (result.error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors?.notes
    ).toBe('too_long');

    const ok = await addGoal(owner, 2026, 'y', { notes: '😀'.repeat(1000) });
    expect((await goals(owner)).goals.find(goal => goal.id === ok)?.notes).toHaveLength(2000);
  });
});

describe('goal ordering', () => {
  it('moves to the first, last and middle slot and keeps positions dense', async () => {
    const owner = await createOwner(OWNER);
    const a = await addGoal(owner, 2026, 'a');
    const b = await addGoal(owner, 2026, 'b');
    const c = await addGoal(owner, 2026, 'c');

    await mutate(owner, 'POST', `/api/v1/goals/${c}/move`, { targetIndex: 0 });
    expect((await goals(owner)).goals.map(goal => goal.title)).toEqual(['c', 'a', 'b']);

    await mutate(owner, 'POST', `/api/v1/goals/${c}/move`, { targetIndex: 2 });
    expect((await goals(owner)).goals.map(goal => goal.title)).toEqual(['a', 'b', 'c']);

    await mutate(owner, 'POST', `/api/v1/goals/${a}/move`, { targetIndex: 1 });
    const state = await goals(owner);
    expect(state.goals.map(goal => goal.title)).toEqual(['b', 'a', 'c']);
    assertInvariants(state);
    expect(b).toBeTruthy();
  });

  it('reports a move that changes nothing as unchanged, without advancing the revision', async () => {
    const owner = await createOwner(OWNER);
    const a = await addGoal(owner, 2026, 'a');
    await addGoal(owner, 2026, 'b');
    const before = (await goals(owner)).goalsRevision;

    const result = await mutate(owner, 'POST', `/api/v1/goals/${a}/move`, { targetIndex: 0 });
    expect(result.data?.unchanged).toBe(true);
    expect((await goals(owner)).goalsRevision).toBe(before);
  });

  it('refuses an out-of-range or non-integer target index', async () => {
    const owner = await createOwner(OWNER);
    const a = await addGoal(owner, 2026, 'a');
    for (const index of [1, -1, 1.5, '0', null, Number.MAX_SAFE_INTEGER]) {
      const result = await mutate(owner, 'POST', `/api/v1/goals/${a}/move`, { targetIndex: index });
      expect(result.status, JSON.stringify(index)).toBe(400);
    }
  });

  it('ordering is per year: a move in one year cannot disturb another', async () => {
    const owner = await createOwner(OWNER);
    await addGoal(owner, 2026, 'a26');
    const b26 = await addGoal(owner, 2026, 'b26');
    await addGoal(owner, 2027, 'a27');
    await addGoal(owner, 2027, 'b27');

    await mutate(owner, 'POST', `/api/v1/goals/${b26}/move`, { targetIndex: 0 });
    const state = await goals(owner);
    expect(state.goals.filter(goal => goal.year === 2026).map(goal => goal.title)).toEqual(['b26', 'a26']);
    expect(state.goals.filter(goal => goal.year === 2027).map(goal => goal.title)).toEqual(['a27', 'b27']);
    assertInvariants(state);
  });
});

describe('goal edits', () => {
  it('moves a goal to the end of a new year and compacts the one it left', async () => {
    const owner = await createOwner(OWNER);
    const a = await addGoal(owner, 2026, 'a');
    const b = await addGoal(owner, 2026, 'b');
    await addGoal(owner, 2026, 'c');
    await addGoal(owner, 2027, 'existing');

    await mutate(owner, 'PATCH', `/api/v1/goals/${b}`, { year: 2027 });
    const state = await goals(owner);
    expect(state.goals.filter(goal => goal.year === 2026).map(goal => [goal.title, goal.position])).toEqual([
      ['a', 0],
      ['c', 1]
    ]);
    expect(state.goals.filter(goal => goal.year === 2027).map(goal => [goal.title, goal.position])).toEqual([
      ['existing', 0],
      ['b', 1]
    ]);
    assertInvariants(state);
    expect(a).toBeTruthy();
  });

  it('leaves position alone when a patch resends the current year with a new title', async () => {
    const owner = await createOwner(OWNER);
    await addGoal(owner, 2026, 'a');
    const b = await addGoal(owner, 2026, 'b');
    await addGoal(owner, 2026, 'c');

    await mutate(owner, 'PATCH', `/api/v1/goals/${b}`, { year: 2026, title: 'renamed' });
    const state = await goals(owner);
    expect(state.goals.map(goal => [goal.title, goal.position])).toEqual([
      ['a', 0],
      ['renamed', 1],
      ['c', 2]
    ]);
  });

  it('reports an identical patch as unchanged and refuses an empty one', async () => {
    const owner = await createOwner(OWNER);
    const a = await addGoal(owner, 2026, 'a', { notes: 'keep' });
    const before = (await goals(owner)).goalsRevision;

    const same = await mutate(owner, 'PATCH', `/api/v1/goals/${a}`, { title: 'a', notes: 'keep', year: 2026 });
    expect(same.data?.unchanged).toBe(true);
    expect((await goals(owner)).goalsRevision).toBe(before);

    const empty = await mutate(owner, 'PATCH', `/api/v1/goals/${a}`, {});
    expect(empty.status).toBe(400);
  });
});

describe('milestones', () => {
  it('appends within a (goal, month) group and orders independently per group', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    await addMilestone(owner, goalId, 1, 'jan a');
    const janB = await addMilestone(owner, goalId, 1, 'jan b');
    await addMilestone(owner, goalId, 2, 'feb a');

    await mutate(owner, 'POST', `/api/v1/milestones/${janB}/move`, { targetIndex: 0 });
    const state = await goals(owner);
    const milestones = state.goals[0]!.milestones;
    expect(milestones.filter(m => m.month === 1).map(m => [m.title, m.position])).toEqual([
      ['jan b', 0],
      ['jan a', 1]
    ]);
    expect(milestones.filter(m => m.month === 2).map(m => [m.title, m.position])).toEqual([['feb a', 0]]);
    assertInvariants(state);
  });

  it('moves to a new month at the end of that group and compacts the source', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    await addMilestone(owner, goalId, 1, 'a');
    const b = await addMilestone(owner, goalId, 1, 'b');
    await addMilestone(owner, goalId, 1, 'c');
    await addMilestone(owner, goalId, 5, 'existing');

    await mutate(owner, 'PATCH', `/api/v1/milestones/${b}`, { month: 5 });
    const milestones = (await goals(owner)).goals[0]!.milestones;
    expect(milestones.filter(m => m.month === 1).map(m => [m.title, m.position])).toEqual([
      ['a', 0],
      ['c', 1]
    ]);
    expect(milestones.filter(m => m.month === 5).map(m => [m.title, m.position])).toEqual([
      ['existing', 0],
      ['b', 1]
    ]);
  });

  it('moves into an empty month', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    const only = await addMilestone(owner, goalId, 1, 'only');
    await mutate(owner, 'PATCH', `/api/v1/milestones/${only}`, { month: 12 });
    const milestones = (await goals(owner)).goals[0]!.milestones;
    expect(milestones.map(m => [m.month, m.position])).toEqual([[12, 0]]);
  });

  it('starts open, flips to done, and rejects any other status', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    const id = await addMilestone(owner, goalId, 3, 'first cut');
    expect((await goals(owner)).goals[0]!.milestones[0]!.status).toBe('open');

    await mutate(owner, 'PATCH', `/api/v1/milestones/${id}`, { status: 'done' });
    expect((await goals(owner)).goals[0]!.milestones[0]!.status).toBe('done');

    for (const status of ['DONE', 'closed', '', 1, null]) {
      const result = await mutate(owner, 'PATCH', `/api/v1/milestones/${id}`, { status });
      expect(result.status, JSON.stringify(status)).toBe(400);
    }
  });

  it('refuses a milestone on a goal that does not exist', async () => {
    const owner = await createOwner(OWNER);
    const result = await mutate(owner, 'POST', '/api/v1/milestones', {
      goalId: 'no-such-goal',
      month: 1,
      title: 'orphan'
    });
    expect(result.status).toBe(404);
  });

  it('lists the cards serving a milestone, with their column', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    const milestoneId = await addMilestone(owner, goalId, 3, 'first cut');
    const current = await board(owner);
    await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: {
        boardRevision: current.boardRevision,
        columnId: current.columns[1]!.id,
        title: 'do the thing',
        milestoneId
      }
    });

    const linked = (await goals(owner)).goals[0]!.milestones[0]!.cards;
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ title: 'do the thing', columnId: current.columns[1]!.id });
  });
});

describe('caps', () => {
  it('refuses the 51st goal with its own code and writes nothing', async () => {
    const owner = await createOwner(OWNER);
    // Seeded through SQL: fifty HTTP creates would be slow and prove nothing extra. The creator
    // column carries a foreign key, so the rows are attributed to the real owner.
    await inHousehold(sql => {
      for (let index = 0; index < MAX_GOALS; index += 1) {
        sql.exec(
          `INSERT INTO goals (id, year, title, notes, position, creator_user_id, created_at, updated_at)
           VALUES (?, 2026, ?, NULL, ?, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `seed-${index}`,
          `goal ${index}`,
          index,
          owner.id
        );
      }
    });

    const result = await mutate(owner, 'POST', '/api/v1/goals', { year: 2027, title: 'one too many' });
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('goal_limit');
    expect((await goals(owner)).goals).toHaveLength(MAX_GOALS);
  });

  it('refuses the 25th milestone in one goal', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    await inHousehold(sql => {
      for (let index = 0; index < MAX_MILESTONES_PER_GOAL; index += 1) {
        sql.exec(
          `INSERT INTO milestones
             (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
           VALUES (?, ?, 1, ?, NULL, 'open', ?, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `seed-${index}`,
          goalId,
          `milestone ${index}`,
          index,
          owner.id
        );
      }
    });

    const result = await mutate(owner, 'POST', '/api/v1/milestones', { goalId, month: 2, title: 'one too many' });
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('milestone_limit');
  });

  it('refuses the 401st milestone across the whole board, even with room in its goal', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'the one with room');
    await inHousehold(sql => {
      // Spread over enough goals that no single goal reaches its own 24 first, and leave the
      // goal the request targets almost empty, so the global cap is what refuses it.
      for (let index = 0; index < MAX_MILESTONES; index += 1) {
        const owningGoal = index < MAX_MILESTONES - 1 ? `filler-${Math.floor(index / 20)}` : goalId;
        sql.exec(
          `INSERT OR IGNORE INTO goals (id, year, title, notes, position, creator_user_id, created_at, updated_at)
           VALUES (?, 2026, ?, NULL, ?, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          owningGoal,
          owningGoal,
          1000 + Math.floor(index / 20),
          owner.id
        );
        sql.exec(
          `INSERT INTO milestones
             (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 'open', ?, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
          `seed-${index}`,
          owningGoal,
          (index % 12) + 1,
          `milestone ${index}`,
          index % 20,
          owner.id
        );
      }
    });

    const result = await mutate(owner, 'POST', '/api/v1/milestones', { goalId, month: 7, title: 'one too many' });
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('milestone_limit');
    expect(await inHousehold(
      sql => [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM milestones')][0]?.total
    )).toBe(MAX_MILESTONES);
  });
});

describe('deletes and their cascades', () => {
  it('compacts the year after a delete, so a later move does not collide', async () => {
    const owner = await createOwner(OWNER);
    const a = await addGoal(owner, 2026, 'a');
    const b = await addGoal(owner, 2026, 'b');
    const c = await addGoal(owner, 2026, 'c');

    await mutate(owner, 'DELETE', `/api/v1/goals/${b}`);
    const state = await goals(owner);
    expect(state.goals.map(goal => [goal.title, goal.position])).toEqual([
      ['a', 0],
      ['c', 1]
    ]);
    assertInvariants(state);

    await mutate(owner, 'POST', `/api/v1/goals/${c}/move`, { targetIndex: 0 });
    expect((await goals(owner)).goals.map(goal => goal.title)).toEqual(['c', 'a']);
    expect(a).toBeTruthy();
  });

  it('compacts a milestone group after a delete', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    await addMilestone(owner, goalId, 1, 'a');
    const b = await addMilestone(owner, goalId, 1, 'b');
    await addMilestone(owner, goalId, 1, 'c');

    await mutate(owner, 'DELETE', `/api/v1/milestones/${b}`);
    const milestones = (await goals(owner)).goals[0]!.milestones;
    expect(milestones.map(m => [m.title, m.position])).toEqual([
      ['a', 0],
      ['c', 1]
    ]);
  });

  it('deleting a goal removes its milestones, detaches its cards and advances both revisions once', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    const milestoneId = await addMilestone(owner, goalId, 3, 'first cut');
    const before = await board(owner);
    const created = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: before.boardRevision, columnId: before.columns[0]!.id, title: 'linked', milestoneId }
    });
    const boardBefore = created.data!.boardRevision;
    const goalsBefore = (await goals(owner)).goalsRevision;

    const result = await mutate(owner, 'DELETE', `/api/v1/goals/${goalId}`);
    expect(result.status).toBe(200);
    expect(result.data?.goalsRevision).toBe(goalsBefore + 1);

    const after = await board(owner);
    expect(after.boardRevision).toBe(boardBefore + 1);
    expect(after.columns.flatMap(column => column.cards)[0]?.milestoneId).toBeNull();
    expect((await goals(owner)).goals).toEqual([]);
    expect(await inHousehold(
      sql => [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM milestones')][0]?.total
    )).toBe(0);
  });

  it('does not advance the board revision when a deleted goal detached no card', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    await addMilestone(owner, goalId, 3, 'first cut');
    const boardBefore = (await board(owner)).boardRevision;

    await mutate(owner, 'DELETE', `/api/v1/goals/${goalId}`);
    expect((await board(owner)).boardRevision).toBe(boardBefore);
  });

  it('deleting a milestone detaches only its own cards', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    const first = await addMilestone(owner, goalId, 1, 'first');
    const second = await addMilestone(owner, goalId, 2, 'second');

    let current = await board(owner);
    const columnId = current.columns[0]!.id;
    const linkedToFirst = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: current.boardRevision, columnId, title: 'one', milestoneId: first }
    });
    current = await board(owner);
    const linkedToSecond = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: current.boardRevision, columnId, title: 'two', milestoneId: second }
    });

    await mutate(owner, 'DELETE', `/api/v1/milestones/${first}`);
    const cards = (await board(owner)).columns.flatMap(column => column.cards);
    expect(cards.find(card => card.id === linkedToFirst.data!.id)?.milestoneId).toBeNull();
    expect(cards.find(card => card.id === linkedToSecond.data!.id)?.milestoneId).toBe(second);
  });

  it('unlinks vision images pointing at a deleted goal and advances the vision revision once', async () => {
    const owner = await createOwner(OWNER);
    const goalId = await addGoal(owner, 2026, 'ship it');
    // Seeded through SQL: the point here is the cascade, not the upload path.
    await inHousehold(sql => {
      sql.exec(
        `INSERT INTO vision_images
           (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
            thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
            position, creator_user_id, created_at, updated_at)
         VALUES ('img-1', NULL, ?, 'image/webp', 4, 10, 10, X'00010203', 'a', 'image/webp', 4, 5, 5,
                 X'00010203', 'b', 0, ?, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')`,
        goalId,
        owner.id
      );
    });
    const visionBefore = (await owner.client.call<VisionSnapshot>('GET', '/api/v1/vision')).data!.visionRevision;

    await mutate(owner, 'DELETE', `/api/v1/goals/${goalId}`);

    const after = await owner.client.call<VisionSnapshot>('GET', '/api/v1/vision');
    expect(after.data!.visionRevision).toBe(visionBefore + 1);
    expect(after.data!.images[0]!.goalId).toBeNull();
  });
});

describe('authorization and conflicts', () => {
  it('refuses an anonymous caller on every goals route', async () => {
    await createOwner(OWNER);
    const stranger = new ApiClient('203.0.113.99');
    for (const [method, path] of [
      ['GET', '/api/v1/goals'],
      ['POST', '/api/v1/goals'],
      ['PATCH', '/api/v1/goals/whatever'],
      ['DELETE', '/api/v1/goals/whatever'],
      ['POST', '/api/v1/milestones']
    ] as const) {
      const result = await stranger.call(method, path, { body: method === 'GET' ? undefined : {} });
      expect(result.status, `${method} ${path}`).toBe(401);
    }
  });

  it('refuses a mutation without an Origin or without the CSRF token', async () => {
    const owner = await createOwner(OWNER);
    const current = await goals(owner);
    const noOrigin = await owner.client.call('POST', '/api/v1/goals', {
      body: { goalsRevision: current.goalsRevision, year: 2026, title: 'x' },
      origin: null
    });
    expect(noOrigin.status).toBe(403);

    const noCsrf = await owner.client.call('POST', '/api/v1/goals', {
      body: { goalsRevision: current.goalsRevision, year: 2026, title: 'x' },
      csrf: null
    });
    expect(noCsrf.status).toBe(403);
  });

  it('refuses a member whose address left the allowed list, between read and write', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const current = await goals(alice);
    await setAllowed(owner, [OWNER]);

    const result = await alice.client.call('POST', '/api/v1/goals', {
      body: { goalsRevision: current.goalsRevision, year: 2026, title: 'x' }
    });
    expect(result.status).toBe(401);
    expect((await goals(owner)).goals).toEqual([]);
  });

  it('gives a stale writer a 409 carrying the current goals revision, with no partial write', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const stale = (await goals(alice)).goalsRevision;
    await addGoal(owner, 2026, 'winner');

    const result = await alice.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
      body: { goalsRevision: stale, year: 2026, title: 'loser' }
    });
    expect(result.status).toBe(409);
    expect(result.error?.code).toBe('revision_conflict');
    expect((result.error?.details as { goalsRevision?: number } | undefined)?.goalsRevision).toBe(stale + 1);

    const state = await goals(owner);
    expect(state.goals.map(goal => goal.title)).toEqual(['winner']);
  });

  it('a goal change does not give a card editor a 409', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const current = await board(alice);
    await addGoal(owner, 2026, 'unrelated');

    const result = await alice.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: current.boardRevision, columnId: current.columns[0]!.id, title: 'still fine' }
    });
    expect(result.status).toBe(200);
  });

  it('an ordinary member may create, edit and delete a goal — this is not owner-only', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const goalId = await addGoal(alice, 2026, 'alice goal');
    await mutate(alice, 'PATCH', `/api/v1/goals/${goalId}`, { title: 'alice renamed' });
    expect((await goals(owner)).goals[0]!.title).toBe('alice renamed');
    const removed = await mutate(alice, 'DELETE', `/api/v1/goals/${goalId}`);
    expect(removed.status).toBe(200);
  });

  it('answers an unknown method with 405 and an unknown id with 404', async () => {
    const owner = await createOwner(OWNER);
    const put = await owner.client.call('PUT', '/api/v1/goals', { body: {} });
    expect(put.status).toBe(405);
    const missing = await mutate(owner, 'PATCH', '/api/v1/goals/nope', { title: 'x' });
    expect(missing.status).toBe(404);
  });
});

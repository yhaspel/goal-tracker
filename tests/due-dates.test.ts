import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardMutationResponse, BoardSnapshot, GoalsMutationResponse } from '../shared/api';
import { type Account, createOwner } from './helpers/household';

/**
 * The due date and the milestone link on a card.
 *
 * A due date is a calendar day, never an instant: the server stores the string verbatim and never
 * compares it to the current time, which is what makes a card due today read as due rather than
 * overdue for a household at UTC+3 at one in the morning.
 */

beforeEach(async () => {
  await reset();
});

async function snapshot(account: Account): Promise<BoardSnapshot> {
  const result = await account.client.call<BoardSnapshot>('GET', '/api/v1/board');
  if (!result.data) throw new Error(`board read failed: ${result.status} ${result.error?.code}`);
  return result.data;
}

function findCard(board: BoardSnapshot, id: string) {
  return board.columns.flatMap(column => column.cards).find(card => card.id === id);
}

async function createCard(account: Account, extra: Record<string, unknown> = {}) {
  const board = await snapshot(account);
  const result = await account.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
    body: { boardRevision: board.boardRevision, columnId: board.columns[0]!.id, title: 'card', ...extra }
  });
  return result;
}

async function patchCard(account: Account, id: string, body: Record<string, unknown>) {
  const board = await snapshot(account);
  return account.client.call<BoardMutationResponse>('PATCH', `/api/v1/cards/${id}`, {
    body: { boardRevision: board.boardRevision, ...body }
  });
}

describe('due dates', () => {
  it('takes, keeps, changes and clears a date across a reload', async () => {
    const owner = await createOwner();
    const created = await createCard(owner, { dueDate: '2026-12-31' });
    const id = created.data!.id!;
    expect(findCard(await snapshot(owner), id)?.dueDate).toBe('2026-12-31');

    await patchCard(owner, id, { dueDate: '2027-01-01' });
    expect(findCard(await snapshot(owner), id)?.dueDate).toBe('2027-01-01');

    await patchCard(owner, id, { dueDate: null });
    expect(findCard(await snapshot(owner), id)?.dueDate).toBeNull();
  });

  it('refuses every malformed date with a field error and writes nothing', async () => {
    const owner = await createOwner();
    const created = await createCard(owner, { dueDate: '2026-06-01' });
    const id = created.data!.id!;
    const before = await snapshot(owner);

    for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', '1999-12-31', '3000-01-01', 7, true]) {
      const result = await patchCard(owner, id, { dueDate: bad });
      expect(result.status, JSON.stringify(bad)).toBe(400);
      expect(result.error?.code).toBe('invalid_request');
      expect(
        (result.error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors?.dueDate,
        JSON.stringify(bad)
      ).toBeDefined();
    }

    const after = await snapshot(owner);
    expect(after.boardRevision).toBe(before.boardRevision);
    expect(findCard(after, id)?.dueDate).toBe('2026-06-01');
  });

  it('accepts a leap day in a leap year and refuses it in a common one', async () => {
    const owner = await createOwner();
    const created = await createCard(owner);
    const id = created.data!.id!;

    expect((await patchCard(owner, id, { dueDate: '2028-02-29' })).status).toBe(200);
    expect(findCard(await snapshot(owner), id)?.dueDate).toBe('2028-02-29');
    expect((await patchCard(owner, id, { dueDate: '2027-02-29' })).status).toBe(400);
  });

  it('advances the revision once for a change and reports an identical date as unchanged', async () => {
    const owner = await createOwner();
    const created = await createCard(owner);
    const id = created.data!.id!;
    const before = (await snapshot(owner)).boardRevision;

    const first = await patchCard(owner, id, { dueDate: '2026-10-05' });
    expect(first.data?.boardRevision).toBe(before + 1);

    const again = await patchCard(owner, id, { dueDate: '2026-10-05' });
    expect(again.data?.unchanged).toBe(true);
    expect(again.data?.boardRevision).toBe(before + 1);
  });

  it('preserves an omitted field: a title-only edit keeps the date and the link', async () => {
    const owner = await createOwner();
    const board = await snapshot(owner);
    const goal = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
      body: { goalsRevision: 1, year: 2026, title: 'ship it' }
    });
    const milestone = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/milestones', {
      body: { goalsRevision: goal.data!.goalsRevision, goalId: goal.data!.id, month: 3, title: 'first cut' }
    });
    const created = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: {
        boardRevision: board.boardRevision,
        columnId: board.columns[0]!.id,
        title: 'card',
        dueDate: '2026-03-15',
        milestoneId: milestone.data!.id,
        assigneeUserId: owner.id
      }
    });
    const id = created.data!.id!;

    await patchCard(owner, id, { title: 'renamed' });
    const afterTitle = findCard(await snapshot(owner), id);
    expect(afterTitle?.title).toBe('renamed');
    expect(afterTitle?.dueDate).toBe('2026-03-15');
    expect(afterTitle?.milestoneId).toBe(milestone.data!.id);
    expect(afterTitle?.assigneeUserId).toBe(owner.id);

    // ...and editing only the date leaves the assignee alone.
    await patchCard(owner, id, { dueDate: '2026-04-01' });
    const afterDate = findCard(await snapshot(owner), id);
    expect(afterDate?.assigneeUserId).toBe(owner.id);
    expect(afterDate?.milestoneId).toBe(milestone.data!.id);
  });
});

describe('milestone links on a card', () => {
  it('refuses a link to a milestone that does not exist', async () => {
    const owner = await createOwner();
    const created = await createCard(owner, { milestoneId: 'not-a-milestone' });
    expect(created.status).toBe(400);
    expect(
      (created.error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors?.milestoneId
    ).toBe('invalid');
    expect((await snapshot(owner)).columns.flatMap(column => column.cards)).toHaveLength(0);
  });

  it('clears a link with an explicit null without touching anything else', async () => {
    const owner = await createOwner();
    const goal = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
      body: { goalsRevision: 1, year: 2026, title: 'ship it' }
    });
    const milestone = await owner.client.call<GoalsMutationResponse>('POST', '/api/v1/milestones', {
      body: { goalsRevision: goal.data!.goalsRevision, goalId: goal.data!.id, month: 3, title: 'first cut' }
    });
    const created = await createCard(owner, { milestoneId: milestone.data!.id, dueDate: '2026-03-15' });
    const id = created.data!.id!;

    await patchCard(owner, id, { milestoneId: null });
    const after = findCard(await snapshot(owner), id);
    expect(after?.milestoneId).toBeNull();
    expect(after?.dueDate).toBe('2026-03-15');
  });

  it('rejects an unknown field on a card mutation', async () => {
    const owner = await createOwner();
    const created = await createCard(owner);
    const result = await patchCard(owner, created.data!.id!, { dueDate: '2026-01-01', overdue: true });
    expect(result.status).toBe(400);
    expect(result.error?.code).toBe('invalid_request');
  });
});

import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardSnapshot, GoalsMutationResponse, GoalsSnapshot, VisionSnapshot } from '../shared/api';
import { type Account, addMember, createOwner } from './helpers/household';

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

async function addGoal(account: Account, year: number, title: string): Promise<string> {
  const current = await goals(account);
  const result = await account.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
    body: { goalsRevision: current.goalsRevision, year, title }
  });
  if (!result.data?.id) throw new Error(`goal create failed: ${result.status} ${result.error?.code}`);
  return result.data.id;
}

async function addMilestone(account: Account, goalId: string, month: number, title: string): Promise<string> {
  const current = await goals(account);
  const result = await account.client.call<GoalsMutationResponse>('POST', '/api/v1/milestones', {
    body: { goalsRevision: current.goalsRevision, goalId, month, title }
  });
  if (!result.data?.id) throw new Error(`milestone create failed: ${result.status} ${result.error?.code}`);
  return result.data.id;
}

/** Positions are dense within each year and within each `(goal, month)` group, always. */
function assertInvariants(state: GoalsSnapshot): void {
  const years = new Set(state.goals.map(goal => goal.year));
  for (const year of years) {
    expect(state.goals.filter(goal => goal.year === year).map(goal => goal.position)).toEqual(
      state.goals.filter(goal => goal.year === year).map((_, index) => index)
    );
  }
  const ids = new Set<string>();
  for (const goal of state.goals) {
    expect(ids.has(goal.id)).toBe(false);
    ids.add(goal.id);
    const months = new Set(goal.milestones.map(milestone => milestone.month));
    for (const month of months) {
      const group = goal.milestones.filter(milestone => milestone.month === month);
      expect(group.map(milestone => milestone.position)).toEqual(group.map((_, index) => index));
    }
    for (const milestone of goal.milestones) {
      expect(ids.has(milestone.id)).toBe(false);
      ids.add(milestone.id);
      expect(milestone.goalId).toBe(goal.id);
    }
  }
}

describe('goals revision conflicts', () => {
  it('admits exactly one of two creates sharing a revision, with no partial write', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const shared = (await goals(owner)).goalsRevision;

    const results = await Promise.all([
      owner.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
        body: { goalsRevision: shared, year: 2026, title: 'owner goal' }
      }),
      alice.client.call<GoalsMutationResponse>('POST', '/api/v1/goals', {
        body: { goalsRevision: shared, year: 2026, title: 'alice goal' }
      })
    ]);

    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    const loser = results.find(result => result.status !== 200)!;
    expect(loser.status).toBe(409);
    expect(loser.error?.code).toBe('revision_conflict');
    expect(loser.error?.details).toEqual({ goalsRevision: shared + 1 });

    const after = await goals(owner);
    expect(after.goals).toHaveLength(1);
    expect(after.goalsRevision).toBe(shared + 1);
    assertInvariants(after);
  }, 90_000);

  it('admits exactly one of a simultaneous milestone edit and its goal being deleted', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const goalId = await addGoal(owner, 2026, 'contested');
    const milestoneId = await addMilestone(owner, goalId, 5, 'contested milestone');
    const shared = (await goals(owner)).goalsRevision;

    const results = await Promise.all([
      owner.client.call<GoalsMutationResponse>('PATCH', `/api/v1/milestones/${milestoneId}`, {
        body: { goalsRevision: shared, status: 'done' }
      }),
      alice.client.call<GoalsMutationResponse>('DELETE', `/api/v1/goals/${goalId}`, {
        body: { goalsRevision: shared }
      })
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status === 409)).toHaveLength(1);

    const after = await goals(owner);
    expect(after.goalsRevision).toBe(shared + 1);
    assertInvariants(after);
  }, 90_000);

  it('admits exactly one of two moves sharing a revision', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const first = await addGoal(owner, 2026, 'a');
    const second = await addGoal(owner, 2026, 'b');
    await addGoal(owner, 2026, 'c');
    const shared = (await goals(owner)).goalsRevision;

    const results = await Promise.all([
      owner.client.call<GoalsMutationResponse>('POST', `/api/v1/goals/${first}/move`, {
        body: { goalsRevision: shared, targetIndex: 2 }
      }),
      alice.client.call<GoalsMutationResponse>('POST', `/api/v1/goals/${second}/move`, {
        body: { goalsRevision: shared, targetIndex: 0 }
      })
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status === 409)).toHaveLength(1);
    assertInvariants(await goals(owner));
  }, 90_000);
});

describe('the three revisions stay independent', () => {
  it('a vision change does not invalidate a goals writer, and vice versa', async () => {
    const owner = await createOwner(OWNER);
    const goalsBefore = (await goals(owner)).goalsRevision;
    const visionBefore = (await owner.client.call<VisionSnapshot>('GET', '/api/v1/vision')).data!.visionRevision;

    await addGoal(owner, 2026, 'a goal');

    // The goals revision moved; the vision one did not.
    expect((await goals(owner)).goalsRevision).toBe(goalsBefore + 1);
    expect((await owner.client.call<VisionSnapshot>('GET', '/api/v1/vision')).data!.visionRevision).toBe(visionBefore);
  }, 60_000);

  it('a card mutation advances only the board revision', async () => {
    const owner = await createOwner(OWNER);
    const board = (await owner.client.call<BoardSnapshot>('GET', '/api/v1/board')).data!;
    const goalsBefore = (await goals(owner)).goalsRevision;

    await owner.client.call('POST', '/api/v1/cards', {
      body: { boardRevision: board.boardRevision, columnId: board.columns[0]!.id, title: 'unrelated' }
    });

    expect((await owner.client.call<BoardSnapshot>('GET', '/api/v1/board')).data!.boardRevision)
      .toBe(board.boardRevision + 1);
    expect((await goals(owner)).goalsRevision).toBe(goalsBefore);
  }, 60_000);
});

describe('invariants under a randomised sequence', () => {
  it('keeps unique ids, dense positions, and every milestone under an existing goal', async () => {
    const owner = await createOwner(OWNER);
    const goalIds: string[] = [];
    const milestoneIds: string[] = [];

    // A small linear congruential generator keeps the sequence reproducible.
    let seed = 20260913;
    const random = (bound: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };

    for (let step = 0; step < 34; step += 1) {
      const current = await goals(owner);
      const action = goalIds.length === 0 ? 0 : random(6);

      if (action === 0) {
        goalIds.push(await addGoal(owner, 2026 + random(3), `goal-${step}`));
      } else if (action === 1) {
        const goalId = goalIds[random(goalIds.length)]!;
        milestoneIds.push(await addMilestone(owner, goalId, random(12) + 1, `milestone-${step}`));
      } else if (action === 2) {
        const goalId = goalIds[random(goalIds.length)]!;
        const goal = current.goals.find(entry => entry.id === goalId)!;
        const size = current.goals.filter(entry => entry.year === goal.year).length;
        const result = await owner.client.call<GoalsMutationResponse>('POST', `/api/v1/goals/${goalId}/move`, {
          body: { goalsRevision: current.goalsRevision, targetIndex: random(size) }
        });
        expect(result.status, `move goal at step ${step}`).toBe(200);
      } else if (action === 3 && milestoneIds.length > 0) {
        const milestoneId = milestoneIds[random(milestoneIds.length)]!;
        const result = await owner.client.call<GoalsMutationResponse>('PATCH', `/api/v1/milestones/${milestoneId}`, {
          body: { goalsRevision: current.goalsRevision, month: random(12) + 1 }
        });
        expect(result.status, `move milestone at step ${step}`).toBe(200);
      } else if (action === 4 && milestoneIds.length > 0) {
        const index = random(milestoneIds.length);
        const milestoneId = milestoneIds.splice(index, 1)[0]!;
        const result = await owner.client.call<GoalsMutationResponse>('DELETE', `/api/v1/milestones/${milestoneId}`, {
          body: { goalsRevision: current.goalsRevision }
        });
        expect(result.status, `delete milestone at step ${step}`).toBe(200);
      } else if (action === 5) {
        const index = random(goalIds.length);
        const goalId = goalIds.splice(index, 1)[0]!;
        const goal = current.goals.find(entry => entry.id === goalId)!;
        for (const milestone of goal.milestones) {
          const position = milestoneIds.indexOf(milestone.id);
          if (position >= 0) milestoneIds.splice(position, 1);
        }
        const result = await owner.client.call<GoalsMutationResponse>('DELETE', `/api/v1/goals/${goalId}`, {
          body: { goalsRevision: current.goalsRevision }
        });
        expect(result.status, `delete goal at step ${step}`).toBe(200);
      }

      const after = await goals(owner);
      assertInvariants(after);
      expect(after.goals).toHaveLength(goalIds.length);
      expect(after.goals.flatMap(goal => goal.milestones)).toHaveLength(milestoneIds.length);
    }
  }, 180_000);
});

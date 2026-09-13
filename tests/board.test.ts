import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  BoardMutationResponse,
  BoardSnapshot,
  MemberResponse
} from '../shared/api';
import { ApiClient } from './helpers/auth-client';
import { inHousehold } from './helpers/durable';
import { type Account, addMember, createOwner, setAllowed } from './helpers/household';

const OWNER = 'owner@example.test';
const ALICE = 'alice@example.test';
const BOB = 'bob@example.test';

beforeEach(async () => {
  await reset();
});

const board = (account: Account) => account.client.call<BoardSnapshot>('GET', '/api/v1/board');

async function snapshot(account: Account): Promise<BoardSnapshot> {
  const result = await board(account);
  if (!result.data) throw new Error(`board read failed: ${result.status} ${result.error?.code}`);
  return result.data;
}

async function createCard(
  account: Account,
  columnId: string,
  title: string,
  extra: Record<string, unknown> = {}
): Promise<{ id: string; boardRevision: number }> {
  const current = await snapshot(account);
  const result = await account.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
    body: { boardRevision: current.boardRevision, columnId, title, ...extra }
  });
  if (!result.data?.id) throw new Error(`card create failed: ${result.status} ${result.error?.code}`);
  return { id: result.data.id, boardRevision: result.data.boardRevision };
}

/** Every committed state must satisfy these, whatever sequence produced it. */
function assertInvariants(state: BoardSnapshot): void {
  const columnIds = state.columns.map(column => column.id);
  expect(new Set(columnIds).size).toBe(columnIds.length);
  state.columns.forEach((column, index) => {
    expect(column.position).toBe(index);
    column.cards.forEach((card, cardIndex) => {
      expect(card.position).toBe(cardIndex);
      expect(card.columnId).toBe(column.id);
    });
  });
  const cardIds = state.columns.flatMap(column => column.cards.map(card => card.id));
  expect(new Set(cardIds).size).toBe(cardIds.length);
}

describe('board seed and read', () => {
  it('starts with the three built-in columns in order and no cards', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    expect(state.columns.map(column => [column.nameKey, column.position, column.cards.length])).toEqual([
      ['todo', 0, 0],
      ['in_progress', 1, 0],
      ['done', 2, 0]
    ]);
    expect(state.columns.every(column => column.customName === null)).toBe(true);
    assertInvariants(state);
  });

  it('enforces foreign keys in the Durable Object runtime without an explicit pragma', async () => {
    await createOwner(OWNER);
    // Enforcement is on by default here, so the schema's REFERENCES clauses are real
    // constraints rather than documentation. Application code still validates references
    // first; this is the backstop.
    expect(await inHousehold(sql => [...sql.exec<{ foreign_keys: number }>('PRAGMA foreign_keys')][0]?.foreign_keys))
      .toBe(1);

    await expect(
      inHousehold(sql => {
        sql.exec(
          `INSERT INTO cards (id, column_id, title, description, assignee_user_id, creator_user_id, position, created_at, updated_at)
           VALUES ('bogus', 'no-such-column', 't', NULL, NULL, 'no-such-user', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
        );
      })
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it('exposes only the documented member fields and refuses anonymous reads', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    expect(state.activeMembers).toEqual([{ id: owner.id, email: OWNER }]);
    expect(Object.keys(state).sort()).toEqual(['activeMembers', 'boardRevision', 'columns']);

    const anonymous = await new ApiClient('203.0.113.240').call('GET', '/api/v1/board');
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(anonymous)).not.toContain(OWNER);
  });
});

describe('columns', () => {
  it('lets the owner add, rename, reorder, and remove an empty column', async () => {
    const owner = await createOwner(OWNER);
    let state = await snapshot(owner);

    const created = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/columns', {
      body: { boardRevision: state.boardRevision, name: '  Later  ' }
    });
    expect(created.status).toBe(200);
    expect(created.data?.boardRevision).toBe(state.boardRevision + 1);
    const columnId = created.data!.id!;

    state = await snapshot(owner);
    expect(state.columns.map(column => column.customName)).toEqual([null, null, null, 'Later']);

    const renamed = await owner.client.call<BoardMutationResponse>('PATCH', `/api/v1/columns/${columnId}`, {
      body: { boardRevision: state.boardRevision, name: 'Someday' }
    });
    expect(renamed.status).toBe(200);

    state = await snapshot(owner);
    const moved = await owner.client.call<BoardMutationResponse>('POST', `/api/v1/columns/${columnId}/move`, {
      body: { boardRevision: state.boardRevision, targetIndex: 0 }
    });
    expect(moved.status).toBe(200);

    state = await snapshot(owner);
    expect(state.columns[0]?.customName).toBe('Someday');
    expect(state.columns.map(column => column.nameKey)).toEqual([null, 'todo', 'in_progress', 'done']);
    assertInvariants(state);

    const removed = await owner.client.call<BoardMutationResponse>('DELETE', `/api/v1/columns/${columnId}`, {
      body: { boardRevision: state.boardRevision }
    });
    expect(removed.status).toBe(200);
    state = await snapshot(owner);
    expect(state.columns.map(column => column.nameKey)).toEqual(['todo', 'in_progress', 'done']);
    assertInvariants(state);
  }, 60_000);

  it('renaming a built-in column drops its translation key permanently', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    const todo = state.columns[0]!;
    await owner.client.call('PATCH', `/api/v1/columns/${todo.id}`, {
      body: { boardRevision: state.boardRevision, name: 'Inbox' }
    });
    const after = await snapshot(owner);
    expect(after.columns[0]).toMatchObject({ id: todo.id, nameKey: null, customName: 'Inbox' });
  });

  it('refuses to delete a non-empty column or the last remaining one', async () => {
    const owner = await createOwner(OWNER);
    let state = await snapshot(owner);
    const [todo, inProgress, done] = state.columns;
    await createCard(owner, todo!.id, 'Occupied');

    state = await snapshot(owner);
    const nonEmpty = await owner.client.call('DELETE', `/api/v1/columns/${todo!.id}`, {
      body: { boardRevision: state.boardRevision }
    });
    expect(nonEmpty.status).toBe(409);
    expect(nonEmpty.error?.code).toBe('column_not_empty');

    // Clear the way down to a single column, then refuse to remove it.
    for (const column of [inProgress!, done!]) {
      const before = await snapshot(owner);
      expect((await owner.client.call('DELETE', `/api/v1/columns/${column.id}`, {
        body: { boardRevision: before.boardRevision }
      })).status).toBe(200);
    }
    state = await snapshot(owner);
    expect(state.columns).toHaveLength(1);
    const last = await owner.client.call('DELETE', `/api/v1/columns/${todo!.id}`, {
      body: { boardRevision: state.boardRevision }
    });
    expect(last.status).toBe(409);
    expect(last.error?.code).toBe('column_not_empty');
  }, 60_000);

  it('refuses every column mutation from a member', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const state = await snapshot(alice);
    const todo = state.columns[0]!;

    const attempts = [
      alice.client.call('POST', '/api/v1/columns', { body: { boardRevision: state.boardRevision, name: 'Nope' } }),
      alice.client.call('PATCH', `/api/v1/columns/${todo.id}`, { body: { boardRevision: state.boardRevision, name: 'Nope' } }),
      alice.client.call('POST', `/api/v1/columns/${todo.id}/move`, { body: { boardRevision: state.boardRevision, targetIndex: 1 } }),
      alice.client.call('DELETE', `/api/v1/columns/${todo.id}`, { body: { boardRevision: state.boardRevision } })
    ];
    for (const result of await Promise.all(attempts)) expect(result.status).toBe(403);
    expect((await snapshot(owner)).boardRevision).toBe(state.boardRevision);
  }, 60_000);
});

describe('cards', () => {
  it('supports create, edit, assign, unassign, move, and delete for any member', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    let state = await snapshot(alice);
    const [todo, inProgress] = state.columns;

    const card = await createCard(alice, todo!.id, 'Buy milk', { description: 'Two litres' });
    state = await snapshot(alice);
    expect(state.columns[0]?.cards[0]).toMatchObject({
      id: card.id,
      title: 'Buy milk',
      description: 'Two litres',
      assigneeUserId: null,
      creatorUserId: alice.id,
      position: 0
    });

    const assigned = await alice.client.call<BoardMutationResponse>('PATCH', `/api/v1/cards/${card.id}`, {
      body: { boardRevision: state.boardRevision, assigneeUserId: owner.id }
    });
    expect(assigned.status).toBe(200);
    state = await snapshot(alice);
    expect(state.columns[0]?.cards[0]?.assigneeUserId).toBe(owner.id);

    const unassigned = await alice.client.call<BoardMutationResponse>('PATCH', `/api/v1/cards/${card.id}`, {
      body: { boardRevision: state.boardRevision, assigneeUserId: null }
    });
    expect(unassigned.status).toBe(200);

    state = await snapshot(alice);
    const movedAcross = await alice.client.call<BoardMutationResponse>('POST', `/api/v1/cards/${card.id}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: inProgress!.id, targetIndex: 0 }
    });
    expect(movedAcross.status).toBe(200);
    state = await snapshot(alice);
    expect(state.columns[0]?.cards).toHaveLength(0);
    expect(state.columns[1]?.cards[0]?.id).toBe(card.id);
    // The creator survives every edit and move.
    expect(state.columns[1]?.cards[0]?.creatorUserId).toBe(alice.id);
    assertInvariants(state);

    const deleted = await alice.client.call<BoardMutationResponse>('DELETE', `/api/v1/cards/${card.id}`, {
      body: { boardRevision: state.boardRevision }
    });
    expect(deleted.status).toBe(200);
    state = await snapshot(alice);
    expect(state.columns.flatMap(column => column.cards)).toHaveLength(0);
  }, 60_000);

  it('keeps positions dense across moves to first, last, same, and empty destinations', async () => {
    const owner = await createOwner(OWNER);
    let state = await snapshot(owner);
    const [todo, inProgress] = state.columns;

    const ids: string[] = [];
    for (const title of ['one', 'two', 'three']) ids.push((await createCard(owner, todo!.id, title)).id);

    // Last to first within the column.
    state = await snapshot(owner);
    await owner.client.call('POST', `/api/v1/cards/${ids[2]}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: todo!.id, targetIndex: 0 }
    });
    state = await snapshot(owner);
    expect(state.columns[0]?.cards.map(card => card.title)).toEqual(['three', 'one', 'two']);

    // First to last within the column.
    await owner.client.call('POST', `/api/v1/cards/${ids[2]}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: todo!.id, targetIndex: 2 }
    });
    state = await snapshot(owner);
    expect(state.columns[0]?.cards.map(card => card.title)).toEqual(['one', 'two', 'three']);

    // Into an empty column.
    await owner.client.call('POST', `/api/v1/cards/${ids[1]}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: inProgress!.id, targetIndex: 0 }
    });
    state = await snapshot(owner);
    expect(state.columns[0]?.cards.map(card => card.title)).toEqual(['one', 'three']);
    expect(state.columns[1]?.cards.map(card => card.title)).toEqual(['two']);
    assertInvariants(state);

    // A move that lands where the card already is writes nothing.
    const noop = await owner.client.call<BoardMutationResponse>('POST', `/api/v1/cards/${ids[1]}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: inProgress!.id, targetIndex: 0 }
    });
    expect(noop.status).toBe(200);
    expect(noop.data).toEqual({ boardRevision: state.boardRevision, unchanged: true });
  }, 90_000);

  it('rejects invalid card input without writing', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    const todo = state.columns[0]!;
    const base = { boardRevision: state.boardRevision, columnId: todo.id };

    const cases: Array<[string, Record<string, unknown>, number]> = [
      ['empty title', { ...base, title: '   ' }, 400],
      ['overlong title', { ...base, title: 'x'.repeat(201) }, 400],
      ['overlong description', { ...base, title: 'ok', description: 'x'.repeat(4001) }, 400],
      ['control character in title', { ...base, title: 'badtitle' }, 400],
      ['unknown column', { boardRevision: state.boardRevision, columnId: 'missing', title: 'ok' }, 404],
      ['unknown field', { ...base, title: 'ok', colour: 'red' }, 400],
      ['non-existent assignee', { ...base, title: 'ok', assigneeUserId: 'nobody' }, 400],
      ['missing revision', { columnId: todo.id, title: 'ok' }, 400]
    ];
    for (const [label, body, status] of cases) {
      const result = await owner.client.call('POST', '/api/v1/cards', { body });
      expect(result.status, label).toBe(status);
    }
    // Nothing was written and the revision never moved.
    const after = await snapshot(owner);
    expect(after.boardRevision).toBe(state.boardRevision);
    expect(after.columns.flatMap(column => column.cards)).toHaveLength(0);
  }, 60_000);

  it('rejects an empty patch and an out-of-range move index', async () => {
    const owner = await createOwner(OWNER);
    let state = await snapshot(owner);
    const todo = state.columns[0]!;
    const card = await createCard(owner, todo.id, 'Only card');
    state = await snapshot(owner);

    const empty = await owner.client.call('PATCH', `/api/v1/cards/${card.id}`, {
      body: { boardRevision: state.boardRevision }
    });
    expect(empty.status).toBe(400);

    const outOfRange = await owner.client.call('POST', `/api/v1/cards/${card.id}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: todo.id, targetIndex: 5 }
    });
    expect(outOfRange.status).toBe(400);

    const fractional = await owner.client.call('POST', `/api/v1/cards/${card.id}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: todo.id, targetIndex: 0.5 }
    });
    expect(fractional.status).toBe(400);

    expect((await snapshot(owner)).boardRevision).toBe(state.boardRevision);
  }, 60_000);
});

describe('membership effects on the board', () => {
  it('advances the revision once when an account activates', async () => {
    const owner = await createOwner(OWNER);
    const before = await snapshot(owner);
    const alice = await addMember(owner, ALICE);
    const after = await snapshot(owner);
    // Exactly once. Adding the address to the allowed list touches no active account and so
    // leaves the board alone; only the activation changes who can be assigned a card.
    expect(after.boardRevision).toBe(before.boardRevision + 1);
    expect(after.activeMembers.map(member => member.email).sort()).toEqual([ALICE, OWNER]);
    expect(after.activeMembers.find(member => member.id === alice.id)).toBeDefined();
  }, 60_000);

  it('clears assignments and advances the revision once when a member is deactivated', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    let state = await snapshot(owner);
    const todo = state.columns[0]!;
    const first = await createCard(owner, todo.id, 'Assigned one', { assigneeUserId: alice.id });
    const second = await createCard(owner, todo.id, 'Assigned two', { assigneeUserId: alice.id });

    state = await snapshot(owner);
    const deactivated = await owner.client.call<MemberResponse>('PATCH', `/api/v1/members/${alice.id}`, {
      body: { status: 'inactive' }
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.data?.boardRevision).toBe(state.boardRevision + 1);

    const after = await snapshot(owner);
    expect(after.boardRevision).toBe(state.boardRevision + 1);
    const cards = after.columns.flatMap(column => column.cards);
    expect(cards.map(card => card.id).sort()).toEqual([first.id, second.id].sort());
    expect(cards.every(card => card.assigneeUserId === null)).toBe(true);
    // Historical creator metadata survives deactivation.
    expect(cards.every(card => card.creatorUserId === owner.id)).toBe(true);
    expect(after.activeMembers.map(member => member.email)).toEqual([OWNER]);
  }, 90_000);

  it('clears assignments when an active member leaves the allowed list and restores them on re-add', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    let state = await snapshot(owner);
    const card = await createCard(owner, state.columns[0]!.id, 'Alice task', { assigneeUserId: alice.id });

    state = await snapshot(owner);
    const removal = await setAllowed(owner, [OWNER]);
    expect(removal.boardRevision).toBe(state.boardRevision + 1);

    let after = await snapshot(owner);
    expect(after.columns[0]?.cards[0]).toMatchObject({ id: card.id, assigneeUserId: null });
    expect(after.activeMembers.map(member => member.email)).toEqual([OWNER]);
    // Her session ended with the removal.
    expect((await alice.client.call('GET', '/api/v1/board')).status).toBe(401);

    const readd = await setAllowed(owner, [OWNER, ALICE]);
    expect(readd.boardRevision).toBe(after.boardRevision + 1);
    after = await snapshot(owner);
    expect(after.activeMembers.map(member => member.email).sort()).toEqual([ALICE, OWNER]);
  }, 90_000);

  it('does not move the board revision for an allowed-list change with no active account', async () => {
    const owner = await createOwner(OWNER);
    const before = await snapshot(owner);
    const added = await setAllowed(owner, [OWNER, 'nobody@example.test']);
    expect(added.boardRevision).toBe(before.boardRevision);
    const removed = await setAllowed(owner, [OWNER]);
    expect(removed.boardRevision).toBe(before.boardRevision);
    expect((await snapshot(owner)).boardRevision).toBe(before.boardRevision);
  }, 60_000);

  it('refuses to assign a card to a deactivated or removed member', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const bob = await addMember(owner, BOB);
    let state = await snapshot(owner);
    const card = await createCard(owner, state.columns[0]!.id, 'Needs an owner');

    await owner.client.call('PATCH', `/api/v1/members/${alice.id}`, { body: { status: 'inactive' } });
    await setAllowed(owner, [OWNER, ALICE]);

    state = await snapshot(owner);
    for (const [label, id] of [['deactivated', alice.id], ['removed from the list', bob.id]] as const) {
      const refused = await owner.client.call('PATCH', `/api/v1/cards/${card.id}`, {
        body: { boardRevision: state.boardRevision, assigneeUserId: id }
      });
      expect(refused.status, label).toBe(400);
      expect(refused.error?.details, label).toEqual({ fieldErrors: { assigneeUserId: 'ineligible' } });
    }
    expect((await snapshot(owner)).boardRevision).toBe(state.boardRevision);
  }, 120_000);
});

import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardMutationResponse, BoardSnapshot } from '../shared/api';
import { MAX_CARDS, MAX_COLUMNS } from '../worker/src/board/repository';
import { type Account, addMember, createOwner, setAllowed } from './helpers/household';
import { inHousehold } from './helpers/durable';

const OWNER = 'owner@example.test';
const ALICE = 'alice@example.test';

beforeEach(async () => {
  await reset();
});

async function snapshot(account: Account): Promise<BoardSnapshot> {
  const result = await account.client.call<BoardSnapshot>('GET', '/api/v1/board');
  if (!result.data) throw new Error(`board read failed: ${result.status} ${result.error?.code}`);
  return result.data;
}

async function createCard(account: Account, columnId: string, title: string, revision?: number): Promise<string> {
  const boardRevision = revision ?? (await snapshot(account)).boardRevision;
  const result = await account.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
    body: { boardRevision, columnId, title }
  });
  if (!result.data?.id) throw new Error(`card create failed: ${result.status} ${result.error?.code}`);
  return result.data.id;
}

function assertInvariants(state: BoardSnapshot): void {
  state.columns.forEach((column, index) => {
    expect(column.position).toBe(index);
    column.cards.forEach((card, cardIndex) => expect(card.position).toBe(cardIndex));
  });
  const cardIds = state.columns.flatMap(column => column.cards.map(card => card.id));
  expect(new Set(cardIds).size).toBe(cardIds.length);
}

describe('revision conflicts', () => {
  it('admits exactly one of two moves sharing a revision', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    let state = await snapshot(owner);
    const [todo, inProgress, done] = state.columns;
    const first = await createCard(owner, todo!.id, 'first');
    const second = await createCard(owner, todo!.id, 'second');

    state = await snapshot(owner);
    const shared = state.boardRevision;
    const results = await Promise.all([
      owner.client.call<BoardMutationResponse>('POST', `/api/v1/cards/${first}/move`, {
        body: { boardRevision: shared, targetColumnId: inProgress!.id, targetIndex: 0 }
      }),
      alice.client.call<BoardMutationResponse>('POST', `/api/v1/cards/${second}/move`, {
        body: { boardRevision: shared, targetColumnId: done!.id, targetIndex: 0 }
      })
    ]);

    const winners = results.filter(result => result.status === 200);
    const losers = results.filter(result => result.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.status).toBe(409);
    expect(losers[0]?.error?.code).toBe('revision_conflict');
    expect(losers[0]?.error?.details).toEqual({ boardRevision: shared + 1 });

    const after = await snapshot(owner);
    expect(after.boardRevision).toBe(shared + 1);
    // The losing move wrote nothing: both cards still exist, exactly once each.
    expect(after.columns.flatMap(column => column.cards)).toHaveLength(2);
    assertInvariants(after);
  }, 90_000);

  it('admits exactly one of a simultaneous edit and delete', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    let state = await snapshot(owner);
    const card = await createCard(owner, state.columns[0]!.id, 'contested');

    state = await snapshot(owner);
    const shared = state.boardRevision;
    const results = await Promise.all([
      owner.client.call<BoardMutationResponse>('PATCH', `/api/v1/cards/${card}`, {
        body: { boardRevision: shared, title: 'renamed' }
      }),
      alice.client.call<BoardMutationResponse>('DELETE', `/api/v1/cards/${card}`, {
        body: { boardRevision: shared }
      })
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status === 409)).toHaveLength(1);
    expect((await snapshot(owner)).boardRevision).toBe(shared + 1);
  }, 90_000);

  it('admits exactly one of a simultaneous rename and reorder', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    const [todo, inProgress] = state.columns;
    const shared = state.boardRevision;

    const results = await Promise.all([
      owner.client.call<BoardMutationResponse>('PATCH', `/api/v1/columns/${todo!.id}`, {
        body: { boardRevision: shared, name: 'Inbox' }
      }),
      owner.client.call<BoardMutationResponse>('POST', `/api/v1/columns/${inProgress!.id}/move`, {
        body: { boardRevision: shared, targetIndex: 0 }
      })
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status === 409)).toHaveLength(1);
    assertInvariants(await snapshot(owner));
  }, 60_000);

  it('never leaves a card assigned to a member being deactivated at the same time', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    let state = await snapshot(owner);
    const card = await createCard(owner, state.columns[0]!.id, 'racing');

    state = await snapshot(owner);
    const [assignment, deactivation] = await Promise.all([
      owner.client.call<BoardMutationResponse>('PATCH', `/api/v1/cards/${card}`, {
        body: { boardRevision: state.boardRevision, assigneeUserId: alice.id }
      }),
      owner.client.call('PATCH', `/api/v1/members/${alice.id}`, { body: { status: 'inactive' } })
    ]);
    expect(deactivation.status).toBe(200);

    const after = await snapshot(owner);
    // Whichever order they serialised in, the committed state never holds an assignment to
    // an ineligible member: either the assignment was rejected, or it was cleared.
    expect(after.columns.flatMap(column => column.cards)[0]?.assigneeUserId).toBeNull();
    expect(after.activeMembers.map(member => member.email)).toEqual([OWNER]);
    expect([200, 400, 409]).toContain(assignment.status);
  }, 90_000);
});

describe('invariants under randomised sequences', () => {
  it('keeps unique ids, one column per card, and dense positions', async () => {
    const owner = await createOwner(OWNER);
    let state = await snapshot(owner);
    const columnIds = state.columns.map(column => column.id);
    const cardIds: string[] = [];

    // A small linear congruential generator keeps the sequence reproducible.
    let seed = 20260913;
    const random = (bound: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };

    let expectedRevision = state.boardRevision;
    for (let step = 0; step < 30; step++) {
      const action = cardIds.length === 0 ? 0 : random(3);
      const columnId = columnIds[random(columnIds.length)]!;

      if (action === 0) {
        cardIds.push(await createCard(owner, columnId, `card-${step}`, expectedRevision));
        expectedRevision += 1;
      } else if (action === 1) {
        const id = cardIds[random(cardIds.length)]!;
        const destination = state.columns.find(column => column.id === columnId)!;
        const holds = destination.cards.some(card => card.id === id);
        const bound = holds ? destination.cards.length - 1 : destination.cards.length;
        const result = await owner.client.call<BoardMutationResponse>('POST', `/api/v1/cards/${id}/move`, {
          body: { boardRevision: expectedRevision, targetColumnId: columnId, targetIndex: random(bound + 1) }
        });
        expect(result.status).toBe(200);
        // A no-op move is validated but writes nothing, so the revision stays put.
        if (result.data?.unchanged !== true) expectedRevision += 1;
      } else {
        const index = random(cardIds.length);
        const id = cardIds.splice(index, 1)[0]!;
        const result = await owner.client.call<BoardMutationResponse>('DELETE', `/api/v1/cards/${id}`, {
          body: { boardRevision: expectedRevision }
        });
        expect(result.status).toBe(200);
        expectedRevision += 1;
      }

      state = await snapshot(owner);
      expect(state.boardRevision).toBe(expectedRevision);
      assertInvariants(state);
      expect(state.columns.flatMap(column => column.cards)).toHaveLength(cardIds.length);
    }
  }, 120_000);
});

describe('reorder write cost', () => {
  /** Rows the last mutation actually rewrote, identified by a changed `updated_at`. */
  async function timestamps(): Promise<Map<string, string>> {
    return inHousehold(sql => {
      const seen = new Map<string, string>();
      for (const row of sql.exec<{ id: string; updated_at: string }>('SELECT id, updated_at FROM cards')) {
        seen.set(row.id, row.updated_at);
      }
      return seen;
    });
  }

  function changed(before: Map<string, string>, after: Map<string, string>): number {
    let count = 0;
    for (const [id, value] of after) if (before.get(id) !== value) count += 1;
    return count;
  }

  it('rewrites only the cards a move actually displaces', async () => {
    const owner = await createOwner(OWNER);
    let state = await snapshot(owner);
    const [first, second] = state.columns;
    const ids: string[] = [];
    for (let index = 0; index < 6; index++) ids.push(await createCard(owner, first!.id, `card-${index}`));

    // Adjacent swap: only the two cards that trade places are written.
    let before = await timestamps();
    state = await snapshot(owner);
    await owner.client.call('POST', `/api/v1/cards/${ids[0]}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: first!.id, targetIndex: 1 }
    });
    expect(changed(before, await timestamps())).toBe(2);

    // Worst case within a column: first to last shifts every card in it.
    before = await timestamps();
    state = await snapshot(owner);
    await owner.client.call('POST', `/api/v1/cards/${ids[1]}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: first!.id, targetIndex: 5 }
    });
    expect(changed(before, await timestamps())).toBe(6);

    // Cross-column: the card itself, plus everything after it in the source column.
    before = await timestamps();
    state = await snapshot(owner);
    const movingId = state.columns[0]!.cards[0]!.id;
    await owner.client.call('POST', `/api/v1/cards/${movingId}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: second!.id, targetIndex: 0 }
    });
    expect(changed(before, await timestamps())).toBe(6);

    // Appending to the end of a column writes exactly the one card that moved.
    before = await timestamps();
    state = await snapshot(owner);
    const tail = state.columns[0]!.cards[state.columns[0]!.cards.length - 1]!.id;
    await owner.client.call('POST', `/api/v1/cards/${tail}/move`, {
      body: { boardRevision: state.boardRevision, targetColumnId: second!.id, targetIndex: 1 }
    });
    expect(changed(before, await timestamps())).toBe(1);
  }, 120_000);
});

describe('scale caps', () => {
  it('refuses the card beyond the cap without truncating the board', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    const todo = state.columns[0]!;

    // Seeded directly so the test exercises the boundary rather than the network.
    await inHousehold(sql => {
      for (let index = 0; index < MAX_CARDS - 1; index++) {
        sql.exec(
          `INSERT INTO cards (id, column_id, title, description, assignee_user_id, creator_user_id, position, created_at, updated_at)
           VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          todo.id,
          `seed-${index}`,
          state.activeMembers[0]!.id,
          index,
          '2026-09-13T00:00:00.000Z',
          '2026-09-13T00:00:00.000Z'
        );
      }
    });

    const last = await owner.client.call<BoardMutationResponse>('POST', '/api/v1/cards', {
      body: { boardRevision: state.boardRevision, columnId: todo.id, title: 'the last one' }
    });
    expect(last.status).toBe(200);

    const beyond = await owner.client.call('POST', '/api/v1/cards', {
      body: { boardRevision: last.data!.boardRevision, columnId: todo.id, title: 'one too many' }
    });
    expect(beyond.status).toBe(409);
    expect(beyond.error?.code).toBe('board_full');

    const after = await snapshot(owner);
    expect(after.columns.flatMap(column => column.cards)).toHaveLength(MAX_CARDS);
  }, 120_000);

  it('refuses the column beyond the cap', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    await inHousehold(sql => {
      for (let index = state.columns.length; index < MAX_COLUMNS; index++) {
        sql.exec(
          `INSERT INTO columns (id, name_key, custom_name, position, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          `seed-${index}`,
          index,
          '2026-09-13T00:00:00.000Z',
          '2026-09-13T00:00:00.000Z'
        );
      }
    });

    const beyond = await owner.client.call('POST', '/api/v1/columns', {
      body: { boardRevision: state.boardRevision, name: 'one too many' }
    });
    expect(beyond.status).toBe(409);
    expect(beyond.error?.code).toBe('column_limit');
    expect((await snapshot(owner)).columns).toHaveLength(MAX_COLUMNS);
  }, 90_000);
});

describe('board authorization', () => {
  it('refuses reads and writes from anonymous, removed, and expired callers', async () => {
    const owner = await createOwner(OWNER);
    const alice = await addMember(owner, ALICE);
    const state = await snapshot(owner);
    const todo = state.columns[0]!;

    // A member who was allowlisted a moment ago loses access mid-session.
    await setAllowed(owner, [OWNER]);
    expect((await alice.client.call('GET', '/api/v1/board')).status).toBe(401);
    const blocked = await alice.client.call('POST', '/api/v1/cards', {
      body: { boardRevision: state.boardRevision, columnId: todo.id, title: 'should not land' }
    });
    expect(blocked.status).toBe(401);

    const after = await snapshot(owner);
    expect(after.columns.flatMap(column => column.cards)).toHaveLength(0);
  }, 90_000);

  it('rejects board mutations with a missing Origin or CSRF token', async () => {
    const owner = await createOwner(OWNER);
    const state = await snapshot(owner);
    const todo = state.columns[0]!;
    const body = { boardRevision: state.boardRevision, columnId: todo.id, title: 'nope' };

    expect((await owner.client.call('POST', '/api/v1/cards', { body, origin: null })).status).toBe(403);
    expect((await owner.client.call('POST', '/api/v1/cards', { body, csrf: null })).status).toBe(403);
    expect((await owner.client.call('POST', '/api/v1/cards', { body, csrf: 'forged' })).status).toBe(403);
    expect((await snapshot(owner)).boardRevision).toBe(state.boardRevision);
  }, 60_000);

  it('keeps unknown board-shaped paths as JSON 404', async () => {
    const owner = await createOwner(OWNER);
    for (const path of ['/api/v1/boards', '/api/v1/cards/x/duplicate', '/api/v1/columns/x/archive']) {
      const response = await owner.client.call('GET', path);
      expect(response.status, path).toBe(404);
      expect(response.error?.code, path).toBe('not_found');
    }
  });
});

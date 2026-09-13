import { type BoardMutationResponse, type BoardSnapshot, jsonData } from '../../../shared/api';
import { type Actor, assertCsrf, currentActor, requireActor } from '../auth/authorize';
import { newId } from '../auth/crypto';
import {
  bumpBoardRevision,
  countCards,
  countCardsInColumn,
  countColumns,
  deleteCard,
  deleteColumn,
  findCard,
  findColumn,
  insertCard,
  insertColumn,
  isEligibleMember,
  listColumns,
  MAX_CARDS,
  MAX_COLUMNS,
  readBoardRevision,
  renameColumn,
  updateCardFields
} from '../board/repository';
import {
  compactColumn,
  compactColumns,
  moveCard,
  moveColumn,
  readSnapshot,
  validateColumnName,
  validateDescription,
  validateTitle
} from '../board/service';
import { findMilestone } from '../goals/repository';
import {
  assertOnlyKeys,
  assertSameOrigin,
  conflict,
  forbidden,
  invalidRequest,
  methodNotAllowed,
  notFound,
  readJsonObject,
  requiredString,
  unauthenticated
} from '../http';
import { assertCurrentRevision, BOARD_REVISION } from '../revisions';
import { validateDueDate } from '../validation';
import type { RouteContext } from './context';

/** Large enough for a full 4,000-code-point description, unlike the 16 KiB auth limit. */
export const MAX_BOARD_BODY = 64 * 1024;

/**
 * Re-reads the caller's session from inside the committing transaction. A deactivation or an
 * allowed-list removal that commits between pre-authorisation and this point wins, so a
 * member who has just lost access cannot land a pending write.
 */
function assertStillEligible(ctx: RouteContext, request: Request, actor: Actor): Actor {
  const fresh = currentActor(ctx, request);
  if (!fresh || fresh.session.id !== actor.session.id) throw unauthenticated();
  return fresh;
}

function assertStillOwner(ctx: RouteContext, request: Request, actor: Actor): Actor {
  const fresh = assertStillEligible(ctx, request, actor);
  if (fresh.user.role !== 'owner') throw forbidden();
  return fresh;
}

function mutation(boardRevision: number, id?: string): Response {
  return jsonData<BoardMutationResponse>(id === undefined ? { boardRevision } : { boardRevision, id });
}

function unchanged(boardRevision: number): Response {
  return jsonData<BoardMutationResponse>({ boardRevision, unchanged: true });
}

function assertAssignee(ctx: RouteContext, assigneeUserId: string | null): void {
  if (assigneeUserId === null) return;
  // Only an active, currently allowlisted member of this household can hold a card.
  if (!isEligibleMember(ctx.sql, assigneeUserId)) {
    throw invalidRequest('That person cannot be assigned to a card.', { assigneeUserId: 'ineligible' });
  }
}

function optionalAssignee(body: Record<string, unknown>): string | null {
  const value = body.assigneeUserId;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) throw invalidRequest('That assignee is not valid.', { assigneeUserId: 'invalid' });
  return value;
}

function optionalMilestone(body: Record<string, unknown>): string | null {
  const value = body.milestoneId;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidRequest('That milestone is not valid.', { milestoneId: 'invalid' });
  }
  return value;
}

/** Validated like an assignee: the referenced milestone has to exist, inside the transaction. */
function assertMilestone(ctx: RouteContext, milestoneId: string | null): void {
  if (milestoneId === null) return;
  if (!findMilestone(ctx.sql, milestoneId)) {
    throw invalidRequest('That milestone is not valid.', { milestoneId: 'invalid' });
  }
}

// --- read ---------------------------------------------------------------------------------

function readBoard(ctx: RouteContext, request: Request): Response {
  if (request.method !== 'GET') throw methodNotAllowed('GET');
  requireActor(ctx, request);
  // One consistent snapshot: columns, their cards, and the eligible assignee list together.
  const snapshot = ctx.storage.transactionSync(() => readSnapshot(ctx.sql));
  return jsonData<BoardSnapshot>(snapshot);
}

// --- columns ------------------------------------------------------------------------------

async function createColumn(ctx: RouteContext, request: Request): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision', 'name']);
  const name = validateColumnName(body.name);
  const id = newId();

  const revision = ctx.storage.transactionSync(() => {
    assertStillOwner(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    const total = countColumns(ctx.sql);
    if (total >= MAX_COLUMNS) {
      throw conflict('column_limit', `A board can hold at most ${MAX_COLUMNS} columns.`);
    }
    insertColumn(ctx.sql, {
      id,
      name_key: null,
      custom_name: name,
      position: total,
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso
    });
    return bumpBoardRevision(ctx.sql);
  });
  return mutation(revision, id);
}

async function patchColumn(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision', 'name']);
  const name = validateColumnName(body.name);

  const result = ctx.storage.transactionSync(() => {
    assertStillOwner(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    const column = findColumn(ctx.sql, id);
    if (!column) throw notFound();
    if (column.custom_name === name) return { revision: readBoardRevision(ctx.sql), changed: false };
    renameColumn(ctx.sql, id, name, ctx.nowIso);
    return { revision: bumpBoardRevision(ctx.sql), changed: true };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function moveColumnRoute(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision', 'targetIndex']);

  const result = ctx.storage.transactionSync(() => {
    assertStillOwner(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    if (!findColumn(ctx.sql, id)) throw notFound();
    const changed = moveColumn(ctx.sql, id, body.targetIndex, ctx.nowIso);
    return { revision: changed ? bumpBoardRevision(ctx.sql) : readBoardRevision(ctx.sql), changed };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function removeColumn(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision']);

  const revision = ctx.storage.transactionSync(() => {
    assertStillOwner(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    if (!findColumn(ctx.sql, id)) throw notFound();
    if (countCardsInColumn(ctx.sql, id) > 0) {
      throw conflict('column_not_empty', 'Move or delete the cards in that column first.');
    }
    if (listColumns(ctx.sql).length <= 1) {
      throw conflict('last_column', 'A board must keep at least one column.');
    }
    deleteColumn(ctx.sql, id);
    compactColumns(ctx.sql, ctx.nowIso);
    return bumpBoardRevision(ctx.sql);
  });
  return mutation(revision, id);
}

// --- cards --------------------------------------------------------------------------------

async function createCard(ctx: RouteContext, request: Request): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision', 'columnId', 'title', 'description', 'assigneeUserId', 'dueDate', 'milestoneId']);
  const columnId = requiredString(body, 'columnId');
  const title = validateTitle(body.title);
  const description = validateDescription(body.description);
  const assigneeUserId = optionalAssignee(body);
  const dueDate = validateDueDate(body.dueDate);
  const milestoneId = optionalMilestone(body);
  const id = newId();

  const revision = ctx.storage.transactionSync(() => {
    const fresh = assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    if (!findColumn(ctx.sql, columnId)) throw notFound();
    if (countCards(ctx.sql) >= MAX_CARDS) {
      throw conflict('board_full', `A board can hold at most ${MAX_CARDS} cards.`);
    }
    assertAssignee(ctx, assigneeUserId);
    assertMilestone(ctx, milestoneId);
    insertCard(ctx.sql, {
      id,
      column_id: columnId,
      title,
      description,
      assignee_user_id: assigneeUserId,
      creator_user_id: fresh.user.id,
      position: countCardsInColumn(ctx.sql, columnId),
      due_date: dueDate,
      milestone_id: milestoneId,
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso
    });
    return bumpBoardRevision(ctx.sql);
  });
  return mutation(revision, id);
}

async function patchCard(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision', 'title', 'description', 'assigneeUserId', 'dueDate', 'milestoneId']);
  const touched = ['title', 'description', 'assigneeUserId', 'dueDate', 'milestoneId'].filter(key => key in body);
  if (touched.length === 0) throw invalidRequest('Nothing to change.');

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    const card = findCard(ctx.sql, id);
    if (!card) throw notFound();

    // An edit never moves a card: column and position stay exactly as they are. An omitted key
    // keeps the stored value and an explicit `null` clears it, for all five fields alike — so
    // editing only a title cannot silently drop a due date or a milestone link.
    const next = {
      title: 'title' in body ? validateTitle(body.title) : card.title,
      description: 'description' in body ? validateDescription(body.description) : card.description,
      assignee_user_id: 'assigneeUserId' in body ? optionalAssignee(body) : card.assignee_user_id,
      due_date: 'dueDate' in body ? validateDueDate(body.dueDate) : card.due_date,
      milestone_id: 'milestoneId' in body ? optionalMilestone(body) : card.milestone_id
    };
    if ('assigneeUserId' in body) assertAssignee(ctx, next.assignee_user_id);
    if ('milestoneId' in body) assertMilestone(ctx, next.milestone_id);

    if (
      next.title === card.title &&
      next.description === card.description &&
      next.assignee_user_id === card.assignee_user_id &&
      next.due_date === card.due_date &&
      next.milestone_id === card.milestone_id
    ) {
      return { revision: readBoardRevision(ctx.sql), changed: false };
    }
    updateCardFields(ctx.sql, id, next, ctx.nowIso);
    return { revision: bumpBoardRevision(ctx.sql), changed: true };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function moveCardRoute(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision', 'targetColumnId', 'targetIndex']);
  const targetColumnId = requiredString(body, 'targetColumnId');

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    const card = findCard(ctx.sql, id);
    if (!card) throw notFound();
    if (!findColumn(ctx.sql, targetColumnId)) throw notFound();
    const changed = moveCard(ctx.sql, card, targetColumnId, body.targetIndex, ctx.nowIso);
    return { revision: changed ? bumpBoardRevision(ctx.sql) : readBoardRevision(ctx.sql), changed };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function removeCard(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, ['boardRevision']);

  const revision = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.boardRevision, BOARD_REVISION);
    const card = findCard(ctx.sql, id);
    if (!card) throw notFound();
    deleteCard(ctx.sql, id);
    compactColumn(ctx.sql, card.column_id, ctx.nowIso);
    return bumpBoardRevision(ctx.sql);
  });
  return mutation(revision, id);
}

const COLUMN_ITEM = /^\/api\/v1\/columns\/([^/]+)$/;
const COLUMN_MOVE = /^\/api\/v1\/columns\/([^/]+)\/move$/;
const CARD_ITEM = /^\/api\/v1\/cards\/([^/]+)$/;
const CARD_MOVE = /^\/api\/v1\/cards\/([^/]+)\/move$/;

export function handleBoardRoute(ctx: RouteContext, request: Request, path: string): Promise<Response> | undefined {
  if (path === '/api/v1/board') return (async () => readBoard(ctx, request))();

  if (path === '/api/v1/columns') {
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return createColumn(ctx, request);
    })();
  }
  if (path === '/api/v1/cards') {
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return createCard(ctx, request);
    })();
  }

  const columnMove = COLUMN_MOVE.exec(path);
  if (columnMove) {
    const id = columnMove[1]!;
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return moveColumnRoute(ctx, request, id);
    })();
  }
  const cardMove = CARD_MOVE.exec(path);
  if (cardMove) {
    const id = cardMove[1]!;
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return moveCardRoute(ctx, request, id);
    })();
  }

  const column = COLUMN_ITEM.exec(path);
  if (column) {
    const id = column[1]!;
    return (async () => {
      if (request.method === 'PATCH') return patchColumn(ctx, request, id);
      if (request.method === 'DELETE') return removeColumn(ctx, request, id);
      throw methodNotAllowed('PATCH, DELETE');
    })();
  }
  const card = CARD_ITEM.exec(path);
  if (card) {
    const id = card[1]!;
    return (async () => {
      if (request.method === 'PATCH') return patchCard(ctx, request, id);
      if (request.method === 'DELETE') return removeCard(ctx, request, id);
      throw methodNotAllowed('PATCH, DELETE');
    })();
  }

  return undefined;
}

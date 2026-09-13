import type { BoardCard, BoardColumn, BoardSnapshot } from '../../../shared/api';
import { invalidRequest, isSafeIndex } from '../http';
import {
  type CardRow,
  cardsInColumn,
  type ColumnRow,
  listCards,
  listColumns,
  listEligibleMembers,
  readBoardRevision,
  setCardPlacement,
  setColumnPosition
} from './repository';

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_COLUMN_NAME_LENGTH = 80;

/** Unicode code points, not UTF-16 units: an emoji counts once. */
function points(value: string): number {
  return [...value].length;
}

/** Everything in C0/C1 plus separators, with no exceptions. */
const CONTROL = /\p{Cc}|\p{Cs}/u;
/** Same, but a plain line break is allowed. */
const CONTROL_EXCEPT_BREAK = /[^\n\P{Cc}]|\p{Cs}/u;

export function validateTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw invalidRequest('Enter a title.', { title: 'invalid' });
  const title = raw.trim();
  if (points(title) < 1) throw invalidRequest('Enter a title.', { title: 'required' });
  if (points(title) > MAX_TITLE_LENGTH) throw invalidRequest('That title is too long.', { title: 'too_long' });
  if (CONTROL.test(title)) throw invalidRequest('That title contains characters that cannot be saved.', { title: 'invalid' });
  return title;
}

/** `null` clears the description; an empty string is treated the same way. */
export function validateDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw invalidRequest('That description cannot be saved.', { description: 'invalid' });
  const description = raw.replace(/\r\n?/gu, '\n').trim();
  if (description.length === 0) return null;
  if (points(description) > MAX_DESCRIPTION_LENGTH) {
    throw invalidRequest('That description is too long.', { description: 'too_long' });
  }
  if (CONTROL_EXCEPT_BREAK.test(description)) {
    throw invalidRequest('That description contains characters that cannot be saved.', { description: 'invalid' });
  }
  return description;
}

export function validateColumnName(raw: unknown): string {
  if (typeof raw !== 'string') throw invalidRequest('Enter a column name.', { name: 'invalid' });
  const name = raw.trim();
  if (points(name) < 1) throw invalidRequest('Enter a column name.', { name: 'required' });
  if (points(name) > MAX_COLUMN_NAME_LENGTH) throw invalidRequest('That column name is too long.', { name: 'too_long' });
  if (CONTROL.test(name)) throw invalidRequest('That column name contains characters that cannot be saved.', { name: 'invalid' });
  return name;
}

export function validateIndex(raw: unknown, upperBound: number, field: string): number {
  if (!isSafeIndex(raw)) throw invalidRequest('That position is not valid.', { [field]: 'invalid' });
  if (raw > upperBound) throw invalidRequest('That position is not valid.', { [field]: 'out_of_range' });
  return raw;
}

function toCard(row: CardRow): BoardCard {
  return {
    id: row.id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    assigneeUserId: row.assignee_user_id,
    creatorUserId: row.creator_user_id,
    position: row.position,
    dueDate: row.due_date,
    milestoneId: row.milestone_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toColumn(row: ColumnRow, cards: BoardCard[]): BoardColumn {
  return { id: row.id, nameKey: row.name_key, customName: row.custom_name, position: row.position, cards };
}

/** One coherent snapshot. Callers run it inside a read transaction. */
export function readSnapshot(sql: SqlStorage): BoardSnapshot {
  const columns = listColumns(sql);
  const grouped = new Map<string, BoardCard[]>(columns.map(column => [column.id, []]));
  for (const row of listCards(sql)) grouped.get(row.column_id)?.push(toCard(row));
  return {
    boardRevision: readBoardRevision(sql),
    columns: columns.map(column => toColumn(column, grouped.get(column.id) ?? [])),
    activeMembers: listEligibleMembers(sql).map(member => ({ id: member.id, email: member.email_norm }))
  };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Writes dense positions `0..n-1` for one column, touching only rows that actually move. A
 * card arriving from another column has no row in this column's current list, so it is always
 * written.
 */
function applyCardOrder(sql: SqlStorage, columnId: string, orderedIds: readonly string[], at: string): void {
  const current = new Map(cardsInColumn(sql, columnId).map(card => [card.id, card]));
  orderedIds.forEach((id, index) => {
    const row = current.get(id);
    if (row && row.position === index && row.column_id === columnId) return;
    setCardPlacement(sql, id, columnId, index, at);
  });
}

/**
 * Moves a card and renumbers the affected columns. Returns false for a validated no-op, which
 * the caller reports without advancing the revision.
 *
 * For a same-column move `targetIndex` addresses the list **after** the card is removed; for a
 * cross-column move it addresses the destination list before insertion.
 */
export function moveCard(
  sql: SqlStorage,
  card: CardRow,
  targetColumnId: string,
  rawTargetIndex: unknown,
  at: string
): boolean {
  if (card.column_id === targetColumnId) {
    const currentOrder = cardsInColumn(sql, card.column_id).map(row => row.id);
    const remaining = currentOrder.filter(id => id !== card.id);
    const targetIndex = validateIndex(rawTargetIndex, remaining.length, 'targetIndex');
    const next = [...remaining];
    next.splice(targetIndex, 0, card.id);
    if (sameOrder(currentOrder, next)) return false;
    applyCardOrder(sql, targetColumnId, next, at);
    return true;
  }

  const destination = cardsInColumn(sql, targetColumnId).map(row => row.id);
  const targetIndex = validateIndex(rawTargetIndex, destination.length, 'targetIndex');
  const source = cardsInColumn(sql, card.column_id)
    .map(row => row.id)
    .filter(id => id !== card.id);
  const next = [...destination];
  next.splice(targetIndex, 0, card.id);
  applyCardOrder(sql, card.column_id, source, at);
  applyCardOrder(sql, targetColumnId, next, at);
  return true;
}

/** Closes the gap a deleted card leaves behind. */
export function compactColumn(sql: SqlStorage, columnId: string, at: string): void {
  applyCardOrder(sql, columnId, cardsInColumn(sql, columnId).map(row => row.id), at);
}

/** `targetIndex` is the column's final position, `0..columnCount-1`. */
export function moveColumn(sql: SqlStorage, columnId: string, rawTargetIndex: unknown, at: string): boolean {
  const columns = listColumns(sql);
  const currentOrder = columns.map(column => column.id);
  const targetIndex = validateIndex(rawTargetIndex, Math.max(0, columns.length - 1), 'targetIndex');
  const remaining = currentOrder.filter(id => id !== columnId);
  const next = [...remaining];
  next.splice(targetIndex, 0, columnId);
  if (sameOrder(currentOrder, next)) return false;

  const positions = new Map(columns.map(column => [column.id, column.position]));
  next.forEach((id, index) => {
    if (positions.get(id) !== index) setColumnPosition(sql, id, index, at);
  });
  return true;
}

/** Renumbers columns after a deletion so positions stay dense. */
export function compactColumns(sql: SqlStorage, at: string): void {
  listColumns(sql).forEach((column, index) => {
    if (column.position !== index) setColumnPosition(sql, column.id, index, at);
  });
}

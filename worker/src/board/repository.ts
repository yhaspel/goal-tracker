import type { BoardColumnKey } from '../../../shared/api';
import { BOARD_REVISION, bumpRevision, readRevision } from '../revisions';

/**
 * Caps for the first release, chosen to bound one board response and the SQL work behind it
 * on the Free plan. They are enforced on create, never by truncating a response.
 */
export const MAX_CARDS = 500;
export const MAX_COLUMNS = 20;

export type ColumnRow = {
  id: string;
  name_key: BoardColumnKey | null;
  custom_name: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

export type CardRow = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee_user_id: string | null;
  creator_user_id: string;
  position: number;
  /** `YYYY-MM-DD` or null. Stored verbatim: no timezone, no time of day, no `Date` in SQL. */
  due_date: string | null;
  milestone_id: string | null;
  created_at: string;
  updated_at: string;
};

function one<T>(cursor: Iterable<T>): T | undefined {
  return [...cursor][0];
}

export function readBoardRevision(sql: SqlStorage): number {
  return readRevision(sql, BOARD_REVISION);
}

/** Advances the revision exactly once and returns the new value. */
export function bumpBoardRevision(sql: SqlStorage): number {
  return bumpRevision(sql, BOARD_REVISION);
}

/** `(position, id)` throughout, so reads stay deterministic even if an invariant breaks. */
export function listColumns(sql: SqlStorage): ColumnRow[] {
  return [...sql.exec<ColumnRow>('SELECT * FROM columns ORDER BY position, id')];
}

export function listCards(sql: SqlStorage): CardRow[] {
  return [...sql.exec<CardRow>('SELECT * FROM cards ORDER BY column_id, position, id')];
}

export function cardsInColumn(sql: SqlStorage, columnId: string): CardRow[] {
  return [...sql.exec<CardRow>('SELECT * FROM cards WHERE column_id = ? ORDER BY position, id', columnId)];
}

export function findColumn(sql: SqlStorage, id: string): ColumnRow | undefined {
  return one(sql.exec<ColumnRow>('SELECT * FROM columns WHERE id = ?', id));
}

export function findCard(sql: SqlStorage, id: string): CardRow | undefined {
  return one(sql.exec<CardRow>('SELECT * FROM cards WHERE id = ?', id));
}

export function countColumns(sql: SqlStorage): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM columns'))?.total ?? 0;
}

export function countCards(sql: SqlStorage): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM cards'))?.total ?? 0;
}

export function countCardsInColumn(sql: SqlStorage, columnId: string): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM cards WHERE column_id = ?', columnId))?.total ?? 0;
}

export function insertColumn(sql: SqlStorage, column: ColumnRow): void {
  sql.exec(
    'INSERT INTO columns (id, name_key, custom_name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    column.id,
    column.name_key,
    column.custom_name,
    column.position,
    column.created_at,
    column.updated_at
  );
}

/** Renaming always clears `name_key`: a renamed column is literal in every language. */
export function renameColumn(sql: SqlStorage, id: string, customName: string, at: string): void {
  sql.exec('UPDATE columns SET name_key = NULL, custom_name = ?, updated_at = ? WHERE id = ?', customName, at, id);
}

export function setColumnPosition(sql: SqlStorage, id: string, position: number, at: string): void {
  sql.exec('UPDATE columns SET position = ?, updated_at = ? WHERE id = ?', position, at, id);
}

export function deleteColumn(sql: SqlStorage, id: string): void {
  sql.exec('DELETE FROM columns WHERE id = ?', id);
}

export function insertCard(sql: SqlStorage, card: CardRow): void {
  sql.exec(
    `INSERT INTO cards
       (id, column_id, title, description, assignee_user_id, creator_user_id, position,
        due_date, milestone_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    card.id,
    card.column_id,
    card.title,
    card.description,
    card.assignee_user_id,
    card.creator_user_id,
    card.position,
    card.due_date,
    card.milestone_id,
    card.created_at,
    card.updated_at
  );
}

export function updateCardFields(
  sql: SqlStorage,
  id: string,
  fields: {
    title: string;
    description: string | null;
    assignee_user_id: string | null;
    due_date: string | null;
    milestone_id: string | null;
  },
  at: string
): void {
  sql.exec(
    `UPDATE cards
        SET title = ?, description = ?, assignee_user_id = ?, due_date = ?, milestone_id = ?, updated_at = ?
      WHERE id = ?`,
    fields.title,
    fields.description,
    fields.assignee_user_id,
    fields.due_date,
    fields.milestone_id,
    at,
    id
  );
}

export function setCardPlacement(sql: SqlStorage, id: string, columnId: string, position: number, at: string): void {
  sql.exec('UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?', columnId, position, at, id);
}

export function deleteCard(sql: SqlStorage, id: string): void {
  sql.exec('DELETE FROM cards WHERE id = ?', id);
}

export function countAssignedCards(sql: SqlStorage, userId: string): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM cards WHERE assignee_user_id = ?', userId))
    ?.total ?? 0;
}

/** Used when a member is deactivated or their email leaves the allowed list. */
export function clearAssignmentsFor(sql: SqlStorage, userId: string, at: string): void {
  sql.exec('UPDATE cards SET assignee_user_id = NULL, updated_at = ? WHERE assignee_user_id = ?', at, userId);
}

/** Active, currently allowlisted accounts, which are the only legal assignees. */
export function listEligibleMembers(sql: SqlStorage): Array<{ id: string; email_norm: string }> {
  return [...sql.exec<{ id: string; email_norm: string }>(
    `SELECT u.id, u.email_norm FROM users u
       JOIN allowed_emails a ON a.email_norm = u.email_norm
      WHERE u.status = 'active'
      ORDER BY u.email_norm`
  )];
}

export function isEligibleMember(sql: SqlStorage, userId: string): boolean {
  return one(sql.exec<{ found: number }>(
    `SELECT 1 AS found FROM users u
       JOIN allowed_emails a ON a.email_norm = u.email_norm
      WHERE u.id = ? AND u.status = 'active'`,
    userId
  )) !== undefined;
}

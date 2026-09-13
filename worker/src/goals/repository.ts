import type { MilestoneStatus } from '../../../shared/api';

/**
 * Caps for the second release, chosen to bound one goals response and the SQL work behind it on
 * the Free plan. They are enforced on create, never by truncating a response.
 */
export const MAX_GOALS = 50;
export const MAX_MILESTONES_PER_GOAL = 24;
export const MAX_MILESTONES = 400;

export type GoalRow = {
  id: string;
  year: number;
  title: string;
  notes: string | null;
  position: number;
  creator_user_id: string;
  created_at: string;
  updated_at: string;
};

export type MilestoneRow = {
  id: string;
  goal_id: string;
  month: number;
  title: string;
  notes: string | null;
  status: MilestoneStatus;
  position: number;
  creator_user_id: string;
  created_at: string;
  updated_at: string;
};

function one<T>(cursor: Iterable<T>): T | undefined {
  return [...cursor][0];
}

/** `(…, position, id)` throughout, so reads stay deterministic even if an invariant breaks. */
export function listGoals(sql: SqlStorage): GoalRow[] {
  return [...sql.exec<GoalRow>('SELECT * FROM goals ORDER BY year, position, id')];
}

export function goalsInYear(sql: SqlStorage, year: number): GoalRow[] {
  return [...sql.exec<GoalRow>('SELECT * FROM goals WHERE year = ? ORDER BY position, id', year)];
}

export function listMilestones(sql: SqlStorage): MilestoneRow[] {
  return [...sql.exec<MilestoneRow>('SELECT * FROM milestones ORDER BY goal_id, month, position, id')];
}

export function milestonesInGroup(sql: SqlStorage, goalId: string, month: number): MilestoneRow[] {
  return [...sql.exec<MilestoneRow>(
    'SELECT * FROM milestones WHERE goal_id = ? AND month = ? ORDER BY position, id',
    goalId,
    month
  )];
}

export function milestonesOfGoal(sql: SqlStorage, goalId: string): MilestoneRow[] {
  return [...sql.exec<MilestoneRow>(
    'SELECT * FROM milestones WHERE goal_id = ? ORDER BY month, position, id',
    goalId
  )];
}

export function findGoal(sql: SqlStorage, id: string): GoalRow | undefined {
  return one(sql.exec<GoalRow>('SELECT * FROM goals WHERE id = ?', id));
}

export function findMilestone(sql: SqlStorage, id: string): MilestoneRow | undefined {
  return one(sql.exec<MilestoneRow>('SELECT * FROM milestones WHERE id = ?', id));
}

export function countGoals(sql: SqlStorage): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM goals'))?.total ?? 0;
}

export function countGoalsInYear(sql: SqlStorage, year: number): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM goals WHERE year = ?', year))?.total ?? 0;
}

export function countMilestones(sql: SqlStorage): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM milestones'))?.total ?? 0;
}

export function countMilestonesOfGoal(sql: SqlStorage, goalId: string): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM milestones WHERE goal_id = ?', goalId))
    ?.total ?? 0;
}

export function countMilestonesInGroup(sql: SqlStorage, goalId: string, month: number): number {
  return one(sql.exec<{ total: number }>(
    'SELECT COUNT(*) AS total FROM milestones WHERE goal_id = ? AND month = ?',
    goalId,
    month
  ))?.total ?? 0;
}

export function insertGoal(sql: SqlStorage, goal: GoalRow): void {
  sql.exec(
    `INSERT INTO goals (id, year, title, notes, position, creator_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    goal.id,
    goal.year,
    goal.title,
    goal.notes,
    goal.position,
    goal.creator_user_id,
    goal.created_at,
    goal.updated_at
  );
}

export function updateGoalFields(
  sql: SqlStorage,
  id: string,
  fields: { year: number; title: string; notes: string | null; position: number },
  at: string
): void {
  sql.exec(
    'UPDATE goals SET year = ?, title = ?, notes = ?, position = ?, updated_at = ? WHERE id = ?',
    fields.year,
    fields.title,
    fields.notes,
    fields.position,
    at,
    id
  );
}

export function setGoalPosition(sql: SqlStorage, id: string, position: number, at: string): void {
  sql.exec('UPDATE goals SET position = ?, updated_at = ? WHERE id = ?', position, at, id);
}

export function deleteGoal(sql: SqlStorage, id: string): void {
  sql.exec('DELETE FROM goals WHERE id = ?', id);
}

export function insertMilestone(sql: SqlStorage, milestone: MilestoneRow): void {
  sql.exec(
    `INSERT INTO milestones
       (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    milestone.id,
    milestone.goal_id,
    milestone.month,
    milestone.title,
    milestone.notes,
    milestone.status,
    milestone.position,
    milestone.creator_user_id,
    milestone.created_at,
    milestone.updated_at
  );
}

export function updateMilestoneFields(
  sql: SqlStorage,
  id: string,
  fields: { month: number; title: string; notes: string | null; status: MilestoneStatus; position: number },
  at: string
): void {
  sql.exec(
    'UPDATE milestones SET month = ?, title = ?, notes = ?, status = ?, position = ?, updated_at = ? WHERE id = ?',
    fields.month,
    fields.title,
    fields.notes,
    fields.status,
    fields.position,
    at,
    id
  );
}

export function setMilestonePosition(sql: SqlStorage, id: string, position: number, at: string): void {
  sql.exec('UPDATE milestones SET position = ?, updated_at = ? WHERE id = ?', position, at, id);
}

export function deleteMilestone(sql: SqlStorage, id: string): void {
  sql.exec('DELETE FROM milestones WHERE id = ?', id);
}

export function deleteMilestonesOfGoal(sql: SqlStorage, goalId: string): void {
  sql.exec('DELETE FROM milestones WHERE goal_id = ?', goalId);
}

/**
 * Detaches every card pointing at one milestone, and reports whether any row actually changed.
 *
 * `rowsWritten` is what makes "advance the revision only when something changed" a mechanism
 * rather than an intention: a goal whose milestones hold no cards must not bump the board
 * revision and invalidate an unrelated member's open card editor.
 */
export function detachCardsFromMilestone(sql: SqlStorage, milestoneId: string, at: string): number {
  return sql.exec(
    'UPDATE cards SET milestone_id = NULL, updated_at = ? WHERE milestone_id = ?',
    at,
    milestoneId
  ).rowsWritten;
}

/** The same, for every milestone of one goal, in a single statement. */
export function detachCardsFromGoal(sql: SqlStorage, goalId: string, at: string): number {
  return sql.exec(
    `UPDATE cards SET milestone_id = NULL, updated_at = ?
      WHERE milestone_id IN (SELECT id FROM milestones WHERE goal_id = ?)`,
    at,
    goalId
  ).rowsWritten;
}

/** Unlinks the vision images pointing at one goal, before the goal row is deleted. */
export function unlinkImagesFromGoal(sql: SqlStorage, goalId: string, at: string): number {
  return sql.exec(
    'UPDATE vision_images SET goal_id = NULL, updated_at = ? WHERE goal_id = ?',
    at,
    goalId
  ).rowsWritten;
}

/** The cards serving each milestone, read once for the whole snapshot rather than per row. */
export function listMilestoneCardLinks(
  sql: SqlStorage
): Array<{ milestone_id: string; id: string; title: string; column_id: string }> {
  return [...sql.exec<{ milestone_id: string; id: string; title: string; column_id: string }>(
    `SELECT milestone_id, id, title, column_id FROM cards
      WHERE milestone_id IS NOT NULL
      ORDER BY column_id, position, id`
  )];
}

import type { Goal, GoalsIndex, GoalsSnapshot, Milestone, MilestoneCardLink } from '../../../shared/api';
import { readBoardRevision } from '../board/repository';
import { validateIndex } from '../board/service';
import { invalidRequest } from '../http';
import { GOALS_REVISION, readRevision } from '../revisions';
import {
  type GoalRow,
  goalsInYear,
  listGoals,
  listMilestoneCardLinks,
  listMilestones,
  type MilestoneRow,
  milestonesInGroup,
  setGoalPosition,
  setMilestonePosition
} from './repository';

/**
 * Ordering, compaction, and the two read shapes.
 *
 * Positions are dense `0..n-1` within one year for a goal, and within one `(goal, month)` group
 * for a milestone. Every delete compacts inside the deleting transaction, the way `removeCard`
 * calls `compactColumn`: without that the first delete breaks the invariant and a later move
 * computed against a gapped list collides.
 */

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Writes dense positions `0..n-1` for one year, touching only rows that actually move. */
function applyGoalOrder(sql: SqlStorage, year: number, orderedIds: readonly string[], at: string): void {
  const current = new Map(goalsInYear(sql, year).map(goal => [goal.id, goal.position]));
  orderedIds.forEach((id, index) => {
    if (current.get(id) === index) return;
    setGoalPosition(sql, id, index, at);
  });
}

function applyMilestoneOrder(
  sql: SqlStorage,
  goalId: string,
  month: number,
  orderedIds: readonly string[],
  at: string
): void {
  const current = new Map(milestonesInGroup(sql, goalId, month).map(row => [row.id, row.position]));
  orderedIds.forEach((id, index) => {
    if (current.get(id) === index) return;
    setMilestonePosition(sql, id, index, at);
  });
}

/** Closes the gap a deleted or departed goal leaves behind in one year. */
export function compactGoalYear(sql: SqlStorage, year: number, at: string): void {
  applyGoalOrder(sql, year, goalsInYear(sql, year).map(goal => goal.id), at);
}

/** The same for one `(goal, month)` group. */
export function compactMilestoneGroup(sql: SqlStorage, goalId: string, month: number, at: string): void {
  applyMilestoneOrder(sql, goalId, month, milestonesInGroup(sql, goalId, month).map(row => row.id), at);
}

/**
 * Reorders one goal within its own year. `targetIndex` is its final position, `0..count-1`.
 * Returns false for a validated no-op, which the caller reports without advancing the revision.
 */
export function moveGoal(sql: SqlStorage, goal: GoalRow, rawTargetIndex: unknown, at: string): boolean {
  const currentOrder = goalsInYear(sql, goal.year).map(row => row.id);
  const targetIndex = validateIndex(rawTargetIndex, Math.max(0, currentOrder.length - 1), 'targetIndex');
  const remaining = currentOrder.filter(id => id !== goal.id);
  const next = [...remaining];
  next.splice(targetIndex, 0, goal.id);
  if (sameOrder(currentOrder, next)) return false;
  applyGoalOrder(sql, goal.year, next, at);
  return true;
}

export function moveMilestone(sql: SqlStorage, milestone: MilestoneRow, rawTargetIndex: unknown, at: string): boolean {
  const currentOrder = milestonesInGroup(sql, milestone.goal_id, milestone.month).map(row => row.id);
  const targetIndex = validateIndex(rawTargetIndex, Math.max(0, currentOrder.length - 1), 'targetIndex');
  const remaining = currentOrder.filter(id => id !== milestone.id);
  const next = [...remaining];
  next.splice(targetIndex, 0, milestone.id);
  if (sameOrder(currentOrder, next)) return false;
  applyMilestoneOrder(sql, milestone.goal_id, milestone.month, next, at);
  return true;
}

function toMilestone(row: MilestoneRow, cards: MilestoneCardLink[]): Milestone {
  return {
    id: row.id,
    goalId: row.goal_id,
    month: row.month,
    title: row.title,
    notes: row.notes,
    status: row.status,
    position: row.position,
    creatorUserId: row.creator_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cards
  };
}

function toGoal(row: GoalRow, milestones: Milestone[]): Goal {
  return {
    id: row.id,
    year: row.year,
    title: row.title,
    notes: row.notes,
    position: row.position,
    creatorUserId: row.creator_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    milestones
  };
}

/**
 * One coherent snapshot: the goals revision, the board revision, the goals, their milestones and
 * the cards serving each milestone. Callers run it inside a read transaction, so the revisions
 * and the rows can never come from different committed states.
 */
export function readGoalsSnapshot(sql: SqlStorage): GoalsSnapshot {
  const goals = listGoals(sql);
  const milestoneRows = listMilestones(sql);

  const linksByMilestone = new Map<string, MilestoneCardLink[]>();
  for (const link of listMilestoneCardLinks(sql)) {
    const bucket = linksByMilestone.get(link.milestone_id);
    const entry = { id: link.id, title: link.title, columnId: link.column_id };
    if (bucket) bucket.push(entry);
    else linksByMilestone.set(link.milestone_id, [entry]);
  }

  const milestonesByGoal = new Map<string, Milestone[]>(goals.map(goal => [goal.id, []]));
  for (const row of milestoneRows) {
    milestonesByGoal.get(row.goal_id)?.push(toMilestone(row, linksByMilestone.get(row.id) ?? []));
  }

  return {
    goalsRevision: readRevision(sql, GOALS_REVISION),
    boardRevision: readBoardRevision(sql),
    goals: goals.map(goal => toGoal(goal, milestonesByGoal.get(goal.id) ?? []))
  };
}

/** The compact form the card editor's "Part of" selector reads. No notes, no card links. */
export function readGoalsIndex(sql: SqlStorage): GoalsIndex {
  return {
    goalsRevision: readRevision(sql, GOALS_REVISION),
    goals: listGoals(sql).map(goal => ({ id: goal.id, year: goal.year, title: goal.title })),
    milestones: listMilestones(sql).map(row => ({
      id: row.id,
      goalId: row.goal_id,
      month: row.month,
      title: row.title,
      status: row.status
    }))
  };
}

/**
 * The `view` parameter on `GET /api/v1/goals`, validated against the **whole** parameter list
 * rather than a single `get()`, so `?view=index&x=1` and `?view=index&view=evil` are both
 * refused rather than quietly taking the first value.
 */
export function readViewParameter(url: URL): 'full' | 'index' {
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return 'full';
  if (entries.length !== 1 || entries[0]![0] !== 'view' || entries[0]![1] !== 'index') {
    throw invalidRequest('That request was not valid.');
  }
  return 'index';
}

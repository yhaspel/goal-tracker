import { type GoalsIndex, type GoalsMutationResponse, type GoalsSnapshot, jsonData } from '../../../shared/api';
import { type Actor, assertCsrf, currentActor, requireActor } from '../auth/authorize';
import { newId } from '../auth/crypto';
import { bumpBoardRevision } from '../board/repository';
import { validateTitle } from '../board/service';
import {
  countGoals,
  countGoalsInYear,
  countMilestones,
  countMilestonesInGroup,
  countMilestonesOfGoal,
  deleteGoal,
  deleteMilestone,
  deleteMilestonesOfGoal,
  detachCardsFromGoal,
  detachCardsFromMilestone,
  findGoal,
  findMilestone,
  insertGoal,
  insertMilestone,
  MAX_GOALS,
  MAX_MILESTONES,
  MAX_MILESTONES_PER_GOAL,
  unlinkImagesFromGoal,
  updateGoalFields,
  updateMilestoneFields
} from '../goals/repository';
import {
  compactGoalYear,
  compactMilestoneGroup,
  moveGoal,
  moveMilestone,
  readGoalsIndex,
  readGoalsSnapshot,
  readViewParameter
} from '../goals/service';
import {
  assertOnlyKeys,
  assertSameOrigin,
  conflict,
  invalidRequest,
  methodNotAllowed,
  notFound,
  readJsonObject,
  requiredString,
  unauthenticated
} from '../http';
import { assertCurrentRevision, bumpRevision, GOALS_REVISION, readRevision, VISION_REVISION } from '../revisions';
import { MAX_BOARD_BODY } from './board';
import type { RouteContext } from './context';
import { validateMonth, validateNotes, validateStatus, validateYear } from '../validation';

/**
 * Goals and milestones.
 *
 * Every route here requires a live session and current allowed-list membership, re-checked
 * **inside** the committing transaction, and every mutation additionally requires an exact
 * same-origin `Origin`, a session-bound CSRF token, and an `assertOnlyKeys` list naming exactly
 * the fields it accepts. Nothing here is owner-only: a goal is not structural the way a column
 * is, so it follows the card rules.
 */

function assertStillEligible(ctx: RouteContext, request: Request, actor: Actor): Actor {
  const fresh = currentActor(ctx, request);
  if (!fresh || fresh.session.id !== actor.session.id) throw unauthenticated();
  return fresh;
}

function mutation(goalsRevision: number, id?: string): Response {
  return jsonData<GoalsMutationResponse>(id === undefined ? { goalsRevision } : { goalsRevision, id });
}

function unchanged(goalsRevision: number): Response {
  return jsonData<GoalsMutationResponse>({ goalsRevision, unchanged: true });
}

/** Shared preamble for every mutation: origin, session, CSRF, body, and the allowed key set. */
async function beginMutation(
  ctx: RouteContext,
  request: Request,
  allowed: readonly string[]
): Promise<{ actor: Actor; body: Record<string, unknown> }> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const body = await readJsonObject(request, MAX_BOARD_BODY);
  assertOnlyKeys(body, allowed);
  return { actor, body };
}

// --- read ---------------------------------------------------------------------------------

function readGoals(ctx: RouteContext, request: Request): Response {
  if (request.method !== 'GET') throw methodNotAllowed('GET');
  requireActor(ctx, request);
  const view = readViewParameter(new URL(request.url));
  if (view === 'index') {
    return jsonData<GoalsIndex>(ctx.storage.transactionSync(() => readGoalsIndex(ctx.sql)));
  }
  return jsonData<GoalsSnapshot>(ctx.storage.transactionSync(() => readGoalsSnapshot(ctx.sql)));
}

// --- goals --------------------------------------------------------------------------------

async function createGoal(ctx: RouteContext, request: Request): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['goalsRevision', 'year', 'title', 'notes']);
  const year = validateYear(body.year);
  const title = validateTitle(body.title);
  const notes = validateNotes(body.notes);
  const id = newId();

  const revision = ctx.storage.transactionSync(() => {
    const fresh = assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    if (countGoals(ctx.sql) >= MAX_GOALS) {
      throw conflict('goal_limit', `This board can hold at most ${MAX_GOALS} goals.`);
    }
    insertGoal(ctx.sql, {
      id,
      year,
      title,
      notes,
      position: countGoalsInYear(ctx.sql, year),
      creator_user_id: fresh.user.id,
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso
    });
    return bumpRevision(ctx.sql, GOALS_REVISION);
  });
  return mutation(revision, id);
}

async function patchGoal(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['goalsRevision', 'title', 'notes', 'year']);
  const touched = ['title', 'notes', 'year'].filter(key => key in body);
  if (touched.length === 0) throw invalidRequest('Nothing to change.');

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    const goal = findGoal(ctx.sql, id);
    if (!goal) throw notFound();

    const next = {
      title: 'title' in body ? validateTitle(body.title) : goal.title,
      notes: 'notes' in body ? validateNotes(body.notes) : goal.notes,
      year: 'year' in body ? validateYear(body.year) : goal.year
    };
    // A dialog that posts its whole form resends the current year on a title-only edit, so an
    // equal year must change nothing about position. Only a *different* year moves the goal.
    const moving = next.year !== goal.year;
    const position = moving ? countGoalsInYear(ctx.sql, next.year) : goal.position;

    if (!moving && next.title === goal.title && next.notes === goal.notes) {
      return { revision: readRevision(ctx.sql, GOALS_REVISION), changed: false };
    }
    updateGoalFields(ctx.sql, id, { ...next, position }, ctx.nowIso);
    if (moving) compactGoalYear(ctx.sql, goal.year, ctx.nowIso);
    return { revision: bumpRevision(ctx.sql, GOALS_REVISION), changed: true };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function moveGoalRoute(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['goalsRevision', 'targetIndex']);

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    const goal = findGoal(ctx.sql, id);
    if (!goal) throw notFound();
    const changed = moveGoal(ctx.sql, goal, body.targetIndex, ctx.nowIso);
    return {
      revision: changed ? bumpRevision(ctx.sql, GOALS_REVISION) : readRevision(ctx.sql, GOALS_REVISION),
      changed
    };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

/**
 * Deleting a goal reaches into two other domains, because both foreign keys are enforced: its
 * milestones' cards are detached and its images unlinked **before** the rows they point at go.
 * Each of those neighbouring revisions advances only when a row was actually written, which is
 * what stops a goal with no cards from invalidating an unrelated member's open card editor.
 */
async function removeGoal(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['goalsRevision']);

  const revision = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    const goal = findGoal(ctx.sql, id);
    if (!goal) throw notFound();

    if (detachCardsFromGoal(ctx.sql, id, ctx.nowIso) > 0) bumpBoardRevision(ctx.sql);
    if (unlinkImagesFromGoal(ctx.sql, id, ctx.nowIso) > 0) bumpRevision(ctx.sql, VISION_REVISION);
    deleteMilestonesOfGoal(ctx.sql, id);
    deleteGoal(ctx.sql, id);
    compactGoalYear(ctx.sql, goal.year, ctx.nowIso);
    return bumpRevision(ctx.sql, GOALS_REVISION);
  });
  return mutation(revision, id);
}

// --- milestones ---------------------------------------------------------------------------

async function createMilestone(ctx: RouteContext, request: Request): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, [
    'goalsRevision',
    'goalId',
    'month',
    'title',
    'notes'
  ]);
  const goalId = requiredString(body, 'goalId');
  const month = validateMonth(body.month);
  const title = validateTitle(body.title);
  const notes = validateNotes(body.notes);
  const id = newId();

  const revision = ctx.storage.transactionSync(() => {
    const fresh = assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    if (!findGoal(ctx.sql, goalId)) throw notFound();
    if (countMilestonesOfGoal(ctx.sql, goalId) >= MAX_MILESTONES_PER_GOAL) {
      throw conflict('milestone_limit', `A goal can hold at most ${MAX_MILESTONES_PER_GOAL} milestones.`);
    }
    if (countMilestones(ctx.sql) >= MAX_MILESTONES) {
      throw conflict('milestone_limit', `This board can hold at most ${MAX_MILESTONES} milestones.`);
    }
    insertMilestone(ctx.sql, {
      id,
      goal_id: goalId,
      month,
      title,
      notes,
      status: 'open',
      position: countMilestonesInGroup(ctx.sql, goalId, month),
      creator_user_id: fresh.user.id,
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso
    });
    return bumpRevision(ctx.sql, GOALS_REVISION);
  });
  return mutation(revision, id);
}

async function patchMilestone(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['goalsRevision', 'title', 'notes', 'month', 'status']);
  const touched = ['title', 'notes', 'month', 'status'].filter(key => key in body);
  if (touched.length === 0) throw invalidRequest('Nothing to change.');

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    const milestone = findMilestone(ctx.sql, id);
    if (!milestone) throw notFound();

    const next = {
      title: 'title' in body ? validateTitle(body.title) : milestone.title,
      notes: 'notes' in body ? validateNotes(body.notes) : milestone.notes,
      month: 'month' in body ? validateMonth(body.month) : milestone.month,
      status: 'status' in body ? validateStatus(body.status) : milestone.status
    };
    const moving = next.month !== milestone.month;
    const position = moving
      ? countMilestonesInGroup(ctx.sql, milestone.goal_id, next.month)
      : milestone.position;

    if (!moving && next.title === milestone.title && next.notes === milestone.notes && next.status === milestone.status) {
      return { revision: readRevision(ctx.sql, GOALS_REVISION), changed: false };
    }
    updateMilestoneFields(ctx.sql, id, { ...next, position }, ctx.nowIso);
    if (moving) compactMilestoneGroup(ctx.sql, milestone.goal_id, milestone.month, ctx.nowIso);
    return { revision: bumpRevision(ctx.sql, GOALS_REVISION), changed: true };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function moveMilestoneRoute(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['goalsRevision', 'targetIndex']);

  const result = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    const milestone = findMilestone(ctx.sql, id);
    if (!milestone) throw notFound();
    const changed = moveMilestone(ctx.sql, milestone, body.targetIndex, ctx.nowIso);
    return {
      revision: changed ? bumpRevision(ctx.sql, GOALS_REVISION) : readRevision(ctx.sql, GOALS_REVISION),
      changed
    };
  });
  return result.changed ? mutation(result.revision, id) : unchanged(result.revision);
}

async function removeMilestone(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  const { actor, body } = await beginMutation(ctx, request, ['goalsRevision']);

  const revision = ctx.storage.transactionSync(() => {
    assertStillEligible(ctx, request, actor);
    assertCurrentRevision(ctx.sql, body.goalsRevision, GOALS_REVISION);
    const milestone = findMilestone(ctx.sql, id);
    if (!milestone) throw notFound();

    if (detachCardsFromMilestone(ctx.sql, id, ctx.nowIso) > 0) bumpBoardRevision(ctx.sql);
    deleteMilestone(ctx.sql, id);
    compactMilestoneGroup(ctx.sql, milestone.goal_id, milestone.month, ctx.nowIso);
    return bumpRevision(ctx.sql, GOALS_REVISION);
  });
  return mutation(revision, id);
}

const GOAL_ITEM = /^\/api\/v1\/goals\/([^/]+)$/;
const GOAL_MOVE = /^\/api\/v1\/goals\/([^/]+)\/move$/;
const MILESTONE_ITEM = /^\/api\/v1\/milestones\/([^/]+)$/;
const MILESTONE_MOVE = /^\/api\/v1\/milestones\/([^/]+)\/move$/;

export function handleGoalsRoute(ctx: RouteContext, request: Request, path: string): Promise<Response> | undefined {
  if (path === '/api/v1/goals') {
    return (async () => {
      if (request.method === 'GET') return readGoals(ctx, request);
      if (request.method === 'POST') return createGoal(ctx, request);
      throw methodNotAllowed('GET, POST');
    })();
  }
  if (path === '/api/v1/milestones') {
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return createMilestone(ctx, request);
    })();
  }

  const goalMove = GOAL_MOVE.exec(path);
  if (goalMove) {
    const id = goalMove[1]!;
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return moveGoalRoute(ctx, request, id);
    })();
  }
  const milestoneMove = MILESTONE_MOVE.exec(path);
  if (milestoneMove) {
    const id = milestoneMove[1]!;
    return (async () => {
      if (request.method !== 'POST') throw methodNotAllowed('POST');
      return moveMilestoneRoute(ctx, request, id);
    })();
  }

  const goal = GOAL_ITEM.exec(path);
  if (goal) {
    const id = goal[1]!;
    return (async () => {
      if (request.method === 'PATCH') return patchGoal(ctx, request, id);
      if (request.method === 'DELETE') return removeGoal(ctx, request, id);
      throw methodNotAllowed('PATCH, DELETE');
    })();
  }
  const milestone = MILESTONE_ITEM.exec(path);
  if (milestone) {
    const id = milestone[1]!;
    return (async () => {
      if (request.method === 'PATCH') return patchMilestone(ctx, request, id);
      if (request.method === 'DELETE') return removeMilestone(ctx, request, id);
      throw methodNotAllowed('PATCH, DELETE');
    })();
  }

  return undefined;
}

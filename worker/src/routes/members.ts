import { jsonData, type MemberListResponse, type MemberResponse, type MemberSummary } from '../../../shared/api';
import { assertCsrf, requireActor, requireOwner } from '../auth/authorize';
import {
  deactivateUser,
  findUserById,
  isEmailAllowed,
  listUsers,
  revokeSessionsForUser,
  type UserRow
} from '../db/account-repository';
import {
  assertOnlyKeys,
  assertSameOrigin,
  forbidden,
  invalidRequest,
  methodNotAllowed,
  notFound,
  readJsonObject
} from '../http';
import { securityEvent } from '../security-log';
import type { RouteContext } from './context';

const COLLECTION = '/api/v1/members';
const ITEM = /^\/api\/v1\/members\/([^/]+)$/;

function summarize(user: UserRow): MemberSummary {
  return { id: user.id, email: user.email_norm, role: user.role, status: user.status, language: user.language };
}

function list(ctx: RouteContext, request: Request): Response {
  requireActor(ctx, request);
  return jsonData<MemberListResponse>({ members: listUsers(ctx.sql).map(summarize) });
}

/**
 * Deactivation is the only member mutation in this release and it is irreversible: it frees
 * a seat, ends every session for that account, and leaves the user row in place so card
 * history keeps its creator reference. Stage 4 extends this same transaction to clear the
 * member's current card assignments and advance the board revision.
 */
async function update(ctx: RouteContext, request: Request, id: string): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireOwner(ctx, request);
  assertCsrf(ctx, request, actor);

  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['status']);
  if (body.status !== 'inactive') throw invalidRequest('Only deactivation is supported.', { status: 'invalid_status' });

  const member = ctx.storage.transactionSync(() => {
    const owner = findUserById(ctx.sql, actor.user.id);
    if (!owner || owner.role !== 'owner' || owner.status !== 'active' || !isEmailAllowed(ctx.sql, owner.email_norm)) {
      throw forbidden();
    }
    const target = findUserById(ctx.sql, id);
    if (!target) throw notFound();
    if (target.role === 'owner') {
      throw forbidden('cannot_deactivate_owner', 'The owner account cannot be deactivated.');
    }
    if (target.status === 'active') {
      deactivateUser(ctx.sql, target.id, ctx.nowIso);
      revokeSessionsForUser(ctx.sql, target.id, ctx.nowIso);
    }
    const updated = findUserById(ctx.sql, id);
    if (!updated) throw notFound();
    return updated;
  });

  securityEvent('member.deactivate', 'allowed', { userId: actor.user.id });
  return jsonData<MemberResponse>({ member: summarize(member) });
}

export function handleMemberRoute(ctx: RouteContext, request: Request, path: string): Promise<Response> | undefined {
  if (path === COLLECTION) {
    return (async () => {
      if (request.method === 'GET') return list(ctx, request);
      throw methodNotAllowed('GET');
    })();
  }
  const match = ITEM.exec(path);
  if (!match) return undefined;
  const id = match[1]!;
  return (async () => {
    if (request.method === 'PATCH') return update(ctx, request, id);
    throw methodNotAllowed('PATCH');
  })();
}

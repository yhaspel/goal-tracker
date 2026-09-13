import { type AllowedEmailsResponse, jsonData } from '../../../shared/api';
import { assertCsrf, requireOwner } from '../auth/authorize';
import { normalizeEmailSet } from '../auth/email';
import {
  deleteAllowedEmail,
  deletePendingRegistrationsForEmail,
  findUserByEmail,
  findUserById,
  insertAllowedEmail,
  isEmailAllowed,
  listAllowedEmails,
  MAX_ALLOWED_EMAILS,
  readAppState,
  revokeSessionsForUser,
  revokeUnusedInvitationsForEmail,
  setAllowlistRevision
} from '../db/account-repository';
import {
  assertOnlyKeys,
  assertSameOrigin,
  conflict,
  forbidden,
  invalidRequest,
  isSafeIndex,
  methodNotAllowed,
  readJsonObject
} from '../http';
import { securityEvent } from '../security-log';
import type { RouteContext } from './context';

const PATH = '/api/v1/settings/allowed-emails';

function read(ctx: RouteContext, request: Request): Response {
  requireOwner(ctx, request);
  return jsonData<AllowedEmailsResponse>({
    emails: listAllowedEmails(ctx.sql),
    allowlistRevision: readAppState(ctx.sql).allowlist_revision
  });
}

/**
 * Whole-set replacement. The request body carries an array; Stage 5 renders one address per
 * row in a textbox and converts it here. A client-submitted list is input, never
 * authorization state, so the entire set is revalidated and re-derived inside one
 * transaction against the live owner session and the current revision.
 */
async function replace(ctx: RouteContext, request: Request): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireOwner(ctx, request);
  assertCsrf(ctx, request, actor);

  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['emails', 'allowlistRevision']);

  const emails = normalizeEmailSet(body.emails);
  if (emails === null) {
    throw invalidRequest('Enter one valid email address per row, with no duplicates.', { emails: 'invalid_emails' });
  }
  if (emails.length < 1 || emails.length > MAX_ALLOWED_EMAILS) {
    throw invalidRequest(`Keep between 1 and ${MAX_ALLOWED_EMAILS} addresses, including the owner.`, {
      emails: 'invalid_count'
    });
  }
  if (!isSafeIndex(body.allowlistRevision)) throw invalidRequest();
  const expectedRevision = body.allowlistRevision;

  const result = ctx.storage.transactionSync(() => {
    const owner = findUserById(ctx.sql, actor.user.id);
    if (!owner || owner.role !== 'owner' || owner.status !== 'active' || !isEmailAllowed(ctx.sql, owner.email_norm)) {
      throw forbidden();
    }
    if (!emails.includes(owner.email_norm)) {
      throw invalidRequest('The owner address must stay on the list.', { emails: 'owner_required' });
    }

    const state = readAppState(ctx.sql);
    if (state.allowlist_revision !== expectedRevision) {
      // Nothing is written: the owner reloads the current list and decides again.
      throw conflict('allowlist_conflict', 'The allowed list changed. Review the current list and try again.', {
        allowlistRevision: state.allowlist_revision
      });
    }

    const current = listAllowedEmails(ctx.sql);
    const currentSet = new Set(current);
    const nextSet = new Set(emails);
    const added = emails.filter(email => !currentSet.has(email));
    const removed = current.filter(email => !nextSet.has(email));

    if (added.length === 0 && removed.length === 0) {
      return { emails: current, allowlistRevision: state.allowlist_revision, added: 0, removed: 0 };
    }

    for (const email of removed) {
      deleteAllowedEmail(ctx.sql, email);
      // Access ends immediately on every device. The account row and its occupied seat
      // survive; freeing the seat is the separate, irreversible deactivation action.
      const user = findUserByEmail(ctx.sql, email);
      if (user) revokeSessionsForUser(ctx.sql, user.id, ctx.nowIso);
      revokeUnusedInvitationsForEmail(ctx.sql, email, ctx.nowIso);
      deletePendingRegistrationsForEmail(ctx.sql, email);
    }
    for (const email of added) insertAllowedEmail(ctx.sql, email, ctx.nowIso);

    const revision = state.allowlist_revision + 1;
    setAllowlistRevision(ctx.sql, revision);
    return { emails: listAllowedEmails(ctx.sql), allowlistRevision: revision, added: added.length, removed: removed.length };
  });

  // Counts only: the addresses themselves are never written to the log.
  securityEvent('settings.allowed_emails.replace', 'allowed', {
    userId: actor.user.id,
    added: result.added,
    removed: result.removed,
    allowlistRevision: result.allowlistRevision
  });
  return jsonData<AllowedEmailsResponse>({ emails: result.emails, allowlistRevision: result.allowlistRevision });
}

export function handleAllowedEmailsRoute(
  ctx: RouteContext,
  request: Request,
  path: string
): Promise<Response> | undefined {
  if (path !== PATH) return undefined;
  return (async () => {
    if (request.method === 'GET') return read(ctx, request);
    if (request.method === 'PUT') return replace(ctx, request);
    throw methodNotAllowed('GET, PUT');
  })();
}

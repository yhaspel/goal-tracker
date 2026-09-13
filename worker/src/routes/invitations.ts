import {
  type CreatedInvitationResponse,
  type InvitationListResponse,
  jsonData,
  type RevokedInvitationResponse
} from '../../../shared/api';
import { assertCsrf, requireOwner } from '../auth/authorize';
import { newId, randomHex, sha256Hex } from '../auth/crypto';
import { normalizeEmail } from '../auth/email';
import {
  findInvitationById,
  findUserByEmail,
  insertInvitation,
  invitationStatus,
  isEmailAllowed,
  listInvitations,
  revokeInvitation
} from '../db/account-repository';
import {
  assertOnlyKeys,
  assertSameOrigin,
  conflict,
  invalidRequest,
  methodNotAllowed,
  notFound,
  readJsonObject
} from '../http';
import { securityEvent } from '../security-log';
import { INVITATION_TTL_MS } from './auth';
import type { RouteContext } from './context';

const COLLECTION = '/api/v1/invitations';
const ITEM = /^\/api\/v1\/invitations\/([^/]+)$/;

function list(ctx: RouteContext, request: Request): Response {
  requireOwner(ctx, request);
  // Codes and digests are never returned here; a code exists in plaintext only in the
  // response that created it.
  const invitations = listInvitations(ctx.sql).map(row => ({
    id: row.id,
    email: row.email_norm,
    expiresAt: row.expires_at,
    status: invitationStatus(row, ctx.nowIso)
  }));
  return jsonData<InvitationListResponse>({ invitations });
}

async function create(ctx: RouteContext, request: Request): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireOwner(ctx, request);
  assertCsrf(ctx, request, actor);

  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['email']);
  const email = normalizeEmail(body.email);
  if (email === null) throw invalidRequest('Enter a valid email address.', { email: 'invalid_email' });

  // 16 random bytes rendered as 32 hex characters: the 128 bits the plan requires. Only the
  // SHA-256 digest is stored.
  const inviteCode = randomHex(16);
  const codeDigest = sha256Hex(inviteCode);
  const id = newId();
  const expiresAt = new Date(ctx.now.getTime() + INVITATION_TTL_MS).toISOString();

  ctx.storage.transactionSync(() => {
    if (!isEmailAllowed(ctx.sql, email)) {
      throw conflict('email_not_allowed', 'Add that address to the allowed list before inviting it.');
    }
    // A deactivated account keeps its row forever, so its address can never be re-registered.
    if (findUserByEmail(ctx.sql, email)) {
      throw conflict('email_taken', 'That email address already has an account.');
    }
    insertInvitation(ctx.sql, {
      id,
      email_norm: email,
      code_digest: codeDigest,
      created_by: actor.user.id,
      created_at: ctx.nowIso,
      expires_at: expiresAt,
      consumed_at: null,
      revoked_at: null
    });
  });

  securityEvent('invitation.create', 'allowed', { userId: actor.user.id });
  return jsonData<CreatedInvitationResponse>({ id, email, inviteCode, expiresAt }, 201);
}

function revoke(ctx: RouteContext, request: Request, id: string): Response {
  assertSameOrigin(request);
  const actor = requireOwner(ctx, request);
  assertCsrf(ctx, request, actor);

  ctx.storage.transactionSync(() => {
    const invitation = findInvitationById(ctx.sql, id);
    if (!invitation) throw notFound();
    if (invitation.consumed_at !== null) {
      throw conflict('invitation_consumed', 'That invitation has already been used.');
    }
    // Revoking an already revoked invitation is a no-op and still reports success.
    revokeInvitation(ctx.sql, id, ctx.nowIso);
  });

  securityEvent('invitation.revoke', 'allowed', { userId: actor.user.id });
  return jsonData<RevokedInvitationResponse>({ revoked: true });
}

export function handleInvitationRoute(ctx: RouteContext, request: Request, path: string): Promise<Response> | undefined {
  if (path === COLLECTION) {
    return (async () => {
      if (request.method === 'GET') return list(ctx, request);
      if (request.method === 'POST') return create(ctx, request);
      throw methodNotAllowed('GET, POST');
    })();
  }
  const match = ITEM.exec(path);
  if (!match) return undefined;
  const id = match[1]!;
  return (async () => {
    if (request.method === 'DELETE') return revoke(ctx, request, id);
    throw methodNotAllowed('DELETE');
  })();
}

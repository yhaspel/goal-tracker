import type { SessionUser } from '../../../shared/api';
import { findLiveSessionByDigest, type LiveSession } from '../db/account-repository';
import { forbidden, unauthenticated } from '../http';
import { type RouteContext, requireSecrets } from '../routes/context';
import { CSRF_HEADER, csrfToken, csrfTokenMatches } from './csrf';
import { readSessionToken, sessionTokenDigest } from './sessions';

export type Actor = LiveSession;

/**
 * Resolves the caller's live session. Returns undefined when the cookie is missing, expired,
 * revoked, belongs to a deactivated account, or belongs to an account whose email is no
 * longer on the allowed list. Every caller re-runs this inside the Durable Object; hiding a
 * control in the UI is never an authorization decision.
 */
export function currentActor(ctx: RouteContext, request: Request): Actor | undefined {
  const token = readSessionToken(request);
  if (token === null) return undefined;
  return findLiveSessionByDigest(ctx.sql, sessionTokenDigest(token), ctx.nowIso);
}

export function requireActor(ctx: RouteContext, request: Request): Actor {
  const actor = currentActor(ctx, request);
  if (!actor) throw unauthenticated();
  return actor;
}

export function requireOwner(ctx: RouteContext, request: Request): Actor {
  const actor = requireActor(ctx, request);
  if (actor.user.role !== 'owner') throw forbidden();
  return actor;
}

/** Bootstrap, registration, and login are guest-only; sign out first with CSRF. */
export function assertNoLiveSession(ctx: RouteContext, request: Request): void {
  if (currentActor(ctx, request)) {
    throw forbidden('already_authenticated', 'You are already signed in. Sign out before continuing.');
  }
}

export function assertCsrf(ctx: RouteContext, request: Request, actor: Actor): void {
  const { csrf } = requireSecrets(ctx.env);
  if (!csrfTokenMatches(csrf, actor.session.id, actor.session.token_digest, request.headers.get(CSRF_HEADER))) {
    throw forbidden('forbidden', 'This request could not be verified. Reload the page and try again.');
  }
}

export function actorCsrfToken(ctx: RouteContext, actor: Actor): string {
  const { csrf } = requireSecrets(ctx.env);
  return csrfToken(csrf, actor.session.id, actor.session.token_digest);
}

/** The only user shape an API response may contain. No credential material is included. */
export function publicUser(user: Actor['user']): SessionUser {
  return { id: user.id, email: user.email_norm, role: user.role, status: user.status, language: user.language };
}

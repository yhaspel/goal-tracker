import { constantTimeEquals, hmacBase64Url } from './crypto';

export const CSRF_HEADER = 'X-CSRF-Token';

/**
 * The CSRF value is derived from the live session rather than stored, so it is reissuable
 * from `GET /api/v1/auth/session` after a page refresh and dies with the session. It binds
 * to both the session id and its token digest, so a rotated session cannot reuse an old one.
 */
export function csrfToken(secret: string, sessionId: string, sessionTokenDigest: string): string {
  return hmacBase64Url(secret, `csrf-v1|${sessionId}|${sessionTokenDigest}`);
}

export function csrfTokenMatches(
  secret: string,
  sessionId: string,
  sessionTokenDigest: string,
  provided: string | null
): boolean {
  if (provided === null || provided.length === 0) return false;
  return constantTimeEquals(csrfToken(secret, sessionId, sessionTokenDigest), provided);
}

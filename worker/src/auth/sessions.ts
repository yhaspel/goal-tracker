import { randomToken, sha256Hex } from './crypto';

// `__Host-` requires Secure, Path=/, and no Domain attribute, which pins the cookie to this
// exact host and blocks a sibling subdomain from setting it.
export const SESSION_COOKIE_NAME = '__Host-kanban_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const COOKIE_ATTRIBUTES = 'Secure; HttpOnly; SameSite=Lax; Path=/';

export function newSessionToken(): string {
  return randomToken(32);
}

export function sessionTokenDigest(token: string): string {
  return sha256Hex(token);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** Reads the session token from the request cookie header. Never from a URL or body. */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    const value = pair.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

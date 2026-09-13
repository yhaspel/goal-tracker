import { createHmac, randomBytes } from 'node:crypto';

/**
 * Deliberately dependency-free apart from `node:crypto`.
 *
 * Both the Durable Object and the operator's local `scripts/create-operator-reset-token.ts`
 * import this module, so the token derivation exists exactly once. A rescue fails silently
 * and confusingly if the two ever disagree, which is what a second copy of these four lines
 * would eventually cause.
 *
 * Operator reset tokens are signed with the same Cloudflare secret as recovery phrases but
 * under a different domain prefix, so a value derived for one purpose can never be replayed
 * as the other. Bump the version if the derivation changes.
 */
const OPERATOR_TOKEN_PREFIX = 'operator-token:v1|';

/** Short enough that an intercepted token is nearly useless, long enough to pass on by voice. */
export const OPERATOR_TOKEN_TTL_MS = 15 * 60 * 1000;

export function newOperatorToken(): string {
  return Buffer.from(randomBytes(32)).toString('base64url');
}

export function operatorTokenDigest(digestKey: string, token: string): string {
  return createHmac('sha256', digestKey).update(`${OPERATOR_TOKEN_PREFIX}${token}`, 'utf8').digest('hex');
}

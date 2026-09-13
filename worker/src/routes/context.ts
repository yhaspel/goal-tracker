import type { KdfQueue } from '../auth/kdf-queue';
import { unavailable } from '../http';
import type { Env } from '../index';

/**
 * Per-request handles. `now` is captured once so every timestamp written by one request is
 * identical, which keeps expiry comparisons and revision bookkeeping consistent.
 */
export type RouteContext = {
  sql: SqlStorage;
  storage: DurableObjectStorage;
  env: Env;
  kdf: KdfQueue;
  now: Date;
  nowIso: string;
  /** The applied migration version. The backup envelope records it and import compares it. */
  schemaVersion: number;
};

export type Secrets = { csrf: string; recoveryDigest: string; rateLimit: string };

/**
 * Fails closed. Without these secrets the Durable Object cannot issue a CSRF value, digest a
 * recovery phrase, or pseudonymise a rate-limit bucket, so it refuses the request instead of
 * falling back to a weaker derivation.
 */
export function requireSecrets(env: Env): Secrets {
  const { CSRF_SECRET, RECOVERY_DIGEST_KEY, RATE_LIMIT_KEY } = env;
  if (!CSRF_SECRET || !RECOVERY_DIGEST_KEY || !RATE_LIMIT_KEY) throw unavailable();
  return { csrf: CSRF_SECRET, recoveryDigest: RECOVERY_DIGEST_KEY, rateLimit: RATE_LIMIT_KEY };
}

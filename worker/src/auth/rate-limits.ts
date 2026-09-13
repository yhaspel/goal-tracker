import { hmacHex } from './crypto';

export type RateRule = { limit: number; windowMs: number };

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Stage 2 starting values. Login counts only failures, so a member typing one wrong
 * password is not locked out by their own successful sign-ins. Bootstrap and registration
 * prepare count every attempt, because each one can trigger a scrypt derivation.
 */
export const RATE_RULES = {
  loginPerEmail: { limit: 5, windowMs: FIFTEEN_MINUTES },
  loginPerIp: { limit: 30, windowMs: FIFTEEN_MINUTES },
  bootstrapPerIp: { limit: 5, windowMs: FIFTEEN_MINUTES },
  registrationPreparePerIp: { limit: 10, windowMs: FIFTEEN_MINUTES },
  registrationConfirmPerIp: { limit: 30, windowMs: FIFTEEN_MINUTES }
} as const satisfies Record<string, RateRule>;

export type RateDecision = { allowed: boolean; retryAfterSeconds: number };

/**
 * Cloudflare sets `CF-Connecting-IP` at the edge and overwrites any client-supplied value,
 * so it is the only forwarding header this project trusts. `X-Forwarded-For` and friends are
 * ignored deliberately. Requests without it (local `wrangler dev`, Workers-runtime tests)
 * share one bucket; tests that need distinct per-IP buckets set the header explicitly.
 */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/** Buckets are keyed by an HMAC, so no raw email address or IP is ever written to SQL. */
export function rateLimitKey(secret: string, scope: string, subject: string): string {
  return hmacHex(secret, `rate-v1|${scope}|${subject}`);
}

function windowStartMs(now: Date, windowMs: number): number {
  return Math.floor(now.getTime() / windowMs) * windowMs;
}

function retryAfterSeconds(now: Date, windowMs: number): number {
  const elapsed = now.getTime() - windowStartMs(now, windowMs);
  return Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
}

function currentCount(sql: SqlStorage, key: string, rule: RateRule, now: Date): number {
  const row = [...sql.exec<{ window_start: string; count: number }>(
    'SELECT window_start, count FROM rate_limits WHERE bucket_key = ?',
    key
  )][0];
  if (!row) return 0;
  return row.window_start === new Date(windowStartMs(now, rule.windowMs)).toISOString() ? row.count : 0;
}

/** Reads a bucket without charging it. Used before an expensive verification. */
export function checkRateLimit(sql: SqlStorage, key: string, rule: RateRule, now: Date): RateDecision {
  const allowed = currentCount(sql, key, rule, now) < rule.limit;
  return { allowed, retryAfterSeconds: allowed ? 0 : retryAfterSeconds(now, rule.windowMs) };
}

/** Charges a bucket and reports whether the caller stays within the limit. */
export function consumeRateLimit(sql: SqlStorage, key: string, rule: RateRule, now: Date): RateDecision {
  const start = new Date(windowStartMs(now, rule.windowMs)).toISOString();
  const expires = new Date(windowStartMs(now, rule.windowMs) + rule.windowMs).toISOString();
  sql.exec(
    `INSERT INTO rate_limits (bucket_key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
     ON CONFLICT (bucket_key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start,
       expires_at = excluded.expires_at`,
    key,
    start,
    expires
  );
  const count = currentCount(sql, key, rule, now);
  const allowed = count <= rule.limit;
  return { allowed, retryAfterSeconds: allowed ? 0 : retryAfterSeconds(now, rule.windowMs) };
}

/**
 * Opportunistic bounded cleanup. Expired counters carry no credential state, so dropping
 * them early is always safe.
 */
export function pruneRateLimits(sql: SqlStorage, now: Date, limit = 50): void {
  sql.exec(
    `DELETE FROM rate_limits WHERE bucket_key IN (
       SELECT bucket_key FROM rate_limits WHERE expires_at <= ? LIMIT ${limit}
     )`,
    now.toISOString()
  );
}

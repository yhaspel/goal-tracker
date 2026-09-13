import { env, runInDurableObject } from 'cloudflare:test';
import { newOperatorToken, OPERATOR_TOKEN_TTL_MS, operatorTokenDigest } from '../../worker/src/auth/operator-tokens';

/**
 * Runs a callback inside the household Durable Object with direct SQL access. Tests use this
 * to stand in for an operator working in Data Studio, and to age rows that would otherwise
 * need a real clock to expire.
 */
export function inHousehold<T>(callback: (sql: SqlStorage) => T): Promise<T> {
  const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household'));
  return runInDurableObject(stub, (_instance, state) => callback(state.storage.sql));
}

export function digestKey(): string {
  const key = env.RECOVERY_DIGEST_KEY;
  if (!key) throw new Error('the test environment must bind RECOVERY_DIGEST_KEY');
  return key;
}

export type OperatorTokenOptions = {
  /** Defaults to the account's current epoch. */
  epoch?: number;
  /** Negative values create an already-expired token. */
  expiresInMs?: number;
  consumed?: boolean;
};

/**
 * Inserts an operator reset token exactly the way `docs/operator-lost-phrase-reset.md` tells
 * an operator to, and returns the raw token that the runbook hands over offline.
 */
export async function insertOperatorToken(userId: string, options: OperatorTokenOptions = {}): Promise<string> {
  const token = newOperatorToken();
  const tokenDigest = operatorTokenDigest(digestKey(), token);
  const now = Date.now();
  const expiresAt = new Date(now + (options.expiresInMs ?? OPERATOR_TOKEN_TTL_MS)).toISOString();
  await inHousehold(sql => {
    const epoch =
      options.epoch ??
      [...sql.exec<{ credential_epoch: number }>('SELECT credential_epoch FROM users WHERE id = ?', userId)][0]
        ?.credential_epoch ??
      1;
    sql.exec(
      `INSERT INTO operator_reset_tokens
         (id, user_id, token_digest, expected_credential_epoch, created_at, expires_at, consumed_at, issued_by, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'test-operator', 'automated test')`,
      crypto.randomUUID(),
      userId,
      tokenDigest,
      epoch,
      new Date(now).toISOString(),
      expiresAt,
      options.consumed === true ? new Date(now).toISOString() : null
    );
  });
  return token;
}

export function countOperatorTokens(userId: string): Promise<number> {
  return inHousehold(
    sql =>
      [...sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM operator_reset_tokens WHERE user_id = ?', userId)][0]
        ?.total ?? 0
  );
}

export function countPendingRotations(userId: string): Promise<number> {
  return inHousehold(
    sql =>
      [...sql.exec<{ total: number }>(
        'SELECT COUNT(*) AS total FROM pending_credential_rotations WHERE user_id = ?',
        userId
      )][0]?.total ?? 0
  );
}

/** Ages every outstanding challenge for an account so the expiry branch can be exercised. */
export function expirePendingRotations(userId: string): Promise<void> {
  return inHousehold(sql => {
    sql.exec(
      'UPDATE pending_credential_rotations SET expires_at = ? WHERE user_id = ?',
      new Date(Date.now() - 1000).toISOString(),
      userId
    );
  });
}

export function credentialEpoch(userId: string): Promise<number> {
  return inHousehold(
    sql =>
      [...sql.exec<{ credential_epoch: number }>('SELECT credential_epoch FROM users WHERE id = ?', userId)][0]
        ?.credential_epoch ?? 0
  );
}

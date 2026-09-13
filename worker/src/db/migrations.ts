export const SCHEMA_VERSION = 4;

/**
 * UTC ISO-8601 with milliseconds, identical in shape to `new Date().toISOString()`.
 * Used where a migration needs a timestamp without bound parameters.
 */
const SQL_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

const migrations = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS diagnostic_probe (
        nonce TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      )`
    ]
  },
  {
    version: 2,
    statements: [
      // Singleton household state. `bootstrap_consumed` closes owner bootstrap permanently;
      // `allowlist_revision` guards concurrent allowed-email replacements.
      `CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        bootstrap_consumed INTEGER NOT NULL DEFAULT 0 CHECK (bootstrap_consumed IN (0, 1)),
        allowlist_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `INSERT OR IGNORE INTO app_state (id, bootstrap_consumed, allowlist_revision, created_at)
        VALUES (1, 0, 0, ${SQL_NOW})`,

      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email_norm TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
        status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
        language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'he', 'ru')),
        credential_epoch INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      // Belt and braces with the bootstrap transaction: at most one owner row can ever exist.
      `CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON users (role) WHERE role = 'owner'`,
      `CREATE INDEX IF NOT EXISTS users_status ON users (status)`,

      `CREATE TABLE IF NOT EXISTS allowed_emails (
        email_norm TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        email_norm TEXT NOT NULL,
        code_digest TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL REFERENCES users (id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        revoked_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS invitations_email ON invitations (email_norm)`,

      // `language` carries the locale chosen at prepare time through to user creation at
      // confirm time. No plaintext password, invite code, pending token, or phrase is stored.
      `CREATE TABLE IF NOT EXISTS pending_registrations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('bootstrap', 'invite')),
        email_norm TEXT NOT NULL,
        invitation_id TEXT REFERENCES invitations (id),
        password_hash TEXT NOT NULL,
        phrase_digest TEXT NOT NULL,
        pending_token_digest TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'he', 'ru')),
        expires_at TEXT NOT NULL,
        failed_confirmations INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS pending_registrations_email ON pending_registrations (email_norm)`,
      `CREATE INDEX IF NOT EXISTS pending_registrations_invitation ON pending_registrations (invitation_id)`,

      `CREATE TABLE IF NOT EXISTS recovery_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users (id),
        phrase_digest TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id),
        token_digest TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
      `CREATE INDEX IF NOT EXISTS sessions_live ON sessions (token_digest, revoked_at, expires_at)`,

      // `bucket_key` is an HMAC of the scope plus the pseudonymised subject, never the raw
      // email or IP address.
      `CREATE TABLE IF NOT EXISTS rate_limits (
        bucket_key TEXT PRIMARY KEY,
        window_start TEXT NOT NULL,
        count INTEGER NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits (expires_at)`
    ]
  },
  {
    version: 3,
    statements: [
      // A token an operator inserts by hand through Durable Object Data Studio after
      // verifying the person offline. Only the domain-separated HMAC digest is stored, and
      // `reason` is a short non-secret audit note.
      `CREATE TABLE IF NOT EXISTS operator_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id),
        token_digest TEXT NOT NULL UNIQUE,
        expected_credential_epoch INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        issued_by TEXT NOT NULL,
        reason TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS operator_reset_tokens_user ON operator_reset_tokens (user_id)`,
      `CREATE INDEX IF NOT EXISTS operator_reset_tokens_expiry ON operator_reset_tokens (expires_at)`,

      // A rotation that has been prepared but not confirmed. It changes nothing on its own:
      // an abandoned or expired row leaves the old password, phrase, and sessions in force.
      // `expected_source_digest` pins the credential the rotation was authorised against —
      // the old phrase digest for `phrase`, the whole password record for `signed_in`, and
      // null for `operator`, which is pinned by its own token instead.
      `CREATE TABLE IF NOT EXISTS pending_credential_rotations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id),
        method TEXT NOT NULL CHECK (method IN ('phrase', 'operator', 'signed_in')),
        challenge_digest TEXT NOT NULL UNIQUE,
        new_password_hash TEXT,
        new_phrase_digest TEXT NOT NULL,
        expected_credential_epoch INTEGER NOT NULL,
        expected_source_digest TEXT,
        source_session_id TEXT REFERENCES sessions (id),
        operator_token_id TEXT REFERENCES operator_reset_tokens (id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS pending_credential_rotations_user ON pending_credential_rotations (user_id)`,
      `CREATE INDEX IF NOT EXISTS pending_credential_rotations_expiry ON pending_credential_rotations (expires_at)`
    ]
  },
  {
    version: 4,
    statements: [
      // One board per household. The revision advances exactly once per state-changing
      // request and is what a stale client's mutation is checked against.
      `CREATE TABLE IF NOT EXISTS board_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL DEFAULT 1
      )`,
      `INSERT OR IGNORE INTO board_state (id, revision) VALUES (1, 1)`,

      // A column carries either a built-in translation key or a literal name the owner typed,
      // never both. A renamed column keeps its literal name in every language.
      `CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        name_key TEXT CHECK (name_key IS NULL OR name_key IN ('todo', 'in_progress', 'done')),
        custom_name TEXT,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((name_key IS NULL) <> (custom_name IS NULL))
      )`,
      `CREATE INDEX IF NOT EXISTS columns_position ON columns (position, id)`,

      // Seeded once. `WHERE NOT EXISTS` keeps a re-run or a redeploy from duplicating them,
      // and the ids are fixed so they stay stable for the life of the object.
      `INSERT INTO columns (id, name_key, custom_name, position, created_at, updated_at)
        SELECT '6254d1c5-4638-4516-b645-dcbd1d0ad144', 'todo', NULL, 0, ${SQL_NOW}, ${SQL_NOW}
        WHERE NOT EXISTS (SELECT 1 FROM columns)`,
      `INSERT INTO columns (id, name_key, custom_name, position, created_at, updated_at)
        SELECT '5edbb2b8-8385-4391-8481-8424fed06378', 'in_progress', NULL, 1, ${SQL_NOW}, ${SQL_NOW}
        WHERE NOT EXISTS (SELECT 1 FROM columns WHERE position = 1)`,
      `INSERT INTO columns (id, name_key, custom_name, position, created_at, updated_at)
        SELECT 'd972b74f-e630-4f81-a1c3-44f908dae82d', 'done', NULL, 2, ${SQL_NOW}, ${SQL_NOW}
        WHERE NOT EXISTS (SELECT 1 FROM columns WHERE position = 2)`,

      // Users are deactivated rather than deleted, so `creator_user_id` stays resolvable for
      // the life of the card.
      `CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL REFERENCES columns (id),
        title TEXT NOT NULL,
        description TEXT,
        assignee_user_id TEXT REFERENCES users (id),
        creator_user_id TEXT NOT NULL REFERENCES users (id),
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS cards_order ON cards (column_id, position, id)`,
      `CREATE INDEX IF NOT EXISTS cards_assignee ON cards (assignee_user_id)`
    ]
  }
] as const;

export function migrate(sql: SqlStorage, storage: DurableObjectStorage): number {
  storage.transactionSync(() => {
    sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
    const applied = new Set(
      [...sql.exec<{ version: number }>('SELECT version FROM schema_migrations')].map(row => row.version)
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) sql.exec(statement);
      sql.exec(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        migration.version,
        new Date().toISOString()
      );
    }
  });
  return [...sql.exec<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations')][0]?.version ?? 0;
}

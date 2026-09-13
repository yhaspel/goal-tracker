import { type BackupPayload, canonicalJson, validateBackupIntegrity } from '../../../shared/backup';
import { SEED_BOARD_REVISION, SEED_COLUMNS } from '../db/migrations';
import { conflict, HttpError } from '../http';
import { BACKUP_LIMITS } from './export';

/**
 * Restores one backup into a pristine isolated object.
 *
 * The marker table is created here rather than by a migration on purpose. `migrations.ts` is
 * one ordered list applied identically in every environment, so a version 5 would force
 * production to grow a table it must never have and would make every existing schema-4 backup
 * incompatible with its own restore target. Creating it in the restore-only import path keeps
 * the shared schema at 4 everywhere.
 */

const MARKER_TABLE = `CREATE TABLE IF NOT EXISTS restore_import_marker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  imported_at TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  household_id TEXT NOT NULL,
  source_created_at TEXT NOT NULL,
  digest TEXT NOT NULL,
  counts TEXT NOT NULL
)`;

/** Every table a pristine object must have no rows in. */
const MUST_BE_EMPTY = [
  'users',
  'allowed_emails',
  'cards',
  'invitations',
  'recovery_credentials',
  'sessions',
  'pending_registrations',
  'pending_credential_rotations',
  'operator_reset_tokens',
  'restore_import_marker'
] as const;

export type ImportResult = {
  boardRevision: number;
  schemaVersion: number;
  counts: BackupPayload['counts'];
};

export function ensureMarkerTable(sql: SqlStorage): void {
  sql.exec(MARKER_TABLE);
}

function count(sql: SqlStorage, table: string): number {
  return [...sql.exec<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`)][0]?.total ?? 0;
}

/**
 * Returns every reason the target is not pristine. Run before the transaction to refuse
 * cheaply, and again inside it so a concurrent write cannot slip in between.
 */
export function pristineIssues(sql: SqlStorage): string[] {
  const issues: string[] = [];
  for (const table of MUST_BE_EMPTY) {
    const rows = count(sql, table);
    if (rows !== 0) issues.push(`${table} already holds ${rows} row(s)`);
  }

  const columns = [...sql.exec<{ id: string; name_key: string | null; position: number }>(
    'SELECT id, name_key, position FROM columns ORDER BY position, id'
  )];
  const seedMatches =
    columns.length === SEED_COLUMNS.length &&
    columns.every((column, index) => {
      const seed = SEED_COLUMNS[index];
      return seed !== undefined && column.id === seed.id && column.name_key === seed.nameKey && column.position === seed.position;
    });
  if (!seedMatches) issues.push('the columns table is not the untouched three-column seed');

  const board = [...sql.exec<{ revision: number }>('SELECT revision FROM board_state WHERE id = 1')][0];
  if (!board) issues.push('board_state singleton row is missing');
  else if (board.revision !== SEED_BOARD_REVISION) {
    issues.push(`the board is at revision ${board.revision}, not the seed revision ${SEED_BOARD_REVISION}`);
  }

  const app = [...sql.exec<{ bootstrap_consumed: number; allowlist_revision: number }>(
    'SELECT bootstrap_consumed, allowlist_revision FROM app_state WHERE id = 1'
  )][0];
  if (!app) issues.push('app_state singleton row is missing');
  else {
    if (app.bootstrap_consumed !== 0) issues.push('bootstrap has already been consumed on this object');
    if (app.allowlist_revision !== 0) issues.push(`the allowed list is at revision ${app.allowlist_revision}, not 0`);
  }

  return issues;
}

/**
 * Applies one verified payload. The caller has already checked the digest, the format version,
 * the household identifier and the schema version; this repeats the integrity rules and the
 * pristine condition, then writes everything inside one synchronous transaction.
 *
 * Rows are inserted in dependency order — allowed emails, users, recovery credentials,
 * invitations, columns, cards — rather than relying on how Durable Object SQLite happens to
 * treat foreign keys.
 */
export function importBackup(
  storage: DurableObjectStorage,
  sql: SqlStorage,
  payload: BackupPayload,
  meta: { digest: string; importedAt: string; targetSchemaVersion: number }
): ImportResult {
  if (!payload.integrity.ok) {
    throw new HttpError(
      400,
      'backup_integrity_failed',
      `That backup records its own integrity as failed: ${payload.integrity.issues[0] ?? 'no reason recorded'}.`
    );
  }
  const issues = validateBackupIntegrity(payload, BACKUP_LIMITS);
  if (issues.length > 0) throw new HttpError(400, 'backup_invalid', `That backup failed validation: ${issues[0]}.`);

  ensureMarkerTable(sql);
  const notPristine = pristineIssues(sql);
  if (notPristine.length > 0) {
    throw conflict('restore_target_not_pristine', `The restore target is not pristine: ${notPristine[0]}`);
  }

  return storage.transactionSync(() => {
    const stillNotPristine = pristineIssues(sql);
    if (stillNotPristine.length > 0) {
      throw conflict('restore_target_not_pristine', `The restore target is not pristine: ${stillNotPristine[0]}`);
    }

    // The seed columns share ids with the exported ones, so they go before the inserts.
    sql.exec('DELETE FROM columns');

    sql.exec(
      'UPDATE app_state SET bootstrap_consumed = ?, allowlist_revision = ? WHERE id = 1',
      payload.appState.bootstrapConsumed,
      payload.appState.allowlistRevision
    );

    for (const entry of payload.allowedEmails) {
      sql.exec(
        'INSERT INTO allowed_emails (email_norm, created_at) VALUES (?, ?)',
        entry.emailNorm,
        entry.createdAt
      );
    }

    for (const user of payload.users) {
      sql.exec(
        `INSERT INTO users
           (id, email_norm, password_hash, role, status, language, credential_epoch, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        user.id,
        user.emailNorm,
        user.passwordHash,
        user.role,
        user.status,
        user.language,
        user.credentialEpoch,
        user.createdAt,
        user.updatedAt
      );
    }

    for (const credential of payload.recoveryCredentials) {
      sql.exec(
        'INSERT INTO recovery_credentials (user_id, phrase_digest, version, created_at) VALUES (?, ?, ?, ?)',
        credential.userId,
        credential.phraseDigest,
        credential.version,
        credential.createdAt
      );
    }

    for (const invitation of payload.invitations) {
      sql.exec(
        `INSERT INTO invitations
           (id, email_norm, code_digest, created_by, created_at, expires_at, consumed_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        invitation.id,
        invitation.emailNorm,
        invitation.codeDigest,
        invitation.createdBy,
        invitation.createdAt,
        invitation.expiresAt,
        invitation.consumedAt,
        invitation.revokedAt
      );
    }

    for (const column of payload.columns) {
      sql.exec(
        'INSERT INTO columns (id, name_key, custom_name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        column.id,
        column.nameKey,
        column.customName,
        column.position,
        column.createdAt,
        column.updatedAt
      );
    }

    for (const card of payload.cards) {
      sql.exec(
        `INSERT INTO cards
           (id, column_id, title, description, assignee_user_id, creator_user_id, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        card.id,
        card.columnId,
        card.title,
        card.description,
        card.assigneeUserId,
        card.creatorUserId,
        card.position,
        card.createdAt,
        card.updatedAt
      );
    }

    sql.exec('UPDATE board_state SET revision = ? WHERE id = 1', payload.boardState.revision);

    sql.exec(
      `INSERT INTO restore_import_marker
         (id, imported_at, format_version, schema_version, household_id, source_created_at, digest, counts)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      meta.importedAt,
      payload.formatVersion,
      payload.schemaVersion,
      payload.householdId,
      payload.createdAt,
      meta.digest,
      canonicalJson(payload.counts)
    );

    return {
      boardRevision: payload.boardState.revision,
      schemaVersion: meta.targetSchemaVersion,
      counts: payload.counts
    };
  });
}

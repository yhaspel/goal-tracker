import {
  BACKUP_FORMAT_VERSION,
  type BackupCard,
  type BackupColumn,
  type BackupInvitation,
  type BackupLimits,
  type BackupPayload,
  type BackupRecoveryCredential,
  type BackupUser,
  validateBackupIntegrity
} from '../../../shared/backup';
import { MAX_CARDS, MAX_COLUMNS } from '../board/repository';
import { MAX_ACTIVE_USERS, MAX_ALLOWED_EMAILS } from '../db/account-repository';

/**
 * Builds one backup payload from the household's SQL.
 *
 * Every read happens in one synchronous pass with no `await` between statements, so the rows
 * come from a single coherent snapshot and records can never be mixed across board revisions.
 * Nothing here writes, and nothing here touches `sessions`, `rate_limits`,
 * `pending_registrations`, `pending_credential_rotations`, `operator_reset_tokens`,
 * `schema_migrations`, or `diagnostic_probe`.
 */

export const BACKUP_LIMITS: BackupLimits = {
  maxActiveUsers: MAX_ACTIVE_USERS,
  maxAllowedEmails: MAX_ALLOWED_EMAILS,
  maxColumns: MAX_COLUMNS,
  maxCards: MAX_CARDS
};

/** Deliberately explicit: adding a column to a migration must break a test, not lose data. */
type AppStateRow = { bootstrap_consumed: number; allowlist_revision: number };
type BoardStateRow = { revision: number };
type AllowedEmailRow = { email_norm: string; created_at: string };
type UserRow = {
  id: string;
  email_norm: string;
  password_hash: string;
  role: string;
  status: string;
  language: string;
  credential_epoch: number;
  created_at: string;
  updated_at: string;
};
type RecoveryRow = { user_id: string; phrase_digest: string; version: number; created_at: string };
type InvitationRow = {
  id: string;
  email_norm: string;
  code_digest: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};
type ColumnRow = {
  id: string;
  name_key: string | null;
  custom_name: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};
type CardRow = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee_user_id: string | null;
  creator_user_id: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export function buildBackupPayload(
  sql: SqlStorage,
  options: { schemaVersion: number; householdId: string; createdAt: string }
): BackupPayload {
  const appState = [...sql.exec<AppStateRow>(
    'SELECT bootstrap_consumed, allowlist_revision FROM app_state WHERE id = 1'
  )][0];
  if (!appState) throw new Error('app_state singleton row is missing');
  const boardState = [...sql.exec<BoardStateRow>('SELECT revision FROM board_state WHERE id = 1')][0];
  if (!boardState) throw new Error('board_state singleton row is missing');

  const allowedEmails = [...sql.exec<AllowedEmailRow>(
    'SELECT email_norm, created_at FROM allowed_emails ORDER BY email_norm'
  )].map(row => ({ emailNorm: row.email_norm, createdAt: row.created_at }));

  const users: BackupUser[] = [...sql.exec<UserRow>(
    `SELECT id, email_norm, password_hash, role, status, language, credential_epoch, created_at, updated_at
       FROM users ORDER BY id`
  )].map(row => ({
    id: row.id,
    emailNorm: row.email_norm,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    language: row.language,
    credentialEpoch: row.credential_epoch,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const recoveryCredentials: BackupRecoveryCredential[] = [...sql.exec<RecoveryRow>(
    'SELECT user_id, phrase_digest, version, created_at FROM recovery_credentials ORDER BY user_id'
  )].map(row => ({
    userId: row.user_id,
    phraseDigest: row.phrase_digest,
    version: row.version,
    createdAt: row.created_at
  }));

  const invitations: BackupInvitation[] = [...sql.exec<InvitationRow>(
    `SELECT id, email_norm, code_digest, created_by, created_at, expires_at, consumed_at, revoked_at
       FROM invitations ORDER BY id`
  )].map(row => ({
    id: row.id,
    emailNorm: row.email_norm,
    codeDigest: row.code_digest,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at
  }));

  const columns: BackupColumn[] = [...sql.exec<ColumnRow>(
    `SELECT id, name_key, custom_name, position, created_at, updated_at
       FROM columns ORDER BY position, id`
  )].map(row => ({
    id: row.id,
    nameKey: row.name_key,
    customName: row.custom_name,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const cards: BackupCard[] = [...sql.exec<CardRow>(
    `SELECT id, column_id, title, description, assignee_user_id, creator_user_id, position, created_at, updated_at
       FROM cards ORDER BY column_id, position, id`
  )].map(row => ({
    id: row.id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    assigneeUserId: row.assignee_user_id,
    creatorUserId: row.creator_user_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const payload: BackupPayload = {
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: options.schemaVersion,
    householdId: options.householdId,
    createdAt: options.createdAt,
    counts: {
      allowedEmails: allowedEmails.length,
      users: users.length,
      activeUsers: users.filter(user => user.status === 'active').length,
      recoveryCredentials: recoveryCredentials.length,
      invitations: invitations.length,
      columns: columns.length,
      cards: cards.length
    },
    // Replaced below. The field exists first so the payload shape is complete in one place.
    integrity: { ok: true, issues: [] },
    appState: {
      bootstrapConsumed: appState.bootstrap_consumed,
      allowlistRevision: appState.allowlist_revision
    },
    boardState: { revision: boardState.revision },
    allowedEmails,
    users,
    recoveryCredentials,
    invitations,
    columns,
    cards
  };

  const issues = validateBackupIntegrity(payload, BACKUP_LIMITS);
  payload.integrity = { ok: issues.length === 0, issues };
  return payload;
}

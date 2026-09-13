import {
  BACKUP_FORMAT_VERSION,
  type BackupCard,
  type BackupColumn,
  type BackupGoal,
  type BackupImageBytes,
  type BackupInvitation,
  type BackupLimits,
  type BackupMilestone,
  type BackupPayload,
  type BackupRecoveryCredential,
  type BackupUser,
  type BackupVisionImage,
  validateBackupIntegrity
} from '../../../shared/backup';
import { MAX_CARDS, MAX_COLUMNS } from '../board/repository';
import { MAX_ACTIVE_USERS, MAX_ALLOWED_EMAILS } from '../db/account-repository';
import { MAX_GOALS, MAX_MILESTONES } from '../goals/repository';
import { MAX_VISION_IMAGES } from '../vision/repository';
import { encodeBase64, MAX_VISION_TOTAL_BYTES } from '../vision/service';

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
  maxCards: MAX_CARDS,
  maxGoals: MAX_GOALS,
  maxMilestones: MAX_MILESTONES,
  maxVisionImages: MAX_VISION_IMAGES,
  maxVisionTotalBytes: MAX_VISION_TOTAL_BYTES
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
  due_date: string | null;
  milestone_id: string | null;
  created_at: string;
  updated_at: string;
};
type GoalStateRow = { revision: number };
type VisionStateRow = { revision: number; bytes_used: number };
type GoalRow = {
  id: string;
  year: number;
  title: string;
  notes: string | null;
  position: number;
  creator_user_id: string;
  created_at: string;
  updated_at: string;
};
type MilestoneRow = {
  id: string;
  goal_id: string;
  month: number;
  title: string;
  notes: string | null;
  status: string;
  position: number;
  creator_user_id: string;
  created_at: string;
  updated_at: string;
};
/** Metadata only. A BLOB never enters the envelope; the paged image routes carry the bytes. */
type VisionImageRow = {
  id: string;
  caption: string | null;
  goal_id: string | null;
  media_type: string;
  byte_size: number;
  width: number;
  height: number;
  content_digest: string;
  thumb_media_type: string;
  thumb_byte_size: number;
  thumb_width: number;
  thumb_height: number;
  thumb_digest: string;
  position: number;
  creator_user_id: string;
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
    `SELECT id, column_id, title, description, assignee_user_id, creator_user_id, position,
            due_date, milestone_id, created_at, updated_at
       FROM cards ORDER BY column_id, position, id`
  )].map(row => ({
    id: row.id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    assigneeUserId: row.assignee_user_id,
    creatorUserId: row.creator_user_id,
    position: row.position,
    dueDate: row.due_date,
    milestoneId: row.milestone_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const goalState = [...sql.exec<GoalStateRow>('SELECT revision FROM goal_state WHERE id = 1')][0];
  if (!goalState) throw new Error('goal_state singleton row is missing');
  const visionState = [...sql.exec<VisionStateRow>(
    'SELECT revision, bytes_used FROM vision_state WHERE id = 1'
  )][0];
  if (!visionState) throw new Error('vision_state singleton row is missing');

  const goals: BackupGoal[] = [...sql.exec<GoalRow>(
    `SELECT id, year, title, notes, position, creator_user_id, created_at, updated_at
       FROM goals ORDER BY year, position, id`
  )].map(row => ({
    id: row.id,
    year: row.year,
    title: row.title,
    notes: row.notes,
    position: row.position,
    creatorUserId: row.creator_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const milestones: BackupMilestone[] = [...sql.exec<MilestoneRow>(
    `SELECT id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at
       FROM milestones ORDER BY goal_id, month, position, id`
  )].map(row => ({
    id: row.id,
    goalId: row.goal_id,
    month: row.month,
    title: row.title,
    notes: row.notes,
    status: row.status,
    position: row.position,
    creatorUserId: row.creator_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  // Column-named, and neither `content` nor `thumb` is among them: sixty images would be sixty
  // megabytes pulled into an isolate that then has to serialize them.
  const visionImages: BackupVisionImage[] = [...sql.exec<VisionImageRow>(
    `SELECT id, caption, goal_id, media_type, byte_size, width, height, content_digest,
            thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb_digest,
            position, creator_user_id, created_at, updated_at
       FROM vision_images ORDER BY position, id`
  )].map(row => ({
    id: row.id,
    caption: row.caption,
    goalId: row.goal_id,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    contentDigest: row.content_digest,
    thumbMediaType: row.thumb_media_type,
    thumbByteSize: row.thumb_byte_size,
    thumbWidth: row.thumb_width,
    thumbHeight: row.thumb_height,
    thumbDigest: row.thumb_digest,
    position: row.position,
    creatorUserId: row.creator_user_id,
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
      cards: cards.length,
      goals: goals.length,
      milestones: milestones.length,
      visionImages: visionImages.length
    },
    // Replaced below. The field exists first so the payload shape is complete in one place.
    integrity: { ok: true, issues: [] },
    appState: {
      bootstrapConsumed: appState.bootstrap_consumed,
      allowlistRevision: appState.allowlist_revision
    },
    boardState: { revision: boardState.revision },
    goalState: { revision: goalState.revision },
    visionState: { revision: visionState.revision, bytesUsed: visionState.bytes_used },
    allowedEmails,
    users,
    recoveryCredentials,
    invitations,
    columns,
    cards,
    goals,
    milestones,
    visionImages
  };

  const issues = validateBackupIntegrity(payload, BACKUP_LIMITS);
  payload.integrity = { ok: issues.length === 0, issues };
  return payload;
}

/**
 * One image's bytes, for the paged export phase.
 *
 * This is the only place outside the member-facing content route that reads a BLOB, and it reads
 * exactly one row. The digests come from the stored columns, so the CLI can check each payload
 * against the envelope without trusting the transfer.
 */
export function readImageForBackup(sql: SqlStorage, id: string): BackupImageBytes | undefined {
  const row = [...sql.exec<{
    id: string;
    media_type: string;
    content: ArrayBuffer;
    content_digest: string;
    thumb_media_type: string;
    thumb: ArrayBuffer;
    thumb_digest: string;
  }>(
    `SELECT id, media_type, content, content_digest, thumb_media_type, thumb, thumb_digest
       FROM vision_images WHERE id = ?`,
    id
  )][0];
  if (!row) return undefined;
  return {
    id: row.id,
    mediaType: row.media_type,
    data: encodeBase64(new Uint8Array(row.content)),
    thumbMediaType: row.thumb_media_type,
    thumbData: encodeBase64(new Uint8Array(row.thumb)),
    contentDigest: row.content_digest,
    thumbDigest: row.thumb_digest
  };
}

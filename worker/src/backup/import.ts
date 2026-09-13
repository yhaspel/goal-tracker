import {
  type BackupImageBytes,
  type BackupPayload,
  canonicalJson,
  validateBackupIntegrity
} from '../../../shared/backup';
import { SEED_BOARD_REVISION, SEED_COLUMNS, SEED_GOAL_REVISION, SEED_VISION_REVISION } from '../db/migrations';
import { conflict, HttpError } from '../http';
import { decodeBase64, sha256Hex } from '../vision/service';
import { BACKUP_LIMITS } from './export';

/**
 * Restores one backup into a pristine isolated object.
 *
 * The marker table is created here rather than by a migration on purpose. `migrations.ts` is one
 * ordered list applied identically in every environment, so putting it there would force
 * production to grow a table it must never have. Creating it in the restore-only import path
 * keeps the shared schema the same everywhere.
 *
 * **A restore is two phases, and only the first is atomic.** The envelope import writes every
 * text row in one transaction and leaves the marker `in_progress`; the image phase then inserts
 * one image per request, each in its own transaction, and `complete` verifies the whole thing
 * before flipping the marker. That is deliberate: image bytes cannot travel inside a 16 MiB JSON
 * envelope, and without a resumable marker one failed image in sixty would strand the operator —
 * a marker blocks a retry, and reusing an object that has one is forbidden.
 */

const MARKER_TABLE = `CREATE TABLE IF NOT EXISTS restore_import_marker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  imported_at TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  household_id TEXT NOT NULL,
  source_created_at TEXT NOT NULL,
  digest TEXT NOT NULL,
  counts TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'complete' CHECK (state IN ('in_progress', 'complete')),
  images_expected INTEGER NOT NULL DEFAULT 0,
  images_imported INTEGER NOT NULL DEFAULT 0
)`;

/**
 * The images the envelope listed but whose bytes have not arrived yet.
 *
 * Restore-only, like the marker, and for the same reason. It exists so a half-finished gallery is
 * never *mistaken* for a finished one: an image appears in `vision_images` only once its real
 * bytes are stored and verified, and what is left to do is exactly the rows still sitting here.
 * `complete` drops it.
 */
const PENDING_IMAGES_TABLE = `CREATE TABLE IF NOT EXISTS restore_pending_images (
  id TEXT PRIMARY KEY,
  caption TEXT,
  goal_id TEXT,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  thumb_media_type TEXT NOT NULL,
  thumb_byte_size INTEGER NOT NULL,
  thumb_width INTEGER NOT NULL,
  thumb_height INTEGER NOT NULL,
  thumb_digest TEXT NOT NULL,
  position INTEGER NOT NULL,
  creator_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  'goals',
  'milestones',
  'vision_images',
  'restore_import_marker',
  'restore_pending_images'
] as const;

export type ImportResult = {
  boardRevision: number;
  goalsRevision: number;
  visionRevision: number;
  schemaVersion: number;
  counts: BackupPayload['counts'];
  imagesExpected: number;
};

export type MarkerState = {
  state: 'in_progress' | 'complete';
  digest: string;
  imagesExpected: number;
  imagesImported: number;
};

export function ensureMarkerTable(sql: SqlStorage): void {
  sql.exec(MARKER_TABLE);
  sql.exec(PENDING_IMAGES_TABLE);
}

export function readMarker(sql: SqlStorage): MarkerState | undefined {
  ensureMarkerTable(sql);
  const row = [...sql.exec<{
    state: 'in_progress' | 'complete';
    digest: string;
    images_expected: number;
    images_imported: number;
  }>('SELECT state, digest, images_expected, images_imported FROM restore_import_marker WHERE id = 1')][0];
  if (!row) return undefined;
  return {
    state: row.state,
    digest: row.digest,
    imagesExpected: row.images_expected,
    imagesImported: row.images_imported
  };
}

function count(sql: SqlStorage, table: string): number {
  return [...sql.exec<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`)][0]?.total ?? 0;
}

/**
 * Returns every reason the target is not pristine. Run before the transaction to refuse cheaply,
 * and again inside it so a concurrent write cannot slip in between.
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

  const goal = [...sql.exec<{ revision: number }>('SELECT revision FROM goal_state WHERE id = 1')][0];
  if (!goal) issues.push('goal_state singleton row is missing');
  else if (goal.revision !== SEED_GOAL_REVISION) {
    issues.push(`the goals are at revision ${goal.revision}, not the seed revision ${SEED_GOAL_REVISION}`);
  }

  const vision = [...sql.exec<{ revision: number; bytes_used: number }>(
    'SELECT revision, bytes_used FROM vision_state WHERE id = 1'
  )][0];
  if (!vision) issues.push('vision_state singleton row is missing');
  else {
    if (vision.revision !== SEED_VISION_REVISION) {
      issues.push(`the vision board is at revision ${vision.revision}, not the seed revision ${SEED_VISION_REVISION}`);
    }
    if (vision.bytes_used !== 0) issues.push(`the image budget already records ${vision.bytes_used} bytes`);
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
 * invitations, columns, goals, milestones, cards — rather than relying on how Durable Object
 * SQLite happens to treat foreign keys. Cards come after milestones because `milestone_id`
 * references one, and vision images after goals for the same reason.
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

    for (const goal of payload.goals) {
      sql.exec(
        `INSERT INTO goals (id, year, title, notes, position, creator_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        goal.id,
        goal.year,
        goal.title,
        goal.notes,
        goal.position,
        goal.creatorUserId,
        goal.createdAt,
        goal.updatedAt
      );
    }

    for (const milestone of payload.milestones) {
      sql.exec(
        `INSERT INTO milestones
           (id, goal_id, month, title, notes, status, position, creator_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        milestone.id,
        milestone.goalId,
        milestone.month,
        milestone.title,
        milestone.notes,
        milestone.status,
        milestone.position,
        milestone.creatorUserId,
        milestone.createdAt,
        milestone.updatedAt
      );
    }

    for (const card of payload.cards) {
      sql.exec(
        `INSERT INTO cards
           (id, column_id, title, description, assignee_user_id, creator_user_id, position,
            due_date, milestone_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        card.id,
        card.columnId,
        card.title,
        card.description,
        card.assigneeUserId,
        card.creatorUserId,
        card.position,
        card.dueDate,
        card.milestoneId,
        card.createdAt,
        card.updatedAt
      );
    }

    sql.exec('UPDATE board_state SET revision = ? WHERE id = 1', payload.boardState.revision);
    sql.exec('UPDATE goal_state SET revision = ? WHERE id = 1', payload.goalState.revision);
    // `bytes_used` stays at zero until the image phase finishes and `complete` recomputes it from
    // the rows that actually landed. A budget written before the bytes arrive would be a lie.
    sql.exec('UPDATE vision_state SET revision = ? WHERE id = 1', payload.visionState.revision);

    // The gallery's metadata is staged rather than inserted: an image joins `vision_images` only
    // once its real bytes have arrived and matched their digest.
    for (const image of payload.visionImages) {
      sql.exec(
        `INSERT INTO restore_pending_images
           (id, caption, goal_id, media_type, byte_size, width, height, content_digest,
            thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb_digest,
            position, creator_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        image.id,
        image.caption,
        image.goalId,
        image.mediaType,
        image.byteSize,
        image.width,
        image.height,
        image.contentDigest,
        image.thumbMediaType,
        image.thumbByteSize,
        image.thumbWidth,
        image.thumbHeight,
        image.thumbDigest,
        image.position,
        image.creatorUserId,
        image.createdAt,
        image.updatedAt
      );
    }

    const expectsImages = payload.visionImages.length > 0;
    sql.exec(
      `INSERT INTO restore_import_marker
         (id, imported_at, format_version, schema_version, household_id, source_created_at, digest, counts,
          state, images_expected, images_imported)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      meta.importedAt,
      payload.formatVersion,
      payload.schemaVersion,
      payload.householdId,
      payload.createdAt,
      meta.digest,
      canonicalJson(payload.counts),
      // A household with no images has nothing left to do, so it is complete straight away.
      expectsImages ? 'in_progress' : 'complete',
      payload.visionImages.length
    );

    return {
      boardRevision: payload.boardState.revision,
      goalsRevision: payload.goalState.revision,
      visionRevision: payload.visionState.revision,
      schemaVersion: meta.targetSchemaVersion,
      counts: payload.counts,
      imagesExpected: payload.visionImages.length
    };
  });
}

/**
 * Inserts one image's bytes.
 *
 * Only while the marker is `in_progress`, only for an id the imported envelope lists, only once
 * per id, and only when the bytes match the digest recorded in that envelope. Each request is its
 * own transaction, so a failure part-way through sixty images loses exactly that one image and
 * the operator retries it rather than starting a 64 MiB restore over on a fresh namespace.
 */
export async function importImage(
  storage: DurableObjectStorage,
  sql: SqlStorage,
  image: BackupImageBytes,
  at: string
): Promise<{ imagesImported: number; imagesExpected: number }> {
  const marker = readMarker(sql);
  if (!marker) throw conflict('restore_not_started', 'No backup has been imported into this object yet.');
  if (marker.state !== 'in_progress') {
    throw conflict('restore_already_complete', 'This restore has already been completed.');
  }

  const expected = [...sql.exec<{
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
  }>('SELECT * FROM restore_pending_images WHERE id = ?', image.id)][0];
  if (!expected) {
    throw new HttpError(404, 'not_found', 'That image is not part of the imported backup, or it is already stored.');
  }

  // Decoded and hashed outside the transaction: hashing is async, and async work inside a
  // `transactionSync` is forbidden.
  const content = decodeBase64(image.data);
  const thumb = decodeBase64(image.thumbData);
  const contentDigest = await sha256Hex(content.buffer);
  const thumbDigest = await sha256Hex(thumb.buffer);
  if (contentDigest !== expected.content_digest || thumbDigest !== expected.thumb_digest) {
    throw new HttpError(400, 'image_digest_mismatch', 'Those bytes do not match the digest the backup recorded.');
  }
  if (content.bytes.byteLength !== expected.byte_size || thumb.bytes.byteLength !== expected.thumb_byte_size) {
    throw new HttpError(400, 'image_digest_mismatch', 'Those bytes are not the size the backup recorded.');
  }

  return storage.transactionSync(() => {
    const fresh = readMarker(sql);
    if (!fresh || fresh.state !== 'in_progress') {
      throw conflict('restore_already_complete', 'This restore has already been completed.');
    }
    // Re-read inside the transaction: two concurrent posts for the same id must insert once.
    const still = [...sql.exec<{ id: string }>('SELECT id FROM restore_pending_images WHERE id = ?', image.id)][0];
    if (!still) throw new HttpError(404, 'not_found', 'That image is already stored.');

    sql.exec(
      `INSERT INTO vision_images
         (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
          thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
          position, creator_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      expected.id,
      expected.caption,
      expected.goal_id,
      expected.media_type,
      expected.byte_size,
      expected.width,
      expected.height,
      content.buffer,
      expected.content_digest,
      expected.thumb_media_type,
      expected.thumb_byte_size,
      expected.thumb_width,
      expected.thumb_height,
      thumb.buffer,
      expected.thumb_digest,
      expected.position,
      expected.creator_user_id,
      expected.created_at,
      expected.updated_at
    );
    sql.exec('DELETE FROM restore_pending_images WHERE id = ?', image.id);
    sql.exec(
      'UPDATE restore_import_marker SET images_imported = images_imported + 1, imported_at = ? WHERE id = 1',
      at
    );
    const after = readMarker(sql)!;
    return { imagesImported: after.imagesImported, imagesExpected: after.imagesExpected };
  });
}

/**
 * Finishes the image phase.
 *
 * Verifies that every listed image landed, recomputes `vision_state.bytes_used` from the rows
 * that are actually stored, refuses to finish if that disagrees with what the envelope recorded,
 * and only then flips the marker to `complete`.
 */
export function completeImport(
  storage: DurableObjectStorage,
  sql: SqlStorage,
  expectedBytesUsed: number
): { imagesImported: number; bytesUsed: number } {
  const marker = readMarker(sql);
  if (!marker) throw conflict('restore_not_started', 'No backup has been imported into this object yet.');

  return storage.transactionSync(() => {
    const fresh = readMarker(sql);
    if (!fresh) throw conflict('restore_not_started', 'No backup has been imported into this object yet.');
    if (fresh.state === 'complete') {
      return { imagesImported: fresh.imagesImported, bytesUsed: readBytesUsed(sql) };
    }

    const outstanding = count(sql, 'restore_pending_images');
    if (outstanding > 0) {
      throw conflict('restore_incomplete', `${outstanding} image(s) have not been sent yet.`);
    }
    const stored = count(sql, 'vision_images');
    if (stored !== fresh.imagesExpected) {
      throw conflict('restore_incomplete', `${stored} images are stored but the backup listed ${fresh.imagesExpected}.`);
    }

    const bytesUsed = [...sql.exec<{ total: number }>(
      'SELECT COALESCE(SUM(byte_size + thumb_byte_size), 0) AS total FROM vision_images'
    )][0]?.total ?? 0;
    if (bytesUsed !== expectedBytesUsed) {
      throw conflict(
        'restore_incomplete',
        `The stored images hold ${bytesUsed} bytes but the backup recorded ${expectedBytesUsed}.`
      );
    }

    sql.exec('UPDATE vision_state SET bytes_used = ? WHERE id = 1', bytesUsed);
    sql.exec("UPDATE restore_import_marker SET state = 'complete' WHERE id = 1");
    sql.exec('DROP TABLE IF EXISTS restore_pending_images');
    return { imagesImported: fresh.imagesImported, bytesUsed };
  });
}

function readBytesUsed(sql: SqlStorage): number {
  return [...sql.exec<{ bytes_used: number }>('SELECT bytes_used FROM vision_state WHERE id = 1')][0]?.bytes_used ?? 0;
}

import type { VisionImage, VisionMediaType } from '../../../shared/api';

/**
 * SQL for the vision board.
 *
 * **`SELECT *` is deliberately not used here, and must not be reintroduced.** `vision_images`
 * holds two BLOB columns, and a sixty-tile gallery is up to sixty megabytes of bytes; a listing
 * that pulled them into the isolate would cost the whole household's object that memory on every
 * read. Exactly one function below reads a BLOB — `readImageContent` — and it reads one row.
 */

export const MAX_VISION_IMAGES = 60;

/** Columns every metadata read names. `content` and `thumb` are absent on purpose. */
const METADATA_COLUMNS = `id, caption, goal_id, media_type, byte_size, width, height, content_digest,
  thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb_digest,
  position, creator_user_id, created_at, updated_at`;

export type ImageRow = {
  id: string;
  caption: string | null;
  goal_id: string | null;
  media_type: VisionMediaType;
  byte_size: number;
  width: number;
  height: number;
  content_digest: string;
  thumb_media_type: VisionMediaType;
  thumb_byte_size: number;
  thumb_width: number;
  thumb_height: number;
  thumb_digest: string;
  position: number;
  creator_user_id: string;
  created_at: string;
  updated_at: string;
};

/** What an insert carries in addition to the metadata: the two payloads themselves. */
export type ImageContent = { content: ArrayBuffer; thumb: ArrayBuffer };

function one<T>(cursor: Iterable<T>): T | undefined {
  return [...cursor][0];
}

export function toVisionImage(row: ImageRow): VisionImage {
  return {
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
  };
}

export function listImages(sql: SqlStorage): ImageRow[] {
  return [...sql.exec<ImageRow>(`SELECT ${METADATA_COLUMNS} FROM vision_images ORDER BY position, id`)];
}

export function findImage(sql: SqlStorage, id: string): ImageRow | undefined {
  return one(sql.exec<ImageRow>(`SELECT ${METADATA_COLUMNS} FROM vision_images WHERE id = ?`, id));
}

/**
 * The one place a BLOB is read, for exactly one row and exactly one variant. The digest comes
 * back with it so the content route's `ETag` is always the digest of the bytes it is serving.
 */
export function readImageContent(
  sql: SqlStorage,
  id: string,
  variant: 'full' | 'thumb'
): { bytes: ArrayBuffer; mediaType: VisionMediaType; digest: string } | undefined {
  const row = variant === 'thumb'
    ? one(sql.exec<{ bytes: ArrayBuffer; media_type: VisionMediaType; digest: string }>(
        'SELECT thumb AS bytes, thumb_media_type AS media_type, thumb_digest AS digest FROM vision_images WHERE id = ?',
        id
      ))
    : one(sql.exec<{ bytes: ArrayBuffer; media_type: VisionMediaType; digest: string }>(
        'SELECT content AS bytes, media_type, content_digest AS digest FROM vision_images WHERE id = ?',
        id
      ));
  if (!row) return undefined;
  return { bytes: row.bytes, mediaType: row.media_type, digest: row.digest };
}

export function countImages(sql: SqlStorage): number {
  return one(sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM vision_images'))?.total ?? 0;
}

export function readBytesUsed(sql: SqlStorage): number {
  return one(sql.exec<{ bytes_used: number }>('SELECT bytes_used FROM vision_state WHERE id = 1'))?.bytes_used ?? 0;
}

/**
 * The authority `bytes_used` is reconciled against. `COALESCE` matters: a bare `SUM()` over an
 * empty gallery returns NULL, which would read back as zero only by accident.
 */
export function sumStoredBytes(sql: SqlStorage): number {
  return one(sql.exec<{ total: number }>(
    'SELECT COALESCE(SUM(byte_size + thumb_byte_size), 0) AS total FROM vision_images'
  ))?.total ?? 0;
}

export function setBytesUsed(sql: SqlStorage, value: number): void {
  sql.exec('UPDATE vision_state SET bytes_used = ? WHERE id = 1', value);
}

export function insertImage(sql: SqlStorage, row: ImageRow, payload: ImageContent): void {
  sql.exec(
    `INSERT INTO vision_images
       (id, caption, goal_id, media_type, byte_size, width, height, content, content_digest,
        thumb_media_type, thumb_byte_size, thumb_width, thumb_height, thumb, thumb_digest,
        position, creator_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.caption,
    row.goal_id,
    row.media_type,
    row.byte_size,
    row.width,
    row.height,
    payload.content,
    row.content_digest,
    row.thumb_media_type,
    row.thumb_byte_size,
    row.thumb_width,
    row.thumb_height,
    payload.thumb,
    row.thumb_digest,
    row.position,
    row.creator_user_id,
    row.created_at,
    row.updated_at
  );
}

/** Metadata only. There is no route that replaces an image's bytes: delete and add instead. */
export function updateImageMetadata(
  sql: SqlStorage,
  id: string,
  fields: { caption: string | null; goal_id: string | null },
  at: string
): void {
  sql.exec(
    'UPDATE vision_images SET caption = ?, goal_id = ?, updated_at = ? WHERE id = ?',
    fields.caption,
    fields.goal_id,
    at,
    id
  );
}

export function setImagePosition(sql: SqlStorage, id: string, position: number, at: string): void {
  sql.exec('UPDATE vision_images SET position = ?, updated_at = ? WHERE id = ?', position, at, id);
}

export function deleteImage(sql: SqlStorage, id: string): void {
  sql.exec('DELETE FROM vision_images WHERE id = ?', id);
}

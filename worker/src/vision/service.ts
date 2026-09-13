import type { VisionMediaType, VisionSnapshot } from '../../../shared/api';
import { validateIndex } from '../board/service';
import { HttpError, invalidRequest } from '../http';
import { readRevision, VISION_REVISION } from '../revisions';
import { base64ByteLength, validateBase64, validateCaption, validateDimension } from '../validation';
import { type ImageRow, listImages, setImagePosition, toVisionImage } from './repository';

/**
 * The rules an upload has to satisfy, and the ordering the gallery keeps.
 *
 * Everything here is deliberately cheap and synchronous except the digests, which are computed by
 * the route **before** its transaction opens: async hashing inside a `transactionSync` is
 * forbidden, and there is no reason to hold the household's object while SHA-256 runs.
 */

export const MAX_IMAGE_BYTES = 1_400_000;
export const MAX_THUMB_BYTES = 120_000;

/** The member-facing budget, against `vision_state.bytes_used`. */
export const MAX_VISION_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * An absolute backstop only, read from `ctx.storage.sql.databaseSize`.
 *
 * SQLite does not return freed pages to the file — they go on the freelist — so this is a
 * high-water mark that very likely does **not** fall when an image is deleted. Neither remedy is
 * available here: `PRAGMA auto_vacuum` cannot be enabled on a database that already has tables,
 * and `VACUUM` cannot run inside a transaction, while `migrate()` and every route body run inside
 * one. If it is ever reached, the only escape is an operator re-import into a fresh namespace.
 */
export const MAX_DATABASE_BYTES = 256 * 1024 * 1024;

const MEDIA_TYPES: readonly VisionMediaType[] = ['image/jpeg', 'image/png', 'image/webp'];

export function validateMediaType(raw: unknown, field: string): VisionMediaType {
  if (typeof raw !== 'string' || !(MEDIA_TYPES as readonly string[]).includes(raw)) {
    // SVG is not an accepted type in any form: it is a script-bearing document, and serving one
    // from the app's own origin would be an XSS vector no header reliably closes.
    throw new HttpError(400, 'unsupported_image_type', 'That kind of image cannot be used here.', undefined, {
      fieldErrors: { [field]: 'invalid' }
    });
  }
  return raw as VisionMediaType;
}

/**
 * Decodes into a freshly allocated `ArrayBuffer` and hands back both views of it. The buffer is
 * what a BLOB bind parameter and `crypto.subtle.digest` both want, and building it this way round
 * avoids copying a 1.4 MB payload a second time just to satisfy a type.
 */
export function decodeBase64(value: string): { bytes: Uint8Array; buffer: ArrayBuffer } {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, buffer };
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a 1.4 MB payload does not blow the argument limit of `String.fromCharCode`.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Magic bytes, checked against what the payload **declares**, for each payload independently.
 * A PNG announced as `image/jpeg` is refused, and so is a thumbnail whose bytes disagree with its
 * own declared type.
 */
export function assertMagicBytes(bytes: Uint8Array, mediaType: VisionMediaType, field: string): void {
  const matches =
    mediaType === 'image/jpeg'
      ? startsWith(bytes, [0xff, 0xd8, 0xff])
      : mediaType === 'image/png'
        ? startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  if (!matches) {
    throw new HttpError(400, 'unsupported_image_type', 'That file is not the kind of image it claims to be.', undefined, {
      fieldErrors: { [field]: 'invalid' }
    });
  }
}

export type DecodedPayload = {
  bytes: Uint8Array;
  buffer: ArrayBuffer;
  mediaType: VisionMediaType;
  byteSize: number;
};

/**
 * Validates one payload end to end and returns its decoded bytes.
 *
 * The order matters: base64 shape, then the byte cap computed from the encoded length, then the
 * decode, then the magic bytes. An oversized payload is refused before a byte of it is decoded.
 */
export function readPayload(
  raw: unknown,
  rawMediaType: unknown,
  limit: number,
  fields: { data: string; mediaType: string }
): DecodedPayload {
  const encoded = validateBase64(raw, fields.data);
  const mediaType = validateMediaType(rawMediaType, fields.mediaType);
  const byteSize = base64ByteLength(encoded);
  if (byteSize === 0) {
    throw new HttpError(400, 'image_rejected', 'That image was empty.', undefined, {
      fieldErrors: { [fields.data]: 'invalid' }
    });
  }
  if (byteSize > limit) {
    throw new HttpError(400, 'image_too_large', 'That image is too large.', undefined, {
      fieldErrors: { [fields.data]: 'invalid' }
    });
  }
  const { bytes, buffer } = decodeBase64(encoded);
  assertMagicBytes(bytes, mediaType, fields.mediaType);
  return { bytes, buffer, mediaType, byteSize };
}

/**
 * The four dimensions. All four are reported under the field name `width`, and a thumbnail is
 * refused when either of its dimensions exceeds the full image's — which is the only structural
 * relationship between the two that can be checked at all. The server cannot verify that a
 * thumbnail *depicts* its image; in a seven-person invitation-only household that is accepted,
 * and written down rather than implied.
 */
export function readDimensions(body: Record<string, unknown>): {
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
} {
  const width = validateDimension(body.width);
  const height = validateDimension(body.height);
  const thumbWidth = validateDimension(body.thumbWidth);
  const thumbHeight = validateDimension(body.thumbHeight);
  if (thumbWidth > width || thumbHeight > height) {
    throw new HttpError(400, 'image_rejected', 'That thumbnail is larger than its image.', undefined, {
      fieldErrors: { width: 'invalid' }
    });
  }
  return { width, height, thumbWidth, thumbHeight };
}

export { validateCaption };

/** Lower-case hex SHA-256. Computed outside every transaction, because it is async. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function applyGalleryOrder(sql: SqlStorage, orderedIds: readonly string[], at: string): void {
  const current = new Map(listImages(sql).map(row => [row.id, row.position]));
  orderedIds.forEach((id, index) => {
    if (current.get(id) === index) return;
    setImagePosition(sql, id, index, at);
  });
}

/** Closes the gap a deleted image leaves behind, so a later move cannot collide. */
export function compactGallery(sql: SqlStorage, at: string): void {
  applyGalleryOrder(sql, listImages(sql).map(row => row.id), at);
}

export function moveImage(sql: SqlStorage, image: ImageRow, rawTargetIndex: unknown, at: string): boolean {
  const currentOrder = listImages(sql).map(row => row.id);
  const targetIndex = validateIndex(rawTargetIndex, Math.max(0, currentOrder.length - 1), 'targetIndex');
  const remaining = currentOrder.filter(id => id !== image.id);
  const next = [...remaining];
  next.splice(targetIndex, 0, image.id);
  if (sameOrder(currentOrder, next)) return false;
  applyGalleryOrder(sql, next, at);
  return true;
}

export function readVisionSnapshot(sql: SqlStorage): VisionSnapshot {
  return {
    visionRevision: readRevision(sql, VISION_REVISION),
    images: listImages(sql).map(toVisionImage)
  };
}

/**
 * The `variant` parameter on the content route, validated against the **whole** parameter list so
 * `?variant=thumb&variant=x` and `?variant=full` are both refused rather than quietly taking the
 * first value. Absent means the full image.
 */
export function readVariantParameter(url: URL): 'full' | 'thumb' {
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return 'full';
  if (entries.length !== 1 || entries[0]![0] !== 'variant' || entries[0]![1] !== 'thumb') {
    throw invalidRequest('That request was not valid.');
  }
  return 'thumb';
}

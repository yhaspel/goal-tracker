import type { VisionMediaType } from '../../../shared/api';

/**
 * Turning a file a member picked into the two payloads the API accepts, entirely in the browser.
 *
 * Re-encoding through a canvas also strips EXIF, which removes the GPS coordinates a phone
 * photograph usually carries. That is a privacy improvement worth stating rather than leaving as
 * a side effect, and the upload help says so.
 */

/** The long edge of the stored image, and of the thumbnail drawn from it. */
const FULL_LONG_EDGE = 1600;
const THUMB_LONG_EDGE = 320;

/** Mirrors `MAX_IMAGE_BYTES` and `MAX_THUMB_BYTES` in `worker/src/vision/service.ts`. */
const MAX_IMAGE_BYTES = 1_400_000;
const MAX_THUMB_BYTES = 120_000;

const WEBP_QUALITY = 0.82;
/** Tried in order when the first encode comes back over the byte cap. */
const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.5];

export type PreparedImage = {
  mediaType: VisionMediaType;
  data: string;
  width: number;
  height: number;
  thumbMediaType: VisionMediaType;
  thumbData: string;
  thumbWidth: number;
  thumbHeight: number;
};

/** Distinguishes "this file is not an image we can read" from every other failure. */
export class UnreadableImageError extends Error {
  constructor() {
    super('unreadable');
    this.name = 'UnreadableImageError';
  }
}

/** Distinguishes "we shrank it as far as we sensibly can and it is still too big". */
export class TooLargeAfterEncodingError extends Error {
  constructor() {
    super('too_large');
    this.name = 'TooLargeAfterEncodingError';
  }
}

function scaled(width: number, height: number, longEdge: number): { width: number; height: number } {
  const largest = Math.max(width, height);
  if (largest <= longEdge) return { width, height };
  const factor = longEdge / largest;
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

function toCanvas(source: ImageBitmap | HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new UnreadableImageError();
  // JPEG has no alpha, and an unpainted canvas composites to black — so a transparent PNG would
  // otherwise acquire a black background the moment the encoder falls back to JPEG. The fill
  // comes from the token the stylesheet uses for a raised surface, read at call time.
  context.fillStyle = readSurfaceColour();
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** The `--gt-raised` token, so a flattened transparency matches the surface behind the tile. */
function readSurfaceColour(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--gt-raised').trim();
  return value.length > 0 ? value : '#ffffff';
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/**
 * Encodes one canvas within a byte cap.
 *
 * Two things the naive version gets wrong, both handled here. `toBlob` does **not** fail on an
 * unsupported type — it silently encodes PNG — so the type is read back off the blob rather than
 * taken from intent; otherwise every upload from a browser without WebP encoding would be
 * rejected by the server's own magic-byte check. And a 1600px photographic PNG is 3–6 MB, far
 * over the cap, so when the encoder falls back the image is re-encoded to JPEG explicitly.
 */
async function encodeWithin(canvas: HTMLCanvasElement, limit: number): Promise<{ blob: Blob; mediaType: VisionMediaType }> {
  const webp = await encode(canvas, 'image/webp', WEBP_QUALITY);
  if (webp && webp.type === 'image/webp' && webp.size <= limit) return { blob: webp, mediaType: 'image/webp' };

  for (const quality of JPEG_QUALITIES) {
    const jpeg = await encode(canvas, 'image/jpeg', quality);
    if (jpeg && jpeg.type === 'image/jpeg' && jpeg.size <= limit) return { blob: jpeg, mediaType: 'image/jpeg' };
  }

  // A WebP that was only over the cap because of quality is still worth a second try at the
  // lowest setting before giving up.
  const lastWebp = await encode(canvas, 'image/webp', 0.5);
  if (lastWebp && lastWebp.type === 'image/webp' && lastWebp.size <= limit) {
    return { blob: lastWebp, mediaType: 'image/webp' };
  }
  throw new TooLargeAfterEncodingError();
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked, so a 1.4 MB payload does not blow the argument limit of `String.fromCharCode`.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/**
 * One file in, one upload payload out.
 *
 * `imageOrientation: 'from-image'` is what makes a phone photograph arrive upright. The
 * thumbnail is drawn from the **1600px canvas** rather than from the original bitmap, so it does
 * not alias. `bitmap.close()` runs whatever happens: a 48-megapixel photograph holds roughly
 * 190 MB decoded, and a sequential batch without an explicit close is a plausible iOS tab kill.
 *
 * `createImageBitmap` rejects a `.heic` file with a `DOMException` outside Safari, which is why
 * that failure has its own type, its own per-file outcome, and its own sentence in the help.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UnreadableImageError();
  }

  try {
    const full = scaled(bitmap.width, bitmap.height, FULL_LONG_EDGE);
    const fullCanvas = toCanvas(bitmap, full.width, full.height);
    const encoded = await encodeWithin(fullCanvas, MAX_IMAGE_BYTES);

    const thumb = scaled(full.width, full.height, THUMB_LONG_EDGE);
    const thumbCanvas = toCanvas(fullCanvas, thumb.width, thumb.height);
    const encodedThumb = await encodeWithin(thumbCanvas, MAX_THUMB_BYTES);

    return {
      // From the blob, never from intent.
      mediaType: encoded.mediaType,
      data: await toBase64(encoded.blob),
      width: full.width,
      height: full.height,
      thumbMediaType: encodedThumb.mediaType,
      thumbData: await toBase64(encodedThumb.blob),
      thumbWidth: thumb.width,
      thumbHeight: thumb.height
    };
  } finally {
    bitmap.close();
  }
}

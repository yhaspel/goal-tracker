import { invalidRequest } from './http';

/**
 * Validators shared by more than one domain.
 *
 * `validateTitle`, `validateDescription`, `validateColumnName` and `validateIndex` stayed in
 * `board/service.ts`, where they were written and where the board still uses them; goals and the
 * vision board import them from there rather than growing second copies. What lives here is what
 * Stage 8 introduced and more than one of the three domains needs.
 */

export const MAX_NOTES_LENGTH = 1000;
export const MAX_CAPTION_LENGTH = 200;

/** The calendar range `goals.year` and a due date share. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2999;

/** Generous enough for any real photograph, small enough that a product never overflows. */
export const MAX_DIMENSION = 20000;

/** Unicode code points, not UTF-16 units: an emoji counts once. */
function points(value: string): number {
  return [...value].length;
}

const CONTROL = /\p{Cc}|\p{Cs}/u;
/** Same, but a plain line break is allowed. */
const CONTROL_EXCEPT_BREAK = /[^\n\P{Cc}]|\p{Cs}/u;

/**
 * Goal and milestone notes. Mirrors `validateDescription` with a smaller bound; `null` or an
 * empty string clears.
 */
export function validateNotes(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw invalidRequest('Those notes cannot be saved.', { notes: 'invalid' });
  const notes = raw.replace(/\r\n?/gu, '\n').trim();
  if (notes.length === 0) return null;
  if (points(notes) > MAX_NOTES_LENGTH) throw invalidRequest('Those notes are too long.', { notes: 'too_long' });
  if (CONTROL_EXCEPT_BREAK.test(notes)) {
    throw invalidRequest('Those notes contain characters that cannot be saved.', { notes: 'invalid' });
  }
  return notes;
}

/** One line under a gallery tile. No line breaks; `null` or empty clears. */
export function validateCaption(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw invalidRequest('That caption cannot be saved.', { caption: 'invalid' });
  const caption = raw.trim();
  if (caption.length === 0) return null;
  if (points(caption) > MAX_CAPTION_LENGTH) throw invalidRequest('That caption is too long.', { caption: 'too_long' });
  if (CONTROL.test(caption)) {
    throw invalidRequest('That caption contains characters that cannot be saved.', { caption: 'invalid' });
  }
  return caption;
}

/**
 * A card's due date: a calendar day, stored verbatim as `YYYY-MM-DD`. `null` clears.
 *
 * The shape check alone would accept `2026-02-30`, so the value also has to survive a calendar
 * round trip. Nothing server-side ever compares this to the current time — "overdue" is decided
 * in the browser against the viewer's own local date, because a server deciding lateness in UTC
 * is wrong for several hours every day in a household east of it.
 */
export function validateDueDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw invalidRequest('That date is not valid.', { dueDate: 'invalid' });
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw invalidRequest('That date is not valid.', { dueDate: 'invalid' });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw invalidRequest('That date is not valid.', { dueDate: 'invalid' });
  }
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw invalidRequest('That date is outside the range this board keeps.', { dueDate: 'out_of_range' });
  }
  return raw;
}

export function validateYear(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    throw invalidRequest('That year is not valid.', { year: 'invalid' });
  }
  if (raw < MIN_YEAR || raw > MAX_YEAR) {
    throw invalidRequest('That year is outside the range this board keeps.', { year: 'out_of_range' });
  }
  return raw;
}

export function validateMonth(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > 12) {
    throw invalidRequest('That month is not valid.', { month: 'invalid' });
  }
  return raw;
}

export function validateStatus(raw: unknown): 'open' | 'done' {
  if (raw !== 'open' && raw !== 'done') throw invalidRequest('That status is not valid.', { status: 'invalid' });
  return raw;
}

/**
 * One image dimension. Reported under the field name `width` whichever of the four it was, so
 * three dictionaries do not have to carry a `height`, `thumbWidth` and `thumbHeight` family
 * saying the same sentence.
 */
export function validateDimension(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1 || raw > MAX_DIMENSION) {
    throw invalidRequest('That image size is not valid.', { width: 'invalid' });
  }
  return raw;
}

/**
 * Standard, fully padded base64 — checked **before** `atob`.
 *
 * `atob` implements forgiving-base64: it strips ASCII whitespace and accepts unpadded input, so
 * a truncated or whitespace-laced payload would otherwise decode happily into something that was
 * never sent. Only with padding guaranteed is the decoded length exactly
 * `length / 4 * 3 - padding`, which is what lets an oversized payload be refused before a byte of
 * it is decoded.
 */
export function validateBase64(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
    throw invalidRequest('That image could not be read.', { [field]: 'invalid' });
  }
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  // `=` may only be the final one or two characters; the character class above already refuses
  // it anywhere else, so this only has to rule out an all-padding payload.
  if (raw.length === padding) throw invalidRequest('That image could not be read.', { [field]: 'invalid' });
  return raw;
}

/** The decoded byte count of a payload `validateBase64` has already accepted. */
export function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

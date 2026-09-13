import { randomBytes, timingSafeEqual } from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords';
import { invalidRequest } from '../http';
import { fromBase64Url, toBase64Url } from './crypto';
import { KdfQueue, SCRYPT_PARAMETERS, scryptDerive } from './kdf-queue';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordRejection = 'too_short' | 'too_long' | 'invalid_characters' | 'too_common';

let denylist: Set<string> | undefined;
function commonPasswords(): Set<string> {
  denylist ??= new Set(COMMON_PASSWORDS);
  return denylist;
}

/**
 * Length is measured in Unicode code points, and the password is never trimmed, truncated,
 * or normalised before hashing.
 */
export function validatePassword(raw: unknown): PasswordRejection | null {
  if (typeof raw !== 'string') return 'invalid_characters';
  const points = [...raw];
  if (points.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (points.length > MAX_PASSWORD_LENGTH) return 'too_long';
  // Control characters, unassigned separators, and lone surrogates.
  if (/\p{Cc}|\p{Cs}/u.test(raw)) return 'invalid_characters';
  if (commonPasswords().has(raw.toLowerCase())) return 'too_common';
  return null;
}

/** Rejects a password that fails the policy, naming the field so the UI can point at it. */
export function assertPasswordPolicy(password: string): void {
  const rejection = validatePassword(password);
  if (rejection !== null) throw invalidRequest('That password cannot be used.', { password: rejection });
}

/**
 * Versioned, self-describing hash record:
 *   scrypt$1$N=16384,r=8,p=5,dkLen=32$<salt base64url>$<key base64url>
 * Storing the parameters alongside the key lets Stage 7 re-benchmark or re-encode without
 * guessing how an existing row was derived.
 */
export const PASSWORD_RECORD_VERSION = 1;

function encodeRecord(salt: Uint8Array, key: Uint8Array): string {
  const params = `N=${SCRYPT_PARAMETERS.N},r=${SCRYPT_PARAMETERS.r},p=${SCRYPT_PARAMETERS.p},dkLen=${SCRYPT_PARAMETERS.keyLength}`;
  return `scrypt$${PASSWORD_RECORD_VERSION}$${params}$${toBase64Url(salt)}$${toBase64Url(key)}`;
}

type ParsedRecord = { salt: Uint8Array; key: Uint8Array };

function parseRecord(record: string): ParsedRecord | null {
  const parts = record.split('$');
  if (parts.length !== 5) return null;
  const [algorithm, version, , saltPart, keyPart] = parts;
  if (algorithm !== 'scrypt' || version !== String(PASSWORD_RECORD_VERSION)) return null;
  if (saltPart === undefined || keyPart === undefined) return null;
  const salt = fromBase64Url(saltPart);
  const key = fromBase64Url(keyPart);
  if (salt.length < SCRYPT_PARAMETERS.saltLength || key.length !== SCRYPT_PARAMETERS.keyLength) return null;
  return { salt, key };
}

/** Derives a fresh salted record. Must be awaited before opening a SQL transaction. */
export async function hashPassword(password: string, kdf: KdfQueue): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMETERS.saltLength);
  const key = await kdf.run(() => scryptDerive(password, salt));
  return encodeRecord(salt, key);
}

export async function verifyPassword(password: string, record: string, kdf: KdfQueue): Promise<boolean> {
  const parsed = parseRecord(record);
  if (parsed === null) return false;
  const actual = await kdf.run(() => scryptDerive(password, parsed.salt));
  return timingSafeEqual(actual, parsed.key);
}

/**
 * Burns one equivalent derivation when no account matched, so an unknown or disallowed
 * email costs an attacker the same wall-clock time as a wrong password. The queue slot is
 * consumed too, which keeps the cost symmetric under load.
 */
export async function dummyVerify(password: string, kdf: KdfQueue): Promise<false> {
  const salt = randomBytes(SCRYPT_PARAMETERS.saltLength);
  await kdf.run(() => scryptDerive(password, salt));
  return false;
}

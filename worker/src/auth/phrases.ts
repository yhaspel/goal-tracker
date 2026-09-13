import { randomBytes } from 'node:crypto';
import { hmacHex } from './crypto';
import { RECOVERY_WORDLIST } from './wordlist';

export const PHRASE_WORD_COUNT = 12;

/**
 * Domain prefix for phrase digests. Stage 3 signs operator reset tokens with the same
 * Cloudflare secret under a different prefix, so the two digests can never be interchanged.
 * Bump the version if the derivation ever changes.
 */
const PHRASE_DIGEST_PREFIX = 'recovery-v1|';

const MAX_SUBMITTED_PHRASE_LENGTH = 4096;

/**
 * 12 independent uniform word indexes drawn from a cryptographic source: 12 x log2(2048)
 * = 132 bits. The list length is exactly 2^11, so masking 16 random bits down to 11 is
 * uniform and needs no rejection sampling.
 */
export function generatePhrase(): string {
  if (RECOVERY_WORDLIST.length !== 2048) throw new Error('recovery wordlist must hold 2048 words');
  const raw = randomBytes(PHRASE_WORD_COUNT * 2);
  const words: string[] = [];
  for (let i = 0; i < PHRASE_WORD_COUNT; i++) {
    const index = ((raw[i * 2]! << 8) | raw[i * 2 + 1]!) & 0x7ff;
    words.push(RECOVERY_WORDLIST[index]!);
  }
  return words.join(' ');
}

/**
 * Normalises case and leading, trailing, and repeated whitespace only. Nothing else about
 * the submitted phrase is altered. Returns null for values that are not worth digesting.
 */
export function normalizePhrase(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_SUBMITTED_PHRASE_LENGTH) return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/gu, ' ');
  return normalized.length === 0 ? null : normalized;
}

export function phraseDigest(digestKey: string, normalizedPhrase: string): string {
  return hmacHex(digestKey, `${PHRASE_DIGEST_PREFIX}${normalizedPhrase}`);
}

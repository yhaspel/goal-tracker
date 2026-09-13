import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Opaque high-entropy token, base64url encoded. 32 bytes = 256 bits by default. */
export function randomToken(byteLength = 32): string {
  return Buffer.from(randomBytes(byteLength)).toString('base64url');
}

/** Lower-case hex token. 16 bytes = the 128 random bits an invitation code requires. */
export function randomHex(byteLength: number): string {
  return Buffer.from(randomBytes(byteLength)).toString('hex');
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hmacHex(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

export function hmacBase64Url(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('base64url');
}

/**
 * Constant-time comparison of two ASCII strings. Length is compared first and leaks only
 * the length, which is fixed for every digest and token this project compares.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function newId(): string {
  return crypto.randomUUID();
}

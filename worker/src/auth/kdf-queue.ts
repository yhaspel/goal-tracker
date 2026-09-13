import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';

export const SCRYPT_PARAMETERS = { N: 1 << 14, r: 8, p: 5, keyLength: 32, saltLength: 16 } as const;

export class QueueFullError extends Error {
  constructor() { super('KDF queue is full'); }
}

export class KdfQueue {
  private running = false;
  private waiters: Array<() => void> = [];

  async run<T>(operation: (waitMs: number) => Promise<T>): Promise<T> {
    const queuedAt = performance.now();
    if (this.running) {
      if (this.waiters.length >= 7) throw new QueueFullError();
      await new Promise<void>(resolve => this.waiters.push(resolve));
    } else {
      this.running = true;
    }
    try {
      return await operation(performance.now() - queuedAt);
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.running = false;
    }
  }
}

function scrypt(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, SCRYPT_PARAMETERS.keyLength, {
      N: SCRYPT_PARAMETERS.N,
      r: SCRYPT_PARAMETERS.r,
      p: SCRYPT_PARAMETERS.p,
      maxmem: 64 * 1024 * 1024
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string, queue: KdfQueue) {
  return queue.run(async waitMs => {
    const salt = randomBytes(SCRYPT_PARAMETERS.saltLength);
    const started = performance.now();
    const key = await scrypt(password, salt);
    return { salt: Buffer.from(salt).toString('hex'), hash: Buffer.from(key).toString('hex'), waitMs, operationMs: performance.now() - started };
  });
}

export async function verifyPassword(password: string, saltHex: string, hashHex: string, queue: KdfQueue) {
  return queue.run(async waitMs => {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length < 16 || expected.length !== SCRYPT_PARAMETERS.keyLength) throw new Error('Invalid hash');
    const started = performance.now();
    const actual = await scrypt(password, salt);
    return { verified: timingSafeEqual(actual, expected), waitMs, operationMs: performance.now() - started };
  });
}

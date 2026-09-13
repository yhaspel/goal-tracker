import { env, SELF, evictDurableObject } from 'cloudflare:test';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KdfQueue, QueueFullError } from '../worker/src/auth/kdf-queue';

const url = 'https://example.com/api/v1/diagnostics/scrypt';
const password = Buffer.from(randomBytes(24)).toString('hex');
const headers = { 'X-Diagnostic-Secret': env.TEST_DIAGNOSTIC_SECRET!, 'Content-Type': 'application/json' };

async function call(body: object) {
  return SELF.fetch(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }));
}

describe('native scrypt in the Workers runtime', () => {
  it('allows one operation plus seven waiters and rejects the ninth', async () => {
    const queue = new KdfQueue();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const active = Array.from({ length: 8 }, () => queue.run(async () => { await gate; return true; }));
    await expect(queue.run(async () => true)).rejects.toBeInstanceOf(QueueFullError);
    release();
    expect(await Promise.all(active)).toEqual(Array(8).fill(true));
  });

  it('uses different salts and verifies correct and wrong passwords', async () => {
    const first = await call({ action: 'hash', password });
    expect(first.status).toBe(200);
    const firstSession = first.headers.get('X-Diagnostic-Session');
    expect(firstSession).toBeTruthy();
    const a = (await first.json() as { data: { salt: string; hash: string } }).data;
    const second = await call({ action: 'hash', password });
    expect(second.headers.get('X-Diagnostic-Session')).toBe(firstSession);
    const b = (await second.json() as { data: { salt: string; hash: string } }).data;
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    const good = await call({ action: 'verify', password, salt: a.salt, hash: a.hash });
    expect((await good.json() as { data: { verified: boolean } }).data.verified).toBe(true);
    const bad = await call({ action: 'verify', password: `${password}wrong`, salt: a.salt, hash: a.hash });
    expect((await bad.json() as { data: { verified: boolean } }).data.verified).toBe(false);
    await evictDurableObject(env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household')));
    const afterEviction = await call({ action: 'hash', password });
    expect(afterEviction.headers.get('X-Diagnostic-Session')).not.toBe(firstSession);
    await afterEviction.json();
  });
});

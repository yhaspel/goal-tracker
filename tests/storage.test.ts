import { env, SELF, evictDurableObject } from 'cloudflare:test';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const path = 'https://example.com/api/v1/diagnostics/probe';
const headers = { 'X-Diagnostic-Secret': env.TEST_DIAGNOSTIC_SECRET!, 'Content-Type': 'application/json' };

describe('SQLite diagnostic probe', () => {
  it('persists across requests and deletes cleanly', async () => {
    const nonce = Buffer.from(randomBytes(16)).toString('hex');
    const denied = await SELF.fetch(new Request(path, { method: 'POST', body: JSON.stringify({ nonce }) }));
    expect(denied.status).toBe(404);
    await denied.json();
    const wrongSecret = await SELF.fetch(new Request(path, {
      method: 'POST', headers: { 'X-Diagnostic-Secret': 'wrong' }, body: JSON.stringify({ nonce })
    }));
    expect(wrongSecret.status).toBe(404);
    await wrongSecret.json();
    const malformed = await SELF.fetch(new Request(path, { method: 'POST', headers, body: '{' }));
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain('stack');
    const write = await SELF.fetch(new Request(`${path}?object=forged`, {
      method: 'POST', headers: { ...headers, 'X-DO-Name': 'forged' }, body: JSON.stringify({ nonce })
    }));
    expect(write.status).toBe(201);
    await write.json();
    await evictDurableObject(env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName('household')));
    const read = await SELF.fetch(new Request(`${path}?nonce=${nonce}`, { headers }));
    expect(await read.json()).toEqual({ data: { found: true } });
    const remove = await SELF.fetch(new Request(`${path}?nonce=${nonce}`, { method: 'DELETE', headers }));
    expect(remove.status).toBe(200);
    await remove.json();
    const after = await SELF.fetch(new Request(`${path}?nonce=${nonce}`, { headers }));
    expect(await after.json()).toEqual({ data: { found: false } });
  }, 20_000);
});

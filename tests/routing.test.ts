import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../worker/src/db/migrations';

const fetchRoute = (path: string, init?: RequestInit) => SELF.fetch(new Request(`https://example.com${path}`, init));

describe('front Worker routing', () => {
  it('serves intended navigation routes and real assets', async () => {
    for (const path of ['/', '/login', '/board']) {
      const response = await fetchRoute(path, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    }
    const index = await (await fetchRoute('/')).text();
    const asset = index.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    const response = await fetchRoute(asset!);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
  });

  it('never falls through unknown paths to SPA HTML', async () => {
    for (const path of ['/assets/not-found.js', '/assets/x/y.png', '/foo.png', '/arbitrary', '/api', '/api/unknown', '/api/v1/unknown']) {
      for (const headers of [new Headers(), new Headers({ 'Sec-Fetch-Mode': 'navigate' })]) {
        const response = await fetchRoute(path, { headers });
        expect(response.status).toBe(404);
        expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
        if (path.startsWith('/api')) expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
      }
    }
  });

  it('returns a safe health envelope and method error', async () => {
    const health = await fetchRoute('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(await health.json()).toEqual({ data: { status: 'ok', schemaVersion: SCHEMA_VERSION } });
    const wrongMethod = await fetchRoute('/api/v1/health', { method: 'POST' });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET');
  });

  it('rejects oversized API bodies without touching the DO', async () => {
    const response = await fetchRoute('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(17 * 1024) })
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: 'payload_too_large', message: 'Payload too large' } });
  });

  it('rejects unsupported content types on API routes before the DO runs', async () => {
    const response = await fetchRoute('/api/v1/auth/login', { method: 'POST', body: 'email=x' });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: { code: 'unsupported_media_type', message: 'Send application/json.' }
    });
  });
});

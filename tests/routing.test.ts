import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../worker/src/db/migrations';

const fetchRoute = (path: string, init?: RequestInit) => SELF.fetch(new Request(`https://example.com${path}`, init));

describe('front Worker routing', () => {
  it('serves intended navigation routes and real assets', async () => {
    for (const path of ['/', '/login', '/register', '/recover', '/bootstrap', '/board', '/account', '/members']) {
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

  it('sends the document security headers with the SPA shell, and never stores it', async () => {
    // The same index.html serves /register and /recover, so no cache may hold it.
    for (const path of ['/', '/login', '/register', '/recover', '/bootstrap', '/board']) {
      const response = await fetchRoute(path, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("object-src 'none'");
      // Installation: the manifest would be blocked by `default-src 'none'` without its own rule.
      expect(csp).toContain("manifest-src 'self'");
      // The one allowance, and the only one: inline style attributes. Never scripts, never eval.
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    }
  });

  it('sends them with real assets too, without forcing those out of cache', async () => {
    const index = await (await fetchRoute('/')).text();
    const asset = index.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    const response = await fetchRoute(asset!);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).not.toBe('no-store');
  });

  it('keeps API responses unsniffable and unstored', async () => {
    for (const path of ['/api/v1/health', '/api/v1/unknown', '/api/v1/board']) {
      const response = await fetchRoute(path);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type') ?? '').toContain('application/json');
      await response.json();
    }
  });

  it('rejects unsupported content types on API routes before the DO runs', async () => {
    const response = await fetchRoute('/api/v1/auth/login', { method: 'POST', body: 'email=x' });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: { code: 'unsupported_media_type', message: 'Send application/json.' }
    });
  });

  /**
   * Every Stage 8 path has to be on `API_ROUTES` as well as inside the Durable Object. The front
   * Worker refuses an unlisted `/api` path before a Durable Object request is spent, and these
   * tests go through `SELF.fetch`, so a route wired only into the object would 404 here and in
   * production alike. An anonymous caller gets `401` on a read and `403` on a mutation — the
   * same-origin check runs first — and either proves the request reached the object.
   */
  it('routes every new goals and vision path to the Durable Object', async () => {
    const reachable: Array<[string, string]> = [
      ['GET', '/api/v1/goals'],
      ['GET', '/api/v1/goals?view=index'],
      ['POST', '/api/v1/goals'],
      ['PATCH', '/api/v1/goals/abc'],
      ['DELETE', '/api/v1/goals/abc'],
      ['POST', '/api/v1/goals/abc/move'],
      ['POST', '/api/v1/milestones'],
      ['PATCH', '/api/v1/milestones/abc'],
      ['POST', '/api/v1/milestones/abc/move'],
      ['GET', '/api/v1/vision'],
      ['POST', '/api/v1/vision/images'],
      ['PATCH', '/api/v1/vision/images/abc'],
      ['DELETE', '/api/v1/vision/images/abc'],
      ['POST', '/api/v1/vision/images/abc/move'],
      ['GET', '/api/v1/vision/images/abc/content']
    ];
    for (const [method, path] of reachable) {
      const init =
        method === 'GET'
          ? undefined
          : { method, headers: { 'Content-Type': 'application/json' }, body: '{}' };
      const response = await fetchRoute(path, init);
      const body = (await response.json()) as { error?: { code: string } };
      expect([401, 403], `${method} ${path} → ${response.status}`).toContain(response.status);
      expect(['unauthenticated', 'forbidden'], `${method} ${path}`).toContain(body.error?.code);
    }
  });

  it('still refuses near-misses with a JSON 404, before a Durable Object request is spent', async () => {
    for (const path of [
      '/api/v1/goalz',
      '/api/v1/goal',
      '/api/v1/goals/abc/archive',
      '/api/v1/milestone',
      '/api/v1/vision/images/x/bytes',
      '/api/v1/vision/image/abc',
      '/api/v1/vision/images/abc/content/full'
    ]) {
      const response = await fetchRoute(path);
      expect(response.status, path).toBe(404);
      expect(await response.json(), path).toEqual({ error: { code: 'not_found', message: 'Not found' } });
    }
  });

  it('gives the image upload its own body limit, and leaves every other route at the board cap', async () => {
    // Over the board cap but inside the vision cap: refused on a card, forwarded on an upload
    // (which the object then refuses for want of an `Origin`, as it should).
    const oversizedForBoard = JSON.stringify({ padding: 'x'.repeat(100 * 1024) });
    const card = await fetchRoute('/api/v1/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedForBoard
    });
    expect(card.status).toBe(413);

    const upload = await fetchRoute('/api/v1/vision/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedForBoard
    });
    expect(upload.status).toBe(403);

    // And past the vision cap it is refused by the front Worker too.
    const tooBig = await fetchRoute('/api/v1/vision/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) })
    });
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: { code: 'payload_too_large', message: 'Payload too large' } });
  });
});

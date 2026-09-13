import { randomBytes } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __ENABLE_DIAGNOSTICS__: 'true' },
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
    miniflare: { bindings: { TEST_DIAGNOSTIC_SECRET: Buffer.from(randomBytes(32)).toString('hex') } }
  })],
  test: { include: ['tests/**/*.test.ts'] }
});

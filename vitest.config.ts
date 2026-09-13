import { randomBytes } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/** Disposable per-run values. No secret is ever committed or reused across environments. */
const secret = () => Buffer.from(randomBytes(32)).toString('hex');

export default defineConfig({
  define: { __ENABLE_DIAGNOSTICS__: 'true' },
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
    miniflare: {
      bindings: {
        TEST_DIAGNOSTIC_SECRET: secret(),
        BOOTSTRAP_SECRET: secret(),
        RECOVERY_DIGEST_KEY: secret(),
        CSRF_SECRET: secret(),
        RATE_LIMIT_KEY: secret()
      }
    }
  })],
  test: { include: ['tests/**/*.test.ts'] }
});

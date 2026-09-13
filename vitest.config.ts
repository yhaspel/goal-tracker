import { randomBytes } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/** Disposable per-run values. No secret is ever committed or reused across environments. */
const secret = () => Buffer.from(randomBytes(32)).toString('hex');

export default defineConfig({
  // These win over the per-environment `define` in `wrangler.jsonc`, which is what lets the
  // suite exercise the restore-only import route while the deployed test Worker still has it
  // compiled out. The Durable Object's own `DEPLOYMENT_ENV !== 'production'` check is the
  // guarantee that survives this override.
  define: { __ENABLE_DIAGNOSTICS__: 'true', __ENABLE_RESTORE_IMPORT__: 'true' },
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
    miniflare: {
      bindings: {
        TEST_DIAGNOSTIC_SECRET: secret(),
        BOOTSTRAP_SECRET: secret(),
        RECOVERY_DIGEST_KEY: secret(),
        CSRF_SECRET: secret(),
        RATE_LIMIT_KEY: secret(),
        BACKUP_OPERATOR_SECRET: secret()
      }
    }
  })],
  test: { include: ['tests/**/*.test.ts'] }
});

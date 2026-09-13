import type { Env as WorkerEnv } from './worker/src/index';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

/**
 * Coarse security events for the Cloudflare log stream.
 *
 * Only a timestamp, a stable event name, an outcome, an opaque user id when it is already
 * known, and small non-identifying counters are emitted. Request bodies, emails, cookies,
 * headers, passwords, phrases, invitation codes, and tokens must never be passed here. The
 * fields parameter is deliberately typed so a caller cannot hand over an arbitrary object.
 */
export type SecurityEventFields = {
  userId?: string;
  role?: 'owner' | 'member';
  reason?: string;
  added?: number;
  removed?: number;
  allowlistRevision?: number;
};

export function securityEvent(
  event: string,
  outcome: 'allowed' | 'denied' | 'error',
  fields: SecurityEventFields = {}
): void {
  // eslint-disable-next-line no-console -- the single sanctioned sink for security events
  console.log(JSON.stringify({ at: new Date().toISOString(), event, outcome, ...fields }));
}

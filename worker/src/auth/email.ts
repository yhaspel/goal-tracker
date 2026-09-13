// One normalisation function is shared by the allowed list, invitations, registration, and
// login so the same address can never resolve differently between them.
//
// An email address is a unique login identifier and invite target only. The application
// sends no mail and never proves that a registrant controls the mailbox.

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Trim and lower-case a conventional ASCII address, then validate it.
 * Returns null when the value is not a usable address.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();

  if (value.length < 3 || Buffer.byteLength(value, 'utf8') > 254) return null;
  // Rejects spaces and control characters along with every other non-printable-ASCII byte.
  if (!/^[\x21-\x7e]+$/.test(value)) return null;

  const at = value.indexOf('@');
  if (at < 0 || at !== value.lastIndexOf('@')) return null;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length < 1 || local.length > 64) return null;
  if (domain.length < 1 || domain.length > 253) return null;
  if (!LOCAL_PART.test(local)) return null;

  const labels = domain.split('.');
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1];
  if (tld === undefined || tld.length < 2 || !/^[a-z]+$/.test(tld)) return null;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63 || !DOMAIN_LABEL.test(label)) return null;
  }

  return value;
}

/**
 * Normalise a whole replacement list. Returns null when any entry is unusable or two
 * entries collide after normalisation, so a malformed list never partially applies.
 */
export function normalizeEmailSet(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  for (const entry of raw) {
    const normalized = normalizeEmail(entry);
    if (normalized === null || seen.has(normalized)) return null;
    seen.add(normalized);
  }
  return [...seen];
}

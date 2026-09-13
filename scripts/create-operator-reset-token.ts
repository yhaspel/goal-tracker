/**
 * Creates one lost-phrase rescue token for an operator to insert by hand.
 *
 *   node scripts/create-operator-reset-token.ts \
 *     --user-id <uuid> --epoch <credential_epoch> --operator <who> --reason <short note> \
 *     < recovery-digest-key-file
 *
 * The Cloudflare `RECOVERY_DIGEST_KEY` arrives on stdin so it never reaches a command line or
 * a shell history entry, and it is never printed. The raw token is printed exactly once; only
 * its domain-separated HMAC digest appears in the SQL. Follow
 * `docs/operator-lost-phrase-reset.md`, which explains the identity check this script cannot
 * perform for you.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
// Explicit extension: Node runs this file directly, and its loader does not guess extensions.
import { newOperatorToken, OPERATOR_TOKEN_TTL_MS, operatorTokenDigest } from '../worker/src/auth/operator-tokens.ts';

type Options = { userId: string; epoch: number; operator: string; reason: string };

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error('Usage: node scripts/create-operator-reset-token.ts \\');
  console.error('         --user-id <uuid> --epoch <n> --operator <who> --reason <note> \\');
  console.error('         < recovery-digest-key-file');
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) usage(`Unexpected argument ${flag ?? ''}`);
    values.set(flag.slice(2), value);
  }

  const userId = values.get('user-id') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    usage('--user-id must be the opaque UUID from the users table.');
  }
  const epoch = Number(values.get('epoch'));
  if (!Number.isSafeInteger(epoch) || epoch < 1) usage('--epoch must be the account\'s current credential_epoch.');

  const operator = values.get('operator') ?? '';
  const reason = values.get('reason') ?? '';
  // The audit columns end up in SQL and in an export. Keep them plain, short, and secret-free.
  for (const [name, value] of [['--operator', operator], ['--reason', reason]] as const) {
    if (value.length < 1 || value.length > 120) usage(`${name} must be 1 to 120 characters.`);
    if (!/^[\x20-\x7e]+$/.test(value)) usage(`${name} must be printable ASCII on one line.`);
  }
  return { userId, epoch, operator, reason };
}

/** SQLite string literal: wrap in single quotes and double any single quote inside. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const options = parseArgs(process.argv.slice(2));

let digestKey = '';
try {
  digestKey = readFileSync(0, 'utf8').trim();
} catch {
  digestKey = '';
}
if (digestKey.length < 32) {
  usage('Pipe the RECOVERY_DIGEST_KEY value on stdin. It is never printed or stored by this script.');
}

const token = newOperatorToken();
const digest = operatorTokenDigest(digestKey, token);
const id = randomUUID();
const createdAt = new Date();
const expiresAt = new Date(createdAt.getTime() + OPERATOR_TOKEN_TTL_MS);

console.log('Give this token to the verified person through your established offline channel.');
console.log('It is shown once, works once, and expires in 15 minutes.\n');
console.log(`  ${token}\n`);
console.log(`It expires at ${expiresAt.toISOString()}.\n`);
console.log('Run exactly this statement in Durable Object Data Studio for the correct environment.');
console.log('It contains the digest only, never the token above.\n');
console.log(
  `INSERT INTO operator_reset_tokens\n` +
    `  (id, user_id, token_digest, expected_credential_epoch, created_at, expires_at, consumed_at, issued_by, reason)\n` +
    `VALUES (${quote(id)}, ${quote(options.userId)}, ${quote(digest)}, ${options.epoch},\n` +
    `        ${quote(createdAt.toISOString())}, ${quote(expiresAt.toISOString())}, NULL,\n` +
    `        ${quote(options.operator)}, ${quote(options.reason)});\n`
);
console.log('Then confirm exactly one row exists, and record its id in your audit note:\n');
console.log(
  `SELECT id, user_id, expected_credential_epoch, created_at, expires_at, consumed_at, issued_by, reason\n` +
    `FROM operator_reset_tokens WHERE id = ${quote(id)};\n`
);

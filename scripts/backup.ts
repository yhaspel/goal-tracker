/**
 * The operator's local encrypted backup tool.
 *
 *   node scripts/backup.ts create  <base-url> --out-dir <dir> --key-file <file> < operator-secret-file
 *   node scripts/backup.ts verify  --out-dir <dir> --key-file <file> [--file <name>]
 *   node scripts/backup.ts list    --out-dir <dir>
 *   node scripts/backup.ts restore <base-url> --out-dir <dir> --key-file <file> --file <name> < operator-secret-file
 *
 * `BACKUP_OPERATOR_SECRET` arrives on **stdin** so it never reaches a command line or a shell
 * history entry, exactly as `scripts/create-operator-reset-token.ts` takes its digest key. The
 * AES key needs a second channel, so it is named by path; the file must be a regular file with
 * mode 0600 and must not live inside the backup directory. Neither value is ever printed.
 *
 * `create` downloads the export, verifies its digest against a locally recomputed one,
 * encrypts it with AES-256-GCM, writes it through a 0600 temporary file and an atomic rename,
 * re-reads and re-verifies the stored copy, and only then prunes older copies. An integrity
 * finding recorded by the server never stops the copy from being written — a household with a
 * data anomaly still gets a backup — but it does make this command exit non-zero once the copy
 * is safely on disk.
 *
 * Read `docs/operator-runbook.md` before using `restore`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
// Explicit extension: Node runs this file directly, and its loader does not guess extensions.
import {
  BACKUP_FORMAT_VERSION,
  type BackupPayload,
  canonicalJson,
  parseBackupEnvelope
} from '../shared/backup.ts';
import { FILE_SUFFIX, parseCopyName, retainedCopies, sortCopies, type StoredCopy } from './backup-retention.ts';

const ENCRYPTION_FORMAT = 'goal-tracker-backup-v1';
const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

/** `Buffer.from` first: the Workers type set this project compiles against types the return of
 *  `randomBytes` as a plain `Uint8Array`, whose `toString` takes no encoding. */
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

type Command = 'create' | 'verify' | 'list' | 'restore';

type Options = {
  command: Command;
  baseUrl: string | null;
  outDir: string;
  keyFile: string | null;
  file: string | null;
};

type EncryptedHeader = {
  encryption: string;
  algorithm: string;
  createdAt: string;
  householdId: string;
  formatVersion: number;
  schemaVersion: number;
  payloadDigest: string;
  nonce: string;
};

type EncryptedFile = { header: EncryptedHeader; ciphertext: string; tag: string };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function usage(message: string): never {
  console.error(`${message}\n`);
  console.error('Usage:');
  console.error('  node scripts/backup.ts create  <base-url> --out-dir <dir> --key-file <file> < operator-secret-file');
  console.error('  node scripts/backup.ts verify  --out-dir <dir> --key-file <file> [--file <name>]');
  console.error('  node scripts/backup.ts list    --out-dir <dir>');
  console.error('  node scripts/backup.ts restore <base-url> --out-dir <dir> --key-file <file> --file <name>');
  console.error('                                 < operator-secret-file');
  process.exit(2);
}

/** HTTPS, or loopback for a `wrangler dev` rehearsal. The Worker enforces the same rule. */
function isAllowedBaseUrl(raw: string): boolean {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
}

function parseArgs(argv: string[]): Options {
  const command = argv[0];
  if (command !== 'create' && command !== 'verify' && command !== 'list' && command !== 'restore') {
    usage(`Unknown command ${command ?? '(none)'}.`);
  }

  const rest = argv.slice(1);
  let baseUrl: string | null = null;
  let index = 0;
  if ((command === 'create' || command === 'restore')) {
    const candidate = rest[0];
    if (candidate === undefined || candidate.startsWith('--')) usage(`${command} needs the Worker base URL.`);
    baseUrl = candidate.replace(/\/+$/, '');
    index = 1;
  }

  const values = new Map<string, string>();
  for (; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined) usage(`Unexpected argument ${flag ?? ''}.`);
    values.set(flag.slice(2), value);
  }

  const outDir = values.get('out-dir');
  if (!outDir) usage('--out-dir is required.');
  const keyFile = values.get('key-file') ?? null;
  if (command !== 'list' && !keyFile) usage('--key-file is required.');
  const file = values.get('file') ?? null;
  if (command === 'restore' && !file) usage('restore needs --file, the encrypted copy to send.');

  if (baseUrl !== null && !isAllowedBaseUrl(baseUrl)) {
    usage('The base URL must be https, or a loopback address for a local `wrangler dev` rehearsal.');
  }
  return { command, baseUrl, outDir: resolve(outDir), keyFile: keyFile === null ? null : resolve(keyFile), file };
}

/** Reads the 32-byte AES key. Never printed, and never accepted from a world-readable file. */
function readKey(keyFile: string, outDir: string): Buffer {
  let info;
  try {
    info = statSync(keyFile);
  } catch {
    return fail(`The key file ${keyFile} does not exist. Without it, stored backups cannot be read at all.`);
  }
  if (!info.isFile()) fail(`${keyFile} is not a regular file.`);
  if ((info.mode & 0o077) !== 0) {
    fail(`${keyFile} is readable by others (mode ${(info.mode & 0o777).toString(8)}). Run: chmod 600 ${keyFile}`);
  }
  if (resolve(dirname(keyFile)).startsWith(`${outDir}/`) || resolve(dirname(keyFile)) === outDir) {
    fail('The key file must not live in the backup directory. A copy of both together is not an encrypted backup.');
  }
  const text = readFileSync(keyFile, 'utf8').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(text)) {
    fail(`${keyFile} must hold 64 hex characters. Create one with: umask 077 && openssl rand -hex 32 > ${keyFile}`);
  }
  const key = Buffer.from(text, 'hex');
  if (key.length !== KEY_BYTES) fail('The encryption key must be exactly 32 bytes.');
  return key;
}

function readOperatorSecret(): string {
  let secret = '';
  try {
    secret = readFileSync(0, 'utf8').trim();
  } catch {
    secret = '';
  }
  if (secret.length < 16) {
    fail('Pipe BACKUP_OPERATOR_SECRET on stdin. It is never printed, stored, or passed as an argument.');
  }
  return secret;
}

function ensureOutDir(outDir: string): void {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
}

function safeHouseholdId(raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug.slice(0, 60) : 'household';
}

function encryptedName(payload: BackupPayload): string {
  const date = payload.createdAt.slice(0, 10);
  const suffix = toHex(randomBytes(4));
  return `${safeHouseholdId(payload.householdId)}-${date}-schema${payload.schemaVersion}-${suffix}${FILE_SUFFIX}`;
}

function encrypt(plaintext: string, key: Buffer, payload: BackupPayload, digest: string): EncryptedFile {
  const nonce = randomBytes(NONCE_BYTES);
  const header: EncryptedHeader = {
    encryption: ENCRYPTION_FORMAT,
    algorithm: ALGORITHM,
    createdAt: payload.createdAt,
    householdId: payload.householdId,
    formatVersion: payload.formatVersion,
    schemaVersion: payload.schemaVersion,
    payloadDigest: digest,
    nonce: toBase64(nonce)
  };
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  // The header is authenticated, not encrypted: nobody can swap one copy's metadata for
  // another's without the tag failing.
  cipher.setAAD(Buffer.from(canonicalJson(header), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { header, ciphertext: toBase64(ciphertext), tag: toBase64(cipher.getAuthTag()) };
}

function decrypt(stored: EncryptedFile, key: Buffer): string {
  if (stored.header.encryption !== ENCRYPTION_FORMAT) {
    fail(`Unknown encryption format ${stored.header.encryption}.`);
  }
  if (stored.header.algorithm !== ALGORITHM) fail(`Unknown algorithm ${stored.header.algorithm}.`);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(stored.header.nonce, 'base64'));
  decipher.setAAD(Buffer.from(canonicalJson(stored.header), 'utf8'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return fail('The stored copy failed authentication. Either the key is wrong or the file has been altered.');
  }
}

function readStored(path: string): EncryptedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fail(`${path} is not a readable encrypted backup.`);
  }
  const stored = parsed as Partial<EncryptedFile>;
  if (!stored.header || typeof stored.ciphertext !== 'string' || typeof stored.tag !== 'string') {
    fail(`${path} is missing the encrypted-backup fields.`);
  }
  return stored as EncryptedFile;
}

/** Writes through a 0600 temporary file and an atomic rename; never leaves a plaintext file. */
function writeAtomically(path: string, contents: string): void {
  const temporary = `${path}.partial-${toHex(randomBytes(4))}`;
  const handle = openSync(temporary, 'wx', 0o600);
  try {
    writeSync(handle, contents);
    fsyncSync(handle);
  } catch (error) {
    closeSync(handle);
    rmSync(temporary, { force: true });
    throw error;
  }
  closeSync(handle);
  try {
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function storedCopies(outDir: string): StoredCopy[] {
  let names: string[] = [];
  try {
    names = readdirSync(outDir);
  } catch {
    return [];
  }
  // Anything this tool did not write is left alone, and is never a pruning candidate.
  return sortCopies(names.map(parseCopyName).filter((copy): copy is StoredCopy => copy !== null));
}

async function download(baseUrl: string, secret: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/operator/export`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' }
  });
  if (response.status === 404) {
    fail(
      'The export route answered 404. That is what it answers for a wrong or missing operator secret, ' +
        'an unconfigured BACKUP_OPERATOR_SECRET or BACKUP_HOUSEHOLD_ID, and a rate-limited caller alike. ' +
        'Check the Worker with `npx wrangler tail` and look for the operator.backup.export security event.'
    );
  }
  if (!response.ok) fail(`The export request failed with HTTP ${response.status}.`);
  return response.text();
}

async function create(options: Options): Promise<void> {
  const outDir = options.outDir;
  ensureOutDir(outDir);
  const key = readKey(options.keyFile!, outDir);
  const secret = readOperatorSecret();

  const text = await download(options.baseUrl!, secret);
  let envelope;
  try {
    envelope = parseBackupEnvelope(text);
  } catch (error) {
    return fail(`The export did not verify: ${error instanceof Error ? error.message : 'unreadable'}.`);
  }
  if (envelope.payload.formatVersion !== BACKUP_FORMAT_VERSION) {
    fail(`The Worker produced format version ${envelope.payload.formatVersion}; this tool writes ${BACKUP_FORMAT_VERSION}.`);
  }

  const name = encryptedName(envelope.payload);
  const path = join(outDir, name);
  writeAtomically(path, `${JSON.stringify(encrypt(text, key, envelope.payload, envelope.digest))}\n`);

  // Read the file back off the disk rather than trusting what was just in memory.
  const roundTrip = parseBackupEnvelope(decrypt(readStored(path), key));
  if (roundTrip.digest !== envelope.digest) fail('The stored copy did not decrypt to the downloaded backup.');

  const counts = envelope.payload.counts;
  console.log(`Wrote ${name}`);
  console.log(
    `  household ${envelope.payload.householdId}, schema ${envelope.payload.schemaVersion}, ` +
      `board revision ${envelope.payload.boardState.revision}`
  );
  console.log(
    `  ${counts.users} users (${counts.activeUsers} active), ${counts.allowedEmails} allowed addresses, ` +
      `${counts.columns} columns, ${counts.cards} cards`
  );
  console.log(`  verified by decrypting the stored file: digest ${envelope.digest.slice(0, 16)}…`);

  // Pruning happens only now, with a verified new copy already on disk.
  const keep = retainedCopies(storedCopies(outDir), [name]);
  const removed: string[] = [];
  for (const copy of storedCopies(outDir)) {
    if (keep.has(copy.name)) continue;
    rmSync(join(outDir, copy.name), { force: true });
    removed.push(copy.name);
  }
  console.log(removed.length === 0 ? 'Retention: nothing to prune.' : `Retention: pruned ${removed.length} older copy(ies).`);
  for (const name of removed) console.log(`  removed ${name}`);

  if (!envelope.payload.integrity.ok) {
    console.error('\nThe backup is written and verified, but the household failed its own integrity checks:');
    for (const issue of envelope.payload.integrity.issues) console.error(`  - ${issue}`);
    console.error('A restore will refuse this copy. Fix the source data and take another backup.');
    process.exit(1);
  }
}

function verify(options: Options): void {
  const outDir = options.outDir;
  const key = readKey(options.keyFile!, outDir);
  const copies = options.file === null ? storedCopies(outDir) : [{ name: basename(options.file), date: '', schema: 0 }];
  if (copies.length === 0) fail(`No encrypted backups found in ${outDir}. That is an operational failure, not an empty day.`);

  let failed = 0;
  for (const copy of copies) {
    const envelope = parseBackupEnvelope(decrypt(readStored(join(outDir, copy.name)), key));
    const state = envelope.payload.integrity.ok ? 'ok' : `INTEGRITY FAILED (${envelope.payload.integrity.issues.length})`;
    if (!envelope.payload.integrity.ok) failed += 1;
    console.log(
      `${copy.name}: ${state}, taken ${envelope.payload.createdAt}, schema ${envelope.payload.schemaVersion}, ` +
        `${envelope.payload.counts.users} users, ${envelope.payload.counts.cards} cards`
    );
  }
  if (failed > 0) process.exit(1);
}

function list(options: Options): void {
  const copies = storedCopies(options.outDir);
  if (copies.length === 0) {
    console.log(`No encrypted backups in ${options.outDir}.`);
    return;
  }
  const keep = retainedCopies(copies);
  for (const copy of copies) {
    console.log(`${keep.has(copy.name) ? 'keep  ' : 'prune '} ${copy.name}`);
  }
  console.log(`\n${copies.length} copy(ies); ${keep.size} would survive the next verified backup.`);
}

async function restore(options: Options): Promise<void> {
  const target = new URL(options.baseUrl!);
  if (/production/i.test(target.hostname)) {
    fail(
      `Refusing to import into ${target.hostname}. A restore goes into an expendable isolated ` +
        'restore Worker, never into production. Production replacement is a separate documented ' +
        'maintenance action in docs/operator-runbook.md.'
    );
  }
  const key = readKey(options.keyFile!, options.outDir);
  const secret = readOperatorSecret();
  const plaintext = decrypt(readStored(join(options.outDir, basename(options.file!))), key);
  const envelope = parseBackupEnvelope(plaintext);

  console.log(`Importing household ${envelope.payload.householdId} into ${target.host}`);
  console.log(`  taken ${envelope.payload.createdAt}, schema ${envelope.payload.schemaVersion}`);

  const response = await fetch(`${options.baseUrl}/api/v1/operator/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: plaintext
  });
  const body = await response.text();
  if (response.status === 404) {
    fail(
      'The import route answered 404. Either this Worker is not the restore build, or the operator ' +
        'secret, BACKUP_HOUSEHOLD_ID, or rate limit refused the call. Check `npx wrangler tail --env restore`.'
    );
  }
  if (!response.ok) fail(`The import failed with HTTP ${response.status}: ${body}`);
  console.log(`Imported. ${body}`);
}

const options = parseArgs(process.argv.slice(2));
if (options.command === 'create') await create(options);
else if (options.command === 'verify') verify(options);
else if (options.command === 'list') list(options);
else await restore(options);

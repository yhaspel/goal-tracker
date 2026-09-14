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
  type BackupImageBytes,
  type BackupPayload,
  canonicalJson,
  parseBackupEnvelope,
  parseImageBytes
} from '../shared/backup.ts';
import { FILE_SUFFIX, parseCopyName, retainedCopies, sortCopies, type StoredCopy } from './backup-retention.ts';

/**
 * The stored archive's own format.
 *
 * `v1` encrypted the envelope JSON on its own. `v2` encrypts `{envelope, images}`, because Stage
 * 8 has image bytes that do not fit inside the envelope. **Both are still readable**: the copies
 * taken before Stage 8 are the household's only history, and a tool that could no longer open
 * them would have destroyed the thing it exists to protect.
 */
const ENCRYPTION_FORMAT = 'goal-tracker-backup-v2';
const ENCRYPTION_FORMAT_V1 = 'goal-tracker-backup-v1';
const READABLE_ENCRYPTION_FORMATS = [ENCRYPTION_FORMAT, ENCRYPTION_FORMAT_V1];

/**
 * A backup is two phases now, and they are not one SQLite snapshot.
 *
 * The envelope carries `visionState.revision`; after the last image is fetched the CLI re-reads
 * it, and if it moved — or if any listed image answered 404, which one member deleting one image
 * mid-backup is enough to cause — the partial archive is discarded and the whole backup re-runs
 * from a fresh envelope. A backup is declared successful only when the envelope and every byte
 * come from the same `visionRevision`.
 *
 * Without this, one member deleting one image during the backup window would fail every
 * subsequent backup and the household would silently age on an old copy.
 */
const MAX_BACKUP_ATTEMPTS = 3;
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

/**
 * What is stored on disk. `images` is a map from image id to its base64 payloads, encrypted
 * inside the same archive and under the same authentication tag as the envelope: a household's
 * photographs are exactly as private as its card titles.
 */
type ArchiveContents = { envelope: string; images: Record<string, BackupImageBytes> };

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

/**
 * Reads a decrypted archive in either stored format. A `v1` copy holds the envelope on its own
 * and therefore has no images, which is exactly right: it predates them.
 */
function readArchive(stored: EncryptedFile, plaintext: string): ArchiveContents {
  if (stored.header.encryption === ENCRYPTION_FORMAT_V1) return { envelope: plaintext, images: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return fail('The stored copy decrypted, but its contents are not readable.');
  }
  const archive = parsed as Partial<ArchiveContents>;
  if (typeof archive.envelope !== 'string' || archive.images === null || typeof archive.images !== 'object') {
    return fail('The stored copy decrypted, but it is missing its envelope or its image map.');
  }
  const images: Record<string, BackupImageBytes> = {};
  for (const [id, value] of Object.entries(archive.images)) images[id] = parseImageBytes(value);
  return { envelope: archive.envelope, images };
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
  if (!READABLE_ENCRYPTION_FORMATS.includes(stored.header.encryption)) {
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

/** `null` means the image is gone — a member deleted it while the backup was running. */
async function downloadImage(baseUrl: string, secret: string, id: string): Promise<BackupImageBytes | null> {
  const response = await fetch(`${baseUrl}/api/v1/operator/export/images/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' }
  });
  if (response.status === 404) return null;
  if (!response.ok) fail(`Fetching image ${id} failed with HTTP ${response.status}.`);
  const body = (await response.json()) as { data?: unknown };
  return parseImageBytes(body.data);
}

type Attempt = { text: string; envelope: ReturnType<typeof parseBackupEnvelope>; images: Record<string, BackupImageBytes> };

/**
 * One coherent attempt: an envelope, every image it lists, and a re-read of `visionRevision`
 * proving nothing moved in between. Returns `null` when the household changed underneath, which
 * the caller retries from a fresh envelope.
 */
async function collect(baseUrl: string, secret: string): Promise<Attempt | null> {
  const text = await download(baseUrl, secret);
  let envelope;
  try {
    envelope = parseBackupEnvelope(text);
  } catch (error) {
    return fail(`The export did not verify: ${error instanceof Error ? error.message : 'unreadable'}.`);
  }
  /**
   * The Worker may be **older** than this tool, and that must not stop a backup.
   *
   * This was an equality check against `BACKUP_FORMAT_VERSION`, which meant that the moment this
   * tool moved to format 2, it refused to back up any deployment still running a format-1 build —
   * including production. That is precisely backwards: the whole reason to take a backup before
   * upgrading a deployment is that the deployment has not been upgraded yet.
   *
   * A **newer** format than this tool understands is still refused, by `parseBackupEnvelope`
   * above, which checks `SUPPORTED_BACKUP_FORMAT_VERSIONS`.
   */
  if (envelope.sourceFormatVersion > BACKUP_FORMAT_VERSION) {
    fail(
      `The Worker produced format version ${envelope.sourceFormatVersion}; this tool understands up ` +
        `to ${BACKUP_FORMAT_VERSION}. Update the tool before backing up this deployment.`
    );
  }
  if (envelope.sourceFormatVersion < BACKUP_FORMAT_VERSION) {
    console.log(
      `Note: this Worker emits format version ${envelope.sourceFormatVersion}; the copy will be stored ` +
        `as format ${envelope.sourceFormatVersion} and restores into a newer schema unchanged.`
    );
  }

  const images: Record<string, BackupImageBytes> = {};
  for (const listed of envelope.payload.visionImages) {
    const image = await downloadImage(baseUrl, secret, listed.id);
    if (image === null) {
      console.error(`  image ${listed.id} disappeared mid-backup; starting again from a fresh envelope.`);
      return null;
    }
    // Checked against the envelope's own record rather than trusted, so a transfer fault cannot
    // put an image into the archive under another image's metadata.
    if (image.contentDigest !== listed.contentDigest || image.thumbDigest !== listed.thumbDigest) {
      fail(`Image ${listed.id} came back with a digest the envelope does not record.`);
    }
    images[listed.id] = image;
  }

  if (envelope.payload.visionImages.length > 0) {
    // The envelope and the bytes are no longer one SQLite snapshot, so the gap is closed here.
    const after = parseBackupEnvelope(await download(baseUrl, secret));
    if (after.payload.visionState.revision !== envelope.payload.visionState.revision) {
      console.error(
        `  the vision board changed during the backup ` +
          `(revision ${envelope.payload.visionState.revision} → ${after.payload.visionState.revision}); starting again.`
      );
      return null;
    }
  }

  return { text, envelope, images };
}

async function create(options: Options): Promise<void> {
  const outDir = options.outDir;
  ensureOutDir(outDir);
  const key = readKey(options.keyFile!, outDir);
  const secret = readOperatorSecret();

  let attempt: Attempt | null = null;
  for (let round = 1; round <= MAX_BACKUP_ATTEMPTS && attempt === null; round += 1) {
    if (round > 1) console.error(`Attempt ${round} of ${MAX_BACKUP_ATTEMPTS}.`);
    attempt = await collect(options.baseUrl!, secret);
  }
  if (attempt === null) {
    fail(
      `The household kept changing across ${MAX_BACKUP_ATTEMPTS} attempts, so no coherent backup was taken. ` +
        'Run this again when the vision board is quiet. Nothing was written, and no older copy was pruned.'
    );
  }
  const { text, envelope, images } = attempt;

  const name = encryptedName(envelope.payload);
  const path = join(outDir, name);
  const archive: ArchiveContents = { envelope: text, images };
  writeAtomically(path, `${JSON.stringify(encrypt(JSON.stringify(archive), key, envelope.payload, envelope.digest))}\n`);

  // Read the file back off the disk rather than trusting what was just in memory.
  const storedFile = readStored(path);
  const restored = readArchive(storedFile, decrypt(storedFile, key));
  const roundTrip = parseBackupEnvelope(restored.envelope);
  if (roundTrip.digest !== envelope.digest) fail('The stored copy did not decrypt to the downloaded backup.');
  for (const listed of envelope.payload.visionImages) {
    const image = restored.images[listed.id];
    if (!image) fail(`The stored copy is missing image ${listed.id}.`);
    if (image.contentDigest !== listed.contentDigest || image.thumbDigest !== listed.thumbDigest) {
      fail(`The stored copy holds the wrong bytes for image ${listed.id}.`);
    }
  }

  const counts = envelope.payload.counts;
  console.log(`Wrote ${name}`);
  console.log(
    `  household ${envelope.payload.householdId}, schema ${envelope.payload.schemaVersion}, ` +
      `board revision ${envelope.payload.boardState.revision}, vision revision ${envelope.payload.visionState.revision}`
  );
  console.log(
    `  ${counts.users} users (${counts.activeUsers} active), ${counts.allowedEmails} allowed addresses, ` +
      `${counts.columns} columns, ${counts.cards} cards`
  );
  console.log(
    `  ${counts.goals} goals, ${counts.milestones} milestones, ` +
      `${counts.visionImages} images holding ${envelope.payload.visionState.bytesUsed} bytes`
  );
  console.log(`  verified by decrypting the stored file: digest ${envelope.digest.slice(0, 16)}…`);

  // The integrity gate comes before pruning, and that order is the whole point.
  //
  // A copy whose household failed its own checks is one `importBackup` refuses outright
  // (`backup_integrity_failed`). It is still written — a household with a data anomaly still gets
  // a backup, and that has not changed — but it must never *cost* a copy a restore would have
  // accepted. Retention pins the newest copy, so pruning here would keep the unusable one and
  // delete a clean older one on the strength of it; repeated weekly, every retained copy but the
  // month's oldest ends up unrestorable. So this run keeps its copy and prunes nothing.
  if (!envelope.payload.integrity.ok) {
    console.error('\nThe backup is written and verified, but the household failed its own integrity checks:');
    for (const issue of envelope.payload.integrity.issues) console.error(`  - ${issue}`);
    console.error('A restore will refuse this copy. Fix the source data and take another backup.');
    console.error('Retention: skipped. No older copy is removed on the strength of one a restore would refuse.');
    process.exit(1);
  }

  // Pruning happens only now, with a verified and restorable new copy already on disk.
  const keep = retainedCopies(storedCopies(outDir), [name]);
  const removed: string[] = [];
  for (const copy of storedCopies(outDir)) {
    if (keep.has(copy.name)) continue;
    rmSync(join(outDir, copy.name), { force: true });
    removed.push(copy.name);
  }
  console.log(removed.length === 0 ? 'Retention: nothing to prune.' : `Retention: pruned ${removed.length} older copy(ies).`);
  for (const name of removed) console.log(`  removed ${name}`);
}

function verify(options: Options): void {
  const outDir = options.outDir;
  const key = readKey(options.keyFile!, outDir);
  const copies = options.file === null ? storedCopies(outDir) : [{ name: basename(options.file), date: '', schema: 0 }];
  if (copies.length === 0) fail(`No encrypted backups found in ${outDir}. That is an operational failure, not an empty day.`);

  let failed = 0;
  for (const copy of copies) {
    const stored = readStored(join(outDir, copy.name));
    const archive = readArchive(stored, decrypt(stored, key));
    const envelope = parseBackupEnvelope(archive.envelope);
    const problems: string[] = [];
    if (!envelope.payload.integrity.ok) problems.push(`INTEGRITY FAILED (${envelope.payload.integrity.issues.length})`);
    // An archive missing a byte of what its own envelope lists is not a restorable copy, and
    // saying "ok" about it would be the one thing this command must never do.
    for (const listed of envelope.payload.visionImages) {
      const image = archive.images[listed.id];
      if (!image) problems.push(`image ${listed.id} is missing`);
      else if (image.contentDigest !== listed.contentDigest || image.thumbDigest !== listed.thumbDigest) {
        problems.push(`image ${listed.id} has the wrong digest`);
      }
    }
    if (problems.length > 0) failed += 1;
    console.log(
      `${copy.name}: ${problems.length === 0 ? 'ok' : problems.join('; ')}, taken ${envelope.payload.createdAt}, ` +
        `schema ${envelope.payload.schemaVersion}, ${envelope.payload.counts.users} users, ` +
        `${envelope.payload.counts.cards} cards, ${envelope.payload.counts.visionImages} images`
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
  const stored = readStored(join(options.outDir, basename(options.file!)));
  const archive = readArchive(stored, decrypt(stored, key));
  const envelope = parseBackupEnvelope(archive.envelope);

  console.log(`Importing household ${envelope.payload.householdId} into ${target.host}`);
  console.log(
    `  taken ${envelope.payload.createdAt}, schema ${envelope.payload.schemaVersion}, ` +
      `format ${envelope.sourceFormatVersion}, ${envelope.payload.counts.visionImages} images`
  );

  /**
   * A half-finished restore is resumable, and this is what makes the claim true rather than
   * merely reassuring: the marker says how far the last run got, and a second run of the same
   * copy carries on from there instead of being refused for a non-pristine target.
   */
  const statusResponse = await fetch(`${options.baseUrl}/api/v1/operator/import/status`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' }
  });
  if (statusResponse.status === 404) {
    fail(
      'The import routes answered 404. Either this Worker is not the restore build, or the operator ' +
        'secret, BACKUP_HOUSEHOLD_ID, or rate limit refused the call. Check `npx wrangler tail --env restore`.'
    );
  }
  if (!statusResponse.ok) fail(`Reading the restore status failed with HTTP ${statusResponse.status}.`);
  const marker = ((await statusResponse.json()) as {
    data?: { state?: string | null; digest?: string; imagesImported?: number; imagesExpected?: number };
  }).data;

  if (marker?.state === 'complete') {
    fail('This object already holds a completed restore. Provision a fresh restore namespace for another drill.');
  }
  if (marker?.state === 'in_progress') {
    if (marker.digest !== envelope.digest) {
      fail('This object is part-way through restoring a *different* backup. Provision a fresh restore namespace.');
    }
    console.log(`  resuming: ${marker.imagesImported ?? 0}/${marker.imagesExpected ?? 0} images already stored.`);
  } else {
    const response = await fetch(`${options.baseUrl}/api/v1/operator/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: archive.envelope
    });
    const body = await response.text();
    if (response.status === 404) {
      fail(
        'The import route answered 404. Either this Worker is not the restore build, or the operator ' +
          'secret, BACKUP_HOUSEHOLD_ID, or rate limit refused the call. Check `npx wrangler tail --env restore`.'
      );
    }
    if (!response.ok) fail(`The import failed with HTTP ${response.status}: ${body}`);
    console.log(`  envelope imported. ${body}`);
  }

  // Phase two. Each image is its own request and its own transaction, so a failure here costs one
  // image and a retry rather than a whole 64 MiB restore on a freshly provisioned namespace.
  let sent = 0;
  let skipped = 0;
  for (const listed of envelope.payload.visionImages) {
    const image = archive.images[listed.id];
    if (!image) fail(`This copy is missing image ${listed.id}. It cannot complete a restore.`);
    const imageResponse = await fetch(
      `${options.baseUrl}/api/v1/operator/import/images/${encodeURIComponent(listed.id)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(image)
      }
    );
    const imageBody = await imageResponse.text();
    // An image the previous run already stored is no longer pending, and answers 404. On a
    // resume that is the expected answer, not a fault.
    if (imageResponse.status === 404 && marker?.state === 'in_progress') {
      skipped += 1;
      continue;
    }
    if (!imageResponse.ok) {
      fail(
        `Image ${listed.id} failed with HTTP ${imageResponse.status}: ${imageBody}\n` +
          'The restore marker is still in_progress, so re-running this command resends only what is missing.'
      );
    }
    sent += 1;
    if (sent % 10 === 0 || sent + skipped === envelope.payload.visionImages.length) {
      console.log(`  ${sent + skipped}/${envelope.payload.visionImages.length} images (${skipped} already stored)`);
    }
  }

  const completion = await fetch(`${options.baseUrl}/api/v1/operator/import/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytesUsed: envelope.payload.visionState.bytesUsed })
  });
  const completionBody = await completion.text();
  if (!completion.ok) fail(`Completing the restore failed with HTTP ${completion.status}: ${completionBody}`);
  console.log(`Imported. ${completionBody}`);
}

const options = parseArgs(process.argv.slice(2));
if (options.command === 'create') await create(options);
else if (options.command === 'verify') verify(options);
else if (options.command === 'list') list(options);
else await restore(options);

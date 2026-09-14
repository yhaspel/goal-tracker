import { createHash } from 'node:crypto';

/**
 * The backup envelope, its canonical serialization, and the integrity rules that both ends of
 * a restore agree on.
 *
 * This module is imported by the Durable Object, by `scripts/backup.ts`, and by the tests, so
 * the format exists exactly once. A backup that one side writes and the other cannot read is
 * the single failure this file is here to prevent, which is why the serializer is defined
 * rather than assumed: verification is parse, re-canonicalize, hash, compare.
 *
 * It deliberately depends on nothing but `node:crypto`, which is available both in Node and in
 * the Worker (`nodejs_compat`).
 */

/**
 * Bump only for a change that an older reader cannot understand.
 *
 * Version 2 is Stage 8: two more singleton revisions, goals, milestones, one metadata record per
 * vision image, and two more columns on every card. **No image bytes travel inside this
 * envelope** — sixty images cannot fit a 16 MiB bound and should not try. They come through the
 * paged image routes instead, and the CLI is what keeps the two phases coherent.
 */
export const BACKUP_FORMAT_VERSION = 2;

/**
 * Every format version this build can still import. A version 1 envelope is accepted and
 * transformed: it restores into the version 5 schema with no goals, no milestones, no images,
 * and every `due_date` and `milestone_id` null.
 */
export const SUPPORTED_BACKUP_FORMAT_VERSIONS: readonly number[] = [1, 2];

/**
 * The oldest schema version a restore will accept.
 *
 * The backup format did not exist before schema 4, so there is no older copy to be lenient about.
 * An import accepts anything from here up to the target's own schema version and refuses anything
 * newer — a backup from a newer schema carries data the build has never seen, while one from an
 * older schema is simply missing rows for tables the target's migrations have already created.
 *
 * This matters more than it looks: the copy an operator reaches for in an emergency was written
 * by whatever build was live when it was taken, so it is *always* from an older or equal schema
 * than the build being restored into.
 */
export const MIN_IMPORTABLE_SCHEMA_VERSION = 4;

/**
 * The newest schema each envelope format can faithfully describe.
 *
 * This exists to catch one specific, silent way to lose everything.
 *
 * Rolling the Worker code back across a migration is allowed — Stage 8's plan says so in as many
 * words — and `migrate()` reports `MAX(version)` from `schema_migrations`, which does **not** fall
 * when the code does. So a rolled-back Worker runs old code against a newer database and reports
 * the newer schema. Its export then writes the *old* `formatVersion` beside the *new*
 * `schemaVersion`, and contains none of the rows the old code cannot see: every goal, milestone,
 * vision image and due date is quietly absent.
 *
 * Without this check that envelope is coherent to every tool that handles it. `upgradePayload`
 * would treat it as an honest older copy and fill in empty Stage 8 collections; the import would
 * succeed and report a clean restore; and retention would then prune the good copies that still
 * had the data. The loss is total and every step says it worked.
 *
 * A format that is older than its schema is therefore not an old backup — it is a **broken** one,
 * and it is refused at parse time, which stops the CLI writing one as well as reading one.
 */
const MAX_SCHEMA_FOR_FORMAT: Readonly<Record<number, number>> = { 1: 4, 2: 5 };

export type BackupAppState = { bootstrapConsumed: number; allowlistRevision: number };
export type BackupBoardState = { revision: number };
export type BackupGoalState = { revision: number };
export type BackupVisionState = { revision: number; bytesUsed: number };
export type BackupAllowedEmail = { emailNorm: string; createdAt: string };

export type BackupUser = {
  id: string;
  emailNorm: string;
  passwordHash: string;
  role: string;
  status: string;
  language: string;
  credentialEpoch: number;
  createdAt: string;
  updatedAt: string;
};

export type BackupRecoveryCredential = {
  userId: string;
  phraseDigest: string;
  version: number;
  createdAt: string;
};

export type BackupInvitation = {
  id: string;
  emailNorm: string;
  codeDigest: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
};

export type BackupColumn = {
  id: string;
  nameKey: string | null;
  customName: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type BackupCard = {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  assigneeUserId: string | null;
  creatorUserId: string;
  position: number;
  dueDate: string | null;
  milestoneId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupGoal = {
  id: string;
  year: number;
  title: string;
  notes: string | null;
  position: number;
  creatorUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type BackupMilestone = {
  id: string;
  goalId: string;
  month: number;
  title: string;
  notes: string | null;
  status: string;
  position: number;
  creatorUserId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * One vision image's metadata — everything except its bytes, which travel through the paged
 * image routes. **Both digests** are recorded here, which is what lets the image phase verify
 * each payload against the envelope it belongs to rather than trusting the transfer.
 */
export type BackupVisionImage = {
  id: string;
  caption: string | null;
  goalId: string | null;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  contentDigest: string;
  thumbMediaType: string;
  thumbByteSize: number;
  thumbWidth: number;
  thumbHeight: number;
  thumbDigest: string;
  position: number;
  creatorUserId: string;
  createdAt: string;
  updatedAt: string;
};

/** One image's bytes, as the paged export returns them and the paged import accepts them. */
export type BackupImageBytes = {
  id: string;
  mediaType: string;
  data: string;
  thumbMediaType: string;
  thumbData: string;
  contentDigest: string;
  thumbDigest: string;
};

export type BackupCounts = {
  allowedEmails: number;
  users: number;
  activeUsers: number;
  recoveryCredentials: number;
  invitations: number;
  columns: number;
  cards: number;
  goals: number;
  milestones: number;
  visionImages: number;
};

/**
 * Recorded inside the payload, so it is covered by the digest and cannot be edited out of a
 * stored copy. Export never refuses on a finding — a household with a data anomaly still gets
 * a backup — and import always refuses when `ok` is false.
 */
export type BackupIntegrity = { ok: boolean; issues: string[] };

export type BackupPayload = {
  formatVersion: number;
  schemaVersion: number;
  householdId: string;
  createdAt: string;
  counts: BackupCounts;
  integrity: BackupIntegrity;
  appState: BackupAppState;
  boardState: BackupBoardState;
  goalState: BackupGoalState;
  visionState: BackupVisionState;
  allowedEmails: BackupAllowedEmail[];
  users: BackupUser[];
  recoveryCredentials: BackupRecoveryCredential[];
  invitations: BackupInvitation[];
  columns: BackupColumn[];
  cards: BackupCard[];
  goals: BackupGoal[];
  milestones: BackupMilestone[];
  visionImages: BackupVisionImage[];
};

/**
 * `digest` covers the canonical serialization of `payload` **as it was written**, which for a
 * version 1 copy is the version 1 shape. `sourceFormatVersion` records which that was, because
 * the payload handed back has already been transformed into the current shape.
 */
export type BackupEnvelope = { digest: string; payload: BackupPayload; sourceFormatVersion: number };

export type BackupLimits = {
  maxActiveUsers: number;
  maxAllowedEmails: number;
  maxColumns: number;
  maxCards: number;
  maxGoals: number;
  maxMilestones: number;
  maxVisionImages: number;
  maxVisionTotalBytes: number;
};

/**
 * Written without a parameter property on purpose: `scripts/backup.ts` imports this module and
 * runs under Node's type stripping, which erases annotations but cannot synthesise the
 * assignment a `constructor(readonly reason: string)` implies.
 */
export class BackupFormatError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'BackupFormatError';
    this.reason = reason;
  }
}

/**
 * Deterministic JSON: no insignificant whitespace, object keys ascending by UTF-16 code unit,
 * arrays in the order the caller built them. Only strings, safe integers, `null`, plain
 * objects and arrays are representable; anything else throws rather than serializing to
 * something a second implementation might render differently.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new BackupFormatError('only safe integers are representable');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const entry = record[key];
      if (entry === undefined) throw new BackupFormatError(`undefined value at ${key}`);
      parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new BackupFormatError(`unsupported value of type ${typeof value}`);
}

export function backupDigest(payload: BackupPayload): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/** The exact bytes a client receives. Built once; the digest is computed from the same text. */
export function serializeEnvelope(payload: BackupPayload): string {
  const body = canonicalJson(payload);
  const digest = createHash('sha256').update(body, 'utf8').digest('hex');
  return `{"digest":${JSON.stringify(digest)},"payload":${body}}`;
}

function fail(reason: string): never {
  throw new BackupFormatError(reason);
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${where} must be an object`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(`${where} must be an array`);
  return value;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where} must be a string`);
  return value;
}

function asNullableString(value: unknown, where: string): string | null {
  if (value === null) return null;
  return asString(value, where);
}

function asInteger(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(`${where} must be a safe integer`);
  return value;
}

function asCount(value: unknown, where: string): number {
  const count = asInteger(value, where);
  if (count < 0) fail(`${where} must not be negative`);
  return count;
}

/**
 * Rebuilds the payload field by field, **in the shape the declared format version was written
 * in**. An unexpected property is dropped by construction and would therefore change the
 * recomputed digest, so a tampered copy fails verification rather than being silently accepted
 * with extra data attached — and a version 1 copy has to be rebuilt without the version 2 fields
 * for exactly the same reason, or its own digest would no longer match.
 *
 * The transformation into the current shape happens afterwards, in `upgradePayload`, once the
 * digest has already been checked against what was actually stored.
 */
function readExactPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const formatVersion = asInteger(raw.formatVersion, 'formatVersion');
  const version2 = formatVersion >= 2;
  const counts = asObject(raw.counts, 'counts');
  const integrity = asObject(raw.integrity, 'integrity');
  const appState = asObject(raw.appState, 'appState');
  const boardState = asObject(raw.boardState, 'boardState');
  const issues = asArray(integrity.issues, 'integrity.issues').map((issue, index) =>
    asString(issue, `integrity.issues[${index}]`)
  );
  if (typeof integrity.ok !== 'boolean') fail('integrity.ok must be a boolean');

  // Every version-2 key is *absent* from a version-1 rebuild rather than defaulted, because
  // `canonicalJson` serializes whatever keys are present: adding one would change the digest and
  // a perfectly good version-1 copy would fail verification.
  const version2Fields = !version2
    ? {}
    : {
        goalState: (() => {
          const goalState = asObject(raw.goalState, 'goalState');
          return { revision: asCount(goalState.revision, 'goalState.revision') };
        })(),
        visionState: (() => {
          const visionState = asObject(raw.visionState, 'visionState');
          return {
            revision: asCount(visionState.revision, 'visionState.revision'),
            bytesUsed: asCount(visionState.bytesUsed, 'visionState.bytesUsed')
          };
        })(),
        goals: asArray(raw.goals, 'goals').map((entry, index) => {
          const row = asObject(entry, `goals[${index}]`);
          return {
            id: asString(row.id, `goals[${index}].id`),
            year: asInteger(row.year, `goals[${index}].year`),
            title: asString(row.title, `goals[${index}].title`),
            notes: asNullableString(row.notes, `goals[${index}].notes`),
            position: asCount(row.position, `goals[${index}].position`),
            creatorUserId: asString(row.creatorUserId, `goals[${index}].creatorUserId`),
            createdAt: asString(row.createdAt, `goals[${index}].createdAt`),
            updatedAt: asString(row.updatedAt, `goals[${index}].updatedAt`)
          };
        }),
        milestones: asArray(raw.milestones, 'milestones').map((entry, index) => {
          const row = asObject(entry, `milestones[${index}]`);
          return {
            id: asString(row.id, `milestones[${index}].id`),
            goalId: asString(row.goalId, `milestones[${index}].goalId`),
            month: asInteger(row.month, `milestones[${index}].month`),
            title: asString(row.title, `milestones[${index}].title`),
            notes: asNullableString(row.notes, `milestones[${index}].notes`),
            status: asString(row.status, `milestones[${index}].status`),
            position: asCount(row.position, `milestones[${index}].position`),
            creatorUserId: asString(row.creatorUserId, `milestones[${index}].creatorUserId`),
            createdAt: asString(row.createdAt, `milestones[${index}].createdAt`),
            updatedAt: asString(row.updatedAt, `milestones[${index}].updatedAt`)
          };
        }),
        visionImages: asArray(raw.visionImages, 'visionImages').map((entry, index) => {
          const row = asObject(entry, `visionImages[${index}]`);
          return {
            id: asString(row.id, `visionImages[${index}].id`),
            caption: asNullableString(row.caption, `visionImages[${index}].caption`),
            goalId: asNullableString(row.goalId, `visionImages[${index}].goalId`),
            mediaType: asString(row.mediaType, `visionImages[${index}].mediaType`),
            byteSize: asCount(row.byteSize, `visionImages[${index}].byteSize`),
            width: asCount(row.width, `visionImages[${index}].width`),
            height: asCount(row.height, `visionImages[${index}].height`),
            contentDigest: asString(row.contentDigest, `visionImages[${index}].contentDigest`),
            thumbMediaType: asString(row.thumbMediaType, `visionImages[${index}].thumbMediaType`),
            thumbByteSize: asCount(row.thumbByteSize, `visionImages[${index}].thumbByteSize`),
            thumbWidth: asCount(row.thumbWidth, `visionImages[${index}].thumbWidth`),
            thumbHeight: asCount(row.thumbHeight, `visionImages[${index}].thumbHeight`),
            thumbDigest: asString(row.thumbDigest, `visionImages[${index}].thumbDigest`),
            position: asCount(row.position, `visionImages[${index}].position`),
            creatorUserId: asString(row.creatorUserId, `visionImages[${index}].creatorUserId`),
            createdAt: asString(row.createdAt, `visionImages[${index}].createdAt`),
            updatedAt: asString(row.updatedAt, `visionImages[${index}].updatedAt`)
          };
        })
      };

  return {
    formatVersion,
    schemaVersion: asInteger(raw.schemaVersion, 'schemaVersion'),
    householdId: asString(raw.householdId, 'householdId'),
    createdAt: asString(raw.createdAt, 'createdAt'),
    counts: {
      allowedEmails: asCount(counts.allowedEmails, 'counts.allowedEmails'),
      users: asCount(counts.users, 'counts.users'),
      activeUsers: asCount(counts.activeUsers, 'counts.activeUsers'),
      recoveryCredentials: asCount(counts.recoveryCredentials, 'counts.recoveryCredentials'),
      invitations: asCount(counts.invitations, 'counts.invitations'),
      columns: asCount(counts.columns, 'counts.columns'),
      cards: asCount(counts.cards, 'counts.cards'),
      ...(version2
        ? {
            goals: asCount(counts.goals, 'counts.goals'),
            milestones: asCount(counts.milestones, 'counts.milestones'),
            visionImages: asCount(counts.visionImages, 'counts.visionImages')
          }
        : {})
    },
    ...version2Fields,
    integrity: { ok: integrity.ok, issues },
    appState: {
      bootstrapConsumed: asInteger(appState.bootstrapConsumed, 'appState.bootstrapConsumed'),
      allowlistRevision: asCount(appState.allowlistRevision, 'appState.allowlistRevision')
    },
    boardState: { revision: asCount(boardState.revision, 'boardState.revision') },
    allowedEmails: asArray(raw.allowedEmails, 'allowedEmails').map((entry, index) => {
      const row = asObject(entry, `allowedEmails[${index}]`);
      return {
        emailNorm: asString(row.emailNorm, `allowedEmails[${index}].emailNorm`),
        createdAt: asString(row.createdAt, `allowedEmails[${index}].createdAt`)
      };
    }),
    users: asArray(raw.users, 'users').map((entry, index) => {
      const row = asObject(entry, `users[${index}]`);
      return {
        id: asString(row.id, `users[${index}].id`),
        emailNorm: asString(row.emailNorm, `users[${index}].emailNorm`),
        passwordHash: asString(row.passwordHash, `users[${index}].passwordHash`),
        role: asString(row.role, `users[${index}].role`),
        status: asString(row.status, `users[${index}].status`),
        language: asString(row.language, `users[${index}].language`),
        credentialEpoch: asInteger(row.credentialEpoch, `users[${index}].credentialEpoch`),
        createdAt: asString(row.createdAt, `users[${index}].createdAt`),
        updatedAt: asString(row.updatedAt, `users[${index}].updatedAt`)
      };
    }),
    recoveryCredentials: asArray(raw.recoveryCredentials, 'recoveryCredentials').map((entry, index) => {
      const row = asObject(entry, `recoveryCredentials[${index}]`);
      return {
        userId: asString(row.userId, `recoveryCredentials[${index}].userId`),
        phraseDigest: asString(row.phraseDigest, `recoveryCredentials[${index}].phraseDigest`),
        version: asInteger(row.version, `recoveryCredentials[${index}].version`),
        createdAt: asString(row.createdAt, `recoveryCredentials[${index}].createdAt`)
      };
    }),
    invitations: asArray(raw.invitations, 'invitations').map((entry, index) => {
      const row = asObject(entry, `invitations[${index}]`);
      return {
        id: asString(row.id, `invitations[${index}].id`),
        emailNorm: asString(row.emailNorm, `invitations[${index}].emailNorm`),
        codeDigest: asString(row.codeDigest, `invitations[${index}].codeDigest`),
        createdBy: asString(row.createdBy, `invitations[${index}].createdBy`),
        createdAt: asString(row.createdAt, `invitations[${index}].createdAt`),
        expiresAt: asString(row.expiresAt, `invitations[${index}].expiresAt`),
        consumedAt: asNullableString(row.consumedAt, `invitations[${index}].consumedAt`),
        revokedAt: asNullableString(row.revokedAt, `invitations[${index}].revokedAt`)
      };
    }),
    columns: asArray(raw.columns, 'columns').map((entry, index) => {
      const row = asObject(entry, `columns[${index}]`);
      return {
        id: asString(row.id, `columns[${index}].id`),
        nameKey: asNullableString(row.nameKey, `columns[${index}].nameKey`),
        customName: asNullableString(row.customName, `columns[${index}].customName`),
        position: asCount(row.position, `columns[${index}].position`),
        createdAt: asString(row.createdAt, `columns[${index}].createdAt`),
        updatedAt: asString(row.updatedAt, `columns[${index}].updatedAt`)
      };
    }),
    cards: asArray(raw.cards, 'cards').map((entry, index) => {
      const row = asObject(entry, `cards[${index}]`);
      return {
        id: asString(row.id, `cards[${index}].id`),
        columnId: asString(row.columnId, `cards[${index}].columnId`),
        title: asString(row.title, `cards[${index}].title`),
        description: asNullableString(row.description, `cards[${index}].description`),
        assigneeUserId: asNullableString(row.assigneeUserId, `cards[${index}].assigneeUserId`),
        creatorUserId: asString(row.creatorUserId, `cards[${index}].creatorUserId`),
        position: asCount(row.position, `cards[${index}].position`),
        ...(version2
          ? {
              dueDate: asNullableString(row.dueDate, `cards[${index}].dueDate`),
              milestoneId: asNullableString(row.milestoneId, `cards[${index}].milestoneId`)
            }
          : {}),
        createdAt: asString(row.createdAt, `cards[${index}].createdAt`),
        updatedAt: asString(row.updatedAt, `cards[${index}].updatedAt`)
      };
    })
  };
}

/**
 * Transforms a verified version-1 payload into the current shape: no goals, no milestones, no
 * images, both new revisions at their seed value, and every `dueDate` and `milestoneId` null.
 *
 * This runs **after** the digest has been checked against the exact bytes that were stored, so
 * adding fields here can never make an older copy fail verification.
 */
function upgradePayload(exact: Record<string, unknown>): BackupPayload {
  const payload = exact as unknown as BackupPayload;
  if (asInteger(exact.formatVersion, 'formatVersion') >= 2) return payload;
  return {
    ...payload,
    counts: { ...payload.counts, goals: 0, milestones: 0, visionImages: 0 },
    goalState: { revision: 1 },
    visionState: { revision: 1, bytesUsed: 0 },
    goals: [],
    milestones: [],
    visionImages: [],
    cards: payload.cards.map(card => ({ ...card, dueDate: null, milestoneId: null }))
  };
}

/**
 * Parses and verifies one envelope. Throws `BackupFormatError` for anything malformed,
 * truncated, tampered with, or written by a newer format than this build understands.
 *
 * The digest is verified against the payload rebuilt in **its own** format version's shape; only
 * then is an older payload transformed into the current one.
 */
export function parseBackupEnvelope(text: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('the backup is not valid JSON');
  }
  const envelope = asObject(parsed, 'the backup');
  const digest = asString(envelope.digest, 'digest');
  if (!/^[0-9a-f]{64}$/.test(digest)) fail('digest must be 64 lower-case hex characters');
  const exact = readExactPayload(asObject(envelope.payload, 'payload'));
  const sourceFormatVersion = exact.formatVersion as number;

  if (!SUPPORTED_BACKUP_FORMAT_VERSIONS.includes(sourceFormatVersion)) {
    fail(`unsupported backup format version ${sourceFormatVersion}`);
  }

  /**
   * A format older than the schema it claims means the Worker that wrote it was running code
   * older than its own database — a rolled-back deployment — so the copy is silently missing
   * every row that code could not see. See `MAX_SCHEMA_FOR_FORMAT`.
   *
   * Deliberately scoped to formats **older** than the one this build writes. A copy carrying the
   * current format with a higher schema is not a rollback — a rolled-back writer emits an older
   * format by definition — it is simply a backup from a newer build, which the import's own
   * schema check refuses with `schema_mismatch`. Widening this to the current format would
   * hijack that case and, worse, would reject a perfectly good future backup from a migration
   * that did not need a format change.
   */
  const claimedSchema = exact.schemaVersion as number;
  const highestDescribable = MAX_SCHEMA_FOR_FORMAT[sourceFormatVersion];
  if (
    sourceFormatVersion < BACKUP_FORMAT_VERSION &&
    highestDescribable !== undefined &&
    claimedSchema > highestDescribable
  ) {
    fail(
      `this backup says format version ${sourceFormatVersion} but schema version ${claimedSchema}, and ` +
        `format ${sourceFormatVersion} cannot describe a schema-${claimedSchema} household. It was taken by a ` +
        `deployment whose code was older than its database, so it is missing every row that code could not ` +
        `read. Do not restore it: redeploy the matching code and take a fresh backup first`
    );
  }
  if (createHash('sha256').update(canonicalJson(exact), 'utf8').digest('hex') !== digest) {
    fail('the backup digest does not match its contents');
  }
  return { digest, payload: upgradePayload(exact), sourceFormatVersion };
}

/** One image's bytes, parsed and checked against the metadata the envelope recorded. */
export function parseImageBytes(raw: unknown): BackupImageBytes {
  const row = asObject(raw, 'the image');
  return {
    id: asString(row.id, 'id'),
    mediaType: asString(row.mediaType, 'mediaType'),
    data: asString(row.data, 'data'),
    thumbMediaType: asString(row.thumbMediaType, 'thumbMediaType'),
    thumbData: asString(row.thumbData, 'thumbData'),
    contentDigest: asString(row.contentDigest, 'contentDigest'),
    thumbDigest: asString(row.thumbDigest, 'thumbDigest')
  };
}

/** Counts are redundant on purpose: a silently truncated array is caught here. */
export function checkBackupCounts(payload: BackupPayload): string[] {
  const issues: string[] = [];
  const expected: Array<[keyof BackupCounts, number]> = [
    ['allowedEmails', payload.allowedEmails.length],
    ['users', payload.users.length],
    ['activeUsers', payload.users.filter(user => user.status === 'active').length],
    ['recoveryCredentials', payload.recoveryCredentials.length],
    ['invitations', payload.invitations.length],
    ['columns', payload.columns.length],
    ['cards', payload.cards.length],
    ['goals', payload.goals.length],
    ['milestones', payload.milestones.length],
    ['visionImages', payload.visionImages.length]
  ];
  for (const [name, actual] of expected) {
    if (payload.counts[name] !== actual) {
      issues.push(`counts.${name} says ${payload.counts[name]} but the backup holds ${actual}`);
    }
  }
  return issues;
}

/**
 * Every household invariant the application maintains, restated over the exported rows. The
 * caller supplies the limits so this module never has to repeat numbers that belong to the
 * board and account code.
 */
export function validateBackupIntegrity(payload: BackupPayload, limits: BackupLimits): string[] {
  const issues = checkBackupCounts(payload);

  const userIds = new Set<string>();
  for (const user of payload.users) {
    if (userIds.has(user.id)) issues.push(`user ${user.id} appears more than once`);
    userIds.add(user.id);
  }
  const emails = new Set(payload.users.map(user => user.emailNorm));
  if (emails.size !== payload.users.length) issues.push('two users share one email address');

  const owners = payload.users.filter(user => user.role === 'owner');
  if (owners.length !== 1) issues.push(`expected exactly one owner, found ${owners.length}`);
  const active = payload.users.filter(user => user.status === 'active');
  if (active.length > limits.maxActiveUsers) {
    issues.push(`${active.length} active users exceeds the limit of ${limits.maxActiveUsers}`);
  }

  const allowed = new Set(payload.allowedEmails.map(entry => entry.emailNorm));
  if (allowed.size !== payload.allowedEmails.length) issues.push('the allowed-email list contains a duplicate');
  if (allowed.size < 1 || allowed.size > limits.maxAllowedEmails) {
    issues.push(`the allowed-email list holds ${allowed.size} addresses, outside 1..${limits.maxAllowedEmails}`);
  }
  const owner = owners[0];
  if (owner && !allowed.has(owner.emailNorm)) issues.push('the owner address is not on the allowed-email list');

  const credentialUsers = new Set<string>();
  for (const credential of payload.recoveryCredentials) {
    if (credentialUsers.has(credential.userId)) {
      issues.push(`user ${credential.userId} has more than one recovery credential`);
    }
    credentialUsers.add(credential.userId);
    if (!userIds.has(credential.userId)) {
      issues.push(`recovery credential references unknown user ${credential.userId}`);
    }
  }

  const invitationIds = new Set<string>();
  const codeDigests = new Set<string>();
  for (const invitation of payload.invitations) {
    if (invitationIds.has(invitation.id)) issues.push(`invitation ${invitation.id} appears more than once`);
    invitationIds.add(invitation.id);
    if (codeDigests.has(invitation.codeDigest)) issues.push('two invitations share one code digest');
    codeDigests.add(invitation.codeDigest);
    if (!userIds.has(invitation.createdBy)) {
      issues.push(`invitation ${invitation.id} was created by unknown user ${invitation.createdBy}`);
    }
  }

  if (payload.columns.length > limits.maxColumns) {
    issues.push(`${payload.columns.length} columns exceeds the limit of ${limits.maxColumns}`);
  }
  if (payload.cards.length > limits.maxCards) {
    issues.push(`${payload.cards.length} cards exceeds the limit of ${limits.maxCards}`);
  }

  const columnIds = new Set<string>();
  payload.columns.forEach((column, index) => {
    if (columnIds.has(column.id)) issues.push(`column ${column.id} appears more than once`);
    columnIds.add(column.id);
    if (column.position !== index) {
      issues.push(`column ${column.id} is at position ${column.position} but is listed ${index}th`);
    }
    if ((column.nameKey === null) === (column.customName === null)) {
      issues.push(`column ${column.id} must carry exactly one of nameKey and customName`);
    }
  });

  // --- goals, milestones and images, restated over the exported rows -----------------------

  if (payload.goals.length > limits.maxGoals) {
    issues.push(`${payload.goals.length} goals exceeds the limit of ${limits.maxGoals}`);
  }
  if (payload.milestones.length > limits.maxMilestones) {
    issues.push(`${payload.milestones.length} milestones exceeds the limit of ${limits.maxMilestones}`);
  }
  if (payload.visionImages.length > limits.maxVisionImages) {
    issues.push(`${payload.visionImages.length} vision images exceeds the limit of ${limits.maxVisionImages}`);
  }

  const goalIds = new Set<string>();
  const nextGoalPosition = new Map<number, number>();
  for (const goal of payload.goals) {
    if (goalIds.has(goal.id)) issues.push(`goal ${goal.id} appears more than once`);
    goalIds.add(goal.id);
    if (goal.year < 2000 || goal.year > 2999) issues.push(`goal ${goal.id} has year ${goal.year}, outside 2000..2999`);
    if (!userIds.has(goal.creatorUserId)) {
      issues.push(`goal ${goal.id} was created by unknown user ${goal.creatorUserId}`);
    }
    const expected = nextGoalPosition.get(goal.year) ?? 0;
    if (goal.position !== expected) {
      issues.push(`goal ${goal.id} is at position ${goal.position} where its year expects ${expected}`);
    }
    nextGoalPosition.set(goal.year, expected + 1);
  }

  const milestoneIds = new Set<string>();
  const nextMilestonePosition = new Map<string, number>();
  const milestonesPerGoal = new Map<string, number>();
  for (const milestone of payload.milestones) {
    if (milestoneIds.has(milestone.id)) issues.push(`milestone ${milestone.id} appears more than once`);
    milestoneIds.add(milestone.id);
    if (!goalIds.has(milestone.goalId)) {
      issues.push(`milestone ${milestone.id} belongs to unknown goal ${milestone.goalId}`);
    }
    if (milestone.month < 1 || milestone.month > 12) {
      issues.push(`milestone ${milestone.id} has month ${milestone.month}, outside 1..12`);
    }
    if (milestone.status !== 'open' && milestone.status !== 'done') {
      issues.push(`milestone ${milestone.id} has status ${milestone.status}`);
    }
    if (!userIds.has(milestone.creatorUserId)) {
      issues.push(`milestone ${milestone.id} was created by unknown user ${milestone.creatorUserId}`);
    }
    const group = `${milestone.goalId}|${milestone.month}`;
    const expected = nextMilestonePosition.get(group) ?? 0;
    if (milestone.position !== expected) {
      issues.push(`milestone ${milestone.id} is at position ${milestone.position} where its month expects ${expected}`);
    }
    nextMilestonePosition.set(group, expected + 1);
    milestonesPerGoal.set(milestone.goalId, (milestonesPerGoal.get(milestone.goalId) ?? 0) + 1);
  }

  const HEX_64 = /^[0-9a-f]{64}$/;
  const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const imageIds = new Set<string>();
  let storedBytes = 0;
  payload.visionImages.forEach((image, index) => {
    if (imageIds.has(image.id)) issues.push(`vision image ${image.id} appears more than once`);
    imageIds.add(image.id);
    if (image.goalId !== null && !goalIds.has(image.goalId)) {
      issues.push(`vision image ${image.id} points at unknown goal ${image.goalId}`);
    }
    if (!userIds.has(image.creatorUserId)) {
      issues.push(`vision image ${image.id} was created by unknown user ${image.creatorUserId}`);
    }
    for (const [name, value] of [
      ['mediaType', image.mediaType],
      ['thumbMediaType', image.thumbMediaType]
    ] as const) {
      if (!MEDIA_TYPES.includes(value)) issues.push(`vision image ${image.id} has ${name} ${value}`);
    }
    // The digests are what the image phase verifies each payload against, so a malformed one
    // would make the restore unverifiable rather than merely untidy.
    for (const [name, value] of [
      ['contentDigest', image.contentDigest],
      ['thumbDigest', image.thumbDigest]
    ] as const) {
      if (!HEX_64.test(value)) issues.push(`vision image ${image.id} has a malformed ${name}`);
    }
    if (image.position !== index) {
      issues.push(`vision image ${image.id} is at position ${image.position} but is listed ${index}th`);
    }
    storedBytes += image.byteSize + image.thumbByteSize;
  });

  if (storedBytes > limits.maxVisionTotalBytes) {
    issues.push(`the gallery holds ${storedBytes} bytes, over the limit of ${limits.maxVisionTotalBytes}`);
  }
  // `bytesUsed` is the member-facing budget, and a restore that disagreed with it would hand the
  // household a budget that does not match what it is actually storing.
  if (payload.visionState.bytesUsed !== storedBytes) {
    issues.push(`visionState.bytesUsed says ${payload.visionState.bytesUsed} but the images hold ${storedBytes}`);
  }
  if (payload.goalState.revision < 1) issues.push('the goals revision must be at least 1');
  if (payload.visionState.revision < 1) issues.push('the vision revision must be at least 1');

  const assignable = new Set(active.filter(user => allowed.has(user.emailNorm)).map(user => user.id));
  const cardIds = new Set<string>();
  const nextPosition = new Map<string, number>();
  for (const card of payload.cards) {
    if (cardIds.has(card.id)) issues.push(`card ${card.id} appears more than once`);
    cardIds.add(card.id);
    if (!columnIds.has(card.columnId)) issues.push(`card ${card.id} is in unknown column ${card.columnId}`);
    if (!userIds.has(card.creatorUserId)) {
      issues.push(`card ${card.id} was created by unknown user ${card.creatorUserId}`);
    }
    if (card.assigneeUserId !== null && !assignable.has(card.assigneeUserId)) {
      issues.push(`card ${card.id} is assigned to ${card.assigneeUserId}, who is not an active allowlisted user`);
    }
    if (card.milestoneId !== null && !milestoneIds.has(card.milestoneId)) {
      issues.push(`card ${card.id} is linked to unknown milestone ${card.milestoneId}`);
    }
    // A calendar day, checked for shape only: whether it has passed is never a server's business.
    if (card.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(card.dueDate)) {
      issues.push(`card ${card.id} has a malformed due date`);
    }
    const expected = nextPosition.get(card.columnId) ?? 0;
    if (card.position !== expected) {
      issues.push(`card ${card.id} is at position ${card.position} where column order expects ${expected}`);
    }
    nextPosition.set(card.columnId, expected + 1);
  }

  if (payload.boardState.revision < 1) issues.push('the board revision must be at least 1');
  if (payload.appState.bootstrapConsumed !== 0 && payload.appState.bootstrapConsumed !== 1) {
    issues.push('appState.bootstrapConsumed must be 0 or 1');
  }

  return issues;
}

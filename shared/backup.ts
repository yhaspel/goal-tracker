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

/** Bump only for a change that an older reader cannot understand. */
export const BACKUP_FORMAT_VERSION = 1;

/** Every format version this build can still import. */
export const SUPPORTED_BACKUP_FORMAT_VERSIONS: readonly number[] = [1];

export type BackupAppState = { bootstrapConsumed: number; allowlistRevision: number };
export type BackupBoardState = { revision: number };
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
  createdAt: string;
  updatedAt: string;
};

export type BackupCounts = {
  allowedEmails: number;
  users: number;
  activeUsers: number;
  recoveryCredentials: number;
  invitations: number;
  columns: number;
  cards: number;
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
  allowedEmails: BackupAllowedEmail[];
  users: BackupUser[];
  recoveryCredentials: BackupRecoveryCredential[];
  invitations: BackupInvitation[];
  columns: BackupColumn[];
  cards: BackupCard[];
};

/** `digest` covers the canonical serialization of `payload` and of nothing else. */
export type BackupEnvelope = { digest: string; payload: BackupPayload };

export type BackupLimits = {
  maxActiveUsers: number;
  maxAllowedEmails: number;
  maxColumns: number;
  maxCards: number;
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
 * Rebuilds the payload field by field. An unexpected property is dropped by construction and
 * would therefore change the recomputed digest, so a tampered copy fails verification rather
 * than being silently accepted with extra data attached.
 */
function readPayload(raw: Record<string, unknown>): BackupPayload {
  const counts = asObject(raw.counts, 'counts');
  const integrity = asObject(raw.integrity, 'integrity');
  const appState = asObject(raw.appState, 'appState');
  const boardState = asObject(raw.boardState, 'boardState');
  const issues = asArray(integrity.issues, 'integrity.issues').map((issue, index) =>
    asString(issue, `integrity.issues[${index}]`)
  );
  if (typeof integrity.ok !== 'boolean') fail('integrity.ok must be a boolean');

  return {
    formatVersion: asInteger(raw.formatVersion, 'formatVersion'),
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
      cards: asCount(counts.cards, 'counts.cards')
    },
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
        createdAt: asString(row.createdAt, `cards[${index}].createdAt`),
        updatedAt: asString(row.updatedAt, `cards[${index}].updatedAt`)
      };
    })
  };
}

/**
 * Parses and verifies one envelope. Throws `BackupFormatError` for anything malformed,
 * truncated, tampered with, or written by a newer format than this build understands.
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
  const payload = readPayload(asObject(envelope.payload, 'payload'));

  if (!SUPPORTED_BACKUP_FORMAT_VERSIONS.includes(payload.formatVersion)) {
    fail(`unsupported backup format version ${payload.formatVersion}`);
  }
  if (backupDigest(payload) !== digest) fail('the backup digest does not match its contents');
  return { digest, payload };
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
    ['cards', payload.cards.length]
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

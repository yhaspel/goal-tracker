import type { InvitationStatus, Locale, UserRole, UserStatus } from '../../../shared/api';

/** One owner plus six members. Enforced inside the activating SQL transaction. */
export const MAX_ACTIVE_USERS = 7;
export const MAX_ALLOWED_EMAILS = 7;

export type AppStateRow = { bootstrap_consumed: number; allowlist_revision: number };

export type UserRow = {
  id: string;
  email_norm: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  language: Locale;
  credential_epoch: number;
  created_at: string;
  updated_at: string;
};

export type SessionRow = {
  id: string;
  user_id: string;
  token_digest: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type InvitationRow = {
  id: string;
  email_norm: string;
  code_digest: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

export type PendingRegistrationRow = {
  id: string;
  kind: 'bootstrap' | 'invite';
  email_norm: string;
  invitation_id: string | null;
  password_hash: string;
  phrase_digest: string;
  pending_token_digest: string;
  language: Locale;
  expires_at: string;
  failed_confirmations: number;
  created_at: string;
};

function one<T>(cursor: Iterable<T>): T | undefined {
  return [...cursor][0];
}

export function readAppState(sql: SqlStorage): AppStateRow {
  const row = one(sql.exec<AppStateRow>('SELECT bootstrap_consumed, allowlist_revision FROM app_state WHERE id = 1'));
  if (!row) throw new Error('app_state singleton row is missing');
  return row;
}

export function findUserByEmail(sql: SqlStorage, emailNorm: string): UserRow | undefined {
  return one(sql.exec<UserRow>('SELECT * FROM users WHERE email_norm = ?', emailNorm));
}

export function findUserById(sql: SqlStorage, id: string): UserRow | undefined {
  return one(sql.exec<UserRow>('SELECT * FROM users WHERE id = ?', id));
}

export function findOwner(sql: SqlStorage): UserRow | undefined {
  return one(sql.exec<UserRow>(`SELECT * FROM users WHERE role = 'owner'`));
}

export function listUsers(sql: SqlStorage): UserRow[] {
  return [...sql.exec<UserRow>('SELECT * FROM users ORDER BY created_at, id')];
}

export function countActiveUsers(sql: SqlStorage): number {
  return one(sql.exec<{ total: number }>(`SELECT COUNT(*) AS total FROM users WHERE status = 'active'`))?.total ?? 0;
}

export function isEmailAllowed(sql: SqlStorage, emailNorm: string): boolean {
  return one(sql.exec<{ found: number }>('SELECT 1 AS found FROM allowed_emails WHERE email_norm = ?', emailNorm)) !== undefined;
}

export function listAllowedEmails(sql: SqlStorage): string[] {
  return [...sql.exec<{ email_norm: string }>('SELECT email_norm FROM allowed_emails ORDER BY email_norm')]
    .map(row => row.email_norm);
}

export function insertAllowedEmail(sql: SqlStorage, emailNorm: string, at: string): void {
  sql.exec('INSERT OR IGNORE INTO allowed_emails (email_norm, created_at) VALUES (?, ?)', emailNorm, at);
}

export function deleteAllowedEmail(sql: SqlStorage, emailNorm: string): void {
  sql.exec('DELETE FROM allowed_emails WHERE email_norm = ?', emailNorm);
}

export function setAllowlistRevision(sql: SqlStorage, revision: number): void {
  sql.exec('UPDATE app_state SET allowlist_revision = ? WHERE id = 1', revision);
}

export function insertUser(sql: SqlStorage, user: UserRow): void {
  sql.exec(
    `INSERT INTO users (id, email_norm, password_hash, role, status, language, credential_epoch, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    user.email_norm,
    user.password_hash,
    user.role,
    user.status,
    user.language,
    user.credential_epoch,
    user.created_at,
    user.updated_at
  );
}

export function deactivateUser(sql: SqlStorage, userId: string, at: string): void {
  sql.exec(`UPDATE users SET status = 'inactive', updated_at = ? WHERE id = ?`, at, userId);
}

export function insertRecoveryCredential(sql: SqlStorage, userId: string, phraseDigest: string, at: string): void {
  sql.exec(
    'INSERT INTO recovery_credentials (user_id, phrase_digest, version, created_at) VALUES (?, ?, 1, ?)',
    userId,
    phraseDigest,
    at
  );
}

export type LiveSession = { session: SessionRow; user: UserRow };

/**
 * A session is live only while it is unrevoked, unexpired, its user is active, and that
 * user's email is still on the allowed list. Removing an email therefore ends access on
 * every device at the next request even before the stored row is revoked.
 */
export function findLiveSessionByDigest(sql: SqlStorage, tokenDigest: string, now: string): LiveSession | undefined {
  const session = one(sql.exec<SessionRow>(
    'SELECT * FROM sessions WHERE token_digest = ? AND revoked_at IS NULL AND expires_at > ?',
    tokenDigest,
    now
  ));
  if (!session) return undefined;
  const user = findUserById(sql, session.user_id);
  if (!user || user.status !== 'active') return undefined;
  if (!isEmailAllowed(sql, user.email_norm)) return undefined;
  return { session, user };
}

export function insertSession(sql: SqlStorage, session: SessionRow): void {
  sql.exec(
    'INSERT INTO sessions (id, user_id, token_digest, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)',
    session.id,
    session.user_id,
    session.token_digest,
    session.created_at,
    session.expires_at
  );
}

export function revokeSession(sql: SqlStorage, sessionId: string, at: string): void {
  sql.exec('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', at, sessionId);
}

export function revokeSessionsForUser(sql: SqlStorage, userId: string, at: string): void {
  sql.exec('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', at, userId);
}

export function findInvitationByDigest(sql: SqlStorage, codeDigest: string): InvitationRow | undefined {
  return one(sql.exec<InvitationRow>('SELECT * FROM invitations WHERE code_digest = ?', codeDigest));
}

export function findInvitationById(sql: SqlStorage, id: string): InvitationRow | undefined {
  return one(sql.exec<InvitationRow>('SELECT * FROM invitations WHERE id = ?', id));
}

export function listInvitations(sql: SqlStorage): InvitationRow[] {
  return [...sql.exec<InvitationRow>('SELECT * FROM invitations ORDER BY created_at DESC, id')];
}

export function insertInvitation(sql: SqlStorage, invitation: InvitationRow): void {
  sql.exec(
    `INSERT INTO invitations (id, email_norm, code_digest, created_by, created_at, expires_at, consumed_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    invitation.id,
    invitation.email_norm,
    invitation.code_digest,
    invitation.created_by,
    invitation.created_at,
    invitation.expires_at
  );
}

export function consumeInvitation(sql: SqlStorage, id: string, at: string): void {
  sql.exec('UPDATE invitations SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', at, id);
}

export function revokeInvitation(sql: SqlStorage, id: string, at: string): void {
  sql.exec('UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND consumed_at IS NULL', at, id);
}

export function revokeUnusedInvitationsForEmail(sql: SqlStorage, emailNorm: string, at: string): void {
  sql.exec(
    'UPDATE invitations SET revoked_at = ? WHERE email_norm = ? AND consumed_at IS NULL AND revoked_at IS NULL',
    at,
    emailNorm
  );
}

export function invitationStatus(invitation: InvitationRow, now: string): InvitationStatus {
  if (invitation.revoked_at !== null) return 'revoked';
  if (invitation.consumed_at !== null) return 'consumed';
  return invitation.expires_at <= now ? 'expired' : 'pending';
}

export function isInvitationUsable(invitation: InvitationRow, now: string): boolean {
  return invitationStatus(invitation, now) === 'pending';
}

export function findPendingRegistrationByDigest(sql: SqlStorage, tokenDigest: string): PendingRegistrationRow | undefined {
  return one(sql.exec<PendingRegistrationRow>('SELECT * FROM pending_registrations WHERE pending_token_digest = ?', tokenDigest));
}

export function insertPendingRegistration(sql: SqlStorage, pending: PendingRegistrationRow): void {
  sql.exec(
    `INSERT INTO pending_registrations
       (id, kind, email_norm, invitation_id, password_hash, phrase_digest, pending_token_digest, language,
        expires_at, failed_confirmations, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    pending.id,
    pending.kind,
    pending.email_norm,
    pending.invitation_id,
    pending.password_hash,
    pending.phrase_digest,
    pending.pending_token_digest,
    pending.language,
    pending.expires_at,
    pending.created_at
  );
}

export function deletePendingRegistration(sql: SqlStorage, id: string): void {
  sql.exec('DELETE FROM pending_registrations WHERE id = ?', id);
}

export function deletePendingRegistrationsForKind(sql: SqlStorage, kind: 'bootstrap' | 'invite'): void {
  sql.exec('DELETE FROM pending_registrations WHERE kind = ?', kind);
}

export function deletePendingRegistrationsForInvitation(sql: SqlStorage, invitationId: string): void {
  sql.exec('DELETE FROM pending_registrations WHERE invitation_id = ?', invitationId);
}

export function deletePendingRegistrationsForEmail(sql: SqlStorage, emailNorm: string): void {
  sql.exec('DELETE FROM pending_registrations WHERE email_norm = ?', emailNorm);
}

export function recordFailedConfirmation(sql: SqlStorage, id: string): number {
  sql.exec('UPDATE pending_registrations SET failed_confirmations = failed_confirmations + 1 WHERE id = ?', id);
  return one(sql.exec<{ failed_confirmations: number }>(
    'SELECT failed_confirmations FROM pending_registrations WHERE id = ?',
    id
  ))?.failed_confirmations ?? 0;
}

export function prunePendingRegistrations(sql: SqlStorage, now: string, limit = 50): void {
  sql.exec(
    `DELETE FROM pending_registrations WHERE id IN (
       SELECT id FROM pending_registrations WHERE expires_at <= ? LIMIT ${limit}
     )`,
    now
  );
}

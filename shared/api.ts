export type Locale = 'en' | 'he' | 'ru';
export const LOCALES: readonly Locale[] = ['en', 'he', 'ru'];

export type UserRole = 'owner' | 'member';
export type UserStatus = 'active' | 'inactive';

export type ApiErrorDetails = {
  boardRevision?: number;
  allowlistRevision?: number;
  fieldErrors?: Record<string, string>;
};

export type ApiSuccess<T> = { data: T };
export type ApiError = { error: { code: string; message: string; details?: ApiErrorDetails } };

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  language: Locale;
};

export type AuthenticatedResponse = { user: SessionUser; csrfToken: string };
export type BootstrapStatusResponse = { bootstrapAvailable: boolean };
export type PreparedRegistrationResponse = { pendingToken: string; recoveryPhrase: string; expiresAt: string };
export type SignedOutResponse = { signedOut: true };

/**
 * Every credential rotation starts by returning the replacement phrase exactly once. The
 * caller must re-enter it to confirm; nothing changes until then, so abandoning the flow
 * leaves the old password, phrase, and sessions in force.
 */
export type CredentialRotationStartResponse = {
  challengeToken: string;
  recoveryPhrase: string;
  expiresAt: string;
};

/** Confirmation revokes every session, so the caller must sign in again. */
export type CredentialRotationConfirmResponse = { rotated: true };

/**
 * `boardRevision` accompanies a write once the board exists, because changing who is active
 * and allowlisted changes the board snapshot's assignee choices.
 */
export type AllowedEmailsResponse = { emails: string[]; allowlistRevision: number; boardRevision?: number };

export type InvitationStatus = 'pending' | 'consumed' | 'revoked' | 'expired';
export type InvitationSummary = { id: string; email: string; expiresAt: string; status: InvitationStatus };
export type InvitationListResponse = { invitations: InvitationSummary[] };
export type CreatedInvitationResponse = { id: string; email: string; inviteCode: string; expiresAt: string };
export type RevokedInvitationResponse = { revoked: true };

/** Built-in column labels stay translation keys until the owner renames the column. */
export type BoardColumnKey = 'todo' | 'in_progress' | 'done';

export type BoardCard = {
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

export type BoardColumn = {
  id: string;
  nameKey: BoardColumnKey | null;
  customName: string | null;
  position: number;
  cards: BoardCard[];
};

/** Only what the board needs to offer an assignee choice. No credential material. */
export type BoardMember = { id: string; email: string };

export type BoardSnapshot = {
  boardRevision: number;
  columns: BoardColumn[];
  activeMembers: BoardMember[];
};

/**
 * Every successful mutation reports the revision the client should adopt. `unchanged` marks a
 * validated request that turned out to be a no-op and therefore wrote nothing.
 */
export type BoardMutationResponse = { boardRevision: number; id?: string; unchanged?: true };

export type MemberSummary = { id: string; email: string; role: UserRole; status: UserStatus; language: Locale };
export type MemberListResponse = { members: MemberSummary[] };
export type MemberResponse = { member: MemberSummary; boardRevision?: number };

export function jsonData<T>(data: T, status = 200, headers?: Record<string, string>): Response {
  return Response.json({ data } satisfies ApiSuccess<T>, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers }
  });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
  details?: ApiErrorDetails
): Response {
  const error = details === undefined ? { code, message } : { code, message, details };
  return Response.json({ error } satisfies ApiError, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers }
  });
}

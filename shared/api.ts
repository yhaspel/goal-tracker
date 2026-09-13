export type Locale = 'en' | 'he' | 'ru';
export const LOCALES: readonly Locale[] = ['en', 'he', 'ru'];

export type UserRole = 'owner' | 'member';
export type UserStatus = 'active' | 'inactive';

export type ApiErrorDetails = {
  boardRevision?: number;
  allowlistRevision?: number;
  goalsRevision?: number;
  visionRevision?: number;
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
export type PreferencesResponse = { language: Locale };
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
  /**
   * A calendar day, `YYYY-MM-DD`, or null. Deliberately not an instant: whether a card is
   * overdue is decided in the browser against the viewer's own local date, because a server
   * comparing against UTC would be wrong for several hours a day in Asia/Jerusalem.
   */
  dueDate: string | null;
  milestoneId: string | null;
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

// --- goals and milestones -------------------------------------------------------------------

export type MilestoneStatus = 'open' | 'done';

/** Only what a milestone row needs to show the cards serving it. No description, no assignee. */
export type MilestoneCardLink = { id: string; title: string; columnId: string };

export type Milestone = {
  id: string;
  goalId: string;
  month: number;
  title: string;
  notes: string | null;
  status: MilestoneStatus;
  position: number;
  creatorUserId: string;
  createdAt: string;
  updatedAt: string;
  cards: MilestoneCardLink[];
};

export type Goal = {
  id: string;
  year: number;
  title: string;
  notes: string | null;
  position: number;
  creatorUserId: string;
  createdAt: string;
  updatedAt: string;
  milestones: Milestone[];
};

/**
 * The full snapshot. `boardRevision` travels with it because the card links come from the board,
 * and both are read inside one transaction so they can never disagree.
 */
export type GoalsSnapshot = { goalsRevision: number; boardRevision: number; goals: Goal[] };

/** The compact form the card editor's "Part of" selector reads. No notes, no card links. */
export type GoalsIndex = {
  goalsRevision: number;
  goals: Array<{ id: string; year: number; title: string }>;
  milestones: Array<{ id: string; goalId: string; month: number; title: string; status: MilestoneStatus }>;
};

export type GoalSummary = { id: string; year: number; title: string };

export type GoalsMutationResponse = { goalsRevision: number; id?: string; unchanged?: true };

// --- vision board ---------------------------------------------------------------------------

export type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Metadata, digests and both sets of dimensions. Never bytes: those have their own route. */
export type VisionImage = {
  id: string;
  caption: string | null;
  goalId: string | null;
  mediaType: VisionMediaType;
  byteSize: number;
  width: number;
  height: number;
  contentDigest: string;
  thumbMediaType: VisionMediaType;
  thumbByteSize: number;
  thumbWidth: number;
  thumbHeight: number;
  thumbDigest: string;
  position: number;
  creatorUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type VisionSnapshot = { visionRevision: number; images: VisionImage[] };

export type VisionMutationResponse = { visionRevision: number; id?: string; unchanged?: true };

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

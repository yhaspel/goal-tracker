import type {
  AllowedEmailsResponse,
  AuthenticatedResponse,
  BoardMutationResponse,
  BoardSnapshot,
  BootstrapStatusResponse,
  CreatedInvitationResponse,
  CredentialRotationConfirmResponse,
  CredentialRotationStartResponse,
  GoalsIndex,
  GoalsMutationResponse,
  GoalsSnapshot,
  InvitationListResponse,
  Locale,
  MemberListResponse,
  MemberResponse,
  MilestoneStatus,
  PreferencesResponse,
  PreparedRegistrationResponse,
  RevokedInvitationResponse,
  SignedOutResponse,
  VisionMediaType,
  VisionMutationResponse,
  VisionSnapshot
} from '../../../shared/api';
import { api, type RequestOptions } from './client';

/**
 * The only place URLs and payload shapes are written down. Components call these, so the
 * published `/api/v1` contract stays the single source of truth and no second API shape can
 * drift into a component.
 */

export const bootstrapStatus = (options?: RequestOptions) =>
  api.get<BootstrapStatusResponse>('/api/v1/auth/bootstrap/status', options);

export const prepareBootstrap = (body: { bootstrapSecret: string; email: string; password: string; language?: Locale }) =>
  api.post<PreparedRegistrationResponse>('/api/v1/auth/bootstrap/prepare', body);

export const prepareRegistration = (body: { inviteCode: string; email: string; password: string; language?: Locale }) =>
  api.post<PreparedRegistrationResponse>('/api/v1/auth/registration/prepare', body);

export const confirmRegistration = (body: { pendingToken: string; recoveryPhrase: string }) =>
  api.post<AuthenticatedResponse>('/api/v1/auth/registration/confirm', body);

export const signIn = (body: { email: string; password: string }) =>
  api.post<AuthenticatedResponse>('/api/v1/auth/login', body);

export const readSession = (options?: RequestOptions) =>
  api.get<AuthenticatedResponse>('/api/v1/auth/session', options);

export const signOut = () => api.post<SignedOutResponse>('/api/v1/auth/logout');

export const updateLanguage = (language: Locale) =>
  api.patch<PreferencesResponse>('/api/v1/me/preferences', { language });

export const readAllowedEmails = (options?: RequestOptions) =>
  api.get<AllowedEmailsResponse>('/api/v1/settings/allowed-emails', options);

export const replaceAllowedEmails = (body: { emails: string[]; allowlistRevision: number }) =>
  api.put<AllowedEmailsResponse>('/api/v1/settings/allowed-emails', body);

export const readInvitations = (options?: RequestOptions) =>
  api.get<InvitationListResponse>('/api/v1/invitations', options);

export const createInvitation = (body: { email: string }) =>
  api.post<CreatedInvitationResponse>('/api/v1/invitations', body);

export const revokeInvitation = (id: string) =>
  api.delete<RevokedInvitationResponse>(`/api/v1/invitations/${encodeURIComponent(id)}`);

export const readMembers = (options?: RequestOptions) => api.get<MemberListResponse>('/api/v1/members', options);

export const deactivateMember = (id: string) =>
  api.patch<MemberResponse>(`/api/v1/members/${encodeURIComponent(id)}`, { status: 'inactive' });

export const startPhraseRecovery = (body: { email: string; recoveryPhrase: string; newPassword: string }) =>
  api.post<CredentialRotationStartResponse>('/api/v1/recovery/phrase/start', body);

export const confirmPhraseRecovery = (body: { challengeToken: string; newRecoveryPhrase: string }) =>
  api.post<CredentialRotationConfirmResponse>('/api/v1/recovery/phrase/confirm', body);

export const startOperatorRecovery = (body: { email: string; resetToken: string; newPassword: string }) =>
  api.post<CredentialRotationStartResponse>('/api/v1/recovery/operator/start', body);

export const confirmOperatorRecovery = (body: { challengeToken: string; newRecoveryPhrase: string }) =>
  api.post<CredentialRotationConfirmResponse>('/api/v1/recovery/operator/confirm', body);

export const startCredentialChange = (body: { currentPassword: string; newPassword?: string }) =>
  api.post<CredentialRotationStartResponse>('/api/v1/account/credentials/start', body);

export const confirmCredentialChange = (body: { challengeToken: string; newRecoveryPhrase: string }) =>
  api.post<CredentialRotationConfirmResponse>('/api/v1/account/credentials/confirm', body);

export const readBoard = (options?: RequestOptions) => api.get<BoardSnapshot>('/api/v1/board', options);

export const createColumn = (body: { boardRevision: number; name: string }) =>
  api.post<BoardMutationResponse>('/api/v1/columns', body);

export const renameColumn = (id: string, body: { boardRevision: number; name: string }) =>
  api.patch<BoardMutationResponse>(`/api/v1/columns/${encodeURIComponent(id)}`, body);

export const moveColumn = (id: string, body: { boardRevision: number; targetIndex: number }) =>
  api.post<BoardMutationResponse>(`/api/v1/columns/${encodeURIComponent(id)}/move`, body);

export const deleteColumn = (id: string, body: { boardRevision: number }) =>
  api.delete<BoardMutationResponse>(`/api/v1/columns/${encodeURIComponent(id)}`, body);

export const createCard = (body: {
  boardRevision: number;
  columnId: string;
  title: string;
  description?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  milestoneId?: string | null;
}) => api.post<BoardMutationResponse>('/api/v1/cards', body);

/** An omitted key keeps the stored value; an explicit `null` clears it. */
export const patchCard = (
  id: string,
  body: {
    boardRevision: number;
    title?: string;
    description?: string | null;
    assigneeUserId?: string | null;
    dueDate?: string | null;
    milestoneId?: string | null;
  }
) => api.patch<BoardMutationResponse>(`/api/v1/cards/${encodeURIComponent(id)}`, body);

export const moveCard = (id: string, body: { boardRevision: number; targetColumnId: string; targetIndex: number }) =>
  api.post<BoardMutationResponse>(`/api/v1/cards/${encodeURIComponent(id)}/move`, body);

export const deleteCard = (id: string, body: { boardRevision: number }) =>
  api.delete<BoardMutationResponse>(`/api/v1/cards/${encodeURIComponent(id)}`, body);

// --- goals and milestones -------------------------------------------------------------------

export const readGoals = (options?: RequestOptions) => api.get<GoalsSnapshot>('/api/v1/goals', options);

/** The compact form the card editor's "Part of" selector reads. No notes, no card links. */
export const readGoalsIndex = (options?: RequestOptions) =>
  api.get<GoalsIndex>('/api/v1/goals?view=index', options);

export const createGoal = (body: { goalsRevision: number; year: number; title: string; notes?: string | null }) =>
  api.post<GoalsMutationResponse>('/api/v1/goals', body);

export const patchGoal = (
  id: string,
  body: { goalsRevision: number; title?: string; notes?: string | null; year?: number }
) => api.patch<GoalsMutationResponse>(`/api/v1/goals/${encodeURIComponent(id)}`, body);

export const moveGoal = (id: string, body: { goalsRevision: number; targetIndex: number }) =>
  api.post<GoalsMutationResponse>(`/api/v1/goals/${encodeURIComponent(id)}/move`, body);

export const deleteGoal = (id: string, body: { goalsRevision: number }) =>
  api.delete<GoalsMutationResponse>(`/api/v1/goals/${encodeURIComponent(id)}`, body);

export const createMilestone = (body: {
  goalsRevision: number;
  goalId: string;
  month: number;
  title: string;
  notes?: string | null;
}) => api.post<GoalsMutationResponse>('/api/v1/milestones', body);

export const patchMilestone = (
  id: string,
  body: {
    goalsRevision: number;
    title?: string;
    notes?: string | null;
    month?: number;
    status?: MilestoneStatus;
  }
) => api.patch<GoalsMutationResponse>(`/api/v1/milestones/${encodeURIComponent(id)}`, body);

export const moveMilestone = (id: string, body: { goalsRevision: number; targetIndex: number }) =>
  api.post<GoalsMutationResponse>(`/api/v1/milestones/${encodeURIComponent(id)}/move`, body);

export const deleteMilestone = (id: string, body: { goalsRevision: number }) =>
  api.delete<GoalsMutationResponse>(`/api/v1/milestones/${encodeURIComponent(id)}`, body);

// --- vision board ---------------------------------------------------------------------------

export const readVision = (options?: RequestOptions) => api.get<VisionSnapshot>('/api/v1/vision', options);

/**
 * The bytes route, written down here with everything else so no component builds an image URL
 * of its own. It is the one `/api` response this app allows a private cache to keep.
 */
export const visionImageUrl = (id: string, variant: 'full' | 'thumb'): string =>
  variant === 'thumb'
    ? `/api/v1/vision/images/${encodeURIComponent(id)}/content?variant=thumb`
    : `/api/v1/vision/images/${encodeURIComponent(id)}/content`;

export const uploadVisionImage = (body: {
  visionRevision: number;
  mediaType: VisionMediaType;
  data: string;
  width: number;
  height: number;
  thumbMediaType: VisionMediaType;
  thumbData: string;
  thumbWidth: number;
  thumbHeight: number;
  caption?: string | null;
  goalId?: string | null;
}) => api.post<VisionMutationResponse>('/api/v1/vision/images', body);

export const patchVisionImage = (
  id: string,
  body: { visionRevision: number; caption?: string | null; goalId?: string | null }
) => api.patch<VisionMutationResponse>(`/api/v1/vision/images/${encodeURIComponent(id)}`, body);

export const moveVisionImage = (id: string, body: { visionRevision: number; targetIndex: number }) =>
  api.post<VisionMutationResponse>(`/api/v1/vision/images/${encodeURIComponent(id)}/move`, body);

export const deleteVisionImage = (id: string, body: { visionRevision: number }) =>
  api.delete<VisionMutationResponse>(`/api/v1/vision/images/${encodeURIComponent(id)}`, body);

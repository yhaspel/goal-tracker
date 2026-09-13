import type {
  AllowedEmailsResponse,
  AuthenticatedResponse,
  BoardMutationResponse,
  BoardSnapshot,
  BootstrapStatusResponse,
  CreatedInvitationResponse,
  CredentialRotationConfirmResponse,
  CredentialRotationStartResponse,
  InvitationListResponse,
  Locale,
  MemberListResponse,
  MemberResponse,
  PreparedRegistrationResponse,
  RevokedInvitationResponse,
  SignedOutResponse
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
}) => api.post<BoardMutationResponse>('/api/v1/cards', body);

export const patchCard = (
  id: string,
  body: { boardRevision: number; title?: string; description?: string | null; assigneeUserId?: string | null }
) => api.patch<BoardMutationResponse>(`/api/v1/cards/${encodeURIComponent(id)}`, body);

export const moveCard = (id: string, body: { boardRevision: number; targetColumnId: string; targetIndex: number }) =>
  api.post<BoardMutationResponse>(`/api/v1/cards/${encodeURIComponent(id)}/move`, body);

export const deleteCard = (id: string, body: { boardRevision: number }) =>
  api.delete<BoardMutationResponse>(`/api/v1/cards/${encodeURIComponent(id)}`, body);

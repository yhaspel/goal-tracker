import type { CredentialRotationStartResponse } from '../../../shared/api';
import {
  advanceCredentialEpoch,
  consumeOperatorToken,
  countLivePendingRotations,
  deletePendingRotationsForUser,
  findOperatorTokenById,
  findPendingRotationByDigest,
  findRecoveryCredential,
  findSessionById,
  findUserById,
  insertPendingRotation,
  isEmailAllowed,
  type PendingRotationRow,
  prunePendingRotations,
  pruneOperatorTokens,
  revokeSessionsForUser,
  rotateRecoveryCredential,
  setPasswordHash,
  type UserRow
} from '../db/account-repository';
import { conflict, forbidden } from '../http';
import type { RouteContext } from '../routes/context';
import { constantTimeEquals, newId, randomToken, sha256Hex } from './crypto';
import { generatePhrase, normalizePhrase, phraseDigest } from './phrases';

/** A challenge is short-lived on purpose: it holds an unconfirmed replacement credential. */
export const ROTATION_TTL_MS = 10 * 60 * 1000;

/** Bounds how many replacement phrases one account can have outstanding at once. */
export const MAX_LIVE_ROTATIONS_PER_USER = 3;

export type RotationMethod = PendingRotationRow['method'];

/** One message for every reason a rotation cannot proceed, so nothing is enumerable. */
export const ROTATION_REFUSAL = 'That request could not be completed.';

export type RotationPlan = {
  user: UserRow;
  method: RotationMethod;
  /** Null for a phrase-only regeneration, which deliberately leaves the password valid. */
  newPasswordHash: string | null;
  expectedSourceDigest: string | null;
  sourceSessionId: string | null;
  operatorTokenId: string | null;
};

/**
 * Writes the pending rotation and returns the replacement phrase exactly once.
 *
 * Everything expensive — verifying the old credential and hashing the new password — must be
 * finished before this runs, because the transaction callback is synchronous and must stay
 * short. The snapshot taken by the caller is re-checked here, so a concurrent rotation,
 * deactivation, or allowed-list removal that commits first wins.
 */
export function prepareRotation(ctx: RouteContext, plan: RotationPlan, digestKey: string): CredentialRotationStartResponse {
  const current = findRecoveryCredential(ctx.sql, plan.user.id);
  let recoveryPhrase = generatePhrase();
  let newPhraseDigest = phraseDigest(digestKey, normalizePhrase(recoveryPhrase)!);
  // A replacement identical to the current phrase would silently fail to rotate anything.
  while (current && newPhraseDigest === current.phrase_digest) {
    recoveryPhrase = generatePhrase();
    newPhraseDigest = phraseDigest(digestKey, normalizePhrase(recoveryPhrase)!);
  }

  const challengeToken = randomToken(32);
  const challengeDigest = sha256Hex(challengeToken);
  const expiresAt = new Date(ctx.now.getTime() + ROTATION_TTL_MS).toISOString();

  ctx.storage.transactionSync(() => {
    prunePendingRotations(ctx.sql, ctx.nowIso);
    pruneOperatorTokens(ctx.sql, ctx.nowIso);

    const fresh = findUserById(ctx.sql, plan.user.id);
    if (!fresh || fresh.status !== 'active' || !isEmailAllowed(ctx.sql, fresh.email_norm)) {
      throw forbidden('recovery_failed', ROTATION_REFUSAL);
    }
    if (fresh.credential_epoch !== plan.user.credential_epoch) throw forbidden('recovery_failed', ROTATION_REFUSAL);

    if (plan.method === 'phrase') {
      const credential = findRecoveryCredential(ctx.sql, fresh.id);
      if (!credential || credential.phrase_digest !== plan.expectedSourceDigest) {
        throw forbidden('recovery_failed', ROTATION_REFUSAL);
      }
    }
    if (plan.method === 'signed_in') {
      if (fresh.password_hash !== plan.expectedSourceDigest) throw forbidden('recovery_failed', ROTATION_REFUSAL);
      const session = plan.sourceSessionId === null ? undefined : findSessionById(ctx.sql, plan.sourceSessionId);
      if (!session || session.revoked_at !== null || session.expires_at <= ctx.nowIso) {
        throw forbidden('recovery_failed', ROTATION_REFUSAL);
      }
    }
    if (plan.method === 'operator') {
      const token = plan.operatorTokenId === null ? undefined : findOperatorTokenById(ctx.sql, plan.operatorTokenId);
      if (
        !token ||
        token.consumed_at !== null ||
        token.expires_at <= ctx.nowIso ||
        token.user_id !== fresh.id ||
        token.expected_credential_epoch !== fresh.credential_epoch
      ) {
        throw forbidden('recovery_failed', ROTATION_REFUSAL);
      }
    }

    if (countLivePendingRotations(ctx.sql, fresh.id, ctx.nowIso) >= MAX_LIVE_ROTATIONS_PER_USER) {
      throw conflict('too_many_rotations', 'Finish or wait for the pending recovery request before starting another.');
    }

    insertPendingRotation(ctx.sql, {
      id: newId(),
      user_id: fresh.id,
      method: plan.method,
      challenge_digest: challengeDigest,
      new_password_hash: plan.newPasswordHash,
      new_phrase_digest: newPhraseDigest,
      expected_credential_epoch: fresh.credential_epoch,
      expected_source_digest: plan.expectedSourceDigest,
      source_session_id: plan.sourceSessionId,
      operator_token_id: plan.operatorTokenId,
      created_at: ctx.nowIso,
      expires_at: expiresAt
    });
  });

  return { challengeToken, recoveryPhrase, expiresAt };
}

/**
 * Applies a prepared rotation in one synchronous transaction, or applies nothing.
 *
 * Every precondition is re-read here rather than trusted from the start call: the account is
 * still active and allowlisted, the credential epoch has not moved, the credential the
 * rotation was authorised against is unchanged, and an operator token is still unredeemed.
 * Advancing the epoch is what makes a second confirmation fail instead of overwriting the
 * first result.
 */
export function commitRotation(
  ctx: RouteContext,
  challengeToken: string,
  submittedPhrase: string,
  expectedMethod: RotationMethod,
  digestKey: string
): void {
  const challengeDigest = sha256Hex(challengeToken);
  const submittedDigest = phraseDigest(digestKey, submittedPhrase);

  ctx.storage.transactionSync(() => {
    const pending = findPendingRotationByDigest(ctx.sql, challengeDigest);
    if (!pending || pending.expires_at <= ctx.nowIso || pending.method !== expectedMethod) {
      throw forbidden('invalid_challenge', 'That recovery request is no longer valid. Start again.');
    }
    if (!constantTimeEquals(submittedDigest, pending.new_phrase_digest)) {
      throw forbidden('invalid_phrase', 'That recovery phrase did not match the one just shown.');
    }

    const user = findUserById(ctx.sql, pending.user_id);
    if (!user || user.status !== 'active' || !isEmailAllowed(ctx.sql, user.email_norm)) {
      throw conflict('rotation_conflict', ROTATION_REFUSAL);
    }
    if (user.credential_epoch !== pending.expected_credential_epoch) {
      throw conflict('rotation_conflict', ROTATION_REFUSAL);
    }

    if (pending.method === 'phrase') {
      const credential = findRecoveryCredential(ctx.sql, user.id);
      if (!credential || credential.phrase_digest !== pending.expected_source_digest) {
        throw conflict('rotation_conflict', ROTATION_REFUSAL);
      }
    }
    if (pending.method === 'signed_in') {
      if (user.password_hash !== pending.expected_source_digest) throw conflict('rotation_conflict', ROTATION_REFUSAL);
      const session = pending.source_session_id === null ? undefined : findSessionById(ctx.sql, pending.source_session_id);
      if (!session || session.revoked_at !== null || session.expires_at <= ctx.nowIso) {
        throw conflict('rotation_conflict', ROTATION_REFUSAL);
      }
    }
    if (pending.method === 'operator') {
      const token = pending.operator_token_id === null ? undefined : findOperatorTokenById(ctx.sql, pending.operator_token_id);
      if (
        !token ||
        token.consumed_at !== null ||
        token.expires_at <= ctx.nowIso ||
        token.user_id !== user.id ||
        token.expected_credential_epoch !== user.credential_epoch
      ) {
        throw conflict('rotation_conflict', ROTATION_REFUSAL);
      }
      consumeOperatorToken(ctx.sql, token.id, ctx.nowIso);
    }

    if (pending.new_password_hash !== null) setPasswordHash(ctx.sql, user.id, pending.new_password_hash, ctx.nowIso);
    rotateRecoveryCredential(ctx.sql, user.id, pending.new_phrase_digest, ctx.nowIso);
    advanceCredentialEpoch(ctx.sql, user.id, ctx.nowIso);
    revokeSessionsForUser(ctx.sql, user.id, ctx.nowIso);
    // Every other outstanding challenge for this account dies with the old credential state.
    deletePendingRotationsForUser(ctx.sql, user.id);
  });
}

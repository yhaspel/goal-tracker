import {
  type CredentialRotationConfirmResponse,
  type CredentialRotationStartResponse,
  jsonData
} from '../../../shared/api';
import { assertCsrf, assertNoLiveSession, requireActor } from '../auth/authorize';
import { constantTimeEquals } from '../auth/crypto';
import { normalizeEmail } from '../auth/email';
import { operatorTokenDigest } from '../auth/operator-tokens';
import { assertPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from '../auth/passwords';
import { normalizePhrase, phraseDigest } from '../auth/phrases';
import {
  clientIp,
  consumeRateLimit,
  pruneRateLimits,
  rateLimitKey,
  RATE_RULES
} from '../auth/rate-limits';
import {
  commitRotation,
  prepareRotation,
  ROTATION_REFUSAL,
  type RotationMethod,
  type RotationPlan
} from '../auth/recovery';
import { clearedSessionCookie } from '../auth/sessions';
import {
  findOperatorTokenByDigest,
  findRecoveryCredential,
  findUserByEmail,
  isEmailAllowed,
  type UserRow
} from '../db/account-repository';
import {
  assertOnlyKeys,
  assertSameOrigin,
  forbidden,
  type HttpError,
  invalidCredentials,
  invalidRequest,
  methodNotAllowed,
  rateLimited,
  readJsonObject,
  requiredString
} from '../http';
import { securityEvent } from '../security-log';
import { type RouteContext, requireSecrets, type Secrets } from './context';

function assertPost(request: Request): void {
  if (request.method !== 'POST') throw methodNotAllowed('POST');
}

/**
 * Charges the per-address and per-account budgets before any derivation runs, so an attacker
 * cannot force unbounded scrypt work through a recovery route. The account bucket is keyed by
 * the normalised email, which is HMAC'd before it reaches SQL.
 */
function chargeStart(ctx: RouteContext, secrets: Secrets, request: Request, account: string | null): void {
  const ipKey = rateLimitKey(secrets.rateLimit, 'recovery-start-ip', clientIp(request));
  const accountKey = account === null ? null : rateLimitKey(secrets.rateLimit, 'recovery-start-account', account);
  const decision = ctx.storage.transactionSync(() => {
    pruneRateLimits(ctx.sql, ctx.now);
    const byIp = consumeRateLimit(ctx.sql, ipKey, RATE_RULES.recoveryStartPerIp, ctx.now);
    const byAccount =
      accountKey === null ? null : consumeRateLimit(ctx.sql, accountKey, RATE_RULES.recoveryStartPerAccount, ctx.now);
    return { byIp, byAccount };
  });
  if (!decision.byIp.allowed || decision.byAccount?.allowed === false) {
    throw rateLimited(Math.max(decision.byIp.retryAfterSeconds, decision.byAccount?.retryAfterSeconds ?? 0));
  }
}

function chargeConfirm(ctx: RouteContext, secrets: Secrets, request: Request): void {
  const ipKey = rateLimitKey(secrets.rateLimit, 'recovery-confirm-ip', clientIp(request));
  const decision = ctx.storage.transactionSync(() =>
    consumeRateLimit(ctx.sql, ipKey, RATE_RULES.recoveryConfirmPerIp, ctx.now)
  );
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/**
 * Only an active, currently allowlisted account can rotate credentials. Callers must not be
 * able to tell an unknown address from a removed or deactivated one, so every rejection
 * carries the same refusal and burns one equivalent derivation.
 */
function eligible(ctx: RouteContext, user: UserRow | undefined): user is UserRow {
  return user !== undefined && user.status === 'active' && isEmailAllowed(ctx.sql, user.email_norm);
}

/** Paired with a preceding `dummyVerify` so every pre-auth refusal costs the same as a real attempt. */
function refusal(event: string): HttpError {
  securityEvent(event, 'denied');
  return forbidden('recovery_failed', ROTATION_REFUSAL);
}

async function respondStart(
  ctx: RouteContext,
  plan: RotationPlan,
  secrets: Secrets,
  event: string
): Promise<Response> {
  const prepared = prepareRotation(ctx, plan, secrets.recoveryDigest);
  securityEvent(event, 'allowed', { userId: plan.user.id, reason: plan.method });
  return jsonData<CredentialRotationStartResponse>(prepared, 201);
}

async function respondConfirm(
  ctx: RouteContext,
  request: Request,
  method: RotationMethod,
  event: string
): Promise<Response> {
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['challengeToken', 'newRecoveryPhrase']);
  chargeConfirm(ctx, secrets, request);

  const challengeToken = requiredString(body, 'challengeToken');
  const phrase = normalizePhrase(body.newRecoveryPhrase);
  if (phrase === null) throw invalidRequest();

  commitRotation(ctx, challengeToken, phrase, method, secrets.recoveryDigest);
  securityEvent(event, 'allowed', { reason: method });
  // No new session is issued: every session was just revoked, so the person signs in again.
  return jsonData<CredentialRotationConfirmResponse>({ rotated: true }, 200, {
    'Set-Cookie': clearedSessionCookie()
  });
}

// --- saved phrase -------------------------------------------------------------------------

async function phraseStart(ctx: RouteContext, request: Request): Promise<Response> {
  assertPost(request);
  assertSameOrigin(request);
  assertNoLiveSession(ctx, request);
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['email', 'recoveryPhrase', 'newPassword']);

  const email = normalizeEmail(body.email);
  const phrase = normalizePhrase(body.recoveryPhrase);
  const newPassword = requiredString(body, 'newPassword');
  // Checked before any lookup, so a weak password reveals nothing about the account.
  assertPasswordPolicy(newPassword);
  chargeStart(ctx, secrets, request, email);

  const user = email === null ? undefined : findUserByEmail(ctx.sql, email);
  if (!eligible(ctx, user) || phrase === null) {
    await dummyVerify(newPassword, ctx.kdf);
    throw refusal('recovery.phrase.start');
  }

  const credential = findRecoveryCredential(ctx.sql, user.id);
  if (!credential || !constantTimeEquals(credential.phrase_digest, phraseDigest(secrets.recoveryDigest, phrase))) {
    await dummyVerify(newPassword, ctx.kdf);
    throw refusal('recovery.phrase.start');
  }

  // The phrase is proven at this point, so a specific message about the new password is safe.
  if (await verifyPassword(newPassword, user.password_hash, ctx.kdf)) {
    throw invalidRequest('Choose a password you have not used here before.', { newPassword: 'reused' });
  }

  const newPasswordHash = await hashPassword(newPassword, ctx.kdf);
  return respondStart(
    ctx,
    {
      user,
      method: 'phrase',
      newPasswordHash,
      expectedSourceDigest: credential.phrase_digest,
      sourceSessionId: null,
      operatorTokenId: null
    },
    secrets,
    'recovery.phrase.start'
  );
}

// --- operator rescue ----------------------------------------------------------------------

async function operatorStart(ctx: RouteContext, request: Request): Promise<Response> {
  assertPost(request);
  assertSameOrigin(request);
  assertNoLiveSession(ctx, request);
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['email', 'resetToken', 'newPassword']);

  const email = normalizeEmail(body.email);
  const resetToken = requiredString(body, 'resetToken');
  const newPassword = requiredString(body, 'newPassword');
  assertPasswordPolicy(newPassword);
  chargeStart(ctx, secrets, request, email);

  const user = email === null ? undefined : findUserByEmail(ctx.sql, email);
  if (!eligible(ctx, user)) {
    await dummyVerify(newPassword, ctx.kdf);
    throw refusal('recovery.operator.start');
  }

  // The token must match this address as well as its digest, so a token issued for one person
  // cannot be redeemed against another account.
  const token = findOperatorTokenByDigest(ctx.sql, operatorTokenDigest(secrets.recoveryDigest, resetToken));
  if (
    !token ||
    token.consumed_at !== null ||
    token.expires_at <= ctx.nowIso ||
    token.user_id !== user.id ||
    token.expected_credential_epoch !== user.credential_epoch
  ) {
    await dummyVerify(newPassword, ctx.kdf);
    throw refusal('recovery.operator.start');
  }

  if (await verifyPassword(newPassword, user.password_hash, ctx.kdf)) {
    throw invalidRequest('Choose a password you have not used here before.', { newPassword: 'reused' });
  }

  const newPasswordHash = await hashPassword(newPassword, ctx.kdf);
  return respondStart(
    ctx,
    {
      user,
      method: 'operator',
      newPasswordHash,
      expectedSourceDigest: null,
      sourceSessionId: null,
      operatorTokenId: token.id
    },
    secrets,
    'recovery.operator.start'
  );
}

// --- signed in ----------------------------------------------------------------------------

async function credentialsStart(ctx: RouteContext, request: Request): Promise<Response> {
  assertPost(request);
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['currentPassword', 'newPassword']);

  const currentPassword = requiredString(body, 'currentPassword');
  const newPassword = body.newPassword === undefined ? null : requiredString(body, 'newPassword');
  if (newPassword !== null) assertPasswordPolicy(newPassword);
  chargeStart(ctx, secrets, request, actor.user.email_norm);

  if (!(await verifyPassword(currentPassword, actor.user.password_hash, ctx.kdf))) {
    securityEvent('account.credentials.start', 'denied', { userId: actor.user.id });
    throw invalidCredentials();
  }
  // Both plaintexts are in hand here, so reuse is an exact comparison rather than a derivation.
  if (newPassword !== null && newPassword === currentPassword) {
    throw invalidRequest('Choose a password you have not used here before.', { newPassword: 'reused' });
  }

  // Omitting the new password regenerates the phrase only and deliberately leaves the current
  // password valid. Every session still ends, so the person signs in again either way.
  const newPasswordHash = newPassword === null ? null : await hashPassword(newPassword, ctx.kdf);
  return respondStart(
    ctx,
    {
      user: actor.user,
      method: 'signed_in',
      newPasswordHash,
      expectedSourceDigest: actor.user.password_hash,
      sourceSessionId: actor.session.id,
      operatorTokenId: null
    },
    secrets,
    'account.credentials.start'
  );
}

async function credentialsConfirm(ctx: RouteContext, request: Request): Promise<Response> {
  assertPost(request);
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);
  return respondConfirm(ctx, request, 'signed_in', 'account.credentials.confirm');
}

async function preAuthConfirm(
  ctx: RouteContext,
  request: Request,
  method: RotationMethod,
  event: string
): Promise<Response> {
  assertPost(request);
  assertSameOrigin(request);
  assertNoLiveSession(ctx, request);
  return respondConfirm(ctx, request, method, event);
}

const RECOVERY_ROUTES: Record<string, (ctx: RouteContext, request: Request) => Promise<Response>> = {
  '/api/v1/recovery/phrase/start': phraseStart,
  '/api/v1/recovery/phrase/confirm': (ctx, request) => preAuthConfirm(ctx, request, 'phrase', 'recovery.phrase.confirm'),
  '/api/v1/recovery/operator/start': operatorStart,
  '/api/v1/recovery/operator/confirm': (ctx, request) =>
    preAuthConfirm(ctx, request, 'operator', 'recovery.operator.confirm'),
  '/api/v1/account/credentials/start': credentialsStart,
  '/api/v1/account/credentials/confirm': credentialsConfirm
};

export function handleRecoveryRoute(ctx: RouteContext, request: Request, path: string): Promise<Response> | undefined {
  const handler = RECOVERY_ROUTES[path];
  if (!handler) return undefined;
  return (async () => handler(ctx, request))();
}

import {
  type AuthenticatedResponse,
  type BootstrapStatusResponse,
  jsonData,
  type Locale,
  LOCALES,
  type PreparedRegistrationResponse,
  type SignedOutResponse
} from '../../../shared/api';
import {
  actorCsrfToken,
  assertCsrf,
  assertNoLiveSession,
  currentActor,
  publicUser,
  requireActor
} from '../auth/authorize';
import { csrfToken } from '../auth/csrf';
import { constantTimeEquals, newId, randomToken, sha256Hex } from '../auth/crypto';
import { normalizeEmail } from '../auth/email';
import { dummyVerify, hashPassword, validatePassword, verifyPassword } from '../auth/passwords';
import { generatePhrase, normalizePhrase, phraseDigest } from '../auth/phrases';
import {
  checkRateLimit,
  clientIp,
  consumeRateLimit,
  pruneRateLimits,
  rateLimitKey,
  RATE_RULES
} from '../auth/rate-limits';
import {
  clearedSessionCookie,
  newSessionToken,
  SESSION_TTL_MS,
  sessionCookie,
  sessionTokenDigest
} from '../auth/sessions';
import {
  consumeInvitation,
  countActiveUsers,
  deletePendingRegistration,
  deletePendingRegistrationsForEmail,
  deletePendingRegistrationsForInvitation,
  deletePendingRegistrationsForKind,
  findInvitationByDigest,
  findInvitationById,
  findOwner,
  findPendingRegistrationByDigest,
  findUserByEmail,
  findUserById,
  insertAllowedEmail,
  insertPendingRegistration,
  insertRecoveryCredential,
  insertSession,
  insertUser,
  isEmailAllowed,
  isInvitationUsable,
  MAX_ACTIVE_USERS,
  prunePendingRegistrations,
  readAppState,
  recordFailedConfirmation,
  revokeSession
} from '../db/account-repository';
import {
  assertOnlyKeys,
  assertSameOrigin,
  conflict,
  forbidden,
  invalidCredentials,
  invalidRequest,
  methodNotAllowed,
  readJsonObject,
  rateLimited,
  requiredString,
  unauthenticated
} from '../http';
import { securityEvent } from '../security-log';
import { type RouteContext, requireSecrets } from './context';

export const PENDING_REGISTRATION_TTL_MS = 15 * 60 * 1000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FAILED_CONFIRMATIONS = 5;

/**
 * One message for every way an invitation can be unusable — unknown, expired, revoked,
 * already consumed, addressed to a different email, or addressed to an email the owner has
 * since removed. An anonymous caller must not be able to tell these apart.
 */
const INVITATION_REFUSAL = 'That invitation cannot be used.';
const PENDING_REFUSAL = 'That registration is no longer valid. Start again.';

function parseLanguage(body: Record<string, unknown>): Locale {
  const value = body.language;
  if (value === undefined) return 'en';
  if (typeof value !== 'string' || !LOCALES.includes(value as Locale)) throw invalidRequest();
  return value as Locale;
}

function assertPasswordPolicy(password: string): void {
  const rejection = validatePassword(password);
  if (rejection !== null) throw invalidRequest('That password cannot be used.', { password: rejection });
}

function assertMethod(request: Request, allowed: string): void {
  if (request.method !== allowed) throw methodNotAllowed(allowed);
}

// --- bootstrap --------------------------------------------------------------------------

function bootstrapStatus(ctx: RouteContext, request: Request): Response {
  assertMethod(request, 'GET');
  const state = readAppState(ctx.sql);
  return jsonData<BootstrapStatusResponse>({ bootstrapAvailable: state.bootstrap_consumed === 0 });
}

async function bootstrapPrepare(ctx: RouteContext, request: Request): Promise<Response> {
  assertMethod(request, 'POST');
  assertSameOrigin(request);
  assertNoLiveSession(ctx, request);
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['bootstrapSecret', 'email', 'password', 'language']);

  pruneRateLimits(ctx.sql, ctx.now);
  const ipKey = rateLimitKey(secrets.rateLimit, 'bootstrap', clientIp(request));
  const limit = ctx.storage.transactionSync(() => consumeRateLimit(ctx.sql, ipKey, RATE_RULES.bootstrapPerIp, ctx.now));
  if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds);

  // Fails closed when the Cloudflare secret is absent, so a misconfigured deployment can
  // never open owner creation.
  const configured = ctx.env.BOOTSTRAP_SECRET;
  const provided = requiredString(body, 'bootstrapSecret');
  if (!configured || !constantTimeEquals(configured, provided)) {
    securityEvent('auth.bootstrap.prepare', 'denied', { reason: 'secret' });
    throw forbidden('forbidden', 'Bootstrap is not available.');
  }
  if (readAppState(ctx.sql).bootstrap_consumed !== 0) {
    throw conflict('bootstrap_consumed', 'The owner account already exists.');
  }

  const email = normalizeEmail(body.email);
  if (email === null) throw invalidRequest('Enter a valid email address.', { email: 'invalid_email' });
  const password = requiredString(body, 'password');
  assertPasswordPolicy(password);
  const language = parseLanguage(body);

  // Every expensive or asynchronous step happens before the transaction opens.
  const passwordHash = await hashPassword(password, ctx.kdf);
  const recoveryPhrase = generatePhrase();
  const digest = phraseDigest(secrets.recoveryDigest, normalizePhrase(recoveryPhrase)!);
  const pendingToken = randomToken(32);
  const pendingTokenDigest = sha256Hex(pendingToken);
  const expiresAt = new Date(ctx.now.getTime() + PENDING_REGISTRATION_TTL_MS).toISOString();

  ctx.storage.transactionSync(() => {
    if (readAppState(ctx.sql).bootstrap_consumed !== 0 || findOwner(ctx.sql)) {
      throw conflict('bootstrap_consumed', 'The owner account already exists.');
    }
    if (findUserByEmail(ctx.sql, email)) throw conflict('email_taken', 'That email address is already registered.');
    // A second prepare invalidates the first: only the last committed token stays usable.
    deletePendingRegistrationsForKind(ctx.sql, 'bootstrap');
    insertPendingRegistration(ctx.sql, {
      id: newId(),
      kind: 'bootstrap',
      email_norm: email,
      invitation_id: null,
      password_hash: passwordHash,
      phrase_digest: digest,
      pending_token_digest: pendingTokenDigest,
      language,
      expires_at: expiresAt,
      failed_confirmations: 0,
      created_at: ctx.nowIso
    });
  });

  securityEvent('auth.bootstrap.prepare', 'allowed');
  return jsonData<PreparedRegistrationResponse>({ pendingToken, recoveryPhrase, expiresAt }, 201);
}

// --- invitation registration ------------------------------------------------------------

async function registrationPrepare(ctx: RouteContext, request: Request): Promise<Response> {
  assertMethod(request, 'POST');
  assertSameOrigin(request);
  assertNoLiveSession(ctx, request);
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['inviteCode', 'email', 'password', 'language']);

  pruneRateLimits(ctx.sql, ctx.now);
  const ipKey = rateLimitKey(secrets.rateLimit, 'registration-prepare', clientIp(request));
  const limit = ctx.storage.transactionSync(() =>
    consumeRateLimit(ctx.sql, ipKey, RATE_RULES.registrationPreparePerIp, ctx.now)
  );
  if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds);

  const inviteCode = requiredString(body, 'inviteCode');
  const email = normalizeEmail(body.email);
  if (email === null) throw invalidRequest('Enter a valid email address.', { email: 'invalid_email' });
  const password = requiredString(body, 'password');
  assertPasswordPolicy(password);
  const language = parseLanguage(body);

  if (!/^[a-f0-9]{32}$/.test(inviteCode)) throw forbidden('invalid_invitation', INVITATION_REFUSAL);
  const codeDigest = sha256Hex(inviteCode);
  const invitation = findInvitationByDigest(ctx.sql, codeDigest);
  if (
    !invitation ||
    !isInvitationUsable(invitation, ctx.nowIso) ||
    invitation.email_norm !== email ||
    !isEmailAllowed(ctx.sql, email) ||
    findUserByEmail(ctx.sql, email)
  ) {
    securityEvent('auth.registration.prepare', 'denied', { reason: 'invitation' });
    throw forbidden('invalid_invitation', INVITATION_REFUSAL);
  }
  // Early guard only; the confirming transaction is the authoritative seat check. Refusing
  // here avoids burning a scrypt derivation on a registration that cannot complete.
  if (countActiveUsers(ctx.sql) >= MAX_ACTIVE_USERS) {
    throw conflict('seats_full', 'This group already has the maximum number of active people.');
  }

  const passwordHash = await hashPassword(password, ctx.kdf);
  const recoveryPhrase = generatePhrase();
  const digest = phraseDigest(secrets.recoveryDigest, normalizePhrase(recoveryPhrase)!);
  const pendingToken = randomToken(32);
  const pendingTokenDigest = sha256Hex(pendingToken);
  const expiresAt = new Date(ctx.now.getTime() + PENDING_REGISTRATION_TTL_MS).toISOString();

  ctx.storage.transactionSync(() => {
    const fresh = findInvitationByDigest(ctx.sql, codeDigest);
    if (
      !fresh ||
      !isInvitationUsable(fresh, ctx.nowIso) ||
      fresh.email_norm !== email ||
      !isEmailAllowed(ctx.sql, email) ||
      findUserByEmail(ctx.sql, email)
    ) {
      throw forbidden('invalid_invitation', INVITATION_REFUSAL);
    }
    deletePendingRegistrationsForInvitation(ctx.sql, fresh.id);
    insertPendingRegistration(ctx.sql, {
      id: newId(),
      kind: 'invite',
      email_norm: email,
      invitation_id: fresh.id,
      password_hash: passwordHash,
      phrase_digest: digest,
      pending_token_digest: pendingTokenDigest,
      language,
      expires_at: expiresAt,
      failed_confirmations: 0,
      created_at: ctx.nowIso
    });
  });

  securityEvent('auth.registration.prepare', 'allowed');
  return jsonData<PreparedRegistrationResponse>({ pendingToken, recoveryPhrase, expiresAt }, 201);
}

async function registrationConfirm(ctx: RouteContext, request: Request): Promise<Response> {
  assertMethod(request, 'POST');
  assertSameOrigin(request);
  assertNoLiveSession(ctx, request);
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['pendingToken', 'recoveryPhrase']);

  const ipKey = rateLimitKey(secrets.rateLimit, 'registration-confirm', clientIp(request));
  const limit = ctx.storage.transactionSync(() =>
    consumeRateLimit(ctx.sql, ipKey, RATE_RULES.registrationConfirmPerIp, ctx.now)
  );
  if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds);

  const pendingToken = requiredString(body, 'pendingToken');
  const phrase = normalizePhrase(body.recoveryPhrase);
  if (phrase === null) throw invalidRequest();

  prunePendingRegistrations(ctx.sql, ctx.nowIso);
  const pendingTokenDigest = sha256Hex(pendingToken);
  const pending = findPendingRegistrationByDigest(ctx.sql, pendingTokenDigest);
  if (!pending || pending.expires_at <= ctx.nowIso) throw forbidden('invalid_pending_token', PENDING_REFUSAL);

  if (!constantTimeEquals(phraseDigest(secrets.recoveryDigest, phrase), pending.phrase_digest)) {
    // Only this pending registration is penalised; the invitation itself stays usable.
    const exhausted = ctx.storage.transactionSync(() => {
      const failures = recordFailedConfirmation(ctx.sql, pending.id);
      if (failures < MAX_FAILED_CONFIRMATIONS) return false;
      deletePendingRegistration(ctx.sql, pending.id);
      return true;
    });
    securityEvent('auth.registration.confirm', 'denied', { reason: exhausted ? 'phrase_exhausted' : 'phrase' });
    throw forbidden('invalid_phrase', 'That recovery phrase did not match.');
  }

  const userId = newId();
  const sessionId = newId();
  const sessionToken = newSessionToken();
  const tokenDigest = sessionTokenDigest(sessionToken);
  const sessionExpiry = new Date(ctx.now.getTime() + SESSION_TTL_MS).toISOString();

  // Activation, seat enforcement, invitation consumption, and session creation all commit
  // together or not at all. The caller receives a cookie only after this commits.
  const user = ctx.storage.transactionSync(() => {
    const fresh = findPendingRegistrationByDigest(ctx.sql, pendingTokenDigest);
    if (!fresh || fresh.expires_at <= ctx.nowIso) throw forbidden('invalid_pending_token', PENDING_REFUSAL);

    if (fresh.kind === 'bootstrap') {
      if (readAppState(ctx.sql).bootstrap_consumed !== 0 || findOwner(ctx.sql)) {
        throw conflict('bootstrap_consumed', 'The owner account already exists.');
      }
      if (findUserByEmail(ctx.sql, fresh.email_norm)) {
        throw conflict('email_taken', 'That email address is already registered.');
      }
      insertUser(ctx.sql, {
        id: userId,
        email_norm: fresh.email_norm,
        password_hash: fresh.password_hash,
        role: 'owner',
        status: 'active',
        language: fresh.language,
        credential_epoch: 1,
        created_at: ctx.nowIso,
        updated_at: ctx.nowIso
      });
      // The owner's own address joins the allowed list in the same transaction and can
      // never be removed through the API.
      insertAllowedEmail(ctx.sql, fresh.email_norm, ctx.nowIso);
      ctx.sql.exec('UPDATE app_state SET bootstrap_consumed = 1, allowlist_revision = 1 WHERE id = 1');
    } else {
      if (fresh.invitation_id === null) throw forbidden('invalid_pending_token', PENDING_REFUSAL);
      const invitation = findInvitationById(ctx.sql, fresh.invitation_id);
      if (!invitation || !isInvitationUsable(invitation, ctx.nowIso) || invitation.email_norm !== fresh.email_norm) {
        throw forbidden('invalid_invitation', INVITATION_REFUSAL);
      }
      if (!isEmailAllowed(ctx.sql, fresh.email_norm)) throw forbidden('invalid_invitation', INVITATION_REFUSAL);
      if (findUserByEmail(ctx.sql, fresh.email_norm)) {
        throw conflict('email_taken', 'That email address is already registered.');
      }
      if (countActiveUsers(ctx.sql) >= MAX_ACTIVE_USERS) {
        throw conflict('seats_full', 'This group already has the maximum number of active people.');
      }
      insertUser(ctx.sql, {
        id: userId,
        email_norm: fresh.email_norm,
        password_hash: fresh.password_hash,
        role: 'member',
        status: 'active',
        language: fresh.language,
        credential_epoch: 1,
        created_at: ctx.nowIso,
        updated_at: ctx.nowIso
      });
      consumeInvitation(ctx.sql, invitation.id, ctx.nowIso);
    }

    insertRecoveryCredential(ctx.sql, userId, fresh.phrase_digest, ctx.nowIso);
    insertSession(ctx.sql, {
      id: sessionId,
      user_id: userId,
      token_digest: tokenDigest,
      created_at: ctx.nowIso,
      expires_at: sessionExpiry,
      revoked_at: null
    });
    deletePendingRegistration(ctx.sql, fresh.id);
    deletePendingRegistrationsForEmail(ctx.sql, fresh.email_norm);

    const created = findUserById(ctx.sql, userId);
    if (!created) throw new Error('user row missing immediately after insert');
    return created;
  });

  securityEvent('auth.registration.confirm', 'allowed', { userId: user.id, role: user.role });
  return jsonData<AuthenticatedResponse>(
    { user: publicUser(user), csrfToken: csrfToken(secrets.csrf, sessionId, tokenDigest) },
    201,
    { 'Set-Cookie': sessionCookie(sessionToken) }
  );
}

// --- session ----------------------------------------------------------------------------

async function login(ctx: RouteContext, request: Request): Promise<Response> {
  assertMethod(request, 'POST');
  assertSameOrigin(request);
  assertNoLiveSession(ctx, request);
  const secrets = requireSecrets(ctx.env);
  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['email', 'password']);

  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  // A malformed address cannot match any account, so it gets the same answer as a wrong
  // password rather than a distinguishable validation error.
  if (email === null || password.length === 0) throw invalidCredentials();

  pruneRateLimits(ctx.sql, ctx.now);
  const emailKey = rateLimitKey(secrets.rateLimit, 'login-email', email);
  const ipKey = rateLimitKey(secrets.rateLimit, 'login-ip', clientIp(request));
  const byEmail = checkRateLimit(ctx.sql, emailKey, RATE_RULES.loginPerEmail, ctx.now);
  const byIp = checkRateLimit(ctx.sql, ipKey, RATE_RULES.loginPerIp, ctx.now);
  // Checked before the derivation so an attacker cannot force unbounded scrypt work.
  if (!byEmail.allowed || !byIp.allowed) {
    throw rateLimited(Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds));
  }

  const candidate = findUserByEmail(ctx.sql, email);
  const eligible =
    candidate !== undefined && candidate.status === 'active' && isEmailAllowed(ctx.sql, candidate.email_norm);
  // An unknown account, a deactivated account, and an account whose email the owner removed
  // all cost the same one derivation as a real wrong password.
  const verified = eligible
    ? await verifyPassword(password, candidate.password_hash, ctx.kdf)
    : await dummyVerify(password, ctx.kdf);

  if (!verified) {
    ctx.storage.transactionSync(() => {
      consumeRateLimit(ctx.sql, emailKey, RATE_RULES.loginPerEmail, ctx.now);
      consumeRateLimit(ctx.sql, ipKey, RATE_RULES.loginPerIp, ctx.now);
    });
    securityEvent('auth.login', 'denied');
    throw invalidCredentials();
  }

  const sessionId = newId();
  const sessionToken = newSessionToken();
  const tokenDigest = sessionTokenDigest(sessionToken);
  const sessionExpiry = new Date(ctx.now.getTime() + SESSION_TTL_MS).toISOString();

  // Re-checked inside the inserting transaction: a removal or deactivation that commits
  // between verification and this point wins, and no usable cookie is issued.
  const user = ctx.storage.transactionSync(() => {
    const fresh = findUserByEmail(ctx.sql, email);
    if (!fresh || fresh.status !== 'active' || !isEmailAllowed(ctx.sql, fresh.email_norm)) throw invalidCredentials();
    insertSession(ctx.sql, {
      id: sessionId,
      user_id: fresh.id,
      token_digest: tokenDigest,
      created_at: ctx.nowIso,
      expires_at: sessionExpiry,
      revoked_at: null
    });
    return fresh;
  });

  securityEvent('auth.login', 'allowed', { userId: user.id, role: user.role });
  return jsonData<AuthenticatedResponse>(
    { user: publicUser(user), csrfToken: csrfToken(secrets.csrf, sessionId, tokenDigest) },
    200,
    { 'Set-Cookie': sessionCookie(sessionToken) }
  );
}

function readSession(ctx: RouteContext, request: Request): Response {
  assertMethod(request, 'GET');
  const actor = requireActor(ctx, request);
  return jsonData<AuthenticatedResponse>({ user: publicUser(actor.user), csrfToken: actorCsrfToken(ctx, actor) });
}

function logout(ctx: RouteContext, request: Request): Response {
  assertMethod(request, 'POST');
  assertSameOrigin(request);
  const actor = currentActor(ctx, request);
  // A stale cookie is cleared rather than left to fail repeatedly on the client.
  if (!actor) throw unauthenticated({ 'Set-Cookie': clearedSessionCookie() });
  assertCsrf(ctx, request, actor);
  ctx.storage.transactionSync(() => revokeSession(ctx.sql, actor.session.id, ctx.nowIso));
  securityEvent('auth.logout', 'allowed', { userId: actor.user.id });
  return jsonData<SignedOutResponse>({ signedOut: true }, 200, { 'Set-Cookie': clearedSessionCookie() });
}

const AUTH_ROUTES: Record<string, (ctx: RouteContext, request: Request) => Response | Promise<Response>> = {
  '/api/v1/auth/bootstrap/status': bootstrapStatus,
  '/api/v1/auth/bootstrap/prepare': bootstrapPrepare,
  '/api/v1/auth/registration/prepare': registrationPrepare,
  '/api/v1/auth/registration/confirm': registrationConfirm,
  '/api/v1/auth/login': login,
  '/api/v1/auth/session': readSession,
  '/api/v1/auth/logout': logout
};

/**
 * Returns undefined when the path is not an auth route. Matching routes run inside an async
 * wrapper so a synchronous throw becomes a rejection the caller can map uniformly.
 */
export function handleAuthRoute(ctx: RouteContext, request: Request, path: string): Promise<Response> | undefined {
  const handler = AUTH_ROUTES[path];
  if (!handler) return undefined;
  return (async () => handler(ctx, request))();
}

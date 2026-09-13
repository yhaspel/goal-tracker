import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AllowedEmailsResponse,
  AuthenticatedResponse,
  BootstrapStatusResponse,
  CreatedInvitationResponse,
  InvitationListResponse,
  MemberListResponse,
  MemberResponse,
  PreparedRegistrationResponse,
  SignedOutResponse
} from '../shared/api';
import {
  ApiClient,
  bootstrapOwner,
  bootstrapSecret,
  issueInvitation,
  login,
  registerMember,
  setAllowedEmails,
  testPassword
} from './helpers/auth-client';

const OWNER = 'owner@example.test';
const MEMBERS = [1, 2, 3, 4, 5, 6].map(index => `member${index}@example.test`);

beforeEach(async () => {
  await reset();
});

describe('owner bootstrap', () => {
  it('creates exactly one owner, seeds the allowed list, and closes the route', async () => {
    const owner = new ApiClient();

    const before = await owner.call<BootstrapStatusResponse>('GET', '/api/v1/auth/bootstrap/status');
    expect(before.data).toEqual({ bootstrapAvailable: true });

    const prepared = await owner.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/bootstrap/prepare', {
      body: { bootstrapSecret: bootstrapSecret(), email: `  ${OWNER.toUpperCase()} `, password: testPassword('owner') }
    });
    expect(prepared.status).toBe(201);
    expect(prepared.data?.recoveryPhrase.split(' ')).toHaveLength(12);
    // Preparing does not yet create an owner.
    expect((await owner.call<BootstrapStatusResponse>('GET', '/api/v1/auth/bootstrap/status')).data)
      .toEqual({ bootstrapAvailable: true });

    const confirmed = await owner.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: prepared.data!.pendingToken, recoveryPhrase: prepared.data!.recoveryPhrase }
    });
    expect(confirmed.status).toBe(201);
    const session = owner.adopt(confirmed);
    // The surrounding spaces and upper case normalised away.
    expect(session.user).toEqual({ id: expect.any(String), email: OWNER, role: 'owner', status: 'active', language: 'en' });

    expect((await owner.call<BootstrapStatusResponse>('GET', '/api/v1/auth/bootstrap/status')).data)
      .toEqual({ bootstrapAvailable: false });

    const list = await owner.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails');
    expect(list.data).toEqual({ emails: [OWNER], allowlistRevision: 1 });
  });

  it('refuses a second bootstrap even with the configured secret', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    const guest = new ApiClient('203.0.113.44');

    const again = await guest.call('POST', '/api/v1/auth/bootstrap/prepare', {
      body: { bootstrapSecret: bootstrapSecret(), email: 'second@example.test', password: testPassword('second') }
    });
    expect(again.status).toBe(409);
    expect(again.error?.code).toBe('bootstrap_consumed');
  });

  it('fails closed on a wrong secret without revealing anything', async () => {
    const guest = new ApiClient();
    const denied = await guest.call('POST', '/api/v1/auth/bootstrap/prepare', {
      body: { bootstrapSecret: 'not-the-secret', email: OWNER, password: testPassword('owner') }
    });
    expect(denied.status).toBe(403);
    expect(denied.error?.code).toBe('forbidden');
    expect((await guest.call<BootstrapStatusResponse>('GET', '/api/v1/auth/bootstrap/status')).data)
      .toEqual({ bootstrapAvailable: true });
  });
});

describe('allowed emails', () => {
  it('replaces the whole set, bumps the revision, and rejects a stale one', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);

    const saved = await setAllowedEmails(owner, [OWNER, ...MEMBERS.slice(0, 3)]);
    expect(saved.allowlistRevision).toBe(2);
    expect(saved.emails).toEqual([OWNER, ...MEMBERS.slice(0, 3)].sort());

    const stale = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
      body: { emails: [OWNER], allowlistRevision: 1 }
    });
    expect(stale.status).toBe(409);
    expect(stale.error?.code).toBe('allowlist_conflict');
    expect(stale.error?.details).toEqual({ allowlistRevision: 2 });
    // The rejected edit wrote nothing.
    expect((await owner.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails')).data?.emails)
      .toEqual([OWNER, ...MEMBERS.slice(0, 3)].sort());
  });

  it('leaves the revision untouched for a no-op replacement', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    const first = await setAllowedEmails(owner, [OWNER, MEMBERS[0]!]);
    const repeat = await setAllowedEmails(owner, [MEMBERS[0]!, OWNER]);
    expect(repeat.allowlistRevision).toBe(first.allowlistRevision);
  });

  it('rejects lists that drop the owner, duplicate, or exceed seven addresses', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    const revision = 1;

    const withoutOwner = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
      body: { emails: [MEMBERS[0]], allowlistRevision: revision }
    });
    expect(withoutOwner.status).toBe(400);
    expect(withoutOwner.error?.details).toEqual({ fieldErrors: { emails: 'owner_required' } });

    const duplicated = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
      body: { emails: [OWNER, MEMBERS[0], MEMBERS[0]!.toUpperCase()], allowlistRevision: revision }
    });
    expect(duplicated.status).toBe(400);
    expect(duplicated.error?.details).toEqual({ fieldErrors: { emails: 'invalid_emails' } });

    const tooMany = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
      body: {
        emails: [OWNER, ...MEMBERS, 'extra@example.test'],
        allowlistRevision: revision
      }
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.error?.details).toEqual({ fieldErrors: { emails: 'invalid_count' } });

    expect((await owner.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails')).data)
      .toEqual({ emails: [OWNER], allowlistRevision: revision });
  });
});

describe('invitations and registration', () => {
  it('issues a one-time code, registers the invited member, and never shows the code again', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!]);

    const invitation = await issueInvitation(owner, MEMBERS[0]!);
    expect(invitation.inviteCode).toMatch(/^[a-f0-9]{32}$/);

    const listed = await owner.call<InvitationListResponse>('GET', '/api/v1/invitations');
    expect(listed.data?.invitations).toEqual([
      { id: invitation.id, email: MEMBERS[0], expiresAt: invitation.expiresAt, status: 'pending' }
    ]);
    expect(JSON.stringify(listed.data)).not.toContain(invitation.inviteCode);

    const member = new ApiClient('203.0.113.20');
    const registered = await registerMember(member, invitation.inviteCode, MEMBERS[0]!);
    expect(registered.user.role).toBe('member');
    expect(registered.user.status).toBe('active');

    // The invitation is now consumed and cannot be replayed.
    const replay = new ApiClient('203.0.113.21');
    const reused = await replay.call('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode: invitation.inviteCode, email: MEMBERS[0], password: testPassword('replay') }
    });
    expect(reused.status).toBe(403);
    expect(reused.error?.code).toBe('invalid_invitation');

    const after = await owner.call<InvitationListResponse>('GET', '/api/v1/invitations');
    expect(after.data?.invitations[0]?.status).toBe('consumed');
  });

  it('keeps an invitation usable after an abandoned or mistyped registration', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!]);
    const invitation = await issueInvitation(owner, MEMBERS[0]!);

    const member = new ApiClient('203.0.113.22');
    const first = await member.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode: invitation.inviteCode, email: MEMBERS[0], password: testPassword('first') }
    });
    const wrongPhrase = await member.call('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: first.data!.pendingToken, recoveryPhrase: 'wrong words that do not match at all here' }
    });
    expect(wrongPhrase.status).toBe(403);
    expect(wrongPhrase.error?.code).toBe('invalid_phrase');

    // Retrying with the correct phrase still works while the pending record is valid.
    const recovered = await member.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: first.data!.pendingToken, recoveryPhrase: first.data!.recoveryPhrase }
    });
    expect(recovered.status).toBe(201);
  });

  it('invalidates the earlier pending token when the same invitation is prepared twice', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!]);
    const invitation = await issueInvitation(owner, MEMBERS[0]!);

    const member = new ApiClient('203.0.113.23');
    const first = await member.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode: invitation.inviteCode, email: MEMBERS[0], password: testPassword('one') }
    });
    const second = await member.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode: invitation.inviteCode, email: MEMBERS[0], password: testPassword('two') }
    });

    const stale = await member.call('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: first.data!.pendingToken, recoveryPhrase: first.data!.recoveryPhrase }
    });
    expect(stale.status).toBe(403);
    expect(stale.error?.code).toBe('invalid_pending_token');

    const fresh = await member.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: second.data!.pendingToken, recoveryPhrase: second.data!.recoveryPhrase }
    });
    expect(fresh.status).toBe(201);
  });

  it('revokes an unused invitation and refuses to revoke a consumed one', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!, MEMBERS[1]!]);

    const revokable = await issueInvitation(owner, MEMBERS[0]!);
    expect((await owner.call('DELETE', `/api/v1/invitations/${revokable.id}`)).status).toBe(200);
    const afterRevoke = await new ApiClient('203.0.113.24').call('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode: revokable.inviteCode, email: MEMBERS[0], password: testPassword('revoked') }
    });
    expect(afterRevoke.error?.code).toBe('invalid_invitation');

    const consumed = await issueInvitation(owner, MEMBERS[1]!);
    await registerMember(new ApiClient('203.0.113.25'), consumed.inviteCode, MEMBERS[1]!);
    const revokeConsumed = await owner.call('DELETE', `/api/v1/invitations/${consumed.id}`);
    expect(revokeConsumed.status).toBe(409);
    expect(revokeConsumed.error?.code).toBe('invitation_consumed');

    expect((await owner.call('DELETE', '/api/v1/invitations/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('sessions', () => {
  it('signs in, reissues CSRF after a reload, and signs out server-side', async () => {
    const owner = new ApiClient();
    const password = testPassword('owner');
    await bootstrapOwner(owner, OWNER, password);

    const signedOut = await owner.call<SignedOutResponse>('POST', '/api/v1/auth/logout');
    expect(signedOut.status).toBe(200);
    expect(signedOut.setCookie).toContain('Max-Age=0');

    const fresh = new ApiClient('203.0.113.30');
    const loggedIn = await login(fresh, OWNER.toUpperCase(), password);
    expect(loggedIn.status).toBe(200);
    const cookie = loggedIn.setCookie ?? '';
    expect(cookie).toContain('__Host-kanban_session=');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=1209600');
    expect(cookie).not.toContain('Domain=');

    // A page reload refetches the session-bound CSRF token.
    const reloaded = await fresh.call<AuthenticatedResponse>('GET', '/api/v1/auth/session');
    expect(reloaded.data?.csrfToken).toBe(loggedIn.data!.csrfToken);

    const revokedCookie = fresh.cookie;
    await fresh.call('POST', '/api/v1/auth/logout');
    const afterLogout = await fresh.call('GET', '/api/v1/auth/session', { cookie: revokedCookie });
    expect(afterLogout.status).toBe(401);
  });
});

describe('seats and membership', () => {
  it('supports an owner plus six members, refuses an eighth, and frees a seat on deactivation', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, ...MEMBERS]);

    const clients: ApiClient[] = [];
    const memberIds: string[] = [];
    for (const [index, email] of MEMBERS.entries()) {
      const invitation = await issueInvitation(owner, email);
      const client = new ApiClient(`203.0.113.${50 + index}`);
      const registered = await registerMember(client, invitation.inviteCode, email);
      clients.push(client);
      memberIds.push(registered.user.id);
    }

    const members = await owner.call<MemberListResponse>('GET', '/api/v1/members');
    expect(members.data?.members).toHaveLength(7);
    expect(members.data?.members.filter(member => member.status === 'active')).toHaveLength(7);

    // An eighth address cannot even be invited while the list is full, and adding it would
    // exceed the seven-address cap.
    const eighth = 'member7@example.test';
    const overfullList = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
      body: { emails: [OWNER, ...MEMBERS, eighth], allowlistRevision: 2 }
    });
    expect(overfullList.status).toBe(400);

    // Deactivating one member frees exactly one seat.
    const deactivated = await owner.call<MemberResponse>('PATCH', `/api/v1/members/${memberIds[0]}`, {
      body: { status: 'inactive' }
    });
    expect(deactivated.data?.member.status).toBe('inactive');
    const afterDeactivation = await owner.call<MemberListResponse>('GET', '/api/v1/members');
    expect(afterDeactivation.data?.members.filter(member => member.status === 'active')).toHaveLength(6);

    // That member's sessions are gone immediately.
    expect((await clients[0]!.call('GET', '/api/v1/auth/session')).status).toBe(401);
    expect((await login(new ApiClient('203.0.113.90'), MEMBERS[0]!, testPassword('member1'))).status).toBe(401);
  }, 120_000);

  it('refuses to deactivate the owner', async () => {
    const owner = new ApiClient();
    const session = await bootstrapOwner(owner, OWNER);
    const refused = await owner.call('PATCH', `/api/v1/members/${session.user.id}`, { body: { status: 'inactive' } });
    expect(refused.status).toBe(403);
    expect(refused.error?.code).toBe('cannot_deactivate_owner');
  });
});

describe('allowed-list removal', () => {
  it('ends access immediately, keeps the seat, and restores login when re-added', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!, MEMBERS[1]!]);

    const invitation = await issueInvitation(owner, MEMBERS[0]!);
    const member = new ApiClient('203.0.113.60');
    const password = testPassword('member1');
    await registerMember(member, invitation.inviteCode, MEMBERS[0]!, password);
    // A second device for the same account.
    const otherDevice = new ApiClient('203.0.113.61');
    expect((await login(otherDevice, MEMBERS[0]!, password)).status).toBe(200);

    // A pending invitation and an in-flight registration for the other address.
    const pendingInvitation = await issueInvitation(owner, MEMBERS[1]!);
    const invitee = new ApiClient('203.0.113.62');
    const pending = await invitee.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode: pendingInvitation.inviteCode, email: MEMBERS[1], password: testPassword('member2') }
    });
    expect(pending.status).toBe(201);

    await setAllowedEmails(owner, [OWNER]);

    // Both devices lose access at once.
    expect((await member.call('GET', '/api/v1/auth/session')).status).toBe(401);
    expect((await otherDevice.call('GET', '/api/v1/auth/session')).status).toBe(401);
    expect((await login(new ApiClient('203.0.113.63'), MEMBERS[0]!, password)).status).toBe(401);

    // The pending registration and its invitation were revoked together.
    const confirmRevoked = await invitee.call('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: pending.data!.pendingToken, recoveryPhrase: pending.data!.recoveryPhrase }
    });
    expect(confirmRevoked.status).toBe(403);
    const invitations = await owner.call<InvitationListResponse>('GET', '/api/v1/invitations');
    expect(invitations.data?.invitations.find(row => row.id === pendingInvitation.id)?.status).toBe('revoked');

    // The removed member still occupies a seat: the account row survives.
    const members = await owner.call<MemberListResponse>('GET', '/api/v1/members');
    expect(members.data?.members.find(row => row.email === MEMBERS[0])?.status).toBe('active');

    // Re-adding the address restores login for the still-active account.
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!]);
    const restored = new ApiClient('203.0.113.64');
    expect((await login(restored, MEMBERS[0]!, password)).status).toBe(200);
  }, 120_000);

  it('refuses to invite an address that is not on the list', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    const refused = await owner.call<CreatedInvitationResponse>('POST', '/api/v1/invitations', {
      body: { email: MEMBERS[0] }
    });
    expect(refused.status).toBe(409);
    expect(refused.error?.code).toBe('email_not_allowed');
  });
});

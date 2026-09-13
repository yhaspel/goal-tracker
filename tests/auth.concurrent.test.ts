import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AllowedEmailsResponse,
  AuthenticatedResponse,
  InvitationListResponse,
  MemberListResponse,
  PreparedRegistrationResponse
} from '../shared/api';
import {
  ApiClient,
  bootstrapOwner,
  bootstrapSecret,
  issueInvitation,
  registerMember,
  setAllowedEmails,
  testPassword
} from './helpers/auth-client';

const OWNER = 'owner@example.test';
const MEMBERS = [1, 2, 3, 4, 5, 6, 7].map(index => `member${index}@example.test`);

beforeEach(async () => {
  await reset();
});

/** Prepares an invited registration without confirming it. */
async function prepareRegistration(
  client: ApiClient,
  inviteCode: string,
  email: string
): Promise<PreparedRegistrationResponse> {
  const prepared = await client.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
    body: { inviteCode, email, password: testPassword(email.split('@')[0] ?? 'member') }
  });
  if (!prepared.data) throw new Error(`prepare failed: ${prepared.status} ${prepared.error?.code}`);
  return prepared.data;
}

describe('concurrent bootstrap', () => {
  it('creates one owner when two confirmations race the same pending token', async () => {
    const guest = new ApiClient();
    const prepared = await guest.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/bootstrap/prepare', {
      body: { bootstrapSecret: bootstrapSecret(), email: OWNER, password: testPassword('owner') }
    });
    const confirm = () =>
      new ApiClient('203.0.113.71').call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
        body: { pendingToken: prepared.data!.pendingToken, recoveryPhrase: prepared.data!.recoveryPhrase }
      });

    const [first, second] = await Promise.all([confirm(), confirm()]);
    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    const winner = first.status === 201 ? first : second;
    const owner = new ApiClient('203.0.113.72');
    owner.cookie = /(__Host-kanban_session=[^;]*)/.exec(winner.setCookie ?? '')?.[1] ?? null;
    owner.csrfToken = winner.data!.csrfToken;
    const members = await owner.call<MemberListResponse>('GET', '/api/v1/members');
    expect(members.data?.members.filter(member => member.role === 'owner')).toHaveLength(1);
    expect(members.data?.members).toHaveLength(1);
  });
});

describe('concurrent registration preparation', () => {
  it('leaves exactly one pending token valid after two simultaneous prepares', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!]);
    const invitation = await issueInvitation(owner, MEMBERS[0]!);

    const prepare = (ip: string) =>
      new ApiClient(ip).call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
        body: { inviteCode: invitation.inviteCode, email: MEMBERS[0], password: testPassword(ip) }
      });

    const [a, b] = await Promise.all([prepare('203.0.113.81'), prepare('203.0.113.82')]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const confirm = (prepared: PreparedRegistrationResponse) =>
      new ApiClient('203.0.113.83').call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
        body: { pendingToken: prepared.pendingToken, recoveryPhrase: prepared.recoveryPhrase }
      });

    // The two prepares committed in some order; only the later one survives.
    const results = [await confirm(a.data!), await confirm(b.data!)];
    expect(results.filter(result => result.status === 201)).toHaveLength(1);
    expect(results.filter(result => result.error?.code === 'invalid_pending_token')).toHaveLength(1);
  });
});

describe('seat exhaustion', () => {
  it('admits only one of two simultaneous confirmations for the final seat', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, ...MEMBERS.slice(0, 6)]);

    // Owner plus five members: six active accounts, one free seat.
    for (const [index, email] of MEMBERS.slice(0, 5).entries()) {
      const invitation = await issueInvitation(owner, email);
      await registerMember(new ApiClient(`203.0.113.${100 + index}`), invitation.inviteCode, email);
    }

    // Removing member1's address frees no seat, so two unregistered addresses now compete
    // for the single remaining one.
    await setAllowedEmails(owner, [OWNER, ...MEMBERS.slice(1, 7)]);

    const sixth = await issueInvitation(owner, MEMBERS[5]!);
    const seventh = await issueInvitation(owner, MEMBERS[6]!);
    const sixthClient = new ApiClient('203.0.113.120');
    const seventhClient = new ApiClient('203.0.113.121');
    const sixthPending = await prepareRegistration(sixthClient, sixth.inviteCode, MEMBERS[5]!);
    const seventhPending = await prepareRegistration(seventhClient, seventh.inviteCode, MEMBERS[6]!);

    const confirm = (client: ApiClient, prepared: PreparedRegistrationResponse) =>
      client.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
        body: { pendingToken: prepared.pendingToken, recoveryPhrase: prepared.recoveryPhrase }
      });

    const results = await Promise.all([
      confirm(sixthClient, sixthPending),
      confirm(seventhClient, seventhPending)
    ]);
    expect(results.filter(result => result.status === 201)).toHaveLength(1);
    const loser = results.find(result => result.status !== 201)!;
    expect(loser.status).toBe(409);
    expect(loser.error?.code).toBe('seats_full');

    const members = await owner.call<MemberListResponse>('GET', '/api/v1/members');
    expect(members.data?.members.filter(member => member.status === 'active')).toHaveLength(7);

    // The losing invitation was not consumed, so it stays usable until its own expiry.
    const invitations = await owner.call<InvitationListResponse>('GET', '/api/v1/invitations');
    const consumed = invitations.data!.invitations.filter(row => row.status === 'consumed');
    const stillPending = invitations.data!.invitations.filter(row => row.status === 'pending');
    expect(consumed).toHaveLength(6);
    expect(stillPending).toHaveLength(1);
  }, 180_000);
});

describe('concurrent allowed-list edits', () => {
  it('accepts one of two replacements sharing a revision and rejects the other', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    const current = await owner.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails');
    const revision = current.data!.allowlistRevision;

    const replace = (emails: string[]) =>
      owner.call<AllowedEmailsResponse>('PUT', '/api/v1/settings/allowed-emails', {
        body: { emails, allowlistRevision: revision }
      });

    const results = await Promise.all([
      replace([OWNER, MEMBERS[0]!]),
      replace([OWNER, MEMBERS[1]!])
    ]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    const rejected = results.find(result => result.status !== 200)!;
    expect(rejected.status).toBe(409);
    expect(rejected.error?.code).toBe('allowlist_conflict');
    expect(rejected.error?.details).toEqual({ allowlistRevision: revision + 1 });

    const after = await owner.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails');
    expect(after.data?.emails).toHaveLength(2);
    expect(after.data?.allowlistRevision).toBe(revision + 1);
  });

  it('refuses a confirmation whose email was removed while the registration was pending', async () => {
    const owner = new ApiClient();
    await bootstrapOwner(owner, OWNER);
    await setAllowedEmails(owner, [OWNER, MEMBERS[0]!]);
    const invitation = await issueInvitation(owner, MEMBERS[0]!);
    const invitee = new ApiClient('203.0.113.130');
    const pending = await prepareRegistration(invitee, invitation.inviteCode, MEMBERS[0]!);

    await setAllowedEmails(owner, [OWNER]);

    const confirmed = await invitee.call('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: pending.pendingToken, recoveryPhrase: pending.recoveryPhrase }
    });
    expect(confirmed.status).toBe(403);
    const members = await owner.call<MemberListResponse>('GET', '/api/v1/members');
    expect(members.data?.members).toHaveLength(1);
  });
});

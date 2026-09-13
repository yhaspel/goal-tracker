import type { AllowedEmailsResponse, AuthenticatedResponse, PreparedRegistrationResponse } from '../../shared/api';
import { ApiClient, bootstrapSecret, issueInvitation, testPassword } from './auth-client';

/** A disposable account plus the phrase its registration showed exactly once. */
export type Account = {
  client: ApiClient;
  id: string;
  email: string;
  password: string;
  phrase: string;
};

let nextIp = 1;
function freshIp(): string {
  nextIp += 1;
  return `203.0.113.${nextIp % 250}`;
}

function expectData<T>(result: { data?: T; status: number; error?: { code: string } }, what: string): T {
  if (!result.data) throw new Error(`${what} failed: ${result.status} ${result.error?.code ?? 'no code'}`);
  return result.data;
}

/**
 * Runs owner bootstrap and keeps the recovery phrase. Tests need the phrase because the API
 * shows it once and never again, which is the behaviour under test everywhere else.
 */
export async function createOwner(email = 'owner@example.test', password = testPassword('owner')): Promise<Account> {
  const client = new ApiClient(freshIp());
  const prepared = expectData(
    await client.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/bootstrap/prepare', {
      body: { bootstrapSecret: bootstrapSecret(), email, password }
    }),
    'bootstrap prepare'
  );
  const session = client.adopt(
    await client.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: prepared.pendingToken, recoveryPhrase: prepared.recoveryPhrase }
    })
  );
  return { client, id: session.user.id, email, password, phrase: prepared.recoveryPhrase };
}

/** Appends the address to the allowed list, invites it, and completes registration. */
export async function addMember(owner: Account, email: string, password = testPassword(email)): Promise<Account> {
  const current = expectData(
    await owner.client.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails'),
    'read allowed emails'
  );
  if (!current.emails.includes(email)) {
    expectData(
      await owner.client.call<AllowedEmailsResponse>('PUT', '/api/v1/settings/allowed-emails', {
        body: { emails: [...current.emails, email], allowlistRevision: current.allowlistRevision }
      }),
      'extend allowed emails'
    );
  }

  const invitation = await issueInvitation(owner.client, email);
  const client = new ApiClient(freshIp());
  const prepared = expectData(
    await client.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode: invitation.inviteCode, email, password }
    }),
    'registration prepare'
  );
  const session = client.adopt(
    await client.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: prepared.pendingToken, recoveryPhrase: prepared.recoveryPhrase }
    })
  );
  return { client, id: session.user.id, email, password, phrase: prepared.recoveryPhrase };
}

export async function setAllowed(owner: Account, emails: string[]): Promise<AllowedEmailsResponse> {
  const current = expectData(
    await owner.client.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails'),
    'read allowed emails'
  );
  return expectData(
    await owner.client.call<AllowedEmailsResponse>('PUT', '/api/v1/settings/allowed-emails', {
      body: { emails, allowlistRevision: current.allowlistRevision }
    }),
    'replace allowed emails'
  );
}

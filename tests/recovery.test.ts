import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AuthenticatedResponse,
  CredentialRotationConfirmResponse,
  CredentialRotationStartResponse,
  PreparedRegistrationResponse
} from '../shared/api';
import {
  ApiClient,
  bootstrapSecret,
  issueInvitation,
  login,
  setAllowedEmails,
  testPassword
} from './helpers/auth-client';
import {
  countOperatorTokens,
  countPendingRotations,
  credentialEpoch,
  expirePendingRotations,
  insertOperatorToken
} from './helpers/durable';

const OWNER = 'owner@example.test';
const MEMBER = 'member1@example.test';

beforeEach(async () => {
  await reset();
});

type Account = {
  client: ApiClient;
  id: string;
  email: string;
  password: string;
  /** The phrase shown once during registration. */
  phrase: string;
};

/** Bootstraps the owner and keeps the phrase the prepare response showed exactly once. */
async function createOwner(password = testPassword('owner')): Promise<Account> {
  const client = new ApiClient('203.0.113.10');
  const prepared = await client.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/bootstrap/prepare', {
    body: { bootstrapSecret: bootstrapSecret(), email: OWNER, password }
  });
  const confirmed = await client.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
    body: { pendingToken: prepared.data!.pendingToken, recoveryPhrase: prepared.data!.recoveryPhrase }
  });
  const session = client.adopt(confirmed);
  return { client, id: session.user.id, email: OWNER, password, phrase: prepared.data!.recoveryPhrase };
}

async function createMember(owner: ApiClient, email = MEMBER, password = testPassword('member')): Promise<Account> {
  await setAllowedEmails(owner, [OWNER, email]);
  const invitation = await issueInvitation(owner, email);
  const client = new ApiClient('203.0.113.20');
  const prepared = await client.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
    body: { inviteCode: invitation.inviteCode, email, password }
  });
  const confirmed = await client.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
    body: { pendingToken: prepared.data!.pendingToken, recoveryPhrase: prepared.data!.recoveryPhrase }
  });
  const session = client.adopt(confirmed);
  return { client, id: session.user.id, email, password, phrase: prepared.data!.recoveryPhrase };
}

const start = (client: ApiClient, path: string, body: unknown) =>
  client.call<CredentialRotationStartResponse>('POST', path, { body });

const confirm = (client: ApiClient, path: string, challengeToken: string, newRecoveryPhrase: string) =>
  client.call<CredentialRotationConfirmResponse>('POST', path, { body: { challengeToken, newRecoveryPhrase } });

describe('saved-phrase recovery', () => {
  it('rotates the password and phrase, then requires a fresh sign-in', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const newPassword = testPassword('rotated');

    const started = await start(new ApiClient('203.0.113.30'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword
    });
    expect(started.status).toBe(201);
    expect(started.data?.recoveryPhrase.split(' ')).toHaveLength(12);
    expect(started.data?.recoveryPhrase).not.toBe(member.phrase);

    // Nothing has changed yet: the original session and password still work.
    expect((await member.client.call('GET', '/api/v1/auth/session')).status).toBe(200);

    const guest = new ApiClient('203.0.113.31');
    const rotated = await confirm(
      guest,
      '/api/v1/recovery/phrase/confirm',
      started.data!.challengeToken,
      started.data!.recoveryPhrase
    );
    expect(rotated.status).toBe(200);
    expect(rotated.data).toEqual({ rotated: true });
    // Confirmation issues no session of its own.
    expect(rotated.setCookie).toContain('Max-Age=0');

    expect((await member.client.call('GET', '/api/v1/auth/session')).status).toBe(401);
    expect((await login(new ApiClient('203.0.113.32'), member.email, member.password)).status).toBe(401);
    expect((await login(new ApiClient('203.0.113.33'), member.email, newPassword)).status).toBe(200);

    // The old phrase and the used challenge are both dead.
    const replayPhrase = await start(new ApiClient('203.0.113.34'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword: testPassword('again')
    });
    expect(replayPhrase.status).toBe(403);
    const replayChallenge = await confirm(
      new ApiClient('203.0.113.35'),
      '/api/v1/recovery/phrase/confirm',
      started.data!.challengeToken,
      started.data!.recoveryPhrase
    );
    expect(replayChallenge.status).toBe(403);

    expect(await credentialEpoch(member.id)).toBe(2);
    expect(await countPendingRotations(member.id)).toBe(0);
  }, 60_000);

  it('refuses to reuse the current password', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const refused = await start(new ApiClient('203.0.113.40'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword: member.password
    });
    expect(refused.status).toBe(400);
    expect(refused.error?.details).toEqual({ fieldErrors: { newPassword: 'reused' } });
  }, 60_000);

  it('leaves the old credentials intact when the flow is abandoned or mistyped', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const newPassword = testPassword('never-applied');

    const started = await start(new ApiClient('203.0.113.41'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword
    });

    const wrong = await confirm(
      new ApiClient('203.0.113.42'),
      '/api/v1/recovery/phrase/confirm',
      started.data!.challengeToken,
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
    );
    expect(wrong.status).toBe(403);
    expect(wrong.error?.code).toBe('invalid_phrase');

    // An expired challenge behaves the same as an abandoned tab.
    await expirePendingRotations(member.id);
    const expired = await confirm(
      new ApiClient('203.0.113.43'),
      '/api/v1/recovery/phrase/confirm',
      started.data!.challengeToken,
      started.data!.recoveryPhrase
    );
    expect(expired.status).toBe(403);
    expect(expired.error?.code).toBe('invalid_challenge');

    expect((await login(new ApiClient('203.0.113.44'), member.email, member.password)).status).toBe(200);
    expect((await login(new ApiClient('203.0.113.45'), member.email, newPassword)).status).toBe(401);
    expect((await member.client.call('GET', '/api/v1/auth/session')).status).toBe(200);
    expect(await credentialEpoch(member.id)).toBe(1);
  }, 60_000);
});

describe('signed-in credential change', () => {
  it('changes the password and phrase and ends every session', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const otherDevice = new ApiClient('203.0.113.50');
    expect((await login(otherDevice, member.email, member.password)).status).toBe(200);
    const newPassword = testPassword('changed');

    const started = await start(member.client, '/api/v1/account/credentials/start', {
      currentPassword: member.password,
      newPassword
    });
    expect(started.status).toBe(201);

    // Still unchanged until confirmation.
    expect((await otherDevice.call('GET', '/api/v1/auth/session')).status).toBe(200);

    const rotated = await confirm(
      member.client,
      '/api/v1/account/credentials/confirm',
      started.data!.challengeToken,
      started.data!.recoveryPhrase
    );
    expect(rotated.status).toBe(200);

    expect((await otherDevice.call('GET', '/api/v1/auth/session')).status).toBe(401);
    expect((await login(new ApiClient('203.0.113.51'), member.email, member.password)).status).toBe(401);
    expect((await login(new ApiClient('203.0.113.52'), member.email, newPassword)).status).toBe(200);
  }, 60_000);

  it('regenerates the phrase only, leaving the password valid', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);

    const started = await start(member.client, '/api/v1/account/credentials/start', {
      currentPassword: member.password
    });
    expect(started.status).toBe(201);
    const newPhrase = started.data!.recoveryPhrase;

    const rotated = await confirm(
      member.client,
      '/api/v1/account/credentials/confirm',
      started.data!.challengeToken,
      newPhrase
    );
    expect(rotated.status).toBe(200);

    // The password survives, but every session still ended.
    const again = new ApiClient('203.0.113.53');
    expect((await login(again, member.email, member.password)).status).toBe(200);

    // The new phrase is the one that now works for recovery; the old one does not.
    const oldPhrase = await start(new ApiClient('203.0.113.54'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword: testPassword('via-old')
    });
    expect(oldPhrase.status).toBe(403);
    const viaNewPhrase = await start(new ApiClient('203.0.113.55'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: newPhrase,
      newPassword: testPassword('via-new')
    });
    expect(viaNewPhrase.status).toBe(201);
  }, 60_000);

  it('requires the current password, a live session, and CSRF', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);

    const wrongPassword = await start(member.client, '/api/v1/account/credentials/start', {
      currentPassword: testPassword('not-mine'),
      newPassword: testPassword('attempt')
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.error?.code).toBe('invalid_credentials');

    const anonymous = await new ApiClient('203.0.113.56').call('POST', '/api/v1/account/credentials/start', {
      body: { currentPassword: member.password }
    });
    expect(anonymous.status).toBe(401);

    const noCsrf = await member.client.call('POST', '/api/v1/account/credentials/start', {
      body: { currentPassword: member.password },
      csrf: null
    });
    expect(noCsrf.status).toBe(403);

    const foreignOrigin = await member.client.call('POST', '/api/v1/account/credentials/start', {
      body: { currentPassword: member.password },
      origin: 'https://evil.example'
    });
    expect(foreignOrigin.status).toBe(403);
  }, 60_000);
});

describe('operator rescue', () => {
  it('redeems a correctly inserted token exactly once', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const token = await insertOperatorToken(member.id);
    const newPassword = testPassword('rescued');

    const guest = new ApiClient('203.0.113.60');
    const started = await start(guest, '/api/v1/recovery/operator/start', {
      email: member.email,
      resetToken: token,
      newPassword
    });
    expect(started.status).toBe(201);

    const rotated = await confirm(
      guest,
      '/api/v1/recovery/operator/confirm',
      started.data!.challengeToken,
      started.data!.recoveryPhrase
    );
    expect(rotated.status).toBe(200);
    expect((await login(new ApiClient('203.0.113.61'), member.email, newPassword)).status).toBe(200);

    // The token is consumed and cannot start a second rescue.
    const reuse = await start(new ApiClient('203.0.113.62'), '/api/v1/recovery/operator/start', {
      email: member.email,
      resetToken: token,
      newPassword: testPassword('second-try')
    });
    expect(reuse.status).toBe(403);
  }, 60_000);

  it('refuses wrong, expired, consumed, and wrong-user tokens', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const newPassword = testPassword('attempted');

    const cases: Array<[string, string]> = [
      ['unknown token', 'not-a-real-token-value-at-all'],
      ['expired token', await insertOperatorToken(member.id, { expiresInMs: -1000 })],
      ['already consumed token', await insertOperatorToken(member.id, { consumed: true })],
      ['token pinned to a stale epoch', await insertOperatorToken(member.id, { epoch: 99 })],
      ['token issued for the owner', await insertOperatorToken(owner.id)]
    ];

    for (const [label, token] of cases) {
      const refused = await start(new ApiClient('203.0.113.63'), '/api/v1/recovery/operator/start', {
        email: member.email,
        resetToken: token,
        newPassword
      });
      expect(refused.status, label).toBe(403);
      expect(refused.error?.code, label).toBe('recovery_failed');
    }
    expect((await login(new ApiClient('203.0.113.64'), member.email, member.password)).status).toBe(200);
  }, 120_000);

  it('commits only one of two concurrent confirmations of the same token', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const token = await insertOperatorToken(member.id);

    const started = await start(new ApiClient('203.0.113.65'), '/api/v1/recovery/operator/start', {
      email: member.email,
      resetToken: token,
      newPassword: testPassword('one-winner')
    });

    const attempt = () =>
      confirm(
        new ApiClient('203.0.113.66'),
        '/api/v1/recovery/operator/confirm',
        started.data!.challengeToken,
        started.data!.recoveryPhrase
      );
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => result.status !== 200)).toHaveLength(1);
    expect(await credentialEpoch(member.id)).toBe(2);
  }, 60_000);
});

describe('rotation and membership interaction', () => {
  it('revokes a pending rotation and unused operator tokens when the email is removed', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    // Inserted only so removal can be shown to revoke it; the token itself is never redeemed.
    await insertOperatorToken(member.id);

    const started = await start(new ApiClient('203.0.113.70'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword: testPassword('doomed')
    });
    expect(started.status).toBe(201);
    expect(await countPendingRotations(member.id)).toBe(1);
    expect(await countOperatorTokens(member.id)).toBe(1);

    await setAllowedEmails(owner.client, [OWNER]);

    expect(await countPendingRotations(member.id)).toBe(0);
    expect(await countOperatorTokens(member.id)).toBe(0);

    const orphaned = await confirm(
      new ApiClient('203.0.113.71'),
      '/api/v1/recovery/phrase/confirm',
      started.data!.challengeToken,
      started.data!.recoveryPhrase
    );
    expect(orphaned.status).toBe(403);

    // No recovery can start while the address is off the list, and the refusal is generic.
    const blocked = await start(new ApiClient('203.0.113.72'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword: testPassword('still-blocked')
    });
    expect(blocked.status).toBe(403);
    expect(blocked.error?.code).toBe('recovery_failed');

    // Re-adding the address does not revive the old challenge or token.
    await setAllowedEmails(owner.client, [OWNER, member.email]);
    expect(await countOperatorTokens(member.id)).toBe(0);
    const afterReadd = await confirm(
      new ApiClient('203.0.113.73'),
      '/api/v1/recovery/phrase/confirm',
      started.data!.challengeToken,
      started.data!.recoveryPhrase
    );
    expect(afterReadd.status).toBe(403);
  }, 60_000);

  it('lets only the first of two competing rotations commit', async () => {
    const owner = await createOwner();
    const member = await createMember(owner.client);
    const token = await insertOperatorToken(member.id);

    const viaPhrase = await start(new ApiClient('203.0.113.80'), '/api/v1/recovery/phrase/start', {
      email: member.email,
      recoveryPhrase: member.phrase,
      newPassword: testPassword('by-phrase')
    });
    const viaOperator = await start(new ApiClient('203.0.113.81'), '/api/v1/recovery/operator/start', {
      email: member.email,
      resetToken: token,
      newPassword: testPassword('by-operator')
    });
    // Both challenges exist while the credential epoch is unchanged.
    expect(viaPhrase.status).toBe(201);
    expect(viaOperator.status).toBe(201);
    expect(await countPendingRotations(member.id)).toBe(2);

    const first = await confirm(
      new ApiClient('203.0.113.82'),
      '/api/v1/recovery/phrase/confirm',
      viaPhrase.data!.challengeToken,
      viaPhrase.data!.recoveryPhrase
    );
    expect(first.status).toBe(200);

    const second = await confirm(
      new ApiClient('203.0.113.83'),
      '/api/v1/recovery/operator/confirm',
      viaOperator.data!.challengeToken,
      viaOperator.data!.recoveryPhrase
    );
    expect(second.status).toBe(403);

    expect((await login(new ApiClient('203.0.113.84'), member.email, testPassword('by-phrase'))).status).toBe(200);
    expect((await login(new ApiClient('203.0.113.85'), member.email, testPassword('by-operator'))).status).toBe(401);
    expect(await credentialEpoch(member.id)).toBe(2);
  }, 60_000);
});

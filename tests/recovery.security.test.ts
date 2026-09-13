import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthenticatedResponse,
  CredentialRotationStartResponse,
  PreparedRegistrationResponse
} from '../shared/api';
import {
  ApiClient,
  bootstrapSecret,
  issueInvitation,
  setAllowedEmails,
  testPassword
} from './helpers/auth-client';
import { inHousehold, insertOperatorToken } from './helpers/durable';

const OWNER = 'owner@example.test';
const MEMBER = 'member1@example.test';

beforeEach(async () => {
  await reset();
});

type Account = { client: ApiClient; id: string; email: string; password: string; phrase: string };

async function household(): Promise<{ owner: Account; member: Account }> {
  const ownerClient = new ApiClient('203.0.113.10');
  const ownerPassword = testPassword('owner');
  const ownerPrepared = await ownerClient.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/bootstrap/prepare', {
    body: { bootstrapSecret: bootstrapSecret(), email: OWNER, password: ownerPassword }
  });
  const ownerSession = ownerClient.adopt(
    await ownerClient.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: ownerPrepared.data!.pendingToken, recoveryPhrase: ownerPrepared.data!.recoveryPhrase }
    })
  );

  await setAllowedEmails(ownerClient, [OWNER, MEMBER]);
  const invitation = await issueInvitation(ownerClient, MEMBER);
  const memberClient = new ApiClient('203.0.113.20');
  const memberPassword = testPassword('member');
  const memberPrepared = await memberClient.call<PreparedRegistrationResponse>(
    'POST',
    '/api/v1/auth/registration/prepare',
    { body: { inviteCode: invitation.inviteCode, email: MEMBER, password: memberPassword } }
  );
  const memberSession = memberClient.adopt(
    await memberClient.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: memberPrepared.data!.pendingToken, recoveryPhrase: memberPrepared.data!.recoveryPhrase }
    })
  );

  return {
    owner: {
      client: ownerClient,
      id: ownerSession.user.id,
      email: OWNER,
      password: ownerPassword,
      phrase: ownerPrepared.data!.recoveryPhrase
    },
    member: {
      client: memberClient,
      id: memberSession.user.id,
      email: MEMBER,
      password: memberPassword,
      phrase: memberPrepared.data!.recoveryPhrase
    }
  };
}

const PRE_AUTH_ROUTES = [
  '/api/v1/recovery/phrase/start',
  '/api/v1/recovery/phrase/confirm',
  '/api/v1/recovery/operator/start',
  '/api/v1/recovery/operator/confirm'
];

describe('recovery request guards', () => {
  it('rejects a live session on every pre-auth recovery route', async () => {
    const { member } = await household();
    for (const path of PRE_AUTH_ROUTES) {
      const refused = await member.client.call('POST', path, { body: { email: member.email } });
      expect(refused.status, path).toBe(403);
      expect(refused.error?.code, path).toBe('already_authenticated');
    }
  }, 60_000);

  it('rejects a missing or foreign Origin', async () => {
    const { member } = await household();
    for (const origin of [null, 'https://evil.example']) {
      const refused = await new ApiClient('203.0.113.30').call('POST', '/api/v1/recovery/phrase/start', {
        body: { email: member.email, recoveryPhrase: member.phrase, newPassword: testPassword('origin') },
        origin
      });
      expect(refused.status).toBe(403);
      expect(refused.error?.code).toBe('forbidden');
    }
  }, 60_000);

  it('rejects weak passwords and unexpected fields before touching the account', async () => {
    const { member } = await household();
    const guest = new ApiClient('203.0.113.31');

    const short = await guest.call('POST', '/api/v1/recovery/phrase/start', {
      body: { email: member.email, recoveryPhrase: member.phrase, newPassword: 'short' }
    });
    expect(short.status).toBe(400);
    expect(short.error?.details).toEqual({ fieldErrors: { password: 'too_short' } });

    const extra = await guest.call('POST', '/api/v1/recovery/phrase/start', {
      body: {
        email: member.email,
        recoveryPhrase: member.phrase,
        newPassword: testPassword('fields'),
        userId: member.id
      }
    });
    expect(extra.status).toBe(400);
    expect(extra.error?.code).toBe('invalid_request');

    const oversized = await guest.call('POST', '/api/v1/recovery/phrase/start', {
      body: { email: member.email, recoveryPhrase: 'x'.repeat(17 * 1024), newPassword: testPassword('big') }
    });
    expect(oversized.status).toBe(413);
  }, 60_000);

  it('answers identically for an unknown, removed, and deactivated address', async () => {
    const { owner, member } = await household();
    const password = testPassword('probe');

    const unknown = await new ApiClient('203.0.113.32').call('POST', '/api/v1/recovery/phrase/start', {
      body: { email: 'ghost@example.test', recoveryPhrase: member.phrase, newPassword: password }
    });
    const wrongPhrase = await new ApiClient('203.0.113.33').call('POST', '/api/v1/recovery/phrase/start', {
      body: { email: member.email, recoveryPhrase: 'not the right words at all here ok', newPassword: password }
    });
    await setAllowedEmails(owner.client, [OWNER]);
    const removed = await new ApiClient('203.0.113.34').call('POST', '/api/v1/recovery/phrase/start', {
      body: { email: member.email, recoveryPhrase: member.phrase, newPassword: password }
    });

    expect(unknown.status).toBe(403);
    expect(unknown.error).toEqual(wrongPhrase.error);
    expect(unknown.error).toEqual(removed.error);
  }, 60_000);

  it('bounds outstanding challenges per account', async () => {
    const { member } = await household();
    const guest = new ApiClient('203.0.113.35');
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = await guest.call<CredentialRotationStartResponse>('POST', '/api/v1/recovery/phrase/start', {
        body: { email: member.email, recoveryPhrase: member.phrase, newPassword: testPassword(`bound-${attempt}`) }
      });
      expect(started.status).toBe(201);
    }
    const fourth = await guest.call('POST', '/api/v1/recovery/phrase/start', {
      body: { email: member.email, recoveryPhrase: member.phrase, newPassword: testPassword('bound-3') }
    });
    expect(fourth.status).toBe(409);
    expect(fourth.error?.code).toBe('too_many_rotations');
  }, 120_000);

  it('rate-limits recovery starts per account before the derivation runs', async () => {
    const { member } = await household();
    // The per-account budget is five in fifteen minutes and is charged on every attempt,
    // including refused ones, so a wrong phrase cannot buy unlimited derivations.
    for (let attempt = 0; attempt < 5; attempt++) {
      const refused = await new ApiClient(`203.0.113.${40 + attempt}`).call('POST', '/api/v1/recovery/phrase/start', {
        body: { email: member.email, recoveryPhrase: 'wrong words here for this attempt', newPassword: testPassword('rl') }
      });
      expect(refused.status).toBe(403);
    }
    const limited = await new ApiClient('203.0.113.46').call('POST', '/api/v1/recovery/phrase/start', {
      body: { email: member.email, recoveryPhrase: member.phrase, newPassword: testPassword('rl-final') }
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  }, 120_000);
});

describe('recovery disclosure', () => {
  it('stores only digests and logs no credential material', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { member } = await household();
      const operatorToken = await insertOperatorToken(member.id);
      const newPassword = testPassword('disclosure');

      const started = await new ApiClient('203.0.113.50').call<CredentialRotationStartResponse>(
        'POST',
        '/api/v1/recovery/phrase/start',
        { body: { email: member.email, recoveryPhrase: member.phrase, newPassword } }
      );
      expect(started.status).toBe(201);

      const secrets = [
        newPassword,
        member.password,
        member.phrase,
        started.data!.recoveryPhrase,
        started.data!.challengeToken,
        operatorToken
      ];

      const rows = await inHousehold(sql => {
        const dump: string[] = [];
        for (const table of ['pending_credential_rotations', 'operator_reset_tokens', 'recovery_credentials', 'users']) {
          for (const row of sql.exec(`SELECT * FROM ${table}`)) dump.push(JSON.stringify(row));
        }
        return dump.join('\n');
      });
      for (const secret of secrets) expect(rows).not.toContain(secret);

      const emitted = logged.mock.calls.map(call => String(call[0])).join('\n');
      for (const secret of [...secrets, member.email]) expect(emitted).not.toContain(secret);
      // The rotation was still recorded as an event.
      expect(emitted).toContain('recovery.phrase.start');
    } finally {
      logged.mockRestore();
    }
  }, 60_000);
});

describe('recovery route surface', () => {
  it('exposes no email-reset path', async () => {
    const guest = new ApiClient('203.0.113.60');
    for (const path of [
      '/api/v1/recovery/email',
      '/api/v1/recovery/email/start',
      '/api/v1/auth/forgot-password',
      '/api/v1/account/credentials'
    ]) {
      const response = await guest.call('POST', path, { body: {} });
      expect(response.status, path).toBe(404);
      expect(response.error?.code, path).toBe('not_found');
    }
  });

  it('answers 405 with Allow for a non-POST recovery call', async () => {
    const guest = new ApiClient('203.0.113.61');
    const response = await guest.call('GET', '/api/v1/recovery/phrase/start');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});

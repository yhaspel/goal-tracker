import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthenticatedResponse, MemberListResponse, PreferencesResponse } from '../shared/api';
import { ApiClient } from './helpers/auth-client';
import { addMember, createOwner } from './helpers/household';

const OWNER = 'owner@example.test';
const MEMBER = 'member1@example.test';

beforeEach(async () => {
  await reset();
});

describe('language preference', () => {
  it('stores the choice and returns it on the next session read', async () => {
    const owner = await createOwner(OWNER);
    expect((await owner.client.call<AuthenticatedResponse>('GET', '/api/v1/auth/session')).data?.user.language).toBe(
      'en'
    );

    const saved = await owner.client.call<PreferencesResponse>('PATCH', '/api/v1/me/preferences', {
      body: { language: 'he' }
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toEqual({ language: 'he' });

    const session = await owner.client.call<AuthenticatedResponse>('GET', '/api/v1/auth/session');
    expect(session.data?.user.language).toBe('he');
  }, 60_000);

  it('survives a sign-out and a fresh sign-in', async () => {
    const owner = await createOwner(OWNER);
    await owner.client.call('PATCH', '/api/v1/me/preferences', { body: { language: 'ru' } });
    await owner.client.call('POST', '/api/v1/auth/logout');

    const fresh = new ApiClient('203.0.113.200');
    const signedIn = await fresh.call<AuthenticatedResponse>('POST', '/api/v1/auth/login', {
      body: { email: OWNER, password: owner.password }
    });
    expect(signedIn.data?.user.language).toBe('ru');
  }, 60_000);

  it('keeps the locale chosen during registration', async () => {
    const owner = await createOwner(OWNER);
    const member = await addMember(owner, MEMBER);
    // `addMember` registers without a language, so the default applies.
    expect((await member.client.call<AuthenticatedResponse>('GET', '/api/v1/auth/session')).data?.user.language).toBe(
      'en'
    );
  }, 60_000);

  it('rejects an unsupported language, a missing session, a bad Origin, and a missing CSRF token', async () => {
    const owner = await createOwner(OWNER);

    const unsupported = await owner.client.call('PATCH', '/api/v1/me/preferences', { body: { language: 'fr' } });
    expect(unsupported.status).toBe(400);
    expect(unsupported.error?.details).toEqual({ fieldErrors: { language: 'unsupported' } });

    const extraField = await owner.client.call('PATCH', '/api/v1/me/preferences', {
      body: { language: 'he', userId: owner.id }
    });
    expect(extraField.status).toBe(400);

    expect(
      (await new ApiClient('203.0.113.201').call('PATCH', '/api/v1/me/preferences', { body: { language: 'he' } }))
        .status
    ).toBe(401);
    expect(
      (await owner.client.call('PATCH', '/api/v1/me/preferences', { body: { language: 'he' }, origin: null })).status
    ).toBe(403);
    expect(
      (await owner.client.call('PATCH', '/api/v1/me/preferences', { body: { language: 'he' }, csrf: null })).status
    ).toBe(403);
    expect((await owner.client.call('GET', '/api/v1/me/preferences')).status).toBe(405);

    // Nothing above changed the stored value.
    expect((await owner.client.call<AuthenticatedResponse>('GET', '/api/v1/auth/session')).data?.user.language).toBe(
      'en'
    );
  }, 60_000);

  it('changes only the calling account', async () => {
    const owner = await createOwner(OWNER);
    const member = await addMember(owner, MEMBER);

    await member.client.call('PATCH', '/api/v1/me/preferences', { body: { language: 'ru' } });

    const roster = await owner.client.call<MemberListResponse>('GET', '/api/v1/members');
    const byEmail = new Map(roster.data!.members.map(row => [row.email, row.language]));
    expect(byEmail.get(MEMBER)).toBe('ru');
    expect(byEmail.get(OWNER)).toBe('en');
  }, 60_000);
});

import { env, SELF } from 'cloudflare:test';
import type {
  AllowedEmailsResponse,
  AuthenticatedResponse,
  CreatedInvitationResponse,
  PreparedRegistrationResponse
} from '../../shared/api';
import { SESSION_COOKIE_NAME } from '../../worker/src/auth/sessions';

export const ORIGIN = 'https://example.com';

export type ApiResult<T> = {
  status: number;
  headers: Headers;
  setCookie: string | null;
  data: T | undefined;
  error: { code: string; message: string; details?: Record<string, unknown> } | undefined;
};

export type CallOptions = {
  body?: unknown;
  /** Defaults to the app origin. `null` omits the header entirely. */
  origin?: string | null;
  /** Defaults to the client's stored token for mutations. `null` omits it. */
  csrf?: string | null;
  /** Defaults to the client's stored cookie. `null` omits it. */
  cookie?: string | null;
  contentType?: string | null;
};

/**
 * A browser-like API caller: it keeps one session cookie and the session-bound CSRF token,
 * and sends `Origin` the way a browser would. Every field can be overridden so a test can
 * forge, omit, or replay a value.
 */
export class ApiClient {
  cookie: string | null = null;
  csrfToken: string | null = null;

  constructor(readonly ip = '203.0.113.10') {}

  async call<T>(method: string, path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
    const headers = new Headers();
    headers.set('CF-Connecting-IP', this.ip);

    const origin = options.origin === undefined ? ORIGIN : options.origin;
    if (origin !== null) headers.set('Origin', origin);

    const cookie = options.cookie === undefined ? this.cookie : options.cookie;
    if (cookie !== null) headers.set('Cookie', cookie);

    const csrf = options.csrf === undefined ? this.csrfToken : options.csrf;
    if (csrf !== null && method !== 'GET') headers.set('X-CSRF-Token', csrf);

    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
      if (contentType !== null) headers.set('Content-Type', contentType);
    }

    const response = await SELF.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body }));
    const setCookie = response.headers.get('set-cookie');
    this.applySetCookie(setCookie);

    const text = await response.text();
    const parsed: unknown = text.length === 0 ? {} : JSON.parse(text);
    const envelope = parsed as { data?: T; error?: ApiResult<T>['error'] };
    return { status: response.status, headers: response.headers, setCookie, data: envelope.data, error: envelope.error };
  }

  private applySetCookie(raw: string | null): void {
    if (!raw) return;
    const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(raw);
    if (!match) return;
    const value = match[1] ?? '';
    this.cookie = value.length === 0 ? null : `${SESSION_COOKIE_NAME}=${value}`;
    if (value.length === 0) this.csrfToken = null;
  }

  adopt(result: ApiResult<AuthenticatedResponse>): AuthenticatedResponse {
    if (!result.data) throw new Error(`expected an authenticated response, got ${result.status} ${result.error?.code}`);
    this.csrfToken = result.data.csrfToken;
    return result.data;
  }
}

/** Passes the 12-code-point minimum and is absent from the pinned common-password list. */
export function testPassword(seed: string): string {
  return `Pw-${seed}-7f3a91c4`;
}

export function bootstrapSecret(): string {
  const secret = env.BOOTSTRAP_SECRET;
  if (!secret) throw new Error('the test environment must bind BOOTSTRAP_SECRET');
  return secret;
}

function expectData<T>(result: ApiResult<T>, what: string): T {
  if (!result.data) {
    throw new Error(`${what} failed: ${result.status} ${result.error?.code ?? 'no code'} ${result.error?.message ?? ''}`);
  }
  return result.data;
}

export async function bootstrapOwner(
  client: ApiClient,
  email: string,
  password = testPassword('owner')
): Promise<AuthenticatedResponse> {
  const prepared = expectData(
    await client.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/bootstrap/prepare', {
      body: { bootstrapSecret: bootstrapSecret(), email, password }
    }),
    'bootstrap prepare'
  );
  const confirmed = await client.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
    body: { pendingToken: prepared.pendingToken, recoveryPhrase: prepared.recoveryPhrase }
  });
  return client.adopt(confirmed);
}

export async function setAllowedEmails(owner: ApiClient, emails: string[]): Promise<AllowedEmailsResponse> {
  const current = expectData(
    await owner.call<AllowedEmailsResponse>('GET', '/api/v1/settings/allowed-emails'),
    'read allowed emails'
  );
  return expectData(
    await owner.call<AllowedEmailsResponse>('PUT', '/api/v1/settings/allowed-emails', {
      body: { emails, allowlistRevision: current.allowlistRevision }
    }),
    'replace allowed emails'
  );
}

export async function issueInvitation(owner: ApiClient, email: string): Promise<CreatedInvitationResponse> {
  return expectData(
    await owner.call<CreatedInvitationResponse>('POST', '/api/v1/invitations', { body: { email } }),
    'create invitation'
  );
}

/** Full invited-member registration: prepare, then confirm with the phrase just shown. */
export async function registerMember(
  client: ApiClient,
  inviteCode: string,
  email: string,
  password = testPassword(email.split('@')[0] ?? 'member')
): Promise<AuthenticatedResponse> {
  const prepared = expectData(
    await client.call<PreparedRegistrationResponse>('POST', '/api/v1/auth/registration/prepare', {
      body: { inviteCode, email, password }
    }),
    'registration prepare'
  );
  const confirmed = await client.call<AuthenticatedResponse>('POST', '/api/v1/auth/registration/confirm', {
    body: { pendingToken: prepared.pendingToken, recoveryPhrase: prepared.recoveryPhrase }
  });
  return client.adopt(confirmed);
}

export async function login(client: ApiClient, email: string, password: string): Promise<ApiResult<AuthenticatedResponse>> {
  const result = await client.call<AuthenticatedResponse>('POST', '/api/v1/auth/login', { body: { email, password } });
  if (result.data) client.csrfToken = result.data.csrfToken;
  return result;
}

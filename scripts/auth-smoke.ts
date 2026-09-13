/**
 * Stage 2 account smoke test against a deployed isolated test Worker.
 *
 *   node scripts/auth-smoke.ts https://your-test-worker.workers.dev < .secrets.bootstrap
 *
 * The bootstrap secret is read from stdin so it never appears in a command line, a shell
 * history entry, a URL, or this script's output. Disposable identities and their passwords
 * are written to `.secrets.smoke.json` (mode 0600, ignored by Git) so later stages can reuse
 * the same throwaway household. Never point this at production.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

type Envelope<T> = { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } };
type Result<T> = { status: number; headers: Headers; data?: T; error?: Envelope<T>['error'] };

type SmokeState = {
  baseUrl: string;
  owner: { email: string; password: string };
  members: Array<{ email: string; password: string }>;
};

const STATE_PATH = '.secrets.smoke.json';
const MEMBER_COUNT = 6;

let failures = 0;
let checks = 0;

function check(passed: boolean, description: string, detail = ''): void {
  checks += 1;
  if (passed) {
    console.log(`  ok   ${description}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

function step(title: string): void {
  console.log(`\n${title}`);
}

class Client {
  cookie: string | null = null;
  csrfToken: string | null = null;
  // Declared explicitly: Node's type-stripping loader rejects parameter properties.
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async call<T>(
    method: string,
    path: string,
    options: { body?: unknown; cookie?: string | null; csrf?: string | null; origin?: string | null } = {}
  ): Promise<Result<T>> {
    const headers = new Headers();
    const origin = options.origin === undefined ? new URL(this.baseUrl).origin : options.origin;
    if (origin !== null) headers.set('Origin', origin);
    const cookie = options.cookie === undefined ? this.cookie : options.cookie;
    if (cookie !== null) headers.set('Cookie', cookie);
    const csrf = options.csrf === undefined ? this.csrfToken : options.csrf;
    if (csrf !== null && method !== 'GET') headers.set('X-CSRF-Token', csrf);
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(new URL(path, this.baseUrl), { method, headers, body, redirect: 'manual' });
    const raw = response.headers.get('set-cookie');
    if (raw) {
      const match = /__Host-kanban_session=([^;]*)/.exec(raw);
      if (match) this.cookie = (match[1] ?? '').length === 0 ? null : `__Host-kanban_session=${match[1]}`;
    }
    const text = await response.text();
    const envelope: Envelope<T> = text.length === 0 ? {} : (JSON.parse(text) as Envelope<T>);
    return { status: response.status, headers: response.headers, data: envelope.data, error: envelope.error };
  }
}

function randomText(byteLength: number, encoding: 'hex' | 'base64url'): string {
  return Buffer.from(randomBytes(byteLength)).toString(encoding);
}

function disposableEmail(label: string, run: string): string {
  return `${label}-${run}@example.test`;
}

function disposablePassword(): string {
  return `Smoke-${randomText(12, 'base64url')}`;
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

function loadState(baseUrl: string): SmokeState | null {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as SmokeState;
    return parsed.baseUrl === baseUrl ? parsed : null;
  } catch {
    return null;
  }
}

function saveState(state: SmokeState): void {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const baseUrl = process.argv[2];
  let origin = '';
  try {
    origin = baseUrl === undefined ? '' : new URL(baseUrl).origin;
  } catch {
    origin = '';
  }
  // HTTPS everywhere except a local `wrangler dev`, which has no certificate.
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!baseUrl || (!origin.startsWith('https://') && !isLocal)) {
    console.error('Usage: node scripts/auth-smoke.ts https://your-test-worker.workers.dev < secret-file');
    console.error('       node scripts/auth-smoke.ts http://localhost:8787 < secret-file   (wrangler dev)');
    process.exit(2);
  }
  if (/production/i.test(baseUrl)) {
    console.error('Refusing to run the account smoke flow against a production hostname.');
    process.exit(2);
  }
  console.log(`Stage 2 account smoke against ${baseUrl}`);

  const anonymous = new Client(baseUrl);

  step('Health and route surface');
  const health = await anonymous.call<{ status: string; schemaVersion: number }>('GET', '/api/v1/health');
  check(health.status === 200, 'health responds', `status ${health.status}`);
  check((health.data?.schemaVersion ?? 0) >= 2, 'schema version is at least 2', `saw ${health.data?.schemaVersion}`);
  const unknown = await anonymous.call('GET', '/api/v1/auth/password-reset');
  check(unknown.status === 404, 'no email-reset endpoint exists', `status ${unknown.status}`);
  const protectedRead = await anonymous.call('GET', '/api/v1/settings/allowed-emails');
  check(protectedRead.status === 401, 'anonymous callers cannot read owner settings', `status ${protectedRead.status}`);

  const status = await anonymous.call<{ bootstrapAvailable: boolean }>('GET', '/api/v1/auth/bootstrap/status');
  const bootstrapAvailable = status.data?.bootstrapAvailable === true;

  const run = randomText(4, 'hex');
  let state = loadState(baseUrl);
  const owner = new Client(baseUrl);

  if (bootstrapAvailable) {
    step('Owner bootstrap');
    const secret = readStdin();
    if (secret.length === 0) {
      console.error('Bootstrap is open but no secret arrived on stdin. Pipe the disposable test secret in.');
      process.exit(2);
    }
    const ownerIdentity = { email: disposableEmail('owner', run), password: disposablePassword() };
    const prepared = await owner.call<{ pendingToken: string; recoveryPhrase: string }>(
      'POST',
      '/api/v1/auth/bootstrap/prepare',
      { body: { bootstrapSecret: secret, email: ownerIdentity.email, password: ownerIdentity.password } }
    );
    check(prepared.status === 201, 'bootstrap prepare succeeds', `status ${prepared.status} ${prepared.error?.code ?? ''}`);
    check(
      (prepared.data?.recoveryPhrase ?? '').split(' ').length === 12,
      'a twelve-word recovery phrase is issued exactly once'
    );
    const confirmed = await owner.call<{ user: { id: string; role: string }; csrfToken: string }>(
      'POST',
      '/api/v1/auth/registration/confirm',
      { body: { pendingToken: prepared.data?.pendingToken, recoveryPhrase: prepared.data?.recoveryPhrase } }
    );
    check(confirmed.status === 201, 'owner activation succeeds', `status ${confirmed.status} ${confirmed.error?.code ?? ''}`);
    check(confirmed.data?.user.role === 'owner', 'the first account is the owner');
    owner.csrfToken = confirmed.data?.csrfToken ?? null;

    const closed = await anonymous.call<{ bootstrapAvailable: boolean }>('GET', '/api/v1/auth/bootstrap/status');
    check(closed.data?.bootstrapAvailable === false, 'bootstrap is closed by database state');
    const second = await new Client(baseUrl).call('POST', '/api/v1/auth/bootstrap/prepare', {
      body: { bootstrapSecret: secret, email: disposableEmail('second', run), password: disposablePassword() }
    });
    check(second.status === 409, 'a second bootstrap is refused even with the secret', `status ${second.status}`);

    state = {
      baseUrl,
      owner: ownerIdentity,
      members: Array.from({ length: MEMBER_COUNT }, (_, index) => ({
        email: disposableEmail(`member${index + 1}`, run),
        password: disposablePassword()
      }))
    };
    saveState(state);
    console.log(`  note disposable identities saved to ${STATE_PATH} (mode 0600, Git-ignored)`);
  } else {
    step('Owner sign-in (bootstrap already consumed)');
    if (!state) {
      console.error(`Bootstrap is closed and ${STATE_PATH} has no identities for ${baseUrl}. Reset the disposable`);
      console.error('test namespace or restore the state file before re-running.');
      process.exit(2);
    }
    const signedIn = await owner.call<{ user: { role: string }; csrfToken: string }>('POST', '/api/v1/auth/login', {
      body: { email: state.owner.email, password: state.owner.password }
    });
    check(signedIn.status === 200, 'owner signs in', `status ${signedIn.status} ${signedIn.error?.code ?? ''}`);
    owner.csrfToken = signedIn.data?.csrfToken ?? null;
  }

  if (!state) {
    console.error('No smoke state available.');
    process.exit(2);
  }
  const household = state;

  step('Allowed-email list');
  const initial = await owner.call<{ emails: string[]; allowlistRevision: number }>(
    'GET',
    '/api/v1/settings/allowed-emails'
  );
  check(initial.status === 200, 'owner reads the allowed list', `status ${initial.status}`);
  check(initial.data?.emails.includes(household.owner.email) === true, 'the owner address is on the list');

  const fullList = [household.owner.email, ...household.members.map(member => member.email)];
  const saved = await owner.call<{ emails: string[]; allowlistRevision: number }>(
    'PUT',
    '/api/v1/settings/allowed-emails',
    { body: { emails: fullList, allowlistRevision: initial.data?.allowlistRevision } }
  );
  check(saved.status === 200, 'owner saves six member addresses', `status ${saved.status} ${saved.error?.code ?? ''}`);
  check(saved.data?.emails.length === 7, 'the list holds seven addresses including the owner');

  const stale = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
    body: { emails: fullList, allowlistRevision: (initial.data?.allowlistRevision ?? 0) }
  });
  check(stale.status === 409 && stale.error?.code === 'allowlist_conflict', 'a stale revision is refused', `status ${stale.status}`);

  const unlisted = disposableEmail('unlisted', run);
  const refusedInvite = await owner.call('POST', '/api/v1/invitations', { body: { email: unlisted } });
  check(
    refusedInvite.status === 409 && refusedInvite.error?.code === 'email_not_allowed',
    'an unlisted address cannot be invited',
    `status ${refusedInvite.status}`
  );

  step('Invitations and registration');
  const memberClients: Client[] = [];
  // One prepare per member plus a single reuse probe. The per-IP prepare budget is ten per
  // fifteen minutes, and every client here shares one source address.
  let reuseProbed = false;
  for (const [index, member] of household.members.entries()) {
    const label = `member ${index + 1}`;
    const client = new Client(baseUrl);
    const invitation = await owner.call<{ id: string; inviteCode: string }>('POST', '/api/v1/invitations', {
      body: { email: member.email }
    });
    if (invitation.status !== 201 || !invitation.data) {
      check(false, `${label}: invitation issued`, `status ${invitation.status} ${invitation.error?.code ?? ''}`);
      continue;
    }
    const prepared = await client.call<{ pendingToken: string; recoveryPhrase: string }>(
      'POST',
      '/api/v1/auth/registration/prepare',
      { body: { inviteCode: invitation.data.inviteCode, email: member.email, password: member.password } }
    );
    if (prepared.status !== 201 || !prepared.data) {
      check(false, `${label}: registration prepared`, `status ${prepared.status} ${prepared.error?.code ?? ''}`);
      continue;
    }
    const confirmed = await client.call<{ user: { id: string; role: string }; csrfToken: string }>(
      'POST',
      '/api/v1/auth/registration/confirm',
      { body: { pendingToken: prepared.data.pendingToken, recoveryPhrase: prepared.data.recoveryPhrase } }
    );
    if (confirmed.status === 201 && confirmed.data) {
      client.csrfToken = confirmed.data.csrfToken;
      memberClients.push(client);
    } else {
      check(false, `${label}: registration confirmed`, `status ${confirmed.status} ${confirmed.error?.code ?? ''}`);
    }

    if (!reuseProbed) {
      reuseProbed = true;
      const replay = await new Client(baseUrl).call('POST', '/api/v1/auth/registration/prepare', {
        body: { inviteCode: invitation.data.inviteCode, email: member.email, password: disposablePassword() }
      });
      check(replay.status === 403, 'a consumed invitation cannot be reused', `status ${replay.status}`);
    }
  }
  check(memberClients.length === MEMBER_COUNT, 'all six invited members registered', `registered ${memberClients.length}`);

  const roster = await owner.call<{ members: Array<{ id: string; status: string }> }>('GET', '/api/v1/members');
  const active = roster.data?.members.filter(member => member.status === 'active').length ?? 0;
  check(active === 7, 'the household holds an owner plus six active members', `active ${active}`);

  step('Authorization boundaries');
  const memberClient = memberClients[0];
  if (memberClient) {
    const memberRead = await memberClient.call('GET', '/api/v1/settings/allowed-emails');
    check(memberRead.status === 403, 'a member cannot read the owner settings API directly', `status ${memberRead.status}`);
    const memberInvite = await memberClient.call('POST', '/api/v1/invitations', { body: { email: unlisted } });
    check(memberInvite.status === 403, 'a member cannot issue invitations', `status ${memberInvite.status}`);
    const noCsrf = await memberClient.call('POST', '/api/v1/auth/logout', { csrf: null });
    check(noCsrf.status === 403, 'a mutation without the CSRF header is refused', `status ${noCsrf.status}`);
    const foreignOrigin = await memberClient.call('POST', '/api/v1/auth/logout', { origin: 'https://evil.example' });
    check(foreignOrigin.status === 403, 'a mutation from a foreign origin is refused', `status ${foreignOrigin.status}`);
  }
  const unknownLogin = await new Client(baseUrl).call('POST', '/api/v1/auth/login', {
    body: { email: unlisted, password: disposablePassword() }
  });
  check(
    unknownLogin.status === 401 && unknownLogin.error?.code === 'invalid_credentials',
    'an unlisted address gets the generic credential error',
    `status ${unknownLogin.status} ${unknownLogin.error?.code ?? ''}`
  );

  step('Allowed-list removal and re-addition');
  const removed = household.members[0];
  const removedClient = memberClients[0];
  if (removed && removedClient) {
    const secondDevice = new Client(baseUrl);
    const secondLogin = await secondDevice.call<{ csrfToken: string }>('POST', '/api/v1/auth/login', {
      body: { email: removed.email, password: removed.password }
    });
    check(secondLogin.status === 200, 'the member can sign in on a second device', `status ${secondLogin.status}`);

    const current = await owner.call<{ allowlistRevision: number }>('GET', '/api/v1/settings/allowed-emails');
    const afterRemoval = await owner.call<{ emails: string[]; allowlistRevision: number }>(
      'PUT',
      '/api/v1/settings/allowed-emails',
      {
        body: {
          emails: fullList.filter(email => email !== removed.email),
          allowlistRevision: current.data?.allowlistRevision
        }
      }
    );
    check(afterRemoval.status === 200, 'the owner removes one address', `status ${afterRemoval.status}`);

    check((await removedClient.call('GET', '/api/v1/auth/session')).status === 401, 'the first device loses access at once');
    check((await secondDevice.call('GET', '/api/v1/auth/session')).status === 401, 'the second device loses access at once');
    const blockedLogin = await new Client(baseUrl).call('POST', '/api/v1/auth/login', {
      body: { email: removed.email, password: removed.password }
    });
    check(blockedLogin.status === 401, 'a removed address cannot sign in again', `status ${blockedLogin.status}`);

    const stillSeated = await owner.call<{ members: Array<{ email: string; status: string }> }>('GET', '/api/v1/members');
    check(
      stillSeated.data?.members.find(member => member.email === removed.email)?.status === 'active',
      'the removed account still occupies its seat until deactivation'
    );

    const readdRevision = await owner.call<{ allowlistRevision: number }>('GET', '/api/v1/settings/allowed-emails');
    const readded = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
      body: { emails: fullList, allowlistRevision: readdRevision.data?.allowlistRevision }
    });
    check(readded.status === 200, 'the owner restores the address');
    const restored = await new Client(baseUrl).call('POST', '/api/v1/auth/login', {
      body: { email: removed.email, password: removed.password }
    });
    check(restored.status === 200, 'a still-active account can sign in after re-addition', `status ${restored.status}`);
  }

  step('Key-derivation queue contention');
  // Nine simultaneous credential checks against one Durable Object. The bounded queue allows
  // one active derivation plus seven waiters; the rest must be refused retryably rather than
  // starting another memory-heavy hash. Reported, not asserted: the edge may serialise them.
  const burst = await Promise.all(
    Array.from({ length: 9 }, (_, index) =>
      new Client(baseUrl).call('POST', '/api/v1/auth/login', {
        body: { email: disposableEmail(`burst${index}`, run), password: disposablePassword() }
      })
    )
  );
  const codes = burst.map(result => result.status);
  const retryable = burst.filter(result => result.status === 429);
  check(
    burst.every(result => result.status === 401 || result.status === 429),
    'every simultaneous credential check resolved without a server error',
    `statuses ${codes.join(',')}`
  );
  check(
    retryable.every(result => Number(result.headers.get('Retry-After')) > 0),
    'each refused request carried Retry-After'
  );
  console.log(`  note ${retryable.length} of 9 simultaneous requests were refused retryably`);

  step('Disclosure check');
  const readable = JSON.stringify([
    await owner.call('GET', '/api/v1/auth/session'),
    await owner.call('GET', '/api/v1/invitations'),
    await owner.call('GET', '/api/v1/members'),
    await owner.call('GET', '/api/v1/settings/allowed-emails')
  ]);
  const passwords = [household.owner.password, ...household.members.map(member => member.password)];
  check(
    passwords.every(password => !readable.includes(password)),
    'no password appears in any readable response'
  );
  check(!readable.includes('inviteCode'), 'no invitation code is readable after issuance');
  check(!/phrase/i.test(readable), 'no recovery phrase field is readable after issuance');

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(`Smoke run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

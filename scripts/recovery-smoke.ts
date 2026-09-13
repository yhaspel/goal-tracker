/**
 * Stage 3 credential-rotation smoke test against a deployed isolated test Worker.
 *
 *   node scripts/recovery-smoke.ts https://your-test-worker.workers.dev
 *   node scripts/recovery-smoke.ts https://your-test-worker.workers.dev < operator-token-file
 *
 * Reuses the disposable household that `scripts/auth-smoke.ts` created, reading and updating
 * `.secrets.smoke.json` as credentials rotate. Piping an operator reset token on stdin adds
 * the lost-phrase rescue leg; without one that leg is skipped and reported as skipped, because
 * the token can only be inserted through Durable Object Data Studio. See
 * `docs/operator-lost-phrase-reset.md`.
 *
 * Every rotation revokes all sessions, so each step signs in again. Never point this at
 * production.
 *
 * One full run charges five recovery starts against the subject account and roughly eight
 * against the calling address, and the budgets are five and ten per fifteen minutes. Expect a
 * second run inside that window to be refused with `429`; that is the rate limiter working,
 * not a regression. Wait for the window to roll over before rerunning.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

type Envelope<T> = { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } };
type Result<T> = { status: number; headers: Headers; data?: T; error?: Envelope<T>['error'] };

type Identity = { email: string; password: string; phrase?: string };
type SmokeState = { baseUrl: string; owner: Identity; members: Identity[] };

type Started = { challengeToken: string; recoveryPhrase: string; expiresAt: string };

const STATE_PATH = '.secrets.smoke.json';

let checks = 0;
let failures = 0;

function check(passed: boolean, description: string, detail = ''): void {
  checks += 1;
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${description}${passed || !detail ? '' : ` — ${detail}`}`);
}

function step(title: string): void {
  console.log(`\n${title}`);
}

function password(): string {
  return `Rot-${Buffer.from(randomBytes(12)).toString('base64url')}`;
}

class Client {
  cookie: string | null = null;
  csrfToken: string | null = null;
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async call<T>(
    method: string,
    path: string,
    options: { body?: unknown; csrf?: string | null; origin?: string | null } = {}
  ): Promise<Result<T>> {
    const headers = new Headers();
    const origin = options.origin === undefined ? new URL(this.baseUrl).origin : options.origin;
    if (origin !== null) headers.set('Origin', origin);
    if (this.cookie) headers.set('Cookie', this.cookie);
    const csrf = options.csrf === undefined ? this.csrfToken : options.csrf;
    if (csrf !== null && method !== 'GET') headers.set('X-CSRF-Token', csrf);
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(new URL(path, this.baseUrl), { method, headers, body });
    const raw = response.headers.get('set-cookie');
    if (raw) {
      const match = /__Host-kanban_session=([^;]*)/.exec(raw);
      if (match) this.cookie = match[1] ? `__Host-kanban_session=${match[1]}` : null;
    }
    const text = await response.text();
    const envelope: Envelope<T> = text ? (JSON.parse(text) as Envelope<T>) : {};
    return { status: response.status, headers: response.headers, data: envelope.data, error: envelope.error };
  }
}

async function signIn(baseUrl: string, identity: Identity): Promise<Client | null> {
  const client = new Client(baseUrl);
  const result = await client.call<{ csrfToken: string }>('POST', '/api/v1/auth/login', {
    body: { email: identity.email, password: identity.password }
  });
  if (result.status !== 200 || !result.data) return null;
  client.csrfToken = result.data.csrfToken;
  return client;
}

const baseUrl = process.argv[2];
let origin = '';
try {
  origin = baseUrl === undefined ? '' : new URL(baseUrl).origin;
} catch {
  origin = '';
}
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
if (!baseUrl || (!origin.startsWith('https://') && !isLocal)) {
  console.error('Usage: node scripts/recovery-smoke.ts https://your-test-worker.workers.dev [< operator-token-file]');
  process.exit(2);
}
if (/production/i.test(baseUrl)) {
  console.error('Refusing to rotate credentials against a production hostname.');
  process.exit(2);
}

const state: SmokeState = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as SmokeState;
if (state.baseUrl !== baseUrl) {
  console.error(`${STATE_PATH} holds identities for ${state.baseUrl}, not ${baseUrl}.`);
  process.exit(2);
}
function save(): void {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

let operatorToken = '';
try {
  operatorToken = readFileSync(0, 'utf8').trim();
} catch {
  operatorToken = '';
}

const subject = state.members[1];
const decoy = state.members[2];
// A separate, untouched identity for the operator-rescue leg. The three steps above rotate
// `subject`'s password and phrase, and each rotation advances its credential_epoch — past
// whatever epoch an operator token generated before this run was pinned to, which would make
// the rescue fail for a reason that has nothing to do with the rescue. `members[3]` is left
// alone by every smoke script, which is why the handoff nominates it for the rehearsal.
const operatorSubject = state.members[3];
if (!subject || !decoy || !operatorSubject) {
  console.error(`${STATE_PATH} needs at least four member identities.`);
  process.exit(2);
}

console.log(`Stage 3 recovery smoke against ${baseUrl}`);

// --- 1. signed-in phrase regeneration ------------------------------------------------------
step('Signed-in phrase regeneration');
let client = await signIn(baseUrl, subject);
check(client !== null, 'member signs in');
if (!client) process.exit(1);

const regenerate = await client.call<Started>('POST', '/api/v1/account/credentials/start', {
  body: { currentPassword: subject.password }
});
check(regenerate.status === 201, 'phrase-only regeneration starts', `status ${regenerate.status} ${regenerate.error?.code ?? ''}`);
check(
  (regenerate.data?.recoveryPhrase ?? '').split(' ').length === 12,
  'a replacement phrase is shown once'
);
const wrongEntry = await client.call('POST', '/api/v1/account/credentials/confirm', {
  body: { challengeToken: regenerate.data?.challengeToken, newRecoveryPhrase: 'these are not the shown words at all' }
});
check(wrongEntry.status === 403 && wrongEntry.error?.code === 'invalid_phrase', 'a mistyped phrase is refused',
  `status ${wrongEntry.status} ${wrongEntry.error?.code ?? ''}`);

const regenerated = await client.call('POST', '/api/v1/account/credentials/confirm', {
  body: { challengeToken: regenerate.data?.challengeToken, newRecoveryPhrase: regenerate.data?.recoveryPhrase }
});
check(regenerated.status === 200, 'confirmation rotates the phrase', `status ${regenerated.status} ${regenerated.error?.code ?? ''}`);
subject.phrase = regenerate.data?.recoveryPhrase;
save();

check((await client.call('GET', '/api/v1/auth/session')).status === 401, 'the session that started it is revoked');
client = await signIn(baseUrl, subject);
check(client !== null, 'the unchanged password still works');
if (!client) process.exit(1);

// --- 2. signed-in password change ----------------------------------------------------------
step('Signed-in password change');
const changedPassword = password();
const reuse = await client.call('POST', '/api/v1/account/credentials/start', {
  body: { currentPassword: subject.password, newPassword: subject.password }
});
check(reuse.status === 400, 'reusing the current password is refused', `status ${reuse.status}`);

const change = await client.call<Started>('POST', '/api/v1/account/credentials/start', {
  body: { currentPassword: subject.password, newPassword: changedPassword }
});
check(change.status === 201, 'password change starts', `status ${change.status} ${change.error?.code ?? ''}`);

const oldPassword = subject.password;
const changed = await client.call('POST', '/api/v1/account/credentials/confirm', {
  body: { challengeToken: change.data?.challengeToken, newRecoveryPhrase: change.data?.recoveryPhrase }
});
check(changed.status === 200, 'password change commits', `status ${changed.status} ${changed.error?.code ?? ''}`);
subject.password = changedPassword;
subject.phrase = change.data?.recoveryPhrase;
save();

check((await signIn(baseUrl, { ...subject, password: oldPassword })) === null, 'the old password stops working');
client = await signIn(baseUrl, subject);
check(client !== null, 'the new password works');

// --- 3. saved-phrase recovery --------------------------------------------------------------
step('Saved-phrase recovery');
const recoveredPassword = password();
const guest = new Client(baseUrl);
const stalePhrase = regenerate.data?.recoveryPhrase;

const recover = await guest.call<Started>('POST', '/api/v1/recovery/phrase/start', {
  body: { email: subject.email, recoveryPhrase: subject.phrase, newPassword: recoveredPassword }
});
check(recover.status === 201, 'recovery starts with the saved phrase', `status ${recover.status} ${recover.error?.code ?? ''}`);

const recovered = await guest.call('POST', '/api/v1/recovery/phrase/confirm', {
  body: { challengeToken: recover.data?.challengeToken, newRecoveryPhrase: recover.data?.recoveryPhrase }
});
check(recovered.status === 200, 'recovery commits', `status ${recovered.status} ${recovered.error?.code ?? ''}`);
check(
  (recovered.headers.get('set-cookie') ?? '').includes('Max-Age=0'),
  'confirmation issues no session and clears the cookie'
);
const priorPassword = subject.password;
subject.password = recoveredPassword;
subject.phrase = recover.data?.recoveryPhrase;
save();

check((await signIn(baseUrl, { ...subject, password: priorPassword })) === null, 'the pre-recovery password fails');
check((await signIn(baseUrl, subject)) !== null, 'the recovered password works');

const replay = await new Client(baseUrl).call('POST', '/api/v1/recovery/phrase/confirm', {
  body: { challengeToken: recover.data?.challengeToken, newRecoveryPhrase: recover.data?.recoveryPhrase }
});
check(replay.status === 403, 'the used challenge cannot be replayed', `status ${replay.status}`);

// --- 4. refusals ---------------------------------------------------------------------------
step('Refusals');
const signedIn = await signIn(baseUrl, subject);
if (signedIn) {
  const preAuthWithSession = await signedIn.call('POST', '/api/v1/recovery/phrase/start', {
    body: { email: subject.email, recoveryPhrase: subject.phrase, newPassword: password() }
  });
  check(
    preAuthWithSession.status === 403 && preAuthWithSession.error?.code === 'already_authenticated',
    'a signed-in caller is sent to the account flow instead',
    `status ${preAuthWithSession.status} ${preAuthWithSession.error?.code ?? ''}`
  );
}

const foreignOrigin = await new Client(baseUrl).call('POST', '/api/v1/recovery/phrase/start', {
  body: { email: decoy.email, recoveryPhrase: stalePhrase, newPassword: password() },
  origin: 'https://evil.example'
});
check(foreignOrigin.status === 403, 'a foreign origin is refused', `status ${foreignOrigin.status}`);

const unknownAccount = await new Client(baseUrl).call('POST', '/api/v1/recovery/phrase/start', {
  body: { email: `ghost-${Buffer.from(randomBytes(4)).toString('hex')}@example.test`, recoveryPhrase: stalePhrase, newPassword: password() }
});
const staleForRealAccount = await new Client(baseUrl).call('POST', '/api/v1/recovery/phrase/start', {
  body: { email: decoy.email, recoveryPhrase: stalePhrase, newPassword: password() }
});
check(unknownAccount.status === 403, 'an unknown address is refused', `status ${unknownAccount.status}`);
check(
  JSON.stringify(unknownAccount.error) === JSON.stringify(staleForRealAccount.error),
  'an unknown address and a wrong phrase answer identically'
);

const noEmailReset = await new Client(baseUrl).call('POST', '/api/v1/auth/forgot-password', { body: {} });
check(noEmailReset.status === 404, 'no email-reset endpoint exists', `status ${noEmailReset.status}`);

// --- 5. operator rescue --------------------------------------------------------------------
step('Operator rescue');
if (operatorToken.length === 0) {
  console.log('  skip operator leg: no token on stdin. Insert one with Data Studio and rerun with');
  console.log('       node scripts/recovery-smoke.ts <base> < token-file');
} else {
  const rescuePassword = password();
  const rescueClient = new Client(baseUrl);
  const started = await rescueClient.call<Started>('POST', '/api/v1/recovery/operator/start', {
    body: { email: operatorSubject.email, resetToken: operatorToken, newPassword: rescuePassword }
  });
  check(started.status === 201, 'the operator token starts a rescue', `status ${started.status} ${started.error?.code ?? ''}`);

  if (started.status === 201) {
    const rescued = await rescueClient.call('POST', '/api/v1/recovery/operator/confirm', {
      body: { challengeToken: started.data?.challengeToken, newRecoveryPhrase: started.data?.recoveryPhrase }
    });
    check(rescued.status === 200, 'the rescue commits', `status ${rescued.status} ${rescued.error?.code ?? ''}`);
    const before = operatorSubject.password;
    operatorSubject.password = rescuePassword;
    operatorSubject.phrase = started.data?.recoveryPhrase;
    save();

    check((await signIn(baseUrl, { ...operatorSubject, password: before })) === null, 'the pre-rescue password fails');
    check((await signIn(baseUrl, operatorSubject)) !== null, 'the rescued password works');

    const second = await new Client(baseUrl).call('POST', '/api/v1/recovery/operator/start', {
      body: { email: operatorSubject.email, resetToken: operatorToken, newPassword: password() }
    });
    check(second.status === 403, 'the consumed token cannot be reused', `status ${second.status}`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures > 0 ? 1 : 0);

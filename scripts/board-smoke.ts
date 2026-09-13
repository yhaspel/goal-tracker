/**
 * Stage 4 board smoke test against a deployed isolated test Worker.
 *
 *   node scripts/board-smoke.ts https://your-test-worker.workers.dev
 *
 * Reuses the disposable household from `scripts/auth-smoke.ts`, reading `.secrets.smoke.json`.
 * It covers a create, a cross-column move, a conflicting stale move, allowed-list removal
 * cleanup, and deactivation cleanup, then restores the household to seven active seats by
 * registering a replacement for the member it deactivated.
 *
 * Cards it creates are deleted at the end, so the board is left as it was found. Never point
 * this at production.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

type Envelope<T> = { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } };
type Result<T> = { status: number; headers: Headers; data?: T; error?: Envelope<T>['error'] };

type Identity = { email: string; password: string; phrase?: string };
type SmokeState = { baseUrl: string; owner: Identity; members: Identity[] };

type Card = { id: string; columnId: string; title: string; assigneeUserId: string | null; position: number };
type Column = { id: string; nameKey: string | null; customName: string | null; position: number; cards: Card[] };
type Board = { boardRevision: number; columns: Column[]; activeMembers: Array<{ id: string; email: string }> };
type Mutation = { boardRevision: number; id?: string; unchanged?: true };

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

function randomText(byteLength: number, encoding: 'hex' | 'base64url'): string {
  return Buffer.from(randomBytes(byteLength)).toString(encoding);
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

  board(): Promise<Result<Board>> {
    return this.call<Board>('GET', '/api/v1/board');
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
  console.error('Usage: node scripts/board-smoke.ts https://your-test-worker.workers.dev');
  process.exit(2);
}
if (/production/i.test(baseUrl)) {
  console.error('Refusing to mutate a board on a production hostname.');
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

const memberIdentity = state.members[1];
const victimIdentity = state.members[2];
if (!memberIdentity || !victimIdentity) {
  console.error(`${STATE_PATH} needs at least three member identities.`);
  process.exit(2);
}

console.log(`Stage 4 board smoke against ${baseUrl}`);

step('Sessions');
const owner = await signIn(baseUrl, state.owner);
check(owner !== null, 'owner signs in');
const member = await signIn(baseUrl, memberIdentity);
check(member !== null, 'member signs in');
if (!owner || !member) process.exit(1);

step('Board read');
let board = (await owner.board()).data;
check(board !== undefined, 'the board reads');
if (!board) process.exit(1);
check(board.columns.length >= 3, 'the board has its columns', `saw ${board.columns.length}`);
check(
  board.columns.every((column, index) => column.position === index),
  'column positions are dense'
);
check(board.activeMembers.length >= 2, 'the assignee list holds the active members',
  `saw ${board.activeMembers.length}`);
const anonymous = await new Client(baseUrl).board();
check(anonymous.status === 401, 'an anonymous caller cannot read the board', `status ${anonymous.status}`);

const [first, second] = board.columns;
if (!first || !second) process.exit(1);
const created: string[] = [];

step('Card create and cross-column move');
const createdCard = await member.call<Mutation>('POST', '/api/v1/cards', {
  body: { boardRevision: board.boardRevision, columnId: first.id, title: `smoke ${randomText(3, 'hex')}` }
});
check(createdCard.status === 200 && Boolean(createdCard.data?.id), 'a member creates a card',
  `status ${createdCard.status} ${createdCard.error?.code ?? ''}`);
if (!createdCard.data?.id) process.exit(1);
created.push(createdCard.data.id);
check(createdCard.data.boardRevision === board.boardRevision + 1, 'the revision advanced once');

board = (await member.board()).data!;
const moved = await member.call<Mutation>('POST', `/api/v1/cards/${created[0]}/move`, {
  body: { boardRevision: board.boardRevision, targetColumnId: second.id, targetIndex: 0 }
});
check(moved.status === 200, 'the card moves across columns', `status ${moved.status} ${moved.error?.code ?? ''}`);
board = (await member.board()).data!;
const placed = board.columns.find(column => column.id === second.id)?.cards.find(card => card.id === created[0]);
check(placed?.position === 0, 'the card landed at the requested position');
check(
  board.columns.flatMap(column => column.cards).filter(card => card.id === created[0]).length === 1,
  'the card exists exactly once'
);

step('Stale move conflict');
const shared = board.boardRevision;
const secondCard = await owner.call<Mutation>('POST', '/api/v1/cards', {
  body: { boardRevision: shared, columnId: first.id, title: `smoke ${randomText(3, 'hex')}` }
});
if (secondCard.data?.id) created.push(secondCard.data.id);
const stale = await member.call<Mutation>('POST', `/api/v1/cards/${created[0]}/move`, {
  body: { boardRevision: shared, targetColumnId: first.id, targetIndex: 0 }
});
check(stale.status === 409 && stale.error?.code === 'revision_conflict', 'a stale move is refused',
  `status ${stale.status} ${stale.error?.code ?? ''}`);
check(
  typeof stale.error?.details?.boardRevision === 'number' && stale.error.details.boardRevision === shared + 1,
  'the refusal carries the current revision'
);

step('Allowed-list removal clears assignments');
board = (await owner.board()).data!;
const memberRow = board.activeMembers.find(active => active.email === memberIdentity.email);
check(memberRow !== undefined, 'the member appears in the assignee list');
if (memberRow) {
  const assigned = await owner.call<Mutation>('PATCH', `/api/v1/cards/${created[0]}`, {
    body: { boardRevision: board.boardRevision, assigneeUserId: memberRow.id }
  });
  check(assigned.status === 200, 'the card is assigned', `status ${assigned.status} ${assigned.error?.code ?? ''}`);

  const list = await owner.call<{ emails: string[]; allowlistRevision: number }>('GET', '/api/v1/settings/allowed-emails');
  const boardBefore = (await owner.board()).data!.boardRevision;
  const removal = await owner.call<{ allowlistRevision: number; boardRevision?: number }>(
    'PUT',
    '/api/v1/settings/allowed-emails',
    {
      body: {
        emails: list.data!.emails.filter(email => email !== memberIdentity.email),
        allowlistRevision: list.data!.allowlistRevision
      }
    }
  );
  check(removal.status === 200, 'the owner removes the member address', `status ${removal.status}`);
  check(removal.data?.boardRevision === boardBefore + 1, 'removal advanced the board revision once',
    `saw ${removal.data?.boardRevision}, expected ${boardBefore + 1}`);

  board = (await owner.board()).data!;
  const cleared = board.columns.flatMap(column => column.cards).find(card => card.id === created[0]);
  check(cleared?.assigneeUserId === null, 'the assignment was cleared');
  check(
    !board.activeMembers.some(active => active.email === memberIdentity.email),
    'the removed member left the assignee list'
  );
  check((await member.board()).status === 401, 'the removed member lost board access');

  const restore = await owner.call<{ allowlistRevision: number; boardRevision?: number }>(
    'PUT',
    '/api/v1/settings/allowed-emails',
    { body: { emails: list.data!.emails, allowlistRevision: removal.data!.allowlistRevision } }
  );
  check(restore.status === 200, 'the address is restored');
  check(restore.data?.boardRevision === boardBefore + 2, 're-adding an active member advanced it again',
    `saw ${restore.data?.boardRevision}`);
}

step('Deactivation clears assignments');
const victim = await signIn(baseUrl, victimIdentity);
check(victim !== null, 'the second member signs in');
board = (await owner.board()).data!;
const victimRow = board.activeMembers.find(active => active.email === victimIdentity.email);
check(victimRow !== undefined, 'the second member is eligible for assignment');
if (victimRow) {
  const assigned = await owner.call<Mutation>('PATCH', `/api/v1/cards/${created[0]}`, {
    body: { boardRevision: board.boardRevision, assigneeUserId: victimRow.id }
  });
  check(assigned.status === 200, 'the card is assigned to them', `status ${assigned.status} ${assigned.error?.code ?? ''}`);

  const before = (await owner.board()).data!.boardRevision;
  const deactivated = await owner.call<{ member: { status: string }; boardRevision?: number }>(
    'PATCH',
    `/api/v1/members/${victimRow.id}`,
    { body: { status: 'inactive' } }
  );
  check(deactivated.status === 200 && deactivated.data?.member.status === 'inactive', 'the member is deactivated',
    `status ${deactivated.status} ${deactivated.error?.code ?? ''}`);
  check(deactivated.data?.boardRevision === before + 1, 'deactivation advanced the board revision once',
    `saw ${deactivated.data?.boardRevision}`);

  board = (await owner.board()).data!;
  const cleared = board.columns.flatMap(column => column.cards).find(card => card.id === created[0]);
  check(cleared?.assigneeUserId === null, 'the assignment was cleared');
  check(cleared !== undefined, 'the card itself survives');
  check(
    !board.activeMembers.some(active => active.email === victimIdentity.email),
    'the deactivated member left the assignee list'
  );
  if (victim) check((await victim.board()).status === 401, 'their session ended');

  step('Restoring the seventh seat');
  const replacement = {
    email: `member-${randomText(4, 'hex')}@example.test`,
    password: `Board-${randomText(12, 'base64url')}`
  };
  const list = await owner.call<{ emails: string[]; allowlistRevision: number }>('GET', '/api/v1/settings/allowed-emails');
  const swapped = await owner.call('PUT', '/api/v1/settings/allowed-emails', {
    body: {
      emails: list.data!.emails.filter(email => email !== victimIdentity.email).concat(replacement.email),
      allowlistRevision: list.data!.allowlistRevision
    }
  });
  check(swapped.status === 200, 'the freed address is swapped for a fresh one', `status ${swapped.status}`);
  const invitation = await owner.call<{ inviteCode: string }>('POST', '/api/v1/invitations', {
    body: { email: replacement.email }
  });
  check(invitation.status === 201, 'the replacement is invited', `status ${invitation.status}`);
  if (invitation.data) {
    const joiner = new Client(baseUrl);
    const prepared = await joiner.call<{ pendingToken: string; recoveryPhrase: string }>(
      'POST',
      '/api/v1/auth/registration/prepare',
      { body: { inviteCode: invitation.data.inviteCode, email: replacement.email, password: replacement.password } }
    );
    const confirmed = await joiner.call('POST', '/api/v1/auth/registration/confirm', {
      body: { pendingToken: prepared.data?.pendingToken, recoveryPhrase: prepared.data?.recoveryPhrase }
    });
    check(confirmed.status === 201, 'the replacement registers into the freed seat',
      `status ${confirmed.status} ${confirmed.error?.code ?? ''}`);
    if (confirmed.status === 201) {
      state.members[2] = replacement;
      save();
    }
  }
  const roster = await owner.call<{ members: Array<{ status: string }> }>('GET', '/api/v1/members');
  const active = roster.data?.members.filter(row => row.status === 'active').length ?? 0;
  check(active === 7, 'the household is back to seven active accounts', `active ${active}`);
}

step('Cleanup');
for (const id of created) {
  const current = (await owner.board()).data!;
  const removed = await owner.call<Mutation>('DELETE', `/api/v1/cards/${id}`, {
    body: { boardRevision: current.boardRevision }
  });
  check(removed.status === 200, 'the smoke card is deleted', `status ${removed.status} ${removed.error?.code ?? ''}`);
}
const finalBoard = (await owner.board()).data!;
check(
  finalBoard.columns.every((column, index) => column.position === index) &&
    finalBoard.columns.every(column => column.cards.every((card, index) => card.position === index)),
  'positions are dense in every column after cleanup'
);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures > 0 ? 1 : 0);

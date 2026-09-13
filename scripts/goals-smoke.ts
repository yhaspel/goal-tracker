/**
 * Stage 8 goals smoke test against a deployed isolated test Worker.
 *
 *   node scripts/goals-smoke.ts https://your-test-worker.workers.dev
 *
 * Reuses the disposable household from `scripts/auth-smoke.ts`, reading `.secrets.smoke.json`.
 * It covers a create, an explicit reorder, a year move with compaction, a milestone status
 * change, a stale-revision conflict, the delete cascade that detaches a card, and the rule that a
 * goals change does not invalidate a board writer.
 *
 * Everything it creates is deleted at the end, so the household is left as it was found. Never
 * point this at production.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Envelope<T> = { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } };
type Result<T> = { status: number; data?: T; error?: Envelope<T>['error'] };

type Identity = { email: string; password: string; phrase?: string };
type SmokeState = { baseUrl: string; owner: Identity; members: Identity[] };

type Milestone = {
  id: string;
  goalId: string;
  month: number;
  title: string;
  status: 'open' | 'done';
  position: number;
  cards: Array<{ id: string; title: string; columnId: string }>;
};
type Goal = { id: string; year: number; title: string; position: number; milestones: Milestone[] };
type GoalsSnapshot = { goalsRevision: number; boardRevision: number; goals: Goal[] };
type GoalsIndex = {
  goalsRevision: number;
  goals: Array<{ id: string; year: number; title: string }>;
  milestones: Array<{ id: string; goalId: string; month: number; title: string; status: string }>;
};
type Card = { id: string; columnId: string; title: string; dueDate: string | null; milestoneId: string | null };
type Board = { boardRevision: number; columns: Array<{ id: string; cards: Card[] }> };
type Mutation = { goalsRevision: number; id?: string; unchanged?: true };
type BoardMutation = { boardRevision: number; id?: string; unchanged?: true };

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

function randomText(byteLength: number): string {
  return Buffer.from(randomBytes(byteLength)).toString('hex');
}

class Client {
  cookie: string | null = null;
  csrfToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

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
    return { status: response.status, data: envelope.data, error: envelope.error };
  }

  goals(): Promise<Result<GoalsSnapshot>> {
    return this.call<GoalsSnapshot>('GET', '/api/v1/goals');
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
  console.error('Usage: node scripts/goals-smoke.ts https://your-test-worker.workers.dev');
  process.exit(2);
}
if (/production/i.test(baseUrl)) {
  console.error('Refusing to mutate goals on a production hostname.');
  process.exit(2);
}

const state: SmokeState = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as SmokeState;
if (state.baseUrl !== baseUrl) {
  console.error(`${STATE_PATH} holds identities for ${state.baseUrl}, not ${baseUrl}.`);
  process.exit(2);
}
const memberIdentity = state.members[1];
if (!memberIdentity) {
  console.error(`${STATE_PATH} needs at least two member identities.`);
  process.exit(2);
}

console.log(`Stage 8 goals smoke against ${baseUrl}`);

step('Sessions');
const owner = await signIn(baseUrl, state.owner);
const member = await signIn(baseUrl, memberIdentity);
check(owner !== null, 'owner signs in');
check(member !== null, 'member signs in');
if (!owner || !member) process.exit(1);

const anonymous = await new Client(baseUrl).goals();
check(anonymous.status === 401, 'an anonymous caller cannot read the goals', `status ${anonymous.status}`);

/** Everything this run creates, torn down in reverse at the end. */
const createdGoals: string[] = [];
const createdCards: string[] = [];
const year = 2100 + (Number.parseInt(randomText(2), 16) % 400);
const tag = randomText(3);

async function currentGoals(): Promise<GoalsSnapshot> {
  const result = await owner!.goals();
  if (!result.data) throw new Error(`goals read failed: ${result.status} ${result.error?.code ?? ''}`);
  return result.data;
}

step('Create, and a member creating one too');
let snapshot = await currentGoals();
const baselineGoals = snapshot.goals.length;
const first = await owner.call<Mutation>('POST', '/api/v1/goals', {
  body: { goalsRevision: snapshot.goalsRevision, year, title: `smoke a ${tag}`, notes: 'created by the smoke test' }
});
check(first.status === 200 && Boolean(first.data?.id), 'the owner creates a goal',
  `status ${first.status} ${first.error?.code ?? ''}`);
check(first.data?.goalsRevision === snapshot.goalsRevision + 1, 'the goals revision advanced once');
if (!first.data?.id) process.exit(1);
createdGoals.push(first.data.id);

snapshot = await currentGoals();
const second = await member.call<Mutation>('POST', '/api/v1/goals', {
  body: { goalsRevision: snapshot.goalsRevision, year, title: `smoke b ${tag}` }
});
check(second.status === 200 && Boolean(second.data?.id), 'an ordinary member creates a goal too — not owner-only',
  `status ${second.status} ${second.error?.code ?? ''}`);
if (second.data?.id) createdGoals.push(second.data.id);

snapshot = await currentGoals();
const inYear = snapshot.goals.filter(goal => goal.year === year);
check(inYear.length === 2, 'both goals are in the chosen year', `saw ${inYear.length}`);
check(
  inYear.every((goal, index) => goal.position === index),
  'positions in that year are dense'
);

step('Explicit reorder');
snapshot = await currentGoals();
const reordered = await owner.call<Mutation>('POST', `/api/v1/goals/${createdGoals[1]}/move`, {
  body: { goalsRevision: snapshot.goalsRevision, targetIndex: 0 }
});
check(reordered.status === 200, 'a goal moves to the front of its year',
  `status ${reordered.status} ${reordered.error?.code ?? ''}`);
snapshot = await currentGoals();
check(
  snapshot.goals.filter(goal => goal.year === year)[0]?.id === createdGoals[1],
  'the moved goal is first'
);

snapshot = await currentGoals();
const noop = await owner.call<Mutation>('POST', `/api/v1/goals/${createdGoals[1]}/move`, {
  body: { goalsRevision: snapshot.goalsRevision, targetIndex: 0 }
});
check(noop.data?.unchanged === true, 'a move that changes nothing reports unchanged');
check((await currentGoals()).goalsRevision === snapshot.goalsRevision, 'and does not advance the revision');

step('A year move compacts the year it left');
snapshot = await currentGoals();
const movedYear = await owner.call<Mutation>('PATCH', `/api/v1/goals/${createdGoals[1]}`, {
  body: { goalsRevision: snapshot.goalsRevision, year: year + 1 }
});
check(movedYear.status === 200, 'a goal moves to another year', `status ${movedYear.status}`);
snapshot = await currentGoals();
check(
  snapshot.goals.filter(goal => goal.year === year).every((goal, index) => goal.position === index),
  'the source year is dense again'
);
check(snapshot.goals.filter(goal => goal.year === year + 1).some(goal => goal.id === createdGoals[1]),
  'the goal arrived in the target year');

// Put it back, so the rest of the run works within one year.
snapshot = await currentGoals();
await owner.call<Mutation>('PATCH', `/api/v1/goals/${createdGoals[1]}`, {
  body: { goalsRevision: snapshot.goalsRevision, year }
});

step('A title-only patch that resends the year leaves position alone');
snapshot = await currentGoals();
const before = snapshot.goals.find(goal => goal.id === createdGoals[0])!.position;
const renamed = await owner.call<Mutation>('PATCH', `/api/v1/goals/${createdGoals[0]}`, {
  body: { goalsRevision: snapshot.goalsRevision, year, title: `smoke a ${tag} renamed` }
});
check(renamed.status === 200, 'the goal is renamed', `status ${renamed.status}`);
snapshot = await currentGoals();
check(snapshot.goals.find(goal => goal.id === createdGoals[0])!.position === before,
  'its position is unchanged');

step('Milestones');
snapshot = await currentGoals();
const milestone = await owner.call<Mutation>('POST', '/api/v1/milestones', {
  body: { goalsRevision: snapshot.goalsRevision, goalId: createdGoals[0], month: 4, title: `smoke milestone ${tag}` }
});
check(milestone.status === 200 && Boolean(milestone.data?.id), 'a milestone is created',
  `status ${milestone.status} ${milestone.error?.code ?? ''}`);
const milestoneId = milestone.data?.id;
if (!milestoneId) process.exit(1);

snapshot = await currentGoals();
const stored = snapshot.goals.find(goal => goal.id === createdGoals[0])!.milestones.find(m => m.id === milestoneId);
check(stored?.status === 'open', 'it starts open');
check(stored?.month === 4, 'in the month it was given');

snapshot = await currentGoals();
const done = await owner.call<Mutation>('PATCH', `/api/v1/milestones/${milestoneId}`, {
  body: { goalsRevision: snapshot.goalsRevision, status: 'done' }
});
check(done.status === 200, 'its status flips to done', `status ${done.status}`);
snapshot = await currentGoals();
check(
  snapshot.goals.find(goal => goal.id === createdGoals[0])!.milestones.find(m => m.id === milestoneId)?.status === 'done',
  'and the change is what the snapshot reports'
);

step('A card links to the milestone');
let board = (await owner.board()).data!;
const card = await owner.call<BoardMutation>('POST', '/api/v1/cards', {
  body: {
    boardRevision: board.boardRevision,
    columnId: board.columns[0]!.id,
    title: `smoke goal card ${tag}`,
    dueDate: `${year}-04-15`,
    milestoneId
  }
});
check(card.status === 200 && Boolean(card.data?.id), 'a card is created with a due date and a link',
  `status ${card.status} ${card.error?.code ?? ''}`);
if (card.data?.id) createdCards.push(card.data.id);

board = (await owner.board()).data!;
const linkedCard = board.columns.flatMap(column => column.cards).find(entry => entry.id === createdCards[0]);
check(linkedCard?.dueDate === `${year}-04-15`, 'the due date round-trips verbatim', `saw ${linkedCard?.dueDate}`);
check(linkedCard?.milestoneId === milestoneId, 'the link round-trips');

snapshot = await currentGoals();
const linked = snapshot.goals
  .find(goal => goal.id === createdGoals[0])!
  .milestones.find(m => m.id === milestoneId)!;
check(linked.cards.some(entry => entry.id === createdCards[0]), 'the milestone lists the card serving it');

step('A title-only card edit preserves the date and the link');
board = (await owner.board()).data!;
const titleOnly = await owner.call<BoardMutation>('PATCH', `/api/v1/cards/${createdCards[0]}`, {
  body: { boardRevision: board.boardRevision, title: `smoke goal card ${tag} renamed` }
});
check(titleOnly.status === 200, 'the card is renamed', `status ${titleOnly.status}`);
board = (await owner.board()).data!;
const preserved = board.columns.flatMap(column => column.cards).find(entry => entry.id === createdCards[0]);
check(preserved?.dueDate === `${year}-04-15`, 'the due date survived the edit');
check(preserved?.milestoneId === milestoneId, 'the link survived the edit');

step('A malformed due date is refused with a field error');
board = (await owner.board()).data!;
const badDate = await owner.call<BoardMutation>('PATCH', `/api/v1/cards/${createdCards[0]}`, {
  body: { boardRevision: board.boardRevision, dueDate: `${year}-02-30` }
});
check(badDate.status === 400 && badDate.error?.code === 'invalid_request', 'an impossible date is refused',
  `status ${badDate.status} ${badDate.error?.code ?? ''}`);
check(
  (badDate.error?.details?.fieldErrors as Record<string, string> | undefined)?.dueDate !== undefined,
  'the refusal names the dueDate field'
);

step('The compact index');
const index = await owner.call<GoalsIndex>('GET', '/api/v1/goals?view=index');
check(index.status === 200, 'the index reads', `status ${index.status}`);
check(index.data?.goals.some(goal => goal.id === createdGoals[0]) === true, 'it lists the goal');
check(index.data?.milestones.some(entry => entry.id === milestoneId) === true, 'and the milestone');
check(!JSON.stringify(index.data).includes('created by the smoke test'), 'it carries no notes');

for (const query of ['?view=', '?view=all', '?view=index&x=1', '?view=index&view=evil']) {
  const refused = await owner.call<GoalsSnapshot>('GET', `/api/v1/goals${query}`);
  check(refused.status === 400, `${query} is refused`, `status ${refused.status}`);
}

step('Stale revision conflict');
snapshot = await currentGoals();
const shared = snapshot.goalsRevision;
const winner = await owner.call<Mutation>('PATCH', `/api/v1/goals/${createdGoals[0]}`, {
  body: { goalsRevision: shared, title: `smoke a ${tag} winner` }
});
check(winner.status === 200, 'the first writer wins', `status ${winner.status}`);
const loser = await member.call<Mutation>('PATCH', `/api/v1/goals/${createdGoals[0]}`, {
  body: { goalsRevision: shared, title: `smoke a ${tag} loser` }
});
check(loser.status === 409 && loser.error?.code === 'revision_conflict', 'the stale writer is refused',
  `status ${loser.status} ${loser.error?.code ?? ''}`);
check(loser.error?.details?.goalsRevision === shared + 1, 'the refusal carries the current goals revision',
  `saw ${String(loser.error?.details?.goalsRevision)}`);
snapshot = await currentGoals();
check(snapshot.goals.find(goal => goal.id === createdGoals[0])!.title.endsWith('winner'),
  'and nothing partial was written');

step('A goals change does not invalidate a board writer');
board = (await owner.board()).data!;
const boardRevisionBefore = board.boardRevision;
snapshot = await currentGoals();
await owner.call<Mutation>('PATCH', `/api/v1/goals/${createdGoals[0]}`, {
  body: { goalsRevision: snapshot.goalsRevision, notes: `touched ${tag}` }
});
const stillFine = await member.call<BoardMutation>('PATCH', `/api/v1/cards/${createdCards[0]}`, {
  body: { boardRevision: boardRevisionBefore, title: `smoke goal card ${tag} by member` }
});
check(stillFine.status === 200, 'a card edit against the pre-goal-change revision still succeeds',
  `status ${stillFine.status} ${stillFine.error?.code ?? ''}`);

step('The delete cascade');
board = (await owner.board()).data!;
const boardBeforeDelete = board.boardRevision;
snapshot = await currentGoals();
const deleted = await owner.call<Mutation>('DELETE', `/api/v1/goals/${createdGoals[0]}`, {
  body: { goalsRevision: snapshot.goalsRevision }
});
check(deleted.status === 200, 'the goal is deleted', `status ${deleted.status} ${deleted.error?.code ?? ''}`);
check(deleted.data?.goalsRevision === snapshot.goalsRevision + 1, 'the goals revision advanced once');
createdGoals.shift();

board = (await owner.board()).data!;
const detached = board.columns.flatMap(column => column.cards).find(entry => entry.id === createdCards[0]);
check(detached?.milestoneId === null, 'the linked card was detached');
check(detached !== undefined, 'the card itself survives');
check(board.boardRevision === boardBeforeDelete + 1, 'the board revision advanced exactly once',
  `saw ${board.boardRevision}, expected ${boardBeforeDelete + 1}`);

snapshot = await currentGoals();
check(!snapshot.goals.some(goal => goal.id === deleted.data?.id), 'the goal is gone from the snapshot');
check(
  snapshot.goals.filter(goal => goal.year === year).every((goal, position) => goal.position === position),
  'the year compacted after the delete'
);

step('Cleanup');
for (const id of [...createdGoals]) {
  const current = await currentGoals();
  const removed = await owner.call<Mutation>('DELETE', `/api/v1/goals/${id}`, {
    body: { goalsRevision: current.goalsRevision }
  });
  check(removed.status === 200, 'the smoke goal is deleted', `status ${removed.status} ${removed.error?.code ?? ''}`);
}
for (const id of createdCards) {
  const current = (await owner.board()).data!;
  const removed = await owner.call<BoardMutation>('DELETE', `/api/v1/cards/${id}`, {
    body: { boardRevision: current.boardRevision }
  });
  check(removed.status === 200, 'the smoke card is deleted', `status ${removed.status} ${removed.error?.code ?? ''}`);
}
const finalSnapshot = await currentGoals();
check(finalSnapshot.goals.length === baselineGoals, 'the household is back to the goals it started with',
  `saw ${finalSnapshot.goals.length}, expected ${baselineGoals}`);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures > 0 ? 1 : 0);

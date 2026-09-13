/**
 * Stage 8 vision-board smoke test against a deployed isolated test Worker.
 *
 *   node scripts/vision-smoke.ts https://your-test-worker.workers.dev
 *
 * Reuses the disposable household from `scripts/auth-smoke.ts`, reading `.secrets.smoke.json`.
 * It covers an upload, a byte-exact round trip through the content route, the cache and ETag
 * contract, a `304` revalidation, the refusal an anonymous caller gets even with a matching
 * ETag, a caption edit, a reorder, and a delete that gives the bytes back.
 *
 * The images it uploads are synthetic WebP-shaped payloads, not photographs: the server checks
 * type, magic bytes, size and dimensions and nothing more, which is the documented limit.
 * Everything it creates is deleted at the end. Never point this at production.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Envelope<T> = { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } };
type Result<T> = { status: number; headers: Headers; data?: T; error?: Envelope<T>['error'] };

type Identity = { email: string; password: string; phrase?: string };
type SmokeState = { baseUrl: string; owner: Identity; members: Identity[] };

type VisionImage = {
  id: string;
  caption: string | null;
  goalId: string | null;
  mediaType: string;
  byteSize: number;
  width: number;
  height: number;
  contentDigest: string;
  thumbMediaType: string;
  thumbByteSize: number;
  thumbDigest: string;
  position: number;
};
type VisionSnapshot = { visionRevision: number; images: VisionImage[] };
type Mutation = { visionRevision: number; id?: string; unchanged?: true };

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

/** A WebP-shaped payload: the right magic bytes, then deterministic filler. */
function webpBytes(size: number, salt: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 7 + salt) % 251;
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

class Client {
  cookie: string | null = null;
  csrfToken: string | null = null;
  readonly baseUrl: string;

  // Written without a parameter property: Node runs this file under type stripping, which erases
  // annotations but cannot synthesise the assignment a `constructor(readonly baseUrl)` implies.
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private headersFor(method: string, options: { csrf?: string | null; origin?: string | null }): Headers {
    const headers = new Headers();
    const origin = options.origin === undefined ? new URL(this.baseUrl).origin : options.origin;
    if (origin !== null) headers.set('Origin', origin);
    if (this.cookie) headers.set('Cookie', this.cookie);
    const csrf = options.csrf === undefined ? this.csrfToken : options.csrf;
    if (csrf !== null && method !== 'GET') headers.set('X-CSRF-Token', csrf);
    return headers;
  }

  async call<T>(
    method: string,
    path: string,
    options: { body?: unknown; csrf?: string | null; origin?: string | null } = {}
  ): Promise<Result<T>> {
    const headers = this.headersFor(method, options);
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

  /** The binary route, read without parsing the body as JSON. */
  async content(path: string, extra: HeadersInit = {}): Promise<Response> {
    const headers = this.headersFor('GET', {});
    new Headers(extra).forEach((value, name) => headers.set(name, value));
    return fetch(new URL(path, this.baseUrl), { headers });
  }

  vision(): Promise<Result<VisionSnapshot>> {
    return this.call<VisionSnapshot>('GET', '/api/v1/vision');
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
  console.error('Usage: node scripts/vision-smoke.ts https://your-test-worker.workers.dev');
  process.exit(2);
}
if (/production/i.test(baseUrl)) {
  console.error('Refusing to mutate a vision board on a production hostname.');
  process.exit(2);
}

const state: SmokeState = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as SmokeState;
if (state.baseUrl !== baseUrl) {
  console.error(`${STATE_PATH} holds identities for ${state.baseUrl}, not ${baseUrl}.`);
  process.exit(2);
}

console.log(`Stage 8 vision smoke against ${baseUrl}`);

step('Sessions');
const owner = await signIn(baseUrl, state.owner);
check(owner !== null, 'owner signs in');
if (!owner) process.exit(1);

const stranger = new Client(baseUrl);
check((await stranger.vision()).status === 401, 'an anonymous caller cannot read the gallery');

const tag = Buffer.from(randomBytes(3)).toString('hex');
const created: string[] = [];

async function currentVision(): Promise<VisionSnapshot> {
  const result = await owner!.vision();
  if (!result.data) throw new Error(`vision read failed: ${result.status} ${result.error?.code ?? ''}`);
  return result.data;
}

const baseline = await currentVision();

step('Upload');
const fullBytes = webpBytes(24_000, 3);
const thumbBytes = webpBytes(2_400, 11);
const uploaded = await owner.call<Mutation>('POST', '/api/v1/vision/images', {
  body: {
    visionRevision: baseline.visionRevision,
    mediaType: 'image/webp',
    data: toBase64(fullBytes),
    width: 1600,
    height: 1200,
    thumbMediaType: 'image/webp',
    thumbData: toBase64(thumbBytes),
    thumbWidth: 320,
    thumbHeight: 240,
    caption: `smoke ${tag}`
  }
});
check(uploaded.status === 200 && Boolean(uploaded.data?.id), 'an image uploads',
  `status ${uploaded.status} ${uploaded.error?.code ?? ''}`);
check(uploaded.data?.visionRevision === baseline.visionRevision + 1, 'the vision revision advanced once');
if (!uploaded.data?.id) process.exit(1);
created.push(uploaded.data.id);

let snapshot = await currentVision();
const stored = snapshot.images.find(image => image.id === created[0]);
check(stored?.byteSize === fullBytes.length, 'the stored byte size matches what was sent');
check(stored?.contentDigest === sha256(fullBytes), 'the stored digest is the digest of the bytes sent');
check(stored?.thumbDigest === sha256(thumbBytes), 'and the same holds for the thumbnail');
check(!JSON.stringify(snapshot).includes('"content"'), 'the listing never carries bytes');

step('The content route');
const served = await owner.content(`/api/v1/vision/images/${created[0]}/content`);
check(served.status === 200, 'the bytes are served', `status ${served.status}`);
check(served.headers.get('content-type') === 'image/webp', 'the type comes from the stored column');
check(served.headers.get('x-content-type-options') === 'nosniff', 'it is unsniffable');
check(served.headers.get('content-disposition') === 'inline', 'it is inline, never a download');
check(served.headers.get('cache-control') === 'private, max-age=31536000, immutable',
  'it is privately cacheable and immutable', `saw ${served.headers.get('cache-control') ?? 'nothing'}`);
const etag = served.headers.get('etag');
check(etag === `"${sha256(fullBytes)}"`, 'the ETag is the stored digest');
const receivedBytes = new Uint8Array(await served.arrayBuffer());
check(
  receivedBytes.length === fullBytes.length && receivedBytes.every((byte, index) => byte === fullBytes[index]),
  'the bytes come back byte for byte'
);

const thumbServed = await owner.content(`/api/v1/vision/images/${created[0]}/content?variant=thumb`);
const thumbReceived = new Uint8Array(await thumbServed.arrayBuffer());
check(thumbServed.status === 200 && thumbReceived.length === thumbBytes.length, 'the thumbnail is served too');
check(thumbServed.headers.get('etag') === `"${sha256(thumbBytes)}"`, 'with its own ETag');

step('Revalidation and refusals');
const revalidated = await owner.content(`/api/v1/vision/images/${created[0]}/content`, {
  'If-None-Match': etag ?? ''
});
check(revalidated.status === 304, 'a matching If-None-Match gets a 304', `status ${revalidated.status}`);

const anonymousWithEtag = await stranger.content(`/api/v1/vision/images/${created[0]}/content`, {
  'If-None-Match': etag ?? ''
});
check(anonymousWithEtag.status === 401,
  'an anonymous caller gets 401 even with a matching ETag — never a 304',
  `status ${anonymousWithEtag.status}`);

for (const query of ['?variant=full', '?variant=', '?variant=thumb&variant=x', '?x=1']) {
  const refused = await owner.content(`/api/v1/vision/images/${created[0]}/content${query}`);
  check(refused.status === 400, `${query} is refused`, `status ${refused.status}`);
}

const missing = await owner.content('/api/v1/vision/images/no-such-image/content');
check(missing.status === 404, 'an unknown image id is a 404', `status ${missing.status}`);

step('Rejected uploads');
snapshot = await currentVision();
const declaredWrong = await owner.call<Mutation>('POST', '/api/v1/vision/images', {
  body: {
    visionRevision: snapshot.visionRevision,
    mediaType: 'image/jpeg',
    data: toBase64(webpBytes(2000, 1)),
    width: 100,
    height: 100,
    thumbMediaType: 'image/webp',
    thumbData: toBase64(webpBytes(400, 2)),
    thumbWidth: 50,
    thumbHeight: 50
  }
});
check(declaredWrong.status === 400 && declaredWrong.error?.code === 'unsupported_image_type',
  'a payload whose bytes disagree with its declared type is refused',
  `status ${declaredWrong.status} ${declaredWrong.error?.code ?? ''}`);

const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
const svgUpload = await owner.call<Mutation>('POST', '/api/v1/vision/images', {
  body: {
    visionRevision: snapshot.visionRevision,
    mediaType: 'image/webp',
    data: toBase64(svg),
    width: 100,
    height: 100,
    thumbMediaType: 'image/webp',
    thumbData: toBase64(webpBytes(400, 2)),
    thumbWidth: 50,
    thumbHeight: 50
  }
});
check(svgUpload.status === 400, 'an SVG is refused whatever it declares', `status ${svgUpload.status}`);

const unpadded = await owner.call<Mutation>('POST', '/api/v1/vision/images', {
  body: {
    visionRevision: snapshot.visionRevision,
    mediaType: 'image/webp',
    data: toBase64(webpBytes(2000, 1)).replace(/=+$/, ''),
    width: 100,
    height: 100,
    thumbMediaType: 'image/webp',
    thumbData: toBase64(webpBytes(400, 2)),
    thumbWidth: 50,
    thumbHeight: 50
  }
});
check(unpadded.status === 400, 'unpadded base64 is refused before it is decoded', `status ${unpadded.status}`);
check((await currentVision()).images.length === baseline.images.length + 1, 'no rejected upload left a row behind');

step('Caption, reorder and delete');
snapshot = await currentVision();
const secondUpload = await owner.call<Mutation>('POST', '/api/v1/vision/images', {
  body: {
    visionRevision: snapshot.visionRevision,
    mediaType: 'image/webp',
    data: toBase64(webpBytes(8_000, 23)),
    width: 800,
    height: 600,
    thumbMediaType: 'image/webp',
    thumbData: toBase64(webpBytes(900, 29)),
    thumbWidth: 160,
    thumbHeight: 120,
    caption: `smoke second ${tag}`
  }
});
check(secondUpload.status === 200, 'a second image uploads', `status ${secondUpload.status}`);
if (secondUpload.data?.id) created.push(secondUpload.data.id);

snapshot = await currentVision();
const recaptioned = await owner.call<Mutation>('PATCH', `/api/v1/vision/images/${created[0]}`, {
  body: { visionRevision: snapshot.visionRevision, caption: `smoke ${tag} edited` }
});
check(recaptioned.status === 200, 'a caption is edited', `status ${recaptioned.status}`);
snapshot = await currentVision();
check(snapshot.images.find(image => image.id === created[0])?.caption === `smoke ${tag} edited`,
  'and the edit is what the gallery reports');

if (created.length === 2) {
  snapshot = await currentVision();
  const moved = await owner.call<Mutation>('POST', `/api/v1/vision/images/${created[1]}/move`, {
    body: { visionRevision: snapshot.visionRevision, targetIndex: 0 }
  });
  check(moved.status === 200, 'an image reorders', `status ${moved.status}`);
  snapshot = await currentVision();
  check(snapshot.images[0]?.id === created[1], 'the moved image is first');
  check(
    snapshot.images.every((image, index) => image.position === index),
    'gallery positions are dense'
  );
}

step('Cleanup, and the bytes come back');
for (const id of created) {
  const current = await currentVision();
  const removed = await owner.call<Mutation>('DELETE', `/api/v1/vision/images/${id}`, {
    body: { visionRevision: current.visionRevision }
  });
  check(removed.status === 200, 'the smoke image is deleted', `status ${removed.status} ${removed.error?.code ?? ''}`);
}
const finalSnapshot = await currentVision();
check(finalSnapshot.images.length === baseline.images.length,
  'the gallery is back to what it started with', `saw ${finalSnapshot.images.length}`);
check(
  finalSnapshot.images.every((image, index) => image.position === index),
  'and its positions are still dense'
);
const goneForGood = await owner.content(`/api/v1/vision/images/${created[0]}/content`);
check(goneForGood.status === 404, 'a deleted image no longer serves bytes', `status ${goneForGood.status}`);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures > 0 ? 1 : 0);

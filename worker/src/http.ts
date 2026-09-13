import { type ApiErrorDetails, jsonError } from '../../shared/api';
import { QueueFullError } from './auth/kdf-queue';

/** Stage 2 auth bodies. Stage 4 raises the cap for board routes only. */
export const MAX_AUTH_BODY = 16 * 1024;

/**
 * Stage 7's operator restore import, and nothing else. A 500-card board whose descriptions are
 * all 4,000 four-byte code points is roughly 8.4 MB of card text before JSON overhead, so this
 * bounds a maximum-size household with room to spare.
 */
export const MAX_BACKUP_BODY = 16 * 1024 * 1024;

/**
 * Every failure path throws one of these, so a route never half-applies a change and a
 * transaction callback can abort by throwing. `message` must always be safe to display.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly safeMessage: string,
    readonly headers?: Record<string, string>,
    readonly details?: ApiErrorDetails
  ) {
    super(`${code} (${status})`);
  }

  toResponse(): Response {
    return jsonError(this.code, this.safeMessage, this.status, this.headers, this.details);
  }
}

export function invalidRequest(message = 'The request was not valid.', fieldErrors?: Record<string, string>): HttpError {
  return new HttpError(400, 'invalid_request', message, undefined, fieldErrors ? { fieldErrors } : undefined);
}

export function unauthenticated(headers?: Record<string, string>): HttpError {
  return new HttpError(401, 'unauthenticated', 'Sign in to continue.', headers);
}

export function invalidCredentials(): HttpError {
  return new HttpError(401, 'invalid_credentials', 'That email address and password combination did not work.');
}

export function forbidden(code = 'forbidden', message = 'You do not have access to this.'): HttpError {
  return new HttpError(403, code, message);
}

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

export function conflict(code: string, message: string, details?: ApiErrorDetails): HttpError {
  return new HttpError(409, code, message, undefined, details);
}

export function rateLimited(retryAfterSeconds: number): HttpError {
  return new HttpError(429, 'rate_limited', 'Too many attempts. Try again later.', {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds)))
  });
}

export function unavailable(): HttpError {
  return new HttpError(503, 'unavailable', 'The service is temporarily unavailable.', { 'Retry-After': '5' });
}

export function methodNotAllowed(allow: string): HttpError {
  return new HttpError(405, 'method_not_allowed', 'Method not allowed', { Allow: allow });
}

/**
 * Mutations must carry an `Origin` exactly equal to the request URL's origin. Browsers set
 * this header themselves and JavaScript cannot forge it; API scripts send it explicitly.
 * No permissive CORS headers are ever emitted, so a cross-site page cannot read a response.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (origin === null || origin !== new URL(request.url).origin) {
    throw forbidden('forbidden', 'This request did not come from the application.');
  }
}

/**
 * Reads a bounded UTF-8 body. The declared length is checked first so an oversized request is
 * refused before a byte is read, and the running total is checked again while streaming so a
 * chunked body with no declared length meets the same cap.
 */
export async function readTextBody(request: Request, limit: number): Promise<string> {
  if (Number(request.headers.get('Content-Length') ?? 0) > limit) {
    throw new HttpError(413, 'payload_too_large', 'Payload too large');
  }
  if (!request.body) throw invalidRequest();

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large', 'Payload too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Reads a bounded JSON object body. The front Worker already applies the same cap; the
 * Durable Object repeats it so a direct stub call cannot bypass it.
 */
export async function readJsonObject(request: Request, limit = MAX_AUTH_BODY): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new HttpError(415, 'unsupported_media_type', 'Send application/json.');
  }
  const text = await readTextBody(request, limit);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidRequest();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidRequest();
  return parsed as Record<string, unknown>;
}

/** Rejects unexpected properties so a typo or an injected field is never silently ignored. */
export function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalidRequest('The request contained an unexpected field.');
  }
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw invalidRequest();
  return value;
}

export function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) throw invalidRequest();
  return value;
}

export function isSafeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Maps thrown errors onto the shared envelope. No SQL text or stack ever reaches a client. */
export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return error.toResponse();
  // A saturated key-derivation queue is retryable rather than a server fault.
  if (error instanceof QueueFullError) return rateLimited(1).toResponse();
  return jsonError('internal_error', 'Something went wrong.', 500);
}

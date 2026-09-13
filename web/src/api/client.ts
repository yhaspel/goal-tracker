import type { ApiErrorDetails } from '../../../shared/api';

/**
 * The session lives in a `__Host-` cookie the browser sends itself, and the session-bound CSRF
 * token lives here in memory for the life of the page. Nothing is written to localStorage,
 * sessionStorage, or a URL, so a password, phrase, invitation code, or token can never be
 * recovered from the browser after the tab closes.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetails | undefined;

  constructor(status: number, code: string, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Server-side per-field reasons, already safe to translate and display. */
  get fieldErrors(): Readonly<Record<string, string>> {
    return this.details?.fieldErrors ?? {};
  }

  /** True when the request never reached the Worker. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export type RequestOptions = {
  body?: unknown;
  signal?: AbortSignal;
};

type Envelope<T> = { data?: T; error?: { code: string; message: string; details?: ApiErrorDetails } };

/**
 * One same-origin JSON call. The browser supplies `Origin` on mutations; script must not try
 * to set it, and the Worker rejects anything that is not an exact match.
 */
export async function apiRequest<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  // Pre-auth routes have no session to bind a token to; the Worker checks Origin there.
  if (csrfToken !== null && method !== 'GET') headers.set('X-CSRF-Token', csrfToken);

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network', 'The request could not be sent.');
  }

  const text = await response.text();
  let envelope: Envelope<T> = {};
  if (text.length > 0) {
    try {
      envelope = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new ApiError(response.status, 'generic', 'The response could not be read.');
    }
  }

  if (!response.ok || envelope.error) {
    const error = envelope.error;
    throw new ApiError(response.status, error?.code ?? 'generic', error?.message ?? 'Request failed.', error?.details);
  }
  return envelope.data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('DELETE', path, { ...options, body })
};

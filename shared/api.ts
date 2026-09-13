export type ApiSuccess<T> = { data: T };
export type ApiError = { error: { code: string; message: string; details?: { boardRevision?: number; fieldErrors?: Record<string, string> } } };

export function jsonData<T>(data: T, status = 200): Response {
  return Response.json({ data } satisfies ApiSuccess<T>, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function jsonError(code: string, message: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } } satisfies ApiError, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

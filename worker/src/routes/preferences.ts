import { jsonData, type Locale, LOCALES, type PreferencesResponse } from '../../../shared/api';
import { assertCsrf, requireActor } from '../auth/authorize';
import { findUserById, setUserLanguage } from '../db/account-repository';
import { assertOnlyKeys, assertSameOrigin, forbidden, invalidRequest, methodNotAllowed, readJsonObject } from '../http';
import type { RouteContext } from './context';

const PATH = '/api/v1/me/preferences';

/**
 * Updates only the calling account's interface language. There is deliberately no user id in
 * the path or the body: one member can never edit another's preference.
 */
async function update(ctx: RouteContext, request: Request): Promise<Response> {
  assertSameOrigin(request);
  const actor = requireActor(ctx, request);
  assertCsrf(ctx, request, actor);

  const body = await readJsonObject(request);
  assertOnlyKeys(body, ['language']);
  const language = body.language;
  if (typeof language !== 'string' || !LOCALES.includes(language as Locale)) {
    throw invalidRequest('That language is not supported.', { language: 'unsupported' });
  }

  const updated = ctx.storage.transactionSync(() => {
    // Re-read inside the transaction: a deactivation or allowed-list removal that commits
    // first must win here as it does everywhere else.
    const fresh = findUserById(ctx.sql, actor.user.id);
    if (!fresh || fresh.status !== 'active') throw forbidden();
    setUserLanguage(ctx.sql, fresh.id, language as Locale, ctx.nowIso);
    return language as Locale;
  });

  return jsonData<PreferencesResponse>({ language: updated });
}

export function handlePreferencesRoute(
  ctx: RouteContext,
  request: Request,
  path: string
): Promise<Response> | undefined {
  if (path !== PATH) return undefined;
  return (async () => {
    if (request.method !== 'PATCH') throw methodNotAllowed('PATCH');
    return update(ctx, request);
  })();
}

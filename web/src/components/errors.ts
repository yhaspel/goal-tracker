import { ApiError } from '../api/client';
import type { TranslationKey } from '../i18n/en';
import { en } from '../i18n/en';
import type { Params } from '../i18n/translate';

/** Only the lookup is needed here, so these helpers stay free of React. */
type Lookup = { t: (key: TranslationKey, params?: Params) => string };

function known(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/**
 * Turns any thrown value into one safe, translated sentence.
 *
 * The stable `code` is what the UI branches on; the server's English message is never shown,
 * so a message the server changes cannot leak through untranslated.
 */
export function errorText(translator: Lookup, error: unknown, params?: Params): string {
  if (!(error instanceof ApiError)) return translator.t('error.generic');
  if (error.isNetwork) return translator.t('error.network');
  const key = `error.${error.code}`;
  return known(key) ? translator.t(key, params) : translator.t('error.generic');
}

/** `newPassword` and `currentPassword` share the password family's reasons. */
function fieldFamily(field: string): string {
  if (field === 'newPassword' || field === 'currentPassword') return 'password';
  return field;
}

/**
 * Per-field messages for a `400`, keyed by the server's stable reason. Fields the dictionary
 * does not know fall back to a generic sentence rather than showing a raw server string.
 */
export function fieldErrorText(
  translator: Lookup,
  error: unknown,
  field: string,
  params?: Params
): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const reason = error.fieldErrors[field];
  if (reason === undefined) return undefined;
  const specific = `field.${fieldFamily(field)}.${reason}`;
  if (known(specific)) return translator.t(specific, params);
  return translator.t('field.fallback');
}

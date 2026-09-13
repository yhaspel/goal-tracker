import type { Locale } from '../../../shared/api';
import { en, type LocaleDictionary, type TranslationKey } from './en';
import { he } from './he';
import { ru } from './ru';

/**
 * The translation logic, with no React and no browser APIs, so it can be tested directly.
 * `index.tsx` wraps it in a provider.
 *
 * `npm run check:i18n` verifies that every locale covers the whole English key set, uses the
 * same interpolation parameters, and supplies exactly the plural categories its own language
 * requires. English is a development fallback only; the check is what keeps it from being one
 * in a release.
 */
export const DICTIONARIES: Record<Locale, LocaleDictionary> = { en, he, ru };

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Keys whose family ends in a plural category, e.g. `board.cardCount`. */
export type PluralKey = TranslationKey extends infer Key
  ? Key extends `${infer Base}.${PluralCategory}`
    ? Base
    : never
  : never;

export type Params = Readonly<Record<string, string | number>>;

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

export type Translate = {
  t: (key: TranslationKey, params?: Params) => string;
  plural: (key: PluralKey, count: number, params?: Params) => string;
};

export function createTranslate(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale] ?? en;
  const rules = new Intl.PluralRules(locale);

  // A key missing from a locale falls back to English rather than showing the raw key. The
  // Stage 6 release check is what stops that fallback from reaching a release build.
  const lookup = (key: string): string | undefined =>
    (dictionary as Record<string, string | undefined>)[key] ?? (en as Record<string, string | undefined>)[key];

  return {
    t: (key, params) => interpolate(lookup(key) ?? key, params),
    plural: (key, count, params) => {
      const exact = lookup(`${key}.${rules.select(count)}`);
      const template = exact ?? lookup(`${key}.other`) ?? key;
      return interpolate(template, { count, ...params });
    }
  };
}

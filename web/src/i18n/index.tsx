import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { type Locale, LOCALES } from '../../../shared/api';
import type { TranslationKey } from './en';
import { createTranslate, type Params, type PluralKey } from './translate';

export type { Params, PluralKey } from './translate';

const LOCALE_COOKIE = 'kanban_locale';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['he']);

export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as readonly string[]).includes(value);
}

function readLocaleCookie(): Locale | undefined {
  for (const pair of document.cookie.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== LOCALE_COOKIE) continue;
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    return isLocale(value) ? value : undefined;
  }
  return undefined;
}

/** A non-sensitive preference only. No credential ever goes into a script-readable cookie. */
export function writeLocaleCookie(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** Hebrew and Russian variants map onto the two non-English locales; anything else is English. */
export function localeFromTags(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0];
    // `iw` is the legacy tag some browsers still send for Hebrew.
    if (base === 'he' || base === 'iw') return 'he';
    if (base === 'ru') return 'ru';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function detectLocale(): Locale {
  return readLocaleCookie() ?? localeFromTags(navigator.languages ?? [navigator.language]);
}

/**
 * Applied before React renders so the first paint already has the right direction, and again
 * on every change so a switch takes effect without a reload.
 */
export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionOf(locale);
}

export type Translator = {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: TranslationKey, params?: Params) => string;
  /** Chooses the plural form for `count` using the active locale's rules. */
  plural: (key: PluralKey, count: number, params?: Params) => string;
  setLocale: (locale: Locale) => void;
};

const TranslationContext = createContext<Translator | null>(null);

export function TranslationProvider({
  children,
  initialLocale,
  onLocaleChange
}: {
  children: ReactNode;
  initialLocale: Locale;
  /** Stage 6 uses this to persist a signed-in member's preference. */
  onLocaleChange?: (locale: Locale) => void;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      applyDocumentLocale(next);
      writeLocaleCookie(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange]
  );

  const value = useMemo<Translator>(() => {
    const translate = createTranslate(locale);
    return { locale, dir: directionOf(locale), t: translate.t, plural: translate.plural, setLocale };
  }, [locale, setLocale]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation(): Translator {
  const value = useContext(TranslationContext);
  if (!value) throw new Error('useTranslation must be used inside a TranslationProvider');
  return value;
}

import { useId, useState } from 'react';
import type { Locale } from '../../../shared/api';
import { LOCALES } from '../../../shared/api';
import { updateLanguage } from '../api/endpoints';
import { useSession } from '../auth/session';
import { useAnnounce } from '../components/ui';
import { useTranslation } from '.';
import { createTranslate } from './translate';

/**
 * Language names are written in their own language and are the same in every interface
 * language, so they are not translation keys.
 */
const ENDONYMS: Record<Locale, string> = { en: 'English', he: 'עברית', ru: 'Русский' };

/**
 * Available to guests and members alike, because someone has to be able to read the
 * registration and recovery screens before they have an account.
 *
 * A guest's choice lives in a non-sensitive cookie. A signed-in member's choice is also sent
 * to the server; if that fails, the interface reverts to the last confirmed preference rather
 * than pretending the change was saved.
 */
export function LanguageSelector() {
  const { locale, setLocale, t } = useTranslation();
  const { state, refresh } = useSession();
  const announce = useAnnounce();
  const [failed, setFailed] = useState(false);
  const id = useId();

  const change = async (next: Locale) => {
    if (next === locale) return;
    const previous = locale;
    setFailed(false);
    setLocale(next);
    if (state.status !== 'active') return;
    try {
      await updateLanguage(next);
      // Built from `next`, not from the hook's `t`: this render still holds the old locale, so
      // the confirmation would otherwise be spoken in the language just switched away from.
      announce(createTranslate(next).t('account.languageSaved'));
      // Keeps the session copy of `user.language` in step with what was just stored.
      await refresh();
    } catch {
      setLocale(previous);
      setFailed(true);
    }
  };

  return (
    <p className="language-selector">
      <label htmlFor={id}>{t('app.language')}</label>
      <select
        id={id}
        value={locale}
        onChange={event => void change(event.target.value as Locale)}
        aria-describedby={failed ? `${id}-error` : undefined}
      >
        {LOCALES.map(option => (
          <option key={option} value={option}>
            {ENDONYMS[option]}
          </option>
        ))}
      </select>
      {failed ? (
        <span className="error" id={`${id}-error`} role="alert">
          {t('account.languageFailed')}
        </span>
      ) : null}
    </p>
  );
}

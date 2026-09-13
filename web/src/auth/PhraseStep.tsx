import { type FormEvent, useState } from 'react';
import { CopyButton, Field, Submit } from '../components/ui';
import { useTranslation } from '../i18n';

/**
 * The one place a recovery phrase is ever displayed.
 *
 * The phrase arrives from a prepare or start response, lives in this component's state, and
 * disappears when the component unmounts. It is never written to storage, a URL, the console,
 * or a form that could be autofilled later. Nothing is committed until the person re-types it.
 */
export function PhraseStep({
  phrase,
  onConfirm,
  pending,
  error,
  footnote
}: {
  phrase: string;
  onConfirm: (entered: string) => void | Promise<void>;
  pending: boolean;
  error?: string;
  footnote?: string;
}) {
  const { t } = useTranslation();
  const [entered, setEntered] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    void onConfirm(entered);
  };

  return (
    <section className="phrase-step">
      <h2>{t('phrase.heading')}</h2>
      <p>{t('phrase.body')}</p>
      <p className="warning">
        <strong>{t('phrase.onceWarning')}</strong> {t('phrase.noStorage')}
      </p>

      <div className="phrase-box">
        {/* Recovery words are Latin script and must read left to right in any interface language. */}
        <p className="phrase isolate" dir="ltr">
          {phrase}
        </p>
        <CopyButton value={phrase} label={t('app.copy')} />
      </div>

      <form onSubmit={submit} noValidate>
        <Field
          label={t('phrase.confirmLabel')}
          help={t('phrase.confirmHelp')}
          value={entered}
          onChange={setEntered}
          error={error}
          required
          isolate
          rows={3}
          autoComplete="off"
        />
        <p className="help">{footnote ?? t('phrase.abandonWarning')}</p>
        <Submit pending={pending}>{t('phrase.submit')}</Submit>
      </form>
    </section>
  );
}

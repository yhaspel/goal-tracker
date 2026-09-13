import { type FormEvent, useState } from 'react';
import type { CredentialRotationStartResponse } from '../../../shared/api';
import {
  confirmOperatorRecovery,
  confirmPhraseRecovery,
  startOperatorRecovery,
  startPhraseRecovery
} from '../api/endpoints';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, Field, Submit } from '../components/ui';
import { useTranslation } from '../i18n';
import { Link } from '../router';
import { PhraseStep } from './PhraseStep';

type Method = 'phrase' | 'operator';

export function RecoverPage() {
  const translator = useTranslation();
  const { t } = translator;

  const [method, setMethod] = useState<Method>('phrase');
  const [email, setEmail] = useState('');
  const [phrase, setPhrase] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  // Challenge and replacement phrase stay here until confirmation, then vanish.
  const [started, setStarted] = useState<CredentialRotationStartResponse | null>(null);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const clearSecrets = () => {
    setPhrase('');
    setResetToken('');
    setNewPassword('');
  };

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response =
        method === 'phrase'
          ? await startPhraseRecovery({ email, recoveryPhrase: phrase, newPassword })
          : await startOperatorRecovery({ email, resetToken, newPassword });
      setStarted(response);
      clearSecrets();
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  };

  const confirm = async (entered: string) => {
    if (!started) return;
    setPending(true);
    setFailure(null);
    try {
      const body = { challengeToken: started.challengeToken, newRecoveryPhrase: entered };
      if (method === 'phrase') await confirmPhraseRecovery(body);
      else await confirmOperatorRecovery(body);
      setStarted(null);
      setDone(true);
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <section className="panel narrow">
        <h1>{t('recover.heading')}</h1>
        <Alert tone="notice">{t('recover.done')}</Alert>
        <p>
          <Link to="/login">{t('nav.signIn')}</Link>
        </p>
      </section>
    );
  }

  if (started) {
    return (
      <section className="panel narrow">
        <h1>{t('recover.heading')}</h1>
        {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
        <PhraseStep
          phrase={started.recoveryPhrase}
          onConfirm={confirm}
          pending={pending}
          error={fieldErrorText(translator, failure, 'recoveryPhrase')}
        />
      </section>
    );
  }

  return (
    <section className="panel narrow">
      <h1>{t('recover.heading')}</h1>

      <fieldset className="choice">
        <legend>{t('recover.heading')}</legend>
        {(['phrase', 'operator'] as const).map(option => (
          <label key={option}>
            <input
              type="radio"
              name="recovery-method"
              value={option}
              checked={method === option}
              onChange={() => {
                setMethod(option);
                setFailure(null);
                clearSecrets();
              }}
            />
            {option === 'phrase' ? t('recover.withPhrase') : t('recover.withToken')}
          </label>
        ))}
      </fieldset>

      <p>{method === 'phrase' ? t('recover.phraseBody') : t('recover.tokenBody')}</p>
      {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}

      <form onSubmit={start} noValidate>
        <Field
          label={t('signIn.email')}
          value={email}
          onChange={setEmail}
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          isolate
        />
        {method === 'phrase' ? (
          <Field
            label={t('recover.phraseLabel')}
            help={t('phrase.confirmHelp')}
            value={phrase}
            onChange={setPhrase}
            autoComplete="off"
            rows={3}
            required
            isolate
          />
        ) : (
          <Field
            label={t('recover.tokenLabel')}
            value={resetToken}
            onChange={setResetToken}
            autoComplete="off"
            required
            isolate
          />
        )}
        <Field
          label={t('recover.newPassword')}
          help={t('register.passwordHelp')}
          value={newPassword}
          onChange={setNewPassword}
          type="password"
          autoComplete="new-password"
          error={fieldErrorText(translator, failure, 'newPassword')}
          required
          isolate
        />
        <Submit pending={pending}>{t('recover.submit')}</Submit>
      </form>

      <p className="help">{t('recover.lostBoth')}</p>
    </section>
  );
}

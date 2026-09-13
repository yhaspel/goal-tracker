import { type FormEvent, useState } from 'react';
import type { CredentialRotationStartResponse } from '../../../shared/api';
import { confirmCredentialChange, startCredentialChange } from '../api/endpoints';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, Field, Submit } from '../components/ui';
import { useTranslation } from '../i18n';
import { useRouter } from '../router';
import { PhraseStep } from './PhraseStep';
import { useSession } from './session';

export function AccountPage() {
  const translator = useTranslation();
  const { t } = translator;
  const { state, forgetSession } = useSession();
  const { navigate } = useRouter();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [started, setStarted] = useState<CredentialRotationStartResponse | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      // Omitting the new password regenerates the phrase only and keeps the current password.
      const response = await startCredentialChange(
        newPassword.length > 0 ? { currentPassword, newPassword } : { currentPassword }
      );
      setStarted(response);
      setCurrentPassword('');
      setNewPassword('');
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
      await confirmCredentialChange({ challengeToken: started.challengeToken, newRecoveryPhrase: entered });
      setStarted(null);
      // Confirmation revokes every session, including this one.
      forgetSession();
      navigate('/login');
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel narrow">
      <h1>{t('account.heading')}</h1>
      {state.status === 'active' ? (
        <p className="help">
          {t('nav.signedInAs', { email: '' })}
          <span className="isolate" dir="ltr">
            {state.user.email}
          </span>
        </p>
      ) : null}

      {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}

      {started ? (
        <PhraseStep
          phrase={started.recoveryPhrase}
          onConfirm={confirm}
          pending={pending}
          error={fieldErrorText(translator, failure, 'recoveryPhrase')}
          footnote={t('account.signOutWarning')}
        />
      ) : (
        <form onSubmit={start} noValidate>
          <Field
            label={t('account.currentPassword')}
            value={currentPassword}
            onChange={setCurrentPassword}
            type="password"
            autoComplete="current-password"
            error={fieldErrorText(translator, failure, 'currentPassword')}
            required
            isolate
          />
          <Field
            label={t('account.newPassword')}
            help={t('account.newPasswordHelp')}
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            autoComplete="new-password"
            error={fieldErrorText(translator, failure, 'newPassword')}
            isolate
          />
          <p className="help">{t('account.signOutWarning')}</p>
          <Submit pending={pending}>{t('account.submit')}</Submit>
        </form>
      )}
    </section>
  );
}

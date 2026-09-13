import { type FormEvent, useState } from 'react';
import type { PreparedRegistrationResponse } from '../../../shared/api';
import { confirmRegistration, prepareRegistration } from '../api/endpoints';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, Field, Submit } from '../components/ui';
import { useTranslation } from '../i18n';
import { Link, useRouter } from '../router';
import { PhraseStep } from './PhraseStep';
import { useSession } from './session';

export function RegisterPage() {
  const translator = useTranslation();
  const { t, locale } = translator;
  const { adopt } = useSession();
  const { navigate } = useRouter();

  const [inviteCode, setInviteCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [prepared, setPrepared] = useState<PreparedRegistrationResponse | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const prepare = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await prepareRegistration({ inviteCode: inviteCode.trim(), email, password, language: locale });
      setPrepared(response);
      setPassword('');
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  };

  const confirm = async (entered: string) => {
    if (!prepared) return;
    setPending(true);
    setFailure(null);
    try {
      adopt(await confirmRegistration({ pendingToken: prepared.pendingToken, recoveryPhrase: entered }));
      setPrepared(null);
      setInviteCode('');
      navigate('/board');
    } catch (error) {
      setFailure(error);
      // The pending record is gone; the invitation itself may still be usable, so send the
      // person back to the start of the flow rather than pretending they joined.
      if (error instanceof Error && 'code' in error && error.code === 'invalid_pending_token') setPrepared(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel narrow">
      <h1>{t('register.heading')}</h1>
      {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
      {prepared ? (
        <PhraseStep
          phrase={prepared.recoveryPhrase}
          onConfirm={confirm}
          pending={pending}
          error={fieldErrorText(translator, failure, 'recoveryPhrase')}
        />
      ) : (
        <>
          <p>{t('register.body')}</p>
          <p className="help">{t('register.inviteHow')}</p>
          <p>
            {t('register.ownerPrompt')} <Link to="/bootstrap">{t('welcome.bootstrapAction')}</Link>
          </p>
          <form onSubmit={prepare} noValidate>
            <Field
              label={t('register.code')}
              help={t('register.codeHelp')}
              value={inviteCode}
              onChange={setInviteCode}
              autoComplete="off"
              required
              isolate
            />
            <Field
              label={t('register.email')}
              value={email}
              onChange={setEmail}
              type="email"
              inputMode="email"
              autoComplete="username"
              error={fieldErrorText(translator, failure, 'email')}
              required
              isolate
            />
            <Field
              label={t('register.password')}
              help={t('register.passwordHelp')}
              value={password}
              onChange={setPassword}
              type="password"
              autoComplete="new-password"
              error={fieldErrorText(translator, failure, 'password')}
              required
              isolate
            />
            <Submit pending={pending}>{t('register.submit')}</Submit>
          </form>
        </>
      )}
    </section>
  );
}

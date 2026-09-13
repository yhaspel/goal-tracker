import { type FormEvent, useEffect, useState } from 'react';
import type { PreparedRegistrationResponse } from '../../../shared/api';
import { bootstrapStatus, confirmRegistration, prepareBootstrap } from '../api/endpoints';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, Field, Submit } from '../components/ui';
import { useTranslation } from '../i18n';
import { Link, useRouter } from '../router';
import { PhraseStep } from './PhraseStep';
import { useSession } from './session';

export function BootstrapPage() {
  const translator = useTranslation();
  const { t, locale } = translator;
  const { adopt } = useSession();
  const { navigate } = useRouter();

  const [available, setAvailable] = useState<boolean | null>(null);
  const [secret, setSecret] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Held only until the phrase is confirmed. Never persisted.
  const [prepared, setPrepared] = useState<PreparedRegistrationResponse | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    bootstrapStatus({ signal: controller.signal })
      .then(status => setAvailable(status.bootstrapAvailable))
      .catch(() => setAvailable(null));
    return () => controller.abort();
  }, []);

  const prepare = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await prepareBootstrap({ bootstrapSecret: secret, email, password, language: locale });
      setPrepared(response);
      // Neither value is needed again; drop them rather than leaving them in a live form.
      setSecret('');
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
      navigate('/board');
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  };

  if (prepared) {
    return (
      <section className="panel narrow">
        <h1>{t('bootstrap.heading')}</h1>
        {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
        <PhraseStep
          phrase={prepared.recoveryPhrase}
          onConfirm={confirm}
          pending={pending}
          error={fieldErrorText(translator, failure, 'recoveryPhrase')}
        />
      </section>
    );
  }

  return (
    <section className="panel narrow">
      <h1>{t('bootstrap.heading')}</h1>
      {available === false ? (
        <>
          <Alert tone="notice">{t('bootstrap.closed')}</Alert>
          <p className="link-action">
            <Link to="/login">{t('nav.signIn')}</Link>
          </p>
        </>
      ) : (
        <>
          <p>{t('bootstrap.body')}</p>
          {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
          <form onSubmit={prepare} noValidate>
            <Field
              label={t('bootstrap.secret')}
              help={t('bootstrap.secretHelp')}
              value={secret}
              onChange={setSecret}
              type="password"
              autoComplete="off"
              required
              isolate
            />
            <Field
              label={t('signIn.email')}
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
            <Submit pending={pending}>{t('bootstrap.submit')}</Submit>
          </form>
        </>
      )}
    </section>
  );
}

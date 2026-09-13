import { type FormEvent, useState } from 'react';
import { signIn } from '../api/endpoints';
import { errorText, fieldErrorText } from '../components/errors';
import { Alert, Field, Submit } from '../components/ui';
import { useTranslation } from '../i18n';
import { Link, useRouter } from '../router';
import { useSession } from './session';

export function SignInPage() {
  const translator = useTranslation();
  const { t } = translator;
  const { adopt } = useSession();
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      adopt(await signIn({ email, password }));
      // The password leaves component state the moment it is no longer needed.
      setPassword('');
      navigate('/board');
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel narrow">
      <h1>{t('signIn.heading')}</h1>
      {failure ? <Alert tone="error">{errorText(translator, failure)}</Alert> : null}
      <form onSubmit={submit} noValidate>
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
          label={t('signIn.password')}
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="current-password"
          error={fieldErrorText(translator, failure, 'password')}
          required
          isolate
        />
        <Submit pending={pending}>{t('signIn.submit')}</Submit>
      </form>
      <p className="help">{t('signIn.noEmail')}</p>
      <p className="link-action">
        <Link to="/recover">{t('signIn.forgot')}</Link>
      </p>
      <p className="link-action">
        <Link to="/register">{t('nav.join')}</Link>
      </p>
    </section>
  );
}

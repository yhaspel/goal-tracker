import { useEffect, useState } from 'react';
import { bootstrapStatus } from './api/endpoints';
import { useSession } from './auth/session';
import { useTranslation } from './i18n';
import { Link, useRouter } from './router';

export function WelcomePage() {
  const { t } = useTranslation();
  const { state } = useSession();
  const { navigate } = useRouter();
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);

  useEffect(() => {
    if (state.status !== 'guest') return;
    const controller = new AbortController();
    bootstrapStatus({ signal: controller.signal })
      .then(status => setBootstrapAvailable(status.bootstrapAvailable))
      .catch(() => setBootstrapAvailable(false));
    return () => controller.abort();
  }, [state.status]);

  useEffect(() => {
    if (state.status === 'active') navigate('/board', { replace: true });
  }, [state.status, navigate]);

  return (
    <section className="panel narrow">
      <h1>{t('welcome.heading')}</h1>
      <p>{t('welcome.body')}</p>
      {bootstrapAvailable ? (
        <>
          <p>{t('welcome.bootstrapPrompt')}</p>
          <p className="link-action">
            <Link to="/bootstrap">{t('welcome.bootstrapAction')}</Link>
          </p>
        </>
      ) : (
        <>
          <p className="link-action">
            <Link to="/login">{t('nav.signIn')}</Link>
          </p>
          <p className="link-action">
            <Link to="/register">{t('nav.join')}</Link>
          </p>
        </>
      )}
    </section>
  );
}

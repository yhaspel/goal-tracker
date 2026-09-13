import { useEffect, useRef } from 'react';
import { AccountPage } from './auth/AccountPage';
import { BootstrapPage } from './auth/BootstrapPage';
import { RecoverPage } from './auth/RecoverPage';
import { RegisterPage } from './auth/RegisterPage';
import { useSession } from './auth/session';
import { SignInPage } from './auth/SignInPage';
import { BoardPage } from './board/BoardPage';
import { useTranslation } from './i18n';
import { SettingsPage } from './members/SettingsPage';
import { Link, type RoutePath, useRouter } from './router';
import { WelcomePage } from './WelcomePage';

/** Guest-only screens. A live session is sent to the board instead. */
const GUEST_ONLY: ReadonlySet<RoutePath> = new Set(['/login', '/register', '/recover', '/bootstrap']);
/** Screens that need a live session. */
const MEMBER_ONLY: ReadonlySet<RoutePath> = new Set(['/board', '/account', '/members']);

export default function App() {
  const { t } = useTranslation();
  const { state, signOutNow } = useSession();
  const { path, navigate } = useRouter();
  const heading = useRef<HTMLDivElement>(null);

  // Guards run after the first session read, so protected content never flashes.
  useEffect(() => {
    if (state.status === 'loading') return;
    if (state.status === 'active' && GUEST_ONLY.has(path)) navigate('/board', { replace: true });
    if (state.status === 'guest' && MEMBER_ONLY.has(path)) navigate('/login', { replace: true });
    if (state.status === 'active' && path === '/members' && state.user.role !== 'owner') {
      navigate('/board', { replace: true });
    }
  }, [state, path, navigate]);

  // Moving focus to the start of the new screen is what makes client-side navigation
  // announce itself and keeps the keyboard position sensible.
  useEffect(() => {
    heading.current?.focus();
  }, [path]);

  const signedIn = state.status === 'active';
  const isOwner = signedIn && state.user.role === 'owner';

  return (
    <>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="app-header">
        <p className="brand">{t('app.name')}</p>
        <nav aria-label={t('app.name')}>
          {signedIn ? (
            <>
              <Link to="/board">{t('nav.board')}</Link>
              {isOwner ? <Link to="/members">{t('nav.settings')}</Link> : null}
              <Link to="/account">{t('nav.account')}</Link>
              <button type="button" onClick={() => void signOutNow().then(() => navigate('/login'))}>
                {t('nav.signOut')}
              </button>
            </>
          ) : (
            <Link to="/login">{t('nav.signIn')}</Link>
          )}
        </nav>
        {signedIn ? (
          <p className="help who">
            {t('nav.signedInAs', { email: '' })}
            <span className="isolate" dir="ltr">
              {state.user.email}
            </span>
          </p>
        ) : null}
      </header>

      <main id="main" ref={heading} tabIndex={-1}>
        {state.status === 'loading' ? <p className="panel">{t('app.loading')}</p> : <Screen path={path} />}
      </main>
    </>
  );
}

function Screen({ path }: { path: RoutePath }) {
  switch (path) {
    case '/login':
      return <SignInPage />;
    case '/register':
      return <RegisterPage />;
    case '/recover':
      return <RecoverPage />;
    case '/bootstrap':
      return <BootstrapPage />;
    case '/board':
      return <BoardPage />;
    case '/account':
      return <AccountPage />;
    case '/members':
      return <SettingsPage />;
    default:
      return <WelcomePage />;
  }
}

import { useEffect, useRef, useState } from 'react';
import { AccountPage } from './auth/AccountPage';
import { BootstrapPage } from './auth/BootstrapPage';
import { RecoverPage } from './auth/RecoverPage';
import { RegisterPage } from './auth/RegisterPage';
import { useSession } from './auth/session';
import { SignInPage } from './auth/SignInPage';
import { BoardPage } from './board/BoardPage';
import { BrandMark, CloseIcon, MenuIcon } from './components/icons';
import { useMediaQuery, WithValue } from './components/ui';
import { useTranslation } from './i18n';
import { LanguageSelector } from './i18n/LanguageSelector';
import { SettingsPage } from './members/SettingsPage';
import { Link, type RoutePath, useRouter } from './router';
import { WelcomePage } from './WelcomePage';

/** Guest-only screens. A live session is sent to the board instead. */
const GUEST_ONLY: ReadonlySet<RoutePath> = new Set(['/login', '/register', '/recover', '/bootstrap']);
/** Screens that need a live session. */
const MEMBER_ONLY: ReadonlySet<RoutePath> = new Set(['/board', '/account', '/members']);

/** Below this the header collapses to the brand plus one menu button. */
const PHONE = '(max-width: 833px)';

export default function App() {
  const { t, locale, setLocale } = useTranslation();
  const { state, signOutNow } = useSession();
  const { path, navigate } = useRouter();
  const heading = useRef<HTMLDivElement>(null);
  const adoptedFor = useRef<string | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuSheet = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(PHONE);
  const [menuOpen, setMenuOpen] = useState(false);

  // A signed-in member's stored preference takes precedence over the guest cookie, once per
  // sign-in. Their own later switches go through the selector and are not undone here.
  useEffect(() => {
    if (state.status !== 'active') {
      adoptedFor.current = null;
      return;
    }
    if (adoptedFor.current === state.user.id) return;
    adoptedFor.current = state.user.id;
    if (state.user.language !== locale) setLocale(state.user.language);
  }, [state, locale, setLocale]);

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

  // The sheet belongs to the phone header; a window that grows past the breakpoint takes the
  // button away, so the sheet it opened goes with it. Navigating also closes it.
  useEffect(() => {
    if (!phone) setMenuOpen(false);
  }, [phone]);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  /**
   * The sheet covers the screen behind its own backdrop, so it follows the same contract the
   * dialog does: focus moves into it when it opens, Escape closes it from anywhere rather than
   * only from inside, Tab cycles within it, and the button that opened it gets focus back.
   */
  useEffect(() => {
    if (!menuOpen) return;
    menuSheet.current?.querySelector<HTMLElement>('a[href], button, select')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const signedIn = state.status === 'active';
  const isOwner = signedIn && state.user.role === 'owner';

  const signOut = () => void signOutNow().then(() => navigate('/login'));

  const links = signedIn ? (
    <>
      <Link to="/board">{t('nav.board')}</Link>
      {isOwner ? <Link to="/members">{t('nav.settings')}</Link> : null}
      <Link to="/account">{t('nav.account')}</Link>
    </>
  ) : (
    <>
      <Link to="/login">{t('nav.signIn')}</Link>
      <Link to="/register">{t('nav.join')}</Link>
    </>
  );

  const signedInAs = signedIn ? (
    <p className="help who">
      {/* The address keeps its own direction inside a right-to-left sentence. */}
      <WithValue template={t('nav.signedInAs')} name="email">
        <span className="isolate" dir="ltr">
          {state.user.email}
        </span>
      </WithValue>
    </p>
  ) : null;

  return (
    <>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="app-header">
        {/*
         * The name stays Latin in all three locales and is bidi-isolated, so it reads the same
         * way inside a Hebrew header as it does inside an English one. Translating it would
         * give a household that mixes languages a different product name per person.
         */}
        <p className="brand">
          <BrandMark />
          <span className="brand-name" dir="ltr">
            {t('app.name')}
          </span>
        </p>
        <nav aria-label={t('app.name')}>
          {links}
          {signedIn ? (
            <button type="button" onClick={signOut}>
              {t('nav.signOut')}
            </button>
          ) : null}
        </nav>
        <LanguageSelector />
        {signedInAs}

        {/*
         * One control in both states: it swaps its icon and its `aria-expanded`, never its
         * accessible name. The stylesheet is what shows it below 834px and hides the row above.
         */}
        <button
          type="button"
          className="icon nav-toggle"
          ref={menuButton}
          aria-expanded={menuOpen}
          aria-controls="nav-sheet"
          aria-label={t('app.menu')}
          onClick={() => setMenuOpen(open => !open)}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {menuOpen && phone ? (
        <>
          <div className="nav-sheet-backdrop" onMouseDown={() => setMenuOpen(false)} />
          <div
            id="nav-sheet"
            className="nav-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t('app.menu')}
            ref={menuSheet}
            onKeyDown={event => {
              if (event.key !== 'Tab' || !menuSheet.current) return;
              const focusable = Array.from(
                menuSheet.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select')
              );
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (!first || !last) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            {/* Never more than four links, so the whole sheet fits without scrolling. */}
            <nav aria-label={t('app.name')}>{links}</nav>
            <LanguageSelector />
            {signedInAs}
            {signedIn ? (
              <button type="button" className="nav-sheet-action" onClick={signOut}>
                {t('nav.signOut')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

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

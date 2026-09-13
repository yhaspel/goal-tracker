import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * The Worker serves `index.html` only for this exact set of paths, so the list here and the
 * SPA allowlist in `worker/src/index.ts` must stay in step. Anything else 404s rather than
 * rendering the shell.
 */
export const ROUTES = [
  '/',
  '/login',
  '/register',
  '/recover',
  '/bootstrap',
  '/board',
  '/goals',
  '/vision',
  '/account',
  '/members'
] as const;

export type RoutePath = (typeof ROUTES)[number];

export function isRoutePath(value: string): value is RoutePath {
  return (ROUTES as readonly string[]).includes(value);
}

function currentPath(): RoutePath {
  const path = window.location.pathname;
  return isRoutePath(path) ? path : '/';
}

type Router = {
  path: RoutePath;
  navigate: (to: RoutePath, options?: { replace?: boolean }) => void;
};

const RouterContext = createContext<Router | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<RoutePath>(currentPath);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: RoutePath, options?: { replace?: boolean }) => {
    if (options?.replace === true) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPath(to);
  }, []);

  const value = useMemo<Router>(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): Router {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter must be used inside a RouterProvider');
  return value;
}

/**
 * A real anchor, so middle-click, copy-link, and the browser status bar all behave normally,
 * with client-side navigation for a plain left click.
 */
export function Link({
  to,
  children,
  className
}: {
  to: RoutePath;
  children: ReactNode;
  className?: string;
}) {
  const { navigate, path } = useRouter();
  return (
    <a
      href={to}
      className={className}
      aria-current={path === to ? 'page' : undefined}
      onClick={event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

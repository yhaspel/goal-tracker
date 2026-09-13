import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthenticatedResponse, SessionUser } from '../../../shared/api';
import { ApiError, setCsrfToken } from '../api/client';
import { readSession, signOut } from '../api/endpoints';

export type SessionState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'active'; user: SessionUser };

type SessionContextValue = {
  state: SessionState;
  /** Adopts the session an authentication response just created. */
  adopt: (response: AuthenticatedResponse) => void;
  /** Signs out server-side; falls back to clearing local state if the call fails. */
  signOutNow: () => Promise<void>;
  /** Drops local session state after a `401`, without a server round trip. */
  forgetSession: () => void;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const session = await readSession({ signal });
      setCsrfToken(session.csrfToken);
      setState({ status: 'active', user: session.user });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Anything other than a live session is treated as a guest. A network failure is shown
      // by whichever screen the guest lands on rather than blocking the whole app.
      setCsrfToken(null);
      setState({ status: 'guest' });
    }
  }, []);

  // Read once before rendering anything protected, so member data never flashes.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      adopt: response => {
        setCsrfToken(response.csrfToken);
        setState({ status: 'active', user: response.user });
      },
      forgetSession: () => {
        setCsrfToken(null);
        setState({ status: 'guest' });
      },
      signOutNow: async () => {
        try {
          await signOut();
        } catch (error) {
          // A 401 means the session was already gone, which is the outcome we wanted.
          if (!(error instanceof ApiError)) throw error;
        }
        setCsrfToken(null);
        setState({ status: 'guest' });
      },
      refresh: () => load()
    }),
    [state, load]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}

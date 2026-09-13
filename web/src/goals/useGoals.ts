import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoalsSnapshot } from '../../../shared/api';
import { ApiError } from '../api/client';
import { readGoals } from '../api/endpoints';

/** The same cadence the board uses: cheap on the Free plan, fresh enough for a shared list. */
const POLL_INTERVAL_MS = 30_000;

export type GoalsState = {
  goals: GoalsSnapshot | null;
  error: unknown;
  loading: boolean;
  refresh: () => Promise<GoalsSnapshot | null>;
};

/**
 * Loads the goals and keeps them reasonably fresh.
 *
 * Modelled on `useBoard`, including its `enabled` gate — which is what stops a guest fetching —
 * but deliberately **without** `setOptimistic`. There is no drag here: Move up and Move down are
 * a visible round trip, which is what the rest of the product does outside drag. Responses are
 * sequenced by request id so a slow earlier reply can never overwrite a newer snapshot, and a
 * background refetch never blanks the screen.
 */
export function useGoals(enabled: boolean, onUnauthenticated: () => void): GoalsState {
  const [goals, setGoals] = useState<GoalsSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const request = ++latest.current;
    try {
      const snapshot = await readGoals({ signal: controller.signal });
      if (request !== latest.current) return null;
      setGoals(snapshot);
      setError(null);
      return snapshot;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return null;
      if (request !== latest.current) return null;
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthenticated();
        return null;
      }
      setError(cause);
      return null;
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [enabled, onUnauthenticated]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_INTERVAL_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      inFlight.current?.abort();
    };
  }, [enabled, refresh]);

  return { goals, error, loading, refresh };
}

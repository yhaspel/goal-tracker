import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardSnapshot } from '../../../shared/api';
import { ApiError } from '../api/client';
import { readBoard } from '../api/endpoints';

/** Long enough to be cheap on the Free plan, short enough that a shared board feels shared. */
const POLL_INTERVAL_MS = 30_000;

export type BoardState = {
  board: BoardSnapshot | null;
  error: unknown;
  loading: boolean;
  refresh: () => Promise<BoardSnapshot | null>;
  /** Applies a local reordering while a move is in flight. */
  setOptimistic: (board: BoardSnapshot) => void;
};

/**
 * Loads the board and keeps it reasonably fresh.
 *
 * Refetches follow a successful mutation, a return to the tab, and a slow interval while the
 * tab is visible; polling stops when it is hidden. Responses are sequenced by request id so a
 * slow earlier reply can never overwrite a newer board.
 */
export function useBoard(enabled: boolean, onUnauthenticated: () => void): BoardState {
  const [board, setBoard] = useState<BoardSnapshot | null>(null);
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
      const snapshot = await readBoard({ signal: controller.signal });
      if (request !== latest.current) return null;
      setBoard(snapshot);
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

  return { board, error, loading, refresh, setOptimistic: setBoard };
}

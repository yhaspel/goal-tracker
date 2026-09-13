import { useCallback, useEffect, useRef, useState } from 'react';
import type { VisionSnapshot } from '../../../shared/api';
import { ApiError } from '../api/client';
import { readVision } from '../api/endpoints';

/** The same cadence the board and the goals screen use. */
const POLL_INTERVAL_MS = 30_000;

export type VisionState = {
  vision: VisionSnapshot | null;
  error: unknown;
  loading: boolean;
  refresh: () => Promise<VisionSnapshot | null>;
};

/** Modelled on `useBoard`, with the same `enabled` gate, sequencing and abort behaviour. */
export function useVision(enabled: boolean, onUnauthenticated: () => void): VisionState {
  const [vision, setVision] = useState<VisionSnapshot | null>(null);
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
      const snapshot = await readVision({ signal: controller.signal });
      if (request !== latest.current) return null;
      setVision(snapshot);
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

  return { vision, error, loading, refresh };
}

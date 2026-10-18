import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  /** The last failure; data from an earlier success stays available beside it. */
  error: unknown;
  /** True until the first response (or failure) arrives. */
  loading: boolean;
  /** Time of the last successful load. */
  updatedAt: Date | null;
  reload: () => void;
  /** Replace the data locally, e.g. after a successful change. */
  setData: (update: (current: T | null) => T | null) => void;
}

export interface ResourceOptions {
  /** Reload this often while the tab is visible. */
  pollMs?: number;
  /** Change to reload (a key, a counter). */
  deps?: readonly unknown[];
  enabled?: boolean;
}

/** Loads data, keeps the last good copy on failure, and can poll. */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  { pollMs, deps = [], enabled = true }: ResourceOptions = {},
): Resource<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      try {
        const result = await loadRef.current(controller.signal);
        if (controller.signal.aborted) return;
        setDataState(result);
        setError(null);
        setUpdatedAt(new Date());
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          schedule();
        }
      }
    };
    const schedule = () => {
      if (!pollMs) return;
      timer = setTimeout(() => {
        // A hidden tab does not poll; it catches up when it becomes visible again.
        if (typeof document !== 'undefined' && document.hidden) schedule();
        else void run();
      }, pollMs);
    };

    setLoading(true);
    void run();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, pollMs, tick, ...deps]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setData = useCallback(
    (update: (current: T | null) => T | null) => setDataState((c) => update(c)),
    [],
  );
  return { data, error, loading, updatedAt, reload, setData };
}

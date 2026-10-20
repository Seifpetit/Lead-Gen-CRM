import type { LiveRuns, RunSummary } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/context.js';

/** How often the runs are asked for while the event stream is not working. */
export const LIVE_POLL_MS = 3_000;
/** After a stream failure, how long polling runs before the stream is tried again. */
export const LIVE_RETRY_MS = 30_000;

export type LiveMode = 'connecting' | 'live' | 'polling';

export interface LiveRunsState {
  /** The runs in progress; null until the first answer. */
  runs: RunSummary[] | null;
  /** Runs that ended in the last half hour, newest first: failed, stopped or finished. */
  ended: RunSummary[];
  /** live: the server pushes changes; polling: the stream failed, so it is asked every 3 s. */
  mode: LiveMode;
  /** The last polling failure; cleared by the next success. */
  error: unknown;
}

/**
 * The runs in progress, kept current. Opens the event stream (GET /api/runs/stream); if the
 * browser has no EventSource or the stream fails, asks GET /api/runs/live every 3 seconds and
 * tries the stream again after a while. `onEnded` is called with the last known state of a
 * run that is no longer in progress (finished, stopped or failed), so a page can reload what
 * the run produced.
 */
export function useLiveRuns(onEnded?: (run: RunSummary) => void): LiveRunsState {
  const api = useApi();
  const [state, setState] = useState<LiveRunsState>({
    runs: null,
    ended: [],
    mode: 'connecting',
    error: null,
  });
  const known = useRef<RunSummary[]>([]);
  const ended = useRef(onEnded);
  ended.current = onEnded;

  const apply = useCallback((live: LiveRuns, mode: LiveMode) => {
    const runs = live.runs;
    const still = new Set(runs.map((r) => r.id));
    for (const run of known.current) if (!still.has(run.id)) ended.current?.(run);
    known.current = runs;
    setState({ runs, ended: live.ended ?? [], mode, error: null });
  }, []);

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;

    const poll = async () => {
      try {
        const live = await api.runs.live();
        if (!closed && polling) apply(live, 'polling');
      } catch (error) {
        if (!closed) setState((s) => ({ ...s, mode: 'polling', error }));
      } finally {
        if (!closed && polling) pollTimer = setTimeout(() => void poll(), LIVE_POLL_MS);
      }
    };
    const startPolling = () => {
      if (polling) return;
      polling = true;
      void poll();
    };
    const stopPolling = () => {
      polling = false;
      clearTimeout(pollTimer);
    };
    const openStream = () => {
      if (typeof EventSource === 'undefined') return startPolling();
      let stream: EventSource;
      try {
        stream = new EventSource(api.runs.streamUrl());
      } catch {
        return startPolling();
      }
      source = stream;
      stream.addEventListener('runs', (event) => {
        try {
          const live = JSON.parse((event as MessageEvent<string>).data) as LiveRuns;
          stopPolling();
          apply(live, 'live');
        } catch {
          // A garbled event is skipped; the next one replaces it.
        }
      });
      stream.onerror = () => {
        // The browser would retry by itself, but a stream that keeps failing (a proxy that
        // buffers, a lost session) is better replaced by plain polling for a while.
        stream.close();
        source = null;
        startPolling();
        retryTimer = setTimeout(() => {
          stopPolling();
          if (!closed) openStream();
        }, LIVE_RETRY_MS);
      };
    };
    openStream();
    return () => {
      closed = true;
      source?.close();
      clearTimeout(pollTimer);
      clearTimeout(retryTimer);
    };
  }, [api, apply]);

  return state;
}

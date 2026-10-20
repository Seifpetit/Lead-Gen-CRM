import type { RunLogLine } from '@lead-gen-crm/shared';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../../api/context.js';

/** How often new lines are asked for while the run is going. */
export const LOG_POLL_MS = 1_500;
/** After a failed read, how long before the next try. */
export const LOG_RETRY_MS = 5_000;
const PAGE = 500;

export interface RunLogState {
  lines: RunLogLine[];
  /** True until the first read of the log has finished. */
  loading: boolean;
  error: unknown;
}

/**
 * A run's whole log: every page read once, then only the lines after the last one seen, asked
 * again every moment while the run is active and once more after it ends.
 */
export function useRunLog(runId: string, active: boolean): RunLogState {
  const api = useApi();
  const [state, setState] = useState<RunLogState>({ lines: [], loading: true, error: null });
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    setState({ lines: [], loading: true, error: null });

    const pull = async () => {
      const wasActive = activeRef.current;
      let failed = false;
      try {
        for (;;) {
          const page = await api.runs.logs(runId, { after: last, limit: PAGE });
          if (closed) return;
          const fresh = page.items.filter((line) => line.id > last);
          if (fresh.length > 0) {
            last = fresh[fresh.length - 1]!.id;
            setState((s) => ({ ...s, lines: [...s.lines, ...fresh] }));
          }
          if (!page.hasMore || page.items.length === 0) break;
        }
        setState((s) => ({ ...s, loading: false, error: null }));
      } catch (error) {
        if (closed) return;
        failed = true;
        setState((s) => ({ ...s, loading: false, error }));
      }
      if (!closed && (wasActive || failed))
        timer = setTimeout(() => void pull(), failed ? LOG_RETRY_MS : LOG_POLL_MS);
    };
    void pull();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [api, runId]);

  return state;
}

/** Every line of one run's log, read page by page (the Logs export; no polling, no state). */
export async function readRunLog(
  api: ReturnType<typeof useApi>,
  runId: string,
): Promise<RunLogLine[]> {
  const lines: RunLogLine[] = [];
  let last = 0;
  for (;;) {
    const page = await api.runs.logs(runId, { after: last, limit: PAGE });
    const fresh = page.items.filter((line) => line.id > last);
    lines.push(...fresh);
    if (fresh.length > 0) last = fresh[fresh.length - 1]!.id;
    if (!page.hasMore || fresh.length === 0) return lines;
  }
}

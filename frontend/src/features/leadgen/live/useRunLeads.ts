import type { Lead } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../../api/context.js';

const PAGE = 25;

interface Bucket {
  items: Lead[];
  total: number;
}

export interface RunLeads {
  /** The leads of the chosen runs, best score first. */
  leads: Lead[];
  total: number;
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  moreError: unknown;
  loadMore: () => void;
  /** Swap in a lead the person has just changed. */
  replace: (lead: Lead) => void;
}

/**
 * The leads of one or several runs. The first page of each run is read again whenever `signal`
 * changes (the run scored more leads); leads already on screen, and any loaded by "Show more",
 * are kept. Leads of several runs are mixed by score.
 */
export function useRunLeads(runIds: readonly string[], signal: number): RunLeads {
  const api = useApi();
  const [buckets, setBuckets] = useState<Record<string, Bucket>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const key = runIds.join(',');
  const ids = useMemo(() => (key === '' ? [] : key.split(',')), [key]);
  const current = useRef(buckets);
  current.current = buckets;

  useEffect(() => {
    let closed = false;
    if (ids.length === 0) {
      setBuckets({});
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const pages = await Promise.all(
          ids.map((runId) => api.leads.list({ runId, limit: PAGE, offset: 0 })),
        );
        if (closed) return;
        setBuckets((old) => {
          const next: Record<string, Bucket> = {};
          ids.forEach((runId, i) => {
            const page = pages[i]!;
            const known = new Map((old[runId]?.items ?? []).map((l) => [l.id, l]));
            const fresh = page.items.map((l) => known.get(l.id) ?? l);
            const extra = (old[runId]?.items ?? []).filter(
              (l) => !page.items.some((p) => p.id === l.id),
            );
            next[runId] = { items: [...fresh, ...extra], total: page.total };
          });
          return next;
        });
        setError(null);
      } catch (err) {
        if (!closed) setError(err);
      } finally {
        if (!closed) setLoading(false);
      }
    })();
    return () => {
      closed = true;
    };
  }, [api, ids, signal]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    setMoreError(null);
    (async () => {
      try {
        const more = ids.filter((id) => {
          const b = current.current[id];
          return b !== undefined && b.items.length < b.total;
        });
        const pages = await Promise.all(
          more.map((runId) =>
            api.leads.list({
              runId,
              limit: PAGE,
              offset: current.current[runId]?.items.length ?? 0,
            }),
          ),
        );
        setBuckets((old) => {
          const next = { ...old };
          more.forEach((runId, i) => {
            const b = old[runId];
            if (!b) return;
            const seen = new Set(b.items.map((l) => l.id));
            next[runId] = {
              items: [...b.items, ...pages[i]!.items.filter((l) => !seen.has(l.id))],
              total: pages[i]!.total,
            };
          });
          return next;
        });
      } catch (err) {
        setMoreError(err);
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [api, ids]);

  const replace = useCallback((lead: Lead) => {
    setBuckets((old) =>
      Object.fromEntries(
        Object.entries(old).map(([runId, b]) => [
          runId,
          { ...b, items: b.items.map((l) => (l.id === lead.id ? lead : l)) },
        ]),
      ),
    );
  }, []);

  const mine = ids.map((id) => buckets[id]).filter((b): b is Bucket => b !== undefined);
  const leads = mine.flatMap((b) => b.items);
  if (ids.length > 1) leads.sort((a, b) => b.score.total - a.score.total);
  const total = mine.reduce((sum, b) => sum + b.total, 0);
  return {
    leads,
    total,
    loading,
    error,
    hasMore: leads.length < total,
    loadingMore,
    moreError,
    loadMore,
    replace,
  };
}

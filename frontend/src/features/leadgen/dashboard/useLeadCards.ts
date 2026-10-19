import type {
  CardsQuery,
  CrmCard,
  CrmCardPage,
  CrmFacets,
  CrmPipeline,
} from '@lead-gen-crm/shared';
import { BOARD_PAGE_SIZE } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../../api/context.js';
import { useToast } from '../../../components/shared/Toast.js';
import { useT } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { useResource } from '../../../lib/useResource.js';
import { BOARD_ERRORS } from '../../crm/useBoard.js';
import { queryKey } from './leadsQuery.js';

/**
 * The cards of one view, a page at a time: the first page replaces everything when the view
 * changes, later pages are added as the list is scrolled near its end. Bulk moves and removals
 * are sent to the server and then the first page and the folder counts are read again.
 */
export function useLeadCards(
  pipeline: CrmPipeline,
  filters: CardsQuery,
  facetsFilters: Pick<CardsQuery, 'q' | 'minScore' | 'foundDays' | 'regionId'>,
  options: { enabled?: boolean; refreshKey?: number } = {},
) {
  const api = useApi();
  const t = useT();
  const toast = useToast();
  const enabled = options.enabled ?? true;
  const refresh = options.refreshKey ?? 0;
  const key = `${pipeline}|${queryKey(filters)}|${refresh}`;
  const facetsKey = `${pipeline}|${queryKey(facetsFilters)}|${refresh}`;

  const first = useResource<CrmCardPage>(
    (signal) => api.crm.cards(pipeline, { ...filters, limit: BOARD_PAGE_SIZE }, signal),
    { deps: [key], enabled },
  );
  const facets = useResource<CrmFacets>(
    (signal) => api.crm.facets(pipeline, facetsFilters, signal),
    { deps: [facetsKey], enabled },
  );

  const [more, setMore] = useState<CrmCard[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // A fresh first page replaces anything loaded beyond it.
  useEffect(() => {
    setMore([]);
    setNext(first.data?.nextCursor ?? null);
  }, [first.data]);

  const loadMore = useCallback(async () => {
    if (next === null || busy.current) return;
    busy.current = true;
    setLoadingMore(true);
    const asked = keyRef.current;
    try {
      const page = await api.crm.cards(pipeline, {
        ...filtersRef.current,
        cursor: next,
        limit: BOARD_PAGE_SIZE,
      });
      if (keyRef.current === asked) {
        setMore((current) => {
          const have = new Set(current.map((c) => c.id));
          return [...current, ...page.cards.filter((c) => !have.has(c.id))];
        });
        setNext(page.nextCursor);
      }
    } catch (err) {
      toast.show(
        t('crm.toast.loadFailed', { reason: describeError(t, err, BOARD_ERRORS) }),
        'error',
      );
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [api, next, pipeline, t, toast]);

  const firstCards = first.data?.cards ?? [];
  const seen = new Set(firstCards.map((c) => c.id));
  const cards = [...firstCards, ...more.filter((c) => !seen.has(c.id))];

  const { reload: reloadFirst } = first;
  const { reload: reloadFacets } = facets;
  const reload = useCallback(() => {
    reloadFirst();
    reloadFacets();
  }, [reloadFirst, reloadFacets]);

  /** Runs one change per card, a few at a time (each is its own request), then reads again. */
  const each = useCallback(
    async (
      chosen: readonly CrmCard[],
      change: (card: CrmCard) => Promise<unknown>,
      done: (count: number) => string,
    ) => {
      let ok = 0;
      for (let i = 0; i < chosen.length; i += 4) {
        const results = await Promise.allSettled(chosen.slice(i, i + 4).map(change));
        ok += results.filter((r) => r.status === 'fulfilled').length;
      }
      if (ok > 0) toast.show(done(ok));
      if (ok < chosen.length) {
        toast.show(t('crm.bulk.failed', { count: chosen.length - ok }), 'error');
      }
      reload();
    },
    [reload, t, toast],
  );

  return {
    cards,
    total: first.data?.total ?? 0,
    loading: first.loading && !first.data,
    error: first.data ? null : first.error,
    hasMore: next !== null,
    loadingMore,
    loadMore,
    reload,
    facets: facets.data ?? undefined,
    moveMany: (chosen: readonly CrmCard[], to: string) =>
      each(
        chosen,
        (c) => api.crm.move(c.id, to),
        (count) => t('crm.bulk.moved', { count, stage: t(`boardStage.${to}` as never) }),
      ),
    removeMany: (chosen: readonly CrmCard[]) =>
      each(
        chosen,
        (c) => api.crm.remove(c.id),
        (count) => t('crm.bulk.removed', { count }),
      ),
  };
}

export type LeadCards = ReturnType<typeof useLeadCards>;

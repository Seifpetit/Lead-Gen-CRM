import {
  MAX_BULK_CARDS,
  PROTECTED_STAGES,
  type BoardStageKey,
  type CardsQuery,
  type CrmCard,
  type CrmPipeline,
} from '@lead-gen-crm/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../../api/context.js';
import { useToast } from '../../../components/shared/Toast.js';
import { useT } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { queryKey } from './leadsQuery.js';

/** The ids in slices the server accepts in one request. */
function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += MAX_BULK_CARDS)
    out.push(items.slice(i, i + MAX_BULK_CARDS));
  return out;
}

export const isProtectedStage = (stage: BoardStageKey) => PROTECTED_STAGES.includes(stage);

/**
 * Select mode of the lead cards: which cards are ticked (with the column each is in, so the
 * confirm step can say how many are protected), "select all" across the filters, and the removal
 * to Noise with its Undo. Nothing here deletes: the server moves cards to Noise.
 */
export function useLeadSelection({
  pipeline,
  filters,
  onChanged,
}: {
  pipeline: CrmPipeline;
  filters: CardsQuery;
  /** Called after a removal or an Undo, so the list, folder counts and charts read again. */
  onChanged: () => void;
}) {
  const api = useApi();
  const t = useT();
  const toast = useToast();
  const [active, setActive] = useState(false);
  const [picked, setPicked] = useState<ReadonlyMap<string, BoardStageKey>>(new Map());
  const [busy, setBusy] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  // Ticked cards belong to the view they were ticked in: another filter starts again.
  const viewKey = `${pipeline}|${queryKey(filters)}`;
  useEffect(() => setPicked(new Map()), [viewKey]);

  const start = useCallback(() => setActive(true), []);
  const clear = useCallback(() => setPicked(new Map()), []);
  const cancel = useCallback(() => {
    setActive(false);
    setPicked(new Map());
  }, []);

  const toggle = useCallback((card: Pick<CrmCard, 'id' | 'stage'>) => {
    setPicked((current) => {
      const next = new Map(current);
      if (!next.delete(card.id)) next.set(card.id, card.stage);
      return next;
    });
  }, []);

  /** Every card matching the filters, not only the ones on screen. */
  const selectAll = useCallback(async () => {
    setBusy(true);
    try {
      const all = await api.crm.selection(pipeline, filters);
      setPicked(new Map(all.cards.map((c) => [c.id, c.stage])));
      if (all.truncated) {
        toast.show(t('select.truncated', { count: all.cards.length, total: all.total }), 'warning');
      }
    } catch (err) {
      toast.show(t('select.failed', { reason: describeError(t, err) }), 'error');
    } finally {
      setBusy(false);
    }
  }, [api, filters, pipeline, t, toast]);

  const movable = useMemo(
    () => [...picked].filter(([, stage]) => !isProtectedStage(stage)).map(([id]) => id),
    [picked],
  );
  const protectedCount = picked.size - movable.length;

  const undo = useCallback(
    async (ids: readonly string[]) => {
      try {
        let restored = 0;
        for (const slice of chunks(ids)) restored += (await api.crm.restoreMany(slice)).restored;
        toast.show(
          t(restored === 1 ? 'select.restored.one' : 'select.restored', { count: restored }),
        );
      } catch (err) {
        toast.show(t('select.undoFailed', { reason: describeError(t, err) }), 'error');
      } finally {
        changed.current();
      }
    },
    [api, t, toast],
  );

  /** Moves the ticked cards that are not protected to Noise: one request per 500, in order. */
  const remove = useCallback(async () => {
    setBusy(true);
    const moved: string[] = [];
    let kept = protectedCount;
    try {
      for (const slice of chunks(movable)) {
        const result = await api.crm.removeMany(slice);
        moved.push(...result.moved);
        // Cards that moved into a protected column since the list was read stay put too.
        kept += result.protected;
      }
      const base = t(moved.length === 1 ? 'select.moved.one' : 'select.moved', {
        count: moved.length,
      });
      toast.show(
        kept > 0 ? `${base} ${t('select.moved.kept', { count: kept })}` : base,
        'success',
        moved.length > 0
          ? { action: { label: t('select.undo'), onClick: () => void undo(moved) } }
          : {},
      );
    } catch (err) {
      toast.show(t('select.removeFailed', { reason: describeError(t, err) }), 'error', {
        ...(moved.length > 0
          ? { action: { label: t('select.undo'), onClick: () => void undo(moved) } }
          : {}),
      });
    } finally {
      setBusy(false);
      cancel();
      changed.current();
    }
  }, [api, cancel, movable, protectedCount, t, toast, undo]);

  return {
    active,
    picked,
    count: picked.size,
    movableCount: movable.length,
    protectedCount,
    busy,
    start,
    cancel,
    clear,
    toggle,
    selectAll,
    remove,
  };
}

export type LeadSelection = ReturnType<typeof useLeadSelection>;

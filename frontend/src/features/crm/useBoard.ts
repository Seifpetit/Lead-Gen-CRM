import type {
  BoardFilters,
  BoardStageKey,
  CrmBoard,
  CrmBoardStage,
  CrmCard,
  CrmCardPage,
  CrmPipeline,
} from '@lead-gen-crm/shared';
import { BOARD_PAGE_SIZE } from '@lead-gen-crm/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/context.js';
import { useToast } from '../../components/shared/Toast.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { useResource } from '../../lib/useResource.js';
import { daysLeft } from './boardTime.js';

export const BOARD_ERRORS: Partial<Record<string, StringKey>> = {
  decision_maker_required: 'crm.error.decision_maker_required',
  suppressed: 'crm.error.suppressed',
  in_noise: 'crm.error.in_noise',
  invalid_decision_maker: 'crm.error.invalid_decision_maker',
  opted_out_is_final: 'lead.error.opted_out_is_final',
};

export const cardName = (card: CrmCard) => card.person?.fullName ?? card.company.name;

export type BoardView = 'board' | 'table';

/** A column as the board holds it: the server's page so far, and whether the next is on its way. */
export interface ColumnData extends CrmBoardStage {
  loadingMore: boolean;
}

export interface BoardData {
  pipeline: CrmPipeline;
  stages: ColumnData[];
  sectors: CrmBoard['sectors'];
}

const toBoardData = (board: CrmBoard): BoardData => ({
  ...board,
  stages: board.stages.map((s) => ({ ...s, loadingMore: false })),
});

/** Where a card is on the board: its column and its place in it. */
function locate(
  board: BoardData | null,
  id: string,
): { stage: BoardStageKey; index: number } | null {
  for (const stage of board?.stages ?? []) {
    const index = stage.cards.findIndex((c) => c.id === id);
    if (index >= 0) return { stage: stage.key, index };
  }
  return null;
}

/**
 * Puts a card where its stage says: replaced in place when it is already in that column,
 * otherwise taken out of the column it was in and inserted at `index` (the top by default).
 * Column totals follow.
 */
function placeCard(board: BoardData, card: CrmCard, index?: number): BoardData {
  return {
    ...board,
    stages: board.stages.map((stage) => {
      const had = stage.cards.findIndex((c) => c.id === card.id);
      if (stage.key === card.stage) {
        const cards = stage.cards.slice();
        if (had >= 0) {
          cards[had] = card;
          return { ...stage, cards };
        }
        cards.splice(Math.min(Math.max(index ?? 0, 0), cards.length), 0, card);
        return { ...stage, cards, total: stage.total + 1 };
      }
      if (had >= 0) {
        return {
          ...stage,
          cards: stage.cards.filter((c) => c.id !== card.id),
          total: Math.max(0, stage.total - 1),
        };
      }
      return stage;
    }),
  };
}

/** Appends a page to a column; a card already in it (moved there meanwhile) is not repeated. */
function appendPage(board: BoardData, stageKey: string, page: CrmCardPage): BoardData {
  return {
    ...board,
    stages: board.stages.map((stage) => {
      if (stage.key !== stageKey) return stage;
      const have = new Set(stage.cards.map((c) => c.id));
      return {
        ...stage,
        cards: [...stage.cards, ...page.cards.filter((c) => !have.has(c.id))],
        nextCursor: page.nextCursor,
        loadingMore: false,
      };
    }),
  };
}

export const filterKey = (f: BoardFilters) =>
  JSON.stringify([f.q ?? '', f.sector ?? '', f.minScore ?? 0, f.sort ?? '', f.dir ?? '']);

export interface MoveOptions {
  /** Where in the target column a dropped card lands. */
  index?: number | undefined;
  /** No toast: a bulk action says it once for all. */
  quiet?: boolean | undefined;
}

/**
 * One board (or its table) with optimistic changes: a move, removal or restore shows at once, the
 * server's copy replaces it when the call succeeds, and when the server refuses the card goes back
 * to where it was and a toast says why. `hold` shows a card in a column without asking the server,
 * for the moment a form is open and the move is not final until it is saved.
 *
 * Every column loads BOARD_PAGE_SIZE cards and the next page when it is scrolled near its end.
 * Search, sector, minimum score and sort are sent to the server, so totals and pages always
 * describe the filtered set.
 */
export function useBoard(pipeline: CrmPipeline, filters: BoardFilters, view: BoardView = 'board') {
  const api = useApi();
  const toast = useToast();
  const t = useT();
  const key = `${pipeline}|${filterKey(filters)}`;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const keyRef = useRef(key);
  keyRef.current = key;

  // In the table view the board is fetched with one card per column: only its totals, stage list
  // and the sector choices are used.
  const boardResource = useResource<BoardData>(
    async (signal) =>
      toBoardData(
        await api.crm.board(
          pipeline,
          { ...filters, limit: view === 'board' ? BOARD_PAGE_SIZE : 1 },
          signal,
        ),
      ),
    { deps: [key, view] },
  );
  const tableResource = useResource<CrmCardPage>(
    (signal) => api.crm.cards(pipeline, { ...filters, limit: BOARD_PAGE_SIZE }, signal),
    { deps: [key], enabled: view === 'table' },
  );
  const setBoard = boardResource.setData;
  const setTable = tableResource.setData;
  const board = boardResource.data;
  const table = tableResource.data;

  // What the optimistic changes need to find a card again, without waiting for a render.
  const boardRef = useRef<BoardData | null>(null);
  boardRef.current = board;
  const [tableLoading, setTableLoading] = useState(false);
  const tableLoadingRef = useRef(false);
  const loadingColumns = useRef(new Set<string>());

  const stageName = useCallback((k: BoardStageKey) => t(`boardStage.${k}`), [t]);

  /** The next page of one column, de-duplicated; ignored if the filters changed meanwhile. */
  const loadMore = useCallback(
    async (stageKey: string) => {
      const column = boardRef.current?.stages.find((s) => s.key === stageKey);
      if (!column?.nextCursor || loadingColumns.current.has(stageKey)) return;
      loadingColumns.current.add(stageKey);
      const asked = keyRef.current;
      setBoard((b) =>
        b
          ? {
              ...b,
              stages: b.stages.map((s) => (s.key === stageKey ? { ...s, loadingMore: true } : s)),
            }
          : b,
      );
      try {
        const page = await api.crm.cards(pipeline, {
          ...filtersRef.current,
          stage: stageKey,
          cursor: column.nextCursor,
          limit: BOARD_PAGE_SIZE,
        });
        if (keyRef.current === asked) setBoard((b) => (b ? appendPage(b, stageKey, page) : b));
      } catch (err) {
        setBoard((b) =>
          b
            ? {
                ...b,
                stages: b.stages.map((s) =>
                  s.key === stageKey ? { ...s, loadingMore: false } : s,
                ),
              }
            : b,
        );
        toast.show(
          t('crm.toast.loadFailed', { reason: describeError(t, err, BOARD_ERRORS) }),
          'error',
        );
      } finally {
        loadingColumns.current.delete(stageKey);
      }
    },
    [api, pipeline, setBoard, t, toast],
  );

  /** The next page of the table. */
  const loadMoreRows = useCallback(async () => {
    const cursor = table?.nextCursor;
    if (!cursor || tableLoadingRef.current) return;
    tableLoadingRef.current = true;
    setTableLoading(true);
    const asked = keyRef.current;
    try {
      const page = await api.crm.cards(pipeline, {
        ...filtersRef.current,
        cursor,
        limit: BOARD_PAGE_SIZE,
      });
      if (keyRef.current === asked) {
        setTable((current) => {
          if (!current) return current;
          const have = new Set(current.cards.map((c) => c.id));
          return {
            ...current,
            cards: [...current.cards, ...page.cards.filter((c) => !have.has(c.id))],
            nextCursor: page.nextCursor,
          };
        });
      }
    } catch (err) {
      toast.show(
        t('crm.toast.loadFailed', { reason: describeError(t, err, BOARD_ERRORS) }),
        'error',
      );
    } finally {
      tableLoadingRef.current = false;
      setTableLoading(false);
    }
  }, [api, pipeline, setTable, t, table?.nextCursor, toast]);

  /** Shows a card in the column of its stage (and in place in the table). */
  const place = useCallback(
    (card: CrmCard, index?: number) => {
      setBoard((b) => (b ? placeCard(b, card, index) : b));
      setTable((current) =>
        current
          ? {
              ...current,
              cards: current.cards.map((c) => (c.id === card.id ? card : c)),
            }
          : current,
      );
    },
    [setBoard, setTable],
  );

  const held = useRef(new Map<string, { card: CrmCard; index: number }>());
  const hold = useCallback(
    (card: CrmCard, stage: BoardStageKey, index?: number) => {
      const at = locate(boardRef.current, card.id);
      held.current.set(card.id, { card, index: at?.index ?? 0 });
      place({ ...card, stage }, index);
    },
    [place],
  );
  /** The form was cancelled: the card goes back where it was. */
  const release = useCallback(
    (card: CrmCard) => {
      const origin = held.current.get(card.id);
      held.current.delete(card.id);
      if (origin) place(origin.card, origin.index);
    },
    [place],
  );
  /** The form was saved: the server's copy replaces the held card. */
  const replace = useCallback(
    (card: CrmCard) => {
      held.current.delete(card.id);
      place(card);
    },
    [place],
  );

  const fail = useCallback(
    (k: StringKey, card: CrmCard, err: unknown) =>
      toast.show(
        t(k, { name: cardName(card), reason: describeError(t, err, BOARD_ERRORS) }),
        'error',
      ),
    [t, toast],
  );

  const remove = useCallback(
    async (card: CrmCard, options: MoveOptions = {}): Promise<boolean> => {
      if (card.stage === 'noise') return true;
      const now = new Date().toISOString();
      const index = locate(boardRef.current, card.id)?.index;
      place({
        ...card,
        stage: 'noise',
        stageEnteredAt: now,
        noiseAt: now,
        purgeAt: null,
        removedFrom: card.stage,
      });
      try {
        const saved = await api.crm.remove(card.id);
        place(saved);
        if (!options.quiet) {
          const left = daysLeft(saved);
          toast.show(
            t('crm.toast.removed', {
              name: cardName(card),
              left: left === null ? '' : ` ${t(leftKey(left), { count: left })}.`,
            }),
          );
        }
        return true;
      } catch (err) {
        place(card, index);
        if (!options.quiet) fail('crm.toast.removeFailed', card, err);
        return false;
      }
    },
    [api, fail, place, t, toast],
  );

  /** Moves a card; into Noise is a removal and out of Noise a restore, as on the server. */
  const move = useCallback(
    async (card: CrmCard, to: BoardStageKey, reason?: string, options: MoveOptions = {}) => {
      if (card.stage === to) return true;
      if (to === 'noise') return remove(card, options);
      const wasNoise = card.stage === 'noise';
      const previous = locate(boardRef.current, card.id)?.index;
      place(
        {
          ...card,
          stage: to,
          stageEnteredAt: new Date().toISOString(),
          noiseAt: null,
          purgeAt: null,
          removedFrom: null,
        },
        options.index,
      );
      try {
        const saved = await api.crm.move(card.id, to, reason);
        place(saved);
        if (!options.quiet) {
          toast.show(
            t(wasNoise ? 'crm.toast.restored' : 'crm.toast.moved', {
              name: cardName(card),
              stage: stageName(saved.stage),
            }),
          );
        }
        return true;
      } catch (err) {
        place(card, previous);
        if (!options.quiet)
          fail(wasNoise ? 'crm.toast.restoreFailed' : 'crm.toast.moveFailed', card, err);
        return false;
      }
    },
    [api, fail, place, remove, stageName, t, toast],
  );

  const restore = useCallback(
    async (card: CrmCard) => {
      if (card.stage !== 'noise') return;
      const to = card.removedFrom ?? (pipeline === 'companies' ? 'found' : 'new');
      const previous = locate(boardRef.current, card.id)?.index;
      place({
        ...card,
        stage: to,
        stageEnteredAt: new Date().toISOString(),
        noiseAt: null,
        purgeAt: null,
        removedFrom: null,
      });
      try {
        const saved = await api.crm.restore(card.id);
        place(saved);
        toast.show(
          t('crm.toast.restored', { name: cardName(card), stage: stageName(saved.stage) }),
        );
      } catch (err) {
        place(card, previous);
        fail('crm.toast.restoreFailed', card, err);
      }
    },
    [api, fail, pipeline, place, stageName, t, toast],
  );

  const stages = useMemo(() => board?.stages ?? [], [board]);
  const loaded = view === 'board' ? board !== null : table !== null && board !== null;
  return {
    /** The board's columns, each with the cards loaded so far. */
    stages,
    sectors: board?.sectors ?? [],
    /** Table rows loaded so far, and how many match the filters in all. */
    rows: table?.cards ?? [],
    rowsTotal: table?.total ?? 0,
    rowsNext: table?.nextCursor ?? null,
    rowsLoading: tableLoading,
    /** Every card matching the filters, from the column totals. */
    total: stages.reduce((n, s) => n + s.total, 0),
    loaded,
    loading: boardResource.loading || (view === 'table' && tableResource.loading),
    error: boardResource.error ?? tableResource.error,
    reload: () => {
      boardResource.reload();
      tableResource.reload();
    },
    loadMore,
    loadMoreRows,
    move,
    remove,
    restore,
    hold,
    release,
    replace,
    find: (id: string) => locate(board, id),
  };
}

export type Board = ReturnType<typeof useBoard>;

export const leftKey = (days: number): StringKey =>
  days === 0 ? 'crm.card.left.zero' : days === 1 ? 'crm.card.left.one' : 'crm.card.left.many';

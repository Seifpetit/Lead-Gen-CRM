import type {
  BoardSort,
  BoardStage,
  BoardStageKey,
  CrmCard,
  CrmPipeline,
} from '@lead-gen-crm/shared';
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useToast } from '../../components/shared/Toast.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { AddDecisionMakerModal } from './AddDecisionMakerModal.js';
import type { CardActions } from './BoardCard.js';
import { BoardTable } from './BoardTable.js';
import { BoardToolbar } from './BoardToolbar.js';
import { CardDetailsModal } from './CardDetailsModal.js';
import { KanbanBoard } from './KanbanBoard.js';
import { OptOutDialog } from './OptOutDialog.js';
import {
  DEFAULT_DIRECTION,
  effectiveDirection,
  effectiveSort,
  readQuery,
  writeQuery,
  type BoardQuery,
} from './boardView.js';
import { cardName, useBoard } from './useBoard.js';
import { ExportButton } from '../outreach/ExportButton.js';

/**
 * One CRM board (Companies or People), as columns or as a table. A move that needs more than a
 * drop asks first: Decision-maker identified opens the form that names the decision-maker, Opted
 * out asks for the reason. Search, filters, sort and the view are kept in the address.
 */
export function BoardPage({ pipeline }: { pipeline: CrmPipeline }) {
  const t = useT();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readQuery(params), [params]);
  const filters = useMemo(
    () => ({
      q: query.q,
      sector: query.sector,
      minScore: query.minScore,
      sort: query.sort,
      dir: query.dir,
    }),
    [query.q, query.sector, query.minScore, query.sort, query.dir],
  );
  const board = useBoard(pipeline, filters, query.view);
  const { move, remove, restore, hold, release, replace } = board;
  const [naming, setNaming] = useState<CrmCard | null>(null);
  const [optingOut, setOptingOut] = useState<CrmCard | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const change = useCallback(
    (patch: Partial<BoardQuery>) =>
      setParams((current) => writeQuery({ ...readQuery(current), ...patch }), { replace: true }),
    [setParams],
  );

  const request = useCallback(
    (card: CrmCard, to: BoardStageKey, index?: number) => {
      if (card.stage === to) return;
      if (pipeline === 'companies' && to === 'decision_maker_identified') {
        // Shown in the column while the form is open; cancelling puts it back.
        hold(card, to, index);
        setNaming(card);
      } else if (pipeline === 'people' && to === 'opted_out') {
        setOptingOut(card);
      } else {
        void move(card, to, undefined, { index });
      }
    },
    [hold, move, pipeline],
  );

  const targets = useCallback(
    (card: CrmCard): BoardStage[] =>
      board.stages.filter((s) => {
        if (s.key === card.stage || s.key === 'noise') return false;
        if (card.stage === 'noise') {
          return s.key !== 'decision_maker_identified' && s.key !== 'opted_out';
        }
        return true;
      }),
    [board.stages],
  );
  const sectorNames = useMemo(
    () => new Map(board.sectors.map((s) => [s.id, s.name])),
    [board.sectors],
  );
  const actions: CardActions = useMemo(
    () => ({
      targets,
      onMove: (card, to) => request(card, to),
      onRemove: (c) => void remove(c),
      onRestore: (c) => void restore(c),
      onOpen: (c) => setOpenId(c.id),
      sectorName: (sector) => (sector ? (sectorNames.get(sector) ?? sector) : null),
    }),
    [targets, request, remove, restore, sectorNames],
  );

  const sortBy = (sort: BoardSort) => {
    // The same column again flips the order; a new column starts in its own natural order.
    if (effectiveSort(query) === sort) {
      const flipped = effectiveDirection(query) === 'asc' ? 'desc' : 'asc';
      change({ sort, dir: flipped === DEFAULT_DIRECTION[sort] ? undefined : flipped });
    } else {
      change({ sort, dir: undefined });
    }
  };

  const bulk = async (
    cards: CrmCard[],
    action: (card: CrmCard) => Promise<boolean>,
    done: 'crm.bulk.moved' | 'crm.bulk.removed',
    vars: Record<string, string>,
  ) => {
    // A few at a time: each is its own request and the server rate-limits.
    const results: boolean[] = [];
    for (let i = 0; i < cards.length; i += 4) {
      results.push(...(await Promise.all(cards.slice(i, i + 4).map(action))));
    }
    const ok = results.filter(Boolean).length;
    if (ok > 0) toast.show(t(done, { count: ok, ...vars }));
    if (ok < cards.length) toast.show(t('crm.bulk.failed', { count: cards.length - ok }), 'error');
  };

  const all = useMemo(
    () => (query.view === 'table' ? board.rows : board.stages.flatMap((s) => s.cards)),
    [query.view, board.rows, board.stages],
  );
  const opened = openId ? (all.find((c) => c.id === openId) ?? null) : null;

  const filtered = Boolean(query.q || query.sector || query.minScore);
  const label = t(pipeline === 'companies' ? 'crm.board.companies' : 'crm.board.people');
  const loadingFirst = !board.loaded && board.loading;
  return (
    <div className="board-page">
      <BoardToolbar
        pipeline={pipeline}
        query={query}
        sectors={board.sectors}
        total={board.total}
        busy={board.loading}
        onChange={change}
        exportButton={
          query.view === 'table' ? (
            <ExportButton source={{ kind: 'cards', pipeline, filters }} count={board.rowsTotal} />
          ) : undefined
        }
      />
      {loadingFirst ? (
        <LoadingState />
      ) : !board.loaded ? (
        <ErrorState error={board.error} onRetry={board.reload} />
      ) : (
        <>
          {board.total === 0 &&
            (filtered ? (
              <p className="muted board-note">
                {t('crm.noMatches')}{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => change({ q: undefined, sector: undefined, minScore: undefined })}
                >
                  {t('crm.filter.clear')}
                </button>
              </p>
            ) : pipeline === 'companies' ? (
              <EmptyState title={t('crm.companies.empty.title')}>
                {t('crm.companies.empty.body')} <Link to="/leadgen">{t('crm.empty.link')}</Link>
              </EmptyState>
            ) : (
              <EmptyState title={t('crm.people.empty.title')}>
                {t('crm.people.empty.body')}{' '}
                <Link to="/crm/companies">{t('crm.people.empty.link')}</Link>
              </EmptyState>
            ))}
          {query.view === 'board' ? (
            <KanbanBoard
              label={label}
              stages={board.stages}
              actions={actions}
              onDrop={request}
              onLoadMore={(stage) => void board.loadMore(stage)}
            />
          ) : (
            <BoardTable
              pipeline={pipeline}
              rows={board.rows}
              total={board.rowsTotal}
              hasMore={board.rowsNext !== null}
              loadingMore={board.rowsLoading}
              query={query}
              actions={actions}
              stages={board.stages}
              onSort={sortBy}
              onLoadMore={() => void board.loadMoreRows()}
              onBulkMove={(cards, to) =>
                bulk(cards, (c) => move(c, to, undefined, { quiet: true }), 'crm.bulk.moved', {
                  stage: t(`boardStage.${to}`),
                })
              }
              onBulkRemove={(cards) =>
                bulk(cards, (c) => remove(c, { quiet: true }), 'crm.bulk.removed', {})
              }
            />
          )}
        </>
      )}
      {opened && (
        <CardDetailsModal card={opened} actions={actions} onClose={() => setOpenId(null)} />
      )}
      {naming && (
        <AddDecisionMakerModal
          card={naming}
          onCancel={() => {
            release(naming);
            setNaming(null);
          }}
          onSaved={(result) => {
            replace(result.company);
            setNaming(null);
            toast.show(
              t('crm.toast.saved', {
                person: result.person.person?.fullName ?? '',
                company: result.company.company.name,
              }),
            );
          }}
        />
      )}
      {optingOut && (
        <OptOutDialog
          busy={false}
          error={null}
          onCancel={() => setOptingOut(null)}
          onConfirm={(reason) => {
            const card = optingOut;
            setOptingOut(null);
            void move(card, 'opted_out', reason);
          }}
        />
      )}
    </div>
  );
}

export { cardName };

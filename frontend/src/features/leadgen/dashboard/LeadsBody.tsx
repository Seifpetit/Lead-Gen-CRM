import type { BoardSort, BoardStage, CrmCard } from '@lead-gen-crm/shared';
import { ArrowRightLeft, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Popover } from '../../../components/shared/Popover.js';
import { ErrorState, LoadingState } from '../../../components/states.js';
import { useT } from '../../../i18n/index.js';
import type { CardActions } from '../../crm/BoardCard.js';
import { BoardTable } from '../../crm/BoardTable.js';
import { DEFAULT_DIRECTION, effectiveDirection, effectiveSort } from '../../crm/boardView.js';
import type { LeadsView } from './LeadsControls.js';
import { LeadGrid } from './LeadGrid.js';
import { cardPath, type TileParts } from './LeadTile.js';
import { hasFilters, type LeadsQuery } from './leadsQuery.js';
import type { LeadCards } from './useLeadCards.js';

/** The stages a bulk move offers: the others need a form or a reason, so they are one at a time. */
const NEEDS_FORM = new Set(['noise', 'decision_maker_identified', 'opted_out']);

/**
 * The leads of the current view as cards or as the CRM table. With `selectable`, cards get
 * checkboxes and a bulk bar (Move to, Remove) appears when some are ticked.
 */
export function LeadsBody({
  data,
  query,
  onQuery,
  view,
  parts,
  selectable = false,
  sectorNames,
}: {
  data: LeadCards;
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
  view: LeadsView;
  parts: TileParts;
  selectable?: boolean;
  sectorNames: ReadonlyMap<string, string>;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());

  // Only cards that are still listed stay ticked.
  const ids = data.cards.map((c) => c.id).join(',');
  useEffect(() => {
    setChosen((current) => {
      const present = new Set(data.cards.map((c) => c.id));
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [ids]);

  const stages: BoardStage[] = useMemo(
    () =>
      (data.facets?.stages ?? []).map((s) => ({
        key: s.key,
        name: t(`boardStage.${s.key}`),
        collapsedByDefault: false,
      })),
    [data.facets, t],
  );
  const picked = data.cards.filter((c) => chosen.has(c.id));
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const clear = () => setChosen(new Set());

  const actions: CardActions = {
    targets: () => [],
    onMove: () => undefined,
    onRemove: () => undefined,
    onRestore: () => undefined,
    onOpen: (card) => {
      const path = cardPath(card);
      if (path) void navigate(path);
    },
    sectorName: (sector) => (sector ? (sectorNames.get(sector) ?? sector) : null),
  };
  const sortBy = (sort: BoardSort) => {
    // The same column again flips the order; a new column starts in its own natural order.
    const current = { sort: query.sort, dir: query.dir };
    if (effectiveSort(current) === sort) {
      const flipped = effectiveDirection(current) === 'asc' ? 'desc' : 'asc';
      onQuery({ sort, dir: flipped === DEFAULT_DIRECTION[sort] ? undefined : flipped });
    } else {
      onQuery({ sort, dir: undefined });
    }
  };

  if (data.loading) return <LoadingState />;
  if (data.error !== null) return <ErrorState error={data.error} onRetry={data.reload} />;

  const filtered = hasFilters(query);
  const empty = t(filtered ? 'leads.none.filtered' : 'leads.none.view');
  const label = t(query.pipeline === 'companies' ? 'leads.list.companies' : 'leads.list.people');

  if (view === 'table') {
    return (
      <div className="leads-table">
        <BoardTable
          pipeline={query.pipeline}
          rows={data.cards as CrmCard[]}
          total={data.total}
          hasMore={data.hasMore}
          loadingMore={data.loadingMore}
          query={{ view: 'board', sort: query.sort, dir: query.dir }}
          actions={actions}
          stages={stages}
          onSort={sortBy}
          onLoadMore={() => void data.loadMore()}
          onBulkMove={(cards, to) => data.moveMany(cards, to)}
          onBulkRemove={(cards) => data.removeMany(cards)}
        />
      </div>
    );
  }

  return (
    <>
      {selectable && picked.length > 0 && (
        <div className="bulk-bar" role="status">
          <span>{t('crm.bulk.selected', { count: picked.length })}</span>
          <Popover
            label={t('crm.bulk.moveTo')}
            showLabel
            align="left"
            portal
            icon={<ArrowRightLeft size={14} aria-hidden="true" />}
          >
            {(close) => (
              <ul className="menu" aria-label={t('crm.bulk.moveTo')}>
                {stages
                  .filter((s) => !NEEDS_FORM.has(s.key))
                  .map((s) => (
                    <li key={s.key}>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          void data.moveMany(picked, s.key).then(clear);
                        }}
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </Popover>
          <button
            type="button"
            className="button"
            onClick={() => void data.removeMany(picked).then(clear)}
          >
            <Trash2 size={14} aria-hidden="true" /> {t('crm.bulk.remove')}
          </button>
          <button type="button" className="link-button" onClick={clear}>
            {t('crm.bulk.clear')}
          </button>
        </div>
      )}
      <LeadGrid
        cards={data.cards}
        parts={parts}
        hasMore={data.hasMore}
        loadingMore={data.loadingMore}
        onLoadMore={() => void data.loadMore()}
        empty={empty}
        label={label}
        resetKey={`${query.pipeline}|${query.sort}|${query.dir ?? ''}`}
        {...(selectable ? { selected: chosen, onToggle: toggle } : {})}
      />
    </>
  );
}

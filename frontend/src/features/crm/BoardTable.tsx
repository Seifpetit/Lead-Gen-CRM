import type {
  BoardSort,
  BoardStage,
  BoardStageKey,
  CrmCard,
  CrmPipeline,
} from '@lead-gen-crm/shared';
import { ArrowDown, ArrowRightLeft, ArrowUp, Globe, Mail, Phone, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Popover } from '../../components/shared/Popover.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { safeHref } from '../../lib/format.js';
import type { CardActions } from './BoardCard.js';
import { CompanyThumb, PersonAvatar } from './BoardCard.js';
import { daysInStage } from './boardTime.js';
import { FALLBACK_VIEW_HEIGHT, OVERSCAN } from './boardLayout.js';
import type { BoardQuery } from './boardView.js';
import { effectiveDirection, effectiveSort } from './boardView.js';
import { cardName } from './useBoard.js';
import { ExternalLink } from '../../components/shared/ExternalLink.js';
import { WhatsAppButton } from '../outreach/WhatsAppButton.js';
import { targetOfCard } from '../outreach/whatsapp.js';

const ROW_HEIGHT = 48;
const LOAD_ROWS_AHEAD = 12;

/** A column the table can sort by, if the server can. */
const SORTABLE: Partial<Record<string, BoardSort>> = {
  name: 'name',
  sector: 'sector',
  score: 'score',
  inStage: 'days',
};

/**
 * The same filtered cards as the board, one per row: sortable columns, row checkboxes and bulk
 * actions. Only the rows in view are drawn and the next page is requested near the end, like a
 * board column.
 */
export function BoardTable({
  pipeline,
  rows,
  total,
  hasMore,
  loadingMore,
  query,
  actions,
  stages,
  onSort,
  onLoadMore,
  onBulkMove,
  onBulkRemove,
}: {
  pipeline: CrmPipeline;
  rows: CrmCard[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  query: BoardQuery;
  actions: CardActions;
  stages: BoardStage[];
  onSort: (sort: BoardSort) => void;
  onLoadMore: () => void;
  onBulkMove: (cards: CrmCard[], to: BoardStageKey) => Promise<void> | void;
  onBulkRemove: (cards: CrmCard[]) => Promise<void> | void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const viewport = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ first: 0, last: 30 });
  const rowsRef = useRef({ count: rows.length, hasMore, loadingMore });
  rowsRef.current = { count: rows.length, hasMore, loadingMore };

  // A different set of rows (new filters) starts with nothing chosen; moved cards stay chosen.
  const ids = rows.map((r) => r.id).join(',');
  useEffect(() => {
    setChosen((current) => {
      const present = new Set(rows.map((r) => r.id));
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [ids]);

  const measure = useCallback(() => {
    const el = viewport.current;
    const top = el?.scrollTop ?? 0;
    const height = el?.clientHeight || FALLBACK_VIEW_HEIGHT;
    const { count, hasMore: more, loadingMore: busy } = rowsRef.current;
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(count - 1, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
    setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    if (more && !busy && count - (top + height) / ROW_HEIGHT < LOAD_ROWS_AHEAD) onLoadMore();
  }, [onLoadMore]);
  useLayoutEffect(measure, [rows.length, measure]);
  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const sort = effectiveSort(query);
  const direction = effectiveDirection(query);
  const picked = rows.filter((r) => chosen.has(r.id));
  const allChosen = rows.length > 0 && picked.length === rows.length;
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // A form or a reason is needed for these, so they are moved one at a time, from the board.
  const bulkTargets = stages.filter(
    (s) => s.key !== 'noise' && s.key !== 'decision_maker_identified' && s.key !== 'opted_out',
  );

  const columns: { id: string; label: string; sortable: boolean }[] = [
    { id: 'name', label: t('crm.table.name'), sortable: true },
    pipeline === 'companies'
      ? { id: 'sector', label: t('crm.table.sector'), sortable: true }
      : { id: 'role', label: t('crm.table.role'), sortable: false },
    { id: 'score', label: t('crm.table.score'), sortable: true },
    { id: 'stage', label: t('crm.table.stage'), sortable: false },
    { id: 'inStage', label: t('crm.table.inStage'), sortable: true },
    { id: 'contact', label: t('crm.table.contact'), sortable: false },
  ];

  const shown = rows.slice(range.first, range.last + 1);
  return (
    <div className="board-table">
      {picked.length > 0 && (
        <div className="bulk-bar" role="status">
          <span>{t('crm.bulk.selected', { count: picked.length })}</span>
          <Popover
            label={t('crm.bulk.moveTo')}
            showLabel
            align="left"
            icon={<ArrowRightLeft size={14} aria-hidden="true" />}
          >
            {(close) => (
              <ul className="menu" aria-label={t('crm.bulk.moveTo')}>
                {bulkTargets.map((stage) => (
                  <li key={stage.key}>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close();
                        void Promise.resolve(onBulkMove(picked, stage.key)).then(() =>
                          setChosen(new Set()),
                        );
                      }}
                    >
                      {t(`boardStage.${stage.key}`)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>
          <button
            type="button"
            className="button"
            onClick={() =>
              void Promise.resolve(onBulkRemove(picked)).then(() => setChosen(new Set()))
            }
          >
            <Trash2 size={14} aria-hidden="true" /> {t('crm.bulk.remove')}
          </button>
          <button type="button" className="link-button" onClick={() => setChosen(new Set())}>
            {t('crm.bulk.clear')}
          </button>
        </div>
      )}
      <div
        className="grid-table"
        role="table"
        aria-label={t(pipeline === 'companies' ? 'crm.board.companies' : 'crm.board.people')}
        aria-rowcount={total + 1}
      >
        <div className="grid-table-head" role="row">
          <span role="columnheader" className="cell-check">
            <input
              type="checkbox"
              aria-label={t('crm.table.selectAll')}
              checked={allChosen}
              onChange={() => setChosen(allChosen ? new Set() : new Set(rows.map((r) => r.id)))}
            />
          </span>
          {columns.map((c) => {
            const key = SORTABLE[c.id];
            const active = c.sortable && key === sort;
            return (
              <span
                key={c.id}
                role="columnheader"
                aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`cell-${c.id}`}
              >
                {c.sortable && key ? (
                  <button type="button" className="sort-button" onClick={() => onSort(key)}>
                    {c.label}
                    {active &&
                      (direction === 'asc' ? (
                        <ArrowUp size={12} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={12} aria-hidden="true" />
                      ))}
                  </button>
                ) : (
                  c.label
                )}
              </span>
            );
          })}
        </div>
        <div ref={viewport} className="grid-table-body" onScroll={measure}>
          <div className="grid-table-rows" style={{ height: rows.length * ROW_HEIGHT }}>
            {shown.map((card, offset) => {
              const index = range.first + offset;
              return (
                <TableRow
                  key={card.id}
                  card={card}
                  index={index}
                  selected={chosen.has(card.id)}
                  actions={actions}
                  onToggle={() => toggle(card.id)}
                />
              );
            })}
          </div>
          {rows.length === 0 && <p className="muted kanban-empty">{t('crm.table.empty')}</p>}
          {loadingMore && (
            <p className="muted small kanban-more" role="status">
              {t('crm.column.loadingMore')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TableRow({
  card,
  index,
  selected,
  actions,
  onToggle,
}: {
  card: CrmCard;
  index: number;
  selected: boolean;
  actions: CardActions;
  onToggle: () => void;
}) {
  const t = useT();
  const name = cardName(card);
  const { company, person } = card;
  const phone = person ? person.phone : company.phone;
  const email = person ? person.email : company.email;
  const site = !person && company.website ? safeHref(company.website) : null;
  const days = daysInStage(card);
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={`grid-table-row${selected ? ' is-selected' : ''}`}
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a, button, input')) return;
        actions.onOpen(card);
      }}
    >
      <span role="cell" className="cell-check">
        <input
          type="checkbox"
          aria-label={t('crm.table.select', { name })}
          checked={selected}
          onChange={onToggle}
        />
      </span>
      <span role="cell" className="cell-name">
        <span className="table-thumb">
          {person ? <PersonAvatar card={card} /> : <CompanyThumb card={card} />}
        </span>
        <button type="button" className="link-button" onClick={() => actions.onOpen(card)}>
          {name}
        </button>
      </span>
      <span
        role="cell"
        className="cell-sector"
        title={person ? `${person.title ?? ''}` : undefined}
      >
        {person
          ? [person.title, company.name].filter(Boolean).join(' · ')
          : (actions.sectorName(company.sector) ?? '')}
      </span>
      <span role="cell" className="cell-score">
        {card.score ?? ''}
      </span>
      <span role="cell" className="cell-stage">
        <span className="badge">{t(`boardStage.${card.stage}`)}</span>
      </span>
      <span role="cell" className="cell-inStage">
        {t(
          (days === 0
            ? 'crm.card.days.zero'
            : days === 1
              ? 'crm.card.days.one'
              : 'crm.card.days.many') as StringKey,
          { count: days },
        )}
      </span>
      <span role="cell" className="cell-contact">
        {phone && (
          <a
            href={`tel:${phone.replace(/\s+/g, '')}`}
            aria-label={t('crm.card.phone', { value: phone })}
          >
            <Phone size={16} aria-hidden="true" />
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} aria-label={t('crm.card.email', { value: email })}>
            <Mail size={16} aria-hidden="true" />
          </a>
        )}
        <WhatsAppButton target={targetOfCard(card)} />
        {site && (
          <ExternalLink
            kind="website"
            name={company.name}
            href={site}
            aria-label={t('crm.card.website', { name })}
          >
            <Globe size={16} aria-hidden="true" />
          </ExternalLink>
        )}
      </span>
    </div>
  );
}

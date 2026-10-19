import type { BoardSort, CrmBoard, CrmPipeline } from '@lead-gen-crm/shared';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ToggleGroup } from '../../components/shared/ToggleGroup.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { useDebounced } from '../../lib/useDebounced.js';
import {
  DEFAULT_DIRECTION,
  MIN_SCORES,
  effectiveDirection,
  effectiveSort,
  type BoardQuery,
} from './boardView.js';
import type { BoardView } from './useBoard.js';

const SEARCH_DELAY_MS = 300;

/**
 * Above the board: search, sector, minimum score, sort and the Board / Table switch. Nothing is
 * filtered here; every change is handed up and the server does the filtering, so the column totals
 * always describe what matches.
 */
export function BoardToolbar({
  pipeline,
  query,
  sectors,
  total,
  busy,
  onChange,
}: {
  pipeline: CrmPipeline;
  query: BoardQuery;
  sectors: CrmBoard['sectors'];
  /** Cards matching the filters, all columns together. */
  total: number;
  busy: boolean;
  onChange: (patch: Partial<BoardQuery>) => void;
}) {
  const t = useT();
  const searchId = useId();
  const [text, setText] = useState(query.q ?? '');
  const settled = useDebounced(text, SEARCH_DELAY_MS);
  const latest = useRef({ q: query.q, onChange });
  latest.current = { q: query.q, onChange };

  // Typing waits for a pause; the address (back button, shared link) can also set the text.
  const sent = useRef(query.q);
  useEffect(() => {
    const q = settled.trim();
    if (q !== (latest.current.q ?? '')) {
      sent.current = q || undefined;
      latest.current.onChange({ q: q || undefined });
    }
  }, [settled]);
  // A change that did not come from this box (back button, a link) replaces what it shows.
  useEffect(() => {
    if (query.q !== sent.current) {
      sent.current = query.q;
      setText(query.q ?? '');
    }
  }, [query.q]);

  const sort = effectiveSort(query);
  const direction = effectiveDirection(query);
  const sorts: BoardSort[] =
    pipeline === 'companies'
      ? ['newest', 'score', 'days', 'name', 'sector']
      : ['newest', 'score', 'days', 'name'];
  const flipped = direction === 'asc' ? 'desc' : 'asc';
  const views: { value: BoardView; label: string }[] = [
    { value: 'board', label: t('crm.view.board') },
    { value: 'table', label: t('crm.view.table') },
  ];

  return (
    <div className="board-toolbar" role="search" aria-busy={busy}>
      <div className="search">
        <Search size={14} aria-hidden="true" />
        <label htmlFor={searchId} className="visually-hidden">
          {t('crm.search')}
        </label>
        <input
          id={searchId}
          type="search"
          value={text}
          placeholder={t(pipeline === 'companies' ? 'crm.search.companies' : 'crm.search.people')}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {pipeline === 'companies' && (
        <label className="inline-field">
          <span>{t('crm.filter.sector')}</span>
          <select
            value={query.sector ?? ''}
            onChange={(e) => onChange({ sector: e.target.value || undefined })}
          >
            <option value="">{t('crm.filter.sector.any')}</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="inline-field">
        <span>{t('crm.filter.score')}</span>
        <select
          value={String(query.minScore ?? 0)}
          onChange={(e) => onChange({ minScore: Number(e.target.value) || undefined })}
        >
          {MIN_SCORES.map((n) => (
            <option key={n} value={n}>
              {t(`crm.filter.score.${n}` as StringKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-field">
        <span>{t('crm.sort')}</span>
        <select
          value={sort}
          onChange={(e) => onChange({ sort: e.target.value as BoardSort, dir: undefined })}
        >
          {sorts.map((s) => (
            <option key={s} value={s}>
              {t(`crm.sort.${s}` as StringKey)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button button-icon"
        aria-label={t(direction === 'asc' ? 'crm.sort.ascending' : 'crm.sort.descending')}
        title={t(direction === 'asc' ? 'crm.sort.ascending' : 'crm.sort.descending')}
        onClick={() => onChange({ dir: flipped === DEFAULT_DIRECTION[sort] ? undefined : flipped })}
      >
        {direction === 'asc' ? (
          <ArrowUpNarrowWide size={16} aria-hidden="true" />
        ) : (
          <ArrowDownNarrowWide size={16} aria-hidden="true" />
        )}
      </button>
      <p className="board-toolbar-count muted" role="status">
        {t('crm.matches', { count: total })}
      </p>
      <div className="board-toolbar-view">
        <ToggleGroup
          label={t('crm.view.label')}
          options={views}
          value={query.view}
          onChange={(view) => onChange({ view })}
        />
      </div>
    </div>
  );
}

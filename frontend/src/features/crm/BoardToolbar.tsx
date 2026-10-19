import type { BoardSort, CrmBoard, CrmPipeline } from '@lead-gen-crm/shared';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { FilterChips, FilterMenu, type FilterField } from '../../components/shared/FilterMenu.js';
import { ToggleGroup } from '../../components/shared/ToggleGroup.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { useDebounced } from '../../lib/useDebounced.js';
import {
  DEFAULT_DIRECTION,
  effectiveDirection,
  effectiveSort,
  type BoardQuery,
} from './boardView.js';
import type { BoardView } from './useBoard.js';

const SEARCH_DELAY_MS = 300;

/**
 * Above the board: search, a Filters button (sector, minimum score, sort and order, with the
 * active filters as chips underneath) and the Board / Table switch. Nothing is
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
  const views: { value: BoardView; label: string }[] = [
    { value: 'board', label: t('crm.view.board') },
    { value: 'table', label: t('crm.view.table') },
  ];
  const minScore = query.minScore ?? 0;
  const scoreText = (n: number) =>
    n === 0 ? t('filters.score.any') : t('filters.score.value', { score: n });
  const sectorName = sectors.find((s) => s.id === query.sector)?.name ?? query.sector;

  const fields: FilterField[] = [];
  if (pipeline === 'companies') {
    fields.push({
      id: 'sector',
      type: 'choice',
      label: t('crm.filter.sector'),
      value: query.sector ?? '',
      options: [
        { value: '', label: t('crm.filter.sector.any') },
        ...sectors.map((s) => ({ value: s.id, label: s.name })),
      ],
      onChange: (sector) => onChange({ sector: sector || undefined }),
      filter: {
        active: Boolean(query.sector),
        chip: t('filters.chip.sector', { value: sectorName ?? '' }),
        clear: () => onChange({ sector: undefined }),
      },
    });
  }
  fields.push(
    {
      id: 'minScore',
      type: 'range',
      label: t('filters.score'),
      value: minScore,
      min: 0,
      max: 100,
      step: 5,
      valueText: scoreText(minScore),
      onChange: (n) => onChange({ minScore: n || undefined }),
      filter: {
        active: minScore > 0,
        chip: t('filters.chip.score', { value: scoreText(minScore) }),
        clear: () => onChange({ minScore: undefined }),
      },
    },
    {
      id: 'sort',
      type: 'choice',
      label: t('crm.sort'),
      value: sort,
      options: sorts.map((s) => ({ value: s, label: t(`crm.sort.${s}` as StringKey) })),
      onChange: (s) => onChange({ sort: s as BoardSort, dir: undefined }),
    },
    {
      id: 'order',
      type: 'choice',
      label: t('filters.crm.order'),
      value: direction,
      options: [
        { value: 'asc', label: t('filters.crm.ascending') },
        { value: 'desc', label: t('filters.crm.descending') },
      ],
      onChange: (d) => onChange({ dir: d === DEFAULT_DIRECTION[sort] ? undefined : (d as 'asc') }),
    },
  );
  const reset = () => onChange({ sector: undefined, minScore: undefined });

  return (
    <>
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
        <FilterMenu fields={fields} onReset={reset} />
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
      <FilterChips fields={fields} />
    </>
  );
}

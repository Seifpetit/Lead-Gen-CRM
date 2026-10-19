import { Search } from 'lucide-react';
import { useId } from 'react';
import { useT } from '../../../i18n/index.js';
import { LEAD_SORTS, MIN_SCORES, type LeadsQuery } from './leadsQuery.js';

const SORTS = [...LEAD_SORTS, 'sector', 'days'] as const;

/**
 * One row under the section header: a search that stretches, stage chips (when `stages` is given;
 * the expanded window has folders instead), the minimum score and the sort. The chips scroll
 * sideways when there is no room.
 */
export function LeadsToolbar({
  query,
  onQuery,
  stages,
}: {
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
  stages?: { key: string; count: number }[] | undefined;
}) {
  const t = useT();
  const search = useId();
  const total = stages?.reduce((n, s) => n + s.count, 0) ?? 0;
  const chip = (key: string | null, label: string, count: number | null) => (
    <button
      key={key ?? 'all'}
      type="button"
      className="chip-button"
      aria-pressed={query.stage === key}
      onClick={() => onQuery({ stage: key })}
    >
      {label}
      {count !== null && <span className="chip-count">{count}</span>}
    </button>
  );
  return (
    <div className="leads-toolbar">
      <div className="search leads-search">
        <Search size={14} aria-hidden="true" />
        <label htmlFor={search} className="visually-hidden">
          {t('leads.search')}
        </label>
        <input
          id={search}
          type="search"
          value={query.q}
          placeholder={t('leads.search.placeholder')}
          onChange={(e) => onQuery({ q: e.target.value })}
        />
      </div>
      {stages && (
        <div className="chip-row" role="group" aria-label={t('leads.stages')}>
          {chip(null, t('leads.stage.all'), total)}
          {stages.map((s) => chip(s.key, t(`boardStage.${s.key as 'found'}`), s.count))}
        </div>
      )}
      <label className="inline-field">
        <span>{t('leads.filter.score')}</span>
        <select
          value={query.minScore}
          onChange={(e) => onQuery({ minScore: e.target.value as LeadsQuery['minScore'] })}
        >
          {MIN_SCORES.map((s) => (
            <option key={s} value={s}>
              {t(
                s === '0'
                  ? 'leads.filter.score.any'
                  : (`leads.filter.score.${s}` as 'leads.filter.score.50'),
              )}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-field">
        <span>{t('leads.sort')}</span>
        <select
          value={query.sort}
          onChange={(e) => onQuery({ sort: e.target.value as LeadsQuery['sort'], dir: undefined })}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`leads.sort.${s}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

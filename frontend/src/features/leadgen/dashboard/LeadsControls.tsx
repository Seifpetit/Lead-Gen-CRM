import { Maximize2, Search } from 'lucide-react';
import { useId } from 'react';
import { FilterMenu, type FilterField } from '../../../components/shared/FilterMenu.js';
import { ToggleGroup } from '../../../components/shared/ToggleGroup.js';
import { useT } from '../../../i18n/index.js';
import type { LeadsQuery } from './leadsQuery.js';

export type LeadsView = 'grid' | 'table';

/** Companies or People, next to the title. A pipeline has its own stages, so the stage resets. */
export function PipelineSwitch({
  query,
  onQuery,
}: {
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
}) {
  const t = useT();
  return (
    <ToggleGroup
      label={t('leads.pipeline')}
      hideLabel
      value={query.pipeline}
      options={[
        { value: 'companies', label: t('leads.pipeline.companies') },
        { value: 'people', label: t('leads.pipeline.people') },
      ]}
      onChange={(pipeline) => onQuery({ pipeline, stage: null })}
    />
  );
}

/**
 * The rest of the header on one line: a search box that stretches, the Filters button with its
 * badge and, in the panel, the button that expands it. Everything else is in the Filters panel.
 */
export function LeadsActions({
  query,
  onQuery,
  fields,
  onReset,
  onExpand,
}: {
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
  fields: readonly FilterField[];
  onReset: () => void;
  /** Left out inside the expanded window, which is already expanded. */
  onExpand?: () => void;
}) {
  const t = useT();
  const search = useId();
  return (
    <>
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
      <FilterMenu fields={fields} onReset={onReset} />
      {onExpand && (
        <button
          type="button"
          className="button button-icon"
          aria-label={t('leads.expand')}
          title={t('leads.expand')}
          onClick={onExpand}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

import type { RunSummary } from '@lead-gen-crm/shared';
import { useCallback, useMemo, useState } from 'react';
import { FilterChips } from '../../../components/shared/FilterMenu.js';
import { Modal } from '../../../components/Modal.js';
import { PanelSection } from '../../../components/shared/PanelSection.js';
import { useT } from '../../../i18n/index.js';
import { Folders } from './Folders.js';
import { LeadsBody } from './LeadsBody.js';
import { LeadsActions, PipelineSwitch, type LeadsView } from './LeadsControls.js';
import { ALL_PARTS, COMPACT_PARTS } from './LeadTile.js';
import { NO_FILTERS, useLeadsFilters } from './leadsFilters.js';
import {
  cardFilters,
  facetFilters,
  hasFilters,
  initialQuery,
  type Density,
  type LeadsQuery,
} from './leadsQuery.js';
import { useLeadCards } from './useLeadCards.js';

/**
 * Recent leads: the section that takes about 55% of the panel. Its view (found-in, pipeline,
 * stage, search, sort, grid or table, density) belongs to this component, so the expanded window
 * opens on the same cards and what is changed there is kept after it closes.
 */
export function LeadsPanel({
  regionId,
  refreshKey,
  runs,
  onCreateRun,
}: {
  regionId: string;
  refreshKey: number;
  runs: readonly RunSummary[];
  onCreateRun: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState<LeadsQuery>(initialQuery);
  const [view, setView] = useState<LeadsView>('grid');
  const [density, setDensity] = useState<Density>('comfortable');
  const [expanded, setExpanded] = useState(false);
  const patch = useCallback(
    (change: Partial<LeadsQuery>) => setQuery((q) => ({ ...q, ...change })),
    [],
  );
  const reset = useCallback(() => patch(NO_FILTERS), [patch]);

  const data = useLeadCards(
    query.pipeline,
    cardFilters(query, regionId),
    facetFilters(query, regionId),
    { refreshKey },
  );
  const sectorNames = useMemo(
    () => new Map((data.facets?.sectors ?? []).map((s) => [s.id, s.name])),
    [data.facets],
  );
  const fields = useLeadsFilters({
    query,
    onQuery: patch,
    view,
    onView: setView,
    density,
    onDensity: setDensity,
    facets: data.facets,
    runs,
  });
  const parts = density === 'compact' ? COMPACT_PARTS : ALL_PARTS;
  const nothingYet =
    !data.loading && data.error === null && data.facets?.total === 0 && !hasFilters(query);

  return (
    <PanelSection
      title={t('leads.title')}
      tone="teal"
      className="dp-leads"
      leading={<PipelineSwitch query={query} onQuery={patch} />}
      controls={
        <LeadsActions
          query={query}
          onQuery={patch}
          fields={fields}
          onReset={reset}
          onExpand={() => setExpanded(true)}
        />
      }
    >
      {nothingYet ? (
        <div className="state state-empty">
          <p className="state-title">{t('leads.empty.title')}</p>
          <button type="button" className="button button-primary" onClick={onCreateRun}>
            {t('dash.create')}
          </button>
        </div>
      ) : (
        <>
          <FilterChips fields={fields} />
          <LeadsBody
            data={data}
            query={query}
            onQuery={patch}
            view={view}
            parts={parts}
            sectorNames={sectorNames}
          />
        </>
      )}
      {expanded && (
        <LeadsExplorer
          query={query}
          onQuery={patch}
          view={view}
          onView={setView}
          density={density}
          onDensity={setDensity}
          regionId={regionId}
          refreshKey={refreshKey}
          runs={runs}
          onClose={() => setExpanded(false)}
        />
      )}
    </PanelSection>
  );
}

/** The expanded window: folders on the left, the same cards (or table) with ticking and bulk actions. */
function LeadsExplorer({
  query,
  onQuery,
  view,
  onView,
  density,
  onDensity,
  regionId,
  refreshKey,
  runs,
  onClose,
}: {
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
  view: LeadsView;
  onView: (view: LeadsView) => void;
  density: Density;
  onDensity: (density: Density) => void;
  regionId: string;
  refreshKey: number;
  runs: readonly RunSummary[];
  onClose: () => void;
}) {
  const t = useT();
  const data = useLeadCards(
    query.pipeline,
    cardFilters(query, regionId),
    facetFilters(query, regionId),
    { refreshKey },
  );
  const sectorNames = useMemo(
    () => new Map((data.facets?.sectors ?? []).map((s) => [s.id, s.name])),
    [data.facets],
  );
  const fields = useLeadsFilters({
    query,
    onQuery,
    view,
    onView,
    density,
    onDensity,
    facets: data.facets,
    runs,
  });
  const reset = useCallback(() => onQuery(NO_FILTERS), [onQuery]);
  return (
    <Modal title={t('leads.title')} onClose={onClose} full>
      <div className="explorer">
        <Folders facets={data.facets} query={query} runs={runs} onQuery={onQuery} />
        <div className="explorer-main">
          <div className="explorer-bar">
            <PipelineSwitch query={query} onQuery={onQuery} />
            <LeadsActions query={query} onQuery={onQuery} fields={fields} onReset={reset} />
          </div>
          <FilterChips fields={fields} />
          <p className="muted small explorer-count" role="status">
            {t('leads.count', { count: data.total })}
          </p>
          <LeadsBody
            data={data}
            query={query}
            onQuery={onQuery}
            view={view}
            parts={density === 'compact' ? COMPACT_PARTS : ALL_PARTS}
            selectable
            sectorNames={sectorNames}
          />
        </div>
      </div>
    </Modal>
  );
}

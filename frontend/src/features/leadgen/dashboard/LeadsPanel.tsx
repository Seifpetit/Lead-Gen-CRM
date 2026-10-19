import type { RunSummary } from '@lead-gen-crm/shared';
import { useCallback, useMemo, useState } from 'react';
import { Modal } from '../../../components/Modal.js';
import { PanelSection } from '../../../components/shared/PanelSection.js';
import { useT } from '../../../i18n/index.js';
import { Folders } from './Folders.js';
import { LeadsBody } from './LeadsBody.js';
import { LeadsControls, type LeadsView } from './LeadsControls.js';
import { LeadsToolbar } from './LeadsToolbar.js';
import { ALL_PARTS, type TileParts } from './LeadTile.js';
import { cardFilters, facetFilters, initialQuery, type LeadsQuery } from './leadsQuery.js';
import { useLeadCards } from './useLeadCards.js';

/**
 * Recent leads: the section that takes about 55% of the panel. Its view (found-in, pipeline,
 * stage, search, sort, grid or table) belongs to this component, so the expanded window opens on
 * the same cards and what is changed there is kept after it closes.
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
  const [parts, setParts] = useState<TileParts>(ALL_PARTS);
  const [expanded, setExpanded] = useState(false);
  const patch = useCallback(
    (change: Partial<LeadsQuery>) => setQuery((q) => ({ ...q, ...change })),
    [],
  );

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
  const nothingYet =
    !data.loading && data.error === null && data.facets?.total === 0 && !hasFilters(query);

  const controls = (
    <LeadsControls
      query={query}
      onQuery={patch}
      view={view}
      onView={setView}
      parts={parts}
      onParts={setParts}
      onExpand={() => setExpanded(true)}
    />
  );

  return (
    <PanelSection title={t('leads.title')} tone="teal" controls={controls} className="dp-leads">
      {nothingYet ? (
        <div className="state state-empty">
          <p className="state-title">{t('leads.empty.title')}</p>
          <button type="button" className="button button-primary" onClick={onCreateRun}>
            {t('dash.create')}
          </button>
        </div>
      ) : (
        <>
          <LeadsToolbar query={query} onQuery={patch} stages={data.facets?.stages} />
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
          parts={parts}
          onParts={setParts}
          regionId={regionId}
          refreshKey={refreshKey}
          runs={runs}
          onClose={() => setExpanded(false)}
        />
      )}
    </PanelSection>
  );
}

const hasFilters = (q: LeadsQuery) =>
  q.q.trim() !== '' || q.minScore !== '0' || q.found !== 'all' || q.stage !== null;

/** The expanded window: folders on the left, the same cards (or table) with ticking and bulk actions. */
function LeadsExplorer({
  query,
  onQuery,
  view,
  onView,
  parts,
  onParts,
  regionId,
  refreshKey,
  runs,
  onClose,
}: {
  query: LeadsQuery;
  onQuery: (patch: Partial<LeadsQuery>) => void;
  view: LeadsView;
  onView: (view: LeadsView) => void;
  parts: TileParts;
  onParts: (parts: TileParts) => void;
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
  return (
    <Modal title={t('leads.title')} onClose={onClose} full>
      <div className="explorer">
        <Folders facets={data.facets} query={query} runs={runs} onQuery={onQuery} />
        <div className="explorer-main">
          <div className="explorer-controls">
            <LeadsControls
              query={query}
              onQuery={onQuery}
              view={view}
              onView={onView}
              parts={parts}
              onParts={onParts}
            />
          </div>
          <LeadsToolbar query={query} onQuery={onQuery} />
          <p className="muted small explorer-count" role="status">
            {t('leads.count', { count: data.total })}
          </p>
          <LeadsBody
            data={data}
            query={query}
            onQuery={onQuery}
            view={view}
            parts={parts}
            selectable
            sectorNames={sectorNames}
          />
        </div>
      </div>
    </Modal>
  );
}

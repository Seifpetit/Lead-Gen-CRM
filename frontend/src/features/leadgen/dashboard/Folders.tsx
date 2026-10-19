import type { CrmFacets, RunSummary } from '@lead-gen-crm/shared';
import { useT } from '../../../i18n/index.js';
import { runLabel } from './leadsFilters.js';
import type { LeadsQuery } from './leadsQuery.js';

/**
 * The rail of the expanded window: All, then groups of the same cards by stage, by run and by
 * sector, each with a count. One folder is open at a time; opening one sets that filter and
 * clears the others.
 */
export function Folders({
  facets,
  query,
  runs,
  onQuery,
}: {
  facets: CrmFacets | undefined;
  query: LeadsQuery;
  runs: readonly RunSummary[];
  onQuery: (patch: Partial<LeadsQuery>) => void;
}) {
  const t = useT();
  const open = { stage: null, sector: null, runId: null } as const;
  const none = query.stage === null && query.sector === null && query.runId === null;
  const item = (key: string, label: string, count: number, active: boolean, pick: () => void) => (
    <li key={key}>
      <button
        type="button"
        className="folder"
        aria-current={active ? 'true' : undefined}
        onClick={pick}
      >
        <span className="folder-name">{label}</span>
        <span className="folder-count">{count}</span>
      </button>
    </li>
  );
  return (
    <nav className="folders" aria-label={t('leads.folders')}>
      <ul>{item('all', t('leads.stage.all'), facets?.total ?? 0, none, () => onQuery(open))}</ul>
      <h3>{t('leads.folders.byStage')}</h3>
      <ul>
        {(facets?.stages ?? []).map((s) =>
          item(s.key, t(`boardStage.${s.key}`), s.count, query.stage === s.key, () =>
            onQuery({ ...open, stage: s.key }),
          ),
        )}
      </ul>
      <h3>{t('leads.folders.byRun')}</h3>
      <ul>
        {(facets?.runs ?? []).map((r) =>
          item(
            `run-${r.id ?? 'none'}`,
            runLabel(runs, r.id, t('leads.folders.earlierRun')),
            r.count,
            r.id !== null && query.runId === r.id,
            () => r.id !== null && onQuery({ ...open, runId: r.id }),
          ),
        )}
      </ul>
      <h3>{t('leads.folders.bySector')}</h3>
      <ul>
        {(facets?.sectors ?? []).map((s) =>
          item(`sector-${s.id}`, s.name, s.count, query.sector === s.id, () =>
            onQuery({ ...open, sector: s.id }),
          ),
        )}
      </ul>
    </nav>
  );
}

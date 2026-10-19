import { Select } from '../../../components/shared/Select.js';
import { regionLabel } from '@lead-gen-crm/shared';
import type { Coverage, RegionSummary, RunSummary } from '@lead-gen-crm/shared';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../../api/context.js';
import { EmptyState, ErrorState, LoadingState } from '../../../components/states.js';
import { useT } from '../../../i18n/index.js';
import { formatDateTime, formatNumber, formatUsd } from '../../../lib/format.js';
import { useResource } from '../../../lib/useResource.js';
import { StatusBadge } from '../runParts.js';

/** Past runs per region, newest first, with a region filter. Only shown in the Expand window. */
export function RunHistory({
  coverage,
  regions,
  initialRegionId,
}: {
  coverage: Coverage;
  regions: readonly Pick<RegionSummary, 'regionId' | 'name'>[];
  /** The region the page has picked, if any; the filter starts on it. */
  initialRegionId: string;
}) {
  const t = useT();
  const api = useApi();
  const filterId = useId();
  const [regionId, setRegionId] = useState(initialRegionId);
  const runs = useResource(() => api.runs.list({ limit: 100 }));

  const regionName = (id: string) => regions.find((r) => r.regionId === id)?.name ?? id;
  const sectorsOf = (run: RunSummary) =>
    run.sectors.length > 0
      ? run.sectors.map((id) => coverage.sectors.find((s) => s.id === id)?.name ?? id).join(', ')
      : run.customOnly
        ? t('grid.other')
        : t('cov.history.allSectors');

  const shown = useMemo(
    () =>
      (runs.data?.items ?? [])
        .filter((r) => regionId === '' || r.region === regionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [runs.data, regionId],
  );

  return (
    <div className="cov-history">
      <div className="cov-history-bar">
        <label htmlFor={filterId}>{t('cov.region')}</label>
        <Select
          id={filterId}
          className="quiet-select"
          value={regionId}
          onChange={setRegionId}
          options={[
            { value: '', label: t('cov.history.all') },
            ...regions.map((r) => ({ value: r.regionId, label: r.name })),
          ]}
        />
      </div>
      {runs.error !== null && !runs.data ? (
        <ErrorState error={runs.error} onRetry={runs.reload} />
      ) : !runs.data ? (
        <LoadingState />
      ) : shown.length === 0 ? (
        <EmptyState title={t('cov.history.empty.title')}>{t('cov.history.empty.body')}</EmptyState>
      ) : (
        <div className="cov-table-wrap">
          <table className="cov-table" aria-label={t('cov.history.title')}>
            <thead>
              <tr>
                <th scope="col">{t('cov.history.date')}</th>
                <th scope="col">{t('cov.region')}</th>
                <th scope="col">{t('cov.sector')}</th>
                <th scope="col" className="num">
                  {t('cov.history.leads')}
                </th>
                <th scope="col" className="num">
                  {t('cov.cost')}
                </th>
                <th scope="col">{t('cov.history.status')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((run) => (
                <tr key={run.id}>
                  <th scope="row">
                    <Link
                      to={`/leadgen/runs/${run.id}`}
                      aria-label={t('runs.open', { region: regionLabel(run.region) })}
                    >
                      <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
                    </Link>
                  </th>
                  <td>{regionName(run.region)}</td>
                  <td>{sectorsOf(run)}</td>
                  <td className="num">{formatNumber(run.funnel.leads)}</td>
                  <td className="num">{formatUsd(run.spentUsd)}</td>
                  <td>
                    <StatusBadge status={run.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

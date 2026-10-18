import type { Page, RunSummary } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Card } from '../../components/shared/Card.js';
import { useT } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { FunnelCounts, isActive, SpendMeter, StatusBadge } from './runParts.js';

const PAGE = 10;

/** Previous runs: region, status, counts per funnel stage, spend against the cap. */
export function RunsWidget({ refreshKey }: { refreshKey: number }) {
  const t = useT();
  const api = useApi();
  const first = useResource(() => api.runs.list({ limit: PAGE }), {
    pollMs: 10_000,
    deps: [refreshKey],
  });
  const [more, setMore] = useState<RunSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  // A fresh first page replaces anything loaded beyond it.
  useEffect(() => {
    setMore([]);
    setNext(first.data?.nextOffset ?? null);
  }, [first.data]);

  const showMore = useCallback(async () => {
    if (next === null) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page: Page<RunSummary> = await api.runs.list({ limit: PAGE, offset: next });
      setMore((m) => [...m, ...page.items]);
      setNext(page.nextOffset);
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  }, [api, next]);

  const runs = [...(first.data?.items ?? []), ...more];

  return (
    <Card title={t('runs.title')} className="widget-medium">
      {first.loading && !first.data ? (
        <LoadingState />
      ) : first.error && !first.data ? (
        <ErrorState error={first.error} onRetry={first.reload} />
      ) : runs.length === 0 ? (
        <EmptyState title={t('runs.empty.title')}>{t('runs.empty.body')}</EmptyState>
      ) : (
        <>
          {first.error !== null && <ErrorState error={first.error} onRetry={first.reload} />}
          <table className="table runs-table">
            <caption className="visually-hidden">{t('runs.table.label')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('runs.col.region')}</th>
                <th scope="col">{t('runs.col.status')}</th>
                <th scope="col">{t('runs.col.funnel')}</th>
                <th scope="col">{t('runs.col.spend')}</th>
                <th scope="col">{t('runs.col.started')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('runs.col.open')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <th scope="row" data-label={t('runs.col.region')}>
                    {run.region}
                    {run.mode === 'maintenance' && (
                      <span className="muted"> · {t('runs.maintenance')}</span>
                    )}
                  </th>
                  <td data-label={t('runs.col.status')}>
                    <StatusBadge status={run.status} />
                    {isActive(run.status) && run.currentStage && (
                      <span className="muted"> {t(`stage.${run.currentStage}`)}</span>
                    )}
                  </td>
                  <td data-label={t('runs.col.funnel')}>
                    <FunnelCounts funnel={run.funnel} compact />
                  </td>
                  <td data-label={t('runs.col.spend')}>
                    <SpendMeter run={run} />
                  </td>
                  <td data-label={t('runs.col.started')}>{formatDateTime(run.createdAt)}</td>
                  <td>
                    <Link
                      to={`/leadgen/runs/${run.id}`}
                      aria-label={t('runs.open', { region: run.region })}
                    >
                      {t('common.view')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {moreError !== null && <ErrorState error={moreError} onRetry={() => void showMore()} />}
          {next !== null && (
            <button
              type="button"
              className="button"
              disabled={loadingMore}
              onClick={() => void showMore()}
            >
              {loadingMore ? t('common.loading') : t('common.showMore')}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

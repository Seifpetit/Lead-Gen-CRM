import { useCallback, useState } from 'react';
import { useApi } from '../../api/context.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Card } from '../../components/shared/Card.js';
import { useT } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { Link } from 'react-router';
import { CoverageGridWidget } from './CoverageGridWidget.js';
import { CoverageMapWidget } from './CoverageMapWidget.js';
import type { StartPrefill } from './prefill.js';
import { FunnelCounts, SpendMeter, StatusBadge } from './runParts.js';
import { StartRunWidget } from './StartRunWidget.js';

type Picked = StartPrefill & { nonce: number };

export function CoveragePage() {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  // A click on a square or the map selects it and opens the planning for it.
  const [picked, setPicked] = useState<Picked | null>(null);
  const [planning, setPlanning] = useState(false);
  const pick = useCallback((p: StartPrefill) => {
    setPicked((cur) => ({ ...p, nonce: (cur?.nonce ?? 0) + 1 }));
    setPlanning(true);
  }, []);

  return (
    <main id="main" className="page">
      <SectionTitle level={1}>{t('side.coverage')}</SectionTitle>
      {planning && (
        <div className="start-panel">
          <div className="start-panel-bar">
            <button type="button" className="button" onClick={() => setPlanning(false)}>
              {t('dash.create.close')}
            </button>
          </div>
          <StartRunWidget onStarted={refresh} prefill={picked} />
        </div>
      )}
      <div className="coverage-layout">
        <div className="coverage-left">
          <CoverageGridWidget refreshKey={refreshKey} onPick={pick} />
          <HistoryWidget picked={picked} refreshKey={refreshKey} />
        </div>
        <CoverageMapWidget refreshKey={refreshKey} onPick={pick} />
      </div>
    </main>
  );
}

/** Past runs that searched the selected region and sector. */
function HistoryWidget({ picked, refreshKey }: { picked: Picked | null; refreshKey: number }) {
  const t = useT();
  const api = useApi();
  const runs = useResource(() => api.runs.list({ limit: 100 }), { deps: [refreshKey] });
  const coverage = useResource(() => api.coverage.get(), { deps: [refreshKey] });

  const sectorId = picked?.sectorIds?.length === 1 ? picked.sectorIds[0]! : null;
  const matching = (runs.data?.items ?? []).filter(
    (r) =>
      picked !== null &&
      r.region === picked.regionId &&
      (sectorId === null || r.sectors.includes(sectorId)),
  );
  const regionName =
    coverage.data?.regions.find((r) => r.regionId === picked?.regionId)?.name ?? picked?.regionId;
  const sectorName = coverage.data?.sectors.find((s) => s.id === sectorId)?.name ?? sectorId;

  return (
    <Card title={t('history.title')}>
      {picked === null ? (
        <p className="muted">{t('history.pick')}</p>
      ) : runs.error !== null && !runs.data ? (
        <ErrorState error={runs.error} onRetry={runs.reload} />
      ) : !runs.data ? (
        <LoadingState />
      ) : (
        <>
          <p className="muted">
            {sectorName
              ? t('history.for', { region: regionName ?? '', sector: sectorName })
              : t('history.forRegion', { region: regionName ?? '' })}
          </p>
          {matching.length === 0 ? (
            <EmptyState title={t('history.empty.title')}>{t('history.empty.body')}</EmptyState>
          ) : (
            <ul className="history-list">
              {matching.map((run) => (
                <li key={run.id}>
                  <div className="history-head">
                    <StatusBadge status={run.status} />{' '}
                    <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>{' '}
                    <Link
                      to={`/leadgen/runs/${run.id}`}
                      aria-label={t('runs.open', { region: run.region })}
                    >
                      {t('common.view')}
                    </Link>
                  </div>
                  <FunnelCounts funnel={run.funnel} compact />
                  <SpendMeter run={run} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

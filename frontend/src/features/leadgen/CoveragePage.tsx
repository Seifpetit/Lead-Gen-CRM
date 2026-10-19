import { Maximize2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../../api/context.js';
import { CoverageMap } from '../../components/shared/CoverageMap.js';
import { CoverageLegend, CoverageMatrix } from '../../components/shared/CoverageMatrix.js';
import { CoverageRegionTable } from '../../components/shared/CoverageRegionTable.js';
import { PanelSection } from '../../components/shared/PanelSection.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { useToast } from '../../components/shared/Toast.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { coverageRows, entryOf, type Metric } from '../../lib/coverageView.js';
import { useResource } from '../../lib/useResource.js';
import { CoverageDetail } from './coverageview/CoverageDetail.js';
import { CoverageExplorer } from './coverageview/CoverageExplorer.js';
import { MetricSwitch } from './coverageview/MetricSwitch.js';
import { CreateRunModal } from './CreateRunModal.js';
import type { StartPrefill } from './prefill.js';

/** A click on any of these is a click on something, not on the empty panel. */
const KEEP = 'button, a, input, select, textarea, label, [role="button"], [data-keep]';

/**
 * Coverage is one bordered panel that fills the window: the matrix of regions and sectors on
 * the left, the map fixed on the right. Picking a region (on the map or by its label) turns the
 * matrix into that region's table and zooms the map to it; the pick lives in the address
 * (?region=sfax) so refresh and Back work. Clicking the empty panel or pressing Escape resets.
 */
export function CoveragePage() {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [metric, setMetric] = useState<Metric>('status');
  const [planning, setPlanning] = useState<StartPrefill | null>(null);
  const [expanded, setExpanded] = useState(false);

  const coverage = useResource(() => api.coverage.get(), { deps: [refreshKey] });
  const summaries = useResource(() => api.regions.list({ limit: 100 }), { deps: [refreshKey] });
  const geometry = useResource(() => api.regions.geometry(), { deps: [refreshKey] });

  const data = coverage.data;
  const rows = useMemo(
    () => (data && summaries.data ? coverageRows(data, summaries.data.items) : []),
    [data, summaries.data],
  );
  const exploredIds = useMemo(
    () => new Set(rows.filter((r) => r.explored).map((r) => r.regionId)),
    [rows],
  );

  // The address says what is picked; a region that is unknown or greyed out counts as none.
  const wanted = params.get('region');
  const row = rows.find((r) => r.regionId === wanted && r.explored) ?? null;
  const regionId = row?.regionId ?? null;
  const wantedSector = params.get('sector');
  const sector = regionId !== null ? data?.sectors.find((s) => s.id === wantedSector) : undefined;
  const sectorId = sector?.id ?? null;
  const asTable = row !== null && sectorId === null;

  const cells = useResource(() => api.regions.cells(regionId!), {
    enabled: regionId !== null,
    deps: [regionId, refreshKey],
  });

  const select = useCallback(
    (region: string | null, sectorOf: string | null = null) => {
      const next = new URLSearchParams();
      if (region !== null) next.set('region', region);
      if (region !== null && sectorOf !== null) next.set('sector', sectorOf);
      setParams(next);
    },
    [setParams],
  );
  const reset = useCallback(() => select(null), [select]);

  // Escape resets the pick, unless a window is open (Escape closes that first).
  useEffect(() => {
    if (wanted === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      reset();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [wanted, reset]);

  function onPanelClick(event: MouseEvent<HTMLElement>) {
    if (wanted === null || (event.target as Element).closest(KEEP)) return;
    reset();
  }

  function plan(prefill: StartPrefill) {
    setExpanded(false);
    setPlanning(prefill);
  }

  const loading = (coverage.loading && !data) || (summaries.loading && !summaries.data);
  const failure = coverage.error ?? summaries.error;
  const failed = failure !== null && (!data || !summaries.data);
  const retry = () => {
    coverage.reload();
    summaries.reload();
  };
  const regionName = row?.name ?? '';

  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel cov-panel" onClick={onPanelClick}>
        <header className="dp-header">
          <SectionTitle level={1}>{t('side.coverage')}</SectionTitle>
          <div className="dp-header-controls">
            <MetricSwitch metric={metric} onChange={setMetric} />
            <button
              type="button"
              className="button button-icon"
              aria-label={t('cov.expand')}
              title={t('cov.expand')}
              disabled={!data}
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="cov-body">
          <PanelSection
            title={asTable ? t('cov.table.title', { region: regionName }) : t('grid.title')}
            tone="teal"
            className="cov-left"
            controls={
              asTable ? (
                <button type="button" className="button" onClick={reset}>
                  {t('cov.table.back')}
                </button>
              ) : undefined
            }
          >
            {failed ? (
              <ErrorState error={failure} onRetry={retry} />
            ) : loading || !data ? (
              <LoadingState label={t('grid.loading')} />
            ) : data.regions.length === 0 ? (
              <EmptyState title={t('cov.empty.title')}>{t('cov.empty.body')}</EmptyState>
            ) : asTable ? (
              <div className="cov-scroll" data-keep="">
                <CoverageRegionTable
                  data={data}
                  regionId={row.regionId}
                  regionName={row.name}
                  onPlan={(sectorOf) =>
                    plan({ regionId: row.regionId, ...(sectorOf ? { sectorIds: [sectorOf] } : {}) })
                  }
                />
              </div>
            ) : (
              <>
                <div className="cov-scroll" data-keep="">
                  <CoverageMatrix
                    data={data}
                    rows={rows}
                    metric={metric}
                    selected={{ regionId, sectorId }}
                    onSelectRegion={(id) => select(id)}
                    onSelectCell={(id, s) => select(id, s)}
                  />
                </div>
                {metric === 'status' ? (
                  <CoverageLegend />
                ) : (
                  <p className="muted cov-scale">{t(`cov.scale.${metric}`)}</p>
                )}
                {row && sector && (
                  <CoverageDetail
                    regionName={row.name}
                    sectorName={sector.name}
                    entry={entryOf(data, row.regionId, sector.id)}
                    onPlan={() => plan({ regionId: row.regionId, sectorIds: [sector.id] })}
                    onClose={() => select(row.regionId)}
                  />
                )}
              </>
            )}
          </PanelSection>

          <PanelSection
            title={t('map.title')}
            tone="sky"
            className="cov-right"
            controls={
              regionId !== null ? (
                <button
                  type="button"
                  className="button button-icon"
                  aria-label={t('map.reset')}
                  title={t('map.reset')}
                  onClick={reset}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : undefined
            }
          >
            {geometry.error !== null && !geometry.data ? (
              <ErrorState error={geometry.error} onRetry={geometry.reload} />
            ) : !geometry.data || !data ? (
              <LoadingState label={t('map.loading')} />
            ) : (
              <CoverageMap
                regions={geometry.data.items}
                exploredIds={exploredIds}
                regionId={regionId}
                onRegionChange={(id) => select(id)}
                cells={cells.data}
                cellsLoading={cells.loading}
                cellsError={cells.error}
                onRetryCells={cells.reload}
                onPlanCell={(id, cellKey) => plan({ regionId: id, cellKeys: [cellKey] })}
              />
            )}
          </PanelSection>
        </div>
      </div>

      {expanded && data && summaries.data && (
        <CoverageExplorer
          data={data}
          rows={rows}
          regions={summaries.data.items}
          metric={metric}
          onMetric={setMetric}
          regionId={regionId}
          sectorId={sectorId}
          onSelectCell={(id, s) => select(id, s)}
          onSelectRegion={(id) => {
            setExpanded(false);
            select(id);
          }}
          onPlan={(id, s) => plan({ regionId: id, sectorIds: [s] })}
          onClearCell={() => select(regionId)}
          onClose={() => setExpanded(false)}
        />
      )}
      {planning && (
        <CreateRunModal
          regionId={planning.regionId}
          prefill={planning}
          onCreated={(run) => {
            setPlanning(null);
            toast.show(t('create.toast', { region: run.region }));
            setRefreshKey((n) => n + 1);
          }}
          onCancel={() => setPlanning(null)}
        />
      )}
    </main>
  );
}

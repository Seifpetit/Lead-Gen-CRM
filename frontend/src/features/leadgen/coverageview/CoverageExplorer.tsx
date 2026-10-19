import type { Coverage, RegionSummary } from '@lead-gen-crm/shared';
import { useState } from 'react';
import { Modal } from '../../../components/Modal.js';
import { CoverageLegend, CoverageMatrix } from '../../../components/shared/CoverageMatrix.js';
import { Tabs } from '../../../components/shared/Tabs.js';
import { useT } from '../../../i18n/index.js';
import { entryOf, type CoverageRow, type Metric } from '../../../lib/coverageView.js';
import { CoverageDetail } from './CoverageDetail.js';
import { MetricSwitch } from './MetricSwitch.js';
import { RunHistory } from './RunHistory.js';

type ExplorerTab = 'matrix' | 'history';

/**
 * The Expand window: a larger matrix with the same metric switch, and the history of past runs,
 * which is shown nowhere else. Escape and the close button close it; focus is trapped inside.
 */
export function CoverageExplorer({
  data,
  rows,
  regions,
  metric,
  onMetric,
  regionId,
  sectorId,
  onSelectCell,
  onSelectRegion,
  onPlan,
  onClearCell,
  onClose,
}: {
  data: Coverage;
  rows: readonly CoverageRow[];
  regions: readonly RegionSummary[];
  metric: Metric;
  onMetric: (metric: Metric) => void;
  regionId: string | null;
  sectorId: string | null;
  onSelectCell: (regionId: string, sectorId: string) => void;
  /** A row label was chosen: the page shows the region, so this closes the window too. */
  onSelectRegion: (regionId: string) => void;
  onPlan: (regionId: string, sectorId: string) => void;
  onClearCell: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<ExplorerTab>('matrix');
  const picked =
    regionId !== null && sectorId !== null ? rows.find((r) => r.regionId === regionId) : undefined;
  const sector = data.sectors.find((s) => s.id === sectorId);

  return (
    <Modal title={t('cov.explorer.title')} onClose={onClose} full>
      <div className="modal-body cov-explorer">
        <Tabs
          label={t('cov.explorer.tabs')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'matrix', label: t('cov.explorer.matrix') },
            { id: 'history', label: t('cov.history.title') },
          ]}
        >
          {tab === 'matrix' ? (
            <div className="cov-explorer-matrix">
              <div className="cov-explorer-bar">
                <MetricSwitch metric={metric} onChange={onMetric} />
                {metric === 'status' && <CoverageLegend />}
              </div>
              <div className="cov-matrix-scroll" data-keep="">
                <CoverageMatrix
                  data={data}
                  rows={rows}
                  metric={metric}
                  size="large"
                  selected={{ regionId, sectorId }}
                  onSelectRegion={onSelectRegion}
                  onSelectCell={onSelectCell}
                />
              </div>
              {picked && sector && (
                <CoverageDetail
                  regionName={picked.name}
                  sectorName={sector.name}
                  entry={entryOf(data, picked.regionId, sector.id)}
                  onPlan={() => onPlan(picked.regionId, sector.id)}
                  onClose={onClearCell}
                />
              )}
            </div>
          ) : (
            <RunHistory coverage={data} regions={regions} initialRegionId={regionId ?? ''} />
          )}
        </Tabs>
      </div>
    </Modal>
  );
}

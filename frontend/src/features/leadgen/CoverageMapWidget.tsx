import { useState } from 'react';
import { useApi } from '../../api/context.js';
import { Card } from '../../components/shared/Card.js';
import { CoverageMap } from '../../components/shared/CoverageMap.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import type { StartPrefill } from './prefill.js';

/** Loads the outlines (and the selected region's cells) and shows them as the map. */
export function CoverageMapWidget({
  refreshKey,
  onPick,
}: {
  refreshKey: number;
  onPick: (prefill: StartPrefill) => void;
}) {
  const t = useT();
  const api = useApi();
  const geometry = useResource(() => api.regions.geometry(), { deps: [refreshKey] });
  const [regionId, setRegionId] = useState<string | null>(null);
  const cells = useResource(() => api.regions.cells(regionId!), {
    enabled: regionId !== null,
    deps: [regionId, refreshKey],
  });
  return (
    <Card title={t('map.title')} className="widget-wide">
      {geometry.error !== null && !geometry.data ? (
        <ErrorState error={geometry.error} onRetry={geometry.reload} />
      ) : !geometry.data ? (
        <LoadingState label={t('map.loading')} />
      ) : (
        <CoverageMap
          regions={geometry.data.items}
          regionId={regionId}
          onRegionChange={setRegionId}
          cells={cells.data}
          cellsLoading={cells.loading}
          cellsError={cells.error}
          onRetryCells={cells.reload}
          onPick={onPick}
        />
      )}
    </Card>
  );
}

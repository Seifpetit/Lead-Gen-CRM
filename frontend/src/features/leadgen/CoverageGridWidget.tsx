import { useApi } from '../../api/context.js';
import { Card } from '../../components/shared/Card.js';
import { CoverageMatrix } from '../../components/shared/CoverageMatrix.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import type { StartPrefill } from './prefill.js';

/** Loads the coverage and shows it as the matrix. Clicking a square fills Start a run. */
export function CoverageGridWidget({
  refreshKey,
  onPick,
}: {
  refreshKey: number;
  onPick: (prefill: StartPrefill) => void;
}) {
  const t = useT();
  const api = useApi();
  const coverage = useResource(() => api.coverage.get(), { deps: [refreshKey] });
  return (
    <Card title={t('grid.title')} className="widget-wide">
      {coverage.error !== null && !coverage.data ? (
        <ErrorState error={coverage.error} onRetry={coverage.reload} />
      ) : !coverage.data ? (
        <LoadingState label={t('grid.loading')} />
      ) : (
        <CoverageMatrix data={coverage.data} onPick={onPick} />
      )}
    </Card>
  );
}

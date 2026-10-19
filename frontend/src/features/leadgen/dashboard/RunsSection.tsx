import { regionLabel } from '@lead-gen-crm/shared';
import { STAGE_CHECKPOINT, type RunSummary } from '@lead-gen-crm/shared';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '../../../components/states.js';
import { PanelSection } from '../../../components/shared/PanelSection.js';
import { runResultText } from '../runResult.js';
import { useT } from '../../../i18n/index.js';
import { formatUsd } from '../../../lib/format.js';
import { isActive, StatusBadge } from '../runParts.js';

/** Runs as compact rows: region, status, a small bar of spend against the cap, and found to leads. */
export function RunsSection({
  runs,
  loading,
  error,
  onRetry,
}: {
  runs: readonly RunSummary[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <PanelSection title={t('runs.title')} tone="sky" className="dp-runs">
      {loading ? (
        <LoadingState />
      ) : error !== null && runs.length === 0 ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : runs.length === 0 ? (
        <EmptyState title={t('runs.empty.title')}>{t('runs.empty.body')}</EmptyState>
      ) : (
        <ul className="run-rows" aria-label={t('runs.table.label')}>
          {runs.map((run) => {
            const share = run.budgetCapUsd > 0 ? Math.min(1, run.spentUsd / run.budgetCapUsd) : 0;
            const spent = t('money.spentOfCap', {
              spent: formatUsd(run.spentUsd),
              cap: formatUsd(run.budgetCapUsd),
            });
            return (
              <li key={run.id}>
                <Link
                  to={`/leadgen/runs/${run.id}`}
                  className="run-row"
                  aria-label={t('runs.open', { region: regionLabel(run.region) })}
                >
                  <span className="run-region">
                    {regionLabel(run.region)}
                    {run.mode === 'maintenance' && (
                      <span className="muted"> · {t('runs.maintenance')}</span>
                    )}
                  </span>
                  <span className="run-status">
                    <StatusBadge status={run.status} />
                    {isActive(run.status) && run.currentStage && (
                      <span className="muted small">
                        {' '}
                        {t(`cp.${STAGE_CHECKPOINT[run.currentStage]}`)}
                      </span>
                    )}
                  </span>
                  <span className="run-spend" title={spent}>
                    <progress max={1} value={share} aria-label={spent} />
                    <span className="small">{spent}</span>
                  </span>
                  <span className="run-found small">{runResultText(t, run)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PanelSection>
  );
}

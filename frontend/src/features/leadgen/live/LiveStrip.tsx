import { regionLabel } from '@lead-gen-crm/shared';
import type { RunSummary } from '@lead-gen-crm/shared';
import { Link } from 'react-router';
import { ProgressTrack } from '../../../components/shared/ProgressTrack.js';
import { useT } from '../../../i18n/index.js';
import { formatUsd } from '../../../lib/format.js';
import { useThrottled } from '../../../lib/useThrottled.js';
import { StatusBadge } from '../runParts.js';
import { describeRun } from './runView.js';
import './live.css';

/** Screen readers hear a run's sentence at most this often, however fast it changes. */
export const ANNOUNCE_MS = 4_000;

function StripRow({ run }: { run: RunSummary }) {
  const t = useT();
  const view = describeRun(t, run);
  return (
    <li className="strip-row">
      <StatusBadge status={run.status} />
      <Link
        className="strip-sentence"
        to={`/leadgen/runs/${run.id}`}
        title={regionLabel(run.region)}
      >
        {view.sentence}
      </Link>
      <span className="strip-bar">
        <ProgressTrack
          size="thin"
          tone="teal"
          value={view.progress.overall}
          label={t('live.progress', { region: regionLabel(run.region) })}
          valueText={view.progressText}
        />
      </span>
      <span className="strip-spend">
        {t('live.spend.text', { spent: formatUsd(run.spentUsd), cap: formatUsd(run.budgetCapUsd) })}
      </span>
    </li>
  );
}

/**
 * One slim row for each run in progress, under the Dashboard header: what it is doing in a
 * sentence, a thin progress bar, what it has spent, and a link to the run. Nothing is drawn
 * when no run is in progress, so the leads below take the room.
 */
export function LiveStrip({ runs }: { runs: readonly RunSummary[] }) {
  const t = useT();
  const spoken = useThrottled(
    runs.map((run) => `${regionLabel(run.region)}: ${describeRun(t, run).sentence}`).join(' '),
    ANNOUNCE_MS,
  );
  if (runs.length === 0) return null;
  return (
    <section className="live-strip" aria-label={t('live.strip')}>
      <ul>
        {runs.map((run) => (
          <StripRow key={run.id} run={run} />
        ))}
      </ul>
      <p className="visually-hidden" aria-live="polite">
        {spoken}
      </p>
    </section>
  );
}

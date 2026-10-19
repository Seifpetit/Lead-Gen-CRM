import { regionLabel } from '@lead-gen-crm/shared';
import type { RunSummary } from '@lead-gen-crm/shared';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../../../components/shared/Card.js';
import { ProgressTrack } from '../../../components/shared/ProgressTrack.js';
import { OutcomeBadge, outcomeText } from '../runOutcomeView.js';
import { useT } from '../../../i18n/index.js';
import { formatDateTime, formatUsd } from '../../../lib/format.js';
import { useThrottled } from '../../../lib/useThrottled.js';
import { Checkpoints } from './Checkpoints.js';
import { describeRun } from './runView.js';
import { StopRunDialog } from './StopRunDialog.js';
import { ANNOUNCE_MS } from './LiveStrip.js';
import './live.css';

/**
 * One run as a card: its sentence as the title, the six checkpoints with their counts, a thin
 * progress bar, what it has spent against its cap, and the buttons to stop it or read its log.
 * The compact form, for runs that have ended, drops the progress bars and the stop button and
 * can switch the leads below to this run.
 */
export function RunCard({
  run,
  compact = false,
  onChanged,
  onOpenLogs,
  onShowLeads,
}: {
  run: RunSummary;
  compact?: boolean;
  /** Called after the run is stopped, so the page can read it again. */
  onChanged?: () => void;
  /** The page shows the log window, so it survives this card moving to the past runs. */
  onOpenLogs: () => void;
  onShowLeads?: () => void;
}) {
  const t = useT();
  const view = describeRun(t, run);
  const spoken = useThrottled(view.sentence, ANNOUNCE_MS);
  const [stopping, setStopping] = useState(false);
  const cap = run.budgetCapUsd;
  const spendShare = cap > 0 ? Math.min(1, run.spentUsd / cap) : 0;
  const spent = t('live.spend.text', { spent: formatUsd(run.spentUsd), cap: formatUsd(cap) });

  return (
    <>
      <Card
        title={view.sentence}
        tone={view.active ? 'teal' : view.halted ? 'blush' : 'purple'}
        className={compact ? 'run-card is-compact' : 'run-card'}
        actions={<OutcomeBadge run={run} />}
      >
        <p className="run-card-meta muted">
          {t('runs.meta', { region: regionLabel(run.region), time: formatDateTime(run.createdAt) })}
        </p>
        <p className="run-card-result">{outcomeText(t, run)}</p>
        <p className="visually-hidden" aria-live="polite">
          {spoken}
        </p>
        <Checkpoints
          funnel={run.funnel}
          progress={view.progress}
          halted={view.halted}
          compact={compact}
        />
        {!compact && (
          <div className="run-card-bars">
            <ProgressTrack
              size="thin"
              tone="teal"
              value={view.progress.overall}
              label={t('live.progress', { region: regionLabel(run.region) })}
              valueText={view.progressText}
            />
            <div className="run-card-spend">
              <ProgressTrack
                size="thin"
                tone="purple"
                value={spendShare}
                label={t('live.spend', { region: regionLabel(run.region) })}
                valueText={spent}
              />
              <span>{spent}</span>
            </div>
          </div>
        )}
        {run.error && (
          <p className="form-error" role="alert">
            {t('runs.error', { message: run.error })}
          </p>
        )}
        <div className="run-card-actions">
          {compact && <span className="run-card-spent muted">{spent}</span>}
          {onShowLeads && (
            <button type="button" className="button" onClick={onShowLeads}>
              {t('runs.leads.show')}
            </button>
          )}
          <button type="button" className="button button-icon-text" onClick={onOpenLogs}>
            <ScrollText size={14} aria-hidden="true" />
            {t('runs.logs')}
          </button>
          {view.active && (
            <button
              type="button"
              className="button button-danger"
              onClick={() => setStopping(true)}
            >
              {t('run.stop')}
            </button>
          )}
        </div>
      </Card>
      {stopping && (
        <StopRunDialog
          runId={run.id}
          onStopped={() => {
            setStopping(false);
            onChanged?.();
          }}
          onClose={() => setStopping(false)}
        />
      )}
    </>
  );
}

import './logs.css';
import type { ApifyLogRun, ApifyStepView } from '@lead-gen-crm/shared';
import { Modal } from '../../../components/Modal.js';
import { useT, type StringKey } from '../../../i18n/index.js';
import { formatDateTime, formatDuration, formatUsd } from '../../../lib/format.js';
import { RightNow } from '../RightNow.js';
import { OutcomeBadge, outcomeText } from '../runOutcomeView.js';
import { Checkpoints } from '../live/Checkpoints.js';
import { LogTerminal } from '../live/LogModal.js';
import { describeRun } from '../live/runView.js';
import { dropTotals, runName, runSeconds, searchCount } from './runLogView.js';
import { StepBreakdown } from './StepBreakdown.js';
import { stageCosts } from './stageCosts.js';

/**
 * Everything about one run in one large window: what it came to, the six checkpoints with their
 * counts, the steps and what each one did, the costs, what was dropped and why, and the complete
 * raw log in a terminal at the bottom. Escape closes it and focus goes back to the row's button.
 */
export function RunLogDialog({
  entry,
  now,
  onClose,
}: {
  entry: ApifyLogRun;
  now: number;
  onClose: () => void;
}) {
  const t = useT();
  const { run, steps } = entry;
  const name = runName(run);
  const view = describeRun(t, run);
  const cap = run.budgetCapUsd;
  const costs = stageCosts(steps as readonly ApifyStepView[]);
  const dropped = dropTotals(steps);

  return (
    <Modal title={t('logs.dialog.title', { name })} onClose={onClose} full className="rl-dialog">
      <div className="rl-body">
        <section className="rl-section rl-summary" aria-label={t('logs.dialog.summary')}>
          <OutcomeBadge run={run} />
          <p className="rl-sentence">{outcomeText(t, run, searchCount(steps))}</p>
          <p className="muted small">
            {t('logs.dialog.when', {
              started: formatDateTime(run.createdAt),
              duration: formatDuration(runSeconds(run, now)),
            })}
          </p>
          {run.error && (
            <p className="notice notice-warning" role="status">
              {t('apify.run.stopped', { message: run.error })}
            </p>
          )}
        </section>

        <section className="rl-section">
          <h3>{t('logs.dialog.timeline')}</h3>
          <Checkpoints funnel={run.funnel} progress={view.progress} halted={view.halted} />
        </section>

        <section className="rl-section">
          <h3>{t('logs.dialog.steps')}</h3>
          <RightNow run={run} steps={steps} />
          <StepBreakdown entry={entry} />
        </section>

        <div className="rl-two">
          <section className="rl-section">
            <h3>{t('logs.dialog.costs')}</h3>
            <dl className="rl-list">
              {costs.map((c) => (
                <div key={c.group}>
                  <dt>{t(`logs.cost.${c.group}` as StringKey)}</dt>
                  <dd>{formatUsd(c.usd)}</dd>
                </div>
              ))}
              <div className="rl-total">
                <dt>{t('logs.dialog.spent')}</dt>
                <dd>
                  {t('money.spentOfCap', { spent: formatUsd(run.spentUsd), cap: formatUsd(cap) })}
                </dd>
              </div>
            </dl>
          </section>
          <section className="rl-section">
            <h3>{t('logs.dialog.dropped')}</h3>
            {dropped.length === 0 ? (
              <p className="muted">{t('logs.dialog.droppedNone')}</p>
            ) : (
              <dl className="rl-list">
                {dropped.map((d) => (
                  <div key={d.reason}>
                    <dt>{t(`logs.drop.${d.reason}` as StringKey)}</dt>
                    <dd>{d.count}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <section className="rl-section rl-raw">
          <h3>{t('logs.dialog.raw')}</h3>
          <div className="rl-terminal">
            <LogTerminal run={run} />
          </div>
        </section>
      </div>
    </Modal>
  );
}

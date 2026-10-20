import {
  checkpointState,
  CHECKPOINT_IDS,
  runProgress,
  type RunSummary,
} from '@lead-gen-crm/shared';
import { Check } from 'lucide-react';
import { useT, type StringKey } from '../../../i18n/index.js';
import { CHECKPOINT_ICONS } from '../live/Checkpoints.js';

/**
 * The six steps of a run as six small icons, a finished one solid with a tick, the one being
 * worked on (or where a stopped run stopped) marked, the rest outlined, and "4/6" beside them.
 * The same words are spoken for screen readers, so colour is never the only signal.
 */
export function StepIcons({
  run,
}: {
  run: Pick<RunSummary, 'status' | 'currentStage' | 'stageFraction'>;
}) {
  const t = useT();
  const progress = runProgress(run);
  const active = run.status === 'pending' || run.status === 'running';
  const total = CHECKPOINT_IDS.length;
  return (
    <span
      className="step-icons"
      role="img"
      aria-label={t('logs.steps.label', { done: progress.completed, total })}
    >
      <span className="step-icons-row" aria-hidden="true">
        {CHECKPOINT_IDS.map((id) => {
          const state = checkpointState(progress, id);
          const shown =
            state === 'current' && !active && run.status !== 'finished' ? 'halted' : state;
          const Icon = CHECKPOINT_ICONS[id];
          return (
            <span
              key={id}
              className="step-icon"
              data-state={shown}
              title={t(`cp.${id}` as StringKey)}
            >
              {state === 'done' && id !== 'done' ? (
                <Check size={12} strokeWidth={3} />
              ) : (
                <Icon size={12} />
              )}
            </span>
          );
        })}
      </span>
      <span className="step-icons-count" aria-hidden="true">
        {progress.completed}/{total}
      </span>
    </span>
  );
}

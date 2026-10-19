import { runProgress, type RunProgress, type RunSummary } from '@lead-gen-crm/shared';
import type { StringKey, Translate } from '../../../i18n/index.js';
import { isActive } from '../runParts.js';

export interface RunView {
  /** The sentence that says what the run is doing, or how it ended. */
  sentence: string;
  progress: RunProgress;
  percent: number;
  /** Spoken value of the progress bar. */
  progressText: string;
  active: boolean;
  /** The run ended before its last checkpoint. */
  halted: boolean;
}

/** Everything a live strip or run card shows about a run, worked out the same way in both. */
export function describeRun(t: Translate, run: RunSummary): RunView {
  const active = isActive(run.status);
  const progress = runProgress(run);
  const percent = Math.round(progress.overall * 100);
  const halted = !active && run.status !== 'finished';
  const step = t(`cp.${progress.current ?? 'done'}` as StringKey);
  const key: StringKey =
    run.status === 'finished'
      ? 'live.progress.finished'
      : halted
        ? 'live.progress.halted'
        : 'live.progress.text';
  return {
    sentence:
      run.liveMessage ?? (active ? t('live.starting') : t('run.title', { region: run.region })),
    progress,
    percent,
    progressText: t(key, { percent, step }),
    active,
    halted,
  };
}

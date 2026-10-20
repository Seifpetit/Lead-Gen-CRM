import { regionLabel } from '@lead-gen-crm/shared';
import { runProgress, type RunProgress, type RunSummary } from '@lead-gen-crm/shared';
import type { StringKey, Translate } from '../../../i18n/index.js';
import { formatUsd } from '../../../lib/format.js';
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
      run.liveMessage ??
      (active ? t('live.starting') : t('run.title', { region: regionLabel(run.region) })),
    progress,
    percent,
    progressText: t(key, { percent, step }),
    active,
    halted,
  };
}

/** Held-back estimates smaller than this are not worth a mention. */
const MIN_RESERVED_USD = 0.005;

/**
 * "$0.06 of $2.50", and while a step is in progress "plus $0.12 held for it". What is spent is
 * only what providers have charged; the hold is the estimate that the real charge replaces when
 * the step ends, so the spent figure only ever goes up.
 */
export function spendText(t: Translate, run: RunSummary): string {
  const base = t('live.spend.text', {
    spent: formatUsd(run.spentUsd),
    cap: formatUsd(run.budgetCapUsd),
  });
  return isActive(run.status) && run.reservedUsd >= MIN_RESERVED_USD
    ? `${base} ${t('live.spend.held', { amount: formatUsd(run.reservedUsd) })}`
    : base;
}

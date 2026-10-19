import {
  regionLabel,
  runOutcome,
  type ApifyLogRun,
  type ApifyStepView,
  type DropReason,
  type OutcomeGroup,
  type RunSummary,
} from '@lead-gen-crm/shared';
import { formatShortDay } from '../../../lib/format.js';

/** The choices of the status filter: every run, or one bucket of outcomes. */
export type StatusFilter = 'all' | OutcomeGroup;
export const STATUS_FILTERS: readonly StatusFilter[] = [
  'all',
  'running',
  'completed',
  'ended',
  'stopped',
  'failed',
];

/** Runs that pass both filters, newest first. An empty region means every region. */
export function filterRuns(
  entries: readonly ApifyLogRun[],
  status: StatusFilter,
  region: string,
): ApifyLogRun[] {
  return entries
    .filter((e) => status === 'all' || runOutcome(e.run).group === status)
    .filter((e) => region === '' || e.run.region === region)
    .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
}

/** "Bizerte, 19 Oct": the run's region and the day it started. */
export function runName(run: Pick<RunSummary, 'region' | 'createdAt'>): string {
  return `${regionLabel(run.region)}, ${formatShortDay(run.createdAt.slice(0, 10))}`;
}

/** Google Maps searches the run made: one per step of the first stage. */
export const searchCount = (steps: readonly ApifyStepView[]): number =>
  steps.filter((s) => s.stage === 'discover').length;

/** Seconds from start to end, or to `now` while the run is going; null when the dates are not valid. */
export function runSeconds(
  run: Pick<RunSummary, 'createdAt' | 'finishedAt'>,
  now: number,
): number | null {
  const start = Date.parse(run.createdAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 1000) : null;
}

/** What the steps dropped, added up by reason, the biggest first. */
export function dropTotals(
  steps: readonly ApifyStepView[],
): { reason: DropReason; count: number }[] {
  const totals = new Map<DropReason, number>();
  for (const step of steps) {
    for (const d of step.summary?.dropped ?? []) {
      totals.set(d.reason, (totals.get(d.reason) ?? 0) + d.count);
    }
  }
  return [...totals]
    .map(([reason, count]) => ({ reason, count }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);
}

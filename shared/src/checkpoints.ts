import type { RunFunnel, RunStage, RunStatus } from './index.js';

// The six checkpoints every run passes through, mapped from the pipeline's steps. The backend
// words its live messages around them and the frontend draws them, so both read this file.

export const CHECKPOINT_IDS = [
  'searching',
  'checking',
  'people',
  'contacts',
  'scoring',
  'done',
] as const;
export type CheckpointId = (typeof CHECKPOINT_IDS)[number];

/** Which count of the run's funnel a checkpoint shows: found, qualified, people, contacts, leads. */
export const CHECKPOINT_COUNT: Readonly<Record<CheckpointId, keyof RunFunnel>> = {
  searching: 'discovered',
  checking: 'qualified',
  people: 'peopleFound',
  contacts: 'enriched',
  scoring: 'scored',
  done: 'leads',
};

/** The pipeline step each checkpoint is made of. Finding contacts covers emails and checking them. */
export const STAGE_CHECKPOINT: Readonly<Record<RunStage, CheckpointId>> = {
  discover: 'searching',
  qualify: 'checking',
  find_people: 'people',
  enrich: 'contacts',
  verify: 'contacts',
  score: 'scoring',
};

export const checkpointIndex = (id: CheckpointId): number => CHECKPOINT_IDS.indexOf(id);

/** The number each checkpoint shows, read from a run's funnel. */
export function checkpointCounts(funnel: RunFunnel): Record<CheckpointId, number> {
  const out = {} as Record<CheckpointId, number>;
  for (const id of CHECKPOINT_IDS) out[id] = funnel[CHECKPOINT_COUNT[id]];
  return out;
}

export interface RunProgress {
  /** Checkpoints fully passed, 0 to 6. */
  completed: number;
  /** The checkpoint being worked on; null once the run is finished. */
  current: CheckpointId | null;
  /** How far through the current checkpoint, 0 to 1. */
  fraction: number;
  /** The whole run, 0 to 1: completed checkpoints plus the fraction of the current one. */
  overall: number;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * How far a run has got. A finished run is all six checkpoints. Any other run is at the
 * checkpoint of its current step (the first one before it has planned its searches), with the
 * share of that step's work already done; a stopped run keeps where it stopped. Contact lookups
 * are the only step done by the time the checks start, so checking is a full fraction.
 */
export function runProgress(run: {
  status: RunStatus;
  currentStage: RunStage | null;
  /** Share of the current step's searches or lookups finished, 0 to 1. */
  stageFraction: number;
}): RunProgress {
  const total = CHECKPOINT_IDS.length;
  if (run.status === 'finished')
    return { completed: total, current: null, fraction: 0, overall: 1 };
  const current = run.currentStage ? STAGE_CHECKPOINT[run.currentStage] : 'searching';
  const fraction = run.currentStage === 'verify' ? 1 : clamp01(run.stageFraction);
  const completed = checkpointIndex(current);
  return { completed, current, fraction, overall: (completed + fraction) / total };
}

export type CheckpointState = 'done' | 'current' | 'todo';

/** Whether a checkpoint is behind the run, being worked on, or still ahead. */
export function checkpointState(progress: RunProgress, id: CheckpointId): CheckpointState {
  const i = checkpointIndex(id);
  if (i < progress.completed) return 'done';
  return progress.current === id ? 'current' : 'todo';
}

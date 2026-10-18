import type { RunStage } from '@lead-gen-crm/shared';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

export type StepStatus = 'pending' | 'started' | 'running' | 'finished' | 'failed';

export interface RunStep {
  id: string;
  runId: string;
  stage: RunStage;
  stepKey: string;
  actorId: string | null;
  status: StepStatus;
  apifyRunId: string | null;
  apifyDatasetId: string | null;
  /** Summed from the cost ledger. */
  costUsd: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface Row {
  id: string;
  run_id: string;
  stage: RunStage;
  step_key: string;
  actor_id: string | null;
  status: StepStatus;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  cost_usd: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

// Cost is summed from the cost ledger, never stored on the step.
const SELECT_STEP = `SELECT s.*, COALESCE((SELECT sum(l.amount_usd) FROM cost_ledger l WHERE l.run_step_id = s.id), 0) AS cost_usd
  FROM run_steps s`;

const toStep = (r: Row): RunStep => ({
  id: r.id,
  runId: r.run_id,
  stage: r.stage,
  stepKey: r.step_key,
  actorId: r.actor_id,
  status: r.status,
  apifyRunId: r.apify_run_id,
  apifyDatasetId: r.apify_dataset_id,
  costUsd: r.cost_usd,
  error: r.error,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export class StepStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepStateError';
  }
}

/**
 * Returns the step for (run, stage, stepKey), creating it as pending if new. Calling it
 * again for the same key returns the existing step, so a stage is never planned twice.
 */
export async function ensureStep(
  db: Queryable,
  userId: UserId,
  input: { runId: string; stage: RunStage; stepKey: string; actorId?: string | null },
): Promise<RunStep | null> {
  // Inserting via the user's own run means a step can't be attached to someone else's run.
  await db.query(
    `INSERT INTO run_steps (user_id, run_id, stage, step_key, actor_id)
     SELECT $1, r.id, $3, $4, $5 FROM runs r WHERE r.user_id = $1 AND r.id = $2
     ON CONFLICT (run_id, stage, step_key) DO NOTHING`,
    [userId, input.runId, input.stage, input.stepKey, input.actorId ?? null],
  );
  const { rows } = await db.query<Row>(
    `${SELECT_STEP} WHERE s.user_id = $1 AND s.run_id = $2 AND s.stage = $3 AND s.step_key = $4`,
    [userId, input.runId, input.stage, input.stepKey],
  );
  return rows[0] ? toStep(rows[0]) : null;
}

/**
 * Stores the Apify run and dataset IDs and marks the step started. Must be called right
 * after Apify accepts the run and before any waiting, so a restart can find the run again.
 * Only a pending step can be started; a second call raises instead of starting twice.
 */
export async function recordApifyStart(
  db: Queryable,
  userId: UserId,
  stepId: string,
  ids: { apifyRunId: string; apifyDatasetId: string },
): Promise<RunStep> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE run_steps SET status = 'started', apify_run_id = $3, apify_dataset_id = $4,
            started_at = now(), updated_at = now()
      WHERE user_id = $1 AND id = $2 AND status = 'pending' RETURNING id`,
    [userId, stepId, ids.apifyRunId, ids.apifyDatasetId],
  );
  if (!rows[0])
    throw new StepStateError(`Step ${stepId} is not pending; refusing to start it again`);
  return (await getStep(db, userId, stepId))!;
}

export async function updateStepStatus(
  db: Queryable,
  userId: UserId,
  stepId: string,
  status: Exclude<StepStatus, 'pending' | 'started'>,
  extra: { error?: string } = {},
): Promise<RunStep | null> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE run_steps SET status = $3, error = COALESCE($4, error),
            finished_at = CASE WHEN $3 IN ('finished', 'failed') THEN now() ELSE finished_at END,
            updated_at = now()
      WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, stepId, status, extra.error ?? null],
  );
  return rows[0] ? getStep(db, userId, stepId) : null;
}

export async function listSteps(db: Queryable, userId: UserId, runId: string): Promise<RunStep[]> {
  const { rows } = await db.query<Row>(
    `${SELECT_STEP} WHERE s.user_id = $1 AND s.run_id = $2 ORDER BY s.created_at`,
    [userId, runId],
  );
  return rows.map(toStep);
}

/** Steps with a live Apify run (started or running): what startup recovery must resume. */
export async function listUnfinishedSteps(db: Queryable, userId: UserId): Promise<RunStep[]> {
  const { rows } = await db.query<Row>(
    `${SELECT_STEP} WHERE s.user_id = $1 AND s.status IN ('started', 'running')
      ORDER BY s.created_at`,
    [userId],
  );
  return rows.map(toStep);
}

export async function getStep(
  db: Queryable,
  userId: UserId,
  stepId: string,
): Promise<RunStep | null> {
  const { rows } = await db.query<Row>(`${SELECT_STEP} WHERE s.user_id = $1 AND s.id = $2`, [
    userId,
    stepId,
  ]);
  return rows[0] ? toStep(rows[0]) : null;
}

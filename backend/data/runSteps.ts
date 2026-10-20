import type { RunStage, StepSummary } from '@lead-gen-crm/shared';
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
  /** Adapter that owns the step, e.g. 'compass/crawler-google-places'. */
  provider: string | null;
  regionCellId: string | null;
  /** What the step was asked to do (JSON). */
  input: unknown;
  /** The provider's result, stored before it is applied (JSON). */
  output: unknown;
  /** Last status Apify reported (RUNNING, SUCCEEDED, ...). */
  apifyStatus: string | null;
  /** Apify restarts and migrations seen so far. */
  apifyRestarts: number;
  lastPolledAt: Date | null;
  /** Max cost passed to Apify for this step. */
  maxChargeUsd: number | null;
  /** Set when the result has been turned into records; never applied twice. */
  processedAt: Date | null;
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
  provider: string | null;
  region_cell_id: string | null;
  input: unknown;
  output: unknown;
  apify_status: string | null;
  apify_restarts: number;
  last_polled_at: Date | null;
  max_charge_usd: number | null;
  processed_at: Date | null;
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
  provider: r.provider,
  regionCellId: r.region_cell_id,
  input: r.input,
  output: r.output,
  apifyStatus: r.apify_status,
  apifyRestarts: r.apify_restarts,
  lastPolledAt: r.last_polled_at,
  maxChargeUsd: r.max_charge_usd,
  processedAt: r.processed_at,
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
  input: {
    runId: string;
    stage: RunStage;
    stepKey: string;
    actorId?: string | null;
    provider?: string | null;
    regionCellId?: string | null;
    /** Stored on first creation only; a re-plan never changes what a step was asked. */
    input?: unknown;
  },
): Promise<RunStep | null> {
  // Inserting via the user's own run means a step can't be attached to someone else's run.
  await db.query(
    `INSERT INTO run_steps (user_id, run_id, stage, step_key, actor_id, provider, region_cell_id, input)
     SELECT $1, r.id, $3, $4, $5, $6, $7, $8 FROM runs r WHERE r.user_id = $1 AND r.id = $2
     ON CONFLICT (run_id, stage, step_key) DO NOTHING`,
    [
      userId,
      input.runId,
      input.stage,
      input.stepKey,
      input.actorId ?? null,
      input.provider ?? null,
      input.regionCellId ?? null,
      input.input === undefined ? null : JSON.stringify(input.input),
    ],
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
            apify_status = 'READY', started_at = now(), updated_at = now()
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

/**
 * Marks a step without an Apify run (a synchronous provider, or a pure stage) as started.
 * Only a pending step can be started, so a crash mid-call is never retried into a second spend.
 */
export async function markStepStarted(
  db: Queryable,
  userId: UserId,
  stepId: string,
): Promise<RunStep> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE run_steps SET status = 'started', started_at = now(), updated_at = now()
      WHERE user_id = $1 AND id = $2 AND status = 'pending' AND actor_id IS NULL RETURNING id`,
    [userId, stepId],
  );
  if (!rows[0])
    throw new StepStateError(`Step ${stepId} is not pending; refusing to start it again`);
  return (await getStep(db, userId, stepId))!;
}

/** Records what Apify reported on a poll: its status, and restarts or migrations seen. */
export async function recordStepPoll(
  db: Queryable,
  userId: UserId,
  stepId: string,
  poll: { apifyStatus: string; running: boolean; apifyRestarts?: number },
): Promise<RunStep | null> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE run_steps SET apify_status = $3, last_polled_at = now(), updated_at = now(),
            apify_restarts = GREATEST(apify_restarts, COALESCE($5, apify_restarts)),
            status = CASE WHEN $4 AND status = 'started' THEN 'running' ELSE status END
      WHERE user_id = $1 AND id = $2 AND status IN ('started', 'running') RETURNING id`,
    [userId, stepId, poll.apifyStatus, poll.running, poll.apifyRestarts ?? null],
  );
  return rows[0] ? getStep(db, userId, stepId) : null;
}

/**
 * Ends a step and marks its result applied. Call it in the same transaction that applies the
 * result (and settles its costs), so a crash leaves either all of it or none. Returns null
 * when the step was already completed, so a duplicate webhook or poll applies nothing twice.
 */
export async function completeStep(
  db: Queryable,
  userId: UserId,
  stepId: string,
  result: {
    status: 'finished' | 'failed';
    output?: unknown;
    error?: string;
    apifyStatus?: string;
  },
): Promise<RunStep | null> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE run_steps SET status = $3, output = COALESCE($4, output), error = COALESCE($5, error),
            apify_status = COALESCE($6, apify_status), processed_at = now(), finished_at = now(),
            updated_at = now()
      WHERE user_id = $1 AND id = $2 AND processed_at IS NULL RETURNING id`,
    [
      userId,
      stepId,
      result.status,
      result.output === undefined ? null : JSON.stringify(result.output),
      result.error ?? null,
      result.apifyStatus ?? null,
    ],
  );
  return rows[0] ? getStep(db, userId, stepId) : null;
}

/** Locks the step row for the rest of the transaction, so two callers can't apply it at once. */
export async function lockStep(
  db: Queryable,
  userId: UserId,
  stepId: string,
): Promise<RunStep | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM run_steps WHERE user_id = $1 AND id = $2 FOR UPDATE',
    [userId, stepId],
  );
  return rows[0] ? getStep(db, userId, stepId) : null;
}

/** Stores the max cost the step is about to be given (written with its estimate, before the call). */
export async function reserveStepCharge(
  db: Queryable,
  userId: UserId,
  stepId: string,
  maxChargeUsd: number,
): Promise<void> {
  await db.query(
    `UPDATE run_steps SET max_charge_usd = $3, updated_at = now()
      WHERE user_id = $1 AND id = $2 AND processed_at IS NULL`,
    [userId, stepId, maxChargeUsd],
  );
}

/** Takes back a step's reservation after its call was refused before anything started. */
export async function clearStepReservation(
  db: Queryable,
  userId: UserId,
  stepId: string,
): Promise<void> {
  await db.query(
    `UPDATE run_steps SET max_charge_usd = NULL, updated_at = now()
      WHERE user_id = $1 AND id = $2 AND processed_at IS NULL`,
    [userId, stepId],
  );
}

/**
 * Spend that unsettled steps may still add beyond their estimates: max cost minus estimate,
 * for the run and across all the user's runs (for the monthly cap).
 */
export async function reservedHeadroom(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<{ runUsd: number; userUsd: number }> {
  const { rows } = await db.query<{ run_usd: number; user_usd: number }>(
    `WITH open AS (
       SELECT s.run_id, GREATEST(s.max_charge_usd - COALESCE((SELECT sum(l.amount_usd)
                FROM cost_ledger l WHERE l.run_step_id = s.id), 0), 0) AS headroom
         FROM run_steps s
        WHERE s.user_id = $1 AND s.processed_at IS NULL AND s.max_charge_usd IS NOT NULL)
     SELECT COALESCE(sum(headroom) FILTER (WHERE run_id = $2), 0)::numeric AS run_usd,
            COALESCE(sum(headroom), 0)::numeric AS user_usd FROM open`,
    [userId, runId],
  );
  return { runUsd: rows[0]!.run_usd, userUsd: rows[0]!.user_usd };
}

/** Stores what a step's result came to; read by the Apify log. */
export async function setStepSummary(
  db: Queryable,
  userId: UserId,
  stepId: string,
  summary: StepSummary,
): Promise<void> {
  await db.query('UPDATE run_steps SET summary = $3 WHERE user_id = $1 AND id = $2', [
    userId,
    stepId,
    JSON.stringify(summary),
  ]);
}

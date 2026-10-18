import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

export const APIFY_STATES = [
  'started',
  'running',
  'restarting',
  'resumed',
  'finished',
  'failed',
] as const;
export type ApifyState = (typeof APIFY_STATES)[number];

export interface ApifyEvent {
  id: string;
  runId: string;
  runStepId: string;
  apifyRunId: string;
  state: ApifyState;
  message: string | null;
  occurredAt: Date;
}

interface Row {
  id: string;
  run_id: string;
  run_step_id: string;
  apify_run_id: string;
  state: ApifyState;
  message: string | null;
  occurred_at: Date;
}

const toEvent = (r: Row): ApifyEvent => ({
  id: r.id,
  runId: r.run_id,
  runStepId: r.run_step_id,
  apifyRunId: r.apify_run_id,
  state: r.state,
  message: r.message,
  occurredAt: r.occurred_at,
});

/** Appends a state change for a step's Apify run. Returns null if the step isn't this user's. */
export async function recordApifyEvent(
  db: Queryable,
  userId: UserId,
  input: { runStepId: string; state: ApifyState; message?: string; occurredAt?: Date },
): Promise<ApifyEvent | null> {
  const { rows } = await db.query<Row>(
    `INSERT INTO apify_events (user_id, run_id, run_step_id, apify_run_id, state, message, occurred_at)
     SELECT $1, s.run_id, s.id, s.apify_run_id, $3, $4, COALESCE($5, now())
       FROM run_steps s WHERE s.user_id = $1 AND s.id = $2 AND s.apify_run_id IS NOT NULL
     RETURNING *`,
    [userId, input.runStepId, input.state, input.message ?? null, input.occurredAt ?? null],
  );
  return rows[0] ? toEvent(rows[0]) : null;
}

/** Latest events across all of the user's runs: the feed for the Apify log widget. */
export async function listRecentApifyEvents(
  db: Queryable,
  userId: UserId,
  limit = 50,
): Promise<ApifyEvent[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM apify_events WHERE user_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT $2',
    [userId, limit],
  );
  return rows.map(toEvent);
}

export async function listApifyEventsForRun(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<ApifyEvent[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM apify_events WHERE user_id = $1 AND run_id = $2 ORDER BY occurred_at, id',
    [userId, runId],
  );
  return rows.map(toEvent);
}

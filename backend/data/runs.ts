import type { Run, RunStage, RunStatus } from '@lead-gen-crm/shared';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

interface Row {
  id: string;
  region_id: string;
  sectors: string[];
  status: RunStatus;
  current_stage: RunStage | null;
  spend_cap_usd: number;
  spent_usd: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const toRun = (r: Row): Run => ({
  id: r.id,
  region: r.region_id,
  sectors: r.sectors,
  status: r.status,
  currentStage: r.current_stage,
  spendCapUsd: r.spend_cap_usd,
  spentUsd: r.spent_usd,
  createdAt: r.created_at.toISOString(),
  finishedAt: r.finished_at?.toISOString() ?? null,
});

export async function createRun(
  db: Queryable,
  userId: UserId,
  input: { regionId: string; sectors?: string[]; spendCapUsd: number },
): Promise<Run> {
  const { rows } = await db.query<Row>(
    `INSERT INTO runs (user_id, region_id, sectors, spend_cap_usd) VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, input.regionId, input.sectors ?? [], input.spendCapUsd],
  );
  return toRun(rows[0]!);
}

export async function getRun(db: Queryable, userId: UserId, runId: string): Promise<Run | null> {
  const { rows } = await db.query<Row>('SELECT * FROM runs WHERE user_id = $1 AND id = $2', [
    userId,
    runId,
  ]);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function listRuns(db: Queryable, userId: UserId, limit = 50): Promise<Run[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit],
  );
  return rows.map(toRun);
}

/** Sets status and stage; stamps started_at / finished_at on the matching transitions. */
export async function updateRun(
  db: Queryable,
  userId: UserId,
  runId: string,
  update: { status?: RunStatus; currentStage?: RunStage | null; error?: string | null },
): Promise<Run | null> {
  const { rows } = await db.query<Row>(
    `UPDATE runs SET
       status = COALESCE($3, status),
       current_stage = CASE WHEN $4 THEN $5 ELSE current_stage END,
       error = CASE WHEN $6 THEN $7 ELSE error END,
       started_at = CASE WHEN $3 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
       finished_at = CASE WHEN $3 IN ('finished', 'failed', 'cancelled') THEN now() ELSE finished_at END
     WHERE user_id = $1 AND id = $2 RETURNING *`,
    [
      userId,
      runId,
      update.status ?? null,
      'currentStage' in update,
      update.currentStage ?? null,
      'error' in update,
      update.error ?? null,
    ],
  );
  return rows[0] ? toRun(rows[0]) : null;
}

/** Adds spend to the run and returns the new total. */
export async function addRunSpend(
  db: Queryable,
  userId: UserId,
  runId: string,
  usd: number,
): Promise<number | null> {
  const { rows } = await db.query<{ spent_usd: number }>(
    'UPDATE runs SET spent_usd = spent_usd + $3 WHERE user_id = $1 AND id = $2 RETURNING spent_usd',
    [userId, runId, usd],
  );
  return rows[0]?.spent_usd ?? null;
}

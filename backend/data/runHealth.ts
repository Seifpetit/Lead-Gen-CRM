import type { RunProblem } from '@lead-gen-crm/shared';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// The facts the watchdog needs about a run, and where it keeps what it concludes.

/** The last time anything was written for the run (its newest log line), else when it was created. */
export async function runLastActivity(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<Date | null> {
  const { rows } = await db.query<{ at: Date | null }>(
    `SELECT GREATEST(r.created_at, COALESCE(max(l.occurred_at), r.created_at)) AS at
       FROM runs r LEFT JOIN run_log l ON l.run_id = r.id
      WHERE r.user_id = $1 AND r.id = $2 GROUP BY r.id`,
    [userId, runId],
  );
  return rows[0]?.at ?? null;
}

/**
 * What the steps that have been settled were estimated at and what they really cost. A step is
 * settled once it has an actual cost row; the estimate is the first one written for it.
 */
export async function runSettledSpend(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<{ estimatedUsd: number; actualUsd: number }> {
  const { rows } = await db.query<{ est: number; act: number }>(
    `SELECT COALESCE(sum(amount_usd) FILTER (WHERE kind = 'estimated' AND corrects_id IS NULL AND amount_usd > 0), 0) AS est,
            COALESCE(sum(amount_usd) FILTER (WHERE kind = 'actual'), 0) AS act
       FROM cost_ledger
      WHERE user_id = $1 AND run_id = $2
        AND run_step_id IN (SELECT run_step_id FROM cost_ledger
                             WHERE user_id = $1 AND run_id = $2 AND kind = 'actual' AND run_step_id IS NOT NULL)`,
    [userId, runId],
  );
  return { estimatedUsd: rows[0]!.est, actualUsd: rows[0]!.act };
}

/** What the user was really charged on each recent UTC day, today first; days with no spend are left out. */
export async function dailyActualSpend(
  db: Queryable,
  userId: UserId,
  now: Date,
  days = 8,
): Promise<{ today: number; earlier: number[] }> {
  const { rows } = await db.query<{ day: string; usd: number }>(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(amount_usd) AS usd
       FROM cost_ledger
      WHERE user_id = $1 AND kind = 'actual'
        AND created_at >= ($2::timestamptz - make_interval(days => $3))
      GROUP BY 1 ORDER BY 1 DESC`,
    [userId, now, days],
  );
  const today = now.toISOString().slice(0, 10);
  return {
    today: rows.find((r) => r.day === today)?.usd ?? 0,
    earlier: rows.filter((r) => r.day !== today && r.usd > 0).map((r) => r.usd),
  };
}

export async function getRunProblem(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<RunProblem | null> {
  const { rows } = await db.query<{ problem: RunProblem | null }>(
    'SELECT problem FROM runs WHERE user_id = $1 AND id = $2',
    [userId, runId],
  );
  return rows[0]?.problem ?? null;
}

/** Sets or clears (null) the run's problem. True when this changed what is stored. */
export async function setRunProblem(
  db: Queryable,
  userId: UserId,
  runId: string,
  problem: RunProblem | null,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE runs SET problem = $3::jsonb
      WHERE user_id = $1 AND id = $2 AND problem IS DISTINCT FROM $3::jsonb`,
    [userId, runId, problem === null ? null : JSON.stringify(problem)],
  );
  return (rowCount ?? 0) > 0;
}

/** A finished run keeps no problem: it is no longer going anywhere. */
export async function clearEndedRunProblems(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE runs SET problem = NULL
      WHERE problem IS NOT NULL AND status NOT IN ('pending', 'running')`,
  );
}

import type { CountryCode, Run, RunMode, RunStage, RunStatus } from '@lead-gen-crm/shared';
import { withTransaction, type Queryable } from './db.js';
import { trustedUserId, type UserId } from './ids.js';

interface Row {
  id: string;
  region_id: string;
  country: CountryCode;
  sectors: string[];
  custom_only: boolean;
  custom_wordings: string[];
  cell_keys: string[];
  mode: RunMode;
  status: RunStatus;
  current_stage: RunStage | null;
  budget_cap_usd: number;
  spent_usd: number;
  reserved_usd: number;
  places_dropped_outside: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

// Spend is summed from the cost ledger, never stored on the run. "Spent" counts what providers
// really charged (actual rows); "reserved" is the estimate held for steps still in progress. A
// step's estimate is swapped for its actual when it ends, so showing both in one number made
// the total drop as the run went on.
const SELECT_RUN = `SELECT r.*,
    COALESCE((SELECT sum(l.amount_usd) FILTER (WHERE l.kind = 'actual') FROM cost_ledger l WHERE l.run_id = r.id), 0) AS spent_usd,
    COALESCE((SELECT sum(l.amount_usd) FILTER (WHERE l.kind = 'estimated') FROM cost_ledger l WHERE l.run_id = r.id), 0) AS reserved_usd
  FROM runs r`;

const toRun = (r: Row): Run => ({
  id: r.id,
  region: r.region_id,
  country: r.country,
  sectors: r.sectors,
  customOnly: r.custom_only,
  customWordings: r.custom_wordings,
  cellKeys: r.cell_keys,
  mode: r.mode,
  status: r.status,
  currentStage: r.current_stage,
  budgetCapUsd: r.budget_cap_usd,
  spentUsd: r.spent_usd,
  reservedUsd: r.reserved_usd,
  placesDroppedOutside: r.places_dropped_outside,
  createdAt: r.created_at.toISOString(),
  finishedAt: r.finished_at?.toISOString() ?? null,
});

export interface CreateRunInput {
  regionId: string;
  sectors?: string[];
  customOnly?: boolean;
  customWordings?: string[];
  cellKeys?: string[];
  budgetCapUsd: number;
  mode?: RunMode;
}

export async function createRun(
  db: Queryable,
  userId: UserId,
  input: CreateRunInput,
): Promise<Run> {
  const { rows } = await db.query<Row>(
    `INSERT INTO runs (user_id, region_id, sectors, custom_only, custom_wordings, cell_keys,
                       budget_cap_usd, mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *, 0 AS spent_usd, 0 AS reserved_usd`,
    [
      userId,
      input.regionId,
      input.sectors ?? [],
      input.customOnly ?? false,
      input.customWordings ?? [],
      input.cellKeys ?? [],
      input.budgetCapUsd,
      input.mode ?? 'normal',
    ],
  );
  return toRun(rows[0]!);
}

/** Adds to the count of places a run discarded for lying outside the region's outline. */
export async function addDroppedPlaces(
  db: Queryable,
  userId: UserId,
  runId: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  await db.query(
    'UPDATE runs SET places_dropped_outside = places_dropped_outside + $3 WHERE user_id = $1 AND id = $2',
    [userId, runId, count],
  );
}

export async function getRun(db: Queryable, userId: UserId, runId: string): Promise<Run | null> {
  const { rows } = await db.query<Row>(`${SELECT_RUN} WHERE r.user_id = $1 AND r.id = $2`, [
    userId,
    runId,
  ]);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function listRuns(db: Queryable, userId: UserId, limit = 50): Promise<Run[]> {
  const { rows } = await db.query<Row>(
    `${SELECT_RUN} WHERE r.user_id = $1 AND r.kind = 'search' ORDER BY r.created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toRun);
}

/** Sets status and stage; stamps started_at / finished_at on the matching transitions. */
export async function updateRun(
  db: Queryable,
  userId: UserId,
  runId: string,
  update: {
    status?: RunStatus;
    currentStage?: RunStage | null;
    error?: string | null;
    /** Only apply when the run is in one of these statuses (e.g. never revive a stopped run). */
    onlyFrom?: RunStatus[];
  },
): Promise<Run | null> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE runs SET
       status = COALESCE($3, status),
       current_stage = CASE WHEN $4 THEN $5 ELSE current_stage END,
       error = CASE WHEN $6 THEN $7 ELSE error END,
       started_at = CASE WHEN $3 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
       finished_at = CASE WHEN $3 IN ('finished', 'failed', 'cancelled', 'stopped_by_cap')
                          THEN now() ELSE finished_at END
     WHERE user_id = $1 AND id = $2 AND ($8::text[] IS NULL OR status = ANY($8)) RETURNING id`,
    [
      userId,
      runId,
      update.status ?? null,
      'currentStage' in update,
      update.currentStage ?? null,
      'error' in update,
      update.error ?? null,
      update.onlyFrom ?? null,
    ],
  );
  return rows[0] ? getRun(db, userId, runId) : null;
}

export class RunLimitError extends Error {
  constructor(
    public readonly active: number,
    public readonly limit: number,
  ) {
    super(`${active} runs are already active (limit ${limit})`);
    this.name = 'RunLimitError';
  }
}

/**
 * Creates a run already marked running, unless the user has `maxActive` runs pending or
 * running. A per-user advisory lock makes the count and the insert one step, so two starts at
 * the same moment can't both slip under the limit.
 */
export async function createRunWithinLimit(
  db: Queryable,
  userId: UserId,
  input: CreateRunInput,
  maxActive: number,
): Promise<Run> {
  return withTransaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('runs:' || $1))", [userId]);
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM runs WHERE user_id = $1 AND status IN ('pending', 'running')`,
      [userId],
    );
    const active = rows[0]!.n;
    if (active >= maxActive) throw new RunLimitError(active, maxActive);
    const run = await createRun(tx, userId, input);
    return (await updateRun(tx, userId, run.id, { status: 'running' }))!;
  });
}

/** Marks the run alive. Claims are renewed separately (cellClaims.ts). */
export async function touchRun(db: Queryable, userId: UserId, runId: string): Promise<void> {
  await db.query('UPDATE runs SET heartbeat_at = now() WHERE user_id = $1 AND id = $2', [
    userId,
    runId,
  ]);
}

/** Runs that are pending or running now. */
export async function countActiveRuns(db: Queryable, userId: UserId): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::integer AS n FROM runs WHERE user_id = $1 AND status IN ('pending', 'running')",
    [userId],
  );
  return rows[0]!.n;
}

/** How many runs the user has ever started: the scheduler sends every fifth one exploring. */
export async function countRuns(db: Queryable, userId: UserId, country?: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM runs
      WHERE user_id = $1 AND kind = 'search' AND ($2::text IS NULL OR country = $2)`,
    [userId, country ?? null],
  );
  return rows[0]!.n;
}

/**
 * For startup recovery only: every user with a run that is still active, or that has an
 * Apify step still out, whatever its status. System-level, so it returns trusted user IDs.
 */
export async function listUsersWithUnfinishedWork(db: Queryable): Promise<UserId[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM runs WHERE status IN ('pending', 'running')
     UNION
     SELECT DISTINCT user_id FROM run_steps WHERE status IN ('started', 'running')`,
  );
  return rows.map((r) => trustedUserId(r.user_id));
}

/** The user's runs that still need the orchestrator: active, or with a step still out. */
export async function listUnfinishedRunIds(db: Queryable, userId: UserId): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM runs r WHERE r.user_id = $1 AND (r.status IN ('pending', 'running')
        OR EXISTS (SELECT 1 FROM run_steps s WHERE s.run_id = r.id AND s.status IN ('started', 'running')))
      ORDER BY r.created_at`,
    [userId],
  );
  return rows.map((r) => r.id);
}

import type {
  DevHistoryEntry,
  DevStep,
  DevStepInput,
  DevStepOutput,
  DevStepStatus,
} from '@lead-gen-crm/shared';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// The developer console's history, and the hidden run its spend is recorded on. Debugging only:
// nothing here touches companies, contacts, leads, coverage or search queries.

interface Row {
  id: string;
  step: DevStep;
  status: DevStepStatus;
  input: DevStepInput;
  output: DevStepOutput | null;
  cost_usd: string | number;
  error: string | null;
  created_at: Date;
  email: string;
}

const SELECT = `SELECT d.id, d.step, d.status, d.input, d.output, d.cost_usd, d.error, d.created_at,
                       u.email
                  FROM dev_steps d JOIN users u ON u.id = d.user_id`;

const toEntry = (r: Row, summary: (r: Row) => string): DevHistoryEntry => ({
  id: r.id,
  step: r.step,
  status: r.status,
  summary: summary(r),
  input: r.input,
  output: r.output,
  costUsd: Number(r.cost_usd),
  error: r.error,
  createdAt: r.created_at.toISOString(),
  by: r.email,
});

/** One line for the list: what was asked and what came of it. */
function summaryOf(r: Row): string {
  if (r.step === 'discover') {
    const input = r.input as { words?: string[]; country?: string };
    const words = (input.words ?? []).join(', ');
    const out = r.output as { counts?: { returned?: number } } | null;
    const tail = r.status === 'running' ? 'running' : `${out?.counts?.returned ?? 0} places`;
    return `${input.country ?? ''} · ${words} · ${tail}`;
  }
  const input = r.input as { companies?: unknown[]; country?: string };
  const out = r.output as { rows?: unknown[] } | null;
  const tail = r.status === 'running' ? 'running' : `${out?.rows?.length ?? 0} labelled`;
  return `${input.country ?? ''} · ${input.companies?.length ?? 0} companies · ${tail}`;
}

export async function insertDevStep(
  db: Queryable,
  userId: UserId,
  step: DevStep,
  input: DevStepInput,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO dev_steps (user_id, step, input) VALUES ($1, $2, $3) RETURNING id`,
    [userId, step, JSON.stringify(input)],
  );
  return rows[0]!.id;
}

export async function finishDevStep(
  db: Queryable,
  userId: UserId,
  id: string,
  result: {
    status: 'succeeded' | 'failed';
    output: DevStepOutput | null;
    costUsd: number;
    error: string | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE dev_steps SET status = $3, output = $4, cost_usd = $5, error = $6
      WHERE user_id = $1 AND id = $2`,
    [
      userId,
      id,
      result.status,
      result.output === null ? null : JSON.stringify(result.output),
      result.costUsd,
      result.error,
    ],
  );
}

export async function getDevStep(
  db: Queryable,
  userId: UserId,
  id: string,
): Promise<DevHistoryEntry | null> {
  const { rows } = await db.query<Row>(`${SELECT} WHERE d.user_id = $1 AND d.id = $2`, [
    userId,
    id,
  ]);
  return rows[0] ? toEntry(rows[0], summaryOf) : null;
}

export async function listDevSteps(
  db: Queryable,
  userId: UserId,
  step: DevStep | null,
  limit = 50,
): Promise<DevHistoryEntry[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE d.user_id = $1 AND ($2::text IS NULL OR d.step = $2)
      ORDER BY d.created_at DESC, d.id DESC LIMIT $3`,
    [userId, step, limit],
  );
  return rows.map((r) => toEntry(r, summaryOf));
}

/** Deletes this user's history (one step or both). The cost ledger is never touched. */
export async function clearDevSteps(
  db: Queryable,
  userId: UserId,
  step: DevStep | null,
): Promise<number> {
  const res = await db.query(
    `DELETE FROM dev_steps WHERE user_id = $1 AND ($2::text IS NULL OR step = $2)
      AND status <> 'running'`,
    [userId, step],
  );
  return res.rowCount ?? 0;
}

/** Calls that were running when the server stopped will never finish: say so. */
export async function failStaleDevSteps(
  db: Queryable,
  userId: UserId,
  liveIds: readonly string[],
): Promise<void> {
  await db.query(
    `UPDATE dev_steps SET status = 'failed',
            error = 'The server stopped before this finished. Check the Apify console for what it spent.'
      WHERE user_id = $1 AND status = 'running' AND NOT (id::text = ANY($2::text[]))`,
    [userId, liveIds],
  );
}

/**
 * The run the spend of one console call is recorded on. It is created already finished and has a
 * kind of its own, so it is never resumed, never listed with the runs and never counted as one.
 */
export async function createDevRun(
  db: Queryable,
  userId: UserId,
  regionId: string,
  capUsd: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO runs (user_id, region_id, kind, status, budget_cap_usd, started_at, finished_at)
     VALUES ($1, $2, 'dev_step', 'finished', $3, now(), now()) RETURNING id`,
    [userId, regionId, capUsd],
  );
  return rows[0]!.id;
}

/** Of these Google place IDs, the ones this user already has as a company (read only). */
export async function knownPlaceIds(
  db: Queryable,
  userId: UserId,
  placeIds: readonly string[],
): Promise<Set<string>> {
  if (placeIds.length === 0) return new Set();
  const { rows } = await db.query<{ google_place_id: string }>(
    `SELECT google_place_id FROM companies
      WHERE user_id = $1 AND google_place_id = ANY($2::text[])`,
    [userId, placeIds],
  );
  return new Set(rows.map((r) => r.google_place_id));
}

/** The first region of a country (by id): where a call with no region of its own is recorded. */
export async function firstRegionOf(db: Queryable, country: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM regions WHERE country = $1 ORDER BY id LIMIT 1',
    [country],
  );
  return rows[0]?.id ?? null;
}

/** Every region with its bounds and leaf cells, for the console's area pickers (read only). */
export async function listAreas(db: Queryable): Promise<
  {
    regionId: string;
    name: string;
    country: string;
    bounds: { south: number; west: number; north: number; east: number } | null;
    cells: { cellKey: string; south: number; west: number; north: number; east: number }[];
  }[]
> {
  const regions = await db.query<{
    id: string;
    name: string;
    country: string;
    south: number | null;
    west: number | null;
    north: number | null;
    east: number | null;
  }>('SELECT id, name, country, south, west, north, east FROM regions ORDER BY country, name');
  const cells = await db.query<{
    region_id: string;
    cell_key: string;
    south: number;
    west: number;
    north: number;
    east: number;
  }>(
    `SELECT region_id, cell_key, south, west, north, east FROM region_cells c
      WHERE NOT EXISTS (SELECT 1 FROM region_cells k WHERE k.parent_cell_id = c.id)
      ORDER BY region_id, cell_key`,
  );
  return regions.rows.map((r) => ({
    regionId: r.id,
    name: r.name,
    country: r.country,
    bounds:
      r.south !== null && r.west !== null && r.north !== null && r.east !== null
        ? { south: r.south, west: r.west, north: r.north, east: r.east }
        : null,
    cells: cells.rows
      .filter((c) => c.region_id === r.id)
      .map((c) => ({
        cellKey: c.cell_key,
        south: c.south,
        west: c.west,
        north: c.north,
        east: c.east,
      })),
  }));
}

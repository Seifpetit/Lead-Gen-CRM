import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// A company's progress through one run. Only the runner writes these rows.

export const RUN_COMPANY_STATES = [
  'discovered',
  'qualified',
  'rejected',
  'review',
  'people_found',
  'enriched',
  'verified',
  'scored',
  'skipped',
] as const;
export type RunCompanyState = (typeof RUN_COMPANY_STATES)[number];

export interface RunCompany {
  runId: string;
  companyId: string;
  regionCellId: string | null;
  isNew: boolean;
  state: RunCompanyState;
  /** Stage outputs as JSON (dates as ISO strings). */
  payload: Record<string, unknown>;
  updatedAt: Date;
}

interface Row {
  run_id: string;
  company_id: string;
  region_cell_id: string | null;
  is_new: boolean;
  state: RunCompanyState;
  payload: Record<string, unknown>;
  updated_at: Date;
}

const toRunCompany = (r: Row): RunCompany => ({
  runId: r.run_id,
  companyId: r.company_id,
  regionCellId: r.region_cell_id,
  isNew: r.is_new,
  state: r.state,
  payload: r.payload,
  updatedAt: r.updated_at,
});

/** Adds a company to a run. A second add for the same pair is ignored (first one wins). */
export async function addRunCompany(
  db: Queryable,
  userId: UserId,
  input: {
    runId: string;
    companyId: string;
    regionCellId: string | null;
    isNew: boolean;
    state: RunCompanyState;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO run_companies (run_id, company_id, user_id, region_cell_id, is_new, state, payload)
     SELECT r.id, c.id, $1, $4, $5, $6, $7 FROM runs r, companies c
      WHERE r.user_id = $1 AND r.id = $2 AND c.user_id = $1 AND c.id = $3
     ON CONFLICT (run_id, company_id) DO NOTHING`,
    [
      userId,
      input.runId,
      input.companyId,
      input.regionCellId,
      input.isNew,
      input.state,
      JSON.stringify(input.payload),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Moves a company to its next state and merges `payload` into what it carries, only from the
 * expected state, so a stage applied twice changes nothing the second time.
 */
export async function moveRunCompany(
  db: Queryable,
  userId: UserId,
  input: {
    runId: string;
    companyId: string;
    from: RunCompanyState;
    to: RunCompanyState;
    payload?: Record<string, unknown>;
  },
): Promise<boolean> {
  const res = await db.query(
    `UPDATE run_companies SET state = $5, payload = payload || $6::jsonb, updated_at = now()
      WHERE user_id = $1 AND run_id = $2 AND company_id = $3 AND state = $4`,
    [
      userId,
      input.runId,
      input.companyId,
      input.from,
      input.to,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listRunCompanies(
  db: Queryable,
  userId: UserId,
  runId: string,
  states?: readonly RunCompanyState[],
): Promise<RunCompany[]> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM run_companies WHERE user_id = $1 AND run_id = $2
        AND ($3::text[] IS NULL OR state = ANY($3))
      ORDER BY company_id`,
    [userId, runId, states ?? null],
  );
  return rows.map(toRunCompany);
}

export async function countRunCompanies(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<Partial<Record<RunCompanyState, number>>> {
  const { rows } = await db.query<{ state: RunCompanyState; n: number }>(
    `SELECT state, count(*)::integer AS n FROM run_companies
      WHERE user_id = $1 AND run_id = $2 GROUP BY state`,
    [userId, runId],
  );
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}

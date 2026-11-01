import { QUERY_SET } from '../config/querySet.js';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

// Raw numbers behind GET /api/coverage: per region and sector, from search_queries, leads and
// the cost ledger. runner/coverage.ts turns them into entries. One user's data only.

export interface QueryTotals {
  regionId: string;
  sectorId: string | null;
  queries: number;
  newPlaces: number;
  /** When the last of these searches ran. */
  lastAt: Date | null;
}

export async function queryTotalsByRegionSector(
  db: Queryable,
  userId: UserId,
): Promise<QueryTotals[]> {
  const { rows } = await db.query<{
    region_id: string;
    sector_id: string | null;
    queries: number;
    new_places: number;
    last_at: Date | null;
  }>(
    `SELECT rc.region_id, q.sector_id, count(*)::integer AS queries,
            COALESCE(sum(q.new_places_found), 0)::integer AS new_places,
            max(q.created_at) AS last_at
       FROM search_queries q JOIN region_cells rc ON rc.id = q.region_cell_id
      WHERE q.user_id = $1 AND q.query_set = $2 GROUP BY 1, 2`,
    [userId, QUERY_SET],
  );
  return rows.map((r) => ({
    regionId: r.region_id,
    sectorId: r.sector_id,
    queries: r.queries,
    newPlaces: r.new_places,
    lastAt: r.last_at,
  }));
}

/** Leads by the region and sector of their company. */
export async function leadTotalsByRegionSector(
  db: Queryable,
  userId: UserId,
): Promise<{ regionId: string; sectorId: string | null; leads: number }[]> {
  const { rows } = await db.query<{ governorate: string; sector: string | null; leads: number }>(
    `SELECT co.governorate, co.sector, count(*)::integer AS leads
       FROM crm_leads cl JOIN companies co ON co.id = cl.company_id
      WHERE cl.user_id = $1 GROUP BY 1, 2`,
    [userId],
  );
  return rows.map((r) => ({ regionId: r.governorate, sectorId: r.sector, leads: r.leads }));
}

export interface StepSpend {
  regionId: string;
  usd: number;
  /** Null for ledger rows with no step (e.g. model calls during qualify). */
  stage: string | null;
  /** The sector a discovery step searched. */
  sectorId: string | null;
  /** The company a people search was for. */
  companyId: string | null;
  /** The companies an email batch looked up. */
  refCompanyIds: string[];
}

/** The ledger's settled spend per step, with what each step was for. */
export async function spendByStep(db: Queryable, userId: UserId): Promise<StepSpend[]> {
  const { rows } = await db.query<{
    region_id: string;
    usd: number;
    stage: string | null;
    sector_id: string | null;
    company_id: string | null;
    ref_company_ids: string[] | null;
  }>(
    `SELECT r.region_id, sum(l.amount_usd) AS usd, s.stage,
            s.input ->> 'sectorId' AS sector_id,
            s.input ->> 'companyId' AS company_id,
            CASE WHEN jsonb_typeof(s.input -> 'refs') = 'array'
                 THEN (SELECT array_agg(DISTINCT x ->> 'companyId')
                         FROM jsonb_array_elements(s.input -> 'refs') x) END AS ref_company_ids
       FROM cost_ledger l
       JOIN runs r ON r.id = l.run_id
       LEFT JOIN run_steps s ON s.id = l.run_step_id
      WHERE l.user_id = $1
      GROUP BY r.region_id, l.run_step_id, s.stage, s.input`,
    [userId],
  );
  return rows.map((r) => ({
    regionId: r.region_id,
    usd: Number(r.usd),
    stage: r.stage,
    sectorId: r.sector_id,
    companyId: r.company_id,
    refCompanyIds: r.ref_company_ids ?? [],
  }));
}

export async function companySectors(
  db: Queryable,
  userId: UserId,
): Promise<Map<string, string | null>> {
  const { rows } = await db.query<{ id: string; sector: string | null }>(
    'SELECT id, sector FROM companies WHERE user_id = $1',
    [userId],
  );
  return new Map(rows.map((r) => [r.id, r.sector]));
}

/** Per region: its leaf cells, which are exhausted, and which wordings are exhausted where. */
export async function exhaustionByRegion(
  db: Queryable,
  userId: UserId,
): Promise<
  Map<string, { cells: string[]; exhaustedCells: Set<string>; wordings: Map<string, Set<string>> }>
> {
  const out = new Map<
    string,
    { cells: string[]; exhaustedCells: Set<string>; wordings: Map<string, Set<string>> }
  >();
  const entry = (regionId: string) => {
    let e = out.get(regionId);
    if (!e) {
      e = { cells: [], exhaustedCells: new Set(), wordings: new Map() };
      out.set(regionId, e);
    }
    return e;
  };
  const cells = await db.query<{ id: string; region_id: string; exhausted: boolean }>(
    `SELECT rc.id, rc.region_id, (cov.exhausted_at IS NOT NULL) AS exhausted
       FROM region_cells rc
       LEFT JOIN region_coverage cov ON cov.region_cell_id = rc.id AND cov.user_id = $1
      WHERE NOT EXISTS (SELECT 1 FROM region_cells k WHERE k.parent_cell_id = rc.id)`,
    [userId],
  );
  for (const c of cells.rows) {
    const e = entry(c.region_id);
    e.cells.push(c.id);
    if (c.exhausted) e.exhaustedCells.add(c.id);
  }
  const words = await db.query<{ region_id: string; region_cell_id: string; q: string }>(
    `SELECT rc.region_id, x.region_cell_id, x.normalized_query AS q
       FROM exhausted_queries x JOIN region_cells rc ON rc.id = x.region_cell_id
      WHERE x.user_id = $1`,
    [userId],
  );
  for (const w of words.rows) {
    const byCell = entry(w.region_id).wordings;
    const set = byCell.get(w.region_cell_id) ?? new Set<string>();
    set.add(w.q);
    byCell.set(w.region_cell_id, set);
  }
  return out;
}

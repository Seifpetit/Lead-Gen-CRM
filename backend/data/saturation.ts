import { QUERY_SET } from '../config/querySet.js';
import type { CountryCode } from '@lead-gen-crm/shared';
import type { Bounds } from '../lib/geo.js';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';
import { normalizeQuery } from './normalize.js';

// Exhaustion (wordings and cells) and saturation (regions), plus the per-cell and per-region
// history the coverage scheduler ranks on. Spend always comes from cost_ledger.

export async function markQueryExhausted(
  db: Queryable,
  userId: UserId,
  regionCellId: string,
  query: string,
): Promise<void> {
  await db.query(
    `INSERT INTO exhausted_queries (user_id, region_cell_id, normalized_query) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, regionCellId, normalizeQuery(query)],
  );
}

/** Every exhausted wording in a region's cells. */
export async function listExhaustedQueries(
  db: Queryable,
  userId: UserId,
  regionId: string,
): Promise<{ regionCellId: string; normalizedQuery: string }[]> {
  const { rows } = await db.query<{ region_cell_id: string; normalized_query: string }>(
    `SELECT e.region_cell_id, e.normalized_query FROM exhausted_queries e
       JOIN region_cells rc ON rc.id = e.region_cell_id
      WHERE e.user_id = $1 AND rc.region_id = $2 ORDER BY 1, 2`,
    [userId, regionId],
  );
  return rows.map((r) => ({ regionCellId: r.region_cell_id, normalizedQuery: r.normalized_query }));
}

export async function markCellExhausted(
  db: Queryable,
  userId: UserId,
  regionCellId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO region_coverage AS c (user_id, region_cell_id, exhausted_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id, region_cell_id) DO UPDATE SET
       exhausted_at = COALESCE(c.exhausted_at, now()), updated_at = now()`,
    [userId, regionCellId],
  );
}

export type RegionMode = 'active' | 'saturated';

export async function setRegionMode(
  db: Queryable,
  userId: UserId,
  regionId: string,
  mode: RegionMode,
): Promise<void> {
  await db.query(
    `INSERT INTO region_status AS s (user_id, region_id, mode, saturated_at)
     VALUES ($1, $2, $3, CASE WHEN $3 = 'saturated' THEN now() END)
     ON CONFLICT (user_id, region_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       saturated_at = CASE WHEN EXCLUDED.mode = 'saturated' THEN COALESCE(s.saturated_at, now()) END,
       updated_at = now()`,
    [userId, regionId, mode],
  );
}

/** One leaf cell's history for the scheduler. */
export interface CellStats {
  regionCellId: string;
  cellKey: string;
  bounds: Bounds;
  spendUsd: number;
  leads: number;
  queriesRun: number;
  placesFound: number;
  newPlacesFound: number;
  lastRunAt: Date | null;
  exhaustedAt: Date | null;
  /** Held right now by a live claim of another of the user's runs. */
  claimedByRunId: string | null;
}

export async function listCellStats(
  db: Queryable,
  userId: UserId,
  regionId: string,
): Promise<CellStats[]> {
  const { rows } = await db.query<{
    id: string;
    cell_key: string;
    south: number;
    west: number;
    north: number;
    east: number;
    spend: number;
    leads: number;
    queries: number;
    places: number;
    new_places: number;
    last_run_at: Date | null;
    exhausted_at: Date | null;
    claimed_by: string | null;
  }>(
    `SELECT rc.id, rc.cell_key, rc.south, rc.west, rc.north, rc.east,
            COALESCE((SELECT sum(amount_usd) FROM cost_ledger l
                       WHERE l.user_id = $1 AND l.region_cell_id = rc.id), 0) AS spend,
            (SELECT count(*)::integer FROM crm_leads cl JOIN companies co ON co.id = cl.company_id
              WHERE cl.user_id = $1 AND co.region_cell_id = rc.id) AS leads,
            (SELECT count(*)::integer FROM search_queries q
              WHERE q.user_id = $1 AND q.query_set = $3 AND q.region_cell_id = rc.id) AS queries,
            COALESCE((SELECT sum(results_returned)::integer FROM search_queries q
              WHERE q.user_id = $1 AND q.query_set = $3 AND q.region_cell_id = rc.id), 0) AS places,
            COALESCE((SELECT sum(new_places_found)::integer FROM search_queries q
              WHERE q.user_id = $1 AND q.query_set = $3 AND q.region_cell_id = rc.id), 0) AS new_places,
            cov.last_run_at, cov.exhausted_at,
            (SELECT run_id FROM cell_claims k
              WHERE k.user_id = $1 AND k.region_cell_id = rc.id AND k.expires_at >= now()) AS claimed_by
       FROM region_cells rc
       LEFT JOIN region_coverage cov ON cov.region_cell_id = rc.id AND cov.user_id = $1
      WHERE rc.region_id = $2
        AND NOT EXISTS (SELECT 1 FROM region_cells k WHERE k.parent_cell_id = rc.id)
      ORDER BY rc.cell_key`,
    [userId, regionId, QUERY_SET],
  );
  return rows.map((r) => ({
    regionCellId: r.id,
    cellKey: r.cell_key,
    bounds: { south: r.south, west: r.west, north: r.north, east: r.east },
    spendUsd: r.spend,
    leads: r.leads,
    queriesRun: r.queries,
    placesFound: r.places,
    newPlacesFound: r.new_places,
    lastRunAt: r.last_run_at,
    exhaustedAt: r.exhausted_at,
    claimedByRunId: r.claimed_by,
  }));
}

/** One region's history for suggestNextRegion. */
export interface RegionStats {
  regionId: string;
  name: string;
  country: CountryCode;
  bounds: Bounds | null;
  cellsTotal: number;
  cellsExhausted: number;
  cellsSearched: number;
  mode: RegionMode;
  saturatedAt: Date | null;
  spendUsd: number;
  leads: number;
  runs: number;
  lastRunAt: Date | null;
}

export async function listRegionStats(
  db: Queryable,
  userId: UserId,
  country?: string,
): Promise<RegionStats[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    country: CountryCode;
    south: number | null;
    west: number | null;
    north: number | null;
    east: number | null;
    cells_total: number;
    cells_exhausted: number;
    cells_searched: number;
    mode: RegionMode | null;
    saturated_at: Date | null;
    spend: number;
    leads: number;
    runs: number;
    last_run_at: Date | null;
  }>(
    `SELECT g.id, g.name, g.country, g.south, g.west, g.north, g.east,
            (SELECT count(*)::integer FROM region_cells rc WHERE rc.region_id = g.id
               AND NOT EXISTS (SELECT 1 FROM region_cells k WHERE k.parent_cell_id = rc.id)) AS cells_total,
            (SELECT count(*)::integer FROM region_coverage c JOIN region_cells rc ON rc.id = c.region_cell_id
              WHERE c.user_id = $1 AND rc.region_id = g.id AND c.exhausted_at IS NOT NULL) AS cells_exhausted,
            (SELECT count(DISTINCT q.region_cell_id)::integer FROM search_queries q
               JOIN region_cells rc ON rc.id = q.region_cell_id
              WHERE q.user_id = $1 AND q.query_set = $2 AND rc.region_id = g.id) AS cells_searched,
            s.mode, s.saturated_at,
            COALESCE((SELECT sum(l.amount_usd) FROM cost_ledger l JOIN runs r ON r.id = l.run_id
                       WHERE l.user_id = $1 AND r.region_id = g.id), 0) AS spend,
            (SELECT count(*)::integer FROM crm_leads cl JOIN runs r ON r.id = cl.run_id
              WHERE cl.user_id = $1 AND r.region_id = g.id) AS leads,
            (SELECT count(*)::integer FROM runs r WHERE r.user_id = $1 AND r.kind = 'search' AND r.region_id = g.id) AS runs,
            (SELECT max(r.created_at) FROM runs r WHERE r.user_id = $1 AND r.kind = 'search' AND r.region_id = g.id) AS last_run_at
       FROM regions g
       LEFT JOIN region_status s ON s.region_id = g.id AND s.user_id = $1
      WHERE ($3::text IS NULL OR g.country = $3)
      ORDER BY g.id`,
    [userId, QUERY_SET, country ?? null],
  );
  return rows.map((r) => ({
    regionId: r.id,
    name: r.name,
    country: r.country,
    bounds:
      r.south === null || r.west === null || r.north === null || r.east === null
        ? null
        : { south: r.south, west: r.west, north: r.north, east: r.east },
    cellsTotal: r.cells_total,
    cellsExhausted: r.cells_exhausted,
    cellsSearched: r.cells_searched,
    mode: r.mode ?? 'active',
    saturatedAt: r.saturated_at,
    spendUsd: r.spend,
    leads: r.leads,
    runs: r.runs,
    lastRunAt: r.last_run_at,
  }));
}

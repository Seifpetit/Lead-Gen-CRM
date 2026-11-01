import { QUERY_SET } from '../config/querySet.js';
import type { Queryable } from './db.js';
import type { UserId } from './ids.js';
import { normalizeQuery } from './normalize.js';

export interface SearchQueryInput {
  runId: string;
  runStepId?: string | null;
  regionCellId: string;
  /** e.g. 'google_maps' */
  provider: string;
  queryText: string;
  /** The sector the wording belongs to; null for a wording typed in. */
  sectorId?: string | null;
  requestsUsed: number;
  resultsReturned: number;
  /** Results not seen before in this user's companies. */
  newPlacesFound: number;
  costUsd: number;
  at?: Date;
}

export interface SearchQuery extends Required<
  Omit<SearchQueryInput, 'at' | 'runStepId' | 'sectorId'>
> {
  id: string;
  runStepId: string | null;
  sectorId: string | null;
  normalizedQuery: string;
  createdAt: Date;
}

/** How one wording has performed in one cell across all runs. */
export interface QueryYield {
  provider: string;
  normalizedQuery: string;
  timesRun: number;
  requestsUsed: number;
  resultsReturned: number;
  newPlacesFound: number;
  costUsd: number;
  /** New places from the most recent run of this wording: 0 suggests it is exhausted. */
  lastNewPlacesFound: number;
  lastRunAt: Date;
}

interface Row {
  id: string;
  run_id: string;
  run_step_id: string | null;
  region_cell_id: string;
  provider: string;
  query_text: string;
  normalized_query: string;
  sector_id: string | null;
  requests_used: number;
  results_returned: number;
  new_places_found: number;
  cost_usd: number;
  created_at: Date;
}

const toQuery = (r: Row): SearchQuery => ({
  id: r.id,
  runId: r.run_id,
  runStepId: r.run_step_id,
  regionCellId: r.region_cell_id,
  provider: r.provider,
  queryText: r.query_text,
  sectorId: r.sector_id,
  normalizedQuery: r.normalized_query,
  requestsUsed: r.requests_used,
  resultsReturned: r.results_returned,
  newPlacesFound: r.new_places_found,
  costUsd: r.cost_usd,
  createdAt: r.created_at,
});

/** Records one search. Returns null if the run isn't this user's. */
export async function recordSearchQuery(
  db: Queryable,
  userId: UserId,
  input: SearchQueryInput,
): Promise<SearchQuery | null> {
  const { rows } = await db.query<Row>(
    `INSERT INTO search_queries (user_id, run_id, run_step_id, region_cell_id, provider, query_text,
       normalized_query, sector_id, requests_used, results_returned, new_places_found, cost_usd,
       created_at, query_set)
     SELECT $1, r.id, $3, $4, $5, $6, $7, $13, $8, $9, $10, $11, COALESCE($12, now()), $14
       FROM runs r WHERE r.user_id = $1 AND r.id = $2
     RETURNING *`,
    [
      userId,
      input.runId,
      input.runStepId ?? null,
      input.regionCellId,
      input.provider,
      input.queryText.trim(),
      normalizeQuery(input.queryText),
      input.requestsUsed,
      input.resultsReturned,
      input.newPlacesFound,
      input.costUsd,
      input.at ?? null,
      input.sectorId ?? null,
      QUERY_SET,
    ],
  );
  return rows[0] ? toQuery(rows[0]) : null;
}

/** Per-wording yield in a cell, for deciding whether the cell or a wording is exhausted. */
export async function queryYieldForCell(
  db: Queryable,
  userId: UserId,
  regionCellId: string,
): Promise<QueryYield[]> {
  const { rows } = await db.query<{
    provider: string;
    normalized_query: string;
    times_run: number;
    requests_used: number;
    results_returned: number;
    new_places_found: number;
    cost_usd: number;
    last_new_places_found: number;
    last_run_at: Date;
  }>(
    `SELECT provider, normalized_query,
            count(*)::integer AS times_run,
            sum(requests_used)::integer AS requests_used,
            sum(results_returned)::integer AS results_returned,
            sum(new_places_found)::integer AS new_places_found,
            sum(cost_usd) AS cost_usd,
            (array_agg(new_places_found ORDER BY created_at DESC, id DESC))[1] AS last_new_places_found,
            max(created_at) AS last_run_at
       FROM search_queries
      WHERE user_id = $1 AND region_cell_id = $2 AND query_set = $3
      GROUP BY provider, normalized_query
      ORDER BY provider, normalized_query`,
    [userId, regionCellId, QUERY_SET],
  );
  return rows.map((r) => ({
    provider: r.provider,
    normalizedQuery: r.normalized_query,
    timesRun: r.times_run,
    requestsUsed: r.requests_used,
    resultsReturned: r.results_returned,
    newPlacesFound: r.new_places_found,
    costUsd: r.cost_usd,
    lastNewPlacesFound: r.last_new_places_found,
    lastRunAt: r.last_run_at,
  }));
}

export async function listSearchQueriesForRun(
  db: Queryable,
  userId: UserId,
  runId: string,
): Promise<SearchQuery[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM search_queries WHERE user_id = $1 AND run_id = $2 ORDER BY created_at, id',
    [userId, runId],
  );
  return rows.map(toQuery);
}

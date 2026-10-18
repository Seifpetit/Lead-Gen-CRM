import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

/** Raw counts, kept per cell. Shares are derived from them so they sum correctly. */
export interface CoverageCounts {
  placesFound: number;
  qualifiedCompanies: number;
  companiesWithDecisionMaker: number;
  decisionMakersWithChannel: number;
  leadsFound: number;
}

export interface CoverageShares {
  /** qualifiedCompanies / placesFound */
  qualifiedShare: number | null;
  /** companiesWithDecisionMaker / qualifiedCompanies */
  decisionMakerShare: number | null;
  /** decisionMakersWithChannel / companiesWithDecisionMaker */
  channelShare: number | null;
}

// Spend and cost per lead come from the cost ledger: see costLedger.ts.

export interface CellCoverage extends CoverageCounts, CoverageShares {
  regionCellId: string;
  lastRunAt: Date | null;
}

export interface RegionCoverage extends CoverageCounts, CoverageShares {
  regionId: string;
  cellsTotal: number;
  cellsCovered: number;
  lastRunAt: Date | null;
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function deriveShares(c: CoverageCounts): CoverageShares {
  return {
    qualifiedShare: ratio(c.qualifiedCompanies, c.placesFound),
    decisionMakerShare: ratio(c.companiesWithDecisionMaker, c.qualifiedCompanies),
    channelShare: ratio(c.decisionMakersWithChannel, c.companiesWithDecisionMaker),
  };
}

interface CountRow {
  places_found: number | null;
  qualified_companies: number | null;
  companies_with_decision_maker: number | null;
  decision_makers_with_channel: number | null;
  leads_found: number | null;
  last_run_at: Date | null;
}

function toCounts(r: CountRow): CoverageCounts {
  return {
    placesFound: r.places_found ?? 0,
    qualifiedCompanies: r.qualified_companies ?? 0,
    companiesWithDecisionMaker: r.companies_with_decision_maker ?? 0,
    decisionMakersWithChannel: r.decision_makers_with_channel ?? 0,
    leadsFound: r.leads_found ?? 0,
  };
}

/** Adds one run's results to a cell (counts are increments, not totals). */
export async function addCellCoverage(
  db: Queryable,
  userId: UserId,
  regionCellId: string,
  delta: Partial<CoverageCounts> & { runAt?: Date },
): Promise<CellCoverage> {
  await db.query(
    `INSERT INTO region_coverage AS c (user_id, region_cell_id, places_found, qualified_companies,
       companies_with_decision_maker, decision_makers_with_channel, leads_found, last_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, region_cell_id) DO UPDATE SET
       places_found = c.places_found + EXCLUDED.places_found,
       qualified_companies = c.qualified_companies + EXCLUDED.qualified_companies,
       companies_with_decision_maker = c.companies_with_decision_maker + EXCLUDED.companies_with_decision_maker,
       decision_makers_with_channel = c.decision_makers_with_channel + EXCLUDED.decision_makers_with_channel,
       leads_found = c.leads_found + EXCLUDED.leads_found,
       last_run_at = GREATEST(c.last_run_at, EXCLUDED.last_run_at),
       updated_at = now()`,
    [
      userId,
      regionCellId,
      delta.placesFound ?? 0,
      delta.qualifiedCompanies ?? 0,
      delta.companiesWithDecisionMaker ?? 0,
      delta.decisionMakersWithChannel ?? 0,
      delta.leadsFound ?? 0,
      delta.runAt ?? null,
    ],
  );
  return (await getCellCoverage(db, userId, regionCellId))!;
}

export async function getCellCoverage(
  db: Queryable,
  userId: UserId,
  regionCellId: string,
): Promise<CellCoverage | null> {
  const { rows } = await db.query<CountRow>(
    'SELECT * FROM region_coverage WHERE user_id = $1 AND region_cell_id = $2',
    [userId, regionCellId],
  );
  const r = rows[0];
  if (!r) return null;
  const counts = toCounts(r);
  return { regionCellId, ...counts, ...deriveShares(counts), lastRunAt: r.last_run_at };
}

/** Every cell of a region, including cells this user has never searched (all zeros). */
export async function listCellCoverage(
  db: Queryable,
  userId: UserId,
  regionId: string,
): Promise<CellCoverage[]> {
  const { rows } = await db.query<CountRow & { id: string }>(
    `SELECT rc.id, c.places_found, c.qualified_companies, c.companies_with_decision_maker,
            c.decision_makers_with_channel, c.leads_found, c.last_run_at
       FROM region_cells rc
       LEFT JOIN region_coverage c ON c.region_cell_id = rc.id AND c.user_id = $1
      WHERE rc.region_id = $2
      ORDER BY rc.cell_key`,
    [userId, regionId],
  );
  return rows.map((r) => {
    const counts = toCounts(r);
    return { regionCellId: r.id, ...counts, ...deriveShares(counts), lastRunAt: r.last_run_at };
  });
}

/** Every region rolled up from its cells, including regions never searched. */
export async function listCoverage(db: Queryable, userId: UserId): Promise<RegionCoverage[]> {
  const { rows } = await db.query<
    CountRow & { region_id: string; cells_total: number; cells_covered: number | null }
  >(
    `SELECT r.id AS region_id,
            (SELECT count(*)::integer FROM region_cells rc WHERE rc.region_id = r.id) AS cells_total,
            u.cells_covered, u.places_found, u.qualified_companies, u.companies_with_decision_maker,
            u.decision_makers_with_channel, u.leads_found, u.last_run_at
       FROM regions r
       LEFT JOIN region_coverage_rollup u ON u.region_id = r.id AND u.user_id = $1
      ORDER BY r.name`,
    [userId],
  );
  return rows.map((r) => {
    const counts = toCounts(r);
    return {
      regionId: r.region_id,
      cellsTotal: r.cells_total,
      cellsCovered: r.cells_covered ?? 0,
      ...counts,
      ...deriveShares(counts),
      lastRunAt: r.last_run_at,
    };
  });
}

export async function getCoverage(
  db: Queryable,
  userId: UserId,
  regionId: string,
): Promise<RegionCoverage | null> {
  return (await listCoverage(db, userId)).find((c) => c.regionId === regionId) ?? null;
}

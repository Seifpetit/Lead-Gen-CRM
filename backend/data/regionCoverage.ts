import type { Queryable } from './db.js';
import type { UserId } from './ids.js';

export interface RegionCoverage {
  regionId: string;
  placesFound: number;
  leadsFound: number;
  /** Shares are 0..1; null until a run has measured them. */
  qualifiedShare: number | null;
  decisionMakerShare: number | null;
  channelShare: number | null;
  spentUsd: number;
  costPerLeadUsd: number | null;
  lastRunAt: Date | null;
}

export type CoverageUpdate = Partial<Omit<RegionCoverage, 'regionId'>>;

const COLUMNS: Record<keyof CoverageUpdate, string> = {
  placesFound: 'places_found',
  leadsFound: 'leads_found',
  qualifiedShare: 'qualified_share',
  decisionMakerShare: 'decision_maker_share',
  channelShare: 'channel_share',
  spentUsd: 'spent_usd',
  costPerLeadUsd: 'cost_per_lead_usd',
  lastRunAt: 'last_run_at',
};

/** Sets the given stats for a region, creating the row on first use. */
export async function upsertCoverage(
  db: Queryable,
  userId: UserId,
  regionId: string,
  update: CoverageUpdate,
): Promise<RegionCoverage> {
  const entries = Object.entries(update).filter(([, v]) => v !== undefined) as [
    keyof CoverageUpdate,
    unknown,
  ][];
  const cols = entries.map(([k]) => COLUMNS[k]);
  const values = entries.map(([, v]) => v);
  const insertCols = ['user_id', 'region_id', ...cols].join(', ');
  const placeholders = ['$1', '$2', ...cols.map((_, i) => `$${i + 3}`)].join(', ');
  const set = ['updated_at = now()', ...cols.map((c) => `${c} = EXCLUDED.${c}`)].join(', ');
  await db.query(
    `INSERT INTO region_coverage (${insertCols}) VALUES (${placeholders})
     ON CONFLICT (user_id, region_id) DO UPDATE SET ${set}`,
    [userId, regionId, ...values],
  );
  return (await getCoverage(db, userId, regionId))!;
}

interface Row {
  region_id: string;
  places_found: number | null;
  leads_found: number | null;
  qualified_share: number | null;
  decision_maker_share: number | null;
  channel_share: number | null;
  spent_usd: number | null;
  cost_per_lead_usd: number | null;
  last_run_at: Date | null;
}

const toCoverage = (r: Row): RegionCoverage => ({
  regionId: r.region_id,
  placesFound: r.places_found ?? 0,
  leadsFound: r.leads_found ?? 0,
  qualifiedShare: r.qualified_share,
  decisionMakerShare: r.decision_maker_share,
  channelShare: r.channel_share,
  spentUsd: r.spent_usd ?? 0,
  costPerLeadUsd: r.cost_per_lead_usd,
  lastRunAt: r.last_run_at,
});

export async function getCoverage(
  db: Queryable,
  userId: UserId,
  regionId: string,
): Promise<RegionCoverage | null> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM region_coverage WHERE user_id = $1 AND region_id = $2',
    [userId, regionId],
  );
  return rows[0] ? toCoverage(rows[0]) : null;
}

/** Every region, including ones this user has never run (zero places, null shares). */
export async function listCoverage(db: Queryable, userId: UserId): Promise<RegionCoverage[]> {
  const { rows } = await db.query<Row>(
    `SELECT r.id AS region_id, c.places_found, c.leads_found, c.qualified_share,
            c.decision_maker_share, c.channel_share, c.spent_usd, c.cost_per_lead_usd, c.last_run_at
       FROM regions r
       LEFT JOIN region_coverage c ON c.region_id = r.id AND c.user_id = $1
      ORDER BY r.name`,
    [userId],
  );
  return rows.map(toCoverage);
}

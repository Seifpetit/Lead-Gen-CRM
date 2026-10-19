import type { Coverage, CoverageEntry, CoverageState, RegionSummary } from '@lead-gen-crm/shared';

// What the Coverage page shows and how it orders and colours it. Pure functions, no React.

export type Metric = 'status' | 'leads' | 'cost' | 'yield';
export const METRICS: readonly Metric[] = ['status', 'leads', 'cost', 'yield'];

export const STATES: readonly CoverageState[] = [
  'not_searched',
  'yielding',
  'saturated',
  'maintenance',
];

export interface CoverageRow {
  regionId: string;
  name: string;
  /** False for a region with nothing to show yet: no bounds, never run, no leads. */
  explored: boolean;
  /** Share of the region's cells searched, 0 to 1; null before it has cells. */
  coverage: number | null;
}

/**
 * A region is explored once there is anything to show for it. One with no bounds (so no run can
 * start in it), no run and no leads is greyed out and cannot be selected.
 */
export function isExplored(r: Pick<RegionSummary, 'hasBounds' | 'runs' | 'leads'>): boolean {
  return r.hasBounds || r.runs > 0 || r.leads > 0;
}

/**
 * Every region of the coverage as a row, in display order: explored regions first, most covered
 * first (ties by name), then the greyed ones alphabetically. Never drops a region.
 */
export function coverageRows(
  coverage: Pick<Coverage, 'regions'>,
  summaries: readonly RegionSummary[],
): CoverageRow[] {
  const byId = new Map(summaries.map((s) => [s.regionId, s]));
  const rows = coverage.regions.map((r): CoverageRow => {
    const s = byId.get(r.regionId);
    return {
      regionId: r.regionId,
      name: r.name,
      explored: s ? isExplored(s) : false,
      coverage: s?.coverage ?? null,
    };
  });
  const byName = (a: CoverageRow, b: CoverageRow) => a.name.localeCompare(b.name);
  const explored = rows
    .filter((r) => r.explored)
    .sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0) || byName(a, b));
  const greyed = rows.filter((r) => !r.explored).sort(byName);
  return [...explored, ...greyed];
}

/** The entry for a region and sector; a pair never searched has no row on the server. */
export function entryOf(
  coverage: Pick<Coverage, 'entries'>,
  regionId: string,
  sectorId: string | null,
): CoverageEntry {
  return (
    coverage.entries.find((e) => e.regionId === regionId && e.sectorId === sectorId) ?? {
      regionId,
      sectorId,
      queriesRun: 0,
      newPlaces: 0,
      leads: 0,
      spendUsd: 0,
      costPerLeadUsd: null,
      lastRunAt: null,
      state: 'not_searched',
    }
  );
}

/** New places per search: the yield the exhaustion rule watches. Null before any search. */
export function yieldOf(e: Pick<CoverageEntry, 'queriesRun' | 'newPlaces'>): number | null {
  return e.queriesRun > 0 ? e.newPlaces / e.queriesRun : null;
}

/** The number a metric shows for an entry; null for Status, which shows a state instead. */
export function metricValue(metric: Metric, e: CoverageEntry): number | null {
  if (metric === 'leads') return e.leads;
  if (metric === 'cost') return e.spendUsd;
  if (metric === 'yield') return yieldOf(e);
  return null;
}

/** 0 for nothing, then 1 to 4 by how close the value is to the largest one. */
export function intensity(value: number | null, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value === null || value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4;
}

/** The largest value of a metric over some entries, to scale the colours. */
export function metricMax(metric: Metric, entries: readonly CoverageEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, metricValue(metric, e) ?? 0), 0);
}

/** A value short enough for a small square: 12, 1.2k, 3.4. */
export function compactValue(metric: Metric, value: number | null): string {
  if (value === null || value <= 0) return '';
  if (metric === 'leads') return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

/**
 * The total at the foot of a sector's column over the given entries. Status counts the regions
 * that have been searched; Leads and Cost add up; Yield is new places per search overall.
 */
export function columnTotal(metric: Metric, entries: readonly CoverageEntry[]): number | null {
  if (metric === 'status') return entries.filter((e) => e.state !== 'not_searched').length;
  if (metric === 'leads') return entries.reduce((n, e) => n + e.leads, 0);
  if (metric === 'cost') return entries.reduce((n, e) => n + e.spendUsd, 0);
  const queries = entries.reduce((n, e) => n + e.queriesRun, 0);
  return queries > 0 ? entries.reduce((n, e) => n + e.newPlaces, 0) / queries : null;
}

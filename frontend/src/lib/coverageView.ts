import type { CoverageEntry, RegionSummary } from '@lead-gen-crm/shared';

// Small rules the Coverage map and Start a run share. Pure functions, no React.

/**
 * A region is explored once there is anything to show for it. One with no bounds (so no run can
 * start in it), no run and no leads is greyed out and cannot be selected.
 */
export function isExplored(r: Pick<RegionSummary, 'hasBounds' | 'runs' | 'leads'>): boolean {
  return r.hasBounds || r.runs > 0 || r.leads > 0;
}

/** New places per search: the yield the exhaustion rule watches. Null before any search. */
export function yieldOf(e: Pick<CoverageEntry, 'queriesRun' | 'newPlaces'>): number | null {
  return e.queriesRun > 0 ? e.newPlaces / e.queriesRun : null;
}

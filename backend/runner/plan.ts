import type { PlannedQuery, SectorInfo } from '@lead-gen-crm/shared';
import { FREIGHT_SECTORS } from '../config/sectors.js';
import type { DiscoveryQuery } from '../providers/types.js';

/** What a run searches. Stored on the run (sectors, customOnly, customWordings, cellKeys). */
export interface SearchPlan {
  sectors?: readonly string[];
  customOnly?: boolean;
  customWordings?: readonly string[];
  cellKeys?: readonly string[];
}

/** The sector filter for the query grid: undefined = all, [] = none (custom wordings only). */
export function gridSectorIds(plan: SearchPlan): string[] | undefined {
  if (plan.customOnly) return [];
  return plan.sectors && plan.sectors.length > 0 ? [...plan.sectors] : undefined;
}

export const PLANNED_QUERIES_SHOWN = 50;

export const plannedQuery = (q: DiscoveryQuery): PlannedQuery => ({
  wording: q.textQuery,
  sectorId: q.sectorId,
  cellKey: q.cellKey,
});

/** Every sector with the French wordings the grid searches for it. */
export function sectorList(): SectorInfo[] {
  return FREIGHT_SECTORS.map((s) => ({
    id: s.id,
    name: s.name,
    wordings: [...s.searchTermsFr],
  }));
}

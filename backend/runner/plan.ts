import type { PlannedQuery, SectorInfo } from '@lead-gen-crm/shared';
import { ACTIVE_SECTORS } from '../config/sectors.js';
import { cellOverlap, MIN_CELL_OVERLAP, type Bounds, type Outline } from '../lib/geo.js';
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
  return ACTIVE_SECTORS.map((s) => ({
    id: s.id,
    name: s.name,
    wordings: [...s.searchTermsFr],
  }));
}

/**
 * The cells worth searching: those with at least MIN_CELL_OVERLAP of their area inside the
 * region's outline, and each one's share inside it (1 for every cell when there is no
 * outline). Cells stored before this rule are filtered here too, so a run and its preview
 * agree on the same list.
 */
export function usableCells<T extends { cellKey: string; bounds: Bounds }>(
  cells: readonly T[],
  outline: Outline | null,
): { cells: T[]; overlap: Map<string, number> } {
  const overlap = new Map<string, number>();
  const kept: T[] = [];
  for (const cell of cells) {
    const share = outline ? cellOverlap(cell.bounds, outline) : 1;
    if (share < MIN_CELL_OVERLAP) continue;
    overlap.set(cell.cellKey, share);
    kept.push(cell);
  }
  return { cells: kept, overlap };
}

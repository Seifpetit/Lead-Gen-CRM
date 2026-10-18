import type { Bounds, Outline } from '../lib/geo.js';
import outlinesFile from './regionOutlines.json' with { type: 'json' };
import { REGION_BOUNDS } from './regionBounds.js';
import type { RegionGeometry } from '../data/regions.js';

/** Committed bounds and simplified outlines per governorate id, ready for `upsertRegions`. */
export function committedRegionGeometry(): Record<string, RegionGeometry> {
  const outlines = outlinesFile.outlines as Record<string, Outline>;
  const out: Record<string, RegionGeometry> = {};
  for (const id of new Set([...Object.keys(REGION_BOUNDS), ...Object.keys(outlines)])) {
    const bounds: Bounds | undefined = (REGION_BOUNDS as Record<string, Bounds>)[id];
    const outline = outlines[id];
    out[id] = { ...(bounds ? { bounds } : {}), ...(outline ? { outline } : {}) };
  }
  return out;
}

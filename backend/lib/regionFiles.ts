import type { Bounds } from './geo.js';

// The text of config/regionBounds.ts and config/regionOutlines.json, shared by the scripts that
// write them (regions:fetch, regions:derive-manouba) so both keep one format. Pure.

export interface DerivedNote {
  /** Why this region's geometry is not an OpenStreetMap polygon. */
  note: string;
  areaKm2: number;
  derivedAt: string;
}

export interface RegionFiles {
  fetchedAt: string;
  toleranceDeg: number;
  bounds: Record<string, Bounds>;
  outlines: Record<string, unknown>;
  /** Regions whose geometry was derived from their neighbours, by region id. */
  derived: Record<string, DerivedNote>;
}

export const OUTLINES_SOURCE = 'OpenStreetMap contributors (ODbL) via nominatim.openstreetmap.org';

export function renderOutlinesFile(f: RegionFiles): string {
  return JSON.stringify({
    source: OUTLINES_SOURCE,
    fetchedAt: f.fetchedAt,
    toleranceDeg: f.toleranceDeg,
    ...(Object.keys(f.derived).length > 0 ? { derived: f.derived } : {}),
    outlines: f.outlines,
  });
}

export function renderBoundsFile(f: RegionFiles): string {
  const derived = Object.entries(f.derived);
  return `import type { Bounds } from '../lib/geo.js';
import type { GovernorateId } from './regions.js';

/**
 * Bounding box of each governorate, from OpenStreetMap (Nominatim \`boundingbox\` of the
 * governorate relation). Written by \`npm run regions:fetch\`; do not edit by hand (use
 * \`npm run regions:set-bounds\` for a manual fix, which the seed then leaves alone).
 *
 * Source: OpenStreetMap contributors, ODbL, via nominatim.openstreetmap.org.
 * Fetched: ${f.fetchedAt}.
${derived.map(([id, d]) => ` *\n * ${id}: ${d.note} (box of the derived outline, ${d.areaKm2} km2, ${d.derivedAt}).`).join('\n')}${derived.length > 0 ? '\n' : ''} */
export const REGION_BOUNDS: Partial<Record<GovernorateId, Bounds>> = ${JSON.stringify(f.bounds)};
`;
}

export const MANOUBA_NOTE =
  'derived from the neighbouring governorate outlines (the hole they leave around lat 36.81, lon 10.00), not an OpenStreetMap polygon';

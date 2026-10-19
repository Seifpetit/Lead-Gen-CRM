import type { Bounds } from './geo.js';

// The text of config/regionBounds.ts and config/regionOutlines.json, written by
// scripts/buildRegions.ts. Pure.

export interface OutlinesProvenance {
  /** What the data is and where it came from, in words. */
  source: string;
  /** The attribution the app and README must show. */
  attribution: string;
  license: string;
  licenseUrl: string;
  /** geoBoundaries' own id and dates for the release the file was built from. */
  boundaryId: string;
  boundaryYear: string;
  releaseBuildDate: string;
  /** The URL the file was downloaded from and its SHA-256, so a rebuild can be compared. */
  url: string;
  sha256: string;
  builtAt: string;
}

export interface RegionFiles {
  provenance: OutlinesProvenance;
  bounds: Record<string, Bounds>;
  outlines: Record<string, unknown>;
}

export function renderOutlinesFile(f: RegionFiles): string {
  return JSON.stringify({ ...f.provenance, outlines: f.outlines });
}

export function renderBoundsFile(f: RegionFiles): string {
  const p = f.provenance;
  return `import type { Bounds } from '../lib/geo.js';
import type { GovernorateId } from './regions.js';

/**
 * Bounding box of each governorate: the smallest rectangle around its outline in
 * regionOutlines.json. Written by \`npm run regions:build\`; do not edit by hand (use
 * \`npm run regions:set-bounds\` for a manual fix, which the seed then leaves alone).
 *
 * ${p.attribution}.
 * Licence: ${p.license} (${p.licenseUrl}). Built: ${p.builtAt}.
 */
export const REGION_BOUNDS: Record<GovernorateId, Bounds> = ${JSON.stringify(f.bounds)};
`;
}

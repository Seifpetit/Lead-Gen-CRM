import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DeriveError, deriveEnclosedRegion } from '../lib/deriveHole.js';
import type { Outline } from '../lib/geo.js';
import {
  MANOUBA_NOTE,
  renderBoundsFile,
  renderOutlinesFile,
  type RegionFiles,
} from '../lib/regionFiles.js';

// OpenStreetMap has no boundary polygon for La Manouba, but the governorate is ringed by its
// neighbours. This takes the committed outlines, finds the hole they leave around
// lat 36.81, lon 10.00, and writes it (and its bounding box) as Manouba's outline and bounds.
//
//   npm run regions:derive-manouba
//
// Nothing is written unless a hole is found and its area is between 100 and 2,000 km2.

const ID = 'manouba';
const POINT = { lat: 36.81, lng: 10.0 };

const configDir = fileURLToPath(new URL('../config/', import.meta.url));
const { default: existing } = await import('../config/regionOutlines.json', {
  with: { type: 'json' },
});
const { REGION_BOUNDS } = await import('../config/regionBounds.js');

const neighbours = Object.entries(existing.outlines as Record<string, unknown>).filter(
  ([id]) => id !== ID,
);
try {
  const found = deriveEnclosedRegion(
    neighbours.map(([, o]) => o as Outline),
    POINT,
  );
  const files: RegionFiles = {
    fetchedAt: existing.fetchedAt,
    toleranceDeg: existing.toleranceDeg,
    bounds: { ...REGION_BOUNDS, [ID]: found.bounds },
    outlines: { ...existing.outlines, [ID]: found.outline },
    derived: {
      ...((existing as { derived?: RegionFiles['derived'] }).derived ?? {}),
      [ID]: {
        note: MANOUBA_NOTE,
        areaKm2: found.areaKm2,
        derivedAt: new Date().toISOString().slice(0, 10),
      },
    },
  };
  await writeFile(`${configDir}regionOutlines.json`, renderOutlinesFile(files));
  await writeFile(`${configDir}regionBounds.ts`, renderBoundsFile(files));
  console.log(
    `${ID}: derived from ${neighbours.length} neighbouring outlines, ${found.areaKm2} km2, box ` +
      `${JSON.stringify(found.bounds)}. Run \`npm run format\`, then commit the two files.`,
  );
} catch (err) {
  if (!(err instanceof DeriveError)) throw err;
  console.error(`Not written. ${ID}: ${err.message}`);
  process.exitCode = 1;
}

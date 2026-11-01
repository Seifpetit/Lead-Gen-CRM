import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { regionSetOf } from '../config/countryRegions.js';
import {
  buildCountryGeometries,
  buildRegionGeometries,
  COUNTRY_OUTLINE_TOLERANCE_DEG,
  type BoundaryCollection,
} from '../lib/geoBoundaries.js';
import {
  renderBoundsFile,
  renderCountryFile,
  renderOutlinesFile,
  type RegionFiles,
} from '../lib/regionFiles.js';

// Rebuilds config/regionOutlines.json and config/regionBounds.ts from the geoBoundaries ADM1
// file for Tunisia (one dataset, so neighbouring governorates share their borders).
//
//   npm run regions:build                      download the file, then rebuild
//   npm run regions:build -- path/to/file.geojson   use a file you already have
//   npm run regions:build -- FR                download France (also DE, IT) and write
//                                              config/regionOutlines.fr.json
//   npm run regions:build -- FR path/to/file.geojson   same, from a file you already have
//
// The committed files are what the app uses; nothing here runs at runtime. Run
// `npm run format` after, then `npm run db:seed` to load the result into the database.
//
// Data: geoBoundaries gbOpen, Tunisia ADM1 (source: OpenStreetMap, Wambacher), ODbL 1.0.
// The file is stored with Git LFS, so it is fetched from media.githubusercontent.com.

const BASE =
  'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/TUN/ADM1/';
const GEOJSON_URL = `${BASE}geoBoundaries-TUN-ADM1.geojson`;
const META_URL = `${BASE}geoBoundaries-TUN-ADM1-metaData.json`;

const configDir = fileURLToPath(new URL('../config/', import.meta.url));
const arg = process.argv[2];
const countrySet = arg ? regionSetOf(arg.toUpperCase()) : undefined;
const local = countrySet ? process.argv[3] : arg;

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

if (countrySet) await buildCountry(countrySet);
else await buildTunisia();

async function buildCountry(set: NonNullable<typeof countrySet>): Promise<void> {
  const base = `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/${set.iso3}/${set.layer}/`;
  const url = `${base}geoBoundaries-${set.iso3}-${set.layer}.geojson`;
  const raw = local ? await readFile(local) : await get(url);
  if (raw.subarray(0, 40).toString().startsWith('version https://git-lfs')) {
    throw new Error('That file is a Git LFS pointer, not the data.');
  }
  const meta = JSON.parse(
    (await get(`${base}geoBoundaries-${set.iso3}-${set.layer}-metaData.json`)).toString(),
  ) as Record<string, string>;
  const { outlines, bounds } = buildCountryGeometries(
    JSON.parse(raw.toString()) as BoundaryCollection,
    set,
    COUNTRY_OUTLINE_TOLERANCE_DEG,
  );
  const files: RegionFiles & { tolerance: number } = {
    provenance: {
      source: `geoBoundaries gbOpen ${meta.boundaryID ?? ''}, ${set.country} ${set.layer} boundaries from ${meta.boundarySource ?? 'the national mapping agency'}`,
      attribution: `Boundaries: ${meta.boundarySource ?? ''} (${meta.boundaryLicense ?? ''}), via geoBoundaries (Runfola et al. 2020, www.geoboundaries.org)`,
      license: meta.boundaryLicense ?? '',
      licenseUrl: (meta.licenseSource ?? '').replace('https//', 'https://'),
      boundaryId: meta.boundaryID ?? '',
      boundaryYear: meta.boundaryYear ?? '',
      releaseBuildDate: meta.buildDate ?? '',
      url: local ? `file:${local}` : url,
      sha256: createHash('sha256').update(raw).digest('hex'),
      builtAt: new Date().toISOString().slice(0, 10),
    },
    bounds,
    outlines,
    tolerance: COUNTRY_OUTLINE_TOLERANCE_DEG,
  };
  await writeFile(`${configDir}${set.file}`, renderCountryFile(files));
  console.log(`Wrote ${set.file}: ${Object.keys(outlines).length} regions. Run: npm run format`);
}

async function buildTunisia(): Promise<void> {
  const raw = local ? await readFile(local) : await get(GEOJSON_URL);
  if (raw.subarray(0, 40).toString().startsWith('version https://git-lfs')) {
    throw new Error(
      'That file is a Git LFS pointer, not the data. Use the media.githubusercontent.com URL.',
    );
  }
  const meta = JSON.parse((await get(META_URL)).toString()) as Record<string, string>;
  const { outlines, bounds } = buildRegionGeometries(
    JSON.parse(raw.toString()) as BoundaryCollection,
  );

  const files: RegionFiles = {
    provenance: {
      source: `geoBoundaries gbOpen ${meta.boundaryID ?? 'TUN-ADM1'}, Tunisia first-level boundaries (governorates), built from OpenStreetMap data`,
      attribution:
        'Boundaries: geoBoundaries (Runfola et al. 2020, www.geoboundaries.org), derived from OpenStreetMap contributors',
      license: meta.boundaryLicense ?? 'Open Data Commons Open Database License 1.0',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
      boundaryId: meta.boundaryID ?? '',
      boundaryYear: meta.boundaryYear ?? '',
      releaseBuildDate: meta.buildDate ?? '',
      url: local ? `file:${local}` : GEOJSON_URL,
      sha256: createHash('sha256').update(raw).digest('hex'),
      builtAt: new Date().toISOString().slice(0, 10),
    },
    bounds,
    outlines,
  };
  await writeFile(`${configDir}regionOutlines.json`, renderOutlinesFile(files));
  await writeFile(`${configDir}regionBounds.ts`, renderBoundsFile(files));
  console.log(`Wrote ${Object.keys(outlines).length} outlines and bounds. Run: npm run format`);
}

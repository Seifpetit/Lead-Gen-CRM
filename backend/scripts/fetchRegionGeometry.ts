import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TUNISIAN_GOVERNORATES } from '../config/regions.js';
import { parseGovernorate, type NominatimResult } from '../lib/nominatim.js';

// Fetches each governorate's bounding box and simplified outline from OpenStreetMap through
// Nominatim and rewrites config/regionBounds.ts and config/regionOutlines.json.
//
//   NOMINATIM_CONTACT=you@example.com npm run regions:fetch [-- sfax tunis]   (default: all 24)
//
// Nominatim's usage policy: at most 1 request per second, an identifying User-Agent with a
// contact, results cached (these committed files are the cache). Run `npm run format` after.

const TOLERANCE_DEG = 0.002; // about 200 m: small files, edges still close to the real border
const DELAY_MS = 1100;
const contact = process.env.NOMINATIM_CONTACT;
if (!contact) {
  console.error('Set NOMINATIM_CONTACT to an email address or URL (sent in the User-Agent).');
  process.exit(1);
}
const wanted = process.argv.slice(2);
const targets = TUNISIAN_GOVERNORATES.filter((g) => wanted.length === 0 || wanted.includes(g.id));
if (targets.length === 0) {
  console.error(`No matching region: ${wanted.join(', ')}`);
  process.exit(1);
}

const configDir = fileURLToPath(new URL('../config/', import.meta.url));
const { default: existing } = await import('../config/regionOutlines.json', {
  with: { type: 'json' },
});
const { REGION_BOUNDS } = await import('../config/regionBounds.js');
const bounds: Record<string, unknown> = { ...REGION_BOUNDS };
const outlines: Record<string, unknown> = { ...existing.outlines };
const failures: string[] = [];

/** Wordings tried in turn: OSM names a governorate differently from place to place. */
const queriesFor = (g: { name: string; nameFr: string }): string[] => [
  ...new Set([
    `${g.nameFr} Governorate, Tunisia`,
    `${g.name} Governorate, Tunisia`,
    `Gouvernorat de ${g.nameFr}, Tunisie`,
    `Gouvernorat de ${g.name}, Tunisie`,
  ]),
];

let first = true;
for (const g of targets) {
  let lastError = 'no query tried';
  let done = false;
  for (const q of queriesFor(g)) {
    if (!first) await new Promise((r) => setTimeout(r, DELAY_MS));
    first = false;
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      q,
      countrycodes: 'tn',
      format: 'jsonv2',
      polygon_geojson: '1',
      extratags: '1',
      limit: '5',
      'accept-language': 'fr',
    }).toString();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `LeadGenCRM-region-fetch/1.0 (${contact})` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geometry = parseGovernorate((await res.json()) as NominatimResult[], TOLERANCE_DEG);
      bounds[g.id] = geometry.bounds;
      outlines[g.id] = geometry.outline;
      console.log(`${g.id}: ${geometry.osmRef} (query: ${q})`);
      done = true;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!done) {
    failures.push(g.id);
    console.error(`${g.id}: ${lastError}`);
  }
}

const date = new Date().toISOString().slice(0, 10);
await writeFile(
  `${configDir}regionOutlines.json`,
  JSON.stringify({
    source: 'OpenStreetMap contributors (ODbL) via nominatim.openstreetmap.org',
    fetchedAt: date,
    toleranceDeg: TOLERANCE_DEG,
    outlines,
  }),
);
await writeFile(
  `${configDir}regionBounds.ts`,
  `import type { Bounds } from '../lib/geo.js';
import type { GovernorateId } from './regions.js';

/**
 * Bounding box of each governorate, from OpenStreetMap (Nominatim \`boundingbox\` of the
 * governorate relation). Written by \`npm run regions:fetch\`; do not edit by hand (use
 * \`npm run regions:set-bounds\` for a manual fix, which the seed then leaves alone).
 *
 * Source: OpenStreetMap contributors, ODbL, via nominatim.openstreetmap.org.
 * Fetched: ${date}.
 */
export const REGION_BOUNDS: Partial<Record<GovernorateId, Bounds>> = ${JSON.stringify(bounds)};
`,
);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(', ')}; re-run with those ids`);
  process.exitCode = 1;
}

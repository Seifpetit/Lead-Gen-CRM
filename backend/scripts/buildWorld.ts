import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { simplifyOutline, type Outline } from '../lib/geo.js';

// Rebuilds the country shapes of the Coverage world map: frontend/src/features/leadgen/worldmap/
// worldCountries.json, from Natural Earth's 1:50m country file (public domain).
//
//   npm run world:build                          download the file, then rebuild
//   npm run world:build -- path/to/file.geojson  use a file you already have
//
// The committed file is what the app uses; nothing here runs at runtime. Run `npm run format`
// after. Shapes are simplified to about 2 km: the map shows countries from far away, and the
// regions of a country (regions:build) are drawn on top once it is picked.

const URL_50M =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const TOLERANCE_DEG = 0.02;
const out = fileURLToPath(
  new URL('../../frontend/src/features/leadgen/worldmap/worldCountries.json', import.meta.url),
);

interface Feature {
  properties: Record<string, string | number>;
  geometry: { type: string; coordinates: unknown } | null;
}

const local = process.argv[2];
const raw = local ? await readFile(local) : Buffer.from(await (await fetch(URL_50M)).arrayBuffer());
const collection = JSON.parse(raw.toString()) as { features: Feature[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundOutline = (o: Outline): Outline => {
  const ring = (r: number[][]) => r.map(([x, y]) => [round2(x!), round2(y!)]);
  return o.type === 'Polygon'
    ? { type: 'Polygon', coordinates: o.coordinates.map(ring) as never }
    : { type: 'MultiPolygon', coordinates: o.coordinates.map((p) => p.map(ring)) as never };
};

const countries: { code: string; name: string; geometry: Outline }[] = [];
for (const f of collection.features) {
  const p = f.properties;
  const iso = String(p.ISO_A2_EH ?? p.ISO_A2);
  const code = /^[A-Z]{2}$/.test(iso) ? iso : String(p.ADM0_A3);
  if (code === 'AQ' || !f.geometry) continue; // Antarctica fills the bottom of the map for nothing
  const g = f.geometry;
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
  try {
    const simple = simplifyOutline(g as unknown as Outline, TOLERANCE_DEG);
    countries.push({ code, name: String(p.NAME), geometry: roundOutline(simple) });
  } catch {
    // A speck smaller than the tolerance: not worth drawing.
  }
}
countries.sort((a, b) => a.code.localeCompare(b.code));

await writeFile(
  out,
  JSON.stringify({
    source: 'Natural Earth 1:50m Admin 0 - Countries (naturalearthdata.com)',
    license: 'Public domain',
    url: URL_50M,
    sha256: createHash('sha256').update(raw).digest('hex'),
    builtAt: new Date().toISOString().slice(0, 10),
    simplifiedToleranceDeg: TOLERANCE_DEG,
    countries,
  }),
);
console.log(`Wrote ${countries.length} countries. Run: npm run format`);

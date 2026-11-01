import { outlineBounds, simplifyOutline, type Bounds, type Outline } from './geo.js';
import type { GovernorateId } from '../config/regions.js';
import type { CountryRegionSet } from '../config/countryRegions.js';

// Turns the geoBoundaries ADM1 file for Tunisia into one outline and one bounding box per
// governorate. Pure: the download and the file writing live in scripts/buildRegions.ts.

/** geoBoundaries' ISO 3166-2 code for each of the 24 governorates. */
export const GOVERNORATE_BY_ISO: Readonly<Record<string, GovernorateId>> = {
  'TN-11': 'tunis',
  'TN-12': 'ariana',
  'TN-13': 'ben-arous',
  'TN-14': 'manouba',
  'TN-21': 'nabeul',
  'TN-22': 'zaghouan',
  'TN-23': 'bizerte',
  'TN-31': 'beja',
  'TN-32': 'jendouba',
  'TN-33': 'kef',
  'TN-34': 'siliana',
  'TN-41': 'kairouan',
  'TN-42': 'kasserine',
  'TN-43': 'sidi-bouzid',
  'TN-51': 'sousse',
  'TN-52': 'monastir',
  'TN-53': 'mahdia',
  'TN-61': 'sfax',
  'TN-71': 'gafsa',
  'TN-72': 'tozeur',
  'TN-73': 'kebili',
  'TN-81': 'gabes',
  'TN-82': 'medenine',
  'TN-83': 'tataouine',
};

export interface BoundaryFeature {
  properties?: { shapeISO?: string; shapeName?: string };
  geometry?: { type: string; coordinates: unknown };
}
export interface BoundaryCollection {
  features?: BoundaryFeature[];
}

export interface RegionGeometries {
  outlines: Record<string, Outline>;
  bounds: Record<string, Bounds>;
}

/** About 0.1 m: more digits than the source has any use for. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

type Ring = [number, number][];

/** Rounds a ring, drops repeated points and closes it. Null when fewer than 3 distinct points remain. */
function cleanRing(raw: unknown): Ring | null {
  if (!Array.isArray(raw)) return null;
  const out: Ring = [];
  for (const p of raw as unknown[]) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
      throw new Error('A coordinate is not a [longitude, latitude] pair');
    }
    const q: [number, number] = [round6(p[0]), round6(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push([...first]);
  return out.length >= 4 ? out : null;
}

function toOutline(id: string, geometry: BoundaryFeature['geometry']): Outline {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    throw new Error(`${id}: expected a Polygon or MultiPolygon`);
  }
  const polygons = (
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  ) as unknown[][];
  const cleaned: Ring[][] = [];
  for (const rings of polygons) {
    const kept = rings.map(cleanRing);
    // A polygon with a collapsed outer ring is dropped; a collapsed hole is left out.
    if (!kept[0]) continue;
    cleaned.push(kept.filter((r): r is Ring => r !== null));
  }
  if (cleaned.length === 0) throw new Error(`${id}: the outline has no area`);
  return cleaned.length === 1
    ? { type: 'Polygon', coordinates: cleaned[0]! }
    : { type: 'MultiPolygon', coordinates: cleaned };
}

/**
 * One outline (full precision, rounded to 6 decimals) and one bounding box per governorate.
 * Throws unless the file holds each of the 24 governorates exactly once.
 */
export function buildRegionGeometries(collection: BoundaryCollection): RegionGeometries {
  const outlines: Record<string, Outline> = {};
  const bounds: Record<string, Bounds> = {};
  for (const feature of collection.features ?? []) {
    const iso = feature.properties?.shapeISO ?? '';
    const id = GOVERNORATE_BY_ISO[iso];
    if (!id)
      throw new Error(`Unknown governorate code "${iso}" (${feature.properties?.shapeName})`);
    if (outlines[id]) throw new Error(`${id} appears twice`);
    outlines[id] = toOutline(id, feature.geometry);
    const b = outlineBounds(outlines[id]);
    bounds[id] = { south: b.south, west: b.west, north: b.north, east: b.east };
  }
  const missing = Object.values(GOVERNORATE_BY_ISO).filter((id) => !outlines[id]);
  if (missing.length > 0) throw new Error(`Missing governorates: ${missing.join(', ')}`);
  return { outlines, bounds };
}

/**
 * About 300 m. The outlines of France, Germany and Italy are cut from files with 10 to 100
 * thousand points per region, far more than cutting search cells and drawing a map need;
 * Tunisia's keep the full detail of their source.
 */
export const COUNTRY_OUTLINE_TOLERANCE_DEG = 0.003;

/**
 * One outline (simplified) and one bounding box (of the full outline) per region of a country
 * other than Tunisia. Throws unless the file holds each listed region exactly once and nothing
 * else: a missing or renamed region must stop the build, not quietly vanish.
 */
export function buildCountryGeometries(
  collection: BoundaryCollection,
  set: CountryRegionSet,
  toleranceDeg = COUNTRY_OUTLINE_TOLERANCE_DEG,
): RegionGeometries {
  const idByShape = new Map(set.regions.map((r) => [r.shapeName, r.id]));
  const outlines: Record<string, Outline> = {};
  const bounds: Record<string, Bounds> = {};
  for (const feature of collection.features ?? []) {
    const shape = feature.properties?.shapeName ?? '';
    const id = idByShape.get(shape);
    if (!id) throw new Error(`Unknown region "${shape}" in the ${set.country} file`);
    if (outlines[id]) throw new Error(`${id} appears twice`);
    const full = toOutline(id, feature.geometry);
    const b = outlineBounds(full);
    bounds[id] = { south: b.south, west: b.west, north: b.north, east: b.east };
    outlines[id] = simplifyOutline(full, toleranceDeg);
  }
  const missing = set.regions.filter((r) => !outlines[r.id]).map((r) => r.id);
  if (missing.length > 0) throw new Error(`Missing regions: ${missing.join(', ')}`);
  return { outlines, bounds };
}

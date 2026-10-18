import { outlineBounds, simplifyOutline, type Bounds, type Outline } from './geo.js';

// Parsing of Nominatim search results for a governorate. Pure: the HTTP call lives in
// scripts/fetchRegionGeometry.ts so this can be tested with a saved response.

export interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  class?: string;
  category?: string;
  type?: string;
  display_name?: string;
  boundingbox?: [string, string, string, string];
  geojson?: { type: string; coordinates: unknown };
  /** Present when the request asked for extratags=1. */
  extratags?: { admin_level?: string };
}

export interface GovernorateGeometry {
  osmRef: string;
  bounds: Bounds;
  outline: Outline;
}

/**
 * Picks the first administrative-boundary relation with a polygon, simplifies its outline and
 * takes bounds from the simplified outline's full-resolution box (Nominatim's boundingbox).
 * Throws with the reason when the result is not a usable governorate.
 */
export function parseGovernorate(
  results: readonly NominatimResult[],
  toleranceDeg: number,
): GovernorateGeometry {
  const candidates = results.filter(
    (r) =>
      r.osm_type === 'relation' &&
      (r.class ?? r.category) === 'boundary' &&
      r.geojson &&
      (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon'),
  );
  // A governorate is OSM admin_level 4. When the response says levels, a town or district of
  // the same name must not be taken for it.
  const known = candidates.filter((r) => r.extratags?.admin_level !== undefined);
  const hit =
    known.length > 0 ? known.find((r) => r.extratags?.admin_level === '4') : candidates[0];
  if (!hit?.geojson) throw new Error('no administrative boundary polygon in the response');
  const full = hit.geojson as unknown as Outline;
  const outline = simplifyOutline(full, toleranceDeg);
  let bounds: Bounds;
  if (hit.boundingbox) {
    // Nominatim order: south, north, west, east.
    const [south, north, west, east] = hit.boundingbox.map(Number) as [
      number,
      number,
      number,
      number,
    ];
    bounds = { south, west, north, east };
  } else {
    bounds = outlineBounds(full);
  }
  if (![bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite)) {
    throw new Error('bounding box is not numeric');
  }
  if (!(bounds.north > bounds.south && bounds.east > bounds.west)) {
    throw new Error('bounding box is empty');
  }
  return { osmRef: `relation/${hit.osm_id}`, bounds, outline };
}

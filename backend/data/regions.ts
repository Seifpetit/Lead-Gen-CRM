import { outlineFromBounds, simplifyOutline, type Bounds, type Outline } from '../lib/geo.js';
import type { Queryable } from './db.js';

// Reference data, shared by all users: no user_id.
export interface Region {
  id: string;
  name: string;
  nameFr: string;
  country: string;
}

export interface RegionGeometry {
  /** Committed OpenStreetMap data, applied by the seed. */
  bounds?: Bounds;
  outline?: Outline;
}

/**
 * Inserts or updates regions. Committed OSM geometry is applied unless the region's bounds were
 * set by hand (`bounds_source = 'manual'`), so a manual fix survives a re-seed.
 */
export async function upsertRegions(
  db: Queryable,
  regions: readonly { id: string; name: string; nameFr: string }[],
  country = 'TN',
  geometry: Readonly<Record<string, RegionGeometry>> = {},
): Promise<void> {
  for (const r of regions) {
    await db.query(
      `INSERT INTO regions (id, name, name_fr, country) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, name_fr = EXCLUDED.name_fr`,
      [r.id, r.name, r.nameFr, country],
    );
    const g = geometry[r.id];
    if (!g) continue;
    if (g.bounds) {
      const { rowCount } = await db.query(
        `UPDATE regions SET south = $2, west = $3, north = $4, east = $5, bounds_source = 'osm'
          WHERE id = $1 AND (bounds_source IS NULL OR bounds_source = 'osm')
            AND (south, west, north, east) IS DISTINCT FROM ($2::float8, $3::float8, $4::float8, $5::float8)`,
        [r.id, g.bounds.south, g.bounds.west, g.bounds.north, g.bounds.east],
      );
      // The grid of an unsearched region was cut from its old box; the next run builds a new one.
      if (rowCount) await dropUnusedCells(db, r.id);
    }
    if (g.outline) {
      await db.query('UPDATE regions SET outline = $2 WHERE id = $1', [
        r.id,
        JSON.stringify(g.outline),
      ]);
    }
  }
}

/**
 * Deletes a region's search cells when nothing was ever searched, claimed or paid for in them,
 * so a changed region box gets a fresh grid. A region with history keeps its cells.
 */
async function dropUnusedCells(db: Queryable, regionId: string): Promise<void> {
  const used = (table: string) =>
    `EXISTS (SELECT 1 FROM ${table} t JOIN region_cells c ON c.id = t.region_cell_id WHERE c.region_id = $1)`;
  const { rows } = await db.query<{ used: boolean }>(
    `SELECT (${['search_queries', 'region_coverage', 'cost_ledger', 'run_steps', 'run_companies', 'exhausted_queries', 'cell_claims'].map(used).join(' OR ')}) AS used`,
    [regionId],
  );
  if (rows[0]?.used) return;
  await db.query('DELETE FROM region_cells WHERE region_id = $1 AND parent_cell_id IS NOT NULL', [
    regionId,
  ]);
  await db.query('DELETE FROM region_cells WHERE region_id = $1', [regionId]);
}

export async function listRegions(db: Queryable): Promise<Region[]> {
  const { rows } = await db.query<{ id: string; name: string; name_fr: string; country: string }>(
    'SELECT * FROM regions ORDER BY name',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, nameFr: r.name_fr, country: r.country }));
}

/**
 * Sets a region's map bounds (needed before the runner can build its cells). Marks them manual,
 * so seeding the committed OpenStreetMap bounds does not replace them.
 */
export async function setRegionBounds(db: Queryable, regionId: string, b: Bounds): Promise<void> {
  const res = await db.query(
    `UPDATE regions SET south = $2, west = $3, north = $4, east = $5, bounds_source = 'manual'
      WHERE id = $1`,
    [regionId, b.south, b.west, b.north, b.east],
  );
  if (res.rowCount === 0) throw new Error(`Unknown region ${regionId}`);
}

export async function getRegionBounds(db: Queryable, regionId: string): Promise<Bounds | null> {
  const { rows } = await db.query<{
    south: number | null;
    west: number | null;
    north: number | null;
    east: number | null;
  }>('SELECT south, west, north, east FROM regions WHERE id = $1', [regionId]);
  const r = rows[0];
  if (!r || r.south === null || r.west === null || r.north === null || r.east === null) return null;
  return { south: r.south, west: r.west, north: r.north, east: r.east };
}

/**
 * The region's outline: the stored OpenStreetMap polygon, else its bounding box as a rectangle,
 * else null (no bounds either). Spillage checks use this.
 */
export async function getRegionOutline(db: Queryable, regionId: string): Promise<Outline | null> {
  const { rows } = await db.query<{ outline: Outline | null }>(
    'SELECT outline FROM regions WHERE id = $1',
    [regionId],
  );
  if (rows[0]?.outline) return rows[0].outline;
  const bounds = await getRegionBounds(db, regionId);
  return bounds ? outlineFromBounds(bounds) : null;
}

export interface RegionShape {
  regionId: string;
  name: string;
  bounds: Bounds | null;
  outline: Outline | null;
  outlineSource: 'osm' | 'bounds' | null;
}

/** About 100 m: the map draws a governorate on a few hundred pixels, so this is invisible there. */
export const MAP_TOLERANCE_DEG = 0.001;
const mapOutlines = new Map<string, { size: number; drawn: Outline }>();

/** The stored full-precision outline, lightly simplified for drawing. `size` (the stored text's length) tells a changed outline from the one cached. */
function drawnOutline(regionId: string, outline: Outline, size: number): Outline {
  const hit = mapOutlines.get(regionId);
  if (hit && hit.size === size) return hit.drawn;
  const drawn = simplifyOutline(outline, MAP_TOLERANCE_DEG);
  mapOutlines.set(regionId, { size, drawn });
  return drawn;
}

/** Every region's bounds and drawn shape (stored outline, else its bounds as a rectangle). */
export async function listRegionShapes(db: Queryable): Promise<RegionShape[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    south: number | null;
    west: number | null;
    north: number | null;
    east: number | null;
    outline: Outline | null;
    outline_size: number | null;
  }>(
    'SELECT id, name, south, west, north, east, outline, length(outline::text) AS outline_size FROM regions ORDER BY name',
  );
  return rows.map((r) => {
    const bounds: Bounds | null =
      r.south === null || r.west === null || r.north === null || r.east === null
        ? null
        : { south: r.south, west: r.west, north: r.north, east: r.east };
    return {
      regionId: r.id,
      name: r.name,
      bounds,
      outline: r.outline
        ? drawnOutline(r.id, r.outline, r.outline_size ?? 0)
        : bounds
          ? outlineFromBounds(bounds)
          : null,
      outlineSource: r.outline ? 'osm' : bounds ? 'bounds' : null,
    };
  });
}

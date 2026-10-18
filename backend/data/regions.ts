import { outlineFromBounds, type Bounds, type Outline } from '../lib/geo.js';
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
      await db.query(
        `UPDATE regions SET south = $2, west = $3, north = $4, east = $5, bounds_source = 'osm'
          WHERE id = $1 AND (bounds_source IS NULL OR bounds_source = 'osm')`,
        [r.id, g.bounds.south, g.bounds.west, g.bounds.north, g.bounds.east],
      );
    }
    if (g.outline) {
      await db.query('UPDATE regions SET outline = $2 WHERE id = $1', [
        r.id,
        JSON.stringify(g.outline),
      ]);
    }
  }
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

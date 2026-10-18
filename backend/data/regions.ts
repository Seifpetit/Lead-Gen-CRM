import type { Bounds } from '../lib/geo.js';
import type { Queryable } from './db.js';

// Reference data, shared by all users: no user_id.
export interface Region {
  id: string;
  name: string;
  nameFr: string;
  country: string;
}

export async function upsertRegions(
  db: Queryable,
  regions: readonly { id: string; name: string; nameFr: string }[],
  country = 'TN',
): Promise<void> {
  for (const r of regions) {
    await db.query(
      `INSERT INTO regions (id, name, name_fr, country) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, name_fr = EXCLUDED.name_fr`,
      [r.id, r.name, r.nameFr, country],
    );
  }
}

export async function listRegions(db: Queryable): Promise<Region[]> {
  const { rows } = await db.query<{ id: string; name: string; name_fr: string; country: string }>(
    'SELECT * FROM regions ORDER BY name',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, nameFr: r.name_fr, country: r.country }));
}

/** Sets a region's map bounds (needed before the runner can build its cells). */
export async function setRegionBounds(db: Queryable, regionId: string, b: Bounds): Promise<void> {
  const res = await db.query(
    'UPDATE regions SET south = $2, west = $3, north = $4, east = $5 WHERE id = $1',
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

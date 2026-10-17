import { splitBounds, type Bounds } from '../lib/geo.js';
import type { Queryable } from './db.js';

// Map rectangles that regions are searched in. Geometry, shared by all users: no user_id.

export { splitBounds, type Bounds };

export interface RegionCell extends Bounds {
  id: string;
  regionId: string;
  parentCellId: string | null;
  cellKey: string;
}

interface Row {
  id: string;
  region_id: string;
  parent_cell_id: string | null;
  cell_key: string;
  south: number;
  west: number;
  north: number;
  east: number;
}

const toCell = (r: Row): RegionCell => ({
  id: r.id,
  regionId: r.region_id,
  parentCellId: r.parent_cell_id,
  cellKey: r.cell_key,
  south: r.south,
  west: r.west,
  north: r.north,
  east: r.east,
});

async function insertCells(
  db: Queryable,
  regionId: string,
  parentCellId: string | null,
  cells: { key: string; bounds: Bounds }[],
): Promise<void> {
  for (const { key, bounds } of cells) {
    await db.query(
      `INSERT INTO region_cells (region_id, parent_cell_id, cell_key, south, west, north, east)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (region_id, cell_key) DO NOTHING`,
      [regionId, parentCellId, key, bounds.south, bounds.west, bounds.north, bounds.east],
    );
  }
}

/** Covers a region's bounds with a rows x cols grid of top-level cells. Idempotent. */
export async function createRegionGrid(
  db: Queryable,
  regionId: string,
  bounds: Bounds,
  rows: number,
  cols: number,
): Promise<RegionCell[]> {
  await insertCells(db, regionId, null, splitBounds(bounds, rows, cols));
  return listCells(db, regionId);
}

/**
 * Splits a cell into rows x cols children (keys like "r1c2.r0c1"), for when a search in it
 * hits the provider's result cap. The parent stays, so its history is kept. Idempotent.
 */
export async function splitCell(
  db: Queryable,
  cellId: string,
  rows = 2,
  cols = 2,
): Promise<RegionCell[]> {
  const parent = await getCell(db, cellId);
  if (!parent) throw new Error('Unknown region cell');
  const children = splitBounds(parent, rows, cols).map((c) => ({
    key: `${parent.cellKey}.${c.key}`,
    bounds: c.bounds,
  }));
  await insertCells(db, parent.regionId, parent.id, children);
  const { rows: found } = await db.query<Row>(
    'SELECT * FROM region_cells WHERE parent_cell_id = $1 ORDER BY cell_key',
    [parent.id],
  );
  return found.map(toCell);
}

export async function getCell(db: Queryable, cellId: string): Promise<RegionCell | null> {
  const { rows } = await db.query<Row>('SELECT * FROM region_cells WHERE id = $1', [cellId]);
  return rows[0] ? toCell(rows[0]) : null;
}

/** A region's cells; with leafOnly, only cells that have not been split (the ones to search). */
export async function listCells(
  db: Queryable,
  regionId: string,
  opts: { leafOnly?: boolean } = {},
): Promise<RegionCell[]> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM region_cells c WHERE c.region_id = $1
       AND (NOT $2 OR NOT EXISTS (SELECT 1 FROM region_cells k WHERE k.parent_cell_id = c.id))
     ORDER BY c.cell_key`,
    [regionId, opts.leafOnly ?? false],
  );
  return rows.map(toCell);
}

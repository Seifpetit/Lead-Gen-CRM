import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TUNISIAN_GOVERNORATES } from '../config/regions.js';
import type { Db } from './db.js';
import { createRegionGrid, listCells, splitCell } from './regionCells.js';
import {
  getRegionBounds,
  getRegionOutline,
  listRegionShapes,
  setRegionBounds,
  upsertRegions,
} from './regions.js';
import { makeUser, openTestDb } from './testDb.js';
import { boundsIntersectOutline, type Outline } from '../lib/geo.js';

let db: Db;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});

const BOX = { south: 34, west: 10, north: 36, east: 12 };
// Triangle: (10,34) (11.5,34) (10,35.5) in [lng, lat]; the box's north-east corner is outside it.
const TRIANGLE: Outline = {
  type: 'Polygon',
  coordinates: [
    [
      [10, 34],
      [11.5, 34],
      [10, 35.5],
      [10, 34],
    ],
  ],
};

describe('committed region geometry', () => {
  it('is applied by the seed, and the outline falls back to the bounds without one', async () => {
    // Start from regions with no geometry, whatever the committed files hold.
    await db.query(
      `UPDATE regions SET south = NULL, west = NULL, north = NULL, east = NULL,
         outline = NULL, bounds_source = NULL WHERE id IN ('tunis', 'kebili')`,
    );
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { tunis: { bounds: BOX } });
    expect(await getRegionBounds(db, 'tunis')).toEqual(BOX);
    expect((await getRegionOutline(db, 'tunis'))?.type).toBe('Polygon');
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', {
      tunis: { bounds: BOX, outline: TRIANGLE },
    });
    expect(await getRegionOutline(db, 'tunis')).toEqual(TRIANGLE);
    expect(await getRegionOutline(db, 'kebili')).toBeNull(); // no bounds, no outline
  });

  it('never overwrites bounds that were set by hand', async () => {
    const manual = { south: 1, west: 2, north: 3, east: 4 };
    await setRegionBounds(db, 'sfax', manual);
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { sfax: { bounds: BOX } });
    expect(await getRegionBounds(db, 'sfax')).toEqual(manual);
  });
});

describe('cells outside the outline', () => {
  it('keeps only grid cells that intersect the outline, and only such children when splitting', async () => {
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', {
      gabes: { bounds: BOX, outline: TRIANGLE },
    });
    const cells = await createRegionGrid(db, 'gabes', BOX, 2, 2, TRIANGLE);
    // The north-east quarter (r1c1) lies wholly beyond the hypotenuse.
    expect(cells.map((c) => c.cellKey).sort()).toEqual(['r0c0', 'r0c1', 'r1c0']);
    const r0c1 = cells.find((c) => c.cellKey === 'r0c1')!;
    const children = await splitCell(db, r0c1.id);
    // The hypotenuse cuts r0c1; its far (north-east) child lies wholly beyond it.
    expect(children.length).toBe(3);
    expect(children.every((c) => boundsIntersectOutline(c, TRIANGLE))).toBe(true);
    expect((await listCells(db, 'gabes')).some((c) => c.cellKey === 'r1c1')).toBe(false);
  });
});

describe('re-seeding a region whose box changed', () => {
  const OLD = { south: 35, west: 8, north: 36, east: 9 };
  const NEW = { south: 35, west: 8, north: 36.5, east: 9.5 };

  it('drops the cells of a region nothing was searched in, so the next run builds a new grid', async () => {
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { kef: { bounds: OLD } });
    await db.query("DELETE FROM region_cells WHERE region_id = 'kef'");
    await createRegionGrid(db, 'kef', OLD, 2, 2);
    expect(await listCells(db, 'kef')).toHaveLength(4);
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { kef: { bounds: OLD } }); // same box
    expect(await listCells(db, 'kef')).toHaveLength(4);
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { kef: { bounds: NEW } });
    expect(await getRegionBounds(db, 'kef')).toEqual(NEW);
    expect(await listCells(db, 'kef')).toEqual([]);
  });

  it('keeps the cells of a region that has history', async () => {
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { siliana: { bounds: OLD } });
    await db.query("DELETE FROM region_cells WHERE region_id = 'siliana'");
    const [cell] = await createRegionGrid(db, 'siliana', OLD, 1, 1);
    const user = await makeUser(db);
    await db.query(
      `INSERT INTO exhausted_queries (user_id, region_cell_id, normalized_query) VALUES ($1, $2, 'x')`,
      [user, cell!.id],
    );
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { siliana: { bounds: NEW } });
    expect(await listCells(db, 'siliana')).toHaveLength(1);
    await db.query('DELETE FROM exhausted_queries WHERE region_cell_id = $1', [cell!.id]);
  });
});

describe('region shapes for the map', () => {
  it('draws a lightly simplified outline but stores and tests against the full one', async () => {
    // A ring with a wiggle of about 20 m: below the drawing tolerance, above nothing for tests.
    const wiggly: Outline = {
      type: 'Polygon',
      coordinates: [
        [
          [10, 34],
          [10.5, 34.0002],
          [11, 34],
          [11, 35],
          [10, 35],
          [10, 34],
        ],
      ],
    };
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', {
      gafsa: { bounds: { south: 34, west: 10, north: 35, east: 11 }, outline: wiggly },
    });
    expect(await getRegionOutline(db, 'gafsa')).toEqual(wiggly);
    const shape = (await listRegionShapes(db)).find((s) => s.regionId === 'gafsa')!;
    expect(shape.outlineSource).toBe('osm');
    expect(shape.outline?.type).toBe('Polygon');
    const ring = (shape.outline as { coordinates: number[][][] }).coordinates[0]!;
    expect(ring).toHaveLength(5); // the wiggle is gone
    // The cache follows a changed outline.
    const flat: Outline = {
      type: 'Polygon',
      coordinates: [
        [
          [10, 34],
          [11, 34],
          [11, 35.5],
          [10, 35.5],
          [10, 34],
        ],
      ],
    };
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', { gafsa: { outline: flat } });
    const again = (await listRegionShapes(db)).find((s) => s.regionId === 'gafsa')!;
    expect(JSON.stringify(again.outline)).toContain('35.5');
  });
});

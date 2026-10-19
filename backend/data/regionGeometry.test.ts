import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TUNISIAN_GOVERNORATES } from '../config/regions.js';
import type { Db } from './db.js';
import { createRegionGrid, listCells, splitCell } from './regionCells.js';
import { getRegionBounds, getRegionOutline, setRegionBounds, upsertRegions } from './regions.js';
import { openTestDb } from './testDb.js';
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
  it('keeps only grid cells with real area inside the outline, and only such children when splitting', async () => {
    await upsertRegions(db, TUNISIAN_GOVERNORATES, 'TN', {
      gabes: { bounds: BOX, outline: TRIANGLE },
    });
    const cells = await createRegionGrid(db, 'gabes', BOX, 2, 2, TRIANGLE);
    // The north-east quarter (r1c1) lies wholly beyond the hypotenuse.
    expect(cells.map((c) => c.cellKey).sort()).toEqual(['r0c0', 'r0c1', 'r1c0']);
    const r0c1 = cells.find((c) => c.cellKey === 'r0c1')!;
    const children = await splitCell(db, r0c1.id);
    // The hypotenuse leaves 12.5% of r0c1 inside; only its south-west child holds any of that.
    expect(children.map((c) => c.cellKey)).toEqual(['r0c1.r0c0']);
    expect(children.every((c) => boundsIntersectOutline(c, TRIANGLE))).toBe(true);
    expect((await listCells(db, 'gabes')).some((c) => c.cellKey === 'r1c1')).toBe(false);
  });
});

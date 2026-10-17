import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db.js';
import type { UserId } from './ids.js';
import { createRegionGrid, listCells, splitBounds, splitCell } from './regionCells.js';
import {
  addCellCoverage,
  getCellCoverage,
  getCoverage,
  listCellCoverage,
  listCoverage,
} from './regionCoverage.js';
import { createRun } from './runs.js';
import { listSearchQueriesForRun, queryYieldForCell, recordSearchQuery } from './searchQueries.js';
import { makeUser, openTestDb, resetData } from './testDb.js';

let db: Db;
let user: UserId;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await resetData(db);
  await db.query('DELETE FROM region_cells');
  user = await makeUser(db);
});

// Test rectangle only, not a real governorate boundary.
const BOX = { south: 34.0, west: 10.0, north: 35.0, east: 11.0 };

describe('splitBounds', () => {
  it('tiles the bounds exactly with no gaps', () => {
    const cells = splitBounds(BOX, 2, 3);
    expect(cells.map((c) => c.key)).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2']);
    expect(cells[0]!.bounds).toEqual({ south: 34, north: 34.5, west: 10, east: 10 + 1 / 3 });
    expect(cells[5]!.bounds.north).toBe(35);
    expect(cells[5]!.bounds.east).toBe(11);
  });

  it('rejects a non-positive grid', () => {
    expect(() => splitBounds(BOX, 0, 2)).toThrow();
  });
});

describe('region cells', () => {
  it('creates a grid idempotently and splits a dense cell into children', async () => {
    const grid = await createRegionGrid(db, 'sfax', BOX, 2, 2);
    expect(grid).toHaveLength(4);
    expect(await createRegionGrid(db, 'sfax', BOX, 2, 2)).toHaveLength(4);

    const parent = grid.find((c) => c.cellKey === 'r1c1')!;
    const children = await splitCell(db, parent.id);
    expect(children.map((c) => c.cellKey)).toEqual([
      'r1c1.r0c0',
      'r1c1.r0c1',
      'r1c1.r1c0',
      'r1c1.r1c1',
    ]);
    expect(children.every((c) => c.parentCellId === parent.id)).toBe(true);

    const leaves = await listCells(db, 'sfax', { leafOnly: true });
    expect(leaves).toHaveLength(7);
    expect(leaves.map((c) => c.id)).not.toContain(parent.id);
  });

  it('rejects inverted bounds', async () => {
    await expect(createRegionGrid(db, 'sfax', { ...BOX, north: 33 }, 1, 1)).rejects.toThrow();
  });
});

describe('coverage per cell, rolled up per region', () => {
  it('adds run results to cells and sums them into the region with derived shares', async () => {
    const [a, b] = await createRegionGrid(db, 'sfax', BOX, 1, 2);
    await addCellCoverage(db, user, a!.id, {
      placesFound: 100,
      qualifiedCompanies: 20,
      companiesWithDecisionMaker: 10,
      decisionMakersWithChannel: 8,
      leadsFound: 8,
      spentUsd: 4,
      runAt: new Date('2026-10-01T00:00:00Z'),
    });
    // A second run on the same cell adds to it.
    const cellA = await addCellCoverage(db, user, a!.id, {
      placesFound: 50,
      qualifiedCompanies: 10,
    });
    expect(cellA).toMatchObject({ placesFound: 150, qualifiedCompanies: 30, qualifiedShare: 0.2 });
    expect(cellA.lastRunAt).toEqual(new Date('2026-10-01T00:00:00Z'));
    await addCellCoverage(db, user, b!.id, {
      placesFound: 50,
      qualifiedCompanies: 10,
      leadsFound: 2,
      spentUsd: 1,
    });

    const sfax = (await getCoverage(db, user, 'sfax'))!;
    expect(sfax).toMatchObject({
      cellsTotal: 2,
      cellsCovered: 2,
      placesFound: 200,
      qualifiedCompanies: 40,
      qualifiedShare: 0.2,
      decisionMakerShare: 10 / 40,
      channelShare: 0.8,
      leadsFound: 10,
      spentUsd: 5,
      costPerLeadUsd: 0.5,
    });

    const all = await listCoverage(db, user);
    expect(all).toHaveLength(24);
    expect(all.find((r) => r.regionId === 'tunis')).toMatchObject({
      cellsTotal: 0,
      placesFound: 0,
      qualifiedShare: null,
      costPerLeadUsd: null,
    });
    expect(await listCellCoverage(db, user, 'sfax')).toHaveLength(2);
  });

  it('keeps each user’s coverage separate', async () => {
    const [cell] = await createRegionGrid(db, 'sfax', BOX, 1, 1);
    await addCellCoverage(db, user, cell!.id, { placesFound: 10 });
    const other = await makeUser(db);
    expect(await getCellCoverage(db, other, cell!.id)).toBeNull();
    expect((await getCoverage(db, other, 'sfax'))?.placesFound).toBe(0);
  });
});

describe('search queries', () => {
  it('tracks yield per wording and cell, so exhausted wordings show up', async () => {
    const [cell] = await createRegionGrid(db, 'sfax', BOX, 1, 1);
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const base = {
      runId: run.id,
      regionCellId: cell!.id,
      provider: 'google_maps',
      requestsUsed: 1,
      costUsd: 0.5,
    };
    await recordSearchQuery(db, user, {
      ...base,
      queryText: 'Usine Agroalimentaire',
      resultsReturned: 120,
      newPlacesFound: 120,
      at: new Date('2026-10-01T00:00:00Z'),
    });
    await recordSearchQuery(db, user, {
      ...base,
      queryText: '  usine   agroalimentaire ',
      resultsReturned: 118,
      newPlacesFound: 0,
      at: new Date('2026-10-02T00:00:00Z'),
    });
    await recordSearchQuery(db, user, {
      ...base,
      queryText: 'huilerie',
      resultsReturned: 40,
      newPlacesFound: 35,
    });

    const yields = await queryYieldForCell(db, user, cell!.id);
    expect(yields.find((y) => y.normalizedQuery === 'usine agroalimentaire')).toMatchObject({
      timesRun: 2,
      resultsReturned: 238,
      newPlacesFound: 120,
      costUsd: 1,
      lastNewPlacesFound: 0,
    });
    expect(yields.find((y) => y.normalizedQuery === 'huilerie')).toMatchObject({
      timesRun: 1,
      lastNewPlacesFound: 35,
    });
    expect(await listSearchQueriesForRun(db, user, run.id)).toHaveLength(3);
  });

  it("rejects new places above results, and queries on another user's run", async () => {
    const [cell] = await createRegionGrid(db, 'sfax', BOX, 1, 1);
    const run = await createRun(db, user, { regionId: 'sfax', spendCapUsd: 10 });
    const q = {
      runId: run.id,
      regionCellId: cell!.id,
      provider: 'google_maps',
      queryText: 'x',
      requestsUsed: 1,
      resultsReturned: 5,
      newPlacesFound: 6,
      costUsd: 0,
    };
    await expect(recordSearchQuery(db, user, q)).rejects.toThrow();
    const other = await makeUser(db);
    expect(await recordSearchQuery(db, other, { ...q, newPlacesFound: 1 })).toBeNull();
    expect(await queryYieldForCell(db, other, cell!.id)).toEqual([]);
  });
});

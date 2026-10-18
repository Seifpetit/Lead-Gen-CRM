import { describe, expect, it } from 'vitest';
import { FREIGHT_SECTORS } from '../config/sectors.js';
import { buildQueryGrid, cleanWordings, gridShape } from './queryGrid.js';

// Illustrative bounds around Sfax; real governorate bounds aren't seeded yet.
const SFAX = { south: 34.4, west: 10.2, north: 35.2, east: 11.1 };
const frWordings = new Set(FREIGHT_SECTORS.flatMap((s) => s.searchTermsFr)).size;

describe('buildQueryGrid', () => {
  it('turns one region into 100 to 200 French queries over map cells', () => {
    const grid = buildQueryGrid({ regionId: 'sfax', bounds: SFAX });
    expect(grid.queries.length).toBeGreaterThanOrEqual(100);
    expect(grid.queries.length).toBeLessThanOrEqual(200);
    expect(grid.queries.length).toBe(grid.cells.length * frWordings);
    expect(new Set(grid.queries.map((q) => q.languageCode))).toEqual(new Set(['fr']));
    // No English wording slips in.
    const en = new Set<string>(FREIGHT_SECTORS.flatMap((s) => s.searchTermsEn));
    expect(grid.queries.some((q) => en.has(q.textQuery))).toBe(false);
    // Every query is inside its cell, and the cells tile the region.
    for (const q of grid.queries) {
      const cell = grid.cells.find((c) => c.key === q.cellKey)!;
      expect(q.bounds).toEqual(cell.bounds);
    }
    expect(Math.min(...grid.cells.map((c) => c.bounds.south))).toBe(SFAX.south);
    expect(Math.max(...grid.cells.map((c) => c.bounds.east))).toBe(SFAX.east);
  });

  it('is deterministic', () => {
    expect(buildQueryGrid({ regionId: 'sfax', bounds: SFAX })).toEqual(
      buildQueryGrid({ regionId: 'sfax', bounds: SFAX }),
    );
  });

  it('orders wording by wording across all cells, so a cut-short run still covers the region', () => {
    const grid = buildQueryGrid({ regionId: 'sfax', bounds: SFAX });
    const firstRound = grid.queries.slice(0, grid.cells.length);
    expect(new Set(firstRound.map((q) => q.cellKey)).size).toBe(grid.cells.length);
    expect(new Set(firstRound.map((q) => q.normalizedQuery)).size).toBe(1);
  });

  it('skips exhausted cells and wordings', () => {
    const all = buildQueryGrid({ regionId: 'sfax', bounds: SFAX });
    const cell = all.cells[0]!.key;
    const grid = buildQueryGrid({
      regionId: 'sfax',
      bounds: SFAX,
      exhaustedCellKeys: [cell],
      exhaustedWordings: [
        { cellKey: null, normalizedQuery: 'huilerie' },
        { cellKey: all.cells[1]!.key, normalizedQuery: 'Grossiste' },
      ],
    });
    expect(grid.queries.some((q) => q.cellKey === cell)).toBe(false);
    expect(grid.queries.some((q) => q.normalizedQuery === 'huilerie')).toBe(false);
    expect(
      grid.queries.some(
        (q) => q.cellKey === all.cells[1]!.key && q.normalizedQuery === 'grossiste',
      ),
    ).toBe(false);
    expect(grid.queries.some((q) => q.normalizedQuery === 'grossiste')).toBe(true);
    const live = all.cells.length - 1;
    expect(grid.queries.length).toBe(live * frWordings - live - 1);
    expect(grid.skipped).toEqual({ exhaustedCells: 1, exhaustedQueries: live + 1 });
  });

  it('uses stored leaf cells (after splits) instead of generating a grid', () => {
    const cells = [
      { key: 'r0c0.r0c0', bounds: { south: 34.4, west: 10.2, north: 34.6, east: 10.4 } },
      { key: 'r0c0.r0c1', bounds: { south: 34.4, west: 10.4, north: 34.6, east: 10.6 } },
    ];
    const grid = buildQueryGrid({
      regionId: 'sfax',
      bounds: SFAX,
      cells,
      sectorIds: ['olive-oil'],
    });
    expect(grid.cells).toEqual(cells);
    expect(grid.queries.map((q) => `${q.cellKey} ${q.textQuery}`)).toEqual([
      'r0c0.r0c0 huilerie',
      'r0c0.r0c1 huilerie',
      "r0c0.r0c0 huile d'olive export",
      "r0c0.r0c1 huile d'olive export",
    ]);
  });

  it('limits sectors and rejects unknown ones', () => {
    const grid = buildQueryGrid({ regionId: 'sfax', bounds: SFAX, sectorIds: ['textile'] });
    expect(new Set(grid.queries.map((q) => q.sectorId))).toEqual(new Set(['textile']));
    expect(() => buildQueryGrid({ regionId: 'sfax', bounds: SFAX, sectorIds: ['nope'] })).toThrow(
      /Unknown sector: nope/,
    );
  });

  it('shapes the grid to the region: a tall region gets more rows', () => {
    expect(gridShape({ south: 30, west: 10, north: 34, east: 11 }, 4).rows).toBeGreaterThan(1);
    expect(gridShape({ south: 34, west: 8, north: 34.5, east: 11 }, 4)).toEqual({
      rows: 1,
      cols: 4,
    });
  });
});

describe('typed-in wordings', () => {
  const bounds = { south: 34, west: 10, north: 35, east: 11 };

  it('adds them with no sector, after the sector wordings, once each', () => {
    const grid = buildQueryGrid({
      regionId: 'sfax',
      bounds,
      sectorIds: ['textile'],
      customWordings: ['entrepôt frigorifique', 'Entrepot  Frigorifique', 'usine textile'],
    });
    const wordings = [...new Set(grid.queries.map((q) => q.textQuery))];
    // "usine textile" is already textile's; the second spelling of the custom one is a duplicate.
    expect(wordings).toEqual(['usine textile', 'confection', 'entrepôt frigorifique']);
    expect(
      grid.queries
        .filter((q) => q.sectorId === null)
        .every((q) => q.textQuery === 'entrepôt frigorifique'),
    ).toBe(true);
  });

  it('searches only the typed-in wordings for an empty sector list', () => {
    const grid = buildQueryGrid({
      regionId: 'sfax',
      bounds,
      sectorIds: [],
      customWordings: ['entrepôt'],
    });
    expect(grid.queries.every((q) => q.sectorId === null && q.textQuery === 'entrepôt')).toBe(true);
    expect(grid.queries.length).toBeGreaterThan(0);
  });

  it('cleans, trims and deduplicates wordings', () => {
    expect(cleanWordings(['  a\tb  ', 'A B', '', '   ', 'c\u0000d', 'é', 'E'])).toEqual([
      'a b',
      'c d',
      'é',
    ]);
  });
});

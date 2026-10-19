import { readFileSync } from 'node:fs';
import type { StepSummary } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { REGION_BOUNDS } from '../config/regionBounds.js';
import {
  boundsIntersectOutline,
  MIN_CELL_OVERLAP,
  splitBounds,
  type Bounds,
  type Outline,
} from '../lib/geo.js';
import type { CellStats } from '../data/saturation.js';
import { buildQueryGrid, gridShape } from '../stages/queryGrid.js';
import { GUARD_WINDOW, outsideRegionVerdict } from './guard.js';
import { usableCells } from './plan.js';
import { planRunCells } from './scheduler.js';

// The real stored shapes, so the tests describe the regions as they are.
const outlines = JSON.parse(
  readFileSync(new URL('../config/regionOutlines.json', import.meta.url), 'utf8'),
).outlines as Record<string, Outline>;

/** The grid a region gets at the default size, as stored cells with no search history. */
function storedCells(regionId: 'bizerte' | 'sfax'): CellStats[] {
  const bounds = REGION_BOUNDS[regionId] as Bounds;
  const { rows, cols } = gridShape(bounds, 16);
  return splitBounds(bounds, rows, cols).map((c) => ({
    regionCellId: `id-${c.key}`,
    cellKey: c.key,
    bounds: c.bounds,
    spendUsd: 0,
    leads: 0,
    queriesRun: 0,
    placesFound: 0,
    newPlacesFound: 0,
    lastRunAt: null,
    exhaustedAt: null,
    claimedByRunId: null,
  }));
}

const NOW = new Date('2026-10-19T12:00:00Z');
const config = { cellsPerRun: 4, maintenanceIntervalDays: 30 };

describe('usableCells: Bizerte-shaped region (a coast with the rectangle mostly sea and Tunis side)', () => {
  const grid = storedCells('bizerte');
  const outline = outlines.bizerte!;
  const usable = usableCells(grid, outline);

  it('drops the cells with under a tenth of their area inside', () => {
    const dropped = grid.map((c) => c.cellKey).filter((k) => !usable.overlap.has(k));
    expect(dropped).toEqual(expect.arrayContaining(['r0c4', 'r2c0', 'r2c3', 'r2c4']));
    for (const c of usable.cells) {
      expect(usable.overlap.get(c.cellKey)).toBeGreaterThanOrEqual(MIN_CELL_OVERLAP);
    }
  });

  it('plans the cells with most area inside first, not the strip that sorts first by name', () => {
    const plan = planRunCells(usable.cells, config, {
      mode: 'normal',
      now: NOW,
      overlap: usable.overlap,
    });
    const keys = plan.cellIds.map((id) => id.replace('id-', ''));
    expect(keys).toEqual(['r1c2', 'r1c1', 'r1c3', 'r0c2']);
  });

  it('would have picked the southern strip before: r0c1..r0c4, ordered by name', () => {
    // The old rule kept every cell touching the outline and broke ties by cell name.
    const touching = grid.filter((c) => boundsIntersectOutline(c.bounds, outline));
    const before = planRunCells(touching, config, { mode: 'normal', now: NOW });
    expect(before.cellIds).toEqual(['id-r0c1', 'id-r0c2', 'id-r0c3', 'id-r0c4']);
  });

  it('does not change a cell list for a region with no outline', () => {
    const none = usableCells(grid, null);
    expect(none.cells).toHaveLength(grid.length);
    expect([...none.overlap.values()].every((v) => v === 1)).toBe(true);
    const plan = planRunCells(none.cells, config, { mode: 'normal', now: NOW });
    expect(plan.cellIds).toEqual(['id-r0c0', 'id-r0c1', 'id-r0c2', 'id-r0c3']);
  });
});

describe('usableCells: Sfax-shaped region', () => {
  const grid = storedCells('sfax');
  const usable = usableCells(grid, outlines.sfax!);

  it('drops the four thin corner cells and starts at the cell fully inside', () => {
    const touching = grid.filter((c) => boundsIntersectOutline(c.bounds, outlines.sfax!));
    expect(touching.filter((c) => !usable.overlap.has(c.cellKey)).map((c) => c.cellKey)).toEqual([
      'r1c3',
      'r2c3',
      'r3c0',
      'r3c3',
    ]);
    const plan = planRunCells(usable.cells, config, {
      mode: 'normal',
      now: NOW,
      overlap: usable.overlap,
    });
    expect(plan.cellIds.map((id) => id.replace('id-', ''))).toEqual([
      'r2c1',
      'r1c1',
      'r2c2',
      'r3c2',
    ]);
  });
});

describe('planRunCells with overlap', () => {
  it('keeps leads per dollar first and uses the overlap only to break ties', () => {
    const cell = (key: string, over: Partial<CellStats> = {}): CellStats => ({
      ...storedCells('sfax')[0]!,
      regionCellId: `id-${key}`,
      cellKey: key,
      ...over,
    });
    const overlap = new Map([
      ['a', 0.3],
      ['b', 0.9],
      ['c', 0.5],
    ]);
    const stats = [
      cell('a', { leads: 10, spendUsd: 1, queriesRun: 5 }),
      cell('b', { leads: 10, spendUsd: 5, queriesRun: 5 }),
      cell('c', { leads: 10, spendUsd: 1, queriesRun: 5 }),
    ];
    const plan = planRunCells(
      stats,
      { ...config, cellsPerRun: 3 },
      {
        mode: 'normal',
        now: NOW,
        overlap,
      },
    );
    expect(plan.cellIds).toEqual(['id-c', 'id-a', 'id-b']);
  });
});

describe('buildQueryGrid with overlap', () => {
  it('searches the cells with most area inside first', () => {
    const bounds = REGION_BOUNDS.bizerte as Bounds;
    const usable = usableCells(storedCells('bizerte'), outlines.bizerte!);
    const grid = buildQueryGrid({
      regionId: 'bizerte',
      bounds,
      sectorIds: ['textile'],
      cells: usable.cells.map((c) => ({
        key: c.cellKey,
        bounds: c.bounds,
        overlap: usable.overlap.get(c.cellKey)!,
      })),
    });
    const order = [...new Set(grid.queries.map((q) => q.cellKey))];
    expect(order.slice(0, 4)).toEqual(['r1c2', 'r1c1', 'r1c3', 'r0c2']);
    expect(order).not.toContain('r0c4');
  });
});

describe('outsideRegionVerdict', () => {
  const search = (returned: number, outside: number): StepSummary =>
    ({
      returned,
      dropped: outside > 0 ? [{ reason: 'outside_region', count: outside }] : [],
    }) as unknown as StepSummary;

  it('stops a run whose first searches come back almost all outside the region', () => {
    const v = outsideRegionVerdict([
      search(30, 30),
      search(30, 29),
      search(30, 30),
      search(8, 8),
      search(0, 0),
    ]);
    expect(v).toMatchObject({ stop: true, searches: 5, returned: 98, outside: 97 });
  });

  it('lets a run continue when enough places are inside', () => {
    expect(outsideRegionVerdict(Array.from({ length: 6 }, () => search(20, 10))).stop).toBe(false);
    // exactly 90 percent is not more than 90 percent
    expect(outsideRegionVerdict(Array.from({ length: 5 }, () => search(20, 18))).stop).toBe(false);
  });

  it('waits for several searches and enough places before judging', () => {
    expect(outsideRegionVerdict([search(60, 60), search(60, 60)]).stop).toBe(false);
    expect(outsideRegionVerdict(Array.from({ length: 6 }, () => search(2, 2))).stop).toBe(false);
  });

  it('only looks at the first searches', () => {
    const early = Array.from({ length: GUARD_WINDOW }, () => search(20, 2));
    expect(
      outsideRegionVerdict([...early, ...Array.from({ length: 20 }, () => search(30, 30))]).stop,
    ).toBe(false);
  });
});

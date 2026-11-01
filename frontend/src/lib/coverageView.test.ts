import type { CoverageEntry, RegionSummary } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { region } from '../test/fixtures.js';
import {
  columnTotal,
  compactValue,
  coverageRows,
  entryOf,
  intensity,
  isExplored,
  metricMax,
  metricValue,
} from './coverageView.js';

const entry = (over: Partial<CoverageEntry> = {}): CoverageEntry => ({
  regionId: 'sfax',
  sectorId: 'textile',
  queriesRun: 4,
  newPlaces: 10,
  leads: 5,
  spendUsd: 2.5,
  costPerLeadUsd: 0.5,
  lastRunAt: '2026-10-17T10:00:00.000Z',
  state: 'yielding',
  ...over,
});

const none: Partial<RegionSummary> = { hasBounds: false, runs: 0, leads: 0, coverage: null };

describe('which regions are greyed out', () => {
  it('greys a region with no bounds, no run and no leads', () => {
    expect(isExplored(region(none))).toBe(false);
  });

  it.each([
    ['has bounds', { hasBounds: true }],
    ['has been run', { runs: 1 }],
    ['has leads', { leads: 2 }],
  ])('keeps a region that %s', (_, over) => {
    expect(isExplored(region({ ...none, ...over }))).toBe(true);
  });
});

describe('coverageRows', () => {
  const regions = [
    { regionId: 'gabes', name: 'Gabès', country: 'TN' as const },
    { regionId: 'tunis', name: 'Tunis', country: 'TN' as const },
    { regionId: 'beja', name: 'Béja', country: 'TN' as const },
    { regionId: 'sfax', name: 'Sfax', country: 'TN' as const },
    { regionId: 'ariana', name: 'Ariana', country: 'TN' as const },
  ];
  const summaries = [
    region({ regionId: 'sfax', name: 'Sfax', coverage: 0.6 }),
    region({ regionId: 'tunis', name: 'Tunis', coverage: 0.2 }),
    region({ regionId: 'ariana', name: 'Ariana', coverage: 0.6 }),
    region({ regionId: 'gabes', name: 'Gabès', ...none }),
    region({ regionId: 'beja', name: 'Béja', ...none }),
  ];

  it('shows every region, explored first by coverage then name, then the greyed ones by name', () => {
    const rows = coverageRows({ regions }, summaries);
    expect(rows.map((r) => r.regionId)).toEqual(['ariana', 'sfax', 'tunis', 'beja', 'gabes']);
    expect(rows.map((r) => r.explored)).toEqual([true, true, true, false, false]);
  });

  it('keeps a region that has no summary yet, greyed', () => {
    const rows = coverageRows({ regions }, summaries.slice(0, 2));
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => !r.explored)).toHaveLength(3);
  });
});

describe('metrics', () => {
  it('reads leads, cost and yield (new places per search) from an entry', () => {
    const e = entry();
    expect(metricValue('leads', e)).toBe(5);
    expect(metricValue('cost', e)).toBe(2.5);
    expect(metricValue('yield', e)).toBe(2.5);
    expect(metricValue('status', e)).toBeNull();
    expect(metricValue('yield', entry({ queriesRun: 0 }))).toBeNull();
  });

  it('gives a pair never searched an empty entry', () => {
    expect(entryOf({ entries: [] }, 'sfax', 'textile')).toMatchObject({
      state: 'not_searched',
      leads: 0,
      lastRunAt: null,
    });
  });

  it('puts a value on a scale of 0 to 4 against the largest', () => {
    expect(intensity(null, 10)).toBe(0);
    expect(intensity(0, 10)).toBe(0);
    expect(intensity(1, 10)).toBe(1);
    expect(intensity(5, 10)).toBe(2);
    expect(intensity(10, 10)).toBe(4);
    expect(metricMax('leads', [entry({ leads: 3 }), entry({ leads: 9 })])).toBe(9);
  });

  it('shortens numbers for a small square', () => {
    expect(compactValue('leads', 12)).toBe('12');
    expect(compactValue('leads', 1500)).toBe('1.5k');
    expect(compactValue('cost', 2.54)).toBe('2.5');
    expect(compactValue('yield', 120.4)).toBe('120');
    expect(compactValue('leads', 0)).toBe('');
  });

  it('totals a column by the metric', () => {
    const list = [entry(), entry({ leads: 1, spendUsd: 1, queriesRun: 6, newPlaces: 2 })];
    expect(columnTotal('leads', list)).toBe(6);
    expect(columnTotal('cost', list)).toBe(3.5);
    expect(columnTotal('yield', list)).toBe(1.2);
    expect(columnTotal('status', [...list, entry({ state: 'not_searched' })])).toBe(2);
  });
});

import type { CoverageEntry } from '@lead-gen-crm/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  capText,
  confirmReason,
  leadsRange,
  parseCap,
  readCap,
  regionProgress,
  saveCap,
  suggestedSectors,
} from './startPlan.js';

const entry = (over: Partial<CoverageEntry>): CoverageEntry => ({
  regionId: 'sfax',
  sectorId: 'textile',
  queriesRun: 10,
  newPlaces: 20,
  leads: 3,
  spendUsd: 1,
  costPerLeadUsd: 0.3,
  lastRunAt: null,
  state: 'yielding',
  ...over,
});

describe('suggestedSectors', () => {
  it('picks the yielding sector with the most new places per search', () => {
    const entries = [
      entry({ sectorId: 'a', newPlaces: 10 }),
      entry({ sectorId: 'b', newPlaces: 50 }),
      entry({ sectorId: 'c', newPlaces: 90, state: 'saturated' }),
    ];
    expect(suggestedSectors({ entries }, 'sfax')).toEqual(['b']);
  });

  it('breaks a tie by leads and ignores other regions', () => {
    const entries = [
      entry({ sectorId: 'a', leads: 1 }),
      entry({ sectorId: 'b', leads: 4 }),
      entry({ sectorId: 'z', regionId: 'tunis', newPlaces: 999 }),
    ];
    expect(suggestedSectors({ entries }, 'sfax')).toEqual(['b']);
  });

  it('suggests nothing when the region has no history', () => {
    expect(suggestedSectors({ entries: [] }, 'sfax')).toEqual([]);
    expect(
      suggestedSectors({ entries: [entry({ state: 'not_searched', queriesRun: 0 })] }, 'sfax'),
    ).toEqual([]);
  });
});

describe('cap', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to $2, remembers the last one and ignores junk', () => {
    expect(readCap()).toBe(2);
    saveCap(4.5);
    expect(readCap()).toBe(4.5);
    window.localStorage.setItem('leadgen.run.cap', 'abc');
    expect(readCap()).toBe(2);
    window.localStorage.setItem('leadgen.run.cap', '-1');
    expect(readCap()).toBe(2);
  });

  it('formats and parses', () => {
    expect(capText(2)).toBe('2.00');
    expect(parseCap('2.50')).toBe(2.5);
    expect(parseCap('')).toBeNull();
    expect(parseCap('0')).toBeNull();
    expect(parseCap('-3')).toBeNull();
    expect(parseCap('abc')).toBeNull();
  });
});

describe('leadsRange', () => {
  it('is a band around the estimate and never starts at zero', () => {
    expect(leadsRange(6)).toEqual({ low: 3, high: 9 });
    expect(leadsRange(1)).toEqual({ low: 1, high: 2 });
  });
  it('is null when there is too little to say', () => {
    expect(leadsRange(0)).toBeNull();
    expect(leadsRange(0.4)).toBeNull();
    expect(leadsRange(Number.NaN)).toBeNull();
  });
});

describe('confirmReason', () => {
  it('asks when the estimate is above the cap or the cap is above $5', () => {
    expect(confirmReason(2, 3.5)).toEqual({ aboveCap: true, bigCap: false });
    expect(confirmReason(8, 1)).toEqual({ aboveCap: false, bigCap: true });
    expect(confirmReason(2, 2)).toBeNull();
    expect(confirmReason(5, null)).toBeNull();
  });
});

describe('regionProgress', () => {
  it('reads not searched, partly and fully covered', () => {
    expect(regionProgress({ coverage: null, status: 'active' })).toBe('new');
    expect(regionProgress({ coverage: 0.3, status: 'active' })).toBe('partly');
    expect(regionProgress({ coverage: 1, status: 'saturated' })).toBe('saturated');
  });
});

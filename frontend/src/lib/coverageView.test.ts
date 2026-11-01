import type { RegionSummary } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { region } from '../test/fixtures.js';
import { isExplored, yieldOf } from './coverageView.js';

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

describe('yieldOf', () => {
  it('is new places per search, and nothing before a search', () => {
    expect(yieldOf({ queriesRun: 4, newPlaces: 10 })).toBe(2.5);
    expect(yieldOf({ queriesRun: 0, newPlaces: 0 })).toBeNull();
  });
});

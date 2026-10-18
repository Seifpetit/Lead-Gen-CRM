import { describe, expect, it } from 'vitest';
import type { CellStats } from '../data/saturation.js';
import { ALL_WORDINGS, leadsPerDollar, planRunCells, wideningSuggestions } from './scheduler.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const cell = (key: string, s: Partial<CellStats> = {}): CellStats => ({
  regionCellId: `id-${key}`,
  cellKey: key,
  bounds: { south: 0, west: 0, north: 1, east: 1 },
  spendUsd: 0,
  leads: 0,
  queriesRun: 0,
  placesFound: 0,
  newPlacesFound: 0,
  lastRunAt: null,
  exhaustedAt: null,
  claimedByRunId: null,
  ...s,
});
const config = { cellsPerRun: 3, maintenanceIntervalDays: 30 };

describe('planRunCells', () => {
  const stats = [
    cell('a', { leads: 10, spendUsd: 5, queriesRun: 10 }), // 2 per $
    cell('b', { leads: 10, spendUsd: 1, queriesRun: 10 }), // 10 per $
    cell('c', { leads: 1, spendUsd: 1, queriesRun: 10 }), // 1 per $
    cell('d', { queriesRun: 5 }),
    cell('e'),
    cell('f', { leads: 50, spendUsd: 1, exhaustedAt: NOW }),
    cell('g', { leads: 50, spendUsd: 1, claimedByRunId: 'other' }),
  ];

  it('exploits the best leads per dollar, keeps a slot to explore, skips exhausted and claimed', () => {
    const plan = planRunCells(stats, config, { mode: 'normal', now: NOW });
    expect(plan.cellIds).toEqual(['id-b', 'id-a', 'id-e']);
    expect(plan.reasons[0]).toMatch(/exploit, 10 leads for \$1.00/);
    expect(plan.reasons[2]).toMatch(/explore, never searched/);
  });

  it('explores only on an explore turn, never-searched first', () => {
    const plan = planRunCells(stats, config, { mode: 'normal', now: NOW, explore: true });
    expect(plan.cellIds).toEqual(['id-e', 'id-d', 'id-b']);
  });

  it('maintenance picks cells due for a slow re-run, exhausted or not, oldest first', () => {
    const old = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
    const plan = planRunCells(
      [
        cell('a', { lastRunAt: old(10) }),
        cell('b', { lastRunAt: old(40), exhaustedAt: NOW }),
        cell('c', { lastRunAt: old(90), exhaustedAt: NOW }),
      ],
      config,
      { mode: 'maintenance', now: NOW },
    );
    expect(plan.cellIds).toEqual(['id-c', 'id-b']);
  });

  it('never divides by zero', () => {
    expect(leadsPerDollar({ leads: 3, spendUsd: 0 })).toBe(300);
  });
});

describe('wordings', () => {
  it('lists every distinct French wording once', () => {
    expect(new Set(ALL_WORDINGS).size).toBe(ALL_WORDINGS.length);
    expect(ALL_WORDINGS).toContain('usine textile');
  });

  it('suggests widening without inventing Arabic terms', () => {
    const s = wideningSuggestions();
    expect(s).toHaveLength(3);
    expect(s[2]).toMatch(/none are configured/);
  });
});

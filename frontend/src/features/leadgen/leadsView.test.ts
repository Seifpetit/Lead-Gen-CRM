import { describe, expect, it } from 'vitest';
import { company, contact, evidence, lead } from '../../test/fixtures.js';
import { applyView, foundAt, leadsBySector, leadsPerDay, type LeadFilters } from './leadsView.js';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const noRuns = new Map<string, string>();
const found = (iso: string) => [{ ...evidence('placeId', 'p'), fetchedAt: iso }];

const a = lead({
  id: 'a',
  company: company({
    id: 'ca',
    name: 'Alpha Freight',
    sector: 'textile',
    evidence: found('2026-10-18T08:00:00Z'),
  }),
  contact: null,
  score: { companyFit: 30, contactFit: 0, reachability: 5, total: 35 },
});
const b = lead({
  id: 'b',
  crmStage: 'confirmed',
  company: company({
    id: 'cb',
    name: 'Beta Logistics',
    sector: 'food',
    evidence: found('2026-10-16T08:00:00Z'),
  }),
  contact: contact({ evidence: found('2026-10-15T08:00:00Z'), fullName: 'Sami Beta' }),
  score: { companyFit: 40, contactFit: 25, reachability: 12, total: 77 },
});
const c = lead({
  id: 'c',
  crmStage: 'dismissed',
  runId: 'run-old',
  company: company({ id: 'cc', name: 'Gamma Trade', sector: 'textile', evidence: [] }),
  contact: null,
  score: { companyFit: 50, contactFit: 0, reachability: 0, total: 50 },
});
const runs = new Map([['run-old', '2026-10-10T09:00:00Z']]);
const view = (over: Partial<LeadFilters> = {}): string[] =>
  applyView([a, b, c], { tab: 'all', query: '', score: 'any', sort: 'newest', ...over }, runs).map(
    (l) => l.id,
  );

describe('foundAt', () => {
  it('is the earliest time any fact was read, then the run’s start', () => {
    expect(foundAt(b, noRuns)).toBe('2026-10-15T08:00:00.000Z');
    expect(foundAt(c, runs)).toBe('2026-10-10T09:00:00Z');
    expect(foundAt(c, noRuns)).toBeNull();
  });
});

describe('applyView', () => {
  it('sorts newest first, by score, or by company', () => {
    expect(view()).toEqual(['a', 'b', 'c']);
    expect(view({ sort: 'score' })).toEqual(['b', 'c', 'a']);
    expect(view({ sort: 'company' })).toEqual(['a', 'b', 'c']);
  });
  it('filters by tab and minimum score', () => {
    expect(view({ tab: 'confirmed' })).toEqual(['b']);
    expect(view({ tab: 'dismissed' })).toEqual(['c']);
    expect(view({ score: '50' })).toEqual(['b', 'c']);
    expect(view({ score: '70' })).toEqual(['b']);
  });
  it('searches company, person, title and website, ignoring case', () => {
    expect(view({ query: 'GAMMA' })).toEqual(['c']);
    expect(view({ query: 'sami' })).toEqual(['b']);
    expect(view({ query: 'logistique' })).toEqual(['b']);
    expect(view({ query: 'nothing like this' })).toEqual([]);
  });
});

describe('charts data', () => {
  it('counts leads per day over the range, keeping the empty days', () => {
    const days = leadsPerDay([a, b, c], runs, 7, NOW);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ day: '2026-10-12', count: 0 });
    expect(days.find((d) => d.day === '2026-10-18')!.count).toBe(1);
    expect(days.find((d) => d.day === '2026-10-15')!.count).toBe(1);
    // c was found on 10 Oct, outside a 7-day range but inside 30.
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(2);
    expect(leadsPerDay([a, b, c], runs, 30, NOW).reduce((n, d) => n + d.count, 0)).toBe(3);
  });
  it('counts leads per sector in the range, most first', () => {
    expect(leadsBySector([a, b, c], runs, 30, NOW)).toEqual([
      { sectorId: 'textile', count: 2 },
      { sectorId: 'food', count: 1 },
    ]);
    expect(leadsBySector([a, b, c], runs, 7, NOW)).toEqual([
      { sectorId: 'textile', count: 1 },
      { sectorId: 'food', count: 1 },
    ]);
  });
});

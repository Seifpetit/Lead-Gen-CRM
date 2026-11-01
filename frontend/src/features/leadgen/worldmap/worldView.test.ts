import type { MapPin } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { countries, region } from '../../../test/fixtures.js';
import { countryTotals, pinsPerRegion, regionTone, sortRegions, toneMap } from './worldView.js';

const pin = (over: Partial<MapPin> = {}): MapPin => ({
  companyId: 'c1',
  name: 'Huilerie Baccar',
  lat: 34.7,
  lng: 10.7,
  country: 'TN',
  regionId: 'sfax',
  sector: null,
  tradeRole: 'exporter',
  category: null,
  city: null,
  phone: null,
  website: null,
  stage: 'found',
  score: null,
  runId: null,
  leadId: null,
  ...over,
});

describe('regionTone', () => {
  it('is saturated, worked on, or untouched', () => {
    expect(regionTone(region({ status: 'saturated' }))).toBe('saturated');
    expect(regionTone(region({ status: 'active', queriesRun: 3, leads: 0, runs: 0 }))).toBe(
      'active',
    );
    expect(regionTone(region({ status: 'active', queriesRun: 0, leads: 0, runs: 0 }))).toBe('none');
  });

  it('maps every region id to its tone', () => {
    const tones = toneMap([
      region({ regionId: 'a', status: 'saturated' }),
      region({ regionId: 'b', status: 'active', queriesRun: 0, leads: 0, runs: 0 }),
    ]);
    expect([...tones]).toEqual([
      ['a', 'saturated'],
      ['b', 'none'],
    ]);
  });
});

describe('sortRegions', () => {
  it('puts explored regions first, most covered first, and the untouched ones after by name', () => {
    const none = { hasBounds: false, runs: 0, leads: 0, coverage: null };
    const sorted = sortRegions([
      region({ ...none, regionId: 'z', name: 'Zaghouan' }),
      region({ regionId: 'a', name: 'Ariana', hasBounds: true, coverage: 0.2 }),
      region({ ...none, regionId: 'b', name: 'Béja' }),
      region({ regionId: 's', name: 'Sfax', hasBounds: true, coverage: 0.7 }),
    ]);
    expect(sorted.map((r) => r.regionId)).toEqual(['s', 'a', 'b', 'z']);
  });
});

describe('countryTotals', () => {
  it('counts pins and sums leads and spend per country, supported countries first', () => {
    const rows = countryTotals(
      countries(),
      [
        region({ regionId: 'sfax', country: 'TN', leads: 3, spendUsd: 1.5, hasBounds: true }),
        region({ regionId: 'tunis', country: 'TN', leads: 2, spendUsd: 0.5, hasBounds: true }),
        region({ regionId: 'fr-bretagne', country: 'FR', leads: 1, spendUsd: 2, hasBounds: true }),
      ],
      [
        pin(),
        pin({ companyId: 'c2' }),
        pin({ companyId: 'c3', country: 'FR', regionId: 'fr-bretagne' }),
      ],
    );
    expect(rows.map((r) => r.code)).toEqual(['TN', 'FR', 'DE', 'IT']);
    expect(rows[0]).toMatchObject({ companies: 2, leads: 5, spendUsd: 2, regionsExplored: 2 });
    expect(rows[1]).toMatchObject({ companies: 1, leads: 1, spendUsd: 2 });
    expect(rows[2]).toMatchObject({ enabled: false, companies: 0 });
  });
});

describe('pinsPerRegion', () => {
  it('counts the companies of each region', () => {
    const counts = pinsPerRegion([
      pin(),
      pin({ companyId: 'c2' }),
      pin({ companyId: 'c3', regionId: 'tunis' }),
    ]);
    expect(counts.get('sfax')).toBe(2);
    expect(counts.get('tunis')).toBe(1);
    expect(counts.get('gabes')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { Outline } from '../lib/geo.js';
import { outlineBounds, pointInOutline } from '../lib/geo.js';
import { COUNTRY_REGION_SETS } from './countryRegions.js';
import { committedCountryGeometry, countryOutlineCredit } from './regionGeometry.js';

// The committed files for France, Germany and Italy come from `npm run regions:build -- FR`.
// These tests keep a rebuild honest: all regions present, boxes matching outlines, credit kept.

describe.each(COUNTRY_REGION_SETS)('committed outlines of $country', (set) => {
  const geometry = committedCountryGeometry(set.country as 'FR' | 'DE' | 'IT');

  it('has every region of the list and nothing else', () => {
    expect(Object.keys(geometry).sort()).toEqual(set.regions.map((r) => r.id).sort());
  });

  it('has bounds that are the box of the outline, in the right part of the world', () => {
    for (const [id, g] of Object.entries(geometry)) {
      const box = outlineBounds(g.outline as Outline);
      expect(g.bounds!.south, id).toBeCloseTo(box.south, 1);
      expect(g.bounds!.north, id).toBeCloseTo(box.north, 1);
      expect(g.bounds!.south).toBeGreaterThan(35);
      expect(g.bounds!.north).toBeLessThan(56);
    }
  });

  it('keeps the licence and the credit of the data', () => {
    const credit = countryOutlineCredit(set.country as 'FR' | 'DE' | 'IT');
    expect(credit.license).not.toBe('');
    expect(credit.attribution).toMatch(/geoBoundaries/);
  });
});

describe('known places fall in the right region', () => {
  it.each([
    ['FR', 'fr-ile-de-france', 2.35, 48.85],
    ['FR', 'fr-provence-alpes-cote-d-azur', 5.37, 43.3],
    ['DE', 'de-bayern', 11.58, 48.14],
    ['IT', 'it-lombardia', 9.19, 45.46],
    ['IT', 'it-sicilia', 13.36, 38.12],
  ] as const)('%s %s', (country, id, lng, lat) => {
    const g = committedCountryGeometry(country)[id]!;
    expect(pointInOutline(lat, lng, g.outline as Outline)).toBe(true);
  });
});

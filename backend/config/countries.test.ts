import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  COUNTRY_CODES,
  countryRoleKeywords,
  enabledCountries,
  getCountry,
  partnerWordings,
} from './countries.js';
import { COUNTRY_REGION_SETS, regionSetOf } from './countryRegions.js';
import { ACTIVE_SECTORS } from './sectors.js';
import { titleKeywordsFor } from './countriesTestHelpers.js';

describe('country settings', () => {
  it('has Tunisia, France, Germany and Italy; Tunisia and France are on, the other two are off with a reason', () => {
    expect([...COUNTRY_CODES].sort()).toEqual(['DE', 'FR', 'IT', 'TN']);
    expect(enabledCountries().map((c) => c.code)).toEqual(['TN', 'FR']);
    for (const code of ['DE', 'IT'] as const) {
      expect(COUNTRIES[code].enabled).toBe(false);
      expect(COUNTRIES[code].disabledReason).toMatch(/France/);
    }
  });

  it('searches its own trade in Tunisia and trades with Tunisia from the three others', () => {
    expect(COUNTRIES.TN.mode).toBe('own_trade');
    for (const code of ['FR', 'DE', 'IT'] as const) {
      expect(COUNTRIES[code].mode).toBe('trades_with_partner');
      expect(COUNTRIES[code].partnerCountry).toBe('TN');
    }
  });

  it('marks every draft word list as unverified, but not the Tunisian one', () => {
    expect(COUNTRIES.TN.unverified).toBe(false);
    for (const code of ['FR', 'DE', 'IT'] as const) expect(COUNTRIES[code].unverified).toBe(true);
  });

  it('asks the EU countries for a data-protection notice, not Tunisia', () => {
    expect(COUNTRIES.TN.gdprNotice).toBe(false);
    for (const code of ['FR', 'DE', 'IT'] as const) expect(COUNTRIES[code].gdprNotice).toBe(true);
  });

  it('treats anything unknown as Tunisia', () => {
    expect(getCountry(undefined).code).toBe('TN');
    expect(getCountry('ZZ').code).toBe('TN');
    expect(getCountry('FR').code).toBe('FR');
  });
});

describe('search words of a country that trades with Tunisia', () => {
  it('gives none for Tunisia, whose words are in sectors.ts', () => {
    expect(partnerWordings(COUNTRIES.TN, 'olive-oil')).toBeNull();
  });

  it('writes the product, the partner and a trade word, in the language of the country', () => {
    expect(partnerWordings(COUNTRIES.FR, 'olive-oil')).toEqual([
      "huile d'olive Tunisie importateur",
      "huile d'olive Tunisie exportateur",
      "huile d'olive Tunisie import export",
    ]);
    expect(partnerWordings(COUNTRIES.DE, 'olive-oil')?.[0]).toBe('Olivenöl Tunesien Importeur');
    expect(partnerWordings(COUNTRIES.IT, 'olive-oil')?.[0]).toBe(
      "olio d'oliva Tunisia importatore",
    );
  });

  it('uses the plain trade words with the partner for the general sector', () => {
    expect(partnerWordings(COUNTRIES.FR, 'import-export')).toContain('importateur Tunisie');
  });

  it('has a wording for every active product sector in every language', () => {
    for (const country of [COUNTRIES.FR, COUNTRIES.DE, COUNTRIES.IT]) {
      for (const sector of ACTIVE_SECTORS) {
        const words = partnerWordings(country, sector.id);
        expect(words?.length, `${country.code} ${sector.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('job titles per country', () => {
  it('lists the role words of a country in its own language', () => {
    expect(countryRoleKeywords(COUNTRIES.DE)).toContain('Einkaufsleiter');
    expect(countryRoleKeywords(COUNTRIES.IT)).toContain('responsabile acquisti');
    expect(countryRoleKeywords(COUNTRIES.FR)).toContain('responsable achats');
  });

  it('puts the country role words first in the LinkedIn filter, Tunisia unchanged', () => {
    const fr = titleKeywordsFor('FR');
    expect(fr.slice(0, 3)).toEqual(['responsable achats', 'directeur achats', 'acheteur']);
    expect(fr.length).toBeLessThanOrEqual(50);
    expect(new Set(fr.map((w) => w.toLowerCase())).size).toBe(fr.length);
    expect(titleKeywordsFor('TN')).toEqual(titleKeywordsFor(undefined));
  });
});

describe('region lists', () => {
  it('has 13 regions for France, 16 for Germany and 20 for Italy, with ids starting with the country', () => {
    expect(COUNTRY_REGION_SETS.map((s) => [s.country, s.regions.length])).toEqual([
      ['FR', 13],
      ['DE', 16],
      ['IT', 20],
    ]);
    for (const set of COUNTRY_REGION_SETS) {
      const prefix = `${set.country.toLowerCase()}-`;
      for (const r of set.regions) expect(r.id.startsWith(prefix)).toBe(true);
      expect(new Set(set.regions.map((r) => r.id)).size).toBe(set.regions.length);
    }
    expect(regionSetOf('TN')).toBeUndefined();
  });
});

describe('region names shared with the screens', () => {
  it('has a display name for every region of France, Germany and Italy, as in the region lists', async () => {
    const { COUNTRY_REGION_NAMES, regionLabel } = await import('@lead-gen-crm/shared');
    for (const set of COUNTRY_REGION_SETS) {
      for (const r of set.regions) expect(COUNTRY_REGION_NAMES[r.id], r.id).toBe(r.name);
    }
    expect(regionLabel('fr-bretagne')).toBe('Brittany');
    expect(regionLabel('ben-arous')).toBe('Ben Arous');
  });
});

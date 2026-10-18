import { describe, expect, it } from 'vitest';
import type { DiscoveredPlace } from '../providers/types.js';
import { FakeCompanyClassifier } from '../test/fakeClassifiers.js';
import { FIXED_NOW } from '../test/fixtures.js';
import { isReachable, qualify, qualifyByRules } from './qualify.js';

const src = 'https://www.google.com/maps/place/?q=place_id:x';
const s = (value: string) => ({
  value,
  sourceUrl: src,
  fetchedAt: FIXED_NOW,
  kind: 'fact' as const,
});
const place = (name: string, category: string | null, extra: Partial<DiscoveredPlace> = {}) =>
  ({
    provider: 'apify_google_maps',
    placeId: s('x'),
    name: s(name),
    address: null,
    category: category ? s(category) : null,
    types: [],
    website: null,
    phones: [],
    emails: [],
    linkedinUrl: null,
    location: null,
    businessStatus: 'OPERATIONAL',
    reviewsCount: null,
    mapsUrl: src,
    ...extra,
  }) satisfies DiscoveredPlace;

describe('qualify', () => {
  it.each([
    ['Huilerie El Fixture', 'Huilerie', 'qualified', 'olive-oil'],
    ['Textiles Fixture Sud', 'Usine textile', 'qualified', 'textile'],
    ['Cartonnerie du Sud', null, 'qualified', 'plastics-packaging'],
    ['Société Générale de Conserves', 'Conserverie', 'qualified', 'agri-food'],
    ['Transports Ben Fixture', 'Entreprise de transport', 'rejected', null],
    ['Trans-Fixture', 'Transitaire', 'rejected', null],
    ['Café des Délices', 'Café', 'rejected', null],
    ['Pharmacie Centrale', 'Pharmacie', 'rejected', null],
  ])('%s (%s) -> %s by rules', (name, category, verdict, sectorId) => {
    expect(qualifyByRules(place(name, category))).toMatchObject({
      verdict,
      sectorId,
      method: 'rules',
      kind: 'fact',
    });
  });

  it('rejects a permanently closed place', () => {
    const q = qualifyByRules(
      place('Cimenterie X', 'Cimenterie', { businessStatus: 'CLOSED_PERMANENTLY' }),
    );
    expect(q).toMatchObject({ verdict: 'rejected', reasons: ['permanently closed'] });
  });

  it('cites the sourced values it used', () => {
    const q = qualifyByRules(place('Huilerie El Fixture', 'Huilerie'))!;
    expect(q.evidence).toEqual([
      { field: 'name', value: 'Huilerie El Fixture', sourceUrl: src },
      { field: 'category', value: 'Huilerie', sourceUrl: src },
    ]);
  });

  it('prefers the sector of the query that found the place', () => {
    // "export" matches import-export and "huile" matches olive-oil.
    const p = place("Huile d'olive Export Fixture", null);
    expect(qualifyByRules(p)!.sectorId).toBe('olive-oil');
    expect(qualifyByRules(p, 'import-export')!.sectorId).toBe('import-export');
  });

  it('asks the classifier only when rules do not decide, as an estimate', async () => {
    const classifier = new FakeCompanyClassifier({ 'Société Fixture Industries': 'qualified' });
    const decided = await qualify(place('Huilerie El Fixture', 'Huilerie'), { classifier });
    expect(decided.method).toBe('rules');
    expect(classifier.calls).toEqual([]);

    const q = await qualify(place('Société Fixture Industries', 'Entreprise'), {
      classifier,
      querySectorId: 'chemicals',
    });
    expect(q).toMatchObject({
      verdict: 'qualified',
      method: 'classifier',
      kind: 'estimate',
      sectorId: 'chemicals',
      reasons: ['fake-classifier: fake verdict for Société Fixture Industries'],
    });
    expect(q.costs).toHaveLength(1);
    expect(classifier.calls[0]).toMatchObject({
      name: 'Société Fixture Industries',
      category: 'Entreprise',
    });
  });

  it('sends undecided places to review when no classifier is configured', async () => {
    expect(await qualify(place('Société Fixture Industries', 'Entreprise'))).toMatchObject({
      verdict: 'review',
      method: 'none',
    });
  });
});

describe('import and export sector', () => {
  it('qualifies an importer or exporter', () => {
    for (const [name, category] of [
      ['Sfax Import Export SARL', 'Société commerciale'],
      ['Olivia Exportateur', 'Exportateur'],
      ['Maghreb Commerce International', 'Commerce'],
    ] as const) {
      expect(qualifyByRules(place(name, category))).toMatchObject({
        verdict: 'qualified',
        sectorId: 'import-export',
      });
    }
  });

  it('rejects forwarders (transitaires) as competitors, even with import-export words in the name', () => {
    for (const [name, category] of [
      ['Sfax Transit Import Export', 'Import export'],
      ['Transitaire Agréé Sfax', 'Transitaire en douane'],
      ['International Freight Forwarder', 'Commerce international'],
    ] as const) {
      expect(qualifyByRules(place(name, category))).toMatchObject({
        verdict: 'rejected',
        reasons: [expect.stringContaining('freight carrier or forwarder')],
      });
    }
  });
});

describe('a name that matches two sectors', () => {
  it('prefers the sector the category field matches, over the query sector and the config order', () => {
    // "textile" and "huilerie" are both in the name; Google files the place as an oil mill.
    const p = place('Textile Huilerie Fixture', 'Huilerie');
    for (const querySector of [null, 'textile', 'olive-oil']) {
      expect(qualifyByRules(p, querySector)).toMatchObject({
        verdict: 'qualified',
        sectorId: 'olive-oil',
      });
    }
    const q = qualifyByRules(p, 'textile');
    expect(q?.reasons.join(' ')).toContain('also matched');
  });

  it('falls back to the query sector when the category settles nothing', () => {
    const p = place('Textile Huilerie Fixture', 'Société');
    expect(qualifyByRules(p, 'olive-oil')).toMatchObject({ sectorId: 'olive-oil' });
    expect(qualifyByRules(p, 'textile')).toMatchObject({ sectorId: 'textile' });
  });
});

describe('isReachable', () => {
  it('needs a phone, a website or an email', () => {
    expect(isReachable(place('Fixture', null))).toBe(false);
    expect(isReachable(place('Fixture', null, { phones: [s('  ')] }))).toBe(false);
    expect(isReachable(place('Fixture', null, { phones: [s('74 123 456')] }))).toBe(true);
    expect(isReachable(place('Fixture', null, { website: s('https://x.tn') }))).toBe(true);
    expect(isReachable(place('Fixture', null, { emails: [s('a@x.tn')] }))).toBe(true);
  });
});

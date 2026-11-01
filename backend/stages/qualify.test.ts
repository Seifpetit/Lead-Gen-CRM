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

describe('qualify by rules', () => {
  it.each([
    ['Transports Ben Fixture', 'Entreprise de transport', 'rejected', 'competitor_or_partner'],
    ['Trans-Fixture', 'Transitaire', 'rejected', 'competitor_or_partner'],
    ['Café des Délices', 'Café', 'rejected', 'not_import_export'],
    ['Pharmacie Centrale', 'Pharmacie', 'rejected', 'not_import_export'],
    ['Sfax Import Export SARL', 'Société commerciale', 'qualified', 'both'],
    ['Olivia Exportateur', 'Exportateur', 'qualified', 'exporter'],
    ['Tunis Importateur de thé', null, 'qualified', 'importer'],
    ['Maghreb Commerce International', 'Commerce', 'qualified', 'trader'],
  ])('%s (%s) -> %s, %s', (name, category, verdict, tradeRole) => {
    expect(qualifyByRules(place(name, category))).toMatchObject({
      verdict,
      tradeRole,
      method: 'rules',
      kind: 'fact',
    });
  });

  it('does not decide on a sector word alone: an oil mill may sell only at home', () => {
    for (const [name, category] of [
      ['Huilerie El Fixture', 'Huilerie'],
      ['Textiles Fixture Sud', 'Usine textile'],
      ['Cartonnerie du Sud', null],
      ['Société Générale de Conserves', 'Conserverie'],
    ] as const) {
      expect(qualifyByRules(place(name, category))).toBeNull();
    }
  });

  it('rejects a permanently closed place', () => {
    const q = qualifyByRules(
      place('Cimenterie X', 'Cimenterie', { businessStatus: 'CLOSED_PERMANENTLY' }),
    );
    expect(q).toMatchObject({ verdict: 'rejected', reasons: ['permanently closed'] });
  });

  it('cites the sourced values it used', () => {
    const q = qualifyByRules(place('Olivia Exportateur', 'Exportateur'))!;
    expect(q.evidence).toEqual([
      { field: 'name', value: 'Olivia Exportateur', sourceUrl: src },
      { field: 'category', value: 'Exportateur', sourceUrl: src },
    ]);
  });

  it('prefers the sector of the query that found the place', () => {
    // "export" matches import-export and "huile" matches olive-oil.
    const p = place("Huile d'olive Exportateur Fixture", null);
    expect(qualifyByRules(p)!.sectorId).toBe('olive-oil');
    expect(qualifyByRules(p, 'import-export')!.sectorId).toBe('import-export');
  });

  it('rejects forwarders (transitaires) as competitors, even with import-export words in the name', () => {
    for (const [name, category] of [
      ['Sfax Transit Import Export', 'Import export'],
      ['Transitaire Agréé Sfax', 'Transitaire en douane'],
      ['International Freight Forwarder', 'Commerce international'],
    ] as const) {
      expect(qualifyByRules(place(name, category))).toMatchObject({
        verdict: 'rejected',
        tradeRole: 'competitor_or_partner',
        reasons: [expect.stringContaining('freight carrier or forwarder')],
      });
    }
  });
});

describe('qualify with the classifier', () => {
  const classifier = () =>
    new FakeCompanyClassifier({
      'Société Fixture Industries': 'exporter',
      'Usine Offshore Fixture': 'exporter',
      'Epicerie du Coin': 'not_import_export',
      'Agence Maritime Fixture': 'competitor_or_partner',
      'Mystère SARL': 'unclear',
      'Acheteur Fixture': 'importer',
    });

  it('asks only when rules do not decide, and labels the answer as an estimate', async () => {
    const c = classifier();
    const decided = await qualify(place('Olivia Exportateur', 'Exportateur'), { classifier: c });
    expect(decided.method).toBe('rules');
    expect(c.calls).toEqual([]);

    const q = await qualify(place('Société Fixture Industries', 'Entreprise'), {
      classifier: c,
      querySectorId: 'chemicals',
    });
    expect(q).toMatchObject({
      verdict: 'qualified',
      tradeRole: 'exporter',
      method: 'classifier',
      kind: 'estimate',
      sectorId: 'chemicals',
      reasons: ['fake-classifier: fake verdict for Société Fixture Industries'],
    });
    expect(q.costs).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({
      name: 'Société Fixture Industries',
      category: 'Entreprise',
    });
  });

  it.each([
    ['an offshore factory', 'Usine Offshore Fixture', 'qualified', 'exporter'],
    ['a buyer of foreign goods', 'Acheteur Fixture', 'qualified', 'importer'],
    ['a local shop', 'Epicerie du Coin', 'rejected', 'not_import_export'],
    ['a shipping agent', 'Agence Maritime Fixture', 'rejected', 'competitor_or_partner'],
    ['a listing with too little to go on', 'Mystère SARL', 'review', 'unclear'],
  ])('maps %s to a pipeline verdict', async (_what, name, verdict, tradeRole) => {
    expect(await qualify(place(name, null), { classifier: classifier() })).toMatchObject({
      verdict,
      tradeRole,
    });
  });

  it('tells the classifier which question to ask for the country mode', async () => {
    const c = classifier();
    await qualify(place('Société Fixture Industries', null), { classifier: c });
    await qualify(place('Acheteur Fixture', null), {
      classifier: c,
      mode: 'trades_with_partner',
      partnerCountry: 'TN',
    });
    expect(c.calls[0]?.mode).toBeUndefined();
    expect(c.calls[1]).toMatchObject({ mode: 'trades_with_partner', partnerCountry: 'TN' });
  });

  it('sends undecided places to review when no classifier is configured', async () => {
    expect(await qualify(place('Société Fixture Industries', 'Entreprise'))).toMatchObject({
      verdict: 'review',
      method: 'none',
      tradeRole: null,
    });
  });

  it('keeps the sector the name suggests when the classifier decides', async () => {
    const q = await qualify(place('Textiles Fixture Sud', 'Usine textile'), {
      classifier: new FakeCompanyClassifier({ 'Textiles Fixture Sud': 'both' }),
    });
    expect(q).toMatchObject({ verdict: 'qualified', tradeRole: 'both', sectorId: 'textile' });
  });
});

describe('a name that matches two sectors', () => {
  it('prefers the sector the category field matches, over the query sector and the config order', async () => {
    // "textile" and "huilerie" are both in the name; Google files the place as an oil mill.
    const p = place('Textile Huilerie Exportateur', 'Huilerie');
    for (const querySector of [null, 'textile', 'olive-oil']) {
      expect(qualifyByRules(p, querySector)).toMatchObject({
        verdict: 'qualified',
        sectorId: 'olive-oil',
      });
    }
  });

  it('falls back to the query sector when the category settles nothing', () => {
    const p = place('Textile Huilerie Exportateur', 'Société');
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

describe('qualify by rules in a country that trades with a partner', () => {
  it('still rejects carriers and shops, but leaves "import export" in a name to the classifier', () => {
    expect(
      qualifyByRules(place('Transports Dupont', 'Transport'), null, 'trades_with_partner'),
    ).toMatchObject({ verdict: 'rejected', tradeRole: 'competitor_or_partner' });
    expect(
      qualifyByRules(place('Pharmacie Centrale', 'Pharmacie'), null, 'trades_with_partner'),
    ).toMatchObject({ verdict: 'rejected', tradeRole: 'not_import_export' });
    expect(
      qualifyByRules(place('Lyon Import Export SARL', 'Société'), null, 'trades_with_partner'),
    ).toBeNull();
    // The same name qualifies in Tunisia itself.
    expect(qualifyByRules(place('Sfax Import Export SARL', 'Société'))).toMatchObject({
      verdict: 'qualified',
    });
  });

  it('knows German and Italian carriers and shops', () => {
    expect(
      qualifyByRules(place('Müller Spedition GmbH', 'Spedition'), null, 'trades_with_partner'),
    ).toMatchObject({ verdict: 'rejected', tradeRole: 'competitor_or_partner' });
    expect(
      qualifyByRules(place('Rossi Trasporti', 'Trasporti'), null, 'trades_with_partner'),
    ).toMatchObject({ verdict: 'rejected', tradeRole: 'competitor_or_partner' });
  });
});

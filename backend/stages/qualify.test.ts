import { describe, expect, it } from 'vitest';
import type { DiscoveredPlace } from '../providers/types.js';
import { FakeCompanyClassifier } from '../test/fakeClassifiers.js';
import { FIXED_NOW } from '../test/fixtures.js';
import { qualify, qualifyByRules } from './qualify.js';

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

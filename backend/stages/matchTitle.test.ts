import { describe, expect, it } from 'vitest';
import { FakeTitleClassifier } from '../test/fakeClassifiers.js';
import { matchTitle, matchTitleByRules } from './matchTitle.js';

describe('matchTitle', () => {
  it.each([
    // French
    ['Directrice Logistique', 'logistics', 'dictionary', 'head'],
    ['Responsable Achats & Approvisionnements', 'purchasing', 'dictionary', 'manager'],
    ['Chef de Parc', 'transport', 'dictionary', 'manager'],
    ['Directeur Général Adjoint', 'general_manager', 'dictionary', 'head'],
    ['Gérant', 'general_manager', 'dictionary', 'head'],
    ["Directeur d'usine", 'operations', 'dictionary', 'head'],
    ['Responsable Supply Chain - Groupe', 'supply_chain', 'dictionary', 'manager'],
    // English
    ['Supply Chain Manager | Olive oil exports', 'supply_chain', 'dictionary', 'manager'],
    ['Head of Procurement', 'purchasing', 'dictionary', 'head'],
    ['CEO & Founder', 'general_manager', 'dictionary', 'head'],
    // Keyword rule: role word plus seniority word, not listed verbatim.
    ['Logistics & Transport Manager', 'transport', 'dictionary', 'manager'],
    ['Logistics & Warehouse Lead', 'logistics', 'keywords', 'manager'],
    ['Directeur des Expéditions', 'transport', 'keywords', 'head'],
    // Filler words between the role and its field.
    ['Responsable des achats', 'purchasing', 'dictionary', 'manager'],
    ['Responsable de la logistique', 'logistics', 'dictionary', 'manager'],
    ['Responsable du transport', 'transport', 'dictionary', 'manager'],
    ['Directeur de la Supply Chain', 'supply_chain', 'dictionary', 'head'],
    ["Responsable de l'approvisionnement", 'purchasing', 'dictionary', 'manager'],
    ['Head of the Logistics Department', 'logistics', 'dictionary', 'head'],
  ])('%s -> %s (%s)', (title, roleClass, method, seniority) => {
    const m = matchTitleByRules(title);
    expect(m).toMatchObject({ roleClass, method, seniority, kind: 'fact' });
  });

  it.each(['Assistante Logistique', 'Stagiaire Supply Chain', 'Logistics Intern'])(
    'excludes %s without asking the classifier',
    async (title) => {
      const classifier = new FakeTitleClassifier({ [title]: 'logistics' });
      const m = await matchTitle(title, classifier);
      expect(m).toMatchObject({ roleClass: null, method: 'excluded' });
      expect(classifier.calls).toEqual([]);
    },
  );

  it('needs a manager-level word for a keyword match', () => {
    expect(matchTitleByRules('Chauffeur transport').roleClass).toBeNull();
  });

  it('asks the classifier only for misses, and marks its answer as an estimate', async () => {
    const classifier = new FakeTitleClassifier({
      'Directeur Commercial Export': null,
      'Chargé de flux': 'logistics',
    });
    expect((await matchTitle('Directrice Logistique', classifier)).method).toBe('dictionary');
    expect(classifier.calls).toEqual([]);

    const miss = await matchTitle('Chargé de flux', classifier);
    expect(miss).toMatchObject({ roleClass: 'logistics', method: 'classifier', kind: 'estimate' });
    expect(miss.costs).toHaveLength(1);
    expect((await matchTitle('Chargé de communication', classifier)).roleClass).toBeNull();
    expect(classifier.calls).toEqual(['Chargé de flux', 'Chargé de communication']);
  });

  it('returns no match without a classifier', async () => {
    expect(await matchTitle('Directeur Financier')).toMatchObject({
      roleClass: null,
      method: 'none',
      seniority: 'head',
    });
  });
});

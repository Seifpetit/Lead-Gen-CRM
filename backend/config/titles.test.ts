import { ROLE_CLASSES } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { TITLE_DICTIONARY, normalizeTitle } from './titles.js';

describe('TITLE_DICTIONARY', () => {
  it('covers all six role classes', () => {
    expect(Object.keys(TITLE_DICTIONARY).sort()).toEqual([...ROLE_CLASSES].sort());
  });

  it('stores every variant already normalized', () => {
    for (const variants of Object.values(TITLE_DICTIONARY)) {
      for (const v of variants) expect(normalizeTitle(v)).toBe(v);
    }
  });

  it('maps no variant to two role classes', () => {
    const all = Object.values(TITLE_DICTIONARY).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('normalizeTitle', () => {
  it('strips accents, punctuation and case', () => {
    expect(normalizeTitle('  Directrice Générale  ')).toBe('directrice generale');
    expect(normalizeTitle("Directeur d'Usine")).toBe('directeur d usine');
    expect(normalizeTitle('Co-Gérant')).toBe('co gerant');
  });
});

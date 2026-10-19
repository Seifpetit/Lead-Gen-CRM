import { describe, expect, it } from 'vitest';
import { cityFromAddress, formatPhone, regionLabel, titleCase } from './places.js';

describe('titleCase', () => {
  it('writes names with a capital on each word', () => {
    expect(titleCase('SFAX')).toBe('Sfax');
    expect(titleCase('ben arous')).toBe('Ben Arous');
    expect(titleCase('sidi-bouzid')).toBe('Sidi Bouzid');
    expect(titleCase('  la  marsa  ')).toBe('La Marsa');
    expect(titleCase('GABÈS')).toBe('Gabès');
    expect(titleCase("sidi d'abdelhamid")).toBe("Sidi D'Abdelhamid");
  });
  it('turns a region id into its name', () => {
    expect(regionLabel('ben-arous')).toBe('Ben Arous');
    expect(regionLabel('bizerte')).toBe('Bizerte');
  });
});

describe('cityFromAddress', () => {
  it('takes the part before the country, without the postal code', () => {
    expect(cityFromAddress('Route de Tunis km 3, 3000 Sfax, Tunisia')).toBe('Sfax');
    expect(cityFromAddress('Zone industrielle, Sfax 3041, Tunisie')).toBe('Sfax');
    expect(cityFromAddress('RN1, MEGRINE, Tunisie')).toBe('Megrine');
  });
  it('looks one part back when a part is only a postal code', () => {
    expect(cityFromAddress('Rue 12, Bizerte, 7000, Tunisia')).toBe('Bizerte');
  });
  it('is null when there is nothing to read', () => {
    expect(cityFromAddress(null)).toBeNull();
    expect(cityFromAddress('')).toBeNull();
    expect(cityFromAddress('Tunisia')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('writes a Tunisian number as +216 XX XXX XXX in any common form', () => {
    for (const raw of [
      '+216 74 679 952',
      '74679952',
      '74 679 952',
      '+21674679952',
      '00216 74 679 952',
      '(+216) 74-679-952',
    ]) {
      expect(formatPhone(raw), raw).toBe('+216 74 679 952');
    }
  });
  it('leaves a foreign number as written', () => {
    expect(formatPhone('+33 1 23 45 67 89')).toBe('+33 1 23 45 67 89');
    expect(formatPhone('+12345678')).toBe('+12345678');
  });
  it('is null for nothing', () => {
    expect(formatPhone(null)).toBeNull();
    expect(formatPhone('  ')).toBeNull();
  });
});

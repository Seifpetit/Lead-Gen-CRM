import { describe, expect, it } from 'vitest';
import { normalizeCompanyName, normalizeDomain, phoneKey } from './normalize.js';

describe('normalizeCompanyName', () => {
  it.each([
    ['Sté Transports Ben Salah SARL', 'transports ben salah'],
    ['STE. TRANSPORTS BEN SALAH', 'transports ben salah'],
    ['Transports Ben Salah S.A.R.L.', 'transports ben salah'],
    ['Société Générale des Huiles S.A.', 'generale des huiles'],
    ['Huilerie Él Amène', 'huilerie el amene'],
    ['Comptoir Sfaxien SUARL', 'comptoir sfaxien'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  it('keeps legal-form letters inside words', () => {
    expect(normalizeCompanyName('Sahara Steel SA')).toBe('sahara steel');
  });
});

describe('normalizeDomain', () => {
  it.each([
    ['https://www.Example.tn/contact?x=1', 'example.tn'],
    ['example.com.tn', 'example.com.tn'],
    ['http://shop.example.tn:8080', 'shop.example.tn'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    'https://www.facebook.com/somecompany',
    'https://m.facebook.com/x',
    'instagram.com/x',
    'gmail.com',
    '',
    'not a url',
  ])('returns null for shared or invalid host %s', (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe('phoneKey', () => {
  it('treats local, +216 and 00216 forms as the same number', () => {
    expect(phoneKey('74 123 456')).toBe('21674123456');
    expect(phoneKey('+216 74 123 456')).toBe('21674123456');
    expect(phoneKey('00216-74-123-456')).toBe('21674123456');
  });
});

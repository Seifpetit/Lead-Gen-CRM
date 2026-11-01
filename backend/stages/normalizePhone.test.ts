import { describe, expect, it } from 'vitest';
import { classifyPhone, normalizePhone, normalizePhones } from './normalizePhone.js';

describe('normalizePhone', () => {
  it.each([
    ['+216 98 123 456', '+21698123456', 'mobile'],
    ['00216-74.123.456', '+21674123456', 'landline'],
    ['(+216) 52123456', '+21652123456', 'mobile'],
    ['216 29 123 456', '+21629123456', 'mobile'],
    ['+216 (0)74 123 456', '+21674123456', 'landline'],
    ['74/123/456', '+21674123456', 'landline'],
    ['Tél : 98 123 456', '+21698123456', 'mobile'],
    ['80 100 200', '+21680100200', 'special'],
  ])('%s -> %s', (raw, e164, line) => {
    expect(normalizePhone(raw)).toEqual({ e164, line });
  });

  it.each([
    '',
    '123',
    '+33 1 23 45 67 89', // French number
    '98 123 45', // 7 digits
    '98 123 4567', // 9 digits
    '16 123 456', // no such prefix
    '74 123 456 poste 12', // extension
    'fax 74 123 456',
  ])('rejects %j', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it('splits lists and drops duplicates and bad numbers', () => {
    expect(normalizePhones('74 123 456 / 98 765 432; +21674123456, 12').map((p) => p.e164)).toEqual(
      ['+21674123456', '+21698765432'],
    );
  });
});

describe('classifyPhone', () => {
  it('normalizes Tunisian numbers to +216 and does not flag them', () => {
    expect(classifyPhone('98 123 456')).toEqual({
      e164: '+21698123456',
      line: 'mobile',
      foreign: false,
    });
    expect(classifyPhone('00216 74 123 456')).toEqual({
      e164: '+21674123456',
      line: 'landline',
      foreign: false,
    });
  });

  it.each([
    ['+33 1 23 45 67 89', '+33123456789'],
    ['0033 1 23 45 67 89', '+33123456789'],
    ['+1 (415) 555 2671', '+14155552671'],
    ['+213 21 23 45 67', '+21321234567'],
  ])('keeps %s as %s and flags it as foreign', (raw, e164) => {
    expect(classifyPhone(raw)).toEqual({ e164, line: null, foreign: true });
  });

  it.each(['', '123', 'fax +33 1 23 45 67 89', '98 123 4567', '+33 12', '+0 123 456 789'])(
    'returns null for %j',
    (raw) => {
      expect(classifyPhone(raw)).toBeNull();
    },
  );
});

describe('phone numbers per country', () => {
  it.each([
    ['06 12 34 56 78', 'FR', '+33612345678', 'mobile'],
    ['+33 7 12 34 56 78', 'FR', '+33712345678', 'mobile'],
    ['01 23 45 67 89', 'FR', '+33123456789', 'landline'],
    ['0033 4 91 23 45 67', 'FR', '+33491234567', 'landline'],
    ['08 05 12 34 56', 'FR', '+33805123456', 'special'],
    ['0171 2345678', 'DE', '+491712345678', 'mobile'],
    ['+49 (0)151 23456789', 'DE', '+4915123456789', 'mobile'],
    ['030 1234567', 'DE', '+49301234567', 'landline'],
    ['0800 1234567', 'DE', '+498001234567', 'special'],
    ['347 123 4567', 'IT', '+393471234567', 'mobile'],
    ['+39 02 1234 5678', 'IT', '+390212345678', 'landline'],
    ['800 123456', 'IT', '+39800123456', 'special'],
  ] as const)('%s in %s -> %s (%s)', (raw, country, e164, line) => {
    expect(classifyPhone(raw, country)).toEqual({ e164, line, foreign: false });
  });

  it('keeps a Tunisian number Tunisian, and flags it foreign inside France', () => {
    expect(classifyPhone('98 123 456')).toEqual({
      e164: '+21698123456',
      line: 'mobile',
      foreign: false,
    });
    expect(classifyPhone('+216 98 123 456', 'FR')).toMatchObject({ foreign: true });
  });

  it('refuses numbers that cannot be real in the country', () => {
    expect(classifyPhone('06 12 34', 'FR')).toBeNull();
    expect(classifyPhone('abc', 'DE')).toBeNull();
    expect(classifyPhone('12345', 'IT')).toBeNull();
  });
});

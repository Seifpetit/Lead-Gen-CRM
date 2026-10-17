import { describe, expect, it } from 'vitest';
import { normalizePhone, normalizePhones } from './normalizePhone.js';

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

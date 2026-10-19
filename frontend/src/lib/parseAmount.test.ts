import { describe, expect, it } from 'vitest';
import { decimalsOf, parseAmount } from './parseAmount.js';

describe('parseAmount', () => {
  it('accepts a point or a comma as the decimal mark', () => {
    expect(parseAmount('2.5')).toBe(2.5);
    expect(parseAmount('2,5')).toBe(2.5);
    expect(parseAmount('2,50')).toBe(2.5);
    expect(parseAmount('  $3 ')).toBe(3);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('7')).toBe(7);
  });

  it('refuses what could be read two ways instead of guessing', () => {
    for (const bad of ['5,000,000', '1.234,50', '1,234.50', '5.000.000', '1 000', '2,5,', '1e6']) {
      expect(parseAmount(bad)).toBeNull();
    }
  });

  it('refuses empty, signed and non-numeric text', () => {
    for (const bad of ['', ' ', '-2', '+2', 'abc', '$', '.', ','])
      expect(parseAmount(bad)).toBeNull();
  });

  it('counts the decimals of a step', () => {
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(0.05)).toBe(2);
  });
});

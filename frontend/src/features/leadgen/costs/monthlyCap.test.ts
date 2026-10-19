import { describe, expect, it } from 'vitest';
import { monthlyCapProblem, parseMonthlyCap } from './monthlyCap.js';

describe('monthly cap', () => {
  it('accepts a dot or a comma, with up to 2 decimals', () => {
    expect(parseMonthlyCap('80')).toBe(80);
    expect(parseMonthlyCap('12,5')).toBe(12.5);
    expect(parseMonthlyCap('$12.25')).toBe(12.25);
  });

  it('says why a value is refused', () => {
    expect(monthlyCapProblem('')).toBe('invalid');
    expect(monthlyCapProblem('abc')).toBe('invalid');
    expect(monthlyCapProblem('5,000,000')).toBe('invalid');
    expect(monthlyCapProblem('2.555')).toBe('cents');
    expect(monthlyCapProblem('0')).toBe('low');
    expect(monthlyCapProblem('0.5')).toBe('low');
    expect(monthlyCapProblem('10000.01')).toBe('high');
    expect(monthlyCapProblem('5000000')).toBe('high');
    expect(monthlyCapProblem('10000')).toBeNull();
  });
});

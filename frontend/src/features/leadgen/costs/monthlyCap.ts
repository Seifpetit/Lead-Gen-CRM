import { parseAmount } from '../../../lib/parseAmount.js';

/** The least and the most a monthly cap may be, in dollars. */
export const MIN_MONTHLY_CAP_USD = 1;
export const MAX_MONTHLY_CAP_USD = 10_000;

/** Why a typed monthly cap cannot be used, or null when it can. */
export type MonthlyCapProblem = 'invalid' | 'cents' | 'low' | 'high';

/** Checks a typed cap like the run cap: an amount ("2.5" or "2,5"), at most 2 decimals, in range. */
export function monthlyCapProblem(text: string): MonthlyCapProblem | null {
  const n = parseAmount(text);
  if (n === null) return 'invalid';
  if (/[.,]\d{3,}$/.test(text.trim())) return 'cents';
  if (n < MIN_MONTHLY_CAP_USD) return 'low';
  if (n > MAX_MONTHLY_CAP_USD) return 'high';
  return null;
}

/** The cap in a field, or null when it cannot be used. */
export function parseMonthlyCap(text: string): number | null {
  return monthlyCapProblem(text) === null ? parseAmount(text) : null;
}

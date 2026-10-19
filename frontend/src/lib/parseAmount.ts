/**
 * A number typed into an amount field, or null when it is not one. Accepts "2.5" and "2,5" (a
 * French keyboard), with an optional leading "$". Anything that could be read two ways is
 * refused instead of guessed: "5,000,000" and "1.234,50" have more than one separator, so they
 * are not an amount rather than a thousand-fold surprise.
 */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/^\$\s*/, '');
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Digits after the decimal point in a step such as 0.05 (so 0.1 + 0.2 does not become 0.3000…4). */
export const decimalsOf = (step: number): number => {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
};

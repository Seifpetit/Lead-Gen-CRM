import type { CostEntry } from '../lib/cost.js';
import type { ApifyUsage } from '../providers/types.js';

/**
 * The actual costs to record for a finished step. Adapters price Apify's charged events with
 * our price table (the highest tier); when Apify also reports what the run actually costs the
 * user (usageTotalUsd), unit prices are scaled so the ledger matches the bill while keeping
 * the per-event breakdown. Units never change.
 */
export function actualCosts(costs: readonly CostEntry[], usage: ApifyUsage | null): CostEntry[] {
  const priced = costs.reduce((s, c) => s + c.amountUsd, 0);
  const billed = usage?.usageTotalUsd;
  if (billed === null || billed === undefined || priced <= 0 || billed < 0) return [...costs];
  const factor = billed / priced;
  if (Math.abs(factor - 1) < 1e-9) return [...costs];
  return costs.map((c) => {
    const unitPriceUsd = Math.round(c.unitPriceUsd * factor * 1e8) / 1e8;
    return { ...c, unitPriceUsd, amountUsd: Math.round(c.units * unitPriceUsd * 1e6) / 1e6 };
  });
}

export const sumUsd = (costs: readonly { amountUsd: number }[]) =>
  Math.round(costs.reduce((s, c) => s + c.amountUsd, 0) * 1e6) / 1e6;

/**
 * The max cost to pass to Apify for one step: the estimate with headroom, never more than what
 * the run may still spend, and never below the Actor's own minimum (when it is, the step can't
 * start safely and null is returned).
 */
export function maxChargeFor(
  estimateUsd: number,
  remainingUsd: number,
  headroom: number,
  actorMinimumUsd = 0,
): number | null {
  const cap = Math.min(remainingUsd, Math.max(estimateUsd * headroom, actorMinimumUsd));
  if (cap < actorMinimumUsd || cap <= 0) return null;
  return Math.floor(cap * 1e4) / 1e4;
}

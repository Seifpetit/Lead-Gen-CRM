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

export type StepFit =
  | { fits: true; maxChargeUsd: number | null }
  /** The step can never start under this run's caps: stop the run. */
  | { fits: false; wait: false; reason: 'estimate' | 'actor_minimum'; message: string }
  /** The caps would allow it, but steps already in flight hold the budget: try again later. */
  | { fits: false; wait: true; reason: 'reserved_headroom' };

/**
 * Whether a step may start. `remainingUsd` is what the caps leave after the headroom reserved
 * for steps in flight; `unreservedUsd` is what they leave before it. A step is refused for good
 * only when its real minimum (its estimate, or the Actor's minimum max-cost) doesn't fit in
 * `unreservedUsd`; when it fits there but not in `remainingUsd`, in-flight steps are holding
 * the difference and the step waits for them to settle. `maxChargeUsd` is null for steps
 * without an Actor (they take whatever remains).
 */
export function checkStepFit(p: {
  estimateUsd: number;
  remainingUsd: number;
  unreservedUsd: number;
  headroom: number;
  hasActor: boolean;
  actorMinimumUsd?: number;
}): StepFit {
  const actorMin = p.hasActor ? (p.actorMinimumUsd ?? 0) : 0;
  const usd = (n: number) => `$${n.toFixed(4)}`;
  if (p.estimateUsd >= p.unreservedUsd) {
    return {
      fits: false,
      wait: false,
      reason: 'estimate',
      message: `the step is estimated at ${usd(p.estimateUsd)} but only ${usd(p.unreservedUsd)} remains under the caps`,
    };
  }
  if (actorMin > p.unreservedUsd) {
    return {
      fits: false,
      wait: false,
      reason: 'actor_minimum',
      message: `the Actor needs a max cost of at least ${usd(actorMin)} (its minimum) but only ${usd(p.unreservedUsd)} remains under the caps; the estimate itself is ${usd(p.estimateUsd)}`,
    };
  }
  if (p.estimateUsd >= p.remainingUsd) {
    return { fits: false, wait: true, reason: 'reserved_headroom' };
  }
  if (!p.hasActor) return { fits: true, maxChargeUsd: null };
  const maxChargeUsd = maxChargeFor(p.estimateUsd, p.remainingUsd, p.headroom, actorMin);
  return maxChargeUsd === null
    ? { fits: false, wait: true, reason: 'reserved_headroom' }
    : { fits: true, maxChargeUsd };
}

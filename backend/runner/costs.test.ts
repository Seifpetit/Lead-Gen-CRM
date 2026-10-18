import { describe, expect, it } from 'vitest';
import { checkStepFit } from './costs.js';

const base = { headroom: 1.25, hasActor: true, actorMinimumUsd: 0.5 };

describe('checkStepFit', () => {
  it('waits, not stops, when steps in flight hold the budget (the $2 cap, $0.006 spent case)', () => {
    // $2 cap, $0.006 spent: $1.994 left; other steps hold $1.4998 of headroom, leaving $0.4942.
    const fit = checkStepFit({
      ...base,
      estimateUsd: 0.1202,
      remainingUsd: 0.4942,
      unreservedUsd: 1.994,
    });
    expect(fit).toEqual({ fits: false, wait: true, reason: 'reserved_headroom' });
  });

  it('starts once the in-flight steps settle, at the Actor minimum', () => {
    const fit = checkStepFit({
      ...base,
      estimateUsd: 0.1202,
      remainingUsd: 1.994,
      unreservedUsd: 1.994,
    });
    expect(fit).toEqual({ fits: true, maxChargeUsd: 0.5 });
  });

  it('stops for good, naming the Actor minimum, when it cannot fit under the caps', () => {
    const fit = checkStepFit({
      ...base,
      estimateUsd: 0.1202,
      remainingUsd: 0.4,
      unreservedUsd: 0.4,
    });
    expect(fit).toMatchObject({ fits: false, wait: false, reason: 'actor_minimum' });
    if (!fit.fits && !fit.wait) expect(fit.message).toContain('at least $0.5000');
  });

  it('stops for good, naming the estimate, when the estimate itself cannot fit', () => {
    const fit = checkStepFit({ ...base, estimateUsd: 0.3, remainingUsd: 0.2, unreservedUsd: 0.2 });
    expect(fit).toMatchObject({ fits: false, wait: false, reason: 'estimate' });
  });

  it('gives steps without an Actor no max charge', () => {
    const fit = checkStepFit({
      estimateUsd: 0.01,
      remainingUsd: 1,
      unreservedUsd: 1,
      headroom: 1.25,
      hasActor: false,
    });
    expect(fit).toEqual({ fits: true, maxChargeUsd: null });
  });
});

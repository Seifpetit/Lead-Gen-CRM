import { describe, expect, it } from 'vitest';
import { dailySpendJump, isSpendingFast, isStuck } from './anomaly.js';

const at = (m: number) => new Date(Date.UTC(2026, 9, 19, 14, m));

describe('stuck run', () => {
  it('is stuck once nothing has happened for the set minutes', () => {
    expect(isStuck({ lastActivity: at(0), now: at(19), minutes: 20 })).toBe(false);
    expect(isStuck({ lastActivity: at(0), now: at(20), minutes: 20 })).toBe(true);
    expect(isStuck({ lastActivity: at(0), now: at(50), minutes: 20 })).toBe(true);
  });

  it('can be turned off', () => {
    expect(isStuck({ lastActivity: at(0), now: at(59), minutes: 0 })).toBe(false);
    expect(isStuck({ lastActivity: at(0), now: at(59), minutes: -5 })).toBe(false);
  });
});

describe('spend faster than the estimate', () => {
  const base = { factor: 2, floorUsd: 0.25 };
  it('warns when actual is more than the factor times the estimate', () => {
    expect(isSpendingFast({ ...base, estimatedUsd: 1, actualUsd: 2.5 })).toBe(true);
    expect(isSpendingFast({ ...base, estimatedUsd: 1, actualUsd: 1.9 })).toBe(false);
    expect(isSpendingFast({ ...base, estimatedUsd: 1, actualUsd: 2 })).toBe(false);
  });

  it('ignores a small overrun even when the ratio is large', () => {
    expect(isSpendingFast({ ...base, estimatedUsd: 0.01, actualUsd: 0.2 })).toBe(false);
    expect(isSpendingFast({ ...base, estimatedUsd: 0.1, actualUsd: 0.5 })).toBe(true);
  });

  it('warns on spend with no estimate at all, once it passes the floor', () => {
    expect(isSpendingFast({ ...base, estimatedUsd: 0, actualUsd: 0.1 })).toBe(false);
    expect(isSpendingFast({ ...base, estimatedUsd: 0, actualUsd: 0.5 })).toBe(true);
  });

  it('can be turned off', () => {
    expect(isSpendingFast({ estimatedUsd: 1, actualUsd: 50, factor: 0, floorUsd: 0 })).toBe(false);
  });
});

describe('daily spend jump', () => {
  const base = { factor: 3, floorUsd: 1 };
  it('flags a day well above the usual one', () => {
    const r = dailySpendJump({ ...base, todayUsd: 9, earlierDaysUsd: [2, 3, 2.5, 3.5] });
    expect(r).toEqual({ jump: true, usualUsd: 2.75 });
    expect(dailySpendJump({ ...base, todayUsd: 8, earlierDaysUsd: [2, 3, 2.5, 3.5] }).jump).toBe(
      false,
    );
  });

  it('never flags a day under the floor', () => {
    expect(dailySpendJump({ ...base, todayUsd: 0.9, earlierDaysUsd: [0.01] }).jump).toBe(false);
  });

  it('with no history, flags only a day above the floor', () => {
    expect(dailySpendJump({ ...base, todayUsd: 3, earlierDaysUsd: [] }).jump).toBe(true);
    expect(dailySpendJump({ ...base, todayUsd: 2.9, earlierDaysUsd: [] }).jump).toBe(false);
  });
});

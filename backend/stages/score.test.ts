import { describe, expect, it } from 'vitest';
import { applyDismissalFeedback } from './score.js';

const base = { companyFit: 40, contactFit: 30, reachability: 20 } as never;
const lead = { sector: 'textile', roleClass: 'logistics' };

describe('applyDismissalFeedback', () => {
  it('changes nothing without dismissals', () => {
    const out = applyDismissalFeedback(base, { bySector: {}, byRoleClass: {} }, lead);
    expect(out).toMatchObject({
      companyFit: 40,
      contactFit: 30,
      reachability: 20,
      adjustments: [],
    });
  });

  it('lowers fit per dismissal, labelled as an estimate, and never touches reachability', () => {
    const out = applyDismissalFeedback(
      base,
      { bySector: { textile: 2 }, byRoleClass: { logistics: 1 } },
      lead,
    );
    expect(out.companyFit).toBe(36);
    expect(out.contactFit).toBe(27);
    expect(out.reachability).toBe(20);
    expect(out.adjustments.map((a) => a.kind)).toEqual(['estimate', 'estimate']);
  });

  it('caps the penalty and never goes below zero', () => {
    const low = { companyFit: 3, contactFit: 2, reachability: 5 } as never;
    const out = applyDismissalFeedback(
      low,
      { bySector: { textile: 99 }, byRoleClass: { logistics: 99 } },
      lead,
    );
    expect(out.companyFit).toBe(0);
    expect(out.contactFit).toBe(0);
    const big = applyDismissalFeedback(
      base,
      { bySector: { textile: 99 }, byRoleClass: { logistics: 99 } },
      lead,
    );
    expect(big.companyFit).toBe(30);
    expect(big.contactFit).toBe(21);
  });

  it('ignores other sectors and unknown leads', () => {
    const out = applyDismissalFeedback(
      base,
      { bySector: { food: 5 }, byRoleClass: { owner: 5 } },
      { sector: null, roleClass: null },
    );
    expect(out.adjustments).toEqual([]);
  });
});

import type { CrmCard } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { daysInStage, daysLeft } from './boardTime.js';

const NOW = new Date('2026-10-20T12:00:00Z');
const card = (over: Partial<CrmCard>): CrmCard => ({
  id: 'k',
  pipeline: 'companies',
  stage: 'found',
  stageEnteredAt: '2026-10-20T12:00:00Z',
  noiseAt: null,
  purgeAt: null,
  removedFrom: null,
  company: { id: 'c', name: 'A', sector: null, website: null, phone: null, email: null },
  person: null,
  score: null,
  ...over,
});

describe('days in stage', () => {
  it('counts whole days since the card entered its stage', () => {
    expect(daysInStage(card({}), NOW)).toBe(0);
    expect(daysInStage(card({ stageEnteredAt: '2026-10-19T13:00:00Z' }), NOW)).toBe(0);
    expect(daysInStage(card({ stageEnteredAt: '2026-10-17T12:00:00Z' }), NOW)).toBe(3);
  });
  it('is never negative, and 0 for a date it cannot read', () => {
    expect(daysInStage(card({ stageEnteredAt: '2026-10-25T12:00:00Z' }), NOW)).toBe(0);
    expect(daysInStage(card({ stageEnteredAt: 'soon' }), NOW)).toBe(0);
  });
});

describe('days left in Noise', () => {
  it('rounds up, so a fresh removal reads as the full retention', () => {
    const fresh = card({ stage: 'noise', purgeAt: '2026-11-19T12:00:00Z' });
    expect(daysLeft(fresh, NOW)).toBe(30);
    expect(daysLeft(card({ purgeAt: '2026-10-22T11:00:00Z' }), NOW)).toBe(2);
  });
  it('is 0 once due, and null outside Noise', () => {
    expect(daysLeft(card({ purgeAt: '2026-10-19T12:00:00Z' }), NOW)).toBe(0);
    expect(daysLeft(card({}), NOW)).toBeNull();
  });
});

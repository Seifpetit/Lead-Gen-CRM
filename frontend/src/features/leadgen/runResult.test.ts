import { describe, expect, it } from 'vitest';
import { translate } from '../../i18n/index.js';
import { funnel, run } from '../../test/fixtures.js';
import { placesFound, runResultText } from './runResult.js';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('en', key, vars);
const text = (over: Parameters<typeof funnel>[0], dropped = 0) =>
  runResultText(t, run({ funnel: funnel(over), placesDroppedOutside: dropped }));

describe('runResultText', () => {
  it('says what happened: places found and leads made', () => {
    expect(text({ discovered: 30, skipped: 0, leads: 28 })).toBe('30 found, 28 leads');
    expect(text({ discovered: 5, skipped: 0, leads: 1 })).toBe('5 found, 1 lead');
  });

  it('says places came back but none were kept, instead of "0 found, 0 leads"', () => {
    expect(text({ discovered: 0, skipped: 0, leads: 0 }, 98)).toBe('98 places, 0 kept');
    expect(text({ discovered: 12, skipped: 3, leads: 0 }, 0)).toBe('15 places, 0 kept');
  });

  it('counts places known from earlier runs and places outside the region as found', () => {
    expect(
      placesFound({ funnel: funnel({ discovered: 10, skipped: 20 }), placesDroppedOutside: 5 }),
    ).toBe(35);
    expect(text({ discovered: 10, skipped: 20, leads: 4 }, 5)).toBe('35 found, 4 leads');
  });

  it('says nothing was found only when no place came back at all', () => {
    expect(text({ discovered: 0, skipped: 0, leads: 0 })).toBe('No places found');
  });
});

import type { ApifyLogRun, ApifyStepView } from '@lead-gen-crm/shared';
import { describe, expect, it } from 'vitest';
import { funnel, run } from '../../../test/fixtures.js';
import { dropTotals, filterRuns, runName, runSeconds, searchCount } from './runLogView.js';

const entry = (
  id: string,
  createdAt: string,
  over: Parameters<typeof run>[0] = {},
): ApifyLogRun => ({
  run: run({ id, createdAt, ...over }),
  steps: [],
});

const step = (stage: ApifyStepView['stage'], dropped: { reason: never; count: number }[] = []) =>
  ({ stage, summary: { dropped } }) as unknown as ApifyStepView;

describe('run log view', () => {
  it('names a run by its region and day, with the region in title case', () => {
    expect(runName({ region: 'bizerte', createdAt: '2026-10-19T09:00:00.000Z' })).toBe(
      'Bizerte, 19 Oct',
    );
    expect(runName({ region: 'ben-arous', createdAt: '2026-10-18T09:00:00.000Z' })).toBe(
      'Ben Arous, 18 Oct',
    );
  });

  const entries = [
    entry('a', '2026-10-17T09:00:00.000Z'),
    entry('b', '2026-10-19T09:00:00.000Z', {
      region: 'bizerte',
      funnel: funnel({ discovered: 98, qualified: 0, review: 0, unreachable: 0, leads: 0 }),
    }),
    entry('c', '2026-10-18T09:00:00.000Z', { status: 'running', finishedAt: null }),
    entry('d', '2026-10-16T09:00:00.000Z', { status: 'failed', error: 'boom' }),
  ];

  it('lists runs newest first', () => {
    expect(filterRuns(entries, 'all', '').map((e) => e.run.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('filters by the status groups', () => {
    const ids = (s: Parameters<typeof filterRuns>[1]) =>
      filterRuns(entries, s, '').map((e) => e.run.id);
    expect(ids('completed')).toEqual(['a']);
    expect(ids('ended')).toEqual(['b']);
    expect(ids('running')).toEqual(['c']);
    expect(ids('failed')).toEqual(['d']);
    expect(ids('stopped')).toEqual([]);
  });

  it('filters by region, and the two filters combine', () => {
    expect(filterRuns(entries, 'all', 'bizerte').map((e) => e.run.id)).toEqual(['b']);
    expect(filterRuns(entries, 'completed', 'bizerte')).toEqual([]);
  });

  it('counts searches as the first-stage steps', () => {
    expect(searchCount([step('discover'), step('discover'), step('find_people')])).toBe(2);
  });

  it('times a run from start to end, or to now while it goes', () => {
    const base = { createdAt: '2026-10-19T09:00:00.000Z' };
    expect(runSeconds({ ...base, finishedAt: '2026-10-19T09:20:00.000Z' }, 0)).toBe(1200);
    expect(runSeconds({ ...base, finishedAt: null }, Date.parse('2026-10-19T09:01:00.000Z'))).toBe(
      60,
    );
    expect(runSeconds({ createdAt: 'nope', finishedAt: null }, 0)).toBeNull();
  });

  it('adds up what was dropped, the biggest reason first', () => {
    const drop = (reason: string, count: number) => ({ reason: reason as never, count });
    expect(
      dropTotals([
        step('discover', [drop('outside_region', 5), drop('already_known', 1)]),
        step('discover', [drop('already_known', 6), drop('no_contact', 0)]),
      ]),
    ).toEqual([
      { reason: 'already_known', count: 7 },
      { reason: 'outside_region', count: 5 },
    ]);
  });
});

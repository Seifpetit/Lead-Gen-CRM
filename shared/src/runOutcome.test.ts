import { describe, expect, it } from 'vitest';
import type { RunFunnel, RunStatus } from './index.js';
import { OUTCOME_GROUPS, placesFound, runOutcome, RUN_OUTCOMES } from './runOutcome.js';

const funnel = (over: Partial<RunFunnel> = {}): RunFunnel => ({
  discovered: 0,
  skipped: 0,
  qualified: 0,
  rejected: 0,
  review: 0,
  unreachable: 0,
  peopleFound: 0,
  enriched: 0,
  scored: 0,
  leads: 0,
  ...over,
});
const run = (status: RunStatus, f: Partial<RunFunnel> = {}, outside = 0) => ({
  status,
  funnel: funnel(f),
  placesDroppedOutside: outside,
});

describe('runOutcome', () => {
  it('says a run in progress is running, whatever it has found so far', () => {
    for (const status of ['pending', 'running'] as const) {
      expect(runOutcome(run(status, { discovered: 5, leads: 2 }))).toMatchObject({
        kind: 'running',
        tone: 'blue',
        group: 'running',
      });
    }
  });

  it('is completed with leads, and green, only when a finished run produced leads', () => {
    const o = runOutcome(run('finished', { discovered: 30, qualified: 28, leads: 28 }));
    expect(o).toMatchObject({ kind: 'completed', tone: 'green', group: 'completed' });
    expect(o.counts).toMatchObject({ places: 30, leads: 28, kept: 28 });
    expect(o.detail).toBeNull();
    // Nothing else is ever green.
    const others = [
      run('finished'),
      run('finished', {}, 4),
      run('finished', { discovered: 3, qualified: 1 }),
      run('failed', { leads: 2 }),
      run('cancelled', { leads: 2 }),
      run('stopped_by_cap', { leads: 2 }),
      run('running', { leads: 2 }),
    ];
    expect(others.map((x) => runOutcome(x).tone)).not.toContain('green');
  });

  it('the Bizerte case: 98 places found, all outside the region, none kept', () => {
    const o = runOutcome(run('finished', {}, 98));
    expect(o).toMatchObject({
      kind: 'no_results',
      tone: 'yellow',
      group: 'ended',
      detail: 'outside',
    });
    expect(o.counts).toMatchObject({ places: 98, outside: 98, kept: 0, leads: 0 });
  });

  it('found places inside the region but kept none: ended with no results', () => {
    const o = runOutcome(run('finished', { discovered: 40, rejected: 40 }, 10));
    expect(o).toMatchObject({ kind: 'no_results', detail: 'none_kept' });
    expect(o.counts.places).toBe(50);
  });

  it('searches that returned no places: ended, nothing found', () => {
    expect(runOutcome(run('finished'))).toMatchObject({
      kind: 'nothing_found',
      tone: 'yellow',
      group: 'ended',
      detail: null,
    });
  });

  it('the Sfax case: 7 kept, 0 people found, nothing to carry forward: ended early', () => {
    const o = runOutcome(run('finished', { discovered: 30, qualified: 7, peopleFound: 0 }));
    expect(o).toMatchObject({ kind: 'ended_early', tone: 'yellow', detail: 'no_people' });
    expect(o.counts).toMatchObject({ kept: 7, people: 0, leads: 0 });
  });

  it('people found but none became a lead is also ended early, with its own detail', () => {
    expect(
      runOutcome(run('finished', { discovered: 30, qualified: 7, peopleFound: 4 })),
    ).toMatchObject({ kind: 'ended_early', detail: 'no_leads' });
  });

  it('counts companies waiting for review or without a contact as kept', () => {
    expect(
      runOutcome(run('finished', { discovered: 9, review: 2, unreachable: 1 })).counts.kept,
    ).toBe(3);
    expect(runOutcome(run('finished', { discovered: 9, review: 2 })).kind).toBe('ended_early');
  });

  it('keeps stopped, capped and failed runs as such, whatever they found', () => {
    const found = { discovered: 20, qualified: 5, leads: 3 };
    expect(runOutcome(run('stopped_by_cap', found))).toMatchObject({
      kind: 'stopped_by_cap',
      tone: 'red',
      group: 'stopped',
    });
    expect(runOutcome(run('cancelled', found))).toMatchObject({
      kind: 'stopped',
      tone: 'grey',
      group: 'stopped',
    });
    expect(runOutcome(run('failed', found))).toMatchObject({
      kind: 'failed',
      tone: 'red',
      group: 'failed',
    });
  });

  it('maps every outcome to one filter group', () => {
    for (const kind of RUN_OUTCOMES) {
      const samples = [
        run('running'),
        run('finished', { leads: 1 }),
        run('finished'),
        run('finished', {}, 5),
        run('finished', { discovered: 3, qualified: 1 }),
        run('stopped_by_cap'),
        run('cancelled'),
        run('failed'),
      ];
      const hit = samples.map(runOutcome).find((o) => o.kind === kind);
      expect(hit, kind).toBeDefined();
      expect(OUTCOME_GROUPS).toContain(hit!.group);
    }
  });

  it('counts every place the searches returned', () => {
    expect(placesFound(run('finished', { discovered: 3, skipped: 2 }, 4))).toBe(9);
  });
});

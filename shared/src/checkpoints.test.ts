import { describe, expect, it } from 'vitest';
import {
  checkpointCounts,
  checkpointState,
  CHECKPOINT_IDS,
  runProgress,
  STAGE_CHECKPOINT,
} from './index.js';
import { RUN_STAGES } from './index.js';

const funnel = {
  discovered: 24,
  skipped: 2,
  qualified: 9,
  rejected: 10,
  review: 5,
  unreachable: 1,
  peopleFound: 7,
  enriched: 6,
  scored: 6,
  leads: 5,
};

describe('checkpoints', () => {
  it('has six, in order, and maps every pipeline step to one of them', () => {
    expect(CHECKPOINT_IDS).toEqual([
      'searching',
      'checking',
      'people',
      'contacts',
      'scoring',
      'done',
    ]);
    for (const stage of RUN_STAGES) expect(CHECKPOINT_IDS).toContain(STAGE_CHECKPOINT[stage]);
    expect(STAGE_CHECKPOINT.enrich).toBe('contacts');
    expect(STAGE_CHECKPOINT.verify).toBe('contacts');
  });

  it('shows found, qualified, people, contacts, scored and leads', () => {
    expect(checkpointCounts(funnel)).toEqual({
      searching: 26, // 24 new places and 2 found again from earlier runs
      checking: 9,
      people: 7,
      contacts: 6,
      scoring: 6,
      done: 5,
    });
  });
});

describe('runProgress', () => {
  it('is completed checkpoints plus the fraction of the current one', () => {
    const p = runProgress({ status: 'running', currentStage: 'find_people', stageFraction: 0.5 });
    expect(p).toEqual({ completed: 2, current: 'people', fraction: 0.5, overall: 2.5 / 6 });
  });

  it('starts at searching before any step is planned', () => {
    expect(runProgress({ status: 'running', currentStage: null, stageFraction: 0 })).toEqual({
      completed: 0,
      current: 'searching',
      fraction: 0,
      overall: 0,
    });
  });

  it('puts verifying at the end of finding contacts, and scoring after it', () => {
    expect(
      runProgress({ status: 'running', currentStage: 'verify', stageFraction: 0 }).overall,
    ).toBeCloseTo(4 / 6);
    expect(
      runProgress({ status: 'running', currentStage: 'score', stageFraction: 0 }),
    ).toMatchObject({
      completed: 4,
      current: 'scoring',
    });
  });

  it('is complete when finished, and never reaches 1 before that', () => {
    expect(runProgress({ status: 'finished', currentStage: 'score', stageFraction: 0.2 })).toEqual({
      completed: 6,
      current: null,
      fraction: 0,
      overall: 1,
    });
    expect(
      runProgress({ status: 'running', currentStage: 'score', stageFraction: 1 }).overall,
    ).toBeLessThan(1);
  });

  it('keeps a stopped run where it stopped, and clamps a bad fraction', () => {
    expect(
      runProgress({ status: 'cancelled', currentStage: 'qualify', stageFraction: 0 }).completed,
    ).toBe(1);
    expect(
      runProgress({ status: 'running', currentStage: 'discover', stageFraction: 7 }).fraction,
    ).toBe(1);
    expect(
      runProgress({ status: 'running', currentStage: 'discover', stageFraction: Number.NaN })
        .fraction,
    ).toBe(0);
    expect(
      runProgress({ status: 'running', currentStage: 'discover', stageFraction: -1 }).fraction,
    ).toBe(0);
  });

  it('says which checkpoints are done, current and ahead', () => {
    const p = runProgress({ status: 'running', currentStage: 'qualify', stageFraction: 0 });
    expect(CHECKPOINT_IDS.map((id) => checkpointState(p, id))).toEqual([
      'done',
      'current',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
    const done = runProgress({ status: 'finished', currentStage: null, stageFraction: 0 });
    expect(CHECKPOINT_IDS.every((id) => checkpointState(done, id) === 'done')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { translate } from '../../../i18n/index.js';
import { run } from '../../../test/fixtures.js';
import { describeRun } from './runView.js';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate('en', key, vars);

describe('describeRun', () => {
  it('uses the run’s sentence and spells out the progress', () => {
    const v = describeRun(
      t,
      run({
        status: 'running',
        currentStage: 'qualify',
        stageFraction: 0.5,
        finishedAt: null,
        liveMessage: 'Found 24 companies, checking which ones move goods...',
      }),
    );
    expect(v.sentence).toBe('Found 24 companies, checking which ones move goods...');
    // One checkpoint passed and half of the second: 1.5 of 6.
    expect(v.percent).toBe(25);
    expect(v.progressText).toBe('25 percent done. Now: Checking companies');
    expect(v).toMatchObject({ active: true, halted: false });
  });

  it('falls back to a plain sentence for a run with none stored', () => {
    expect(
      describeRun(t, run({ status: 'running', liveMessage: null, finishedAt: null })).sentence,
    ).toBe('Getting ready…');
    expect(describeRun(t, run({ status: 'finished', liveMessage: null })).sentence).toBe(
      'Run in Sfax',
    );
  });

  it('says a finished run is finished and a stopped one where it stopped', () => {
    expect(describeRun(t, run({ status: 'finished' })).progressText).toBe(
      '100 percent done. Finished',
    );
    const stopped = describeRun(
      t,
      run({ status: 'cancelled', currentStage: 'find_people', stageFraction: 0 }),
    );
    expect(stopped.halted).toBe(true);
    expect(stopped.progressText).toBe('33 percent done. Stopped at: Finding people');
  });
});

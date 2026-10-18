import type { ApifyStepView, RunStage } from '@lead-gen-crm/shared';
import type { StringKey } from '../../i18n/index.js';
import type { useT } from '../../i18n/index.js';

type Translate = ReturnType<typeof useT>;

const IN_FLIGHT = ['started', 'running', 'restarting', 'resumed'];

/** True while the Apify run is still out and its result has not been applied. */
export const isInFlight = (step: ApifyStepView) =>
  step.latestState !== null && IN_FLIGHT.includes(step.latestState);

export type StepGroup = 'discover' | 'find_people' | 'enrich' | 'other';

export const groupOf = (stage: RunStage): StepGroup =>
  stage === 'discover' || stage === 'find_people' || stage === 'enrich' ? stage : 'other';

/** "r1c2" is row 1, column 2 of the region's map grid, counted from 0; said as row 2, column 3. */
function areaText(t: Translate, cell: string): string {
  const m = /^r(\d+)c(\d+)$/.exec(cell);
  return m
    ? t('apify.what.area', { row: Number(m[1]) + 1, col: Number(m[2]) + 1 })
    : t('apify.what.areaRaw', { cell });
}

/** What the step is doing, in plain words. */
export function stepSentence(t: Translate, step: ApifyStepView): string {
  const { target } = step;
  if (step.stage === 'discover' && target.query) {
    return t('apify.what.discover', {
      query: target.query,
      area: target.cell ? areaText(t, target.cell) : t('apify.what.areaRaw', { cell: '—' }),
    });
  }
  if (step.stage === 'find_people' && target.company) {
    return t(
      step.actorId?.includes('company-employees')
        ? 'apify.what.peopleList'
        : 'apify.what.peopleSearch',
      { company: target.company },
    );
  }
  if (step.stage === 'enrich') return t('apify.what.enrich');
  return t('apify.what.other', { stage: t(`stage.${step.stage}` as StringKey) });
}

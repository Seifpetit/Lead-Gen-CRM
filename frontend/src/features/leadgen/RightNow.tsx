import type { ApifyStepView, RunSummary } from '@lead-gen-crm/shared';
import { Spinner } from '../../components/shared/Spinner.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { isActive } from './runParts.js';
import { isInFlight, stepSentence } from './stepText.js';

/**
 * What an active run is doing at this moment, with a spinner: each Apify run still out, or,
 * between them, the step the run is on and what it means. Nothing for a run that is over.
 */
export function RightNow({ run, steps }: { run: RunSummary; steps: readonly ApifyStepView[] }) {
  const t = useT();
  if (!isActive(run.status)) return null;
  const out = steps.filter(isInFlight);
  const lines =
    out.length > 0
      ? out.map((step) => ({ id: step.runStepId, text: stepSentence(t, step) }))
      : [
          {
            id: 'stage',
            text: run.currentStage
              ? t(`apify.now.stage.${run.currentStage}` as StringKey)
              : t('apify.now.working'),
          },
        ];
  return (
    <div className="right-now">
      <h4>{t('apify.now.title')}</h4>
      <ul>
        {lines.map((line) => (
          <li key={line.id}>
            <Spinner label={t('apify.now.working')} /> {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

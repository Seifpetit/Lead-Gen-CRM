import type { ApifyLogRun, ApifyStepView } from '@lead-gen-crm/shared';
import { Fragment } from 'react';
import { useT, type StringKey } from '../../../i18n/index.js';
import { formatUsd } from '../../../lib/format.js';
import { CHECKPOINTS, isActive } from '../runParts.js';
import { StepLine } from '../StepLine.js';
import { groupOf, isInFlight, type StepGroup } from '../stepText.js';

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Totals for one group of steps, worded for the group's kind of work. */
function GroupSummary({ group, steps }: { group: StepGroup; steps: readonly ApifyStepView[] }) {
  const t = useT();
  if (group === 'other') return null;
  const done = steps.filter((s) => !isInFlight(s)).length;
  const cost = formatUsd(sum(steps.map((s) => s.costUsd)));
  const base = { done, total: steps.length, cost };
  const text =
    group === 'discover'
      ? t('apify.groupSummary.discover', {
          ...base,
          results: sum(steps.map((s) => s.summary?.returned ?? 0)),
          kept: sum(steps.map((s) => s.summary?.kept ?? 0)),
        })
      : group === 'find_people'
        ? t('apify.groupSummary.find_people', {
            ...base,
            people: sum(steps.map((s) => s.summary?.people?.found ?? 0)),
            decisionMakers: sum(steps.map((s) => s.summary?.people?.decisionMakers ?? 0)),
          })
        : t('apify.groupSummary.enrich', {
            ...base,
            emails: sum(steps.map((s) => s.summary?.kept ?? 0)),
          });
  return <span className="muted small">{text}</span>;
}

/**
 * The Apify steps of one run grouped by kind of work, in the order they ran, each group a
 * section that opens to its steps. A marker appears in the list where the spend crossed each
 * cost checkpoint of the spend cap. Groups still working are open.
 */
export function StepBreakdown({ entry }: { entry: ApifyLogRun }) {
  const t = useT();
  const { run, steps } = entry;
  const cap = run.budgetCapUsd;

  // Cumulative spend after each step, to find where each checkpoint was crossed.
  let running = 0;
  const crossed = new Map<string, number[]>();
  for (const step of steps) {
    const before = running;
    running += step.costUsd;
    const hits = CHECKPOINTS.filter((c) => cap > 0 && before < c * cap && running >= c * cap);
    if (hits.length > 0) crossed.set(step.runStepId, hits);
  }

  const groups: { key: StepGroup; stage: ApifyStepView['stage']; steps: ApifyStepView[] }[] = [];
  for (const step of steps) {
    const key = groupOf(step.stage);
    const last = groups.at(-1);
    if (last && last.key === key && (key !== 'other' || last.stage === step.stage)) {
      last.steps.push(step);
    } else {
      groups.push({ key, stage: step.stage, steps: [step] });
    }
  }

  if (steps.length === 0) return <p className="muted">{t('apify.noSteps')}</p>;
  return (
    <div className="log-groups">
      {groups.map((group, i) => {
        const open =
          group.steps.some(isInFlight) || (isActive(run.status) && i === groups.length - 1);
        const title =
          group.key === 'other'
            ? t('apify.group.other', { stage: t(`stage.${group.stage}` as StringKey) })
            : t(`apify.group.${group.key}` as StringKey);
        return (
          <details
            key={`${group.key}-${i}`}
            className="log-group"
            {...(open ? { open: true } : {})}
          >
            <summary>
              <strong>{title}</strong> <GroupSummary group={group.key} steps={group.steps} />
            </summary>
            {group.key !== 'other' && (
              <p className="muted small">{t(`apify.explain.${group.key}` as StringKey)}</p>
            )}
            <ul className="log-steps">
              {group.steps.map((step) => (
                <Fragment key={step.runStepId}>
                  <li>
                    <StepLine step={step} />
                  </li>
                  {(crossed.get(step.runStepId) ?? []).map((c) => (
                    <li key={c} className="log-checkpoint">
                      {t('apify.checkpoint', {
                        percent: Math.round(c * 100),
                        spent: formatUsd(c * cap),
                        cap: formatUsd(cap),
                      })}
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

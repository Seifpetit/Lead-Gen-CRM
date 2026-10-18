import type { ApifyLogRun, ApifyStepView } from '@lead-gen-crm/shared';
import { Fragment } from 'react';
import { ProgressTrack } from '../../components/shared/ProgressTrack.js';
import { useT, type StringKey } from '../../i18n/index.js';
import { formatUsd } from '../../lib/format.js';
import { RightNow } from './RightNow.js';
import { CHECKPOINTS, isActive, StatusBadge } from './runParts.js';
import { StepLine } from './StepLine.js';
import { groupOf, isInFlight, type StepGroup } from './stepText.js';

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
 * One run: its spend against the cap with the cost checkpoints, what it is doing right now,
 * and its Apify steps grouped by kind of work in the order they ran. A marker appears in the
 * list where the spend crossed each checkpoint, so the checkpoints are the run's timeline.
 */
export function RunLog({ entry }: { entry: ApifyLogRun }) {
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

  const spent = t('money.spentOfCap', { spent: formatUsd(run.spentUsd), cap: formatUsd(cap) });
  return (
    <li className="log-run">
      <div className="log-run-head">
        <strong>{t('apify.run', { region: run.region })}</strong>
        <StatusBadge status={run.status} />
      </div>
      {run.error && (
        <p className="notice notice-warning" role="status">
          {t('apify.run.stopped', { message: run.error })}
        </p>
      )}
      <ProgressTrack
        value={cap > 0 ? run.spentUsd / cap : 0}
        label={t('apify.timeline', { region: run.region })}
        valueText={spent}
        checkpoints={CHECKPOINTS}
        startLabel={t('dash.progress.start')}
        endLabel={t('dash.progress.end')}
        checkpointsLabel={t('dash.progress.checkpoints')}
      />
      <p className="muted small">{spent}</p>
      <RightNow run={run} steps={steps} />
      {steps.length === 0 ? (
        <p className="muted">{t('apify.noSteps')}</p>
      ) : (
        groups.map((group, i) => {
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
        })
      )}
    </li>
  );
}

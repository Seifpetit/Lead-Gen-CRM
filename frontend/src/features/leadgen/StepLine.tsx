import type { ApifyStepView, StepSummary } from '@lead-gen-crm/shared';
import { useT } from '../../i18n/index.js';
import type { StringKey } from '../../i18n/index.js';
import { formatDateTime, formatDuration, formatUsd } from '../../lib/format.js';
import { StateBadge } from './runParts.js';
import { stepSentence } from './stepText.js';

const CONSOLE_RUN = 'https://console.apify.com/actors/runs/';

type Translate = ReturnType<typeof useT>;

/** Why nothing (or something) came of a step, in plain words. */
function dropText(t: Translate, summary: StepSummary): string {
  return summary.dropped
    .map((d) => t(`apify.drop.${d.reason}` as StringKey, { count: d.count }))
    .join(', ');
}

function noDecisionMakerText(t: Translate, people: NonNullable<StepSummary['people']>): string {
  const parts = people.reasons.map((r) =>
    t(`apify.nodm.${r.reason}` as StringKey, { count: r.count }),
  );
  if (people.noLinkedinPage) parts.unshift(t('apify.nodm.no_linkedin_page'));
  return parts.join(', ');
}

const KNOWN_STATUSES = ['ABORTED', 'FAILED', 'TIMED-OUT'] as const;

/** "provider status ABORTED" and the like, said in plain words; anything else as it is. */
export function plainError(t: Translate, error: string): string {
  const status = /^provider status ([\w-]+)$/.exec(error)?.[1];
  const known = KNOWN_STATUSES.find((k) => k === status);
  return known ? t(`apify.error.${known}`) : t('apify.error.other', { message: error });
}

/**
 * One Apify run of a step, readable at a glance: what it searched, how many results came back,
 * what was kept and dropped, the cost and duration, and any error. The state changes with
 * their timestamps are in a collapsed section.
 */
export function StepLine({ step }: { step: ApifyStepView }) {
  const t = useT();
  const { summary } = step;
  const title = stepSentence(t, step);
  const people = summary?.people;
  return (
    <div className="log-step">
      <div className="log-step-head">
        <strong>{title}</strong> <StateBadge state={step.latestState} />
      </div>
      <p className="muted small">
        {step.actorId && <span>{t('apify.step.actor', { actor: step.actorId })} · </span>}
        <span>{t('apify.step.cost', { cost: formatUsd(step.costUsd) })}</span>
        {step.durationSeconds !== null && (
          <span>
            {' '}
            · {t('apify.step.duration', { duration: formatDuration(step.durationSeconds) })}
          </span>
        )}
        {step.apifyRunId && (
          <>
            {' · '}
            {t('apify.step.console')}{' '}
            <a
              href={`${CONSOLE_RUN}${encodeURIComponent(step.apifyRunId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {step.apifyRunId}
            </a>
          </>
        )}
      </p>
      {summary && !people && (
        <p>
          {summary.dropped.length === 0
            ? t('apify.step.results', { returned: summary.returned, kept: summary.kept })
            : t('apify.step.resultsDropped', {
                returned: summary.returned,
                kept: summary.kept,
                dropped: summary.returned - summary.kept,
              })}
          {summary.dropped.length > 0 &&
            ` (${t('apify.step.droppedWhy', { reasons: dropText(t, summary) })})`}
        </p>
      )}
      {people && (
        <p>
          {t('apify.step.people', { found: people.found, decisionMakers: people.decisionMakers })}
          {people.decisionMakers === 0 &&
            ` — ${t('apify.step.peopleWhy', { reasons: noDecisionMakerText(t, people) })}`}
        </p>
      )}
      {step.error && (
        <p className="notice notice-warning" role="status">
          {plainError(t, step.error)}
        </p>
      )}
      {step.history.length > 0 && (
        <details>
          <summary>{t('apify.details')}</summary>
          <ol className="step-history">
            {step.history.map((e) => (
              <li key={e.id}>
                {t(`apify.state.${e.state}`)} ·{' '}
                <time dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
                {e.message ? ` · ${e.message}` : ''}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

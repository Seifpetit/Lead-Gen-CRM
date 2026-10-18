import type { ApifyEventView, ApifyLogRun, ApifyState, ApifyStepView } from '@lead-gen-crm/shared';
import { useApi } from '../../api/context.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Widget } from '../../components/Widget.js';
import { useT } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { StatusBadge } from './runParts.js';

export const APIFY_LOG_POLL_MS = 5_000;
const LATEST_EVENTS_PER_STEP = 3;

export function StateBadge({ state }: { state: ApifyState | null }) {
  const t = useT();
  if (!state) return <span className="badge badge-none">{t('apify.stateNone')}</span>;
  return <span className={`badge badge-apify-${state}`}>{t(`apify.state.${state}`)}</span>;
}

/** The state of current Apify runs, refreshed by polling. */
export function ApifyLogWidget({ refreshKey }: { refreshKey: number }) {
  const t = useT();
  const api = useApi();
  const log = useResource(() => api.apify.log({ runs: 5, limit: 10 }), {
    pollMs: APIFY_LOG_POLL_MS,
    deps: [refreshKey],
  });

  const data = log.data;
  const regionOf = new Map(data?.runs.map((r) => [r.run.id, r.run.region]));

  return (
    <Widget
      title={t('apify.title')}
      className="widget-medium"
      actions={
        <button type="button" className="button" onClick={log.reload}>
          {t('common.refresh')}
        </button>
      }
    >
      {log.loading && !data ? (
        <LoadingState />
      ) : log.error !== null && !data ? (
        <ErrorState error={log.error} onRetry={log.reload} />
      ) : !data || (data.runs.length === 0 && data.recent.items.length === 0) ? (
        <EmptyState title={t('apify.empty.title')}>{t('apify.empty.body')}</EmptyState>
      ) : (
        <>
          {log.error !== null && (
            <p className="notice notice-warning" role="status">
              {t('apify.stale')}
            </p>
          )}
          {data.attention.length > 0 && (
            <p className="notice notice-warning" role="status">
              {data.attention.length === 1
                ? t('apify.attention', { count: data.attention.length })
                : t('apify.attentionMany', { count: data.attention.length })}
            </p>
          )}
          <ul className="log-runs">
            {data.runs.map((entry) => (
              <RunLog key={entry.run.id} entry={entry} />
            ))}
          </ul>
          <h3>{t('apify.recent')}</h3>
          {data.recent.items.length === 0 ? (
            <p className="muted">{t('apify.noEvents')}</p>
          ) : (
            <ol className="events" aria-label={t('apify.recent')}>
              {data.recent.items.map((event) => (
                <EventRow key={event.id} event={event} region={regionOf.get(event.runId)} />
              ))}
            </ol>
          )}
          <p className="muted small">
            {t('apify.polling', { seconds: APIFY_LOG_POLL_MS / 1000 })}
            {log.updatedAt &&
              ` · ${t('common.updatedAt', { time: log.updatedAt.toLocaleTimeString('en-GB') })}`}
          </p>
        </>
      )}
    </Widget>
  );
}

function RunLog({ entry }: { entry: ApifyLogRun }) {
  const t = useT();
  return (
    <li className="log-run">
      <div className="log-run-head">
        <strong>{t('apify.run', { region: entry.run.region })}</strong>
        <StatusBadge status={entry.run.status} />
      </div>
      {entry.steps.length === 0 ? (
        <p className="muted">{t('apify.noSteps')}</p>
      ) : (
        <ul className="log-steps">
          {entry.steps.map((step) => (
            <StepLog key={step.runStepId} step={step} />
          ))}
        </ul>
      )}
    </li>
  );
}

function StepLog({ step }: { step: ApifyStepView }) {
  const t = useT();
  const latest = [...step.history]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, LATEST_EVENTS_PER_STEP);
  return (
    <li className="log-step">
      <span>{t(`stage.${step.stage}`)}</span> <StateBadge state={step.latestState} />
      {latest.length > 0 && (
        <ol className="step-history">
          {latest.map((e) => (
            <li key={e.id}>
              {t(`apify.state.${e.state}`)} ·{' '}
              <time dateTime={e.occurredAt}>{formatDateTime(e.occurredAt)}</time>
              {e.message ? ` · ${e.message}` : ''}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function EventRow({ event, region }: { event: ApifyEventView; region: string | undefined }) {
  const t = useT();
  return (
    <li>
      <StateBadge state={event.state} /> {region && <span>{region} · </span>}
      <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
      {event.message ? ` · ${event.message}` : ''}
      <span className="visually-hidden"> {t('apify.recent')}</span>
    </li>
  );
}

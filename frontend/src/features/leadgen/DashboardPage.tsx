import type { RunFunnel, RunSummary } from '@lead-gen-crm/shared';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { Widget } from '../../components/Widget.js';
import { useT } from '../../i18n/index.js';
import { formatNumber, formatUsd } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { EventRow } from './ApifyLogWidget.js';
import { MAX_ACTIVE_RUNS, StatusBadge } from './runParts.js';
import { RunsWidget } from './RunsWidget.js';
import { StartRunWidget } from './StartRunWidget.js';

/** Where the cost checkpoints sit along the bar, as shares of the spend cap. */
export const CHECKPOINTS = [0.25, 0.5, 0.75];
const ACTIVE_POLL_MS = 5_000;

const total = (runs: RunSummary[], key: keyof RunFunnel) =>
  runs.reduce((sum, r) => sum + r.funnel[key], 0);

export function DashboardPage() {
  const t = useT();
  const api = useApi();
  // Starting a run changes what every card shows; bumping this makes them reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const [creating, setCreating] = useState(false);

  const active = useResource(() => api.runs.list({ status: ['pending', 'running'], limit: 10 }), {
    pollMs: ACTIVE_POLL_MS,
    deps: [refreshKey],
  });
  const all = useResource(() => api.runs.list({ limit: 100 }), {
    pollMs: 10_000,
    deps: [refreshKey],
  });
  const activeRuns = active.data?.items ?? [];

  return (
    <main id="main" className="page">
      <h1>{t('side.dashboard')}</h1>
      <div className="dash-cards">
        <Widget
          title={t('dash.create.title', { active: activeRuns.length, max: MAX_ACTIVE_RUNS })}
          className="run-card"
        >
          {active.error !== null && !active.data ? (
            <ErrorState error={active.error} onRetry={active.reload} />
          ) : !active.data ? (
            <LoadingState />
          ) : (
            <>
              {activeRuns.length === 0 ? (
                <p className="muted">{t('dash.noActive')}</p>
              ) : (
                <ul className="active-list">
                  {activeRuns.map((run) => (
                    <li key={run.id}>
                      <Link to={`/leadgen/runs/${run.id}`}>
                        {t('dash.runActive', { region: run.region })}
                      </Link>{' '}
                      <StatusBadge status={run.status} />
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="create-run"
                aria-expanded={creating}
                disabled={activeRuns.length >= MAX_ACTIVE_RUNS}
                onClick={() => setCreating(true)}
              >
                {t('dash.create')}
              </button>
            </>
          )}
        </Widget>
        <ResultsCard runs={all.data?.items ?? []} loading={all.loading && !all.data} />
      </div>

      {creating && (
        <div className="start-panel">
          <div className="start-panel-bar">
            <button type="button" className="button" onClick={() => setCreating(false)}>
              {t('dash.create.close')}
            </button>
          </div>
          <StartRunWidget onStarted={refresh} />
        </div>
      )}

      {activeRuns.map((run) => (
        <ActiveRun key={run.id} run={run} refreshKey={refreshKey} />
      ))}

      <div className="dashboard single">
        <RunsWidget refreshKey={refreshKey} />
      </div>
    </main>
  );
}

function ResultsCard({ runs, loading }: { runs: RunSummary[]; loading: boolean }) {
  const t = useT();
  return (
    <Widget title={t('dash.results.title')} className="results-card">
      {loading ? (
        <LoadingState />
      ) : (
        <dl className="funnel results-counts">
          <div>
            <dt>{t('dash.results.companies')}</dt>
            <dd>{formatNumber(total(runs, 'discovered'))}</dd>
          </div>
          <div>
            <dt>{t('dash.results.people')}</dt>
            <dd>{formatNumber(total(runs, 'peopleFound'))}</dd>
          </div>
          <div>
            <dt>{t('dash.results.channels')}</dt>
            <dd>{formatNumber(total(runs, 'enriched'))}</dd>
          </div>
        </dl>
      )}
      <Link className="button" to="/crm">
        {t('dash.results.open')}
      </Link>
    </Widget>
  );
}

/** One active run: spend against its cap from Start to End, and its latest events. */
function ActiveRun({ run, refreshKey }: { run: RunSummary; refreshKey: number }) {
  const t = useT();
  const share = run.budgetCapUsd > 0 ? Math.min(1, run.spentUsd / run.budgetCapUsd) : 0;
  return (
    <section className="active-run" aria-label={t('dash.progress.label', { region: run.region })}>
      <h2>{t('dash.runActive', { region: run.region })}</h2>
      <div className="progress-scale">
        <span>{t('dash.progress.start')}</span>
        <span className="progress-checkpoints">{t('dash.progress.checkpoints')}</span>
        <span>{t('dash.progress.end')}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={t('money.spentOfCap', {
          spent: formatUsd(run.spentUsd),
          cap: formatUsd(run.budgetCapUsd),
        })}
      >
        <div className="progress-fill" style={{ width: `${share * 100}%` }} />
        {CHECKPOINTS.map((c) => (
          <span key={c} className="progress-tick" style={{ left: `${c * 100}%` }} />
        ))}
      </div>
      <p className="muted small">
        {t('money.spentOfCap', {
          spent: formatUsd(run.spentUsd),
          cap: formatUsd(run.budgetCapUsd),
        })}
        {run.currentStage && ` · ${t(`stage.${run.currentStage}`)}`}
      </p>
      <RunLogBox run={run} refreshKey={refreshKey} />
    </section>
  );
}

/** The run's latest Apify events; the same feed as the Logs page. */
function RunLogBox({ run, refreshKey }: { run: RunSummary; refreshKey: number }) {
  const t = useT();
  const api = useApi();
  const log = useResource(() => api.apify.log({ runs: 5, limit: 50 }), {
    pollMs: ACTIVE_POLL_MS,
    deps: [refreshKey],
  });
  const events = (log.data?.recent.items ?? []).filter((e) => e.runId === run.id).slice(0, 8);
  return (
    <div className="log-box">
      <div className="log-box-head">
        <h3>{t('dash.logs.title')}</h3>
        <a href="/leadgen/logs" target="_blank" rel="noopener noreferrer">
          {t('dash.logs.newWindow')}
        </a>
      </div>
      {log.error !== null && !log.data ? (
        <ErrorState error={log.error} onRetry={log.reload} />
      ) : !log.data ? (
        <LoadingState />
      ) : events.length === 0 ? (
        <p className="muted">{t('apify.noEvents')}</p>
      ) : (
        <ol className="events" aria-label={t('dash.logs.title')}>
          {events.map((event) => (
            <EventRow key={event.id} event={event} region={run.region} />
          ))}
        </ol>
      )}
    </div>
  );
}

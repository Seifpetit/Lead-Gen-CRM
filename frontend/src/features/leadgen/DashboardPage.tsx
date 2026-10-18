import type { RunFunnel, RunSummary } from '@lead-gen-crm/shared';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { LogList } from '../../components/shared/LogList.js';
import { ProgressTrack } from '../../components/shared/ProgressTrack.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { StatTile } from '../../components/shared/StatTile.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { Card } from '../../components/shared/Card.js';
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
      <SectionTitle level={1}>{t('side.dashboard')}</SectionTitle>
      <div className="dash-cards">
        <Card
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
                <EmptyState title={t('dash.noActive')} />
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
        </Card>
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
    <Card title={t('dash.results.title')} className="results-card">
      {loading ? (
        <LoadingState />
      ) : (
        <dl className="funnel results-counts">
          <StatTile
            label={t('dash.results.companies')}
            value={formatNumber(total(runs, 'discovered'))}
          />
          <StatTile
            label={t('dash.results.people')}
            value={formatNumber(total(runs, 'peopleFound'))}
          />
          <StatTile
            label={t('dash.results.channels')}
            value={formatNumber(total(runs, 'enriched'))}
          />
        </dl>
      )}
      <Link className="button" to="/crm">
        {t('dash.results.open')}
      </Link>
    </Card>
  );
}

/** One active run: spend against its cap from Start to End, and its latest events. */
function ActiveRun({ run, refreshKey }: { run: RunSummary; refreshKey: number }) {
  const t = useT();
  const share = run.budgetCapUsd > 0 ? run.spentUsd / run.budgetCapUsd : 0;
  const spent = t('money.spentOfCap', {
    spent: formatUsd(run.spentUsd),
    cap: formatUsd(run.budgetCapUsd),
  });
  return (
    <section className="active-run" aria-label={t('dash.progress.label', { region: run.region })}>
      <SectionTitle level={2}>{t('dash.runActive', { region: run.region })}</SectionTitle>
      <ProgressTrack
        value={share}
        label={t('dash.progress.label', { region: run.region })}
        valueText={spent}
        checkpoints={CHECKPOINTS}
        startLabel={t('dash.progress.start')}
        endLabel={t('dash.progress.end')}
        checkpointsLabel={t('dash.progress.checkpoints')}
      />
      <p className="muted small">
        {spent}
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
      <SectionTitle level={3}>{t('dash.logs.title')}</SectionTitle>
      {log.error !== null && !log.data ? (
        <ErrorState error={log.error} onRetry={log.reload} />
      ) : !log.data ? (
        <LoadingState />
      ) : (
        <LogList
          label={t('dash.logs.title')}
          emptyText={t('apify.noEvents')}
          newWindowHref="/leadgen/logs"
          newWindowLabel={t('dash.logs.newWindow')}
          items={events.map((event) => ({
            id: event.id,
            content: <EventRow event={event} region={run.region} />,
          }))}
        />
      )}
    </div>
  );
}

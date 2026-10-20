import { Select } from '../../../components/shared/Select.js';
import { regionLabel } from '@lead-gen-crm/shared';
import type { RunSummary } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useApi } from '../../../api/context.js';
import { PanelSection } from '../../../components/shared/PanelSection.js';
import { SectionTitle } from '../../../components/shared/SectionTitle.js';
import { Tabs } from '../../../components/shared/Tabs.js';
import { ToggleGroup } from '../../../components/shared/ToggleGroup.js';
import { EmptyState, ErrorState, LoadingState } from '../../../components/states.js';
import { useT } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { useLiveRuns } from '../../../lib/useLiveRuns.js';
import { useResource } from '../../../lib/useResource.js';
import { LogsView } from '../logs/LogsView.js';
import { isActive } from '../runParts.js';
import { LogModal } from './LogModal.js';
import { RunCard } from './RunCard.js';
import { RunLeads } from './RunLeads.js';
import { useRunLeads } from './useRunLeads.js';
import './live.css';

type ResultsTab = 'leads' | 'past';
type RunsView = 'live' | 'logs';
const ALL = 'all';

/**
 * The live console for every run: a card for each run in progress with its six checkpoints, and
 * below it the leads the runs have found and the runs that have ended. `/leadgen/runs/:runId`
 * opens the same page with that run's card (and leads) first.
 */
export function RunsPage() {
  const t = useT();
  const api = useApi();
  const { runId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  // Bumped when a run leaves the live list, so the lists and the deep-linked card read it again.
  const [ended, setEnded] = useState(0);
  const live = useLiveRuns(useCallback(() => setEnded((n) => n + 1), []));
  const activeRuns = useMemo(() => live.runs ?? [], [live.runs]);
  const activeIds = useMemo(() => new Set(activeRuns.map((r) => r.id)), [activeRuns]);
  // What the person picked wins. Otherwise a run opened by its link shows its card, and the
  // page opens on the logs, unless a run is going: then it opens on the run.
  const picked = params.get('view');
  const view: RunsView | null =
    picked === 'live' || picked === 'logs'
      ? picked
      : runId !== ''
        ? 'live'
        : live.runs === null
          ? null
          : activeRuns.length > 0
            ? 'live'
            : 'logs';

  const past = useResource(() => api.runs.list({ limit: 50 }), { deps: [ended] });
  const linked = useResource(() => api.runs.get(runId), {
    enabled: runId !== '',
    deps: [runId, ended],
  });

  const [tab, setTab] = useState<ResultsTab>('leads');
  const [scope, setScope] = useState(runId || ALL);
  useEffect(() => {
    setScope(runId || ALL);
    setTab('leads');
  }, [runId]);
  const [logTarget, setLogTarget] = useState<RunSummary | null>(null);

  const pastRuns = useMemo(
    () => (past.data?.items ?? []).filter((r) => !isActive(r.status) && !activeIds.has(r.id)),
    [past.data, activeIds],
  );
  // The deep-linked run, as the live list has it while it runs and as the server has it after.
  const linkedRun: RunSummary | null =
    runId === '' ? null : (activeRuns.find((r) => r.id === runId) ?? linked.data ?? null);
  const shownActive = useMemo(
    () => [...activeRuns].sort((a, b) => Number(b.id === runId) - Number(a.id === runId)),
    [activeRuns, runId],
  );
  const loneLinked = linkedRun !== null && !activeIds.has(linkedRun.id);

  // The runs the leads below come from.
  const scoped = scope === ALL ? activeRuns.map((r) => r.id) : [scope];
  const scopedRuns = scoped.map(
    (id) => activeRuns.find((r) => r.id === id) ?? pastRuns.find((r) => r.id === id) ?? linkedRun,
  );
  const signal = scopedRuns.reduce((n, r) => n + (r?.funnel.leads ?? 0), 0);
  const leads = useRunLeads(scoped, signal);
  const scopeOptions: RunSummary[] = [
    ...activeRuns,
    ...(linkedRun && !activeIds.has(linkedRun.id) ? [linkedRun] : []),
    ...pastRuns.filter((r) => r.id !== linkedRun?.id),
  ];

  // The run whose log is open, as the freshest list has it; a run that has just ended is in
  // none of them for a moment, so the window keeps the last copy it had.
  const logRun =
    logTarget === null
      ? null
      : ([...activeRuns, ...pastRuns, ...(linkedRun ? [linkedRun] : [])].find(
          (r) => r.id === logTarget.id,
        ) ?? logTarget);

  const cards = (
    <>
      {shownActive.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          onChanged={() => setEnded((n) => n + 1)}
          onOpenLogs={() => setLogTarget(run)}
        />
      ))}
      {loneLinked && (
        <RunCard
          run={linkedRun}
          onOpenLogs={() => setLogTarget(linkedRun)}
          onShowLeads={() => {
            setScope(linkedRun.id);
            setTab('leads');
          }}
        />
      )}
    </>
  );

  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel runs-panel">
        <header className="dp-header">
          <div className="dp-header-controls">
            <SectionTitle level={1}>{t('runs.title')}</SectionTitle>
            <ToggleGroup<RunsView>
              label={t('runs.view')}
              hideLabel
              value={view ?? ''}
              options={[
                { value: 'live', label: t('runs.view.live') },
                { value: 'logs', label: t('runs.view.logs') },
              ]}
              onChange={(next) => setParams({ view: next }, { replace: true })}
            />
          </div>
          {view === 'live' && (
            <span className="muted runs-mode" role="status">
              {live.mode === 'live'
                ? t('runs.mode.live')
                : live.mode === 'polling'
                  ? t('runs.mode.polling')
                  : ''}
            </span>
          )}
        </header>

        {view === null ? (
          <LoadingState />
        ) : view === 'logs' ? (
          <LogsView />
        ) : (
          <>
            <PanelSection
              title={loneLinked && activeRuns.length === 0 ? t('runs.one') : t('runs.now')}
              tone="teal"
              className="runs-top"
            >
              {runId !== '' && linkedRun === null && linked.error !== null ? (
                <ErrorState error={linked.error} onRetry={linked.reload} />
              ) : (live.runs === null && linkedRun === null) ||
                (runId !== '' && linkedRun === null && !activeIds.has(runId)) ? (
                <LoadingState />
              ) : activeRuns.length === 0 && !loneLinked ? (
                <EmptyState
                  title={t('runs.idle.title')}
                  action={
                    <Link className="button" to="/leadgen">
                      {t('runs.idle.action')}
                    </Link>
                  }
                >
                  {t('runs.idle.body')}
                </EmptyState>
              ) : (
                <div className="runs-cards">{cards}</div>
              )}
            </PanelSection>

            <PanelSection
              title={t('runs.results')}
              tone="purple"
              className="runs-bottom"
              controls={
                tab === 'leads' ? (
                  <label className="runs-scope">
                    <span>{t('runs.leads.scope')}</span>
                    <Select
                      className="quiet-select"
                      value={scope}
                      onChange={setScope}
                      options={[
                        { value: ALL, label: t('runs.leads.scope.all') },
                        ...scopeOptions.map((r) => ({
                          value: r.id,
                          label: t('runs.leads.scope.run', {
                            region: regionLabel(r.region),
                            time: formatDateTime(r.createdAt),
                          }),
                        })),
                      ]}
                    />
                  </label>
                ) : undefined
              }
            >
              <Tabs<ResultsTab>
                label={t('runs.tabs')}
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'leads', label: t('runs.tab.leads') },
                  { id: 'past', label: t('runs.tab.past'), count: pastRuns.length },
                ]}
              >
                {tab === 'leads' ? (
                  scoped.length === 0 ? (
                    <EmptyState title={t('runs.leads.none.title')}>
                      {t('runs.leads.none.body')}
                    </EmptyState>
                  ) : (
                    <RunLeads
                      state={leads}
                      running={scopedRuns.some((r) => r !== null && isActive(r.status))}
                    />
                  )
                ) : past.loading && !past.data ? (
                  <LoadingState />
                ) : past.error !== null && !past.data ? (
                  <ErrorState error={past.error} onRetry={past.reload} />
                ) : pastRuns.length === 0 ? (
                  <EmptyState title={t('runs.past.empty.title')}>
                    {t('runs.past.empty.body')}
                  </EmptyState>
                ) : (
                  <div className="runs-cards is-past">
                    {pastRuns.map((run) => (
                      <RunCard
                        key={run.id}
                        run={run}
                        compact
                        onOpenLogs={() => setLogTarget(run)}
                        onShowLeads={() => {
                          setScope(run.id);
                          setTab('leads');
                        }}
                      />
                    ))}
                  </div>
                )}
              </Tabs>
            </PanelSection>
          </>
        )}
      </div>
      {logRun && <LogModal run={logRun} onClose={() => setLogTarget(null)} />}
    </main>
  );
}

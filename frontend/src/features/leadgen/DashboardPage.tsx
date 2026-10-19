import type { Coverage, Lead, RunSummary } from '@lead-gen-crm/shared';
import { Plus } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { LogList } from '../../components/shared/LogList.js';
import { ProgressTrack } from '../../components/shared/ProgressTrack.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { useToast } from '../../components/shared/Toast.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { formatUsd } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { CreateRunModal } from './CreateRunModal.js';
import { DashboardCharts, RangeToggle } from './DashboardCharts.js';
import { LeadsCard } from './LeadsCard.js';
import type { Range } from './leadsView.js';
import { RightNow } from './RightNow.js';
import { RunsWidget } from './RunsWidget.js';
import { StepLine } from './StepLine.js';
import { CHECKPOINTS, MAX_ACTIVE_RUNS, StatusBadge } from './runParts.js';
import { useErrorToast } from './useErrorToast.js';
import { useLeadMoves } from './useLeadMoves.js';

const ACTIVE_POLL_MS = 5_000;
const LEAD_PAGE = 100;
/** Pages of leads read at most: enough for the charts to be true without reading without end. */
const LEAD_PAGES = 10;

interface LoadedLeads {
  items: Lead[];
  total: number;
}

export function DashboardPage() {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const regionSelect = useId();
  // Starting a run changes what every card shows; bumping this makes them reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const [creating, setCreating] = useState(false);
  const [regionId, setRegionId] = useState('');
  const [range, setRange] = useState<Range>(30);

  const regions = useResource(() => api.regions.list({ limit: 100 }));
  const active = useResource(() => api.runs.list({ status: ['pending', 'running'], limit: 10 }), {
    pollMs: ACTIVE_POLL_MS,
    deps: [refreshKey],
  });
  const runs = useResource(() => api.runs.list({ limit: 100 }), {
    pollMs: 10_000,
    deps: [refreshKey],
  });
  const coverage = useResource<Coverage>(() => api.coverage.get(), { deps: [refreshKey] });
  const leads = useResource<LoadedLeads>(
    async () => {
      const items: Lead[] = [];
      let total = 0;
      let offset: number | null = 0;
      for (let i = 0; i < LEAD_PAGES && offset !== null; i++) {
        const page = await api.leads.list({
          limit: LEAD_PAGE,
          offset,
          ...(regionId !== '' ? { regionId } : {}),
        });
        items.push(...page.items);
        total = page.total;
        offset = page.nextOffset;
      }
      return { items, total };
    },
    { pollMs: 30_000, deps: [regionId, refreshKey] },
  );
  useErrorToast(leads.error);
  useErrorToast(active.error);

  const saved = useCallback(
    (lead: Lead) =>
      leads.setData((cur) =>
        cur ? { ...cur, items: cur.items.map((l) => (l.id === lead.id ? lead : l)) } : cur,
      ),
    // `setData` is stable.
    [leads.setData],
  );
  const moves = useLeadMoves({ onSaved: saved });
  const { show } = moves;
  const shownLeads = useMemo(() => show(leads.data?.items ?? []), [show, leads.data]);
  // Rounded to the minute so the charts do not redraw on every render.
  const now = Math.floor(Date.now() / 60_000) * 60_000;

  const runStarted = useMemo(
    () => new Map((runs.data?.items ?? []).map((r) => [r.id, r.createdAt])),
    [runs.data],
  );
  const sectorNames = useMemo(
    () => new Map((coverage.data?.sectors ?? []).map((s) => [s.id, s.name])),
    [coverage.data],
  );
  const activeRuns = active.data?.items ?? [];

  function created(run: RunSummary) {
    setCreating(false);
    toast.show(t('create.toast', { region: run.region }));
    refresh();
  }

  return (
    <main id="main" className="page dash fit">
      <header className="dash-top">
        <SectionTitle level={1}>{t('side.dashboard')}</SectionTitle>
        <div className="dash-controls">
          <RangeToggle value={range} onChange={setRange} />
          <label htmlFor={regionSelect} className="visually-hidden">
            {t('dash.region')}
          </label>
          <select id={regionSelect} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">{t('dash.region.all')}</option>
            {(regions.data?.items ?? []).map((r) => (
              <option key={r.regionId} value={r.regionId}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button-primary button-icon-text"
            disabled={activeRuns.length >= MAX_ACTIVE_RUNS}
            title={
              activeRuns.length >= MAX_ACTIVE_RUNS
                ? t('dash.create.full', { max: MAX_ACTIVE_RUNS })
                : t('dash.create')
            }
            onClick={() => setCreating(true)}
          >
            <Plus size={14} aria-hidden="true" />
            {t('dash.create')}
          </button>
        </div>
      </header>

      {activeRuns.length > 0 && (
        <p className="active-banner" role="status">
          {activeRuns.map((run) => (
            <span key={run.id}>
              <Link to={`/leadgen/runs/${run.id}`}>
                {t('dash.runActive', { region: run.region })}
              </Link>{' '}
              <StatusBadge status={run.status} />
            </span>
          ))}
        </p>
      )}

      <div className={`dash-main${activeRuns.length > 0 ? ' has-active' : ''}`}>
        <div className="dash-leads">
          {leads.loading && !leads.data ? (
            <LoadingState />
          ) : leads.error !== null && !leads.data ? (
            <ErrorState error={leads.error} onRetry={leads.reload} />
          ) : (
            <LeadsCard
              leads={shownLeads}
              total={leads.data?.total ?? 0}
              runStarted={runStarted}
              sectorNames={sectorNames}
              onMove={(chosen, stage) => void moves.moveMany(chosen, stage)}
              onCreateRun={() => setCreating(true)}
            />
          )}
        </div>

        {activeRuns.length > 0 && (
          <div className="dash-active">
            {activeRuns.map((run) => (
              <ActiveRun key={run.id} run={run} refreshKey={refreshKey} />
            ))}
          </div>
        )}
      </div>

      <div className="dash-bottom">
        <div className="dash-charts">
          <DashboardCharts
            leads={shownLeads}
            runStarted={runStarted}
            coverage={coverage.data}
            regionId={regionId}
            now={now}
            range={range}
          />
        </div>
        <div className="dash-runs">
          <RunsWidget refreshKey={refreshKey} />
        </div>
      </div>

      {creating && (
        <CreateRunModal
          regionId={regionId}
          onCreated={created}
          onCancel={() => setCreating(false)}
        />
      )}
    </main>
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
  // Newest step first; the Logs page has the whole history.
  const allSteps = log.data?.runs.find((r) => r.run.id === run.id)?.steps ?? [];
  const steps = [...allSteps].reverse().slice(0, 6);
  return (
    <div className="log-box">
      <SectionTitle level={3}>{t('dash.logs.title')}</SectionTitle>
      {log.error !== null && !log.data ? (
        <ErrorState error={log.error} onRetry={log.reload} />
      ) : !log.data ? (
        <LoadingState />
      ) : (
        <>
          <RightNow run={run} steps={allSteps} />
          <LogList
            label={t('dash.logs.title')}
            emptyText={t('apify.noEvents')}
            newWindowHref="/leadgen/logs"
            newWindowLabel={t('dash.logs.newWindow')}
            items={steps.map((step) => ({
              id: step.runStepId,
              content: <StepLine step={step} />,
            }))}
          />
        </>
      )}
    </div>
  );
}

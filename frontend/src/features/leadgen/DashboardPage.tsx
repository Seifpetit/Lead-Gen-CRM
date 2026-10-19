import type { Coverage, Lead, RunSummary } from '@lead-gen-crm/shared';
import { Plus } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../../api/context.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { useToast } from '../../components/shared/Toast.js';
import { useT } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import { BySectorSection, LeadsPerDaySection } from './dashboard/ChartSections.js';
import { LeadsPanel } from './dashboard/LeadsPanel.js';
import { RunsSection } from './dashboard/RunsSection.js';
import { CreateRunModal } from './CreateRunModal.js';
import { MAX_ACTIVE_RUNS, StatusBadge } from './runParts.js';
import { useErrorToast } from './useErrorToast.js';

const ACTIVE_POLL_MS = 5_000;
const LEAD_PAGE = 100;
/** Pages of leads read at most: enough for the charts to be true without reading without end. */
const LEAD_PAGES = 10;

interface LoadedLeads {
  items: Lead[];
  total: number;
}

/**
 * The dashboard is one bordered panel that fills the window: a slim header, Recent leads on top
 * and, below, leads per day, leads by sector and the runs, divided by lines. Nothing scrolls but
 * the lists and charts inside their sections.
 */
export function DashboardPage() {
  const t = useT();
  const api = useApi();
  const toast = useToast();
  const regionSelect = useId();
  // Starting a run changes what every section shows; bumping this makes them reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const [creating, setCreating] = useState(false);
  const [regionId, setRegionId] = useState('');

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
  // The charts count leads, so they read the lead list; the cards below read the CRM.
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

  // Rounded to the minute so the charts do not redraw on every render.
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const runItems = useMemo(() => runs.data?.items ?? [], [runs.data]);
  const runStarted = useMemo(() => new Map(runItems.map((r) => [r.id, r.createdAt])), [runItems]);
  const activeRuns = active.data?.items ?? [];
  const chartLeads = leads.data?.items ?? [];

  function created(run: RunSummary) {
    setCreating(false);
    toast.show(t('create.toast', { region: run.region }));
    refresh();
  }

  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel">
        <header className="dp-header">
          <SectionTitle level={1}>{t('side.dashboard')}</SectionTitle>
          <div className="dp-header-controls">
            <label htmlFor={regionSelect} className="visually-hidden">
              {t('dash.region')}
            </label>
            <select
              id={regionSelect}
              className="quiet-select"
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
            >
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
          <p className="dp-banner" role="status">
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

        <LeadsPanel
          regionId={regionId}
          refreshKey={refreshKey}
          runs={runItems}
          onCreateRun={() => setCreating(true)}
        />

        <div className="dp-bottom">
          <LeadsPerDaySection leads={chartLeads} runStarted={runStarted} now={now} />
          <BySectorSection
            leads={chartLeads}
            runStarted={runStarted}
            coverage={coverage.data}
            regionId={regionId}
            now={now}
          />
          <RunsSection
            runs={runItems}
            loading={runs.loading && !runs.data}
            error={runs.error}
            onRetry={runs.reload}
          />
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

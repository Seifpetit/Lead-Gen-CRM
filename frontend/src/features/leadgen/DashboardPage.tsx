import { Select } from '../../components/shared/Select.js';
import type { Coverage, Lead, RunSummary } from '@lead-gen-crm/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { Splitter } from '../../components/shared/Splitter.js';
import { useApi } from '../../api/context.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { useToast } from '../../components/shared/Toast.js';
import { useT } from '../../i18n/index.js';
import { useLiveRuns } from '../../lib/useLiveRuns.js';
import { useResource } from '../../lib/useResource.js';
import { BySectorSection, LeadsPerDaySection } from './dashboard/ChartSections.js';
import { LeadsPanel } from './dashboard/LeadsPanel.js';
import { RunsSection } from './dashboard/RunsSection.js';
import { CreateRunModal } from './CreateRunModal.js';
import { startedMessage } from './startrun/startPlan.js';
import { MAX_ACTIVE_RUNS } from './runParts.js';
import { useErrorToast } from './useErrorToast.js';

const LEAD_PAGE = 100;
/** Pages of leads read at most: enough for the charts to be true without reading without end. */
const LEAD_PAGES = 10;

const SPLIT_KEY = 'leadgen.dash.split';
const SPLIT_DEFAULT = 61;
const SPLIT_MIN = 35;
const SPLIT_MAX = 80;

/** The leads' share of the leads-and-charts area, as the person last left it. */
function readSplit(): number {
  try {
    const n = Number(window.localStorage.getItem(SPLIT_KEY));
    return n >= SPLIT_MIN && n <= SPLIT_MAX ? n : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

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
  // "Show its leads" from a run arrives as ?run=<id>: show that run's leads and nothing else
  // narrowing the list, then drop the parameter so the chip can be cleared like any filter.
  const [params, setParams] = useSearchParams();
  const focusRun = params.get('run');
  useEffect(() => {
    if (focusRun) setRegionId('');
  }, [focusRun]);
  const focusDone = useCallback(() => setParams({}, { replace: true }), [setParams]);
  const [split, setSplit] = useState(readSplit);
  const resize = useCallback((value: number) => {
    setSplit(value);
    try {
      window.localStorage.setItem(SPLIT_KEY, String(value));
    } catch {
      // Not remembered; the bar still moves.
    }
  }, []);

  const regions = useResource(() => api.regions.list({ limit: 100 }));
  // A run that ends has new leads and new numbers: reload everything the dashboard shows.
  const live = useLiveRuns(refresh);
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
  useErrorToast(live.error);

  // Rounded to the minute so the charts do not redraw on every render.
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const runItems = useMemo(() => runs.data?.items ?? [], [runs.data]);
  const runStarted = useMemo(() => new Map(runItems.map((r) => [r.id, r.createdAt])), [runItems]);
  const activeRuns = live.runs ?? [];
  const chartLeads = leads.data?.items ?? [];

  function created(runs: RunSummary[], notStarted: string[]) {
    setCreating(false);
    toast.show(startedMessage(t, runs, notStarted));
    refresh();
  }

  return (
    <main id="main" className="page dash-page">
      <div
        className="dash-panel"
        style={{ '--dp-top': split, '--dp-bottom': 100 - split } as CSSProperties}
      >
        <header className="dp-header">
          <SectionTitle level={1}>{t('side.dashboard')}</SectionTitle>
          <div className="dp-header-controls">
            <label htmlFor={regionSelect} className="visually-hidden">
              {t('dash.region')}
            </label>
            <Select
              id={regionSelect}
              className="quiet-select"
              value={regionId}
              onChange={setRegionId}
              options={[
                { value: '', label: t('dash.region.all') },
                ...(regions.data?.items ?? []).map((r) => ({ value: r.regionId, label: r.name })),
              ]}
            />
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

        <LeadsPanel
          focusRun={focusRun}
          onFocusDone={focusDone}
          regionId={regionId}
          refreshKey={refreshKey}
          runs={runItems}
          onCreateRun={() => setCreating(true)}
        />

        <Splitter
          label={t('dash.split')}
          valueText={t('dash.split.value', { percent: Math.round(split) })}
          value={split}
          min={SPLIT_MIN}
          max={SPLIT_MAX}
          onChange={resize}
          onReset={() => resize(SPLIT_DEFAULT)}
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

import './devconsole.css';
import type { DevHistoryEntry, DevOptions, DevStep, DevStepInput } from '@lead-gen-crm/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useApi } from '../../api/context.js';
import { SectionTitle } from '../../components/shared/SectionTitle.js';
import { Tabs } from '../../components/shared/Tabs.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { useResource } from '../../lib/useResource.js';
import { useAuth } from '../auth/AuthContext.js';
import { useCountry } from '../country/CountryContext.js';
import { ClassifyTab } from './ClassifyTab.js';
import {
  classifyFormFrom,
  defaultClassify,
  defaultDiscover,
  discoverFormFrom,
  rowsFromPlaces,
  type ClassifyForm,
  type DiscoverForm,
} from './devConsoleView.js';
import { DiscoverTab } from './DiscoverTab.js';
import { HistoryPanel } from './HistoryPanel.js';
import { EntryView } from './Outputs.js';

const WATCH_MS = 1500;

/** The developer console. Closed to everyone but the dev admin while DEV_CONSOLE is on. */
export function DevConsolePage() {
  const auth = useAuth();
  const api = useApi();
  const t = useT();
  const open = auth.user?.devConsole === true;
  const options = useResource(() => api.devConsole.options(), { enabled: open });
  if (!open) return <Navigate to="/leadgen" replace />;

  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel dc-panel" role="region" aria-label={t('devc.title')}>
        <header className="dp-header">
          <SectionTitle level={1}>{t('devc.title')}</SectionTitle>
          <div className="dp-header-controls">
            <Link to="/leadgen" className="button">
              {t('devc.back')}
            </Link>
          </div>
        </header>
        {options.loading && !options.data ? (
          <LoadingState />
        ) : options.error !== null && !options.data ? (
          <ErrorState error={options.error} onRetry={options.reload} />
        ) : options.data ? (
          <Console options={options.data} />
        ) : null}
      </div>
    </main>
  );
}

function Console({ options }: { options: DevOptions }) {
  const t = useT();
  const api = useApi();
  const { country } = useCountry();
  const [tab, setTab] = useState<DevStep>('discover');
  const [discover, setDiscover] = useState<DiscoverForm>(() => defaultDiscover(options, country));
  const [classify, setClassify] = useState<ClassifyForm>(() => defaultClassify(country));
  // The call whose input and output fill the right-hand side, and the one being waited for.
  const [shown, setShown] = useState<DevHistoryEntry | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const bump = useCallback(() => setHistoryKey((n) => n + 1), []);

  const history = useResource(() => api.devConsole.history(tab), { deps: [tab, historyKey] });
  const entries = history.data?.items ?? null;

  // A call that was started before the page was opened (or reloaded) is picked up again.
  useEffect(() => {
    if (running === null) {
      const live = entries?.find((e) => e.status === 'running');
      if (live) setRunning(live.id);
    }
  }, [entries, running]);

  // While a call runs, look at it until it ends.
  useEffect(() => {
    if (running === null) return;
    let stopped = false;
    let timer: number | undefined;
    const look = async () => {
      try {
        const entry = await api.devConsole.entry(running);
        if (stopped) return;
        setShown((current) => (current === null || current.id === entry.id ? entry : current));
        if (entry.status !== 'running') {
          setRunning(null);
          bump();
          return;
        }
      } catch {
        // A hiccup: look again.
      }
      if (!stopped) timer = window.setTimeout(() => void look(), WATCH_MS);
    };
    timer = window.setTimeout(() => void look(), WATCH_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [api, running, bump]);

  async function run(step: DevStep, input: DevStepInput) {
    const entry = await api.devConsole.run(step, input);
    setShown(entry);
    setRunning(entry.id);
    bump();
  }

  function runAgainWithEdits(entry: DevHistoryEntry) {
    if (entry.step === 'discover') {
      setDiscover(discoverFormFrom(entry.input as Parameters<typeof discoverFormFrom>[0]));
    } else {
      setClassify(classifyFormFrom(entry.input as Parameters<typeof classifyFormFrom>[0]));
    }
    setTab(entry.step);
  }

  function useInClassify(entry: DevHistoryEntry) {
    const output = entry.output as Parameters<typeof rowsFromPlaces>[0];
    const input = entry.input as { country: DiscoverForm['country'] };
    setClassify({ ...classify, country: input.country, rows: rowsFromPlaces(output) });
    setTab('classify');
  }

  const visible = shown && shown.step === tab ? shown : null;
  const busy = running !== null;

  return (
    <Tabs
      label={t('devc.steps')}
      tabs={[
        { id: 'discover', label: t('devc.tab.discover') },
        { id: 'classify', label: t('devc.tab.classify') },
      ]}
      value={tab}
      onChange={setTab}
    >
      <div className="dc-grid">
        <div className="dc-left">
          {tab === 'discover' ? (
            <DiscoverTab
              options={options}
              form={discover}
              onChange={setDiscover}
              busy={busy}
              onRun={(input) => run('discover', input)}
            />
          ) : (
            <ClassifyTab
              options={options}
              form={classify}
              onChange={setClassify}
              busy={busy}
              onRun={(input) => run('classify', input)}
            />
          )}
        </div>
        <div className="dc-right" aria-live="polite">
          {visible ? (
            <>
              <div className="dc-right-head">
                <h2>{t('devc.result')}</h2>
                <button type="button" className="button" onClick={() => runAgainWithEdits(visible)}>
                  {t('devc.again')}
                </button>
              </div>
              {visible.status === 'running' ? (
                <LoadingState label={t('devc.running')} />
              ) : (
                <EntryView entry={visible} onUseInClassify={() => useInClassify(visible)} />
              )}
            </>
          ) : (
            <p className="muted">{t('devc.result.none')}</p>
          )}
        </div>
        <HistoryPanel
          entries={entries}
          loading={history.loading}
          error={history.error}
          onRetry={history.reload}
          openId={visible?.id ?? null}
          onOpen={setShown}
          onClear={async () => {
            await api.devConsole.clear(tab);
            setShown(null);
            bump();
          }}
        />
      </div>
    </Tabs>
  );
}

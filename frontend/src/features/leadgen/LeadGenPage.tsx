import { useCallback, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { ApifyLogWidget } from './ApifyLogWidget.js';
import { CostsWidget } from './CostsWidget.js';
import { CoverageGridWidget } from './CoverageGridWidget.js';
import { CoverageMapWidget } from './CoverageMapWidget.js';
import type { StartPrefill } from './prefill.js';
import { RunsWidget } from './RunsWidget.js';
import { StartRunWidget } from './StartRunWidget.js';

export function LeadGenPage() {
  const t = useT();
  // Starting a run changes what every widget shows; bumping this makes them reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  // A click in the coverage grid or map fills Start a run; each click is a fresh object.
  const [prefill, setPrefill] = useState<(StartPrefill & { nonce: number }) | null>(null);
  const pick = useCallback((p: StartPrefill) => {
    setPrefill((cur) => ({ ...p, nonce: (cur?.nonce ?? 0) + 1 }));
    document
      .getElementById('start-run')
      ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);
  return (
    <main id="main" className="page">
      <h1>{t('leadgen.title')}</h1>
      <p className="muted">{t('leadgen.intro')}</p>
      <div className="dashboard">
        <StartRunWidget onStarted={refresh} prefill={prefill} />
        <RunsWidget refreshKey={refreshKey} />
        <ApifyLogWidget refreshKey={refreshKey} />
        <CostsWidget refreshKey={refreshKey} />
        <CoverageGridWidget refreshKey={refreshKey} onPick={pick} />
        <CoverageMapWidget refreshKey={refreshKey} onPick={pick} />
      </div>
    </main>
  );
}

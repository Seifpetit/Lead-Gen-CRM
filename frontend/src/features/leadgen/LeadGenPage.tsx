import { useCallback, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { ApifyLogWidget } from './ApifyLogWidget.js';
import { CostsWidget } from './CostsWidget.js';
import { RunsWidget } from './RunsWidget.js';
import { StartRunWidget } from './StartRunWidget.js';

export function LeadGenPage() {
  const t = useT();
  // Starting a run changes what every widget shows; bumping this makes them reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  return (
    <main id="main" className="page">
      <h1>{t('leadgen.title')}</h1>
      <p className="muted">{t('leadgen.intro')}</p>
      <div className="dashboard">
        <StartRunWidget onStarted={refresh} />
        <RunsWidget refreshKey={refreshKey} />
        <ApifyLogWidget refreshKey={refreshKey} />
        <CostsWidget refreshKey={refreshKey} />
      </div>
    </main>
  );
}

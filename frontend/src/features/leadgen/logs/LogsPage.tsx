import './logs.css';
import { regionLabel, type ApifyLogRun } from '@lead-gen-crm/shared';
import { useId, useMemo, useState } from 'react';
import { useApi } from '../../../api/context.js';
import { Select } from '../../../components/shared/Select.js';
import { SectionTitle } from '../../../components/shared/SectionTitle.js';
import { EmptyState, ErrorState, LoadingState } from '../../../components/states.js';
import { useT, type StringKey } from '../../../i18n/index.js';
import { useResource } from '../../../lib/useResource.js';
import { RunLogDialog } from './RunLogDialog.js';
import { RunLogRow } from './RunLogRow.js';
import { filterRuns, STATUS_FILTERS, type StatusFilter } from './runLogView.js';

export const LOGS_POLL_MS = 5_000;
/** The most recent runs the page lists (the server's limit besides the running ones). */
const RUNS_SHOWN = 50;

/**
 * Logs is one bordered panel: a slim header with the filters and Refresh, and one compact row
 * per run, newest first, scrolling inside the panel. A row's button opens everything about
 * that run in a window; the page itself never scrolls.
 */
export function LogsPage() {
  const t = useT();
  const api = useApi();
  const statusId = useId();
  const regionId = useId();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [region, setRegion] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const log = useResource(() => api.apify.log({ runs: RUNS_SHOWN, limit: 10 }), {
    pollMs: LOGS_POLL_MS,
  });
  const data = log.data;
  // The clock behind "how long": the moment the list was read, so rows do not tick on their own.
  const now = useMemo(() => Date.now(), [data]);

  const runs = data?.runs ?? [];
  const regions = useMemo(
    () => [...new Set(runs.map((e) => e.run.region))].sort((a, b) => a.localeCompare(b)),
    [runs],
  );
  const shown = useMemo(() => filterRuns(runs, status, region), [runs, status, region]);
  const open: ApifyLogRun | undefined = runs.find((e) => e.run.id === openId);

  return (
    <main id="main" className="page dash-page">
      <div className="dash-panel logs-panel">
        <header className="dp-header">
          <SectionTitle level={1}>{t('side.logs')}</SectionTitle>
          <div className="dp-header-controls">
            <label htmlFor={statusId} className="visually-hidden">
              {t('logs.filter.status')}
            </label>
            <Select
              id={statusId}
              className="quiet-select"
              value={status}
              onChange={(v) => setStatus(v as StatusFilter)}
              options={STATUS_FILTERS.map((f) => ({
                value: f,
                label: t(`logs.filter.${f}` as StringKey),
              }))}
            />
            <label htmlFor={regionId} className="visually-hidden">
              {t('logs.filter.region')}
            </label>
            <Select
              id={regionId}
              className="quiet-select"
              value={region}
              onChange={setRegion}
              options={[
                { value: '', label: t('logs.filter.regions.all') },
                ...regions.map((r) => ({ value: r, label: regionLabel(r) })),
              ]}
            />
            <button type="button" className="button" onClick={log.reload}>
              {t('common.refresh')}
            </button>
          </div>
        </header>
        <div className="logs-body">
          {log.loading && !data ? (
            <LoadingState />
          ) : log.error !== null && !data ? (
            <ErrorState error={log.error} onRetry={log.reload} />
          ) : runs.length === 0 ? (
            <EmptyState title={t('apify.empty.title')}>{t('apify.empty.body')}</EmptyState>
          ) : (
            <>
              {log.error !== null && (
                <p className="notice notice-warning" role="status">
                  {t('apify.stale')}
                </p>
              )}
              {shown.length === 0 ? (
                <EmptyState title={t('logs.filter.none.title')}>
                  {t('logs.filter.none.body')}
                </EmptyState>
              ) : (
                <ul className="logs-list" aria-label={t('logs.list')}>
                  {shown.map((entry) => (
                    <RunLogRow
                      key={entry.run.id}
                      entry={entry}
                      now={now}
                      onOpen={() => setOpenId(entry.run.id)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      {open && <RunLogDialog entry={open} now={now} onClose={() => setOpenId(null)} />}
    </main>
  );
}

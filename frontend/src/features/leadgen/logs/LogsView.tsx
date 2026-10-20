import './logs.css';
import { regionLabel, type ApifyLogRun } from '@lead-gen-crm/shared';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useApi } from '../../../api/context.js';
import { Select } from '../../../components/shared/Select.js';
import { useToast } from '../../../components/shared/Toast.js';
import { EmptyState, ErrorState, LoadingState } from '../../../components/states.js';
import { useT, type StringKey } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { copyText, downloadText } from '../../../lib/textOut.js';
import { useResource } from '../../../lib/useResource.js';
import { readRunLog } from '../live/useRunLog.js';
import { RunLogDialog } from './RunLogDialog.js';
import { RunLogRow } from './RunLogRow.js';
import { exportFileName, exportText, type ExportedRun } from './exportText.js';
import { filterRuns, STATUS_FILTERS, type StatusFilter } from './runLogView.js';

export const LOGS_POLL_MS = 5_000;
/** The most recent runs the page lists (the server's limit besides the running ones). */
const RUNS_SHOWN = 50;

/**
 * The Logs view of the Runs page: filters and Refresh in a slim toolbar, then one compact row
 * per run, newest first, scrolling inside the panel. A row's buttons open everything about that
 * run in a window or show the leads it found. It draws inside the Runs panel; the page itself
 * never scrolls.
 */
export function LogsView() {
  const t = useT();
  const api = useApi();
  const statusId = useId();
  const regionId = useId();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [region, setRegion] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const toast = useToast();
  // Export mode: the runs ticked so far, and whether the logs are being read right now.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

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
  const cancelExport = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
  }, []);
  // Escape leaves export mode (a window that is open closes itself first).
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelExport();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selecting, cancelExport]);
  const toggle = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // "All" is every run the filters show now, not only the ones on screen.
  const everyShown = shown.length > 0 && shown.every((e) => picked.has(e.run.id));
  const chosen = shown.filter((e) => picked.has(e.run.id));

  /** Reads the whole log of every picked run, then builds the text. */
  async function buildExport(): Promise<{ text: string; count: number } | null> {
    if (chosen.length > 1) toast.show(t('logs.export.reading', { n: chosen.length }));
    setBusy(true);
    try {
      const runs: ExportedRun[] = [];
      for (const entry of chosen) {
        runs.push({ run: entry.run, lines: await readRunLog(api, entry.run.id) });
      }
      const names = new Map<string, string>();
      try {
        for (const s of (await api.coverage.get()).sectors) names.set(s.id, s.name);
      } catch {
        // The ids are fine in place of the names.
      }
      return { text: exportText(t, runs, (id) => names.get(id) ?? id), count: runs.length };
    } catch (err) {
      toast.show(t('logs.export.failed', { reason: describeError(t, err) }), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function copyExport() {
    const built = await buildExport();
    if (!built) return;
    if (await copyText(built.text)) {
      toast.show(
        t(built.count === 1 ? 'logs.export.copied.one' : 'logs.export.copied', { n: built.count }),
      );
    } else {
      toast.show(t('logs.export.copyFailed'), 'error');
    }
  }
  async function saveExport() {
    const built = await buildExport();
    if (!built) return;
    const file = exportFileName();
    if (downloadText(file, built.text)) {
      toast.show(
        t(built.count === 1 ? 'logs.export.saved.one' : 'logs.export.saved', {
          n: built.count,
          file,
        }),
      );
    } else {
      toast.show(t('logs.export.downloadFailed'), 'error');
    }
  }
  const open: ApifyLogRun | undefined = runs.find((e) => e.run.id === openId);

  return (
    <>
      <div className="logs-toolbar">
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
        {!selecting && (
          <button
            type="button"
            className="button button-export button-icon-text logs-export"
            disabled={runs.length === 0}
            onClick={() => setSelecting(true)}
          >
            <Download size={14} aria-hidden="true" />
            {t('logs.export')}
          </button>
        )}
      </div>
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
              <>
                {selecting && (
                  <div className="logs-selbar" role="toolbar" aria-label={t('logs.export.bar')}>
                    <strong role="status">{t('logs.export.selected', { n: chosen.length })}</strong>
                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        setPicked(everyShown ? new Set() : new Set(shown.map((e) => e.run.id)))
                      }
                    >
                      {everyShown ? t('logs.export.clear') : t('logs.export.selectAll')}
                    </button>
                    <span className="logs-selbar-end">
                      <button
                        type="button"
                        className="button button-export"
                        disabled={chosen.length === 0 || busy}
                        onClick={() => void copyExport()}
                      >
                        {t('logs.export.copy')}
                      </button>
                      <button
                        type="button"
                        className="button button-export"
                        disabled={chosen.length === 0 || busy}
                        onClick={() => void saveExport()}
                      >
                        {t('logs.export.download')}
                      </button>
                      <button type="button" className="button" onClick={cancelExport}>
                        {t('logs.export.cancel')}
                      </button>
                    </span>
                  </div>
                )}
                <ul className="logs-list" aria-label={t('logs.list')}>
                  {shown.map((entry) => (
                    <RunLogRow
                      key={entry.run.id}
                      entry={entry}
                      now={now}
                      onOpen={() => setOpenId(entry.run.id)}
                      selecting={selecting}
                      selected={picked.has(entry.run.id)}
                      onToggle={() => toggle(entry.run.id)}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      {open && <RunLogDialog entry={open} now={now} onClose={() => setOpenId(null)} />}
    </>
  );
}

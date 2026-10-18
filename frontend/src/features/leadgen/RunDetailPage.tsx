import type { Lead, RunDetail } from '@lead-gen-crm/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../../api/context.js';
import { ApiRequestError } from '../../api/client.js';
import { Modal } from '../../components/Modal.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { describeError } from '../../lib/errors.js';
import { formatDateTime } from '../../lib/format.js';
import { useResource } from '../../lib/useResource.js';
import { LeadDetailCard } from './LeadDetailCard.js';
import { FunnelCounts, isActive, SpendMeter, StatusBadge } from './runParts.js';

const PAGE = 25;

export function RunDetailPage() {
  const t = useT();
  const api = useApi();
  const { runId = '' } = useParams();
  const run = useResource<RunDetail>(() => api.runs.get(runId), {
    deps: [runId],
    pollMs: 5_000,
  });
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState<unknown>(null);

  const data = run.data;
  // The run is polled; keep the leads the user loaded or changed, add any new ones on top.
  useEffect(() => {
    if (!data) return;
    setLeads((current) => {
      const known = new Map(current.map((l) => [l.id, l]));
      const merged = data.leads.map((l) => known.get(l.id) ?? l);
      const extra = current.filter((l) => !data.leads.some((d) => d.id === l.id));
      return [...merged, ...extra];
    });
  }, [data]);

  if (run.loading && !data) {
    return (
      <main id="main" className="page">
        <LoadingState />
      </main>
    );
  }
  if (!data) {
    const missing = run.error instanceof ApiRequestError && run.error.status === 404;
    return (
      <main id="main" className="page">
        <p>
          <Link to="/leadgen">{t('run.back')}</Link>
        </p>
        <ErrorState error={run.error} {...(missing ? {} : { onRetry: run.reload })} />
      </main>
    );
  }

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.leads.list({ runId, limit: PAGE, offset: leads.length });
      setLeads((current) => {
        const ids = new Set(current.map((l) => l.id));
        return [...current, ...page.items.filter((l) => !ids.has(l.id))];
      });
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function stop() {
    setStopBusy(true);
    setStopError(null);
    try {
      await api.runs.stop(runId);
      setStopping(false);
      run.reload();
    } catch (err) {
      setStopError(err);
    } finally {
      setStopBusy(false);
    }
  }

  const moved = (lead: Lead, message: string | null) => {
    setLeads((current) => current.map((l) => (l.id === lead.id ? lead : l)));
    setNote(message);
  };

  const active = isActive(data.status);
  return (
    <main id="main" className="page">
      <p>
        <Link to="/leadgen">{t('run.back')}</Link>
      </p>
      <header className="run-head">
        <h1>{t('run.title', { region: data.region })}</h1>
        <StatusBadge status={data.status} />
        {active && (
          <button type="button" className="button button-danger" onClick={() => setStopping(true)}>
            {t('run.stop')}
          </button>
        )}
      </header>
      <p className="muted">
        {t('run.started', { time: formatDateTime(data.createdAt) })}
        {active &&
          data.currentStage &&
          ` · ${t('run.stage', { stage: t(`stage.${data.currentStage}`) })}`}
      </p>
      <SpendMeter run={data} />
      {data.error && (
        <p className="form-error" role="alert">
          {t('run.error', { message: data.error })}
        </p>
      )}
      {run.error !== null && <ErrorState error={run.error} onRetry={run.reload} />}

      <section aria-label={t('run.steps')}>
        <FunnelCounts funnel={data.funnel} />
        <p className="muted" data-testid="dropped-outside">
          {t('run.droppedOutside', { count: data.placesDroppedOutside })}
        </p>
        <ul className="steps">
          {data.steps.map((s) => (
            <li key={s.stage}>
              <strong>{t(`stage.${s.stage}`)}</strong>: {s.finished} {t('run.steps.finished')}
              {s.inFlight > 0 && `, ${s.inFlight} ${t('run.steps.inFlight')}`}
              {s.pending > 0 && `, ${s.pending} ${t('run.steps.pending')}`}
              {s.failed > 0 && `, ${s.failed} ${t('run.steps.failed')}`}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('run.leads.title')}>
        <h2>{t('run.leads.title')}</h2>
        {note && (
          <p className="notice" role="status">
            {note}
          </p>
        )}
        {leads.length === 0 ? (
          <EmptyState title={t('run.leads.empty.title')}>
            {active ? t('run.leads.empty.running') : t('run.leads.empty.done')}
          </EmptyState>
        ) : (
          <>
            <p className="muted">
              {t('run.leads.count', { shown: leads.length, total: data.leadsTotal })}
            </p>
            <div className="lead-list">
              {leads.map((lead) => (
                <LeadDetailCard key={lead.id} lead={lead} onMoved={moved} />
              ))}
            </div>
            {moreError !== null && <ErrorState error={moreError} onRetry={() => void loadMore()} />}
            {leads.length < data.leadsTotal && (
              <button
                type="button"
                className="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? t('common.loading') : t('common.showMore')}
              </button>
            )}
          </>
        )}
      </section>

      {stopping && (
        <Modal title={t('run.stop.title')} onClose={() => !stopBusy && setStopping(false)}>
          <div className="modal-body">
            <p>{t('run.stop.body')}</p>
            {stopError !== null && (
              <p className="form-error" role="alert">
                {describeError(t, stopError)}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              type="button"
              className="button"
              data-autofocus
              onClick={() => setStopping(false)}
              disabled={stopBusy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => void stop()}
              disabled={stopBusy}
            >
              {stopBusy ? t('run.stop.stopping') : t('run.stop.confirm')}
            </button>
          </footer>
        </Modal>
      )}
    </main>
  );
}

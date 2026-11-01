import type { DevHistoryEntry } from '@lead-gen-crm/shared';
import { useState } from 'react';
import { Modal } from '../../components/Modal.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.js';
import { useT } from '../../i18n/index.js';
import { formatUsd } from '../../lib/format.js';

/** Past calls of one step, newest first. Opening one shows its input and output. */
export function HistoryPanel({
  entries,
  loading,
  error,
  onRetry,
  openId,
  onOpen,
  onClear,
}: {
  entries: DevHistoryEntry[] | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  openId: string | null;
  onOpen: (entry: DevHistoryEntry) => void;
  onClear: () => Promise<void>;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function clear() {
    setClearing(true);
    try {
      await onClear();
    } finally {
      setClearing(false);
      setAsking(false);
    }
  }

  return (
    <section className="dc-history" aria-label={t('devc.history')}>
      <header className="dc-history-head">
        <h2>{t('devc.history')}</h2>
        <button
          type="button"
          className="button"
          disabled={!entries || entries.length === 0}
          onClick={() => setAsking(true)}
        >
          {t('devc.history.clear')}
        </button>
      </header>
      <div className="dc-history-body">
        {loading && !entries ? (
          <LoadingState />
        ) : error !== null && !entries ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : !entries || entries.length === 0 ? (
          <EmptyState title={t('devc.history.empty')} />
        ) : (
          <ul className="dc-hist-list">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="dc-hist-row"
                  aria-current={e.id === openId ? 'true' : undefined}
                  onClick={() => onOpen(e)}
                >
                  <span className={`dc-status dc-status-${e.status}`}>
                    {t(`devc.status.${e.status}` as const)}
                  </span>
                  <span className="dc-hist-summary">{e.summary}</span>
                  <span className="dc-hist-cost">{formatUsd(e.costUsd)}</span>
                  <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleTimeString()}</time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {asking && (
        <Modal title={t('devc.clear.title')} onClose={() => setAsking(false)}>
          <p>{t('devc.clear.body')}</p>
          <footer className="modal-footer">
            <button type="button" className="button" onClick={() => setAsking(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={clearing}
              onClick={() => void clear()}
            >
              {t('devc.clear.go')}
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}

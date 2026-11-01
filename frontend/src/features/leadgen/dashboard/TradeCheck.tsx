import type { TradeCheckStatus } from '@lead-gen-crm/shared';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/Modal.js';
import { useApi } from '../../../api/context.js';
import { useT } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';
import { formatUsd } from '../../../lib/format.js';
import { useResource } from '../../../lib/useResource.js';

export const CHECK_POLL_MS = 1500;

/**
 * "Older leads were never checked for import/export": a line above the list with a button. The
 * button opens a window that says what the check does and what it costs; nothing is spent
 * until the person confirms there. The check can be stopped, and what it already decided stays.
 */
export function TradeCheckBanner({ onChanged }: { onChanged?: (() => void) | undefined }) {
  const t = useT();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const preview = useResource(() => api.tradeCheck.preview(), { deps: [open] });
  const unchecked = preview.data?.unchecked ?? 0;
  const [version, setVersion] = useState(0);
  // A check started earlier (or in another tab) still shows its progress.
  const status = useResource(() => api.tradeCheck.status(), { deps: [open, version] });
  const running = status.data?.state === 'running';
  if (unchecked === 0 && !open && !running) return null;
  return (
    <>
      <div className="trade-banner" role="status">
        <span>
          {t(unchecked === 1 ? 'trade.banner.one' : 'trade.banner.other', { n: unchecked })}
        </span>
        <button type="button" className="button" onClick={() => setOpen(true)}>
          {t(running ? 'trade.banner.progress' : 'trade.banner.button')}
        </button>
      </div>
      {open && (
        <TradeCheckModal
          onClose={() => {
            setOpen(false);
            setVersion((v) => v + 1);
          }}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function TradeCheckModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: (() => void) | undefined;
}) {
  const t = useT();
  const api = useApi();
  const preview = useResource(() => api.tradeCheck.preview());
  const [status, setStatus] = useState<TradeCheckStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  // Pick up a check that is already running.
  useEffect(() => {
    let live = true;
    void api.tradeCheck.status().then(
      (s) => live && s.state !== 'idle' && setStatus(s),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  const running = status?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void api.tradeCheck.status().then((s) => {
        setStatus(s);
        changed.current?.();
      }, setError);
    }, CHECK_POLL_MS);
    return () => clearInterval(timer);
  }, [running, api]);

  async function act(call: () => Promise<TradeCheckStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await call());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const p = preview.data;
  const ended = status !== null && status.state !== 'running' && status.state !== 'idle';

  return (
    <Modal title={t('trade.modal.title')} onClose={onClose} wide>
      <div className="modal-body">
        <p>{t('trade.modal.what')}</p>
        {status === null || status.state === 'idle' ? (
          p ? (
            p.classifierConfigured ? (
              <ul className="trade-facts">
                <li>
                  {t(p.unchecked === 1 ? 'trade.modal.count.one' : 'trade.modal.count.other', {
                    n: p.unchecked,
                  })}
                </li>
                <li>
                  {t('trade.modal.estimate', {
                    n: p.willCheck,
                    cost: formatUsd(p.estimatedCostUsd),
                    cap: formatUsd(p.capUsd),
                  })}
                </li>
                <li>{t('trade.modal.free')}</li>
                <li>{t('trade.modal.safe')}</li>
              </ul>
            ) : (
              <p role="alert">{t('trade.modal.noKey')}</p>
            )
          ) : (
            <p className="muted">{t('trade.modal.loading')}</p>
          )
        ) : (
          <div aria-live="polite">
            <progress max={Math.max(status.total, 1)} value={status.done} />
            <p>{t('trade.modal.progress', { done: status.done, total: status.total })}</p>
            <p>
              {t('trade.modal.result', {
                yes: status.yes,
                noise: status.noise,
                unclear: status.unclear,
                spent: formatUsd(status.spentUsd),
              })}
            </p>
            {ended && (
              <p>
                {status.message ??
                  t(`trade.modal.state.${status.state}` as 'trade.modal.state.finished')}
              </p>
            )}
          </div>
        )}
        {error !== null && <p role="alert">{describeError(t, error)}</p>}
      </div>
      <footer className="modal-footer">
        {running ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void act(() => api.tradeCheck.stop())}
          >
            {t('trade.modal.stop')}
          </button>
        ) : (
          <>
            <button type="button" className="button" onClick={onClose}>
              {ended ? t('common.close') : t('common.cancel')}
            </button>
            {!ended && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy || !p?.classifierConfigured || (p?.willCheck ?? 0) === 0}
                onClick={() => void act(() => api.tradeCheck.start())}
              >
                {t('trade.modal.start', { cost: formatUsd(p?.estimatedCostUsd ?? 0) })}
              </button>
            )}
          </>
        )}
      </footer>
    </Modal>
  );
}

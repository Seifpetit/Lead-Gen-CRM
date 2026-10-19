import { useState } from 'react';
import { useApi } from '../../../api/context.js';
import { Modal } from '../../../components/Modal.js';
import { useT } from '../../../i18n/index.js';
import { describeError } from '../../../lib/errors.js';

/** Asks before stopping a run, then stops it. */
export function StopRunDialog({
  runId,
  onStopped,
  onClose,
}: {
  runId: string;
  onStopped: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api.runs.stop(runId);
      onStopped();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title={t('run.stop.title')} onClose={() => !busy && onClose()}>
      <div className="modal-body">
        <p>{t('run.stop.body')}</p>
        {error !== null && (
          <p className="form-error" role="alert">
            {describeError(t, error)}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button type="button" className="button" data-autofocus onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="button button-danger"
          onClick={() => void stop()}
          disabled={busy}
        >
          {busy ? t('run.stop.stopping') : t('run.stop.confirm')}
        </button>
      </footer>
    </Modal>
  );
}

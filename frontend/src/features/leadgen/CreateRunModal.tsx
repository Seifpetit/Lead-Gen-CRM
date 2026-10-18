import type { RunSummary } from '@lead-gen-crm/shared';
import { useMemo } from 'react';
import { Modal } from '../../components/Modal.js';
import { useT } from '../../i18n/index.js';
import { StartRunWidget } from './StartRunWidget.js';

/**
 * Create run, as a blocking dialog: nothing behind it can be used until the run is created
 * (after the cap and the confirm that StartRunWidget asks for) or the person cancels.
 */
export function CreateRunModal({
  regionId,
  onCreated,
  onCancel,
}: {
  /** The region picked on the dashboard, if any; the form starts on it. */
  regionId: string;
  onCreated: (run: RunSummary) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const prefill = useMemo(() => (regionId ? { regionId, nonce: 1 } : null), [regionId]);
  return (
    <Modal title={t('create.title')} onClose={onCancel} wide>
      <div className="modal-body">
        <StartRunWidget onStarted={onCreated} prefill={prefill} />
      </div>
      <footer className="modal-footer">
        <button type="button" className="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </footer>
    </Modal>
  );
}

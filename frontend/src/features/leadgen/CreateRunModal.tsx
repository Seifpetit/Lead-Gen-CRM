import type { RunSummary } from '@lead-gen-crm/shared';
import { useMemo } from 'react';
import { Modal } from '../../components/Modal.js';
import { useT } from '../../i18n/index.js';
import type { StartPrefill } from './prefill.js';
import { StartRunWidget } from './StartRunWidget.js';

/**
 * Start a run, as a blocking dialog: nothing behind it can be used until the run is started
 * (after the cap, and the extra click StartRunWidget asks for when the estimate is above it) or
 * the person cancels.
 */
export function CreateRunModal({
  regionId,
  prefill: planned,
  onCreated,
  onCancel,
}: {
  /** The region picked on the dashboard, if any; the form starts on it. */
  regionId: string;
  /** A region and sector (or cell) to start on, from the coverage page; wins over regionId. */
  prefill?: StartPrefill;
  onCreated: (run: RunSummary) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const prefill = useMemo(
    () => (planned ? { ...planned, nonce: 1 } : regionId ? { regionId, nonce: 1 } : null),
    [planned, regionId],
  );
  return (
    <Modal title={t('start.title')} onClose={onCancel} className="modal-start">
      <StartRunWidget onStarted={onCreated} onCancel={onCancel} prefill={prefill} />
    </Modal>
  );
}

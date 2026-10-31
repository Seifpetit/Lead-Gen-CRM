import { useEffect, useState } from 'react';
import { CheckSquare, Trash2 } from 'lucide-react';
import { Modal } from '../../../components/Modal.js';
import { useT } from '../../../i18n/index.js';
import type { LeadSelection } from './useLeadSelection.js';

/** The header button that switches the cards into selection mode (and back). */
export function SelectButton({
  selection,
  disabled,
}: {
  selection: LeadSelection;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="button"
      aria-pressed={selection.active}
      disabled={disabled && !selection.active}
      onClick={selection.active ? selection.cancel : selection.start}
    >
      <CheckSquare size={14} aria-hidden="true" /> {t('select.button')}
    </button>
  );
}

/**
 * The bar above the cards while selecting: how many are ticked, Select all (every card matching
 * the filters, with its count), Clear, Move to Noise and Cancel. Escape cancels. Moving asks first
 * in our own dialog, which says how many cards stay where they are and for how long Noise keeps
 * the rest.
 */
export function SelectBar({
  selection,
  total,
  retentionDays,
}: {
  selection: LeadSelection;
  /** Cards matching the filters now, shown on Select all before it is pressed. */
  total: number;
  /** How long Noise keeps a card; unknown until the folder counts have loaded. */
  retentionDays: number | undefined;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const { cancel, busy, count, movableCount, protectedCount } = selection;

  useEffect(() => {
    if (confirming) return; // the dialog takes Escape first
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cancel, confirming]);

  const move = async () => {
    await selection.remove();
    setConfirming(false);
  };

  return (
    <>
      <div className="bulk-bar select-bar" role="toolbar" aria-label={t('select.bar')}>
        <span role="status" className="select-count">
          {t('crm.bulk.selected', { count })}
        </span>
        <button
          type="button"
          className="button"
          disabled={busy || total === 0}
          onClick={() => void selection.selectAll()}
        >
          {t('select.all', { count: total })}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || count === 0}
          onClick={selection.clear}
        >
          {t('select.clear')}
        </button>
        <button
          type="button"
          className="button button-danger"
          disabled={busy || count === 0}
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={14} aria-hidden="true" /> {t('select.move')}
        </button>
        <button type="button" className="button" disabled={busy} onClick={cancel}>
          {t('select.cancel')}
        </button>
      </div>
      {confirming && (
        <Modal
          title={t(movableCount === 1 ? 'select.confirm.title.one' : 'select.confirm.title', {
            count: movableCount,
          })}
          onClose={() => !busy && setConfirming(false)}
        >
          <p>
            {retentionDays === undefined
              ? t('select.confirm.restore')
              : t('select.confirm.restoreDays', { days: retentionDays })}
          </p>
          {protectedCount > 0 && (
            <p className="select-protected" role="note">
              {t('select.confirm.protected', { count: protectedCount })}
            </p>
          )}
          <footer className="modal-footer">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button-danger"
              data-autofocus
              disabled={busy || movableCount === 0}
              onClick={() => void move()}
            >
              {t('select.confirm.move')}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}

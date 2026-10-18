import { useId, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal.js';
import { useT } from '../../i18n/index.js';

/** Opting a lead out records an objection and cannot be undone, so it asks first. */
export function OptOutDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useT();
  const reasonId = useId();
  const helpId = useId();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <Modal title={t('optout.title')} onClose={() => !busy && onCancel()}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <p>{t('optout.body')}</p>
          <div className="form-field">
            <label htmlFor={reasonId}>{t('optout.reason')}</label>
            <textarea
              id={reasonId}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && !trimmed}
              aria-describedby={helpId}
              data-autofocus
            />
            <small id={helpId} className={touched && !trimmed ? 'form-error' : 'muted'}>
              {touched && !trimmed ? t('optout.reason.required') : t('optout.reason.help')}
            </small>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="button" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button-danger" disabled={busy}>
            {busy ? t('optout.submitting') : t('optout.submit')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

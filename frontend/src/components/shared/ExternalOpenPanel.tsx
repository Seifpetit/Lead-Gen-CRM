import { ExternalLink as ExternalIcon } from 'lucide-react';
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/index.js';
import { Modal } from '../Modal.js';
import './external.css';

/** React events from a portal still reach the card around the button that opened it. */
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Our own step before anything opens outside the app: it says what will open, and opening
 * happens only from a click on its primary button, in a new tab with no opener or referrer
 * (popup blockers allow a click). Cancel, Escape or the close button leave nothing opened.
 */
export function ExternalOpenPanel({
  title,
  href,
  primaryLabel,
  onOpened,
  onClose,
  skipLabel,
  secondary,
  footerNote,
  children,
}: {
  title: string;
  /** Null while there is nothing to open; the primary button is then disabled. */
  href: string | null;
  primaryLabel: string;
  /** After the click on the primary (or secondary) button; `skip` is the checkbox. */
  onOpened?: (skip: boolean) => void;
  onClose: () => void;
  /** The small "don't ask again" checkbox; left out where the panel must always show. */
  skipLabel?: string;
  /** A second way to open the same thing (the WhatsApp phone app). */
  secondary?: { label: string; href: string | null };
  /** One line under the buttons. */
  footerNote?: string;
  /** What will open: a domain, or the WhatsApp message preview. */
  children: ReactNode;
}) {
  const t = useT();
  const skipId = useId();
  const [skip, setSkip] = useState(false);
  const opened = () => {
    onOpened?.(skip);
    onClose();
  };

  return createPortal(
    <div
      className="external-portal"
      onClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
      onDragStart={stop}
    >
      <Modal title={title} onClose={onClose} className="external-panel">
        <div className="external-body">{children}</div>
        {skipLabel && (
          <p className="external-skip">
            <input
              id={skipId}
              type="checkbox"
              checked={skip}
              onChange={(e) => setSkip(e.target.checked)}
            />
            <label htmlFor={skipId}>{skipLabel}</label>
          </p>
        )}
        <footer className="modal-footer external-actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {secondary && secondary.href && (
            <a
              className="button"
              href={secondary.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={opened}
            >
              {secondary.label}
            </a>
          )}
          {href ? (
            <a
              className="button button-primary"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-autofocus
              onClick={opened}
            >
              <ExternalIcon size={16} aria-hidden="true" />
              {primaryLabel}
            </a>
          ) : (
            <button type="button" className="button button-primary" disabled>
              {primaryLabel}
            </button>
          )}
        </footer>
        {footerNote && <p className="external-note muted small">{footerNote}</p>}
      </Modal>
    </div>,
    document.body,
  );
}

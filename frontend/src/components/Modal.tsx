import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../i18n/index.js';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open modals, innermost last: only the innermost one reacts to the keyboard. */
const openModals: object[] = [];

/**
 * A modal dialog: focus moves in, Tab stays inside, Escape closes, focus returns to the control
 * that opened it. Content behind it is inert while it is open.
 */
export function Modal({
  title,
  onClose,
  wide = false,
  full = false,
  className = '',
  children,
}: {
  title: string;
  onClose: () => void;
  /** Room for a form instead of a question. */
  wide?: boolean;
  /** Almost the whole screen, for a view that needs the room. */
  full?: boolean;
  /** Extra class for the dialog itself, for a dialog that needs its own layout. */
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first =
      node?.querySelector<HTMLElement>('[data-autofocus]') ??
      node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const self = {};
    openModals.push(self);
    const onKey = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== self) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      // Elements parked out of the tab order (a roving grid's other squares) are not stops.
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.tabIndex >= 0,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(self), 1);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <div
        ref={panel}
        className={`${full ? 'modal modal-full' : wide ? 'modal modal-wide' : 'modal'} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

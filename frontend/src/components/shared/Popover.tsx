import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small panel that opens under a button (display settings, filters). It closes on Escape,
 * on a click outside, and hands focus back to its button.
 *
 * Inside something that scrolls or clips (a board column), `portal` draws the panel on the page
 * instead, fixed under its button, so nothing cuts it off; scrolling then closes it.
 */
export function Popover({
  label,
  icon,
  showLabel = false,
  children,
  align = 'right',
  portal = false,
}: {
  /** Names the button for screen readers and as its tooltip. */
  label: string;
  icon: ReactNode;
  /** Also write the label on the button, beside the icon. */
  showLabel?: boolean;
  /** The panel; a function gets `close` so a choice inside can close it. */
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [fixed, setFixed] = useState<CSSProperties | null>(null);

  /** Fixed under the button (or above it when there is no room below). */
  const place = () => {
    if (!button.current) return;
    const rect = button.current.getBoundingClientRect();
    const style: CSSProperties = { position: 'fixed' };
    if (rect.bottom + 280 > window.innerHeight && rect.top > 280) {
      style.bottom = window.innerHeight - rect.top + 6;
    } else {
      style.top = rect.bottom + 6;
    }
    if (align === 'left') style.left = Math.max(8, rect.left);
    else style.right = Math.max(8, window.innerWidth - rect.right);
    setFixed(style);
  };
  const toggle = () => {
    if (!open && portal) place();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    // The panel follows its button when something scrolls (focusing the button can scroll a
    // column to reveal it), and goes when the button has left the window.
    const follow = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) setOpen(false);
      else place();
    };
    const onScroll = (event: Event) => {
      // The panel's own scrolling is not a reason to move it.
      if (!panel.current?.contains(event.target as Node)) follow();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    if (portal) {
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', follow);
    }
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', follow);
    };
  }, [open, portal]);

  return (
    <div className="popover" ref={root}>
      <button
        ref={button}
        type="button"
        className={showLabel ? 'button button-icon-text' : 'button button-icon'}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        {icon}
        {showLabel && label}
      </button>
      {open && !portal && (
        <div id={id} className={`popover-panel popover-${align}`} role="dialog" aria-label={label}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
      {open &&
        portal &&
        createPortal(
          // React events still reach the parents of a portal; a drag must not start from a menu.
          <div
            ref={panel}
            id={id}
            className="popover-panel popover-fixed"
            style={fixed ?? undefined}
            role="dialog"
            aria-label={label}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}

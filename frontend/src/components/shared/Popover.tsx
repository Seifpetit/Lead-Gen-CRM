import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A small panel that opens under a button (display settings, filters). It closes on Escape,
 * on a click outside, and hands focus back to its button.
 */
export function Popover({
  label,
  icon,
  showLabel = false,
  children,
  align = 'right',
}: {
  /** Names the button for screen readers and as its tooltip. */
  label: string;
  icon: ReactNode;
  /** Also write the label on the button, beside the icon. */
  showLabel?: boolean;
  /** The panel; a function gets `close` so a choice inside can close it. */
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {showLabel && label}
      </button>
      {open && (
        <div id={id} className={`popover-panel popover-${align}`} role="dialog" aria-label={label}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

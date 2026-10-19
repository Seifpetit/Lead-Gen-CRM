import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

/**
 * A short explanation that shows when the mark is hovered or focused, and goes with Escape.
 * `label` names the mark for screen readers; `text` is the explanation, which they read as its
 * description. The bubble is fixed to the window, so a scrolling column does not cut it off.
 */
export function Tip({
  label,
  text,
  children,
}: {
  label: string;
  text: string;
  children: ReactNode;
}) {
  const id = useId();
  const [at, setAt] = useState<CSSProperties | null>(null);
  const show = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const half = 130;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, half + 8),
      window.innerWidth - half - 8,
    );
    // Above the mark, or below it when it is at the top of the window.
    setAt(
      rect.top > 90
        ? { left, top: rect.top - 8, transform: 'translate(-50%, -100%)' }
        : { left, top: rect.bottom + 8, transform: 'translateX(-50%)' },
    );
  };
  const hide = () => setAt(null);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && at) {
      event.stopPropagation();
      hide();
    }
  };
  return (
    <span
      className="tip"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={hide}
      onKeyDown={onKeyDown}
    >
      <span className="tip-mark" tabIndex={0} role="img" aria-label={label} aria-describedby={id}>
        {children}
      </span>
      <span id={id} role="tooltip" className="tip-bubble" style={at ?? undefined} hidden={!at}>
        {text}
      </span>
    </span>
  );
}

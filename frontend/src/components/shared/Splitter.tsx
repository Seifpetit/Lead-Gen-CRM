import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const STEP = 2;
const BIG_STEP = 10;

/**
 * The bar between two stacked sections that lets the top one grow or shrink. `value` is the top
 * section's share (in percent) of the two sections together. Drag it, or focus it and use the
 * arrow keys (Page Up / Page Down for bigger steps, Home / End for the limits). Double-click
 * puts it back with `onReset`. The sections on either side of it in the DOM are the ones measured.
 */
export function Splitter({
  label,
  valueText,
  value,
  min,
  max,
  onChange,
  onReset,
}: {
  label: string;
  /** What a screen reader says for the current value, e.g. "Leads 61%". */
  valueText: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; value: number; span: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n * 10) / 10));

  const spanOf = () => {
    const above = bar.current?.previousElementSibling as HTMLElement | null;
    const below = bar.current?.nextElementSibling as HTMLElement | null;
    return (above?.offsetHeight ?? 0) + (below?.offsetHeight ?? 0);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    start.current = { y: event.clientY, value, span: spanOf() };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    if (!from || from.span <= 0) return;
    onChange(clamp(from.value + ((event.clientY - from.y) / from.span) * 100));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    start.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next: Record<string, number> = {
      ArrowUp: value - STEP,
      ArrowDown: value + STEP,
      PageUp: value - BIG_STEP,
      PageDown: value + BIG_STEP,
      Home: min,
      End: max,
    };
    const to = next[event.key];
    if (to === undefined) return;
    event.preventDefault();
    onChange(clamp(to));
  };

  return (
    <div
      ref={bar}
      className={`panel-splitter${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span className="splitter-knob" aria-hidden="true" />
    </div>
  );
}

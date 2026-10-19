import { Check } from 'lucide-react';
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { useT } from '../../i18n/index.js';

export interface ChipItem {
  id: string;
  label: string;
  /** Small text after the label, e.g. a coverage state. */
  hint?: string;
  icon?: ReactNode;
  /** Fill of the chip when selected. */
  color?: string;
  /** Cannot be toggled, and is skipped by Select all. */
  disabled?: boolean;
  title?: string;
}

/** The chip under a screen point, for touch, where the pointer stays with the chip it started on. */
function chipIdAt(x: number, y: number): string | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-chip-id]');
  return el?.dataset.chipId ?? null;
}

/**
 * A group of toggle chips, each with a small checkbox, plus Select all and Deselect all.
 *
 * Press-and-drag paints: pressing a chip toggles it, and moving over other chips (mouse, pen or
 * finger, held down) sets each to the state the first chip was just given. Space or Enter on a
 * focused chip toggles that one chip, and so does a screen reader's activate. The selection is
 * owned by the caller; `onChange` always gets the selected ids in the order of `items`.
 */
export function ChipMultiSelect({
  legend,
  items,
  selected,
  onChange,
  countText,
  allLabel,
  noneLabel,
  className = '',
}: {
  legend: string;
  items: readonly ChipItem[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  /** "3 of 9 selected" in the caller's words. */
  countText?: (selected: number, total: number) => string;
  /** Defaults to the shared "Select all" / "Deselect all". */
  allLabel?: string;
  noneLabel?: string;
  className?: string;
}) {
  const t = useT();
  const chosen = new Set(selected);
  const choosable = items.filter((i) => !i.disabled);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // While a drag is going: the state being painted, and the selection as painted so far (the
  // caller's state lags a render behind the pointer).
  const paint = useRef<{ on: boolean; working: Set<string> } | null>(null);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  const emit = (set: ReadonlySet<string>) =>
    onChangeRef.current(itemsRef.current.filter((i) => set.has(i.id)).map((i) => i.id));

  function paintOver(id: string) {
    const p = paint.current;
    const item = itemsRef.current.find((i) => i.id === id);
    if (!p || !item || item.disabled) return;
    if (p.working.has(id) === p.on) return;
    if (p.on) p.working.add(id);
    else p.working.delete(id);
    emit(p.working);
  }

  function begin(event: PointerEvent<HTMLElement>, item: ChipItem) {
    if (item.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const working = new Set(selectedRef.current);
    const on = !working.has(item.id);
    paint.current = { on, working };
    paintOver(item.id);
    const move = (e: globalThis.PointerEvent) => {
      // Mouse and pen report each chip they enter; a finger stays with the first one.
      if (e.pointerType === 'touch') {
        const id = chipIdAt(e.clientX, e.clientY);
        if (id !== null) paintOver(id);
      }
    };
    const end = () => {
      paint.current = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      stop.current = () => {};
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    stop.current = end;
  }

  function toggleOne(item: ChipItem) {
    if (item.disabled) return;
    const next = new Set(selectedRef.current);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    emit(next);
  }

  const allOn = choosable.length > 0 && choosable.every((i) => chosen.has(i.id));
  return (
    <fieldset className={`chip-select ${className}`.trim()}>
      <legend>{legend}</legend>
      <div className="chip-select-bar">
        <span className="muted" role="status">
          {countText?.(selected.length, choosable.length)}
        </span>
        <span className="chip-select-links">
          <button
            type="button"
            className="link-button"
            disabled={allOn || choosable.length === 0}
            onClick={() => emit(new Set([...selected, ...choosable.map((i) => i.id)]))}
          >
            {allLabel ?? t('chips.all')}
          </button>
          <button
            type="button"
            className="link-button"
            disabled={selected.length === 0}
            onClick={() => emit(new Set())}
          >
            {noneLabel ?? t('chips.none')}
          </button>
        </span>
      </div>
      <div className="chip-select-chips">
        {items.map((item) => {
          const on = chosen.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className="sr-chip chip-select-chip"
              data-chip-id={item.id}
              aria-pressed={on}
              aria-disabled={item.disabled || undefined}
              title={item.title}
              style={on && item.color ? { background: item.color } : undefined}
              onPointerDown={(e) => begin(e, item)}
              onPointerOver={() => paintOver(item.id)}
              onDragStart={(e) => e.preventDefault()}
              // A press is handled on pointer down. A click with no pointer behind it (Space,
              // Enter, a screen reader) has detail 0 and is the keyboard route.
              onClick={(e) => {
                if (e.detail === 0) toggleOne(item);
              }}
            >
              <span className="chip-box" aria-hidden="true">
                {on && <Check size={12} />}
              </span>
              {item.icon}
              <span>{item.label}</span>
              {item.hint && <span className="chip-hint">{item.hint}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

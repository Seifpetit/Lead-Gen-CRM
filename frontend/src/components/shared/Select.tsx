import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  /** A second, quieter line under the label (progress, counts). */
  secondary?: string;
  disabled?: boolean;
}

/**
 * A listbox that replaces the browser's own <select>. The closed control is a button with
 * role combobox, so a <label htmlFor> names it; the open list is a bordered card drawn on the
 * page (not clipped by dialogs). Arrow keys, Home/End, type-ahead, Enter/Space to choose, Escape
 * closes only the list. The value stays with the caller, as with a native select.
 */
export function Select({
  id,
  value,
  onChange,
  options,
  placeholder = '',
  disabled = false,
  className,
  autoFocus = false,
  'aria-describedby': describedBy,
}: {
  /** Put the same id on a <label htmlFor> to name the control. */
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Shown when `value` matches no option (and for a menu whose value is always empty). */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Marks it for a dialog to focus when it opens (a native autofocus would hide the opener). */
  autoFocus?: boolean;
  'aria-describedby'?: string | undefined;
}) {
  const auto = useId();
  const buttonId = id ?? auto;
  const listId = `${buttonId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const selected = options.findIndex((o) => o.value === value);
  const current = selected >= 0 ? options[selected] : undefined;
  const enabled = (i: number) => options[i] !== undefined && !options[i]!.disabled;
  const firstEnabled = () => options.findIndex((_, i) => enabled(i));
  const lastEnabled = () =>
    options
      .map((_, i) => i)
      .reverse()
      .find(enabled) ?? -1;
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return from;
  };

  const measure = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const room = window.innerHeight - rect.bottom;
    const style: CSSProperties = { position: 'fixed', left: rect.left, minWidth: rect.width };
    if (room < 220 && rect.top > room) {
      style.bottom = window.innerHeight - rect.top + 6;
      style.maxHeight = Math.min(320, rect.top - 12);
    } else {
      style.top = rect.bottom + 6;
      style.maxHeight = Math.min(320, Math.max(120, room - 12));
    }
    setPlace(style);
  };

  const openList = (at?: number) => {
    if (disabled) return;
    measure();
    setActive(at ?? (enabled(selected) ? selected : firstEnabled()));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (button.current?.contains(target) || list.current?.contains(target)) return;
      setOpen(false);
    };
    // Caught on the way down so that a dialog around the list does not also close.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) measure();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listId]);

  /** Type-ahead: letters typed quickly search from the start of the labels. */
  const typeAhead = (key: string): number => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const q = t.text.toLowerCase();
    const from = t.text.length === 1 ? active + 1 : active;
    const order = [...options.keys()];
    const rotated = [...order.slice(Math.max(from, 0)), ...order.slice(0, Math.max(from, 0))];
    return rotated.find((i) => enabled(i) && options[i]!.label.toLowerCase().startsWith(q)) ?? -1;
  };

  function onKeyDown(e: React.KeyboardEvent) {
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        openList();
      } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const hit = typeAhead(k);
        if (hit >= 0) openList(hit);
      }
      return;
    }
    if (k === 'ArrowDown') setActive(step(active, 1));
    else if (k === 'ArrowUp') setActive(step(active, -1));
    else if (k === 'Home') setActive(firstEnabled());
    else if (k === 'End') setActive(lastEnabled());
    else if (k === 'Enter' || k === ' ') choose(active);
    else if (k === 'Tab') setOpen(false);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const hit = typeAhead(k);
      if (hit >= 0) setActive(hit);
      return;
    } else return;
    if (k !== 'Tab') e.preventDefault();
  }

  return (
    <>
      <button
        ref={button}
        id={buttonId}
        type="button"
        role="combobox"
        className={className ? `select-button ${className}` : 'select-button'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        data-autofocus={autoFocus ? '' : undefined}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={current ? 'select-value' : 'select-value is-placeholder'}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="select-chevron" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            className="select-list"
            style={place}
            aria-labelledby={buttonId}
            // A drag or a click on the list must not reach the cards and dialogs around it.
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <li
                key={o.value + i}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === selected}
                aria-label={o.secondary ? `${o.label}, ${o.secondary}` : undefined}
                aria-disabled={o.disabled || undefined}
                className={[
                  'select-option',
                  i === selected ? 'is-selected' : '',
                  i === active ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => enabled(i) && setActive(i)}
                onClick={() => choose(i)}
              >
                <span>{o.label}</span>
                {o.secondary && <small>{o.secondary}</small>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}

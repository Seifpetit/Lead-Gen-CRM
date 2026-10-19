import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { Popover } from './Popover.js';

/** What a field says about itself when it narrows the list (as opposed to a sort or a layout). */
export interface FilterState {
  /** True when it is not at its default; it then counts in the badge and gets a chip. */
  active: boolean;
  /** The chip's text, e.g. "Stage: Found". */
  chip: string;
  /** Back to the default (the chip's remove button). */
  clear: () => void;
}

interface Base {
  id: string;
  label: string;
  /** Set on fields that narrow the list. */
  filter?: FilterState;
}
/** One of a few options, shown as radio buttons. */
export interface ChoiceField extends Base {
  type: 'choice';
  value: string;
  options: readonly { value: string; label: string; count?: number }[];
  onChange: (value: string) => void;
}
/** A number on a slider; the change is applied after a short pause so dragging does not flood. */
export interface RangeField extends Base {
  type: 'range';
  value: number;
  min: number;
  max: number;
  step: number;
  /** The value in words, e.g. "50 or more". */
  valueText: string;
  onChange: (value: number) => void;
}
/** Narrows the list but is set somewhere else (a folder); it only shows as a chip. */
export interface TagField extends Base {
  type: 'tag';
  filter: FilterState;
}
export type FilterField = ChoiceField | RangeField | TagField;

const SLIDER_DELAY_MS = 150;

/** The fields that narrow the list right now. */
export const activeFilters = (fields: readonly FilterField[]) =>
  fields.flatMap((f) => (f.filter?.active ? [{ id: f.id, ...f.filter }] : []));

function Choice({ field }: { field: ChoiceField }) {
  const name = useId();
  return (
    <fieldset className="filter-field">
      <legend>{field.label}</legend>
      <div className="filter-options">
        {field.options.map((o) => (
          <label key={o.value} className="filter-option">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={field.value === o.value}
              onChange={() => field.onChange(o.value)}
            />
            <span>
              {o.label}
              {o.count !== undefined && <span className="chip-count">{o.count}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Range({ field }: { field: RangeField }) {
  const id = useId();
  const [local, setLocal] = useState(field.value);
  const latest = useRef(field);
  latest.current = field;
  // A change from outside (Reset, a chip) replaces what the slider shows.
  useEffect(() => setLocal(field.value), [field.value]);
  useEffect(() => {
    if (local === latest.current.value) return;
    const timer = setTimeout(() => latest.current.onChange(local), SLIDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [local]);
  return (
    <div className="filter-field">
      <label htmlFor={id} className="filter-legend">
        {field.label}
      </label>
      <div className="filter-slider">
        <input
          id={id}
          type="range"
          min={field.min}
          max={field.max}
          step={field.step}
          value={local}
          aria-valuetext={local === field.value ? field.valueText : String(local)}
          onChange={(e) => setLocal(Number(e.target.value))}
        />
        <output htmlFor={id}>{local === field.value ? field.valueText : local}</output>
      </div>
    </div>
  );
}

/**
 * A Filters button that opens a panel with the given fields. Filters apply as they are changed;
 * Escape or a click outside closes the panel and the focus goes back to the button. The badge on
 * the button counts the filters that are active, and Reset puts them all back (`onReset`, one
 * change, so nothing races). Sorts and layouts (fields without `filter`) are in the panel too,
 * but are not filters, so Reset leaves them alone.
 */
export function FilterMenu({
  fields,
  onReset,
}: {
  fields: readonly FilterField[];
  onReset: () => void;
}) {
  const t = useT();
  const count = activeFilters(fields).length;
  return (
    <Popover
      label={t('filters.title')}
      buttonLabel={count > 0 ? t('filters.active', { count }) : t('filters.title')}
      icon={<SlidersHorizontal size={14} aria-hidden="true" />}
      showLabel
      badge={count}
      portal
    >
      <div className="filter-panel">
        {fields.map((f) =>
          f.type === 'choice' ? (
            <Choice key={f.id} field={f} />
          ) : f.type === 'range' ? (
            <Range key={f.id} field={f} />
          ) : null,
        )}
        <div className="filter-actions">
          <button type="button" className="button" disabled={count === 0} onClick={onReset}>
            {t('filters.reset')}
          </button>
        </div>
      </div>
    </Popover>
  );
}

/** A thin row of small removable chips, one per active filter; nothing at all when there are none. */
export function FilterChips({ fields }: { fields: readonly FilterField[] }) {
  const t = useT();
  const active = activeFilters(fields);
  if (active.length === 0) return null;
  return (
    <ul className="filter-chips" aria-label={t('filters.chips')}>
      {active.map((f) => (
        <li key={f.id} className="filter-chip">
          <span>{f.chip}</span>
          <button
            type="button"
            aria-label={t('filters.remove', { name: f.chip })}
            title={t('filters.remove', { name: f.chip })}
            onClick={f.clear}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

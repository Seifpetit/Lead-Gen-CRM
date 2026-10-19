import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/index.js';
import { decimalsOf, parseAmount } from '../../lib/parseAmount.js';

const HOLD_DELAY_MS = 400;
const HOLD_EVERY_MS = 70;

/**
 * A number field with a stepper pair on the right, for amounts. The text is the caller's (so a
 * half-typed "2," survives); it accepts "2.5" and "2,5". Arrow keys and the buttons step, a held
 * button repeats, and a step never leaves [min, max]. On leaving the field a valid number is
 * tidied to `decimals` places. Typing is not clamped: the caller shows what is wrong.
 */
export function NumberStepper({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals = decimalsOf(step),
  prefix,
  invalid = false,
  disabled = false,
  onBlur,
  'aria-describedby': describedBy,
}: {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Places shown after a step or when the field is left. */
  decimals?: number;
  /** Shown before the number, e.g. "$". */
  prefix?: string;
  invalid?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
  'aria-describedby'?: string | undefined;
}) {
  const t = useT();
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const timers = useRef<{ delay?: number; repeat?: number }>({});

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const format = (n: number) => n.toFixed(decimals);

  /** One step from whatever is in the field now (from the minimum when it holds nothing). */
  const bump = (dir: 1 | -1) => {
    const now = parseAmount(latest.current.value);
    const base = now ?? (dir === 1 ? (min ?? 0) - step : (min ?? 0) + step);
    // Snap to the step grid so 0.1 + 0.2 stays 0.3.
    const next = Math.round((base + dir * step) * 10 ** (decimals + 2)) / 10 ** (decimals + 2);
    latest.current.onChange(format(clamp(next)));
  };

  const stop = () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.repeat);
  };
  useEffect(() => stop, []);

  const hold = (dir: 1 | -1) => (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    bump(dir);
    stop();
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(() => bump(dir), HOLD_EVERY_MS);
    }, HOLD_DELAY_MS);
  };

  const n = parseAmount(value);

  return (
    <div className={invalid ? 'stepper is-invalid' : 'stepper'}>
      {prefix && (
        <span className="stepper-prefix" aria-hidden="true">
          {prefix}
        </span>
      )}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        role="spinbutton"
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-valuenow={n ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (n !== null && n >= (min ?? -Infinity) && n <= (max ?? Infinity)) onChange(format(n));
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      <span className="stepper-buttons">
        {([1, -1] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            tabIndex={-1}
            disabled={
              disabled ||
              (n !== null && (dir === 1 ? n >= (max ?? Infinity) : n <= (min ?? -Infinity)))
            }
            aria-label={t(dir === 1 ? 'stepper.up' : 'stepper.down')}
            onPointerDown={hold(dir)}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            onBlur={stop}
            onClick={(e) => {
              // A real press is handled on pointer down; this is for assistive tech and tests.
              if (e.detail === 0) bump(dir);
            }}
          >
            {dir === 1 ? (
              <ChevronUp size={12} aria-hidden="true" />
            ) : (
              <ChevronDown size={12} aria-hidden="true" />
            )}
          </button>
        ))}
      </span>
    </div>
  );
}

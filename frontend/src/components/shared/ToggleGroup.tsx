import { useId } from 'react';

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A segmented switch between a few options (Month / Run / Region / Provider). Built from
 * radio buttons, so it is one tab stop and arrow keys move between options.
 */
export function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** What the switch chooses, shown as its legend. */
  label: string;
  options: readonly ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      {options.map((o) => (
        <label key={o.value}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
